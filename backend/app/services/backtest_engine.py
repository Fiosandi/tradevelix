"""
Backtest Engine — replays historical Three Doors signals against actual price data.

Methodology:
- Entry: next candle after signal week close (week_end + 1 trading day)
- Stop-loss: bandar_floor_price * 0.95 (5% below floor)
- Target 1: entry_price * 1.12 (+12%)
- Target 2: entry_price * 1.25 (+25%)
- Time-stop: exit at week_end + 28 trading days if neither hit
- Only runs on STRONG_BUY and BUY signals with confidence >= 60%
"""

import logging
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from typing import List, Optional
from uuid import UUID

from sqlalchemy import select, and_, asc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import Stock
from app.models.weekly_metric import WeeklyMetric
from app.models.daily_price import DailyPrice

logger = logging.getLogger(__name__)

BULLISH_SIGNALS = {"STRONG_BUY", "BUY"}


@dataclass
class TradeResult:
    ticker: str
    signal: str
    confidence: int
    week_start: date
    week_end: date
    entry_price: float
    stop_loss: float
    target_1: float
    target_2: float
    exit_price: Optional[float]
    exit_date: Optional[date]
    exit_reason: str          # "TARGET_2", "TARGET_1", "STOP_LOSS", "TIME_STOP", "NO_DATA"
    pnl_pct: float            # percent gain/loss
    whale_net_lots: int
    retail_exit_pct: float
    kekompakan: float
    bandar_floor: float


@dataclass
class BacktestSummary:
    ticker: Optional[str]        # None = all stocks
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float              # %
    avg_gain_pct: float
    avg_loss_pct: float
    avg_return_pct: float
    best_trade_pct: float
    worst_trade_pct: float
    t1_hit_rate: float           # % of trades hitting target 1
    t2_hit_rate: float           # % of trades hitting target 2
    stop_hit_rate: float
    time_stop_rate: float
    trades: List[TradeResult] = field(default_factory=list)


class BacktestEngine:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def run(
        self,
        ticker: Optional[str] = None,
        from_date: Optional[date] = None,
        min_confidence: int = 60,
    ) -> BacktestSummary:
        """Run backtest for one ticker or all watchlist stocks."""

        # Fetch weekly metrics
        q = select(WeeklyMetric, Stock).join(Stock, WeeklyMetric.stock_id == Stock.id)

        if ticker:
            q = q.where(Stock.ticker == ticker.upper())

        if from_date:
            q = q.where(WeeklyMetric.week_end >= from_date)

        q = q.where(WeeklyMetric.overall_signal.in_(BULLISH_SIGNALS))
        q = q.where(WeeklyMetric.confidence_score >= min_confidence)
        q = q.order_by(asc(WeeklyMetric.week_end))

        result = await self.db.execute(q)
        rows = result.all()

        trades: List[TradeResult] = []

        for metric, stock in rows:
            trade = await self._simulate_trade(metric, stock)
            if trade:
                trades.append(trade)

        return self._summarize(ticker, trades)

    async def _simulate_trade(self, metric: WeeklyMetric, stock: Stock) -> Optional[TradeResult]:
        """Simulate one trade from a weekly signal."""
        if not metric.bandar_floor_price or not metric.week_end:
            return None

        floor = float(metric.bandar_floor_price)
        entry_date = metric.week_end + timedelta(days=1)
        exit_deadline = entry_date + timedelta(days=35)

        # Fetch daily prices from entry onwards
        prices_result = await self.db.execute(
            select(DailyPrice)
            .where(and_(
                DailyPrice.stock_id == stock.id,
                DailyPrice.date >= entry_date,
                DailyPrice.date <= exit_deadline,
            ))
            .order_by(asc(DailyPrice.date))
        )
        prices = list(prices_result.scalars().all())

        if not prices:
            return TradeResult(
                ticker=stock.ticker,
                signal=metric.overall_signal,
                confidence=metric.confidence_score or 0,
                week_start=metric.week_start,
                week_end=metric.week_end,
                entry_price=0,
                stop_loss=floor * 0.95,
                target_1=0,
                target_2=0,
                exit_price=None,
                exit_date=None,
                exit_reason="NO_DATA",
                pnl_pct=0,
                whale_net_lots=metric.whale_net_lots or 0,
                retail_exit_pct=float(metric.retail_exit_percent or 0),
                kekompakan=float(metric.kekompakan_score or 0),
                bandar_floor=floor,
            )

        # Entry at open of first available candle after week_end
        entry_price = float(prices[0].open or prices[0].close)
        stop_loss   = floor * 0.95
        target_1    = entry_price * 1.12
        target_2    = entry_price * 1.25

        exit_price  = None
        exit_date   = None
        exit_reason = "TIME_STOP"

        for p in prices[1:]:  # start checking from second candle
            low  = float(p.low  or p.close)
            high = float(p.high or p.close)

            # Check stop-loss first (worst case in the day)
            if low <= stop_loss:
                exit_price  = stop_loss
                exit_date   = p.date
                exit_reason = "STOP_LOSS"
                break

            # Check targets (best case)
            if high >= target_2:
                exit_price  = target_2
                exit_date   = p.date
                exit_reason = "TARGET_2"
                break

            if high >= target_1:
                exit_price  = target_1
                exit_date   = p.date
                exit_reason = "TARGET_1"
                break

        # Time-stop: exit at last candle's close
        if exit_reason == "TIME_STOP" and prices:
            exit_price = float(prices[-1].close)
            exit_date  = prices[-1].date

        pnl = ((exit_price - entry_price) / entry_price * 100) if entry_price and exit_price else 0

        return TradeResult(
            ticker=stock.ticker,
            signal=metric.overall_signal,
            confidence=metric.confidence_score or 0,
            week_start=metric.week_start,
            week_end=metric.week_end,
            entry_price=round(entry_price, 2),
            stop_loss=round(stop_loss, 2),
            target_1=round(target_1, 2),
            target_2=round(target_2, 2),
            exit_price=round(exit_price, 2) if exit_price else None,
            exit_date=exit_date,
            exit_reason=exit_reason,
            pnl_pct=round(pnl, 2),
            whale_net_lots=metric.whale_net_lots or 0,
            retail_exit_pct=float(metric.retail_exit_percent or 0),
            kekompakan=float(metric.kekompakan_score or 0),
            bandar_floor=round(floor, 2),
        )

    def _summarize(self, ticker: Optional[str], trades: List[TradeResult]) -> BacktestSummary:
        valid = [t for t in trades if t.exit_reason != "NO_DATA" and t.entry_price > 0]

        if not valid:
            return BacktestSummary(
                ticker=ticker, total_trades=0, winning_trades=0, losing_trades=0,
                win_rate=0, avg_gain_pct=0, avg_loss_pct=0, avg_return_pct=0,
                best_trade_pct=0, worst_trade_pct=0, t1_hit_rate=0, t2_hit_rate=0,
                stop_hit_rate=0, time_stop_rate=0, trades=trades,
            )

        wins   = [t for t in valid if t.pnl_pct > 0]
        losses = [t for t in valid if t.pnl_pct <= 0]

        def avg(lst): return sum(lst) / len(lst) if lst else 0

        return BacktestSummary(
            ticker=ticker,
            total_trades=len(valid),
            winning_trades=len(wins),
            losing_trades=len(losses),
            win_rate=round(len(wins) / len(valid) * 100, 1),
            avg_gain_pct=round(avg([t.pnl_pct for t in wins]), 2),
            avg_loss_pct=round(avg([t.pnl_pct for t in losses]), 2),
            avg_return_pct=round(avg([t.pnl_pct for t in valid]), 2),
            best_trade_pct=round(max(t.pnl_pct for t in valid), 2),
            worst_trade_pct=round(min(t.pnl_pct for t in valid), 2),
            t1_hit_rate=round(sum(1 for t in valid if t.exit_reason in ("TARGET_1","TARGET_2")) / len(valid) * 100, 1),
            t2_hit_rate=round(sum(1 for t in valid if t.exit_reason == "TARGET_2") / len(valid) * 100, 1),
            stop_hit_rate=round(sum(1 for t in valid if t.exit_reason == "STOP_LOSS") / len(valid) * 100, 1),
            time_stop_rate=round(sum(1 for t in valid if t.exit_reason == "TIME_STOP") / len(valid) * 100, 1),
            trades=trades,
        )
