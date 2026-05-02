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


class StockbitTokenPayload(BaseModel):
    """Stockbit bearer token. Accepts a raw JWT string or any JSON shape that
    contains one (e.g. {"token": "..."}, {"authorization": "Bearer ..."}, or
    a legacy EditThisCookie array — the client will extract the eyJ-prefixed
    value)."""
    token: Any = Field(..., description="Bearer JWT (raw eyJ... string or wrapper object)")
    note: str | None = Field(None, max_length=200)


@router.post("/stockbit")
async def upsert_stockbit_session(
    payload: StockbitTokenPayload,
    db: AsyncSession = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Paste your Stockbit bearer JWT (from a logged-in browser session — copy
    the Authorization header value). Stored Fernet-encrypted; never logged
    or echoed back.
    """
    if not current.is_admin:
        raise HTTPException(403, "Admin only")

    raw = payload.token
    # Normalize to a JSON string the client's _extract_token can parse
    if isinstance(raw, str):
        s = raw.strip()
        if s.lower().startswith("bearer "):
            s = s[7:].strip()
        if not s.startswith("eyJ") and "eyJ" not in s:
            raise HTTPException(400, "Token does not look like a JWT (expected to start with 'eyJ')")
        blob_to_store = s if s.startswith("eyJ") else json.dumps({"token": s})
    elif isinstance(raw, (dict, list)):
        blob_to_store = json.dumps(raw)
    else:
        raise HTTPException(400, "token must be a string or JSON object")

    # Validate by extracting + checking exp (don't fail the save if exp parse fails)
    from app.clients.stockbit_client import StockbitClient
    extracted = StockbitClient._extract_token(blob_to_store)
    if not extracted.startswith("eyJ"):
        raise HTTPException(400, "Could not find a JWT in the payload")
    expires_at = StockbitClient.token_expiry(extracted)

    try:
        blob = encrypt(blob_to_store)
    except CryptoConfigError as e:
        raise HTTPException(500, f"Encryption not configured: {e}")

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
        "expires_at": expires_at.isoformat() if expires_at else None,
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
