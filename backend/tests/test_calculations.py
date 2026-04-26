"""
Suite 1 — Calculation Engine Unit Tests
Covers: classify_whales_dynamic, whale_net, retail_exit, kekompakan,
        bandar_floor, overall_signal, VPA signal
"""

import pytest
import asyncio
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock


# ─── Fixtures ─────────────────────────────────────────────────────────────────

def make_entry(code, side, lots, freq=100, value=None, investor_type="Lokal"):
    """Build a mock BrokerEntry."""
    e = MagicMock()
    e.broker_code   = code
    e.side          = side
    e.lots          = lots
    e.frequency     = freq
    e.value         = Decimal(str(value if value is not None else lots * 3600))
    e.avg_price     = Decimal("3600")
    e.investor_type = investor_type
    e.is_whale      = code in {"AI", "BK", "YU", "BB", "AS", "SS", "CS"}
    return e


def make_engine():
    """Create a CalculationEngine with a mock async session."""
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
    from app.services.calculation_engine import CalculationEngine
    db = AsyncMock()
    return CalculationEngine(db)


# ─── CALC-01 to CALC-04: classify_whales_dynamic ──────────────────────────────

class TestClassifyWhalesDynamic:

    def test_known_whale_always_included(self):
        """CALC-01: BK is a known whale — always in result regardless of volume."""
        eng = make_engine()
        entries = [make_entry("BK", "BUY", 100, freq=5)]
        result = eng.classify_whales_dynamic(entries)
        assert "BK" in result

    def test_retail_broker_reclassified_illiquid(self):
        """CALC-02: XL with Rp 300M value, 8 transactions → reclassified as whale (BUVA-like)."""
        eng = make_engine()
        # 5000 lots * 3600 = 18M per lot... let's set value explicitly to 300M
        # 300M / 8 transactions = 37.5M per tx, lot/tx = 5000/8 = 625
        entries = [
            make_entry("BK", "BUY", 12000, freq=400, value=43_200_000_000),   # known whale
            make_entry("XL", "BUY",  5000, freq=8,   value=300_000_000, investor_type="Lokal"),  # retail → whale
            make_entry("PD", "SELL", 2000, freq=1500, value=50_000_000,  investor_type="Lokal"),  # retail → stays
        ]
        result = eng.classify_whales_dynamic(entries)
        assert "XL" in result, "XL should be reclassified: 300M value, 625 lots/tx"
        assert "PD" not in result, "PD should stay retail: low lot/tx"

    def test_retail_broker_stays_retail_liquid(self):
        """CALC-03: XL with Rp 12B value but 4765 transactions (INDY-like) → stays retail."""
        eng = make_engine()
        entries = [
            make_entry("BK",  "BUY",  54079, freq=1632, value=19_822_136_000),
            make_entry("XL",  "SELL", 33329, freq=4765, value=12_187_930_000, investor_type="Lokal"),
            make_entry("PD",  "SELL", 31980, freq=2106, value=11_611_320_000, investor_type="Lokal"),
        ]
        result = eng.classify_whales_dynamic(entries)
        assert "BK" in result
        assert "XL" not in result, "XL: 12B but 4765 transactions = retail aggregation, not whale"
        assert "PD" not in result, "PD: 11.6B but 2106 transactions = retail, not whale"

    def test_empty_entries_returns_base_set(self):
        """CALC-04: Empty entries → returns the 7 hardcoded whales."""
        eng = make_engine()
        result = eng.classify_whales_dynamic([])
        assert result == {"AI", "BK", "YU", "BB", "AS", "SS", "CS"}

    def test_split_order_accumulator_caught(self):
        """CALC-04b: Tier B catches a retail-listed broker running an algo:
        XL buys 1.5B value over 30 transactions (50 lots/tx), pure BUY,
        accounting for 30% of stock flow → reclassified as whale."""
        eng = make_engine()
        entries = [
            make_entry("BK", "BUY",  10000, freq=200, value=3_500_000_000),  # known whale, 65% flow
            make_entry("XL", "BUY",  1500,  freq=30,  value=1_500_000_000, investor_type="Lokal"),
            make_entry("PD", "SELL", 500,   freq=100, value=350_000_000,   investor_type="Lokal"),
        ]
        result = eng.classify_whales_dynamic(entries)
        assert "XL" in result, "XL: 1.5B value, 50 lots/tx, 27% flow share, 100% buy → whale"
        assert "PD" not in result, "PD: 350M but only 5 lots/tx and small flow → retail"

    def test_market_maker_not_caught_by_tier_b(self):
        """CALC-04c: A broker churning both sides (low conviction) must NOT be
        flagged by Tier B even with high flow share."""
        eng = make_engine()
        entries = [
            make_entry("BK", "BUY",  10000, freq=200, value=3_500_000_000),
            make_entry("XL", "BUY",  1000,  freq=20,  value=1_000_000_000, investor_type="Lokal"),
            make_entry("XL", "SELL", 1100,  freq=22,  value=1_100_000_000, investor_type="Lokal"),
        ]
        result = eng.classify_whales_dynamic(entries)
        # XL net lots: |1000-1100|/(1000+1100) = ~5% conviction, well below 60% → stays retail
        assert "XL" not in result, "XL: churning both sides, conviction <60% → not a whale"


# ─── CALC-05: calculate_whale_net ─────────────────────────────────────────────

class TestCalculateWhaleNet:

    @pytest.mark.asyncio
    async def test_net_positive(self):
        """CALC-05: BK buys 54K, AI sells 22K, net = +32K lots."""
        eng = make_engine()
        entries = [
            make_entry("BK", "BUY",  54079, value=19_822_136_000),
            make_entry("AI", "SELL", 22561, value=8_333_071_000),
        ]
        whale_set = {"BK", "AI"}
        net_lots, net_value, count = await eng.calculate_whale_net(entries, whale_set)
        assert net_lots == 54079 - 22561
        assert net_value > 0
        assert count == 2

    @pytest.mark.asyncio
    async def test_net_negative(self):
        """Whale selling more than buying → negative net."""
        eng = make_engine()
        entries = [
            make_entry("AI", "SELL", 100000),
            make_entry("BK", "BUY",  20000),
        ]
        net_lots, _, _ = await eng.calculate_whale_net(entries, {"AI", "BK"})
        assert net_lots < 0

    @pytest.mark.asyncio
    async def test_non_whales_excluded(self):
        """Non-whale brokers should not count toward whale_net."""
        eng = make_engine()
        entries = [
            make_entry("BK", "BUY", 50000),
            make_entry("XL", "BUY", 99999),   # retail, huge volume — must not count
        ]
        net_lots, _, count = await eng.calculate_whale_net(entries, {"BK"})
        assert net_lots == 50000
        assert count == 1


# ─── CALC-06: calculate_retail_exit ───────────────────────────────────────────

class TestCalculateRetailExit:

    def test_high_exit(self):
        """CALC-06: 700 retail sell, 300 retail buy → 70% exit."""
        eng = make_engine()
        entries = [
            make_entry("YP", "SELL", 700, investor_type="Lokal"),
            make_entry("YP", "BUY",  300, investor_type="Lokal"),
        ]
        result = eng.calculate_retail_exit(entries, {"AI", "BK"})
        assert result is not None
        assert abs(float(result) - 70.0) < 0.1

    def test_dynamic_whale_excluded_from_retail(self):
        """Dynamically reclassified whale broker must NOT count as retail."""
        eng = make_engine()
        entries = [
            make_entry("XL", "SELL", 5000, investor_type="Lokal"),  # reclassified whale
            make_entry("YP", "SELL", 1000, investor_type="Lokal"),  # real retail
            make_entry("YP", "BUY",  500,  investor_type="Lokal"),
        ]
        whale_set = {"AI", "BK", "XL"}  # XL is whale here
        result = eng.calculate_retail_exit(entries, whale_set)
        # Only YP counts: 1000 sell, 500 buy → 66.7%
        assert result is not None
        assert abs(float(result) - 66.7) < 0.5, f"Expected ~66.7%, got {result}"


# ─── CALC-07: calculate_kekompakan ────────────────────────────────────────────

class TestCalculateKekompakan:

    def test_three_buying_one_selling(self):
        """CALC-07: 3 whales buy, 1 sells → 75% kekompakan."""
        eng = make_engine()
        entries = [
            make_entry("BK", "BUY",  50000),
            make_entry("BB", "BUY",  30000),
            make_entry("YU", "BUY",  20000),
            make_entry("AI", "SELL", 10000),
        ]
        whale_set = {"BK", "BB", "YU", "AI"}
        result = eng.calculate_kekompakan(entries, whale_set)
        assert result is not None
        assert abs(float(result) - 75.0) < 0.1

    def test_all_buying(self):
        """All whales buying → 100% kekompakan."""
        eng = make_engine()
        entries = [make_entry(c, "BUY", 10000) for c in ["BK", "BB", "YU", "AI"]]
        result = eng.calculate_kekompakan(entries, {"BK", "BB", "YU", "AI"})
        assert float(result) == 100.0

    def test_empty_entries(self):
        eng = make_engine()
        result = eng.calculate_kekompakan([], {"BK"})
        assert result is None


# ─── CALC-08: calculate_bandar_floor ─────────────────────────────────────────

class TestCalculateBandarFloor:

    def test_weighted_average(self):
        """CALC-08: Weighted avg of whale buy prices."""
        eng = make_engine()
        # BK: 1000 lots @ 1500, AI: 500 lots @ 1600
        # Floor = (1000*1500 + 500*1600) / 1500 = 2300000/1500 ≈ 1533.33
        entries = [
            MagicMock(broker_code="BK", side="BUY", lots=1000, avg_price=Decimal("1500"), value=Decimal("1500000"), is_whale=True),
            MagicMock(broker_code="AI", side="BUY", lots=500,  avg_price=Decimal("1600"), value=Decimal("800000"),  is_whale=True),
            MagicMock(broker_code="BK", side="SELL", lots=200, avg_price=Decimal("1520"), value=Decimal("304000"),  is_whale=True),  # sell side excluded
        ]
        whale_set = {"BK", "AI"}
        result = eng.calculate_bandar_floor(entries, whale_set)
        expected = (1000 * 1500 + 500 * 1600) / 1500
        assert abs(float(result) - expected) < 0.1


# ─── CALC-09 to CALC-10: calculate_overall_signal ────────────────────────────

class TestCalculateOverallSignal:

    def test_strong_buy_conditions(self):
        """CALC-09: High whale net + high retail exit + UP_TREND → STRONG_BUY."""
        eng = make_engine()
        signal, confidence = eng.calculate_overall_signal(
            whale_net_lots=500_000,      # large positive
            retail_exit_pct=Decimal("75"),
            kekompakan_score=Decimal("80"),
            vpa_signal="UP_TREND",
        )
        assert signal in ("STRONG_BUY", "BUY"), f"Expected bullish signal, got {signal}"
        assert confidence > 0

    def test_distribution_override(self):
        """CALC-10: High api_distribution_score forces WAIT even on bullish metrics."""
        eng = make_engine()
        signal, _ = eng.calculate_overall_signal(
            whale_net_lots=100_000,
            retail_exit_pct=Decimal("60"),
            vpa_signal="UP_TREND",
            api_distribution_score=Decimal("8.5"),   # > 7 triggers override
        )
        assert signal == "WAIT", f"Distribution override should force WAIT, got {signal}"

    def test_sell_signal_conditions(self):
        """Negative whale, low retail exit, DOWN_TREND → SELL."""
        eng = make_engine()
        signal, _ = eng.calculate_overall_signal(
            whale_net_lots=-300_000,
            retail_exit_pct=Decimal("15"),
            kekompakan_score=Decimal("20"),
            vpa_signal="DOWN_TREND",
        )
        assert signal in ("SELL", "STRONG_SELL", "WAIT"), f"Expected bearish, got {signal}"

    def test_signal_weights(self):
        """CALC-13: Whale_net (40%) should dominate when very strong."""
        eng = make_engine()
        # Very strong whale buy, neutral everything else
        s1, _ = eng.calculate_overall_signal(
            whale_net_lots=2_000_000,    # huge accumulation
            retail_exit_pct=Decimal("50"),
            vpa_signal="NEUTRAL",
        )
        # Very weak whale buy, neutral everything else
        s2, _ = eng.calculate_overall_signal(
            whale_net_lots=500,          # tiny
            retail_exit_pct=Decimal("50"),
            vpa_signal="NEUTRAL",
        )
        signal_order = {"STRONG_BUY": 0, "BUY": 1, "WATCH": 2, "WAIT": 3, "SELL": 4, "STRONG_SELL": 5}
        assert signal_order[s1] < signal_order[s2], "Strong whale accumulation should produce stronger signal"


# ─── CALC-11 to CALC-12: VPA Signal ──────────────────────────────────────────

class TestVPASignal:

    @pytest.mark.asyncio
    async def test_valid_signal_returned(self):
        """CALC-11: VPA always returns a valid signal string."""
        eng = make_engine()
        from datetime import date, timedelta

        prices = []
        for i in range(14):
            p = MagicMock()
            p.close  = Decimal(str(1000 + i * 20))
            p.volume = 1_000_000 + i * 50_000
            p.date   = date.today() - timedelta(days=13 - i)
            prices.append(p)

        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = prices
        eng.db.execute = AsyncMock(return_value=mock_result)

        from uuid import uuid4
        result = await eng.calculate_vpa_signal(uuid4(), date.today())
        valid_signals = {"UP_TREND", "WEAK_UP", "NEUTRAL", "WEAK_DOWN", "DOWN_TREND"}
        assert result in valid_signals, f"Invalid VPA signal: {result}"

    @pytest.mark.asyncio
    async def test_no_data_returns_neutral(self):
        """CALC-12 edge: No price data → NEUTRAL."""
        eng = make_engine()
        mock_result = MagicMock()
        mock_result.scalars.return_value.all.return_value = []
        eng.db.execute = AsyncMock(return_value=mock_result)

        from uuid import uuid4
        result = await eng.calculate_vpa_signal(uuid4(), __import__("datetime").date.today())
        assert result == "NEUTRAL"
