"""Alert CRUD + manual evaluation endpoints."""

import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_user
from app.dependencies import get_db
from app.models.stock import Stock
from app.models.system import Alert
from app.models.user import User
from app.services.alert_engine import SUPPORTED_TYPES, evaluate_all_alerts

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/alerts", tags=["alerts"])


class AlertCreateRequest(BaseModel):
    ticker: str
    alert_type: str
    condition: dict


class AlertResponse(BaseModel):
    id: str
    ticker: str
    stock_name: Optional[str] = None
    alert_type: str
    condition: dict
    is_active: bool
    triggered_at: Optional[datetime] = None
    created_at: Optional[datetime] = None


@router.get("", response_model=list[AlertResponse])
async def list_alerts(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    rows = await db.execute(
        select(Alert, Stock).join(Stock, Stock.id == Alert.stock_id, isouter=True)
        .order_by(desc(Alert.triggered_at).nullslast(), desc(Alert.created_at))
    )
    out: list[AlertResponse] = []
    for alert, stock in rows.all():
        out.append(AlertResponse(
            id=str(alert.id),
            ticker=stock.ticker if stock else "",
            stock_name=stock.name if stock else None,
            alert_type=alert.alert_type,
            condition=alert.condition or {},
            is_active=bool(alert.is_active),
            triggered_at=alert.triggered_at,
            created_at=alert.created_at,
        ))
    return out


@router.post("", response_model=AlertResponse)
async def create_alert(
    req: AlertCreateRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    if req.alert_type not in SUPPORTED_TYPES:
        raise HTTPException(400, f"Unsupported alert_type. Choose one of: {sorted(SUPPORTED_TYPES)}")

    stock_row = await db.execute(select(Stock).where(Stock.ticker == req.ticker.upper()))
    stock = stock_row.scalar_one_or_none()
    if not stock:
        raise HTTPException(404, f"Unknown ticker: {req.ticker}")

    alert = Alert(
        id=uuid.uuid4(),
        stock_id=stock.id,
        alert_type=req.alert_type,
        condition=req.condition,
        is_active=True,
    )
    db.add(alert)
    await db.flush()
    return AlertResponse(
        id=str(alert.id),
        ticker=stock.ticker,
        stock_name=stock.name,
        alert_type=alert.alert_type,
        condition=alert.condition or {},
        is_active=True,
        triggered_at=None,
        created_at=alert.created_at,
    )


@router.delete("/{alert_id}")
async def delete_alert(
    alert_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    r = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = r.scalar_one_or_none()
    if not alert:
        raise HTTPException(404, "Alert not found")
    await db.delete(alert)
    return {"status": "ok"}


@router.post("/{alert_id}/rearm")
async def rearm_alert(
    alert_id: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    r = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = r.scalar_one_or_none()
    if not alert:
        raise HTTPException(404, "Alert not found")
    alert.triggered_at = None
    alert.is_active = True
    return {"status": "ok"}


@router.post("/evaluate")
async def evaluate_now(
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Run the alert engine immediately. Admin-only — useful for testing."""
    if not current.is_admin:
        raise HTTPException(403, "Admin only")
    summary = await evaluate_all_alerts(db)
    return summary
