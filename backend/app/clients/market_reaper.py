"""Market Reaper API client with rate limiting and raw response storage.

This client:
1. Makes HTTP requests to the Market Reaper API on RapidAPI
2. Respects rate limits (2-second delay between calls, 100/min, ~900/month)
3. Stores every raw response in api_raw_responses table
4. Tracks monthly call usage in sync_logs
5. Auto-downgrades to essential-only calls near the monthly limit
"""

import hashlib
import json
import logging
import os
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Optional

import httpx

from app.config import settings
from app.database import async_session
from app.models.system import SyncLog, ApiRawResponse
from app.services import event_bus
from sqlalchemy import select, func

logger = logging.getLogger(__name__)


class RateLimitExceeded(Exception):
    """Raised when monthly API call limit is approached."""
    pass


class MarketReaperClient:
    """Async client for Market Reaper API on RapidAPI with multi-key rotation."""

    BASE_URL = "https://indonesia-stock-exchange-idx.p.rapidapi.com"

    STATE_FILE = Path(os.environ.get("TRADEVELIX_API_STATE", "/tmp/tradevelix_api_state.json"))

    def __init__(self):
        self._keys = settings.rapidapi_keys_list
        if not self._keys:
            self._keys = [settings.RAPIDAPI_KEY]
        self._key_idx = 0  # current active key index
        # Per-key monthly call counters
        self._key_calls: dict[int, int] = {i: 0 for i in range(len(self._keys))}
        # Per-key headroom from RapidAPI's rate-limit headers (truth source after first call)
        self._key_remaining: dict[int, Optional[int]] = {i: None for i in range(len(self._keys))}
        self._key_limit_header: dict[int, Optional[int]] = {i: None for i in range(len(self._keys))}
        self._key_last_call: dict[int, Optional[datetime]] = {i: None for i in range(len(self._keys))}
        self._key_month: dict[int, int] = {i: datetime.utcnow().month for i in range(len(self._keys))}
        # Reasons a key was marked unusable in this process. Cleared on month-rollover
        # for "429_quota"; never cleared for "403_unsubscribed" since that's a config issue.
        self._key_bad: dict[int, str] = {}

        self.rate_limit_seconds = settings.API_RATE_LIMIT_SECONDS
        self.monthly_limit = settings.API_MONTHLY_CALL_LIMIT
        self.daily_limit = settings.API_DAILY_CALL_LIMIT
        self._daily_calls = 0
        self._last_call_time = None
        self._current_month = datetime.utcnow().month
        self._current_day = datetime.utcnow().date()

        self._load_state()

        logger.info(
            "MarketReaperClient: %d API key(s) loaded — effective monthly budget: %d calls",
            len(self._keys), len(self._keys) * self.monthly_limit,
        )

    def _load_state(self):
        """Restore per-key counters from disk so usage survives restarts."""
        try:
            if not self.STATE_FILE.exists():
                return
            with self.STATE_FILE.open("r") as f:
                state = json.load(f)
            now_month = datetime.utcnow().month
            saved_month = state.get("month")
            for i in range(len(self._keys)):
                k = str(i)
                if k not in state.get("keys", {}):
                    continue
                slot = state["keys"][k]
                # Reset if month rolled over
                if saved_month != now_month:
                    self._key_calls[i] = 0
                    self._key_remaining[i] = None
                    continue
                self._key_calls[i] = int(slot.get("calls_used", 0))
                self._key_remaining[i] = slot.get("remaining")
                self._key_limit_header[i] = slot.get("limit")
                last = slot.get("last_call_at")
                self._key_last_call[i] = datetime.fromisoformat(last) if last else None
        except Exception as e:
            logger.warning("Could not restore API state: %s", e)

    def _save_state(self):
        try:
            self.STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
            payload = {
                "month": datetime.utcnow().month,
                "year": datetime.utcnow().year,
                "keys": {
                    str(i): {
                        "calls_used": self._key_calls[i],
                        "remaining": self._key_remaining[i],
                        "limit": self._key_limit_header[i],
                        "last_call_at": self._key_last_call[i].isoformat() if self._key_last_call[i] else None,
                    }
                    for i in range(len(self._keys))
                },
            }
            with self.STATE_FILE.open("w") as f:
                json.dump(payload, f)
        except Exception as e:
            logger.warning("Could not persist API state: %s", e)

    def _capture_rate_limit_headers(self, response: httpx.Response):
        """Read RapidAPI rate-limit headers and update per-key truth state."""
        h = response.headers
        # RapidAPI returns these headers (case-insensitive)
        remaining = h.get("x-ratelimit-requests-remaining")
        limit = h.get("x-ratelimit-requests-limit")
        idx = self._key_idx
        try:
            if remaining is not None:
                self._key_remaining[idx] = int(remaining)
            if limit is not None:
                self._key_limit_header[idx] = int(limit)
            if remaining is not None and limit is not None:
                # Source of truth: the upstream's own counter
                self._key_calls[idx] = max(0, int(limit) - int(remaining))
            self._key_last_call[idx] = datetime.utcnow()
        except (TypeError, ValueError):
            pass

    @property
    def _active_key(self) -> str:
        return self._keys[self._key_idx]

    @property
    def headers(self) -> dict:
        return {
            "x-rapidapi-host": settings.RAPIDAPI_HOST,
            "x-rapidapi-key": self._active_key,
            "Content-Type": "application/json",
        }

    def _rotate_key(self):
        """Move to the next available key that isn't flagged or at its monthly limit."""
        for _ in range(len(self._keys)):
            self._key_idx = (self._key_idx + 1) % len(self._keys)
            now_month = datetime.utcnow().month
            if self._key_month[self._key_idx] != now_month:
                self._key_calls[self._key_idx] = 0
                self._key_month[self._key_idx] = now_month
                # Quota resets on month rollover; subscription status does not
                if self._key_bad.get(self._key_idx) == "429_quota":
                    self._key_bad.pop(self._key_idx, None)
            if self._key_idx in self._key_bad:
                continue
            if self._key_calls[self._key_idx] < self.monthly_limit:
                logger.info("Rotated to API key #%d", self._key_idx + 1)
                return
        bad_summary = ", ".join(f"#{i+1}={r}" for i, r in self._key_bad.items()) or "none flagged"
        raise RateLimitExceeded(
            f"All {len(self._keys)} API keys are unusable "
            f"(monthly_limit={self.monthly_limit}, flagged: {bad_summary})."
        )

    @property
    def _monthly_calls(self) -> int:
        """Total calls across all keys this month."""
        return sum(self._key_calls.values())

    def _pick_least_used_key(self) -> int:
        """Return the index of the least-used non-flagged key with quota left.

        Picks by smallest call count, breaking ties by lowest index. Returns -1
        if every key is unusable (caller should raise RateLimitExceeded).
        """
        now_month = datetime.utcnow().month
        best_idx = -1
        best_calls = None
        for i in range(len(self._keys)):
            # Honor month rollover when comparing
            if self._key_month[i] != now_month:
                self._key_calls[i] = 0
                self._key_month[i] = now_month
                if self._key_bad.get(i) == "429_quota":
                    self._key_bad.pop(i, None)
            if i in self._key_bad:
                continue
            if self._key_calls[i] >= self.monthly_limit:
                self._key_bad[i] = "429_quota"
                continue
            calls = self._key_calls[i]
            if best_calls is None or calls < best_calls:
                best_idx = i
                best_calls = calls
        return best_idx

    async def _track_usage(self):
        """Pick the least-used key, then rate-limit and increment counters."""
        import asyncio
        now = datetime.utcnow()

        # Reset global daily counter
        if now.date() != self._current_day:
            self._daily_calls = 0
            self._current_day = now.date()

        # Round-robin / least-used selection on every call so traffic spreads
        # across all keys instead of draining key#1 first.
        chosen = self._pick_least_used_key()
        if chosen < 0:
            bad_summary = ", ".join(f"#{i+1}={r}" for i, r in self._key_bad.items()) or "all at limit"
            raise RateLimitExceeded(
                f"All {len(self._keys)} API keys unusable (flagged: {bad_summary})."
            )
        if chosen != self._key_idx:
            logger.info("Round-robin: switching to key #%d (calls=%d)", chosen + 1, self._key_calls[chosen])
            self._key_idx = chosen

        # Daily limit check (shared across all keys)
        if self._daily_calls >= self.daily_limit:
            raise RateLimitExceeded(
                f"Daily limit reached ({self._daily_calls}/{self.daily_limit}). Resumes tomorrow."
            )

        # Rate limiting delay
        await asyncio.sleep(self.rate_limit_seconds)

        self._key_calls[self._key_idx] += 1
        self._daily_calls += 1
        self._last_call_time = now

        total = self._monthly_calls
        logger.info(
            "API [key#%d | %d/%d this key | %d total]: %s",
            self._key_idx + 1,
            self._key_calls[self._key_idx],
            self.monthly_limit,
            total,
            "...",  # endpoint logged separately in _request
        )

    async def _request(self, endpoint: str, params: Optional[dict] = None) -> dict:
        """Make a rate-limited API request with key rotation and response storage."""
        await self._track_usage()

        url = f"{self.BASE_URL}{endpoint}"
        logger.info("→ %s  params=%s", endpoint, params)
        ticker = self._extract_ticker(endpoint, params)
        event_bus.emit("api_request", endpoint=endpoint, params=params or {}, ticker=ticker, key_index=self._key_idx + 1)

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.get(url, headers=self.headers, params=params or {})
                self._capture_rate_limit_headers(response)
                response.raise_for_status()
                data = response.json()
                event_bus.emit("api_response", endpoint=endpoint, ticker=ticker, status=response.status_code,
                               key_index=self._key_idx + 1, remaining=self._key_remaining.get(self._key_idx),
                               limit=self._key_limit_header.get(self._key_idx) or self.monthly_limit,
                               used=self._key_calls.get(self._key_idx),
                               size=self._summarize_response(data))
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 429:
                    import asyncio
                    self._capture_rate_limit_headers(e.response)
                    self._key_bad[self._key_idx] = "429_quota"
                    event_bus.emit("api_error", endpoint=endpoint, ticker=ticker, status=429, key_index=self._key_idx + 1, message="rate-limited; flagged 429_quota")
                    logger.warning("429 on key #%d — flagged 429_quota, rotating and retrying in 5s...", self._key_idx + 1)
                    try:
                        self._rotate_key()
                    except RateLimitExceeded:
                        event_bus.emit("api_error", endpoint=endpoint, ticker=ticker, status=429, message="all keys exhausted")
                        logger.error("All keys exhausted on 429.")
                        raise
                    event_bus.emit("key_event", key_index=self._key_idx + 1, action="rotated", reason="after 429")
                    await asyncio.sleep(5)
                    response = await client.get(url, headers=self.headers, params=params or {})
                    self._capture_rate_limit_headers(response)
                    response.raise_for_status()
                    data = response.json()
                    event_bus.emit("api_response", endpoint=endpoint, ticker=ticker, status=response.status_code,
                                   key_index=self._key_idx + 1, remaining=self._key_remaining.get(self._key_idx),
                                   limit=self._key_limit_header.get(self._key_idx) or self.monthly_limit,
                                   used=self._key_calls.get(self._key_idx),
                                   size=self._summarize_response(data), retried=True)
                elif e.response.status_code == 403:
                    self._key_bad[self._key_idx] = "403_unsubscribed"
                    event_bus.emit("api_error", endpoint=endpoint, ticker=ticker, status=403, key_index=self._key_idx + 1, message="forbidden; flagged 403_unsubscribed")
                    logger.warning("403 on key #%d — flagged 403_unsubscribed, rotating and retrying...", self._key_idx + 1)
                    try:
                        self._rotate_key()
                    except RateLimitExceeded:
                        event_bus.emit("api_error", endpoint=endpoint, ticker=ticker, status=403, message="all keys exhausted")
                        logger.error("All keys exhausted on 403.")
                        raise
                    event_bus.emit("key_event", key_index=self._key_idx + 1, action="rotated", reason="after 403")
                    response = await client.get(url, headers=self.headers, params=params or {})
                    self._capture_rate_limit_headers(response)
                    response.raise_for_status()
                    data = response.json()
                    event_bus.emit("api_response", endpoint=endpoint, ticker=ticker, status=response.status_code,
                                   key_index=self._key_idx + 1, remaining=self._key_remaining.get(self._key_idx),
                                   limit=self._key_limit_header.get(self._key_idx) or self.monthly_limit,
                                   used=self._key_calls.get(self._key_idx),
                                   size=self._summarize_response(data), retried=True)
                else:
                    event_bus.emit("api_error", endpoint=endpoint, ticker=ticker, status=e.response.status_code,
                                   key_index=self._key_idx + 1, message=str(e)[:200])
                    logger.error("HTTP %s: %s", e.response.status_code, endpoint)
                    raise
            except httpx.RequestError as e:
                event_bus.emit("api_error", endpoint=endpoint, ticker=ticker, status=0, key_index=self._key_idx + 1, message=f"request error: {e}"[:200])
                logger.error("Request error: %s", e)
                raise

        self._save_state()
        await self._store_raw_response(endpoint, params, data)
        return data

    @staticmethod
    def _extract_ticker(endpoint: str, params: Optional[dict]) -> Optional[str]:
        if params and "symbol" in params:
            return params["symbol"]
        for part in endpoint.split("/"):
            if 3 <= len(part) <= 6 and part.isupper():
                return part
        return None

    @staticmethod
    def _summarize_response(data: Any) -> str:
        """Compact one-line summary of a response payload for the live terminal."""
        try:
            if isinstance(data, dict):
                inner = data.get("data") if isinstance(data.get("data"), (list, dict)) else data
                if isinstance(inner, list):
                    return f"{len(inner)} items"
                if isinstance(inner, dict):
                    return f"{len(inner)} fields"
            if isinstance(data, list):
                return f"{len(data)} items"
        except Exception:
            pass
        return "ok"

    async def _store_raw_response(self, endpoint: str, params: Optional[dict], data: dict):
        """Store the raw API response in the database for later analysis."""
        try:
            async with async_session() as session:
                params_str = json.dumps(params or {}, sort_keys=True)
                params_hash = hashlib.sha256(params_str.encode()).hexdigest()
                
                # Extract stock ticker from endpoint or params
                stock_ticker = None
                if params and "symbol" in params:
                    stock_ticker = params["symbol"]
                else:
                    # Try to extract from endpoint like /api/chart/BBCA/daily
                    parts = endpoint.split("/")
                    for part in parts:
                        if len(part) <= 10 and part.isupper():
                            stock_ticker = part
                            break
                
                raw = ApiRawResponse(
                    endpoint=endpoint,
                    params_hash=params_hash,
                    stock_ticker=stock_ticker,
                    response_data=data,
                )
                session.add(raw)
                await session.commit()
        except Exception as e:
            logger.warning(f"Failed to store raw response: {e}")

    @property
    def usage_stats(self) -> dict:
        """Per-key and aggregate API usage stats.

        `calls_used` and `calls_limit` per key are taken from RapidAPI's
        rate-limit headers when available (truth source) and fall back to
        the configured monthly_limit / local counter before the first call.
        """
        per_key = []
        for i, key in enumerate(self._keys):
            calls = self._key_calls.get(i, 0)
            limit = self._key_limit_header.get(i) or self.monthly_limit
            remaining = self._key_remaining.get(i)
            if remaining is None:
                remaining = max(0, limit - calls)
            last_call = self._key_last_call.get(i)
            per_key.append({
                "key_index": i + 1,
                "key_preview": key[:8] + "...",
                "calls_used": calls,
                "calls_limit": limit,
                "calls_remaining": remaining,
                "active": i == self._key_idx,
                "last_call_at": last_call.isoformat() if last_call else None,
                "header_observed": self._key_remaining.get(i) is not None,
                "flag": self._key_bad.get(i),
            })

        # Sum per-key calls from upstream-truth where available, fall back to local counter
        total = sum(p["calls_used"] for p in per_key)
        effective_limit = sum(p["calls_limit"] for p in per_key)
        return {
            "total_keys": len(self._keys),
            "active_key": self._key_idx + 1,
            "monthly_calls": total,
            "monthly_limit": effective_limit,
            "monthly_remaining": max(0, effective_limit - total),
            "daily_calls": self._daily_calls,
            "daily_limit": self.daily_limit,
            "daily_remaining": max(0, self.daily_limit - self._daily_calls),
            "plan": settings.API_PLAN,
            "per_key": per_key,
        }

    # ════════════════════════════════════════════════════════════
    # DAILY SYNC ENDPOINTS (~27 calls/day)
    # ════════════════════════════════════════════════════════════

    async def get_daily_prices(self, symbol: str, limit: int = 30) -> dict:
        """Get OHLCV data with foreign flow. 1 call = 30 days of data."""
        return await self._request(
            f"/api/chart/{symbol}/daily/latest",
            params={"limit": limit}
        )

    async def get_trending(self) -> dict:
        """Get trending stocks. 1 call."""
        return await self._request("/api/main/trending")

    async def get_movers(self, mover_type: str) -> dict:
        """Get top movers. Types: top-gainer, top-loser, top-volume, net-foreign-buy."""
        return await self._request(f"/api/movers/{mover_type}")

    async def get_morning_briefing(self) -> dict:
        """Get morning briefing. 1 call."""
        return await self._request("/api/main/morning-briefing")

    # ════════════════════════════════════════════════════════════
    # WEEKLY SYNC ENDPOINTS (~60 calls/week)
    # ════════════════════════════════════════════════════════════

    async def get_broker_summary(self, symbol: str, from_date: str, to_date: str,
                                  transaction_type: str = "TRANSACTION_TYPE_NET",
                                  market_board: str = "MARKET_BOARD_ALL",
                                  investor_type: str = "INVESTOR_TYPE_ALL") -> dict:
        """Get aggregated broker summary for a date range."""
        return await self._request(
            f"/api/market-detector/broker-summary/{symbol}",
            params={
                "from": from_date,
                "to": to_date,
                "transactionType": transaction_type,
                "marketBoard": market_board,
                "investorType": investor_type,
            }
        )

    async def get_accumulation(self, symbol: str, days: int = 30) -> dict:
        """Get bandar accumulation analysis."""
        return await self._request(
            f"/api/analysis/bandar/accumulation/{symbol}",
            params={"days": days}
        )

    async def get_distribution(self, symbol: str, days: int = 30) -> dict:
        """Get bandar distribution analysis."""
        return await self._request(
            f"/api/analysis/bandar/distribution/{symbol}",
            params={"days": days}
        )

    async def get_smart_money(self, symbol: str, days: int = 30) -> dict:
        """Get smart money flow analysis."""
        return await self._request(
            f"/api/analysis/bandar/smart-money/{symbol}",
            params={"days": days}
        )

    async def get_sentiment(self, symbol: str, days: int = 7) -> dict:
        """Get retail vs bandar sentiment."""
        return await self._request(
            f"/api/analysis/sentiment/{symbol}",
            params={"days": days}
        )

    async def get_pump_dump(self, symbol: str, days: int = 14) -> dict:
        """Get pump & dump detection."""
        return await self._request(
            f"/api/analysis/bandar/pump-dump/{symbol}",
            params={"days": days}
        )

    async def get_insiders(self, symbols: str) -> dict:
        """Get insider trading data. Can batch multiple symbols."""
        return await self._request(
            "/api/emiten/insider",
            params={"symbols": symbols}
        )

    async def get_broker_codes(self) -> dict:
        """Get all broker codes and names."""
        return await self._request("/api/main/broker-codes")

    async def get_sectors(self) -> dict:
        """Get all IDX sectors."""
        return await self._request("/api/sectors")

    # ════════════════════════════════════════════════════════════
    # MONTHLY SYNC ENDPOINTS (~20 calls/month)
    # ════════════════════════════════════════════════════════════

    async def get_stock_info(self, symbol: str) -> dict:
        """Get stock master info (name, sector, market cap)."""
        return await self._request(f"/api/emiten/{symbol}/info")

    async def get_foreign_ownership(self, symbol: str) -> dict:
        """Get foreign institutional ownership %."""
        return await self._request(f"/api/emiten/{symbol}/foreign-ownership")

    # ════════════════════════════════════════════════════════════
    # ON-DEMAND ENDPOINTS (use sparingly)
    # ════════════════════════════════════════════════════════════

    async def get_stock_detail(self, symbol: str) -> dict:
        """Get full stock detail page data."""
        return await self._request(f"/api/emiten/{symbol}/info")

    async def get_whale_transactions(self, symbol: str, min_lot: int = 500) -> dict:
        """Get whale transaction detection."""
        return await self._request(
            f"/api/analysis/whale-transactions/{symbol}",
            params={"min_lot": min_lot}
        )


# Singleton client instance
api_client = MarketReaperClient()