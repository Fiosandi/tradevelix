"""Admin sync endpoints - trigger data syncs from Market Reaper API.

These endpoints trigger syncs that call the Market Reaper API.
They are admin-only and should not be called frequently.

Sync schedule:
- Daily: OHLCV + movers (~27 calls/day)
- Weekly: broker summaries + signals (~60 calls/week)
- Monthly: stock info (~20 calls/month)
- Bulk: Initial setup (~80+ calls)
"""

import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.database import async_session
from app.dependencies import get_db
from app.models.system import SyncLog
from app.services.sync_service import SyncService, run_sync_background
from app.schemas.sync import (
    SyncTriggerResponse,
    SyncLogResponse,
    SyncStatusResponse,
    ApiUsageResponse,
    BulkSyncResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/sync", tags=["admin", "sync"])


# ─── Trigger Syncs ──────────────────────────────────────────────────

@router.post("/daily", response_model=SyncTriggerResponse)
async def trigger_daily_sync(background_tasks: BackgroundTasks):
    """Trigger the daily sync: OHLCV for all watchlist + movers/trending (~27 calls).

    This runs in the background. Check status via GET /admin/sync/status.
    """
    # Check if a daily sync is already running
    async with async_session() as db:
        recent = await db.execute(
            select(SyncLog)
            .where(SyncLog.sync_type == "DAILY_PRICES")
            .where(SyncLog.status == "PENDING")
            .order_by(SyncLog.started_at.desc())
            .limit(1)
        )
        running = recent.scalar_one_or_none()
        if running and (datetime.utcnow() - running.started_at).seconds < 3600:
            return SyncTriggerResponse(
                status="already_running",
                sync_type="DAILY_PRICES",
                message=f"Daily sync already running (started {running.started_at})",
                sync_log_id=str(running.id),
            )

    # Create sync log first so we can return the ID
    async with async_session() as db:
        sync_log = SyncLog(
            sync_type="DAILY_PRICES",
            status="PENDING",
            started_at=datetime.utcnow(),
            api_calls_used=0,
            records_synced=0,
        )
        db.add(sync_log)
        await db.commit()
        await db.refresh(sync_log)
        log_id = str(sync_log.id)

    # Run in background
    background_tasks.add_task(run_sync_background, "daily")

    return SyncTriggerResponse(
        status="started",
        sync_type="DAILY_PRICES",
        message="Daily sync started in background. This may take several minutes.",
        sync_log_id=log_id,
    )


@router.post("/weekly", response_model=SyncTriggerResponse)
async def trigger_weekly_sync(background_tasks: BackgroundTasks):
    """Trigger the weekly sync: broker summaries + signals + calculations (~60 calls).

    This runs in the background. Check status via GET /admin/sync/status.
    """
    async with async_session() as db:
        recent = await db.execute(
            select(SyncLog)
            .where(SyncLog.sync_type == "WEEKLY_BROKER")
            .where(SyncLog.status == "PENDING")
            .order_by(SyncLog.started_at.desc())
            .limit(1)
        )
        running = recent.scalar_one_or_none()
        if running and (datetime.utcnow() - running.started_at).seconds < 7200:
            return SyncTriggerResponse(
                status="already_running",
                sync_type="WEEKLY",
                message=f"Weekly sync already running (started {running.started_at})",
                sync_log_id=str(running.id),
            )

    background_tasks.add_task(run_sync_background, "weekly")

    return SyncTriggerResponse(
        status="started",
        sync_type="WEEKLY",
        message="Weekly sync started in background. This may take 5-10 minutes due to rate limiting.",
    )


@router.post("/bulk", response_model=BulkSyncResponse)
async def trigger_bulk_sync(background_tasks: BackgroundTasks):
    """Trigger initial bulk sync for fresh setup (~80+ calls).

    WARNING: This uses a lot of API calls. Only use for initial setup.
    """
    # Check if we have enough API budget remaining
    from app.clients.market_reaper import api_client
    remaining = api_client.usage_stats.get("monthly_remaining", 0)
    if remaining < 100:
        raise HTTPException(
            status_code=429,
            detail=f"Insufficient API budget. Only {remaining} calls remaining this month. Need ~80 for bulk sync.",
        )

    background_tasks.add_task(run_sync_background, "bulk")

    return BulkSyncResponse(
        status="started",
        message="Bulk sync started in background. This may take 15-20 minutes. Check status via /admin/sync/status.",
        sync_log_ids=[],
    )


@router.post("/broker-summary", response_model=SyncTriggerResponse)
async def trigger_broker_summary_sync(background_tasks: BackgroundTasks):
    """Trigger broker summary sync only (~12-19 calls)."""
    background_tasks.add_task(run_sync_background, "broker_summary")

    return SyncTriggerResponse(
        status="started",
        sync_type="WEEKLY_BROKER",
        message="Broker summary sync started in background.",
    )


@router.post("/signals", response_model=SyncTriggerResponse)
async def trigger_signals_sync(background_tasks: BackgroundTasks):
    """Trigger signals sync only (~36-48 calls)."""
    background_tasks.add_task(run_sync_background, "signals")

    return SyncTriggerResponse(
        status="started",
        sync_type="WEEKLY_SIGNALS",
        message="Signals sync started in background.",
    )


@router.post("/stock-info", response_model=SyncTriggerResponse)
async def trigger_stock_info_sync(background_tasks: BackgroundTasks):
    """Trigger stock info sync only (~12-19 calls)."""
    background_tasks.add_task(run_sync_background, "stock_info")

    return SyncTriggerResponse(
        status="started",
        sync_type="STOCK_INFO",
        message="Stock info sync started in background.",
    )


@router.post("/broker-codes", response_model=SyncTriggerResponse)
async def trigger_broker_codes_sync(background_tasks: BackgroundTasks):
    """Trigger broker codes sync only (1 call)."""
    background_tasks.add_task(run_sync_background, "broker_codes")

    return SyncTriggerResponse(
        status="started",
        sync_type="BROKER_CODES",
        message="Broker codes sync started in background.",
    )


@router.post("/sectors", response_model=SyncTriggerResponse)
async def trigger_sectors_sync(background_tasks: BackgroundTasks):
    """Trigger sectors sync only (1 call)."""
    background_tasks.add_task(run_sync_background, "sectors")

    return SyncTriggerResponse(
        status="started",
        sync_type="SECTORS",
        message="Sectors sync started in background.",
    )


@router.post("/movers-trending", response_model=SyncTriggerResponse)
async def trigger_movers_sync(background_tasks: BackgroundTasks):
    """Trigger movers/trending sync only (~5 calls)."""
    background_tasks.add_task(run_sync_background, "movers_trending")

    return SyncTriggerResponse(
        status="started",
        sync_type="MOVERS_TRENDING",
        message="Movers/trending sync started in background.",
    )


@router.post("/calculate", response_model=SyncTriggerResponse)
async def trigger_calculations(db: AsyncSession = Depends(get_db)):
    """Re-run Three Doors calculations for all watchlist stocks (no API calls).

    Uses existing data in PostgreSQL to recalculate weekly metrics.
    """
    service = SyncService(db)
    await service.run_calculations()
    await db.commit()

    return SyncTriggerResponse(
        status="completed",
        sync_type="CALCULATIONS",
        message="Three Doors calculations completed for all watchlist stocks.",
    )


@router.post("/price-history", response_model=SyncTriggerResponse)
async def trigger_price_history(
    background_tasks: BackgroundTasks,
    days: int = 120,
):
    """Backfill OHLCV price history for all watchlist stocks.

    - days=120 → ~4 months back, 19 API calls
    - days=252 → ~1 full year back, 19 API calls
    - days=365 → Jan 1 to today, 19 API calls

    Safe to run multiple times — upserts by (stock_id, date).
    """
    days = max(30, min(days, 500))
    background_tasks.add_task(run_sync_background, f"price_history_{days}")
    return SyncTriggerResponse(
        status="started",
        sync_type="PRICE_HISTORY",
        message=f"Backfilling {days} days of price history for all watchlist stocks. Check status in a few minutes.",
    )


@router.post("/broker-history", response_model=SyncTriggerResponse)
async def trigger_broker_history(background_tasks: BackgroundTasks, weeks: int = 12):
    """Backfill broker summaries for the past N weeks for inventory chart.

    Default: 12 weeks (~228 API calls, ~8 min).
    Safe to re-run — upserts by (stock_id, date_from, date_to).
    """
    weeks = max(1, min(weeks, 52))
    background_tasks.add_task(run_sync_background, f"broker_history_{weeks}")
    return SyncTriggerResponse(
        status="started",
        sync_type="BROKER_HISTORY",
        message=f"Backfilling {weeks} weeks of broker summaries (~{weeks * 19} API calls, ~{weeks * 19 * 2 // 60} min). Check status for progress.",
    )


@router.post("/major-holders", response_model=SyncTriggerResponse)
async def trigger_major_holders_sync(background_tasks: BackgroundTasks):
    """Sync major holder (5%+) ownership disclosures from IDX/KSEI. ~19 API calls."""
    background_tasks.add_task(run_sync_background, "major_holders")
    return SyncTriggerResponse(
        status="started",
        sync_type="MAJOR_HOLDERS",
        message="Syncing major holder disclosures for all watchlist stocks (~19 API calls).",
    )


# ─── Sync Status ────────────────────────────────────────────────────

@router.get("/status", response_model=SyncStatusResponse)
async def get_sync_status(db: AsyncSession = Depends(get_db)):
    """Get sync status: last sync times, recent logs, and API usage."""
    # Get recent sync logs (last 20)
    recent_logs_result = await db.execute(
        select(SyncLog)
        .order_by(SyncLog.started_at.desc())
        .limit(20)
    )
    recent_logs = list(recent_logs_result.scalars().all())

    # Get last daily sync
    last_daily_result = await db.execute(
        select(SyncLog)
        .where(SyncLog.sync_type == "DAILY_PRICES")
        .where(SyncLog.status == "SUCCESS")
        .order_by(SyncLog.completed_at.desc())
        .limit(1)
    )
    last_daily = last_daily_result.scalar_one_or_none()

    # Get last weekly sync
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

    # Convert sync logs to response format
    log_responses = [
        SyncLogResponse(
            id=str(log.id),
            sync_type=log.sync_type,
            status=log.status,
            started_at=log.started_at,
            completed_at=log.completed_at,
            records_synced=log.records_synced or 0,
            api_calls_used=log.api_calls_used or 0,
            error_message=log.error_message,
        )
        for log in recent_logs
    ]

    return SyncStatusResponse(
        recent_syncs=log_responses,
        api_usage=ApiUsageResponse(**api_usage),
        last_daily_sync=last_daily.completed_at if last_daily else None,
        last_weekly_sync=last_weekly.completed_at if last_weekly else None,
    )