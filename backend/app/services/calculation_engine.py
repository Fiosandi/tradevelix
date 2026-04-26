"""Calculation Engine - Three Doors Analysis from stored DB data.

This engine NEVER calls the API. It reads only from the local PostgreSQL
database and calculates the Three Doors metrics:

Door 1: Who - Whale identification from broker_entries
Door 2: What - Retail exit %, whale net lots, transaction patterns
Door 3: Coordination - Kekompakan score (same-direction whales)

Overall Signal = weighted composite of all metrics.

Calculations run AFTER sync, on stored data.
"""

import logging
from datetime import date, timedelta
from decimal import Decimal
from typing import List, Optional, Tuple
from uuid import UUID, uuid4

from sqlalchemy import select, func, and_, case
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import settings
from app.models.stock import Stock
from app.models.broker_summary import BrokerSummary, BrokerEntry
from app.models.daily_price import DailyPrice
from app.models.weekly_metric import WeeklyMetric
from app.models.api_signal import ApiSignal

logger = logging.getLogger(__name__)


# ─── Per-stock shareholder broker mapping ─────────────────────────────────────
# Derived from 5%+ shareholder disclosures (IDX/KSEI).
# These brokers are ALWAYS treated as whales for the specified stock,
# because they are known to hold/trade on behalf of controlling shareholders.
# Broker code → Full name reference in brokers table.
STOCK_WHALE_BROKERS: dict = {
    'BUVA': ['YU'],                          # CGS Int'l = PT Nusantara Utama Investama 61%
    'BIPI': ['LG', 'YU', 'DH'],             # Trimegah + CGS + Sinarmas (Bakrie group)
    'VKTR': ['KI', 'II'],                   # Ciptadana + Danatama (Bakrie Metal 14%, BNBR 24%)
    'BUMI': ['RB'],                          # INA Sekuritas = Mach Energy 45.78%
    'BRMS': ['IU', 'MG', 'OD', 'HP', 'OK'], # Indo Capital + Semesta + BRI + HP + NET
    'ENRG': ['DR', 'LG', 'ZP', 'YU'],       # RHB + Trimegah + Maybank + CGS
    'SUPA': ['LG', 'CC', 'BQ'],             # Trimegah + Mandiri + Korea Inv (controllers 27%+16%+16%)
    'COCO': ['PP', 'DP'],                    # Aldiracita + DBS (Mahogany 51%)
    'PTRO': ['HP', 'NI', 'YU', 'ZP'],       # Henan + BNI + CGS + Maybank (Kreasi 45%)
    'IMPC': ['KI', 'LG'],                   # Ciptadana + Trimegah (Harimas 20%)
    'INDY': ['CC'],                          # Mandiri = Indika Inti Investindo 37.79%
    'MBSS': ['SQ'],                          # BCA Sekuritas = PT Galley 82.5%
    'PSKT': ['NI', 'AI', 'AZ'],             # BNI + Kay Hian + Sucor (controllers 40%+23%)
    'INKP': ['YO', 'BQ', 'DH'],             # Amantara + Korea + Sinarmas (APP Purinusa 17%)
    'BNBR': ['KI'],                          # Ciptadana = Port Fraser 22.41%
    'WIFI': ['DR', 'FS', 'TP', 'AG', 'YU', 'XA', 'YB', 'OD', 'CC'],  # ISB 54% uses multiple
    'INET': ['YB', 'DR', 'MG', 'XA'],       # Yakin + RHB + Semesta + NH (AKUN 59.77%)
    'ESSA': ['LG', 'AI', 'KI'],             # Trimegah + Kay Hian + Ciptadana (Akraya+Garibaldi+Chander)
    'BULL': ['AI', 'DH', 'II', 'FS', 'AG', 'XA'],  # Kay Hian + Sinarmas + Danatama + Yuanta + Kiwoom + NH
}


class CalculationEngine:
    """Calculates Three Doors analysis metrics from stored DB data.

    All calculations are based on:
    - broker_entries (Door 1, 2, 3) - aggregated weekly
    - daily_prices (VPA signal) - daily
    - api_signals (corroboration) - weekly
    """

    def __init__(self, db: AsyncSession, ticker: str = ''):
        self.db = db
        self.ticker = ticker.upper()
        self.whale_brokers = set(settings.whale_brokers_list)
        self.retail_brokers = set(settings.retail_brokers_list)
        # Merge in per-stock controlling shareholder brokers
        if self.ticker in STOCK_WHALE_BROKERS:
            self.whale_brokers.update(STOCK_WHALE_BROKERS[self.ticker])

    # ─── Main Entry Point ─────────────────────────────────────────────

    async def calculate_weekly_metrics(
        self, stock_id: UUID, week_start: date, week_end: date
    ) -> Optional[WeeklyMetric]:
        """Calculate all Three Doors metrics for a stock for a week.

        This is the main entry point. It:
        1. Fetches broker entries for the stock/week
        2. Calculates Door 1, 2, 3 metrics
        3. Calculates VPA signal
        4. Calculates bandar floor price
        5. Fetches API signals for corroboration
        6. Produces an overall composite signal
        7. Upserts into weekly_metrics
        """
        # Fetch the most recent broker summary covering this week.
        # The summary period can be a single week (7 days) or YTD/monthly — any range
        # that contains the current week_end is valid.
        summary_result = await self.db.execute(
            select(BrokerSummary).where(
                and_(
                    BrokerSummary.stock_id == stock_id,
                    BrokerSummary.date_from <= week_end,   # started before or at week end
                    BrokerSummary.date_to   >= week_start - timedelta(days=7),  # ends near or after week start
                )
            ).order_by(BrokerSummary.date_to.desc())
        )
        summary = summary_result.scalar_one_or_none()

        if not summary:
            logger.warning(f"No broker summary for stock {stock_id} week {week_start}")
            # Still calculate VPA and API signals even without broker data
            entries = []
            summary_id = None
        else:
            summary_id = summary.id

            # Fetch broker entries for this summary
            entries_result = await self.db.execute(
                select(BrokerEntry).where(BrokerEntry.summary_id == summary.id)
            )
            entries = list(entries_result.scalars().all())

        # Compute dynamic whale set for this stock/week before all doors
        dynamic_whales = self.classify_whales_dynamic(entries)

        # Update is_whale flag on broker_entries to match dynamic classification
        # so the frontend evidence panels show the correct whale brokers
        for entry in entries:
            correct = entry.broker_code in dynamic_whales
            if entry.is_whale != correct:
                entry.is_whale = correct
        await self.db.flush()

        # ─── Door 1: Who ───────────────────────────────────────────
        whale_net_lots, whale_net_value, whale_count = await self.calculate_whale_net(entries, dynamic_whales)

        # ─── Door 2: What ──────────────────────────────────────────
        retail_exit_pct = self.calculate_retail_exit(entries, dynamic_whales)
        retail_participation = self.calculate_retail_participation(entries)

        # ─── Door 3: Coordination ─────────────────────────────────
        kekompakan_score = self.calculate_kekompakan(entries, dynamic_whales)

        # ─── VPA Signal ────────────────────────────────────────────
        vpa_signal = await self.calculate_vpa_signal(stock_id, week_end)
        price_change_week = await self.calculate_price_change(stock_id, week_start, week_end)
        volume_change_week = await self.calculate_volume_change(stock_id, week_start, week_end)

        # ─── Bandar Floor Price ────────────────────────────────────
        bandar_floor = self.calculate_bandar_floor(entries, dynamic_whales)

        # ─── Top 3 Whale Brokers (sorted by net buy lots) ──────────
        top_whale_brokers = self.calculate_top_whale_brokers(entries, dynamic_whales)

        # ─── Distance to Floor ─────────────────────────────────────
        current_price = await self._get_latest_close(stock_id)
        distance_to_floor = None
        if bandar_floor and current_price and bandar_floor > 0:
            distance_to_floor = Decimal(str(
                ((current_price - bandar_floor) / bandar_floor) * 100
            )).quantize(Decimal("0.0001"))

        # ─── API Pre-computed Signals (for corroboration) ──────────
        api_accumulation_score = None
        api_distribution_score = None
        api_sentiment_status = None
        api_smart_money_status = None

        for signal_type in ["accumulation", "distribution", "sentiment", "smart_money"]:
            sig_result = await self.db.execute(
                select(ApiSignal).where(
                    and_(
                        ApiSignal.stock_id == stock_id,
                        ApiSignal.signal_type == signal_type,
                        ApiSignal.date >= week_start,
                        ApiSignal.date <= week_end,
                    )
                ).order_by(ApiSignal.date.desc())
            )
            api_sig = sig_result.scalar_one_or_none()
            if api_sig:
                if signal_type == "accumulation":
                    api_accumulation_score = api_sig.score
                elif signal_type == "distribution":
                    api_distribution_score = api_sig.score
                elif signal_type == "sentiment":
                    api_sentiment_status = api_sig.status
                elif signal_type == "smart_money":
                    api_smart_money_status = api_sig.status

        # ─── Overall Signal ────────────────────────────────────────
        overall_signal, confidence_score = self.calculate_overall_signal(
            whale_net_lots=whale_net_lots,
            retail_exit_pct=retail_exit_pct,
            kekompakan_score=kekompakan_score,
            vpa_signal=vpa_signal,
            api_accumulation_score=api_accumulation_score,
            api_distribution_score=api_distribution_score,
        )

        # ─── Upsert Weekly Metrics ─────────────────────────────────
        stmt = pg_insert(WeeklyMetric).values(
            id=uuid4(),
            stock_id=stock_id,
            week_start=week_start,
            week_end=week_end,
            # Door 1
            whale_net_lots=whale_net_lots,
            whale_net_value=whale_net_value,
            whale_count=whale_count,
            # Door 2
            retail_exit_percent=retail_exit_pct,
            retail_participation_pct=retail_participation,
            # Door 3
            kekompakan_score=kekompakan_score,
            # VPA
            vpa_signal=vpa_signal,
            price_change_week=price_change_week,
            volume_change_week=volume_change_week,
            # Bandar
            bandar_floor_price=bandar_floor,
            distance_to_floor_pct=distance_to_floor,
            # Top whale brokers
            top_whale_brokers=top_whale_brokers,
            # Composite
            overall_signal=overall_signal,
            confidence_score=confidence_score,
            # API signals
            api_accumulation_score=api_accumulation_score,
            api_distribution_score=api_distribution_score,
            api_sentiment_status=api_sentiment_status,
            api_smart_money_status=api_smart_money_status,
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_weekly_metric_stock_week",
            set_={
                "whale_net_lots": stmt.excluded.whale_net_lots,
                "whale_net_value": stmt.excluded.whale_net_value,
                "whale_count": stmt.excluded.whale_count,
                "retail_exit_percent": stmt.excluded.retail_exit_percent,
                "retail_participation_pct": stmt.excluded.retail_participation_pct,
                "kekompakan_score": stmt.excluded.kekompakan_score,
                "vpa_signal": stmt.excluded.vpa_signal,
                "price_change_week": stmt.excluded.price_change_week,
                "volume_change_week": stmt.excluded.volume_change_week,
                "bandar_floor_price": stmt.excluded.bandar_floor_price,
                "distance_to_floor_pct": stmt.excluded.distance_to_floor_pct,
                "top_whale_brokers": stmt.excluded.top_whale_brokers,
                "overall_signal": stmt.excluded.overall_signal,
                "confidence_score": stmt.excluded.confidence_score,
                "api_accumulation_score": stmt.excluded.api_accumulation_score,
                "api_distribution_score": stmt.excluded.api_distribution_score,
                "api_sentiment_status": stmt.excluded.api_sentiment_status,
                "api_smart_money_status": stmt.excluded.api_smart_money_status,
            },
        )
        await self.db.execute(stmt)
        await self.db.flush()

        logger.info(
            f"Weekly metrics for {stock_id} ({week_start}): "
            f"signal={overall_signal}, confidence={confidence_score}, "
            f"whale_net={whale_net_lots}, retail_exit={retail_exit_pct}%, "
            f"kekompakan={kekompakan_score}%"
        )

        # Re-fetch and return
        result = await self.db.execute(
            select(WeeklyMetric).where(
                and_(
                    WeeklyMetric.stock_id == stock_id,
                    WeeklyMetric.week_start == week_start,
                )
            )
        )
        return result.scalar_one_or_none()

    # ─── Door 1: Who (Whale Identification) ───────────────────────────

    def classify_whales_dynamic(self, entries: List[BrokerEntry]) -> set:
        """Dynamic whale classification per stock/week.

        Two patterns get a broker reclassified as whale:

        Tier A — Block-trader pattern (single big-ticket trades):
          - Non-retail: value >= 500M AND lot/tx >= 50, OR value >= 200M AND lot/tx >= 100
          - Known retail (override): value >= 200M AND lot/tx >= 200

        Tier B — Persistent split-order accumulator (algo that fragments orders
        to hide footprint). A broker is flagged when it dominates the stock's
        flow with a decisive net direction, even if individual txns are small:
          - value >= 1B (retail) or 500M (non-retail)
          - flow_share >= 3% of total stock value across all brokers
          - conviction >= 60% (|net_lots| / (buy+sell) — rules out churning market-makers)
          - lot/tx >= 30 (rules out genuine retail aggregation where avg trade is 1-15 lots)

        Known whale brokers (AI, BK, YU, BB, AS, SS, CS) are always included.
        """
        import collections

        WHALE_VALUE      = 200_000_000     # Rp 200M — absolute floor
        WHALE_VALUE_HIGH = 500_000_000     # Rp 500M
        SPLIT_VALUE_RETAIL  = 1_000_000_000  # Rp 1B for known-retail override
        SPLIT_FLOW_SHARE    = 0.03           # 3% of total stock flow
        SPLIT_CONVICTION    = 0.60           # 60% one-sided
        SPLIT_LOT_PER_TX    = 30             # above typical retail order size

        if not entries:
            return set(self.whale_brokers)

        stats: dict = collections.defaultdict(lambda: {
            'lots': 0, 'frequency': 0, 'value': Decimal('0'),
            'buy_lots': 0, 'sell_lots': 0,
        })
        for e in entries:
            s = stats[e.broker_code]
            s['lots']      += e.lots or 0
            s['frequency'] += e.frequency or 1
            s['value']     += e.value or Decimal('0')
            if e.side == 'BUY':
                s['buy_lots']  += e.lots or 0
            elif e.side == 'SELL':
                s['sell_lots'] += e.lots or 0

        total_value = sum(float(s['value']) for s in stats.values()) or 1.0

        dynamic = set(self.whale_brokers)

        for code, s in stats.items():
            if code in self.whale_brokers:
                continue
            value       = float(s['value'])
            lots        = s['lots']
            freq        = max(s['frequency'], 1)
            lot_per_tx  = lots / freq
            is_retail   = code in self.retail_brokers

            if value < WHALE_VALUE:
                continue  # below the 200M floor — never a whale

            # ─── Tier A: block-trader pattern ─────────────────────────
            if is_retail:
                if value >= WHALE_VALUE and lot_per_tx >= 200:
                    dynamic.add(code)
                    continue
            else:
                if value >= WHALE_VALUE_HIGH and lot_per_tx >= 50:
                    dynamic.add(code)
                    continue
                if value >= WHALE_VALUE and lot_per_tx >= 100:
                    dynamic.add(code)
                    continue

            # ─── Tier B: persistent split-order accumulator ───────────
            split_value_floor = SPLIT_VALUE_RETAIL if is_retail else WHALE_VALUE_HIGH
            if value < split_value_floor or lot_per_tx < SPLIT_LOT_PER_TX:
                continue
            flow_share = value / total_value
            directional = s['buy_lots'] + s['sell_lots']
            if directional == 0:
                continue
            conviction = abs(s['buy_lots'] - s['sell_lots']) / directional
            if flow_share >= SPLIT_FLOW_SHARE and conviction >= SPLIT_CONVICTION:
                dynamic.add(code)

        return dynamic

    async def calculate_whale_net(
        self, entries: List[BrokerEntry], whale_set: set = None
    ) -> Tuple[Optional[int], Optional[Decimal], int]:
        """Calculate net whale position.

        Returns: (whale_net_lots, whale_net_value, whale_count)
        - whale_net_lots: Sum of whale buy lots minus whale sell lots
        - whale_net_value: Sum of whale buy value minus whale sell value
        - whale_count: Number of active whale brokers
        """
        if not entries:
            return None, None, 0

        whale_buy_lots = 0
        whale_sell_lots = 0
        whale_buy_value = Decimal("0")
        whale_sell_value = Decimal("0")
        active_whales = set()

        for entry in entries:
            is_whale = (entry.broker_code in whale_set) if whale_set is not None else entry.is_whale
            if not is_whale:
                continue

            active_whales.add(entry.broker_code)

            if entry.side == "BUY":
                whale_buy_lots += entry.lots or 0
                whale_buy_value += entry.value or Decimal("0")
            elif entry.side == "SELL":
                whale_sell_lots += entry.lots or 0
                whale_sell_value += entry.value or Decimal("0")

        net_lots = whale_buy_lots - whale_sell_lots
        net_value = whale_buy_value - whale_sell_value

        return net_lots, net_value, len(active_whales)

    # ─── Door 2: What (Transaction Patterns) ──────────────────────────

    def calculate_retail_exit(self, entries: List[BrokerEntry], whale_set: set = None) -> Optional[Decimal]:
        """Calculate retail exit percentage.

        Formula: retail_sell_lots / (retail_buy_lots + retail_sell_lots) * 100
        High retail exit % = retail panic selling (bullish signal for whales)
        """
        if not entries:
            return None

        retail_buy_lots = 0
        retail_sell_lots = 0

        for entry in entries:
            is_whale = (entry.broker_code in whale_set) if whale_set is not None else entry.is_whale
            # Retail = explicitly listed retail broker OR local non-whale broker
            is_retail = entry.broker_code in self.retail_brokers
            if not is_retail and not is_whale and entry.investor_type == "Lokal":
                is_retail = True
            # Dynamically-reclassified whales are NOT retail even if on the retail list
            if is_whale:
                is_retail = False

            if not is_retail:
                continue

            if entry.side == "BUY":
                retail_buy_lots += entry.lots or 0
            elif entry.side == "SELL":
                retail_sell_lots += entry.lots or 0

        total_retail = retail_buy_lots + retail_sell_lots
        if total_retail == 0:
            return None

        exit_pct = Decimal(str(retail_sell_lots / total_retail * 100)).quantize(Decimal("0.0001"))
        return exit_pct

    def calculate_retail_participation(self, entries: List[BrokerEntry]) -> Optional[Decimal]:
        """Calculate retail participation as percentage of total volume.

        Formula: retail_total_lots / total_lots * 100
        """
        if not entries:
            return None

        retail_lots = 0
        total_lots = 0

        for entry in entries:
            lots = entry.lots or 0
            total_lots += lots

            is_retail = entry.broker_code in self.retail_brokers
            if not is_retail and not entry.is_whale and entry.investor_type == "Lokal":
                is_retail = True

            if is_retail:
                retail_lots += lots

        if total_lots == 0:
            return None

        return Decimal(str(retail_lots / total_lots * 100)).quantize(Decimal("0.0001"))

    # ─── Door 3: Coordination (Kekompakan) ────────────────────────────

    def calculate_kekompakan(self, entries: List[BrokerEntry], whale_set: set = None) -> Optional[Decimal]:
        """Calculate kekompakan (coordination) score.

        Kekompakan = same-direction whales / total active whales * 100
        High kekompakan = whales are coordinated (strong signal)

        A whale is "active" if it has significant trading in the period.
        We classify whales as net-buyers or net-sellers based on their lots.
        """
        if not entries:
            return None

        # Group whale entries by broker code and determine net direction
        whale_directions = {}  # broker_code -> net_lots (+ = net buy, - = net sell)

        for entry in entries:
            is_whale = (entry.broker_code in whale_set) if whale_set is not None else entry.is_whale
            if not is_whale:
                continue

            broker = entry.broker_code
            lots = entry.lots or 0

            if broker not in whale_directions:
                whale_directions[broker] = 0

            if entry.side == "BUY":
                whale_directions[broker] += lots
            elif entry.side == "SELL":
                whale_directions[broker] -= lots

        # Filter out whales with negligible activity (less than 100 lots net)
        active_whales = {k: v for k, v in whale_directions.items() if abs(v) >= 100}

        if len(active_whales) == 0:
            return None

        # Determine predominant direction (net buy vs net sell)
        total_net = sum(active_whales.values())
        predominant_direction = "BUY" if total_net >= 0 else "SELL"

        # Count whales moving in the same direction as predominant
        if predominant_direction == "BUY":
            same_direction_count = sum(1 for v in active_whales.values() if v > 0)
        else:
            same_direction_count = sum(1 for v in active_whales.values() if v < 0)

        kekompakan = Decimal(str(same_direction_count / len(active_whales) * 100)).quantize(Decimal("0.0001"))
        return kekompakan

    # ─── VPA Signal ───────────────────────────────────────────────────

    async def calculate_vpa_signal(
        self, stock_id: UUID, as_of_date: date
    ) -> Optional[str]:
        """Calculate VPA (Volume Price Analysis) signal from daily prices.

        VPA principles:
        - Rising price + Rising volume = UP_TREND (bullish)
        - Falling price + Rising volume = DOWN_TREND (bearish)
        - Rising price + Falling volume = NEUTRAL (weak buying)
        - Falling price + Falling volume = NEUTRAL (weak selling)
        - High volume on up days = accumulation (bullish)
        - High volume on down days = distribution (bearish)
        """
        # Get last 10 trading days
        result = await self.db.execute(
            select(DailyPrice)
            .where(
                and_(
                    DailyPrice.stock_id == stock_id,
                    DailyPrice.date <= as_of_date,
                )
            )
            .order_by(DailyPrice.date.desc())
            .limit(10)
        )
        prices = list(result.scalars().all())

        if len(prices) < 3:
            return "NEUTRAL"

        # Reverse to chronological order
        prices = list(reversed(prices))

        # Calculate price and volume changes
        recent_half = prices[len(prices) // 2:]  # More recent half
        early_half = prices[:len(prices) // 2]    # Earlier half

        if not early_half or not recent_half:
            return "NEUTRAL"

        # Average prices and volumes for each half
        early_avg_close = sum(float(p.close or 0) for p in early_half) / len(early_half)
        recent_avg_close = sum(float(p.close or 0) for p in recent_half) / len(recent_half)

        early_avg_vol = sum(float(p.volume or 0) for p in early_half) / len(early_half)
        recent_avg_vol = sum(float(p.volume or 0) for p in recent_half) / len(recent_half)

        # Determine direction
        price_up = recent_avg_close > early_avg_close
        volume_up = recent_avg_vol > early_avg_vol * 1.05  # 5% threshold for significance
        volume_down = recent_avg_vol < early_avg_vol * 0.95

        # VPA signal determination
        if price_up and volume_up:
            return "UP_TREND"      # Strong buying with conviction
        elif not price_up and volume_up:
            return "DOWN_TREND"    # Strong selling with conviction
        elif price_up and volume_down:
            return "WEAK_UP"      # Rising on low volume =怀疑 (doubt)
        elif not price_up and volume_down:
            return "WEAK_DOWN"    # Falling on low volume = no selling pressure
        else:
            return "NEUTRAL"

    # ─── Bandar Floor Price ────────────────────────────────────────────

    def calculate_bandar_floor(self, entries: List[BrokerEntry], whale_set: set = None) -> Optional[Decimal]:
        """Calculate bandar floor price = weighted average buy price of whale brokers.

        This is where the whales collectively entered, so if price drops below,
        they are underwater. This is their "floor" or support level.

        Formula: Sum(buy_avg_price * buy_lots) / Sum(buy_lots) for whale BUY entries only
        """
        if not entries:
            return None

        weighted_sum = Decimal("0")
        total_lots = 0

        for entry in entries:
            is_whale = (entry.broker_code in whale_set) if whale_set is not None else entry.is_whale
            if not is_whale or entry.side != "BUY":
                continue

            avg_price = entry.avg_price or Decimal("0")
            lots = entry.lots or 0

            if lots <= 0 or avg_price <= 0:
                continue

            weighted_sum += avg_price * Decimal(str(lots))
            total_lots += lots

        if total_lots == 0:
            return None

        return (weighted_sum / Decimal(str(total_lots))).quantize(Decimal("0.01"))

    # ─── Top Whale Brokers ────────────────────────────────────────────

    def calculate_top_whale_brokers(self, entries: List[BrokerEntry], whale_set: set = None) -> Optional[list]:
        """Get top 3 whale brokers sorted by net buy lots (accumulation).

        Returns list of dicts: [{"code": "BK", "lots": 209000, "value": 24500000000, "side": "BUY"}, ...]
        Shows which smart money brokers are accumulating and how much.
        """
        if not entries:
            return None

        # Group whale brokers by code and calculate net position
        whale_positions = {}  # broker_code -> {"code": str, "lots": int, "value": Decimal, "side": str}
        for entry in entries:
            is_whale = (entry.broker_code in whale_set) if whale_set is not None else entry.is_whale
            if not is_whale:
                continue

            broker = entry.broker_code
            lots = entry.lots or 0
            value = entry.value or Decimal("0")

            if broker not in whale_positions:
                whale_positions[broker] = {
                    "code": broker,
                    "buy_lots": 0,
                    "sell_lots": 0,
                    "buy_value": Decimal("0"),
                    "sell_value": Decimal("0"),
                }

            if entry.side == "BUY":
                whale_positions[broker]["buy_lots"] += lots
                whale_positions[broker]["buy_value"] += value
            elif entry.side == "SELL":
                whale_positions[broker]["sell_lots"] += lots
                whale_positions[broker]["sell_value"] += value

        # Calculate net position and sort by net buy lots descending
        broker_list = []
        for code, pos in whale_positions.items():
            net_lots = pos["buy_lots"] - pos["sell_lots"]
            # Only include brokers with significant activity (>= 100 lots net)
            if abs(net_lots) >= 100:
                broker_list.append({
                    "code": code,
                    "net_lots": net_lots,
                    "buy_lots": pos["buy_lots"],
                    "sell_lots": pos["sell_lots"],
                    "buy_value": float(pos["buy_value"]),
                    "sell_value": float(pos["sell_value"]),
                    "side": "BUY" if net_lots > 0 else "SELL",
                })

        # Sort by absolute net lots descending (biggest players first)
        broker_list.sort(key=lambda x: abs(x["net_lots"]), reverse=True)

        # Take top 3
        top_3 = broker_list[:3]

        # Format for output
        return [
            {
                "code": b["code"],
                "lots": b["net_lots"],
                "value": round(b["buy_value"] if b["side"] == "BUY" else b["sell_value"], 0),
                "side": b["side"],
            }
            for b in top_3
        ] if top_3 else None

    # ─── Overall Signal Calculation ────────────────────────────────────

    def calculate_overall_signal(
        self,
        whale_net_lots: Optional[int] = None,
        retail_exit_pct: Optional[Decimal] = None,
        kekompakan_score: Optional[Decimal] = None,
        vpa_signal: Optional[str] = None,
        api_accumulation_score: Optional[Decimal] = None,
        api_distribution_score: Optional[Decimal] = None,
    ) -> Tuple[str, int]:
        """Calculate overall signal and confidence.

        Weights: whale_net 40% + retail_exit 30% + VPA 20% + kekompakan 10%
        api_accumulation is a cross-check only (not scored), same for api_distribution.

        Whale normalization uses log10 scale so large-lot stocks (BIPI 1.7M)
        and small-lot stocks (BUVA 5K) are treated equivalently.
        """
        import math

        components: list[tuple[float, float]] = []  # (score 0-100, weight)

        # 1. Whale Net Lots (40%) — log10 scale, baseline 1K lots
        if whale_net_lots is not None:
            if whale_net_lots == 0:
                w_score = 50.0
            else:
                magnitude = min(50.0, 25.0 * math.log10(max(1, abs(whale_net_lots)) / 1000 + 1))
                w_score = 50.0 + magnitude if whale_net_lots > 0 else 50.0 - magnitude
            components.append((w_score, 40.0))

        # 2. Retail Exit % (30%) — direct 0-100 scale (% already in range)
        if retail_exit_pct is not None:
            components.append((float(retail_exit_pct), 30.0))

        # 3. VPA Signal (20%)
        if vpa_signal is not None:
            vpa_map = {
                "UP_TREND": 88.0,
                "WEAK_UP":  62.0,
                "NEUTRAL":  50.0,
                "WEAK_DOWN": 38.0,
                "DOWN_TREND": 12.0,
            }
            components.append((vpa_map.get(vpa_signal, 50.0), 20.0))

        # 4. Kekompakan (10%) — modulates confidence in whale direction
        if kekompakan_score is not None:
            components.append((float(kekompakan_score), 10.0))

        if not components:
            return "WAIT", 0

        total_w = sum(w for _, w in components)
        weighted_score = sum(s * w for s, w in components) / total_w

        # Confidence = how many of the 4 metrics we have, scaled to 100
        confidence_score = int((len(components) / 4.0) * 100)

        # Map score to signal
        if weighted_score >= 78:
            signal = "STRONG_BUY"
        elif weighted_score >= 63:
            signal = "BUY"
        elif weighted_score >= 54:
            signal = "WATCH"
        elif weighted_score >= 46:
            signal = "WAIT"
        elif weighted_score >= 32:
            signal = "SELL"
        else:
            signal = "STRONG_SELL"

        # Cross-checks (override, not scored)
        if api_distribution_score is not None and float(api_distribution_score) > 7.0:
            if signal in ("STRONG_BUY", "BUY", "WATCH"):
                signal = "WAIT"

        if api_accumulation_score is not None and float(api_accumulation_score) > 7.0:
            if signal == "SELL":
                signal = "WATCH"

        return signal, min(confidence_score, 100)

    # ─── Helper Calculations ──────────────────────────────────────────

    async def calculate_price_change(
        self, stock_id: UUID, week_start: date, week_end: date
    ) -> Optional[Decimal]:
        """Calculate price change percentage over the week."""
        result = await self.db.execute(
            select(DailyPrice.close)
            .where(
                and_(
                    DailyPrice.stock_id == stock_id,
                    DailyPrice.date >= week_start,
                    DailyPrice.date <= week_end,
                )
            )
            .order_by(DailyPrice.date.asc())
        )
        closes = [row[0] for row in result.all()]

        if len(closes) < 2:
            return None

        first_close = float(closes[0])
        last_close = float(closes[-1])

        if first_close == 0:
            return None

        change_pct = Decimal(str(
            ((last_close - first_close) / first_close) * 100
        )).quantize(Decimal("0.0001"))
        return change_pct

    async def calculate_volume_change(
        self, stock_id: UUID, week_start: date, week_end: date
    ) -> Optional[Decimal]:
        """Calculate volume change percentage vs prior week."""
        # Current week volume
        current_result = await self.db.execute(
            select(func.avg(DailyPrice.volume))
            .where(
                and_(
                    DailyPrice.stock_id == stock_id,
                    DailyPrice.date >= week_start,
                    DailyPrice.date <= week_end,
                )
            )
        )
        current_vol = current_result.scalar()

        # Prior week volume
        prior_start = week_start - timedelta(days=7)
        prior_end = week_start - timedelta(days=1)
        prior_result = await self.db.execute(
            select(func.avg(DailyPrice.volume))
            .where(
                and_(
                    DailyPrice.stock_id == stock_id,
                    DailyPrice.date >= prior_start,
                    DailyPrice.date <= prior_end,
                )
            )
        )
        prior_vol = prior_result.scalar()

        if not current_vol or not prior_vol or float(prior_vol) == 0:
            return None

        change_pct = Decimal(str(
            ((float(current_vol) - float(prior_vol)) / float(prior_vol)) * 100
        )).quantize(Decimal("0.0001"))
        return change_pct

    async def _get_latest_close(self, stock_id: UUID) -> Optional[Decimal]:
        """Get the latest closing price for a stock."""
        result = await self.db.execute(
            select(DailyPrice.close)
            .where(DailyPrice.stock_id == stock_id)
            .order_by(DailyPrice.date.desc())
            .limit(1)
        )
        row = result.first()
        return row[0] if row else None

    # ─── Batch Calculations ────────────────────────────────────────────

    async def calculate_all_watchlist(self, week_start: date, week_end: date) -> List[WeeklyMetric]:
        """Calculate metrics for all watchlist stocks."""
        results = []

        for ticker in settings.watchlist_list:
            stock_result = await self.db.execute(
                select(Stock).where(Stock.ticker == ticker)
            )
            stock = stock_result.scalar_one_or_none()
            if not stock:
                logger.warning(f"Stock {ticker} not found in DB, skipping calculation")
                continue

            metric = await self.calculate_weekly_metrics(stock.id, week_start, week_end)
            if metric:
                results.append(metric)

        await self.db.commit()
        return results