"""Stockbit scraper for broker-level data via exodus.stockbit.com.

Auth: a Bearer JWT pasted by the admin (from a logged-in browser session).
Stored Fernet-encrypted in external_credentials. Token validity is ~24h
based on the JWT exp claim — after that the admin re-pastes.

Endpoint reverse-engineered from a captured request:
    GET https://exodus.stockbit.com/marketdetectors/{TICKER}
        ?transaction_type=TRANSACTION_TYPE_NET
        &market_board=MARKET_BOARD_REGULER
        &investor_type=INVESTOR_TYPE_ALL
        &limit=200
        [&from=YYYY-MM-DD&to=YYYY-MM-DD]   <- date range (defaults to today)

Response shape lives at data.broker_summary.{brokers_buy, brokers_sell}
plus data.bandar_detector summary stats. Field names already match what
sync_service._persist_broker_summary expects (netbs_broker_code, blot,
bval, slot, sval, netbs_buy_avg_price, freq, type) — no remapping needed,
just numeric coercion (Stockbit returns scientific-notation strings).
"""

import asyncio
import base64
import json
import logging
import random
from datetime import date, datetime
from typing import Any, Optional

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.system import ExternalCredential
from app.services import event_bus
from app.utils.crypto import decrypt

logger = logging.getLogger(__name__)


SERVICE_NAME = "stockbit"
BASE_URL = "https://exodus.stockbit.com"
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    "Accept": "application/json",
    "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
    "Origin": "https://stockbit.com",
    "Referer": "https://stockbit.com/",
}


class StockbitSessionMissing(Exception):
    """Raised when no Stockbit token has been configured."""


class StockbitSessionExpired(Exception):
    """Raised on 401/403 — admin needs to re-paste their bearer token."""


class StockbitClient:
    """Async-only Stockbit client backed by an admin-supplied bearer JWT."""

    def __init__(self):
        self._token: Optional[str] = None
        self._cred_id: Optional[Any] = None

    async def _load_token(self, db: AsyncSession) -> str:
        """Load + decrypt the stored bearer token. Caches per-instance."""
        if self._token is not None:
            return self._token
        result = await db.execute(
            select(ExternalCredential).where(ExternalCredential.service_name == SERVICE_NAME)
        )
        cred = result.scalar_one_or_none()
        if not cred:
            raise StockbitSessionMissing(
                "No Stockbit token configured. Paste your bearer token in /admin → API & System → Stockbit Session."
            )
        try:
            blob = decrypt(cred.encrypted_blob)
        except Exception as e:
            raise StockbitSessionMissing(f"Stored Stockbit token is unreadable: {e}") from e
        token = self._extract_token(blob)
        self._token = token
        self._cred_id = cred.id
        return token

    @staticmethod
    def _extract_token(blob: str) -> str:
        """Accept several paste formats:
           - raw JWT string ("eyJ...")
           - {"token": "eyJ..."} or {"authorization": "Bearer eyJ..."}
           - EditThisCookie array (legacy fallback) — first cookie value used
        """
        s = blob.strip()
        if s.startswith("eyJ"):
            return s
        try:
            obj = json.loads(s)
        except Exception:
            return s  # treat as raw token
        if isinstance(obj, dict):
            for key in ("token", "bearer", "authorization", "access_token", "jwt"):
                if obj.get(key):
                    val = str(obj[key]).strip()
                    return val[7:] if val.lower().startswith("bearer ") else val
            # Fallback: first eyJ-prefixed value anywhere
            for v in obj.values():
                if isinstance(v, str) and v.startswith("eyJ"):
                    return v
        if isinstance(obj, list):
            for c in obj:
                if isinstance(c, dict) and isinstance(c.get("value"), str) and c["value"].startswith("eyJ"):
                    return c["value"]
        return s

    @staticmethod
    def token_expiry(token: str) -> Optional[datetime]:
        """Decode JWT exp claim without validation. Returns None on failure."""
        try:
            parts = token.split(".")
            if len(parts) != 3:
                return None
            payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
            payload = json.loads(base64.urlsafe_b64decode(payload_b64))
            exp = payload.get("exp")
            return datetime.utcfromtimestamp(int(exp)) if exp else None
        except Exception:
            return None

    async def get_broker_summary(
        self, db: AsyncSession, ticker: str, from_date: date, to_date: date, limit: int = 200
    ) -> dict:
        """Fetch and return broker summary in the shape sync_service expects:
            {
              "success": True,
              "data": {
                "bandar_detector": {...},
                "broker_summary": {"brokers_buy": [...], "brokers_sell": [...]},
                "from": "YYYY-MM-DD", "to": "YYYY-MM-DD",
              }
            }
        Numeric strings (e.g. "4.99e+06") are coerced to numbers so
        the existing parser's int()/Decimal() calls succeed.
        """
        token = await self._load_token(db)
        url = f"{BASE_URL}/marketdetectors/{ticker}"
        params = {
            "transaction_type": "TRANSACTION_TYPE_NET",
            "market_board": "MARKET_BOARD_REGULER",
            "investor_type": "INVESTOR_TYPE_ALL",
            "limit": limit,
            "from": from_date.isoformat(),
            "to": to_date.isoformat(),
        }
        headers = {**DEFAULT_HEADERS, "Authorization": f"Bearer {token}"}

        event_bus.emit("api_request", endpoint=f"stockbit/marketdetectors/{ticker}",
                       params={"from": params["from"], "to": params["to"], "limit": limit},
                       ticker=ticker)

        async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
            try:
                response = await client.get(url, params=params)
            except httpx.RequestError as e:
                event_bus.emit("api_error", endpoint=url, ticker=ticker, status=0,
                               message=f"network: {e}"[:200])
                raise

            # Honor a soft-throttle: one polite retry after Retry-After (or 60s),
            # then give up. Beats hammering through and getting the JWT flagged.
            if response.status_code == 429:
                retry_after_hdr = response.headers.get("Retry-After", "60")
                try:
                    wait = min(int(retry_after_hdr), 300)  # cap at 5 min
                except ValueError:
                    wait = 60
                wait += random.uniform(0.5, 2.0)  # jitter so retries don't synchronize
                event_bus.emit("api_error", endpoint=url, ticker=ticker,
                               status=429, message=f"throttled, sleeping {wait:.1f}s")
                logger.warning("Stockbit 429 on %s — sleeping %.1fs before retry", ticker, wait)
                await asyncio.sleep(wait)
                response = await client.get(url, params=params)

        if response.status_code in (401, 403):
            event_bus.emit("api_error", endpoint=url, ticker=ticker,
                           status=response.status_code,
                           message="Stockbit token expired or revoked — re-paste in /admin")
            await self._mark_status(db, "EXPIRED")
            raise StockbitSessionExpired(
                f"Stockbit returned {response.status_code}; bearer token likely expired."
            )

        response.raise_for_status()
        data = response.json()
        await self._mark_status(db, "VALID")

        normalized = self._normalize_broker_summary(data, from_date, to_date)
        broker_summary = normalized.get("data", {}).get("broker_summary", {})
        event_bus.emit(
            "api_response", endpoint=f"stockbit/marketdetectors/{ticker}",
            ticker=ticker, status=response.status_code,
            size=f"buy={len(broker_summary.get('brokers_buy', []))} sell={len(broker_summary.get('brokers_sell', []))}",
        )
        return normalized

    @staticmethod
    def _coerce_numeric_strings(d: dict, keys: tuple[str, ...]) -> None:
        """Stockbit returns lots/values as strings like '4.990351e+06'.
        Convert to int/float in place so downstream int()/Decimal() calls work."""
        for k in keys:
            v = d.get(k)
            if isinstance(v, str):
                try:
                    d[k] = float(v)  # Decimal(str(float(v))) works downstream
                except ValueError:
                    pass

    @classmethod
    def _normalize_broker_summary(cls, data: Any, from_date: date, to_date: date) -> dict:
        """Coerce numeric strings; otherwise pass-through (field names match)."""
        # Stockbit response wraps under "data"; we re-wrap as RapidAPI did
        # (data.data.broker_summary structure).
        inner = data.get("data", data) if isinstance(data, dict) else {}
        broker_summary = inner.get("broker_summary", {})

        for entry in broker_summary.get("brokers_buy", []):
            cls._coerce_numeric_strings(entry, ("blot", "blotv", "bval", "bvalv", "freq"))
        for entry in broker_summary.get("brokers_sell", []):
            cls._coerce_numeric_strings(entry, ("slot", "slotv", "sval", "svalv", "freq"))

        return {
            "success": True,
            "data": {
                "bandar_detector": inner.get("bandar_detector", {}),
                "broker_summary": broker_summary,
                "from": inner.get("from", from_date.isoformat()),
                "to": inner.get("to", to_date.isoformat()),
            },
        }

    async def _mark_status(self, db: AsyncSession, status: str) -> None:
        if not self._cred_id:
            return
        await db.execute(
            update(ExternalCredential)
            .where(ExternalCredential.id == self._cred_id)
            .values(last_used_at=datetime.utcnow(), last_status=status)
        )

    async def session_status(self, db: AsyncSession) -> dict:
        result = await db.execute(
            select(ExternalCredential).where(ExternalCredential.service_name == SERVICE_NAME)
        )
        cred = result.scalar_one_or_none()
        if not cred:
            return {"present": False, "status": None, "last_used_at": None, "note": None, "expires_at": None}
        # Decode token to surface expiry without exposing the token itself
        expires_at = None
        try:
            tok = decrypt(cred.encrypted_blob)
            tok = self._extract_token(tok)
            exp = self.token_expiry(tok)
            expires_at = exp.isoformat() if exp else None
        except Exception:
            pass
        return {
            "present": True,
            "status": cred.last_status,
            "last_used_at": cred.last_used_at.isoformat() if cred.last_used_at else None,
            "note": cred.note,
            "created_at": cred.created_at.isoformat() if cred.created_at else None,
            "expires_at": expires_at,
        }


stockbit_client = StockbitClient()
