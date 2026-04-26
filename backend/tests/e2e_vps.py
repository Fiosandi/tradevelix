"""
Suite 3 — E2E API Flow Tests against live VPS
Runs a full user journey: register → login → leaderboard → stock detail → security checks.

Usage:
    python tests/e2e_vps.py
    python tests/e2e_vps.py --base http://localhost:8000/api/v1
"""

import sys
import httpx
import json
import uuid
import time
from datetime import datetime

BASE = "http://43.134.173.106/api/v1"
if "--base" in sys.argv:
    idx = sys.argv.index("--base")
    BASE = sys.argv[idx + 1]

PASS = " PASS"
FAIL = " FAIL"

results = []


def check(test_id: str, description: str, condition: bool, detail: str = ""):
    status = PASS if condition else FAIL
    icon = "OK" if condition else "XX"
    print(f"  [{icon}] {test_id:10} {description}")
    if not condition and detail:
        print(f"           >> {detail}")
    results.append({"id": test_id, "desc": description, "passed": condition})
    return condition


def run():
    print(f"\n{'='*60}")
    print(f"  Tradevelix E2E Test Suite")
    print(f"  Target: {BASE}")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    c = httpx.Client(timeout=20, follow_redirects=True)
    token = ""
    uid = str(uuid.uuid4())[:8]
    email = f"e2e_{uid}@tradevelix.test"
    password = "e2etest123"
    username = f"e2e_{uid}"

    # ── Health check ─────────────────────────────────────────────────
    print("[ Public Endpoints ]")
    r = c.get(f"{BASE}/health")
    check("E2E-H01", "Health returns 200", r.status_code == 200)
    check("E2E-H02", "Health has watchlist ≥ 1 stock", len(r.json().get("watchlist", [])) >= 1, str(r.json()))

    # ── Auth: Register ────────────────────────────────────────────────
    print("\n[ Authentication ]")
    r = c.post(f"{BASE}/auth/register", json={"email": email, "username": username, "password": password})
    ok = r.status_code == 201
    check("E2E-A01", "Register new user → 201", ok, r.text[:150])
    if ok:
        token = r.json().get("access_token", "")
        check("E2E-A02", "Register returns access_token", bool(token))
        check("E2E-A03", "Register returns username", r.json().get("username") == username)

    # ── Auth: Login ───────────────────────────────────────────────────
    r = c.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    ok = r.status_code == 200
    check("E2E-A04", "Login valid credentials → 200", ok, r.text[:150])
    if ok:
        token = r.json().get("access_token", token)

    r = c.post(f"{BASE}/auth/login", json={"email": email, "password": "wrongpass"})
    check("E2E-A05", "Login wrong password → 401", r.status_code == 401)

    r = c.get(f"{BASE}/auth/me", headers={"Authorization": f"Bearer {token}"})
    check("E2E-A06", "GET /auth/me with token → 200", r.status_code == 200, r.text[:100])

    # ── Security: Unprotected access ─────────────────────────────────
    print("\n[ Security — Auth Gates ]")
    for path in ["/dashboard/leaderboard", "/dashboard/summary", "/dashboard/stock/INDY"]:
        r = c.get(f"{BASE}{path}")
        check("E2E-S01", f"No-token {path} → 401", r.status_code == 401, f"Got {r.status_code}")

    # ── Dashboard: With token ─────────────────────────────────────────
    print("\n[ Dashboard Flows ]")
    headers = {"Authorization": f"Bearer {token}"}

    r = c.get(f"{BASE}/dashboard/leaderboard", headers=headers)
    ok = r.status_code == 200
    check("E2E-D01", "Leaderboard with token → 200", ok, r.text[:150])
    if ok:
        entries = r.json().get("entries", [])
        check("E2E-D02", "Leaderboard returns ≥ 1 stock", len(entries) >= 1, f"Got {len(entries)}")
        if entries:
            e = entries[0]
            has_fields = all(f in e for f in ["ticker", "overall_signal", "whale_net_lots"])
            check("E2E-D03", "Leaderboard entry has required fields", has_fields, str(list(e.keys())))

    r = c.get(f"{BASE}/dashboard/summary", headers=headers)
    check("E2E-D04", "Summary with token → 200", r.status_code == 200, r.text[:150])

    # ── Stock detail ──────────────────────────────────────────────────
    print("\n[ Stock Detail ]")
    t0 = time.time()
    r = c.get(f"{BASE}/dashboard/stock/INDY", headers=headers)
    elapsed = time.time() - t0
    ok = r.status_code == 200
    check("E2E-D05", "Stock detail INDY → 200", ok, r.text[:150] if not ok else "")
    check("E2E-D06", f"Stock detail < 3s ({elapsed:.1f}s)", elapsed < 3.0)
    if ok:
        d = r.json()
        check("E2E-D07", "Stock detail has weekly_metrics", "weekly_metrics" in d)
        check("E2E-D08", "Stock detail has api_signals",    "api_signals" in d)
        check("E2E-D09", "Stock detail has recent_prices",  "recent_prices" in d)
        check("E2E-D10", "Stock detail has broker_entries", "broker_entries" in d)

        signals = d.get("api_signals", [])
        if signals:
            s = signals[0]
            check("E2E-D11", "api_signal has entry_ideal_price field", "entry_ideal_price" in s)
            check("E2E-D12", "api_signal has entry_max_price field",   "entry_max_price" in s)

        prices = d.get("recent_prices", [])
        check("E2E-D13", f"recent_prices ≥ 10 records ({len(prices)})", len(prices) >= 10)

    r = c.get(f"{BASE}/dashboard/stock/THISDOESNOTEXIST_XYZ", headers=headers)
    check("E2E-D14", "Unknown ticker → 404", r.status_code == 404, f"Got {r.status_code}")

    # ── Performance ───────────────────────────────────────────────────
    print("\n[ Performance ]")
    t0 = time.time()
    c.get(f"{BASE}/health")
    check("E2E-P01", f"Health < 500ms ({(time.time()-t0)*1000:.0f}ms)", time.time()-t0 < 0.5)

    t0 = time.time()
    c.post(f"{BASE}/auth/login", json={"email": email, "password": password})
    check("E2E-P02", f"Login < 1s ({(time.time()-t0)*1000:.0f}ms)", time.time()-t0 < 1.0)

    t0 = time.time()
    c.get(f"{BASE}/dashboard/leaderboard", headers=headers)
    check("E2E-P03", f"Leaderboard < 2s ({(time.time()-t0):.1f}s)", time.time()-t0 < 2.0)

    # ── Security extras ───────────────────────────────────────────────
    print("\n[ Security Extras ]")
    r = c.post(f"{BASE}/auth/register", json={"email": email, "username": "dup", "password": "abcdefgh"})
    check("E2E-S02", "Duplicate email → 400", r.status_code == 400)

    # ── Summary ───────────────────────────────────────────────────────
    print(f"\n{'='*60}")
    passed = sum(1 for r in results if r["passed"])
    total  = len(results)
    failed = total - passed
    print(f"  Results: {passed}/{total} passed  ({failed} failed)")

    if failed:
        print("\n  Failed tests:")
        for r in results:
            if not r["passed"]:
                print(f"    ✗ {r['id']} — {r['desc']}")
        verdict = "NEEDS FIXES" if failed <= 3 else "CRITICAL ISSUES"
    else:
        verdict = "APPROVED"

    print(f"\n  Verdict: {verdict}")
    print(f"{'='*60}\n")

    c.close()
    return failed == 0


if __name__ == "__main__":
    ok = run()
    sys.exit(0 if ok else 1)
