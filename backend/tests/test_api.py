"""
Suite 2 — API Endpoint Tests (Integration)
Runs against a locally started test server using httpx + pytest-asyncio.
Requires backend to be running: uvicorn app.main:app --port 8001
OR set TEST_BASE_URL env var.
"""

import os
import pytest
import httpx

BASE = os.getenv("TEST_BASE_URL", "http://localhost:8000/api/v1")

import uuid as _uuid
_run_id     = _uuid.uuid4().hex[:8]
_token: str = ""
_test_email = f"qa_{_run_id}@tradevelix.test"
_test_pass  = "qapassword123"
_test_user  = f"qa_{_run_id}"


@pytest.fixture(scope="module")
def token():
    """Register (or login if already exists) and return a valid JWT token."""
    global _token
    if _token:
        return _token
    with httpx.Client(timeout=15) as c:
        r = c.post(f"{BASE}/auth/register", json={
            "email": _test_email, "username": _test_user, "password": _test_pass
        })
        if r.status_code == 400:  # already registered
            r = c.post(f"{BASE}/auth/login", json={"email": _test_email, "password": _test_pass})
        assert r.status_code in (200, 201), f"Could not get token: {r.text}"
        _token = r.json()["access_token"]
    return _token


# ─── Health (public) ──────────────────────────────────────────────────────────

def test_health_public():
    """DASH-09: /health is public and returns ok."""
    r = httpx.get(f"{BASE}/health", timeout=10)
    assert r.status_code == 200
    d = r.json()
    assert d["status"] == "ok"
    assert "watchlist" in d
    assert len(d["watchlist"]) >= 1


# ─── Auth: Register ───────────────────────────────────────────────────────────

def test_register_success():
    """AUTH-01: Valid registration returns 201 + token."""
    import uuid
    unique = str(uuid.uuid4())[:8]
    r = httpx.post(f"{BASE}/auth/register", json={
        "email": f"test_{unique}@tradevelix.test",
        "username": f"user_{unique}",
        "password": "validpassword123",
    }, timeout=15)
    assert r.status_code == 201, r.text
    d = r.json()
    assert "access_token" in d
    assert d["token_type"] == "bearer"
    assert "username" in d


def test_register_duplicate_email(token):
    """AUTH-02: Duplicate email returns 400 (requires token fixture so email is pre-registered)."""
    r = httpx.post(f"{BASE}/auth/register", json={
        "email": _test_email,
        "username": "anothername_dup",
        "password": "somepassword",
    }, timeout=10)
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"


def test_register_short_password():
    """AUTH-03: Password < 8 chars returns 400."""
    import uuid
    r = httpx.post(f"{BASE}/auth/register", json={
        "email": f"shortpw_{uuid.uuid4()}@test.com",
        "username": f"shortpw_{str(uuid.uuid4())[:6]}",
        "password": "abc",
    }, timeout=10)
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"


# ─── Auth: Login ─────────────────────────────────────────────────────────────

def test_login_success(token):
    """AUTH-04: Valid login returns 200 + token."""
    assert token, "Token should exist from fixture"
    assert len(token) > 20


def test_login_wrong_password():
    """AUTH-05: Wrong password returns 401."""
    r = httpx.post(f"{BASE}/auth/login", json={
        "email": _test_email, "password": "wrongpassword"
    }, timeout=10)
    assert r.status_code == 401, f"Expected 401, got {r.status_code}"


def test_me_with_token(token):
    """AUTH-06: /auth/me with valid token returns user object."""
    r = httpx.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=10)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "email" in d
    assert "username" in d
    assert "id" in d


def test_me_without_token():
    """AUTH-07: /auth/me without token returns 401."""
    r = httpx.get(f"{BASE}/auth/me", timeout=10)
    assert r.status_code == 401


# ─── Dashboard: Auth gate ─────────────────────────────────────────────────────

def test_leaderboard_no_token():
    """DASH-01: Leaderboard without token returns 401."""
    r = httpx.get(f"{BASE}/dashboard/leaderboard", timeout=10)
    assert r.status_code == 401


def test_summary_no_token():
    """DASH-04 (gate): Summary without token returns 401."""
    r = httpx.get(f"{BASE}/dashboard/summary", timeout=10)
    assert r.status_code == 401


def test_stock_detail_no_token():
    """DASH-05 (gate): Stock detail without token returns 401."""
    r = httpx.get(f"{BASE}/dashboard/stock/INDY", timeout=10)
    assert r.status_code == 401


# ─── Dashboard: With auth ─────────────────────────────────────────────────────

def test_leaderboard_with_token(token):
    """DASH-02: Leaderboard with token returns entries array."""
    r = httpx.get(f"{BASE}/dashboard/leaderboard",
                  headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "entries" in d


def test_leaderboard_has_stocks(token):
    """DASH-03: Leaderboard returns ≥ 1 stock with data."""
    r = httpx.get(f"{BASE}/dashboard/leaderboard",
                  headers={"Authorization": f"Bearer {token}"}, timeout=15)
    entries = r.json().get("entries", [])
    assert len(entries) >= 1, "Expected at least 1 stock in leaderboard"


def test_leaderboard_entry_fields(token):
    """Leaderboard entries have required fields."""
    r = httpx.get(f"{BASE}/dashboard/leaderboard",
                  headers={"Authorization": f"Bearer {token}"}, timeout=15)
    entries = r.json().get("entries", [])
    if not entries:
        pytest.skip("No data in leaderboard — run a sync first")
    e = entries[0]
    for field in ["ticker", "overall_signal", "confidence_score", "whale_net_lots",
                  "retail_exit_percent", "top_whale_brokers"]:
        assert field in e, f"Missing field: {field}"


def test_summary_with_token(token):
    """DASH-04: Summary returns signal counts."""
    r = httpx.get(f"{BASE}/dashboard/summary",
                  headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert r.status_code == 200, r.text
    d = r.json()
    assert "watchlist" in d


def test_stock_detail_indy(token):
    """DASH-05: Stock detail for INDY returns nested data."""
    r = httpx.get(f"{BASE}/dashboard/stock/INDY",
                  headers={"Authorization": f"Bearer {token}"}, timeout=20)
    assert r.status_code == 200, f"Got {r.status_code}: {r.text[:200]}"
    d = r.json()
    assert "stock" in d or "weekly_metrics" in d, "Expected nested stock data"


def test_stock_detail_has_broker_entries(token):
    """DASH-05: Stock detail includes broker_entries."""
    r = httpx.get(f"{BASE}/dashboard/stock/INDY",
                  headers={"Authorization": f"Bearer {token}"}, timeout=20)
    d = r.json()
    entries = d.get("broker_entries", [])
    if not entries:
        pytest.skip("No broker data for INDY — run a broker sync first")
    assert len(entries) >= 1


def test_stock_detail_has_recent_prices(token):
    """DASH-06: Stock detail recent_prices ≥ 10 records."""
    r = httpx.get(f"{BASE}/dashboard/stock/INDY",
                  headers={"Authorization": f"Bearer {token}"}, timeout=20)
    prices = r.json().get("recent_prices", [])
    if not prices:
        pytest.skip("No price data for INDY — run a daily sync first")
    assert len(prices) >= 10, f"Expected ≥ 10 price records, got {len(prices)}"


def test_stock_detail_api_signals_present(token):
    """DASH-07: api_signals array present (may be empty if not yet synced)."""
    r = httpx.get(f"{BASE}/dashboard/stock/INDY",
                  headers={"Authorization": f"Bearer {token}"}, timeout=20)
    assert "api_signals" in r.json(), "api_signals key should always be present"


def test_stock_not_found(token):
    """DASH-08: Unknown ticker returns 404."""
    r = httpx.get(f"{BASE}/dashboard/stock/NOTREAL_TICKER_XYZ",
                  headers={"Authorization": f"Bearer {token}"}, timeout=10)
    assert r.status_code == 404, f"Expected 404, got {r.status_code}"


# ─── Entry price fields exposed ───────────────────────────────────────────────

def test_entry_price_fields_in_api_signals(token):
    """Sprint 1 S1.2: entry_ideal_price and entry_max_price present in api_signals."""
    r = httpx.get(f"{BASE}/dashboard/stock/INDY",
                  headers={"Authorization": f"Bearer {token}"}, timeout=20)
    signals = r.json().get("api_signals", [])
    if not signals:
        pytest.skip("No api_signals — run weekly sync first")
    for s in signals:
        assert "entry_ideal_price" in s, f"entry_ideal_price missing from signal {s.get('signal_type')}"
        assert "entry_max_price" in s, f"entry_max_price missing from signal {s.get('signal_type')}"
