"""Stockbit scraper for broker-level data.

Uses session cookies stored encrypted in the external_credentials table.
The admin pastes their browser session JSON via /api/v1/admin/credentials/stockbit;
this client reads + decrypts those cookies before each request.

Phase 2 status: scaffolding in place. The actual broker-summary endpoint URL
and response parser will be wired once we capture a real Stockbit network
request (Chrome DevTools → Network tab → broker-summary call → "Copy as
fetch") — see TODO blocks below.
"""

import asyncio
import json
import logging
from datetime import date, datetime
from typing import Any, Optional

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.system import ExternalCredential
from app.services import event_bus
from app.utils.crypto import decrypt

logger = logging.getLogger(__name__)


SERVICE_NAME = "stockbit"
BASE_URL = "https://stockbit.com"
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    "Origin": BASE_URL,
    "Referer": f"{BASE_URL}/",
}


class StockbitSessionMissing(Exception):
    """Raised when no valid session cookie is configured."""


class StockbitSessionExpired(Exception):
    """Raised on 401/403 — admin needs to re-paste cookies."""


class StockbitClient:
    """Async-only Stockbit client. Reads encrypted cookies once per request session."""

    def __init__(self):
        self._cookies: Optional[dict[str, str]] = None
        self._cred_id: Optional[Any] = None  # for last_used_at update

    async def _load_cookies(self, db: AsyncSession) -> dict[str, str]:
        """Load + decrypt cookies from the DB. Returns dict suitable for httpx."""
        if self._cookies is not None:
            return self._cookies
        result = await db.execute(
            select(ExternalCredential).where(ExternalCredential.service_name == SERVICE_NAME)
        )
        cred = result.scalar_one_or_none()
        if not cred:
            raise StockbitSessionMissing(
                "No Stockbit session configured. Paste your browser cookies in /admin → API & System → Stockbit Session."
            )
        try:
            blob = decrypt(cred.encrypted_blob if isinstance(cred.encrypted_blob, str) else cred.encrypted_blob.decode())
        except Exception as e:
            raise StockbitSessionMissing(f"Stored Stockbit session is unreadable: {e}") from e
        try:
            cookies = json.loads(blob)
            if isinstance(cookies, list):
                # Accept the EditThisCookie / DevTools "Copy as cURL" array format
                cookies = {c["name"]: c["value"] for c in cookies if c.get("name") and c.get("value")}
            elif not isinstance(cookies, dict):
                raise ValueError("Cookies must be a dict or EditThisCookie list")
        except Exception as e:
            raise StockbitSessionMissing(f"Stored Stockbit cookies are not valid JSON: {e}") from e
        self._cookies = cookies
        self._cred_id = cred.id
        return cookies

    async def get_broker_summary(
        self, db: AsyncSession, ticker: str, from_date: date, to_date: date
    ) -> dict:
        """Return broker buy/sell aggregates in a shape compatible with
        sync_service._persist_broker_summary's expected JSON.

        # TODO(phase 2 wiring): replace placeholder URL + parser once we have
        a real Stockbit network capture. Expected target shape:
            {
                "from": "YYYY-MM-DD", "to": "YYYY-MM-DD",
                "brokers_buy":  [{"code": "AI", "name": "...", "lots": ..., "value": ..., "frequency": ...}, ...],
                "brokers_sell": [{"code": "BK", ...}, ...],
            }
        """
        cookies = await self._load_cookies(db)
        # PLACEHOLDER: real path TBD from a captured request. The shape below
        # is a likely Stockbit pattern — this will need adjusting.
        url = f"{BASE_URL}/api/internal/v6/broker-summary/{ticker}"
        params = {
            "from": from_date.isoformat(),
            "to": to_date.isoformat(),
        }
        event_bus.emit("api_request", endpoint=url, params=params, ticker=ticker)
        async with httpx.AsyncClient(timeout=30.0, headers=DEFAULT_HEADERS, cookies=cookies) as client:
            try:
                response = await client.get(url, params=params)
            except httpx.RequestError as e:
                event_bus.emit("api_error", endpoint=url, ticker=ticker, status=0,
                               message=f"network: {e}"[:200])
                raise

            if response.status_code in (401, 403):
                event_bus.emit("api_error", endpoint=url, ticker=ticker,
                               status=response.status_code,
                               message="Stockbit session expired — re-paste cookies in /admin")
                await self._mark_status(db, "EXPIRED")
                raise StockbitSessionExpired(
                    f"Stockbit returned {response.status_code} — session likely expired"
                )

            response.raise_for_status()
            data = response.json()

        await self._mark_status(db, "VALID")
        normalized = self._normalize_broker_summary(data, from_date, to_date)
        event_bus.emit(
            "api_response", endpoint=url, ticker=ticker, status=response.status_code,
            size=f"buy={len(normalized.get('brokers_buy', []))} sell={len(normalized.get('brokers_sell', []))}",
        )
        return normalized

    @staticmethod
    def _normalize_broker_summary(data: Any, from_date: date, to_date: date) -> dict:
        """Adapt Stockbit's response to the shape sync_service expects.

        # TODO(phase 2 wiring): implement the actual field mapping once we
        have a sample response. Returning an empty shell for now so callers
        don't crash and the live terminal shows a 'parsed 0' line.
        """
        # Best-effort guess — Stockbit responses tend to nest under `data`
        rows = data
        if isinstance(data, dict):
            rows = data.get("data", data)
        return {
            "from": from_date.isoformat(),
            "to": to_date.isoformat(),
            "brokers_buy": [],
            "brokers_sell": [],
            "_raw": rows,  # keep raw payload for manual inspection during phase 2 wiring
        }

    async def _mark_status(self, db: AsyncSession, status: str) -> None:
        if not self._cred_id:
            return
        from sqlalchemy import update
        await db.execute(
            update(ExternalCredential)
            .where(ExternalCredential.id == self._cred_id)
            .values(last_used_at=datetime.utcnow(), last_status=status)
        )

    async def session_status(self, db: AsyncSession) -> dict:
        """Lightweight check used by the admin UI without doing a real scrape."""
        result = await db.execute(
            select(ExternalCredential).where(ExternalCredential.service_name == SERVICE_NAME)
        )
        cred = result.scalar_one_or_none()
        if not cred:
            return {"present": False, "status": None, "last_used_at": None, "note": None}
        return {
            "present": True,
            "status": cred.last_status,
            "last_used_at": cred.last_used_at.isoformat() if cred.last_used_at else None,
            "note": cred.note,
            "created_at": cred.created_at.isoformat() if cred.created_at else None,
        }


stockbit_client = StockbitClient()
