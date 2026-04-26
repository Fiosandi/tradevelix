"""Ownership composition endpoints — KSEI monthly stockholder data.

POST /admin/ownership/upload  — admin uploads a KSEI PDF, parser populates tables
GET  /ownership/{ticker}      — full ownership view for a stock
GET  /admin/ownership/jobs    — list recent upload jobs
"""

import logging
import os
import uuid
from collections import defaultdict
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import select, desc, func, and_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_user
from app.dependencies import get_db
from app.models.ksei_ownership import KseiOwnership, KseiSidHistory
from app.models.stock import Stock
from app.models.system import UploadJob
from app.models.user import User
from app.services.ksei_parser import parse_ksei_pdf, parse_sid_summary

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ownership"])

UPLOAD_DIR = Path(os.environ.get("KSEI_UPLOAD_DIR", "/tmp/tradevelix_ksei"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ─── Admin upload ────────────────────────────────────────────────────

@router.post("/admin/ownership/upload")
async def upload_ksei_pdf(
    file: UploadFile = File(...),
    snapshot_month: str = Form(...),
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Accept a KSEI monthly PDF, parse it, persist ownership rows.

    snapshot_month: ISO date string of the month being reported (e.g. "2026-03-01").
    """
    if not current.is_admin:
        raise HTTPException(403, "Admin only")

    try:
        month = date.fromisoformat(snapshot_month).replace(day=1)
    except ValueError:
        raise HTTPException(400, "snapshot_month must be ISO date YYYY-MM-DD")

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Must upload a .pdf file")

    # Persist file to disk
    safe_name = f"{month.isoformat()}_{uuid.uuid4().hex[:8]}_{Path(file.filename).name}"
    dest = UPLOAD_DIR / safe_name
    with dest.open("wb") as f:
        f.write(await file.read())

    job = UploadJob(
        file_name=file.filename,
        file_path=str(dest),
        source="KSEI_LK",
        status="PROCESSING",
    )
    db.add(job)
    await db.flush()

    # Build a ticker → stock_id map once
    stock_rows = await db.execute(select(Stock.id, Stock.ticker))
    ticker_to_id = {t: i for i, t in stock_rows.all()}

    rows_processed = 0
    sid_processed = 0
    skipped_unknown_tickers: set[str] = set()

    try:
        for parsed in parse_ksei_pdf(dest, month):
            sid_id = ticker_to_id.get(parsed["ticker"])
            if not sid_id:
                skipped_unknown_tickers.add(parsed["ticker"])
                continue
            stmt = pg_insert(KseiOwnership).values(
                id=uuid.uuid4(),
                stock_id=sid_id,
                snapshot_month=month,
                holder_name=parsed["holder_name"],
                status=parsed["status"],
                entity_type=parsed["entity_type"],
                shares=parsed["shares"],
                percentage=parsed["percentage"],
                is_controlling=parsed["is_controlling"],
            ).on_conflict_do_update(
                constraint="uq_ksei_ownership_holder",
                set_={
                    "status": parsed["status"],
                    "entity_type": parsed["entity_type"],
                    "shares": parsed["shares"],
                    "percentage": parsed["percentage"],
                    "is_controlling": parsed["is_controlling"],
                },
            )
            await db.execute(stmt)
            rows_processed += 1

        for sid_row in parse_sid_summary(dest, month):
            sid_id = ticker_to_id.get(sid_row["ticker"])
            if not sid_id:
                continue
            stmt = pg_insert(KseiSidHistory).values(
                id=uuid.uuid4(),
                stock_id=sid_id,
                snapshot_month=month,
                sid_count=sid_row["sid_count"],
                scripless_pct=sid_row["scripless_pct"],
            ).on_conflict_do_update(
                constraint="uq_ksei_sid_stock_month",
                set_={"sid_count": sid_row["sid_count"], "scripless_pct": sid_row["scripless_pct"]},
            )
            await db.execute(stmt)
            sid_processed += 1

        job.status = "COMPLETED"
        job.records_processed = rows_processed + sid_processed

    except Exception as e:
        job.status = "FAILED"
        job.error_message = str(e)[:500]
        logger.exception("KSEI upload failed for %s", dest)
        raise HTTPException(500, f"Parse failed: {e}")

    return {
        "status": "ok",
        "job_id": str(job.id),
        "snapshot_month": month.isoformat(),
        "ownership_rows": rows_processed,
        "sid_rows": sid_processed,
        "unknown_tickers": sorted(skipped_unknown_tickers),
    }


@router.get("/admin/ownership/jobs")
async def list_upload_jobs(
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    if not current.is_admin:
        raise HTTPException(403, "Admin only")
    rows = await db.execute(
        select(UploadJob).order_by(desc(UploadJob.created_at)).limit(20)
    )
    jobs = list(rows.scalars().all())
    return [
        {
            "id": str(j.id),
            "file_name": j.file_name,
            "source": j.source,
            "status": j.status,
            "records_processed": j.records_processed or 0,
            "created_at": j.created_at.isoformat() if j.created_at else None,
            "error_message": j.error_message,
        }
        for j in jobs
    ]


# ─── Public read ────────────────────────────────────────────────────

@router.get("/ownership/{ticker}")
async def get_ownership(
    ticker: str,
    months: int = 12,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Full ownership composition for a stock.

    Returns:
      summary    — latest snapshot foreign/local/retail/scripless %
      monthly    — last N months of entity-type composition (for stacked bar)
      breakdown  — local-vs-foreign breakdown by entity type for latest month
      sid_trend  — SID count per month
      majors     — controlling shareholders (>=5%) for latest month
    """
    ticker = ticker.upper()
    stock_row = await db.execute(select(Stock).where(Stock.ticker == ticker))
    stock = stock_row.scalar_one_or_none()
    if not stock:
        raise HTTPException(404, f"Unknown ticker {ticker}")

    months = max(1, min(months, 36))

    rows_result = await db.execute(
        select(KseiOwnership)
        .where(KseiOwnership.stock_id == stock.id)
        .order_by(desc(KseiOwnership.snapshot_month))
    )
    all_rows = list(rows_result.scalars().all())

    if not all_rows:
        return {
            "ticker": ticker,
            "name": stock.name,
            "has_data": False,
            "summary": None,
            "monthly": [],
            "breakdown": {"local": [], "foreign": []},
            "sid_trend": [],
            "majors": [],
        }

    # Group rows by month for monthly composition
    by_month: dict[date, list[KseiOwnership]] = defaultdict(list)
    for r in all_rows:
        by_month[r.snapshot_month].append(r)

    sorted_months = sorted(by_month.keys(), reverse=True)
    recent_months = sorted_months[:months]

    monthly = []
    for m in reversed(recent_months):  # oldest first for charting
        rows = by_month[m]
        total_shares = sum(r.shares or 0 for r in rows) or 1
        agg: dict[str, dict] = defaultdict(lambda: {"shares": 0, "pct": 0.0})
        for r in rows:
            key = f"{r.status}_{r.entity_type or 'Other'}"
            agg[key]["shares"] += r.shares or 0
        for k, v in agg.items():
            v["pct"] = round(v["shares"] / total_shares * 100, 4)
        monthly.append({
            "month": m.isoformat(),
            "total_shares": total_shares,
            "by_segment": agg,
        })

    # Latest summary
    latest_month = sorted_months[0]
    latest_rows = by_month[latest_month]
    latest_total = sum(r.shares or 0 for r in latest_rows) or 1
    foreign_shares = sum(r.shares or 0 for r in latest_rows if r.status == "Asing")
    local_shares = sum(r.shares or 0 for r in latest_rows if r.status == "Lokal")
    retail_shares = sum(r.shares or 0 for r in latest_rows if (r.entity_type == "Individual"))

    summary = {
        "month": latest_month.isoformat(),
        "total_shares": latest_total,
        "foreign_pct": round(foreign_shares / latest_total * 100, 2),
        "local_pct":   round(local_shares   / latest_total * 100, 2),
        "retail_pct":  round(retail_shares  / latest_total * 100, 2),
        "holder_count": len(latest_rows),
    }

    # Breakdown table — entity type × status for latest month
    breakdown_buckets: dict[str, dict[str, dict]] = {
        "local":   defaultdict(lambda: {"shares": 0, "holders": 0}),
        "foreign": defaultdict(lambda: {"shares": 0, "holders": 0}),
    }
    for r in latest_rows:
        side = "local" if r.status == "Lokal" else "foreign"
        et = r.entity_type or "Other"
        breakdown_buckets[side][et]["shares"] += r.shares or 0
        breakdown_buckets[side][et]["holders"] += 1

    breakdown = {
        side: [
            {"entity_type": et, "shares": v["shares"], "holders": v["holders"],
             "pct": round(v["shares"] / latest_total * 100, 4)}
            for et, v in sorted(buckets.items(), key=lambda x: -x[1]["shares"])
        ]
        for side, buckets in breakdown_buckets.items()
    }

    # Major shareholders (controlling)
    majors = [
        {
            "name": r.holder_name,
            "status": r.status,
            "entity_type": r.entity_type,
            "shares": r.shares,
            "pct": float(r.percentage) if r.percentage is not None else None,
            "is_controlling": r.is_controlling,
        }
        for r in sorted(latest_rows, key=lambda r: -(r.shares or 0))
        if r.is_controlling or (r.percentage and r.percentage >= Decimal("1"))
    ][:20]

    # SID trend
    sid_result = await db.execute(
        select(KseiSidHistory)
        .where(KseiSidHistory.stock_id == stock.id)
        .order_by(KseiSidHistory.snapshot_month.asc())
        .limit(36)
    )
    sid_trend = [
        {
            "month": s.snapshot_month.isoformat(),
            "sid_count": s.sid_count,
            "scripless_pct": float(s.scripless_pct) if s.scripless_pct is not None else None,
        }
        for s in sid_result.scalars().all()
    ]

    return {
        "ticker": ticker,
        "name": stock.name,
        "has_data": True,
        "summary": summary,
        "monthly": monthly,
        "breakdown": breakdown,
        "sid_trend": sid_trend,
        "majors": majors,
    }
