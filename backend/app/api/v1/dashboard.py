"""Dashboard endpoints - read-only overview and leaderboard.

These endpoints read ONLY from PostgreSQL. Zero API calls on user request.
"""

import logging
from datetime import date, timedelta
from typing import List, Optional
from decimal import Decimal

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc

from app.dependencies import get_db
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.config import settings
from app.models.stock import Stock
from app.models.daily_price import DailyPrice
from app.models.weekly_metric import WeeklyMetric
from app.models.api_signal import ApiSignal
from app.models.system import SyncLog
from app.models.major_holder import MajorHolderMovement
from app.models.broker_summary import BrokerSummary, BrokerEntry
from sqlalchemy import asc
from app.services.sync_service import SyncService
from app.schemas.dashboard import (
    DashboardSummaryResponse,
    LeaderboardEntry,
    LeaderboardResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


# ─── Signal Priority for Sorting ─────────────────────────────────────

@router.get("/admin/users", response_model=dict)
async def get_user_stats(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    """Admin: user registration stats."""
    total  = await db.execute(select(func.count(User.id)))
    active = await db.execute(select(func.count(User.id)).where(User.is_active == True))
    admins = await db.execute(select(func.count(User.id)).where(User.is_admin  == True))
    from sqlalchemy import DateTime as DT
    from datetime import timedelta
    week_ago = __import__('datetime').datetime.utcnow() - timedelta(days=7)
    recent = await db.execute(select(func.count(User.id)).where(User.created_at >= week_ago))
    paid   = await db.execute(select(func.count(User.id)).where(User.is_paid   == True))
    users_result = await db.execute(
        select(User).order_by(desc(User.created_at)).limit(20)
    )
    users = list(users_result.scalars().all())
    return {
        "total": total.scalar(),
        "active": active.scalar(),
        "admins": admins.scalar(),
        "paid": paid.scalar(),
        "new_this_week": recent.scalar(),
        "recent": [
            {
                "id": str(u.id), "username": u.username, "email": u.email,
                "is_active": u.is_active, "is_admin": u.is_admin,
                "is_paid": getattr(u, 'is_paid', False),
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "last_login": u.last_login.isoformat() if u.last_login else None,
            }
            for u in users
        ],
    }


@router.post("/admin/users/{user_id}/toggle-paid", response_model=dict)
async def toggle_user_paid(
    user_id: str, db: AsyncSession = Depends(get_db), current: User = Depends(get_current_user)
):
    """Admin only: toggle is_paid for a user."""
    if not current.is_admin:
        from fastapi import HTTPException
        raise HTTPException(status_code=403, detail="Admin only")
    from uuid import UUID
    u_result = await db.execute(select(User).where(User.id == UUID(user_id)))
    u = u_result.scalar_one_or_none()
    if not u:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="User not found")
    u.is_paid = not getattr(u, 'is_paid', False)
    await db.commit()
    return {"user_id": user_id, "is_paid": u.is_paid}


SIGNAL_PRIORITY = {
    "STRONG_BUY": 5,
    "BUY": 4,
    "WATCH": 3,
    "NEUTRAL": 2,
    "WAIT": 2,
    "SELL": 1,
    "STRONG_SELL": 0,
    "WEAK_UP": 2,
    "WEAK_DOWN": 2,
}


@router.get("/summary", response_model=DashboardSummaryResponse)
async def get_dashboard_summary(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    """Get dashboard overview: stocks tracked, last sync times, API usage."""
    # Count stocks
    stocks_result = await db.execute(
        select(func.count(Stock.id)).where(Stock.is_active == True)
    )
    stocks_tracked = stocks_result.scalar() or 0

    # Count stocks with actual data
    stocks_with_prices = await db.execute(
        select(func.count(func.distinct(DailyPrice.stock_id)))
    )
    stocks_with_data = stocks_with_prices.scalar() or 0

    # Get last sync times
    last_daily_result = await db.execute(
        select(SyncLog)
        .where(SyncLog.sync_type == "DAILY_PRICES")
        .where(SyncLog.status == "SUCCESS")
        .order_by(SyncLog.completed_at.desc())
        .limit(1)
    )
    last_daily = last_daily_result.scalar_one_or_none()

    last_weekly_result = await db.execute(
        select(SyncLog)
        .where(SyncLog.sync_type == "WEEKLY_BROKER")
        .where(SyncLog.status == "SUCCESS")
        .order_by(SyncLog.completed_at.desc())
        .limit(1)
    )
    last_weekly = last_weekly_result.scalar_one_or_none()

    # Get API usage
    api_usage = await SyncService.get_api_usage(db)

    return DashboardSummaryResponse(
        stocks_tracked=stocks_tracked,
        stocks_with_data=stocks_with_data,
        last_daily_sync=last_daily.completed_at if last_daily else None,
        last_weekly_sync=last_weekly.completed_at if last_weekly else None,
        api_usage=api_usage,
        watchlist=list(settings.watchlist_list),
    )


@router.get("/leaderboard", response_model=LeaderboardResponse)
async def get_leaderboard(
    sort_by: str = Query("overall_signal", description="Sort by: overall_signal, retail_exit, whale_net, accumulation"),
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get leaderboard of stocks ranked by signal strength.

    Sort options:
    - overall_signal: Sort by composite signal (default)
    - retail_exit: Sort by retail exit % (highest first = most bullish)
    - whale_net: Sort by whale net lots (highest first = most whale buying)
    - accumulation: Sort by API accumulation score
    """
    # Get the most recent week's metrics
    latest_week = await db.execute(
        select(func.max(WeeklyMetric.week_end))
    )
    week_end = latest_week.scalar()

    if not week_end:
        return LeaderboardResponse(
            entries=[],
            sort_by=sort_by,
            week_start=None,
            week_end=None,
            total_stocks=0,
        )

    # Get week_start for that week
    week_start_result = await db.execute(
        select(func.min(WeeklyMetric.week_start))
        .where(WeeklyMetric.week_end == week_end)
    )
    week_start = week_start_result.scalar()

    # Get all metrics for that week separately (joined query may not load JSONB properly)
    metrics_result = await db.execute(
        select(WeeklyMetric).where(WeeklyMetric.week_end == week_end)
    )
    metrics_dict = {m.stock_id: m for m in metrics_result.scalars().all()}

    # Get all stocks
    stocks_result = await db.execute(
        select(Stock).where(Stock.is_active == True)
    )
    stocks_dict = {s.id: s for s in stocks_result.scalars().all()}

    # Batch: latest pump_dump score per stock
    pump_subq = (
        select(ApiSignal.stock_id, func.max(ApiSignal.date).label("max_date"))
        .where(ApiSignal.signal_type == "pump_dump")
        .group_by(ApiSignal.stock_id)
        .subquery()
    )
    pump_result = await db.execute(
        select(ApiSignal.stock_id, ApiSignal.score)
        .join(pump_subq, and_(
            ApiSignal.stock_id == pump_subq.c.stock_id,
            ApiSignal.date == pump_subq.c.max_date,
        ))
        .where(ApiSignal.signal_type == "pump_dump")
    )
    pump_scores = {row.stock_id: float(row.score) for row in pump_result.all() if row.score is not None}

    entries = []
    for stock_id, metric in metrics_dict.items():
        stock = stocks_dict.get(stock_id)
        if not stock:
            continue

        # Get latest price for this stock
        price_result = await db.execute(
            select(DailyPrice.close)
            .where(DailyPrice.stock_id == stock.id)
            .order_by(desc(DailyPrice.date))
            .limit(1)
        )
        latest_price = price_result.scalar_one_or_none()

        entry = LeaderboardEntry(
            ticker=stock.ticker,
            name=stock.name,
            overall_signal=metric.overall_signal,
            confidence_score=metric.confidence_score,
            whale_net_lots=metric.whale_net_lots,
            retail_exit_percent=metric.retail_exit_percent,
            kekompakan_score=metric.kekompakan_score,
            vpa_signal=metric.vpa_signal,
            Bandar_floor_price=metric.bandar_floor_price,
            current_price=latest_price,
            distance_to_floor_pct=metric.distance_to_floor_pct,
            api_accumulation_score=metric.api_accumulation_score,
            week_start=metric.week_start,
            week_end=metric.week_end,
            top_whale_brokers=metric.top_whale_brokers,
            pump_score=pump_scores.get(stock_id),
        )
        entries.append(entry)

    # Sort based on sort_by parameter
    if sort_by == "retail_exit":
        entries.sort(key=lambda e: float(e.retail_exit_percent or 0), reverse=True)
    elif sort_by == "whale_net":
        entries.sort(key=lambda e: e.whale_net_lots or 0, reverse=True)
    elif sort_by == "accumulation":
        entries.sort(
            key=lambda e: float(e.api_accumulation_score or 0),
            reverse=True,
        )
    else:  # overall_signal - sort by signal priority, then confidence
        entries.sort(
            key=lambda e: (
                SIGNAL_PRIORITY.get(e.overall_signal or "", 0),
                e.confidence_score or 0,
            ),
            reverse=True,
        )

    # Apply limit
    entries = entries[:limit]

    return LeaderboardResponse(
        entries=entries,
        sort_by=sort_by,
        week_start=week_start,
        week_end=week_end,
        total_stocks=len(entries),
    )


@router.get("/stock/{ticker}", response_model=dict)
async def get_stock_analysis(
    ticker: str,
    days: int = Query(120, ge=7, le=365),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get full analysis for a specific stock: metrics, prices, signals."""
    # Get stock
    stock_result = await db.execute(
        select(Stock).where(Stock.ticker == ticker.upper())
    )
    stock = stock_result.scalar_one_or_none()
    if not stock:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Stock {ticker} not found")

    # Get latest weekly metrics
    metric_result = await db.execute(
        select(WeeklyMetric)
        .where(WeeklyMetric.stock_id == stock.id)
        .order_by(desc(WeeklyMetric.week_end))
        .limit(1)
    )
    metric = metric_result.scalar_one_or_none()

    # Get latest API signals
    signals_result = await db.execute(
        select(ApiSignal)
        .where(ApiSignal.stock_id == stock.id)
        .order_by(desc(ApiSignal.date))
        .limit(10)
    )
    signals = list(signals_result.scalars().all())

    # Get daily prices
    prices_result = await db.execute(
        select(DailyPrice)
        .where(DailyPrice.stock_id == stock.id)
        .order_by(desc(DailyPrice.date))
        .limit(days)
    )
    prices = list(reversed(prices_result.scalars().all()))

    # Get latest broker summary
    from app.models.broker_summary import BrokerSummary, BrokerEntry
    summary_result = await db.execute(
        select(BrokerSummary)
        .where(BrokerSummary.stock_id == stock.id)
        .order_by(desc(BrokerSummary.date_to))
        .limit(1)
    )
    broker_summary = summary_result.scalar_one_or_none()

    # Get broker entries if summary exists
    broker_entries = []
    if broker_summary:
        entries_result = await db.execute(
            select(BrokerEntry)
            .where(BrokerEntry.summary_id == broker_summary.id)
            .order_by(desc(BrokerEntry.lots))
        )
        broker_entries = list(entries_result.scalars().all())

    return {
        "stock": {
            "ticker": stock.ticker,
            "name": stock.name,
            "sector_id": str(stock.sector_id) if stock.sector_id else None,
            "is_active": stock.is_active,
            "last_synced": stock.last_synced.isoformat() if stock.last_synced else None,
        },
        "weekly_metrics": {
            "week_start": metric.week_start.isoformat() if metric else None,
            "week_end": metric.week_end.isoformat() if metric else None,
            "overall_signal": metric.overall_signal if metric else None,
            "confidence_score": metric.confidence_score if metric else None,
            "whale_net_lots": metric.whale_net_lots if metric else None,
            "whale_net_value": float(metric.whale_net_value) if metric and metric.whale_net_value else None,
            "whale_count": metric.whale_count if metric else None,
            "retail_exit_percent": float(metric.retail_exit_percent) if metric and metric.retail_exit_percent else None,
            "kekompakan_score": float(metric.kekompakan_score) if metric and metric.kekompakan_score else None,
            "vpa_signal": metric.vpa_signal if metric else None,
            "price_change_week": float(metric.price_change_week) if metric and metric.price_change_week else None,
            "volume_change_week": float(metric.volume_change_week) if metric and metric.volume_change_week else None,
            "bandar_floor_price": float(metric.bandar_floor_price) if metric and metric.bandar_floor_price else None,
            "distance_to_floor_pct": float(metric.distance_to_floor_pct) if metric and metric.distance_to_floor_pct else None,
            "api_accumulation_score": float(metric.api_accumulation_score) if metric and metric.api_accumulation_score else None,
            "api_distribution_score": float(metric.api_distribution_score) if metric and metric.api_distribution_score else None,
            "api_sentiment_status": metric.api_sentiment_status if metric else None,
            "api_smart_money_status": metric.api_smart_money_status if metric else None,
            "top_whale_brokers": metric.top_whale_brokers if metric and metric.top_whale_brokers else None,
        } if metric else None,
        "api_signals": [
            {
                "signal_type":       s.signal_type,
                "score":             float(s.score) if s.score else None,
                "status":            s.status,
                "confidence":        s.confidence,
                "recommendation":    s.recommendation,
                "risk_level":        s.risk_level,
                "date":              s.date.isoformat(),
                "entry_ideal_price": float(s.entry_ideal_price) if s.entry_ideal_price else None,
                "entry_max_price":   float(s.entry_max_price)   if s.entry_max_price   else None,
            }
            for s in signals
        ],
        "recent_prices": [
            {
                "date": p.date.isoformat(),
                "open": float(p.open) if p.open else None,
                "high": float(p.high) if p.high else None,
                "low": float(p.low) if p.low else None,
                "close": float(p.close),
                "volume": p.volume,
                "foreign_buy": float(p.foreign_buy) if p.foreign_buy else None,
                "foreign_sell": float(p.foreign_sell) if p.foreign_sell else None,
                "foreign_flow": float(p.foreign_flow) if p.foreign_flow else None,
            }
            for p in prices
        ],
        "broker_summary": {
            "date_from": broker_summary.date_from.isoformat() if broker_summary else None,
            "date_to": broker_summary.date_to.isoformat() if broker_summary else None,
            "avg_price": float(broker_summary.avg_price) if broker_summary and broker_summary.avg_price else None,
            "broker_accdist": broker_summary.broker_accdist if broker_summary else None,
            "total_buyer": broker_summary.total_buyer if broker_summary else None,
            "total_seller": broker_summary.total_seller if broker_summary else None,
        } if broker_summary else None,
        "broker_entries": [
            {
                "broker_code": e.broker_code,
                "side": e.side,
                "lots": e.lots,
                "value": float(e.value) if e.value else None,
                "avg_price": float(e.avg_price) if e.avg_price else None,
                "investor_type": e.investor_type,
                "is_whale": e.is_whale,
                "frequency": e.frequency,
            }
            for e in broker_entries
        ],
    }



@router.get("/backtest", response_model=dict)
async def run_backtest(
    ticker: Optional[str] = Query(None, description="Ticker to backtest (omit for all)"),
    from_date: Optional[date] = Query(None, description="Start date e.g. 2026-01-01"),
    min_confidence: int = Query(60, ge=0, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Run Three Doors strategy backtest against historical data.

    Entry: open price the day after signal week ends
    Stop: bandar_floor * 0.95 (-5%)
    T1: entry * 1.12 (+12%)
    T2: entry * 1.25 (+25%)
    Time-stop: 35 calendar days
    """
    from app.services.backtest_engine import BacktestEngine
    engine = BacktestEngine(db)
    summary = await engine.run(
        ticker=ticker,
        from_date=from_date,
        min_confidence=min_confidence,
    )

    return {
        "ticker": summary.ticker,
        "total_trades": summary.total_trades,
        "winning_trades": summary.winning_trades,
        "losing_trades": summary.losing_trades,
        "win_rate": summary.win_rate,
        "avg_gain_pct": summary.avg_gain_pct,
        "avg_loss_pct": summary.avg_loss_pct,
        "avg_return_pct": summary.avg_return_pct,
        "best_trade_pct": summary.best_trade_pct,
        "worst_trade_pct": summary.worst_trade_pct,
        "t1_hit_rate": summary.t1_hit_rate,
        "t2_hit_rate": summary.t2_hit_rate,
        "stop_hit_rate": summary.stop_hit_rate,
        "time_stop_rate": summary.time_stop_rate,
        "trades": [
            {
                "ticker": t.ticker,
                "signal": t.signal,
                "confidence": t.confidence,
                "week_start": t.week_start.isoformat() if t.week_start else None,
                "week_end": t.week_end.isoformat() if t.week_end else None,
                "entry_price": t.entry_price,
                "stop_loss": t.stop_loss,
                "target_1": t.target_1,
                "target_2": t.target_2,
                "exit_price": t.exit_price,
                "exit_date": t.exit_date.isoformat() if t.exit_date else None,
                "exit_reason": t.exit_reason,
                "pnl_pct": t.pnl_pct,
                "whale_net_lots": t.whale_net_lots,
                "retail_exit_pct": t.retail_exit_pct,
                "kekompakan": t.kekompakan,
                "bandar_floor": t.bandar_floor,
            }
            for t in summary.trades
        ],
    }


@router.get("/stock/{ticker}/history", response_model=dict)
async def get_stock_history(
    ticker: str,
    weeks: int = Query(8, ge=2, le=52),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get weekly metric history for trend charts (last N weeks)."""
    stock_result = await db.execute(
        select(Stock).where(Stock.ticker == ticker.upper())
    )
    stock = stock_result.scalar_one_or_none()
    if not stock:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Stock {ticker} not found")

    history_result = await db.execute(
        select(WeeklyMetric)
        .where(WeeklyMetric.stock_id == stock.id)
        .order_by(desc(WeeklyMetric.week_end))
        .limit(weeks)
    )
    rows = list(reversed(history_result.scalars().all()))

    return {
        "ticker": ticker.upper(),
        "weeks": [
            {
                "week_end": row.week_end.isoformat(),
                "whale_net_lots": row.whale_net_lots or 0,
                "retail_exit_percent": float(row.retail_exit_percent) if row.retail_exit_percent else 0,
                "kekompakan_score": float(row.kekompakan_score) if row.kekompakan_score else 0,
                "confidence_score": row.confidence_score or 0,
                "overall_signal": row.overall_signal or "WAIT",
            }
            for row in rows
        ],
    }


@router.get("/stock/{ticker}/major-holders", response_model=dict)
async def get_major_holders(
    ticker: str,
    limit: int = Query(30, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Get major holder (5%+) ownership disclosure movements for a stock."""
    stock_result = await db.execute(
        select(Stock).where(Stock.ticker == ticker.upper())
    )
    stock = stock_result.scalar_one_or_none()
    if not stock:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Stock {ticker} not found")

    rows_result = await db.execute(
        select(MajorHolderMovement)
        .where(MajorHolderMovement.stock_id == stock.id)
        .order_by(desc(MajorHolderMovement.disclosure_date))
        .limit(limit)
    )
    rows = list(rows_result.scalars().all())

    return {
        "ticker": ticker.upper(),
        "movements": [
            {
                "holder_name": r.holder_name,
                "disclosure_date": r.disclosure_date.isoformat(),
                "prev_pct": float(r.prev_pct) if r.prev_pct else 0,
                "curr_pct": float(r.curr_pct) if r.curr_pct else 0,
                "change_pct": float(r.change_pct) if r.change_pct else 0,
                "prev_shares": r.prev_shares,
                "curr_shares": r.curr_shares,
                "change_shares": r.change_shares,
                "action_type": r.action_type,
                "nationality": r.nationality,
                "source": r.source,
                "price_at_disclosure": float(r.price_at_disclosure) if r.price_at_disclosure else None,
            }
            for r in rows
        ],
    }


@router.get("/stock/{ticker}/broker-flow", response_model=dict)
async def get_broker_flow(
    ticker: str,
    from_date: Optional[date] = Query(None),
    to_date:   Optional[date] = Query(None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Broker inventory flow: daily OHLCV + cumulative net lots per broker.

    Returns a flat timeline array with one entry per trading day. Each entry has:
    - OHLCV fields for the candlestick
    - One field per active broker with their cumulative net lots up to that day
      (step-interpolated from weekly summaries)
    """
    from collections import defaultdict

    if not to_date:
        to_date = date.today()
    if not from_date:
        from_date = to_date - timedelta(days=90)

    stock_result = await db.execute(select(Stock).where(Stock.ticker == ticker.upper()))
    stock = stock_result.scalar_one_or_none()
    if not stock:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Stock {ticker} not found")

    # ── 1. Daily prices ──────────────────────────────────────────────────
    prices_result = await db.execute(
        select(DailyPrice)
        .where(DailyPrice.stock_id == stock.id)
        .where(DailyPrice.date >= from_date)
        .where(DailyPrice.date <= to_date)
        .order_by(asc(DailyPrice.date))
    )
    prices = list(prices_result.scalars().all())

    # ── 2. Broker summaries + entries in range ───────────────────────────
    summaries_result = await db.execute(
        select(BrokerSummary)
        .where(BrokerSummary.stock_id == stock.id)
        .where(BrokerSummary.date_to   >= from_date)
        .where(BrokerSummary.date_from <= to_date)
        .order_by(asc(BrokerSummary.date_to))
    )
    summaries = list(summaries_result.scalars().all())

    # ── 3. Build cumulative broker net lots ──────────────────────────────
    # Track total lots (|buy| + |sell|) for tektok detection
    total_lots: dict = defaultdict(int)
    weekly_nets: dict = {}

    for summary in summaries:
        nets: dict = defaultdict(int)
        for entry in summary.entries:
            lots = entry.lots or 0
            net  = lots if entry.side == "BUY" else -lots
            nets[entry.broker_code] += net
            total_lots[entry.broker_code] += lots
        weekly_nets[summary.date_to] = dict(nets)

    # Running cumulative sum per broker, snapshotted at each week_end
    cum: dict = defaultdict(int)
    all_brokers: set = set()
    snapshots: dict = {}  # date → {broker: cum_lots}

    for week_date in sorted(weekly_nets.keys()):
        for broker, net in weekly_nets[week_date].items():
            cum[broker] += net
            all_brokers.add(broker)
        snapshots[week_date] = dict(cum)

    final_cum = dict(cum)

    # Tektok: |net / total| < 15% means heavy two-way trading (wash/scalp)
    tektok_set = {
        b for b in all_brokers
        if total_lots[b] > 0 and abs(final_cum.get(b, 0)) / total_lots[b] < 0.15
    }

    # ── 4. Step-interpolate broker values into daily price data ──────────
    snap_dates = sorted(snapshots.keys())

    def broker_at(d: date) -> dict:
        applicable = [sd for sd in snap_dates if sd <= d]
        return snapshots[max(applicable)] if applicable else {}

    timeline = []
    for p in prices:
        bv = broker_at(p.date)
        pt: dict = {
            "date":   p.date.isoformat(),
            "open":   float(p.open)  if p.open  else None,
            "high":   float(p.high)  if p.high  else None,
            "low":    float(p.low)   if p.low   else None,
            "close":  float(p.close),
            "volume": p.volume or 0,
        }
        for b in all_brokers:
            pt[b] = bv.get(b, 0)
        timeline.append(pt)

    # ── 5. Top accumulators + distributors ───────────────────────────────
    sorted_final = sorted(final_cum.items(), key=lambda x: x[1], reverse=True)
    top_acc  = [{"broker": b, "cum_lots": v, "is_tektok": b in tektok_set}
                for b, v in sorted_final if v > 0][:6]
    top_dist = [{"broker": b, "cum_lots": abs(v), "is_tektok": b in tektok_set}
                for b, v in reversed(sorted_final) if v < 0][:6]

    return {
        "ticker":           ticker.upper(),
        "from_date":        from_date.isoformat(),
        "to_date":          to_date.isoformat(),
        "timeline":         timeline,
        "brokers":          sorted(all_brokers),
        "tektok_brokers":   sorted(tektok_set),
        "top_accumulators": top_acc,
        "top_distributors": top_dist,
        "weeks_of_data":    len(summaries),
    }


@router.get("/stock/{ticker}/shareholders", response_model=dict)
async def get_stock_shareholders(
    ticker: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """5%+ shareholders for a stock with their broker codes."""
    from sqlalchemy import text
    rows = await db.execute(
        text('''
            SELECT ss.shareholder_name, ss.broker_codes, ss.shares,
                   ss.percentage, ss.is_controlling
            FROM stock_shareholders ss
            JOIN stocks s ON s.id = ss.stock_id
            WHERE s.ticker = :ticker
            ORDER BY ss.is_controlling DESC, ss.percentage DESC
        '''),
        {'ticker': ticker.upper()}
    )
    items = rows.mappings().all()
    return {
        "ticker": ticker.upper(),
        "shareholders": [
            {
                "name": r["shareholder_name"],
                "broker_codes": r["broker_codes"].split(","),
                "shares": r["shares"],
                "percentage": float(r["percentage"]) if r["percentage"] else 0,
                "is_controlling": r["is_controlling"],
            }
            for r in items
        ],
    }


@router.get("/signals", response_model=dict)
async def get_trade_signals(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Active trade signals generated from Three Doors analysis."""
    from app.models.system import TradeSignal
    from datetime import datetime as dt

    result = await db.execute(
        select(TradeSignal, Stock)
        .join(Stock, TradeSignal.stock_id == Stock.id)
        .where(TradeSignal.status == "ACTIVE")
        .order_by(desc(TradeSignal.created_at))
    )
    rows = result.all()

    # Update expired signals
    now = dt.utcnow()
    for ts, _ in rows:
        if ts.expires_at and ts.expires_at < now:
            ts.status = "EXPIRED"

    await db.commit()

    # Re-fetch active only
    result2 = await db.execute(
        select(TradeSignal, Stock)
        .join(Stock, TradeSignal.stock_id == Stock.id)
        .where(TradeSignal.status == "ACTIVE")
        .order_by(desc(TradeSignal.created_at))
    )

    signals = []
    for ts, stock in result2.all():
        # Get latest price for P&L vs entry
        price_r = await db.execute(
            select(DailyPrice.close)
            .where(DailyPrice.stock_id == stock.id)
            .order_by(desc(DailyPrice.date))
            .limit(1)
        )
        current_price = price_r.scalar_one_or_none()
        cp = float(current_price) if current_price else None
        entry = float(ts.entry_price) if ts.entry_price else None
        pnl_pct = round((cp - entry) / entry * 100, 2) if cp and entry else None

        signals.append({
            "id": str(ts.id),
            "ticker": stock.ticker,
            "name": stock.name,
            "action": ts.action,
            "confidence": ts.confidence,
            "entry_price": float(ts.entry_price) if ts.entry_price else None,
            "stop_loss": float(ts.stop_loss) if ts.stop_loss else None,
            "target_1": float(ts.target_1) if ts.target_1 else None,
            "target_2": float(ts.target_2) if ts.target_2 else None,
            "current_price": cp,
            "pnl_pct": pnl_pct,
            "key_bullets": ts.key_bullets or [],
            "whale_brokers": ts.whale_brokers or [],
            "retail_exit_percent": float(ts.retail_exit_percent) if ts.retail_exit_percent else None,
            "volume_confirmed": ts.volume_confirmed,
            "status": ts.status,
            "created_at": ts.created_at.isoformat() if ts.created_at else None,
            "expires_at": ts.expires_at.isoformat() if ts.expires_at else None,
        })

    return {"count": len(signals), "signals": signals}
