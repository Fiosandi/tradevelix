"""yfinance OHLCV adapter for Indonesian Stock Exchange tickers.

Yahoo Finance carries IDX stocks under the ".JK" suffix (e.g. BBCA.JK).
This client returns data in the same shape as MarketReaperClient.get_daily_prices
so sync_service.sync_daily_prices doesn't need to change beyond the call site.

Limitations vs the upstream RapidAPI feed:
- No foreign-flow data (foreign_buy, foreign_sell, foreign_flow → None)
- No transaction-frequency count (frequency → None)
- shares_outstanding fetched on demand from yfinance.info (cached)
- value (IDR turnover) approximated as close * volume

These gaps are acceptable: the calculation engine doesn't read these fields.
The dashboard's foreign-flow chart will render empty until Phase 2 (Stockbit)
backfills foreign_flow from broker-level data.
"""

import asyncio
import logging
from datetime import date, datetime
from typing import Any, Optional

import yfinance as yf

from app.services import event_bus

logger = logging.getLogger(__name__)


class YFinanceClient:
    """Async-friendly wrapper over yfinance. yfinance itself is sync, so we
    run its calls in a thread executor to avoid blocking the event loop."""

    SUFFIX = ".JK"  # Yahoo Finance suffix for IDX stocks

    def __init__(self):
        # shares_outstanding is fairly stable; cache to skip extra info() lookups
        self._shares_cache: dict[str, int] = {}

    async def get_daily_prices(self, symbol: str, limit: int = 30) -> dict:
        """Return OHLCV in the chartbit-shaped envelope the sync code expects.

        Args:
            symbol: bare IDX ticker (e.g. 'BBCA'); the .JK suffix is added here
            limit: number of trading days (yfinance period mapping is approximate)
        """
        yf_symbol = f"{symbol}{self.SUFFIX}"
        period = self._period_for(limit)

        event_bus.emit("api_request", endpoint="yfinance/history",
                       params={"symbol": yf_symbol, "period": period},
                       ticker=symbol, key_index=0)

        try:
            chartbit = await asyncio.to_thread(self._fetch_history, yf_symbol, period, limit)
        except Exception as e:
            event_bus.emit("api_error", endpoint="yfinance/history", ticker=symbol,
                           status=0, message=f"yfinance error: {e}"[:200])
            logger.error("yfinance fetch failed for %s: %s", yf_symbol, e)
            return {"success": False, "error": str(e), "data": {"data": {"chartbit": []}}}

        event_bus.emit("api_response", endpoint="yfinance/history", ticker=symbol,
                       status=200, key_index=0, size=f"{len(chartbit)} candles")

        return {"success": True, "data": {"data": {"chartbit": chartbit}}}

    @staticmethod
    def _period_for(limit: int) -> str:
        """Map a 'days' limit to yfinance's period string. yfinance rounds up,
        so a couple of extra days won't matter — we trim by limit later."""
        if limit <= 5:   return "5d"
        if limit <= 30:  return "1mo"
        if limit <= 90:  return "3mo"
        if limit <= 180: return "6mo"
        if limit <= 365: return "1y"
        if limit <= 730: return "2y"
        return "5y"

    def _fetch_history(self, yf_symbol: str, period: str, limit: int) -> list[dict]:
        """Sync yfinance call (run in thread). Returns chartbit-shaped list."""
        ticker = yf.Ticker(yf_symbol)
        # auto_adjust=False so close matches IDX raw close (no split/div adjustment)
        hist = ticker.history(period=period, auto_adjust=False)
        if hist is None or hist.empty:
            return []

        shares = self._get_shares_outstanding(ticker, yf_symbol)

        candles: list[dict] = []
        for ts, row in hist.iterrows():
            try:
                close = float(row["Close"])
                volume = int(row["Volume"]) if not _is_nan(row["Volume"]) else 0
                candle_date = ts.date() if hasattr(ts, "date") else ts
                candles.append({
                    "date": candle_date.isoformat(),
                    "open": float(row["Open"]) if not _is_nan(row["Open"]) else None,
                    "high": float(row["High"]) if not _is_nan(row["High"]) else None,
                    "low":  float(row["Low"])  if not _is_nan(row["Low"])  else None,
                    "close": close,
                    "volume": volume,
                    "value": int(close * volume) if volume else None,
                    "foreignbuy": None,
                    "foreignsell": None,
                    "foreignflow": None,
                    "frequency": None,
                    "shareoutstanding": shares,
                })
            except (TypeError, ValueError, KeyError) as e:
                logger.debug("Skipping malformed yfinance row for %s: %s", yf_symbol, e)
                continue

        # yfinance period rounds up; trim to requested limit (newest at end)
        return candles[-limit:] if len(candles) > limit else candles

    def _get_shares_outstanding(self, ticker: "yf.Ticker", yf_symbol: str) -> Optional[int]:
        """Fetch and cache shares_outstanding. Best-effort — None on failure."""
        if yf_symbol in self._shares_cache:
            return self._shares_cache[yf_symbol]
        try:
            info = ticker.info or {}
            shares = info.get("sharesOutstanding") or info.get("impliedSharesOutstanding")
            if shares:
                self._shares_cache[yf_symbol] = int(shares)
                return int(shares)
        except Exception as e:
            logger.debug("Could not fetch shares_outstanding for %s: %s", yf_symbol, e)
        return None


def _is_nan(x: Any) -> bool:
    """Pandas/numpy NaN check that doesn't import numpy."""
    try:
        return x != x  # NaN is the only value that != itself
    except Exception:
        return False


# Singleton
yfinance_client = YFinanceClient()
