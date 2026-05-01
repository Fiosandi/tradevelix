"""Sync Service - Calls Market Reaper API on schedule and stores data locally.

Core principle: Bulk Sync → Local DB → Internal Calculation
API is called ONLY by scheduled jobs (never on user request).

Rate limits:
- 2-second delay between API calls
- ~900 calls/month max (leave buffer from 1000)
- 100 calls/day max
"""

import logging
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import List, Optional
from uuid import UUID, uuid4

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.config import settings
from app.clients.market_reaper import api_client, RateLimitExceeded
from app.database import async_session
from app.models.stock import Stock
from app.models.broker import Broker
from app.models.sector import Sector
from app.models.daily_price import DailyPrice
from app.models.broker_summary import BrokerSummary, BrokerEntry
from app.models.api_signal import ApiSignal
from app.models.major_holder import MajorHolderMovement
from app.models.system import SyncLog, ApiRawResponse

logger = logging.getLogger(__name__)


class SyncService:
    """Service for syncing data from Market Reaper API to local PostgreSQL.

    All API calls happen here, never on user request.
    Every API response is stored raw in api_raw_responses before parsing.
    All sync runs are tracked in sync_logs.
    """

    def __init__(self, db: AsyncSession):
        self.db = db
        self.api = api_client
        self.watchlist = settings.watchlist_list
        self.whale_brokers = set(settings.whale_brokers_list)
        self.retail_brokers = set(settings.retail_brokers_list)

    # ─── Helper Methods ──────────────────────────────────────────────

    async def _get_or_create_stock(self, ticker: str) -> Stock:
        """Get a stock by ticker, creating a placeholder if it doesn't exist."""
        result = await self.db.execute(
            select(Stock).where(Stock.ticker == ticker)
        )
        stock = result.scalar_one_or_none()
        if stock:
            return stock

        stock = Stock(ticker=ticker, name=ticker, is_active=True)
        self.db.add(stock)
        await self.db.flush()
        logger.info(f"Created new stock entry for {ticker}")
        return stock

    async def _create_sync_log(self, sync_type: str) -> SyncLog:
        """Create a new sync log entry with PENDING status."""
        sync_log = SyncLog(
            id=uuid4(),
            sync_type=sync_type,
            status="PENDING",
            started_at=datetime.utcnow(),
            api_calls_used=0,
            records_synced=0,
        )
        self.db.add(sync_log)
        await self.db.flush()
        return sync_log

    async def _complete_sync_log(
        self,
        sync_log: SyncLog,
        records_synced: int,
        api_calls_used: int,
        status: str = "SUCCESS",
        error_message: str = None,
    ):
        """Complete a sync log entry."""
        sync_log.completed_at = datetime.utcnow()
        sync_log.records_synced = records_synced
        sync_log.api_calls_used = api_calls_used
        sync_log.status = status
        sync_log.error_message = error_message
        await self.db.flush()

    def _classify_broker(self, code: str) -> str:
        """Classify a broker as WHALE, RETAIL, or MIXED."""
        if code in self.whale_brokers:
            return "WHALE"
        elif code in self.retail_brokers:
            return "RETAIL"
        return "MIXED"

    def _is_whale(self, code: str) -> bool:
        """Check if a broker code is classified as whale."""
        return code in self.whale_brokers

    # ─── Daily Sync ───────────────────────────────────────────────────

    async def sync_daily_prices(self, limit: int = 30) -> SyncLog:
        """Sync OHLCV data for all watchlist stocks.

        Args:
            limit: number of trading days to fetch per stock.
                   30 = ~1 month (default daily sync)
                   120 = ~4 months (historical backfill)
                   252 = ~1 year
        Source: RapidAPI /api/chart/{symbol}/daily/latest — this endpoint IS in
        the current plan tier and works fine (24 calls/day, well under quota).

        Note: yfinance_client (app/clients/yfinance_client.py) is wired and
        ready as a free alternative, but Yahoo Finance rate-limits the VPS IP
        (HTTP 429). To switch over, route the yfinance session through a
        proxy or move to a residential IP.
        """
        sync_log = await self._create_sync_log("DAILY_PRICES")
        records_synced = 0
        api_calls_used = 0
        errors = []

        # Sync OHLCV for each watchlist stock
        for ticker in self.watchlist:
            try:
                response = await self.api.get_daily_prices(ticker, limit=limit)
                api_calls_used += 1

                if not response.get("success"):
                    errors.append(f"{ticker}: API returned unsuccessful")
                    continue

                # Parse chartbit array
                # Response structure: { "success": true, "data": { "data": { "chartbit": [...] } } }
                data = response.get("data", {})
                # Handle both nested data.data and flat data structures
                if "data" in data and isinstance(data["data"], dict):
                    chartbit = data["data"].get("chartbit", [])
                else:
                    chartbit = data.get("chartbit", [])
                if not chartbit:
                    logger.warning(f"No chartbit data for {ticker}")
                    continue

                stock = await self._get_or_create_stock(ticker)

                for candle in chartbit:
                    try:
                        candle_date = candle.get("date")
                        if not candle_date:
                            continue

                        # Handle date format - might be string
                        if isinstance(candle_date, str):
                            candle_date = date.fromisoformat(candle_date)

                        # Upsert daily price
                        stmt = pg_insert(DailyPrice).values(
                            id=uuid4(),
                            stock_id=stock.id,
                            date=candle_date,
                            open=candle.get("open"),
                            high=candle.get("high"),
                            low=candle.get("low"),
                            close=candle.get("close"),
                            volume=candle.get("volume"),
                            value=candle.get("value"),
                            foreign_buy=candle.get("foreignbuy"),
                            foreign_sell=candle.get("foreignsell"),
                            foreign_flow=candle.get("foreignflow"),
                            frequency=candle.get("frequency"),
                            shares_outstanding=candle.get("shareoutstanding"),
                        )
                        stmt = stmt.on_conflict_do_update(
                            constraint="uq_daily_price_stock_date",
                            set_={
                                "open": stmt.excluded.open,
                                "high": stmt.excluded.high,
                                "low": stmt.excluded.low,
                                "close": stmt.excluded.close,
                                "volume": stmt.excluded.volume,
                                "value": stmt.excluded.value,
                                "foreign_buy": stmt.excluded.foreign_buy,
                                "foreign_sell": stmt.excluded.foreign_sell,
                                "foreign_flow": stmt.excluded.foreign_flow,
                                "frequency": stmt.excluded.frequency,
                                "shares_outstanding": stmt.excluded.shares_outstanding,
                            },
                        )
                        await self.db.execute(stmt)
                        records_synced += 1
                    except Exception as e:
                        logger.warning(f"Error parsing candle for {ticker} on {candle.get('date')}: {e}")
                        continue

                # Update stock last_synced
                stock.last_synced = datetime.utcnow()
                await self.db.flush()

                logger.info(f"Synced {len(chartbit)} candles for {ticker}")

            except RateLimitExceeded as e:
                errors.append(f"Rate limit exceeded: {e}")
                break
            except Exception as e:
                errors.append(f"{ticker}: {str(e)}")
                logger.error(f"Error syncing daily prices for {ticker}: {e}")
                continue

        # Sync trending and movers (if budget allows)
        try:
            movers_calls = await self._sync_movers_trending_internal()
            api_calls_used += movers_calls
        except Exception as e:
            errors.append(f"Movers sync error: {e}")

        await self._complete_sync_log(
            sync_log,
            records_synced=records_synced,
            api_calls_used=api_calls_used,
            status="PARTIAL" if errors else "SUCCESS",
            error_message="; ".join(errors) if errors else None,
        )
        await self.db.commit()

        logger.info(
            f"Daily sync complete: {records_synced} records, "
            f"{api_calls_used} API calls, status={sync_log.status}"
        )
        return sync_log

    async def _sync_movers_trending_internal(self) -> int:
        """Sync trending and movers data. Returns number of API calls used.
        Data is stored in api_raw_responses by the client."""
        calls = 0

        # Trending
        try:
            await self.api.get_trending()
            calls += 1
        except Exception as e:
            logger.warning(f"Failed to sync trending: {e}")

        # Movers (4 types)
        for mover_type in ["top-gainer", "top-loser", "top-volume", "net-foreign-buy"]:
            try:
                await self.api.get_movers(mover_type)
                calls += 1
            except Exception as e:
                logger.warning(f"Failed to sync movers/{mover_type}: {e}")

        return calls

    async def sync_movers_trending(self) -> SyncLog:
        """Sync trending stocks and top movers. ~5 calls.
        Data stored in api_raw_responses for later processing."""
        sync_log = await self._create_sync_log("MOVERS_TRENDING")
        api_calls_used = 0
        errors = []

        try:
            api_calls_used = await self._sync_movers_trending_internal()
        except Exception as e:
            errors.append(str(e))

        await self._complete_sync_log(
            sync_log,
            records_synced=api_calls_used,  # Each call = 1 record stored
            api_calls_used=api_calls_used,
            status="PARTIAL" if errors else "SUCCESS",
            error_message="; ".join(errors) if errors else None,
        )
        await self.db.commit()
        return sync_log

    # ─── Weekly Sync ──────────────────────────────────────────────────

    async def sync_weekly_broker_summary(self) -> SyncLog:
        """Sync broker summary for all watchlist stocks. ~12-19 calls.

        Source: /api/market-detector/broker-summary/{symbol}?from=X&to=Y
        Parses response.data.data.broker_summary.brokers_buy/sell into
        broker_summaries + broker_entries tables.
        Also parses bandar_detector summary data.
        """
        sync_log = await self._create_sync_log("WEEKLY_BROKER")
        records_synced = 0
        api_calls_used = 0
        errors = []

        # Three Doors analysis is behavioural — it captures WHO changed their pattern
        # (dominant broker accumulation/distribution) over a meaningful period, NOT
        # a fixed calendar week. YTD (Jan 1 → last settled Friday) shows the current
        # year's accumulation cycle clearly.
        #
        # API constraint: the CURRENT trading week always returns inflated/unsettled data
        # regardless of to_date. Must use a Friday that is ≥2 days in the past.
        today = date.today()
        weekday = today.weekday()          # 0=Mon … 4=Fri … 5=Sat … 6=Sun
        days_since_friday = (weekday - 4) % 7   # 0 on Fri, 1 on Sat, 2 on Sun
        # Ensure we're at least 2 days past Friday (settled trades)
        if days_since_friday < 2:
            days_since_friday += 7
        to_date   = today - timedelta(days=days_since_friday)  # last settled Friday
        from_date = date(to_date.year, 1, 1)                   # Jan 1 = YTD

        for ticker in self.watchlist:
            try:
                response = await self.api.get_broker_summary(
                    ticker,
                    from_date=from_date.isoformat(),
                    to_date=to_date.isoformat(),  # last completed trading day (never weekend)
                )
                api_calls_used += 1

                if not response.get("success"):
                    errors.append(f"{ticker}: API returned unsuccessful")
                    continue

                # Parse response - note nested structure: data.data
                outer_data = response.get("data", {})
                inner_data = outer_data.get("data", outer_data)  # Handle both nesting levels

                bandar_detector = inner_data.get("bandar_detector", {})
                broker_summary_data = inner_data.get("broker_summary", {})
                resp_from = inner_data.get("from", from_date.isoformat())
                resp_to = inner_data.get("to", today.isoformat())

                # Ensure stock exists
                stock = await self._get_or_create_stock(ticker)

                # Parse date range
                if isinstance(resp_from, str):
                    date_from = date.fromisoformat(resp_from)
                else:
                    date_from = from_date
                if isinstance(resp_to, str):
                    date_to = date.fromisoformat(resp_to)
                else:
                    date_to = today

                range_days = (date_to - date_from).days

                # Parse bandar_detector average data
                avg_data = bandar_detector.get("avg", {})

                # Delete existing summary for this stock+date range
                existing = await self.db.execute(
                    select(BrokerSummary).where(
                        BrokerSummary.stock_id == stock.id,
                        BrokerSummary.date_from == date_from,
                        BrokerSummary.date_to == date_to,
                    )
                )
                existing_summary = existing.scalar_one_or_none()
                if existing_summary:
                    await self.db.delete(existing_summary)
                    await self.db.flush()

                # Create BrokerSummary
                summary = BrokerSummary(
                    id=uuid4(),
                    stock_id=stock.id,
                    date_from=date_from,
                    date_to=date_to,
                    range_days=range_days,
                    avg_price=bandar_detector.get("average"),
                    avg_accdist=avg_data.get("accdist"),
                    avg_amount=avg_data.get("amount"),
                    avg_percent=avg_data.get("percent"),
                    avg_vol=avg_data.get("vol"),
                    broker_accdist=bandar_detector.get("broker_accdist"),
                    total_buyer=bandar_detector.get("total_buyer"),
                    total_seller=bandar_detector.get("total_seller"),
                )
                self.db.add(summary)
                await self.db.flush()
                records_synced += 1

                # Parse brokers_buy
                brokers_buy = broker_summary_data.get("brokers_buy", [])
                for entry_data in brokers_buy:
                    broker_code = entry_data.get("netbs_broker_code", "")
                    entry = BrokerEntry(
                        id=uuid4(),
                        summary_id=summary.id,
                        broker_code=broker_code,
                        side="BUY",
                        investor_type=entry_data.get("type"),
                        is_whale=self._is_whale(broker_code),
                        lots=int(entry_data.get("blot", 0) or 0),
                        value=Decimal(str(entry_data.get("bval", 0) or 0)),
                        avg_price=Decimal(str(entry_data.get("netbs_buy_avg_price", 0) or 0)),
                        frequency=int(entry_data.get("freq", 0) or 0) if entry_data.get("freq") else None,
                    )
                    self.db.add(entry)
                    records_synced += 1

                # Parse brokers_sell
                brokers_sell = broker_summary_data.get("brokers_sell", [])
                for entry_data in brokers_sell:
                    broker_code = entry_data.get("netbs_broker_code", "")
                    # slot is negative in API, store absolute value
                    slot_val = entry_data.get("slot", 0) or 0
                    sval_val = entry_data.get("sval", 0) or 0

                    entry = BrokerEntry(
                        id=uuid4(),
                        summary_id=summary.id,
                        broker_code=broker_code,
                        side="SELL",
                        investor_type=entry_data.get("type"),
                        is_whale=self._is_whale(broker_code),
                        lots=abs(int(slot_val)),
                        value=abs(Decimal(str(sval_val))),
                        avg_price=Decimal(str(entry_data.get("netbs_sell_avg_price", 0) or 0)),
                        frequency=int(entry_data.get("freq", 0) or 0) if entry_data.get("freq") else None,
                    )
                    self.db.add(entry)
                    records_synced += 1

                await self.db.flush()
                logger.info(f"Synced broker summary for {ticker}: {len(brokers_buy)} buy, {len(brokers_sell)} sell entries")

            except RateLimitExceeded as e:
                errors.append(f"Rate limit exceeded: {e}")
                break
            except Exception as e:
                errors.append(f"{ticker}: {str(e)}")
                logger.error(f"Error syncing broker summary for {ticker}: {e}")
                continue

        await self._complete_sync_log(
            sync_log,
            records_synced=records_synced,
            api_calls_used=api_calls_used,
            status="PARTIAL" if errors else "SUCCESS",
            error_message="; ".join(errors) if errors else None,
        )
        await self.db.commit()

        logger.info(
            f"Weekly broker sync complete: {records_synced} records, "
            f"{api_calls_used} API calls, status={sync_log.status}"
        )
        return sync_log

    async def sync_weekly_signals(self) -> SyncLog:
        """SKIPPED: the upstream RapidAPI plan does not include the
        /api/analysis/bandar/* endpoints (accumulation, distribution,
        sentiment, smart_money, pump_dump). The api_signals table and
        the calculation engine's cross-check logic remain in place — they
        just operate on empty rows now.

        Kept as a stub so manual triggers from /admin still write a
        SyncLog and the live terminal shows a SKIPPED event.
        """
        sync_log = await self._create_sync_log("WEEKLY_SIGNALS")
        msg = "Skipped: provider plan does not include /analysis/bandar endpoints"
        logger.info(msg)
        await self._complete_sync_log(
            sync_log,
            records_synced=0,
            api_calls_used=0,
            status="SUCCESS",
            error_message=msg,
        )
        await self.db.commit()
        return sync_log

    async def _parse_signal_response(
        self, response: dict, stock_id: UUID, signal_date: date, signal_type: str
    ) -> int:
        """Parse a signal API response into an ApiSignal record. Returns 1 if successful, 0 if not."""
        if not response.get("success"):
            return 0

        data = response.get("data", {})

        # Handle nested data.data structure for some endpoints
        if "data" in data and isinstance(data["data"], dict):
            data = data["data"]

        # Extract common fields with safe defaults
        indicators = data.get("indicators", {})
        entry_zone = data.get("entry_zone", {})

        # For accumulation/distribution: data is at top level
        # For sentiment: data structure may vary
        score = data.get("accumulation_score") or data.get("distribution_score") or data.get("score")
        status = data.get("status") or data.get("sentiment_status") or data.get("trend")
        confidence = data.get("confidence")
        recommendation = data.get("recommendation")
        risk_level = data.get("risk_level")

        # Entry zone
        entry_ideal_price = entry_zone.get("ideal_price") if isinstance(entry_zone, dict) else None
        entry_max_price = entry_zone.get("max_price") if isinstance(entry_zone, dict) else None
        current_price = entry_zone.get("current_price") if isinstance(entry_zone, dict) else None

        # Top brokers
        top_brokers = None
        if indicators and isinstance(indicators, dict):
            broker_concentration = indicators.get("broker_concentration", {})
            if isinstance(broker_concentration, dict):
                top_brokers = broker_concentration.get("top_5_brokers")

        # Upsert signal (unique on stock_id + date + signal_type)
        stmt = pg_insert(ApiSignal).values(
            id=uuid4(),
            stock_id=stock_id,
            date=signal_date,
            signal_type=signal_type,
            score=Decimal(str(score)) if score is not None else None,
            status=str(status) if status else None,
            confidence=int(confidence) if confidence is not None else None,
            recommendation=str(recommendation) if recommendation else None,
            risk_level=str(risk_level) if risk_level else None,
            entry_ideal_price=Decimal(str(entry_ideal_price)) if entry_ideal_price is not None else None,
            entry_max_price=Decimal(str(entry_max_price)) if entry_max_price is not None else None,
            current_price=Decimal(str(current_price)) if current_price is not None else None,
            top_brokers=top_brokers,
            indicators=indicators if indicators else data,
            timeframe_analysis=data.get("timeframe_analysis"),
        )
        stmt = stmt.on_conflict_do_update(
            constraint="uq_api_signal_stock_date_type",
            set_={
                "score": stmt.excluded.score,
                "status": stmt.excluded.status,
                "confidence": stmt.excluded.confidence,
                "recommendation": stmt.excluded.recommendation,
                "risk_level": stmt.excluded.risk_level,
                "entry_ideal_price": stmt.excluded.entry_ideal_price,
                "entry_max_price": stmt.excluded.entry_max_price,
                "current_price": stmt.excluded.current_price,
                "top_brokers": stmt.excluded.top_brokers,
                "indicators": stmt.excluded.indicators,
                "timeframe_analysis": stmt.excluded.timeframe_analysis,
            },
        )
        await self.db.execute(stmt)
        return 1

    # ─── Stock Info Sync ──────────────────────────────────────────────

    async def sync_stock_info(self) -> SyncLog:
        """Sync stock master data for watchlist. ~12-19 calls.

        Source: /api/emiten/{symbol}/info
        Updates stock name, sector, shares outstanding, etc.
        """
        sync_log = await self._create_sync_log("STOCK_INFO")
        records_synced = 0
        api_calls_used = 0
        errors = []

        for ticker in self.watchlist:
            try:
                response = await self.api.get_stock_info(ticker)
                api_calls_used += 1

                if not response.get("success"):
                    errors.append(f"{ticker}: API returned unsuccessful")
                    continue

                data = response.get("data", {})
                # Handle nested data
                if "data" in data and isinstance(data["data"], dict):
                    data = data["data"]

                stock = await self._get_or_create_stock(ticker)

                # Update stock fields
                if data.get("name"):
                    stock.name = data["name"]
                if data.get("sector"):
                    # Try to find or create sector
                    sector_name = data.get("sector")
                    sector_result = await self.db.execute(
                        select(Sector).where(Sector.name == sector_name)
                    )
                    sector = sector_result.scalar_one_or_none()
                    if not sector and sector_name:
                        sector = Sector(name=sector_name)
                        self.db.add(sector)
                        await self.db.flush()
                        stock.sector_id = sector.id
                    elif sector:
                        stock.sector_id = sector.id

                if data.get("subsector"):
                    stock.subsector = data.get("subsector")

                # Share outstanding might be under various keys
                shares = data.get("shares_outstanding") or data.get("shareoutstanding") or data.get("total_shares")
                if shares:
                    stock.shares_outstanding = int(shares) if shares else None

                if data.get("listing_date"):
                    if isinstance(data["listing_date"], str):
                        stock.listing_date = date.fromisoformat(data["listing_date"])
                    elif isinstance(data["listing_date"], date):
                        stock.listing_date = data["listing_date"]

                stock.last_synced = datetime.utcnow()
                records_synced += 1
                await self.db.flush()

                logger.info(f"Updated stock info for {ticker}")

            except Exception as e:
                errors.append(f"{ticker}: {str(e)}")
                logger.error(f"Error syncing stock info for {ticker}: {e}")
                continue

        await self._complete_sync_log(
            sync_log,
            records_synced=records_synced,
            api_calls_used=api_calls_used,
            status="PARTIAL" if errors else "SUCCESS",
            error_message="; ".join(errors) if errors else None,
        )
        await self.db.commit()

        return sync_log

    # ─── Broker Codes Sync ────────────────────────────────────────────

    async def sync_broker_codes(self) -> SyncLog:
        """Sync all broker codes. 1 call.

        Source: /api/main/broker-codes
        Updates broker master table with codes and names.
        """
        sync_log = await self._create_sync_log("BROKER_CODES")
        records_synced = 0
        api_calls_used = 0
        errors = []

        try:
            response = await self.api.get_broker_codes()
            api_calls_used = 1

            if response.get("success"):
                data = response.get("data", {})
                # Broker codes might be a list or dict
                brokers_data = data if isinstance(data, list) else data.get("brokers", data.get("data", []))

                if isinstance(brokers_data, list):
                    for broker_data in brokers_data:
                        if isinstance(broker_data, dict):
                            code = broker_data.get("code") or broker_data.get("broker_code") or broker_data.get("netbs_broker_code", "")
                            name = broker_data.get("name") or broker_data.get("broker_name", "")
                            investor_type = broker_data.get("type", "")
                        else:
                            continue

                        if not code:
                            continue

                        # Determine broker type based on our classification
                        broker_type = self._classify_broker(code)

                        # Upsert broker
                        stmt = pg_insert(Broker).values(
                            id=uuid4(),
                            code=code,
                            name=name,
                            broker_type=broker_type,
                            investor_type=investor_type,
                            source="API",
                            last_synced=datetime.utcnow(),
                        )
                        stmt = stmt.on_conflict_do_update(
                            index_elements=["code"],
                            set_={
                                "name": stmt.excluded.name,
                                "broker_type": stmt.excluded.broker_type,
                                "investor_type": stmt.excluded.investor_type,
                                "source": stmt.excluded.source,
                                "last_synced": stmt.excluded.last_synced,
                            },
                        )
                        await self.db.execute(stmt)
                        records_synced += 1

                elif isinstance(brokers_data, dict):
                    # Sometimes broker data is { "code": "name", ... }
                    for code, name in brokers_data.items():
                        broker_type = self._classify_broker(code)
                        stmt = pg_insert(Broker).values(
                            id=uuid4(),
                            code=code,
                            name=str(name),
                            broker_type=broker_type,
                            source="API",
                            last_synced=datetime.utcnow(),
                        )
                        stmt = stmt.on_conflict_do_update(
                            index_elements=["code"],
                            set_={
                                "name": stmt.excluded.name,
                                "broker_type": stmt.excluded.broker_type,
                                "source": stmt.excluded.source,
                                "last_synced": stmt.excluded.last_synced,
                            },
                        )
                        await self.db.execute(stmt)
                        records_synced += 1

                await self.db.flush()

        except Exception as e:
            errors.append(str(e))
            logger.error(f"Error syncing broker codes: {e}")

        await self._complete_sync_log(
            sync_log,
            records_synced=records_synced,
            api_calls_used=api_calls_used,
            status="PARTIAL" if errors else "SUCCESS",
            error_message="; ".join(errors) if errors else None,
        )
        await self.db.commit()

        return sync_log

    # ─── Sectors Sync ────────────────────────────────────────────────

    async def sync_sectors(self) -> SyncLog:
        """Sync sector data. 1 call.

        Source: /api/sectors
        """
        sync_log = await self._create_sync_log("SECTORS")
        records_synced = 0
        api_calls_used = 0
        errors = []

        try:
            response = await self.api.get_sectors()
            api_calls_used = 1

            if response.get("success"):
                data = response.get("data", {})
                sectors_data = data if isinstance(data, list) else data.get("sectors", data.get("data", []))

                if isinstance(sectors_data, list):
                    for sector_data in sectors_data:
                        if isinstance(sector_data, dict):
                            name = sector_data.get("name") or sector_data.get("sector_name", "")
                            sector_id_api = sector_data.get("id") or sector_data.get("sector_id", "")
                        else:
                            continue

                        if not name:
                            continue

                        if not sector_id_api:
                            # No sector_id_api, just try insert
                            existing = await self.db.execute(
                                select(Sector).where(Sector.name == name)
                            )
                            if not existing.scalar_one_or_none():
                                sector = Sector(name=name, sector_id_api=str(sector_id_api) if sector_id_api else None)
                                self.db.add(sector)
                                records_synced += 1
                        else:
                            stmt = pg_insert(Sector).values(
                                id=uuid4(),
                                name=name,
                                sector_id_api=str(sector_id_api),
                            )
                            stmt = stmt.on_conflict_do_update(
                                index_elements=["sector_id_api"],
                                set_={"name": stmt.excluded.name},
                            )
                            await self.db.execute(stmt)
                            records_synced += 1

                await self.db.flush()

        except Exception as e:
            errors.append(str(e))
            logger.error(f"Error syncing sectors: {e}")

        await self._complete_sync_log(
            sync_log,
            records_synced=records_synced,
            api_calls_used=api_calls_used,
            status="PARTIAL" if errors else "SUCCESS",
            error_message="; ".join(errors) if errors else None,
        )
        await self.db.commit()

        return sync_log

    # ─── Combined Sync Methods ────────────────────────────────────────

    async def sync_broker_history(self, weeks: int = 12) -> SyncLog:
        """Backfill broker summaries for the past N months (one call per month per stock).

        The Market Reaper broker-summary API returns NET CUMULATIVE positions for the
        selected period. Monthly windows give meaningful, stable accumulation data.
        Cost: 24 stocks × months API calls.
        """
        sync_log = await self._create_sync_log("BROKER_HISTORY")
        records_synced = 0
        api_calls_used = 0
        errors = []

        today = date.today()
        # T+2 settlement: API returns inflated/forbidden data for ranges ending
        # within the current trading week. Cap any to_date to today-2d.
        safe_end = today - timedelta(days=2)
        # Use months (not weeks) — one call per month per stock
        months = max(1, weeks // 4)  # convert weeks param to ~months

        for month_offset in range(months):
            # First and last day of each month going back
            target = today.replace(day=1) - timedelta(days=month_offset * 28)
            week_start = target.replace(day=1)
            import calendar
            last_day = calendar.monthrange(target.year, target.month)[1]
            week_end = target.replace(day=last_day)
            if week_end > safe_end:
                if week_start > safe_end:
                    continue
                week_end = safe_end

            for ticker in self.watchlist:
                try:
                    response = await self.api.get_broker_summary(
                        ticker,
                        from_date=week_start.isoformat(),
                        to_date=week_end.isoformat(),
                    )
                    api_calls_used += 1
                    if not response.get("success"):
                        continue

                    outer_data = response.get("data", {})
                    inner_data = outer_data.get("data", outer_data)
                    bandar_detector    = inner_data.get("bandar_detector", {})
                    broker_summary_data = inner_data.get("broker_summary", {})
                    resp_from = inner_data.get("from", week_start.isoformat())
                    resp_to   = inner_data.get("to",   week_end.isoformat())

                    stock = await self._get_or_create_stock(ticker)
                    try:
                        date_from = date.fromisoformat(resp_from)
                        date_to   = date.fromisoformat(resp_to)
                    except Exception:
                        date_from, date_to = week_start, week_end

                    # Delete + re-create (upsert)
                    existing = await self.db.execute(
                        select(BrokerSummary).where(
                            BrokerSummary.stock_id == stock.id,
                            BrokerSummary.date_from == date_from,
                            BrokerSummary.date_to   == date_to,
                        )
                    )
                    existing_summary = existing.scalar_one_or_none()
                    if existing_summary:
                        await self.db.delete(existing_summary)
                        await self.db.flush()

                    avg_data = bandar_detector.get("avg", {})
                    summary = BrokerSummary(
                        id=uuid4(), stock_id=stock.id,
                        date_from=date_from, date_to=date_to,
                        range_days=(date_to - date_from).days,
                        avg_price=bandar_detector.get("average"),
                        avg_accdist=avg_data.get("accdist"),
                        avg_amount=avg_data.get("amount"),
                        avg_percent=avg_data.get("percent"),
                        avg_vol=avg_data.get("vol"),
                        broker_accdist=bandar_detector.get("broker_accdist"),
                        total_buyer=bandar_detector.get("total_buyer"),
                        total_seller=bandar_detector.get("total_seller"),
                    )
                    self.db.add(summary)
                    await self.db.flush()
                    records_synced += 1

                    for ed in broker_summary_data.get("brokers_buy", []):
                        code = ed.get("netbs_broker_code", "")
                        self.db.add(BrokerEntry(
                            id=uuid4(), summary_id=summary.id,
                            broker_code=code, side="BUY",
                            investor_type=ed.get("type"),
                            is_whale=self._is_whale(code),
                            lots=int(ed.get("blot", 0) or 0),
                            value=Decimal(str(ed.get("bval", 0) or 0)),
                            avg_price=Decimal(str(ed.get("netbs_buy_avg_price", 0) or 0)),
                            frequency=int(ed.get("freq", 0)) if ed.get("freq") else None,
                        ))
                        records_synced += 1

                    for ed in broker_summary_data.get("brokers_sell", []):
                        code = ed.get("netbs_broker_code", "")
                        self.db.add(BrokerEntry(
                            id=uuid4(), summary_id=summary.id,
                            broker_code=code, side="SELL",
                            investor_type=ed.get("type"),
                            is_whale=self._is_whale(code),
                            lots=abs(int(ed.get("slot", 0) or 0)),
                            value=abs(Decimal(str(ed.get("sval", 0) or 0))),
                            avg_price=Decimal(str(ed.get("netbs_sell_avg_price", 0) or 0)),
                            frequency=int(ed.get("freq", 0)) if ed.get("freq") else None,
                        ))
                        records_synced += 1

                    await self.db.flush()

                except RateLimitExceeded as e:
                    errors.append(f"Rate limit exceeded: {e}")
                    break
                except Exception as e:
                    errors.append(f"{ticker} m{month_offset}: {e}")
                    continue

        await self._complete_sync_log(
            sync_log,
            records_synced=records_synced,
            api_calls_used=api_calls_used,
            status="PARTIAL" if errors else "SUCCESS",
            error_message="; ".join(errors[:5]) if errors else None,
        )
        await self.db.commit()
        return sync_log

    async def sync_major_holders(self) -> SyncLog:
        """SKIPPED: the upstream RapidAPI plan does not include /api/emiten/insider.

        Phase 4 of the data-source migration will replace this with an IDX
        keterbukaan-informasi (5%+ disclosure) scraper. Until then the
        major_holder_movements table is filled only by KSEI monthly PDF
        uploads.
        """
        from datetime import datetime as dt
        sync_log = SyncLog(
            sync_type="MAJOR_HOLDERS", status="PENDING",
            started_at=dt.utcnow(), api_calls_used=0, records_synced=0,
        )
        self.db.add(sync_log)
        await self.db.flush()

        msg = "Skipped: provider plan does not include /api/emiten/insider; Phase 4 IDX scraper pending"
        logger.info(msg)
        sync_log.status = "SUCCESS"
        sync_log.api_calls_used = 0
        sync_log.records_synced = 0
        sync_log.completed_at = dt.utcnow()
        sync_log.error_message = msg
        await self.db.commit()
        return sync_log

    async def sync_weekly_all(self) -> List[SyncLog]:
        """Run all weekly syncs and then calculations.

        Order matters: broker_summary → signals → calculations
        """
        results = []

        # 1. Broker codes and sectors first (lightweight)
        results.append(await self.sync_broker_codes())
        results.append(await self.sync_sectors())

        # 2. Stock info (medium priority)
        results.append(await self.sync_stock_info())

        # 3. Broker summaries (critical for Three Doors)
        results.append(await self.sync_weekly_broker_summary())

        # 4. API signals (supplementary)
        results.append(await self.sync_weekly_signals())

        # 5. Major holder disclosures (IDX/KSEI)
        results.append(await self.sync_major_holders())

        # 6. Run calculations on the new data
        await self.run_calculations()

        return results

    async def sync_daily_all(self) -> List[SyncLog]:
        """Run all daily syncs."""
        results = []
        results.append(await self.sync_daily_prices(limit=30))
        results.append(await self.sync_movers_trending())
        return results

    async def sync_price_history(self, days: int = 120) -> SyncLog:
        """Backfill price history — fetches more than the standard 30 days.

        Uses 1 API call per stock (limit=days). For 19 stocks:
        - days=120 → ~19 API calls (4 months back)
        - days=252 → ~19 API calls (1 full year back)
        """
        return await self.sync_daily_prices(limit=days)

    async def sync_bulk_historical(self) -> List[SyncLog]:
        """Initial bulk sync - runs all syncs in sequence for fresh setup.
        This will use significant API calls (~80+).
        """
        results = []

        # Set up master data first
        results.append(await self.sync_broker_codes())
        results.append(await self.sync_sectors())
        results.append(await self.sync_stock_info())

        # Then historical data
        results.append(await self.sync_daily_prices())
        results.append(await self.sync_weekly_broker_summary())
        results.append(await self.sync_weekly_signals())

        # Run calculations
        await self.run_calculations()

        return results

    # ─── Calculation Trigger ──────────────────────────────────────────

    async def run_calculations(self):
        """Run calculation engine for all watchlist stocks for the current week."""
        from app.services.calculation_engine import CalculationEngine

        today = date.today()
        week_start = today - timedelta(days=today.weekday())  # Monday of current week
        week_end = week_start + timedelta(days=6)  # Sunday

        for ticker in self.watchlist:
            try:
                # Get stock
                result = await self.db.execute(
                    select(Stock).where(Stock.ticker == ticker)
                )
                stock = result.scalar_one_or_none()
                if not stock:
                    continue

                # Create engine with ticker so it picks up per-stock shareholder whale brokers
                engine = CalculationEngine(self.db, ticker=ticker)
                await engine.calculate_weekly_metrics(stock.id, week_start, week_end)
                logger.info(f"Calculated weekly metrics for {ticker}")
            except Exception as e:
                logger.error(f"Error calculating metrics for {ticker}: {e}")
                continue

        # Generate trade signals for BUY/STRONG_BUY stocks
        await self._generate_trade_signals(week_start, week_end)

        # Evaluate user-defined alerts against the freshly written metrics
        try:
            from app.services.alert_engine import evaluate_all_alerts
            await evaluate_all_alerts(self.db)
        except Exception as e:
            logger.warning(f"Alert evaluation skipped: {e}")

        await self.db.commit()

    async def _generate_trade_signals(self, week_start, week_end):
        """After calculations, create/update TradeSignal for BUY/STRONG_BUY stocks."""
        from app.models.system import TradeSignal
        from app.models.weekly_metric import WeeklyMetric
        from app.models.api_signal import ApiSignal
        from datetime import datetime as dt, timedelta as td

        bullish = {"BUY", "STRONG_BUY"}
        metrics_result = await self.db.execute(
            select(WeeklyMetric, Stock)
            .join(Stock, WeeklyMetric.stock_id == Stock.id)
            .where(WeeklyMetric.week_start == week_start)
            .where(WeeklyMetric.overall_signal.in_(bullish))
        )
        rows = metrics_result.all()

        for metric, stock in rows:
            try:
                # Get current price
                price_result = await self.db.execute(
                    select(DailyPrice.close)
                    .where(DailyPrice.stock_id == stock.id)
                    .order_by(DailyPrice.date.desc())
                    .limit(1)
                )
                current_price = price_result.scalar_one_or_none()
                if not current_price:
                    continue

                cp = float(current_price)
                floor = float(metric.bandar_floor_price) if metric.bandar_floor_price else cp

                # Entry from accumulation API signal if available
                acc_result = await self.db.execute(
                    select(ApiSignal)
                    .where(ApiSignal.stock_id == stock.id)
                    .where(ApiSignal.signal_type == "accumulation")
                    .order_by(ApiSignal.date.desc())
                    .limit(1)
                )
                acc = acc_result.scalar_one_or_none()
                entry = float(acc.entry_ideal_price) if acc and acc.entry_ideal_price else cp
                entry_max = float(acc.entry_max_price) if acc and acc.entry_max_price else cp * 1.02

                stop = min(floor * 0.95, entry * 0.92)  # always below entry
                t1 = entry * 1.12
                t2 = entry * 1.25
                expires = dt.utcnow() + td(days=30)

                wn = metric.whale_net_lots or 0
                bullets = [
                    f"Whale Net: {wn:+,} lots",
                    f"Retail Exit: {float(metric.retail_exit_percent or 0):.1f}%",
                    f"Kekompakan: {float(metric.kekompakan_score or 0):.1f}%",
                    f"VPA: {metric.vpa_signal or 'N/A'}",
                    f"Floor: Rp {float(floor):,.0f}",
                ]
                whale_codes = [b["code"] for b in (metric.top_whale_brokers or [])[:3]]

                # Upsert — one active signal per stock per week
                existing = await self.db.execute(
                    select(TradeSignal)
                    .where(TradeSignal.stock_id == stock.id)
                    .where(TradeSignal.status == "ACTIVE")
                    .order_by(TradeSignal.created_at.desc())
                    .limit(1)
                )
                ts = existing.scalar_one_or_none()
                if ts:
                    ts.entry_price = round(entry, 2)
                    ts.stop_loss = round(stop, 2)
                    ts.target_1 = round(t1, 2)
                    ts.target_2 = round(t2, 2)
                    ts.confidence = metric.confidence_score
                    ts.key_bullets = bullets
                    ts.whale_brokers = whale_codes
                    ts.retail_exit_percent = metric.retail_exit_percent
                    ts.expires_at = expires
                else:
                    self.db.add(TradeSignal(
                        stock_id=stock.id,
                        action=metric.overall_signal,
                        entry_price=round(entry, 2),
                        stop_loss=round(stop, 2),
                        target_1=round(t1, 2),
                        target_2=round(t2, 2),
                        confidence=metric.confidence_score,
                        pattern_type="THREE_DOORS",
                        key_bullets=bullets,
                        whale_brokers=whale_codes,
                        retail_exit_percent=metric.retail_exit_percent,
                        volume_confirmed=bool(metric.vpa_signal and "UP" in (metric.vpa_signal or "")),
                        status="ACTIVE",
                        expires_at=expires,
                    ))
            except Exception as e:
                logger.error(f"Error generating trade signal for {stock.ticker}: {e}")

        await self.db.flush()

    # ─── Status & Utility ─────────────────────────────────────────────

    @staticmethod
    async def get_last_syncs(db: AsyncSession, limit: int = 10) -> list:
        """Get the last N sync log entries."""
        result = await db.execute(
            select(SyncLog)
            .order_by(SyncLog.started_at.desc())
            .limit(limit)
        )
        return list(result.scalars().all())

    @staticmethod
    async def get_api_usage(db: AsyncSession) -> dict:
        """Get API usage statistics."""
        # Get current month's sync logs
        now = datetime.utcnow()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        result = await db.execute(
            select(func.sum(SyncLog.api_calls_used), func.count(SyncLog.id))
            .where(SyncLog.started_at >= month_start)
        )
        total_calls, total_syncs = result.one()

        stats = api_client.usage_stats
        per_key = stats.get("per_key", [])

        # Prefer the upstream rate-limit-header truth across keys when at least
        # one key has been observed; fall back to sync_logs aggregation otherwise.
        any_observed = any(p.get("header_observed") for p in per_key)
        if any_observed:
            monthly_calls_used = stats.get("monthly_calls", total_calls or 0)
            effective_limit = stats.get("monthly_limit", settings.API_MONTHLY_CALL_LIMIT * len(per_key))
        else:
            monthly_calls_used = total_calls or 0
            effective_limit = settings.API_MONTHLY_CALL_LIMIT * max(1, len(per_key))

        return {
            "monthly_calls_used": monthly_calls_used,
            "monthly_limit": effective_limit,
            "monthly_remaining": max(0, effective_limit - monthly_calls_used),
            "total_syncs_this_month": total_syncs or 0,
            "plan": settings.API_PLAN,
            "active_key": stats.get("active_key"),
            "per_key": per_key,
            "client_stats": stats,
        }


async def run_sync_background(sync_type: str):
    """Run a sync in the background with its own database session.

    This is the entry point for background tasks triggered from API endpoints.
    """
    from app.services import event_bus
    event_bus.emit("sync_start", sync_type=sync_type)
    async with async_session() as db:
        service = SyncService(db)
        try:
            if sync_type == "daily":
                await service.sync_daily_all()
            elif sync_type == "weekly":
                await service.sync_weekly_all()
            elif sync_type == "bulk":
                await service.sync_bulk_historical()
            elif sync_type == "daily_prices":
                await service.sync_daily_prices()
            elif sync_type == "broker_summary":
                await service.sync_weekly_broker_summary()
            elif sync_type == "signals":
                await service.sync_weekly_signals()
            elif sync_type == "stock_info":
                await service.sync_stock_info()
            elif sync_type == "broker_codes":
                await service.sync_broker_codes()
            elif sync_type == "sectors":
                await service.sync_sectors()
            elif sync_type == "movers_trending":
                await service.sync_movers_trending()
            elif sync_type == "major_holders":
                await service.sync_major_holders()
            elif sync_type.startswith("broker_history_"):
                weeks = int(sync_type.split("_")[-1])
                await service.sync_broker_history(weeks=weeks)
            elif sync_type.startswith("price_history_"):
                # e.g. "price_history_120" for 120 days
                days = int(sync_type.split("_")[-1])
                await service.sync_price_history(days=days)
            else:
                logger.error(f"Unknown sync type: {sync_type}")
                event_bus.emit("sync_complete", sync_type=sync_type, status="FAILED", message=f"unknown sync type: {sync_type}")
                return
            event_bus.emit("sync_complete", sync_type=sync_type, status="SUCCESS")
        except Exception as e:
            logger.error(f"Background sync failed ({sync_type}): {e}", exc_info=True)
            event_bus.emit("sync_complete", sync_type=sync_type, status="FAILED", message=str(e)[:200])