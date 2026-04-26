"""Alert evaluator — checks each active Alert against the latest stock state.

Hooks into `SyncService.run_calculations` after weekly metrics + trade signals
have been written. For every active, untriggered alert it loads the latest
WeeklyMetric / DailyPrice, evaluates the condition, and sets `triggered_at`
when the condition fires.

Alert types (stored in Alert.alert_type, with thresholds in Alert.condition):
  RETAIL_EXIT_ABOVE        condition: {"threshold": 65}
  WHALE_NET_ABOVE          condition: {"threshold": 50000}
  WHALE_NET_BELOW          condition: {"threshold": -50000}
  FLOOR_DISTANCE_BELOW     condition: {"threshold": 5}     (% above floor)
  PRICE_ABOVE              condition: {"threshold": 1500}
  PRICE_BELOW              condition: {"threshold": 800}
  SIGNAL_EQUALS            condition: {"value": "STRONG_BUY"}

A triggered alert is left as is_active=True and triggered_at=now(); the user
can re-arm it by clearing triggered_at via POST /alerts/{id}/rearm.
"""

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.daily_price import DailyPrice
from app.models.system import Alert
from app.models.weekly_metric import WeeklyMetric

logger = logging.getLogger(__name__)


SUPPORTED_TYPES = {
    "RETAIL_EXIT_ABOVE",
    "WHALE_NET_ABOVE",
    "WHALE_NET_BELOW",
    "FLOOR_DISTANCE_BELOW",
    "PRICE_ABOVE",
    "PRICE_BELOW",
    "SIGNAL_EQUALS",
}


async def _latest_metric(db: AsyncSession, stock_id) -> Optional[WeeklyMetric]:
    r = await db.execute(
        select(WeeklyMetric)
        .where(WeeklyMetric.stock_id == stock_id)
        .order_by(desc(WeeklyMetric.week_start))
        .limit(1)
    )
    return r.scalar_one_or_none()


async def _latest_price(db: AsyncSession, stock_id) -> Optional[DailyPrice]:
    r = await db.execute(
        select(DailyPrice)
        .where(DailyPrice.stock_id == stock_id)
        .order_by(desc(DailyPrice.date))
        .limit(1)
    )
    return r.scalar_one_or_none()


async def _condition_met(db: AsyncSession, alert: Alert) -> tuple[bool, Optional[str]]:
    """Return (fired, reason) — reason is a short human description for logging."""
    cond = alert.condition or {}
    typ = alert.alert_type

    if typ in {"RETAIL_EXIT_ABOVE", "WHALE_NET_ABOVE", "WHALE_NET_BELOW",
              "FLOOR_DISTANCE_BELOW", "SIGNAL_EQUALS"}:
        m = await _latest_metric(db, alert.stock_id)
        if not m:
            return False, "no_metric"

        if typ == "RETAIL_EXIT_ABOVE":
            t = float(cond.get("threshold", 0))
            v = float(m.retail_exit_percent or 0)
            return v > t, f"retail_exit={v:.1f} > {t}"

        if typ == "WHALE_NET_ABOVE":
            t = float(cond.get("threshold", 0))
            v = m.whale_net_lots or 0
            return v > t, f"whale_net={v} > {t}"

        if typ == "WHALE_NET_BELOW":
            t = float(cond.get("threshold", 0))
            v = m.whale_net_lots or 0
            return v < t, f"whale_net={v} < {t}"

        if typ == "FLOOR_DISTANCE_BELOW":
            t = float(cond.get("threshold", 0))
            v = float(m.distance_to_floor_pct or 0)
            return v < t, f"floor_distance={v:.2f}% < {t}%"

        if typ == "SIGNAL_EQUALS":
            target = (cond.get("value") or "").upper()
            sig = (m.overall_signal or "").upper()
            return sig == target, f"signal={sig} == {target}"

    if typ in {"PRICE_ABOVE", "PRICE_BELOW"}:
        p = await _latest_price(db, alert.stock_id)
        if not p:
            return False, "no_price"
        t = float(cond.get("threshold", 0))
        v = float(p.close or 0)
        if typ == "PRICE_ABOVE":
            return v > t, f"price={v} > {t}"
        return v < t, f"price={v} < {t}"

    return False, f"unknown_type:{typ}"


async def evaluate_all_alerts(db: AsyncSession) -> dict:
    """Evaluate every active, untriggered alert. Returns a small summary dict."""
    rows = await db.execute(
        select(Alert).where(
            and_(Alert.is_active == True, Alert.triggered_at.is_(None))  # noqa: E712
        )
    )
    alerts = list(rows.scalars().all())

    fired = 0
    skipped = 0
    errors = 0
    now = datetime.utcnow()

    for a in alerts:
        if a.alert_type not in SUPPORTED_TYPES:
            skipped += 1
            continue
        try:
            ok, reason = await _condition_met(db, a)
            if ok:
                a.triggered_at = now
                fired += 1
                logger.info("Alert fired: id=%s type=%s reason=%s", a.id, a.alert_type, reason)
        except Exception as e:
            errors += 1
            logger.exception("Alert eval failed for %s: %s", a.id, e)

    if fired or errors:
        await db.flush()

    summary = {"checked": len(alerts), "fired": fired, "skipped": skipped, "errors": errors}
    logger.info("Alert evaluation: %s", summary)
    return summary
