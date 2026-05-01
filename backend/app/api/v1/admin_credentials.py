"""Admin endpoints for managing encrypted external-service credentials.

Currently supports Stockbit session-cookie storage (Phase 2 of the data-source
migration). Designed to be reused for RTI / IDX / etc. by varying service_name.
"""

import json
import logging
import uuid
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_user
from app.clients.stockbit_client import stockbit_client, SERVICE_NAME as STOCKBIT_SERVICE
from app.dependencies import get_db
from app.models.system import ExternalCredential
from app.models.user import User
from app.utils.crypto import encrypt, CryptoConfigError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/admin/credentials", tags=["admin", "credentials"])


class StockbitCookiesPayload(BaseModel):
    """Either a dict {name: value} or an EditThisCookie array of {name, value, ...}."""
    cookies: Any = Field(..., description="Cookies as dict or EditThisCookie array")
    note: str | None = Field(None, max_length=200)


@router.post("/stockbit")
async def upsert_stockbit_session(
    payload: StockbitCookiesPayload,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Paste your Stockbit session cookies (from DevTools or EditThisCookie).
    Stored Fernet-encrypted; never logged or echoed back.
    """
    if not current.is_admin:
        raise HTTPException(403, "Admin only")

    cookies = payload.cookies
    if isinstance(cookies, list):
        # EditThisCookie / Chrome DevTools "Copy all as JSON" format
        norm = {c["name"]: c["value"] for c in cookies
                if isinstance(c, dict) and c.get("name") and c.get("value")}
    elif isinstance(cookies, dict):
        norm = {str(k): str(v) for k, v in cookies.items() if v}
    else:
        raise HTTPException(400, "cookies must be a dict or list of {name, value} objects")

    if not norm:
        raise HTTPException(400, "no cookies parsed from payload")

    try:
        blob = encrypt(json.dumps(norm))
    except CryptoConfigError as e:
        raise HTTPException(500, f"Encryption not configured: {e}")

    # Upsert by service_name
    stmt = pg_insert(ExternalCredential).values(
        id=uuid.uuid4(),
        service_name=STOCKBIT_SERVICE,
        encrypted_blob=blob,
        note=payload.note,
        last_status="VALID",
        last_used_at=None,
    ).on_conflict_do_update(
        index_elements=["service_name"],
        set_={
            "encrypted_blob": blob,
            "note": payload.note,
            "last_status": "VALID",
            "updated_at": datetime.utcnow(),
        },
    )
    await db.execute(stmt)
    await db.commit()

    return {
        "status": "saved",
        "service": STOCKBIT_SERVICE,
        "cookie_count": len(norm),
        "names_preview": sorted(norm.keys())[:8],
    }


@router.get("/stockbit/status")
async def stockbit_session_status(
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    if not current.is_admin:
        raise HTTPException(403, "Admin only")
    return await stockbit_client.session_status(db)


@router.delete("/stockbit")
async def delete_stockbit_session(
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    if not current.is_admin:
        raise HTTPException(403, "Admin only")
    result = await db.execute(
        select(ExternalCredential).where(ExternalCredential.service_name == STOCKBIT_SERVICE)
    )
    cred = result.scalar_one_or_none()
    if cred:
        await db.delete(cred)
        await db.commit()
    return {"status": "deleted"}
