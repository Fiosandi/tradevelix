# Agent: Quality Assurance — Tradevelix

> **FINAL GATE.** Runs after all implementation. Produces APPROVED / NEEDS FIXES / CRITICAL ISSUES.

## What this agent tests

1. **Unit tests** — Three Doors calculation engine, dynamic whale classification
2. **API tests** — all endpoints, auth flows, edge cases
3. **E2E flows** — full user journeys from landing page through dashboard to stock detail
4. **Page rendering** — every route loads without errors
5. **Security** — auth gates, no unprotected dashboard routes
6. **Performance** — response time thresholds

---

## Test Infrastructure

**Backend:** `pytest` + `httpx` (async)
**E2E against live VPS:** Python `httpx` test runner in `backend/tests/e2e_vps.py`
**Browser E2E:** Playwright in `frontend/tests/e2e.spec.ts`

Install:
```bash
# Backend tests
pip install pytest pytest-asyncio httpx

# Frontend E2E
npm install -D @playwright/test
npx playwright install chromium
```

Run:
```bash
# Unit + API tests
cd backend && pytest tests/ -v

# E2E against VPS
cd backend && python tests/e2e_vps.py

# Browser E2E
cd frontend && npx playwright test
```

---

## Test Cases

### Suite 1 — Calculation Engine (Unit)
**File:** `backend/tests/test_calculations.py`

| ID | Test | Expected |
|---|---|---|
| CALC-01 | classify_whales_dynamic: known whale broker (BK) → always whale | BK in result |
| CALC-02 | classify_whales_dynamic: retail broker with 300M value, 8 transactions → reclassified whale | XL in result |
| CALC-03 | classify_whales_dynamic: retail broker with 12B value, 4765 transactions → stays retail | XL NOT in result |
| CALC-04 | classify_whales_dynamic: empty entries → returns base whale set | {AI,BK,YU,BB,AS,SS,CS} |
| CALC-05 | calculate_whale_net: BK buys 50K, AI sells 20K → net +30K | net_lots=30000 |
| CALC-06 | calculate_retail_exit: retail sells 700, total=1000 → 70% | 70.0% |
| CALC-07 | calculate_kekompakan: 3 whales buy, 1 sells → 75% | 75.0% |
| CALC-08 | calculate_bandar_floor: weighted avg of whale buy prices | correct Decimal |
| CALC-09 | calculate_overall_signal: strong whale+retail+VPA buy → STRONG_BUY | STRONG_BUY |
| CALC-10 | calculate_overall_signal: high distribution_score override → WAIT | WAIT |
| CALC-11 | VPA: price up + volume up = UP_TREND | UP_TREND |
| CALC-12 | VPA: price down + volume down = UP_TREND (accumulation on down) | UP_TREND |
| CALC-13 | Signal weights: whale_net 40%, retail_exit 30%, VPA 20%, kekompakan 10% | correct weighted result |

### Suite 2 — API Endpoints (Integration)
**File:** `backend/tests/test_api.py`

**Auth endpoints:**
| ID | Test | Expected |
|---|---|---|
| AUTH-01 | POST /auth/register with valid data | 201, token returned |
| AUTH-02 | POST /auth/register duplicate email | 400 |
| AUTH-03 | POST /auth/register password < 8 chars | 400 |
| AUTH-04 | POST /auth/login valid credentials | 200, token returned |
| AUTH-05 | POST /auth/login wrong password | 401 |
| AUTH-06 | GET /auth/me with valid token | 200, user object |
| AUTH-07 | GET /auth/me without token | 401 |

**Dashboard endpoints (all require auth):**
| ID | Test | Expected |
|---|---|---|
| DASH-01 | GET /dashboard/leaderboard without token | 401 |
| DASH-02 | GET /dashboard/leaderboard with token | 200, entries array |
| DASH-03 | GET /dashboard/leaderboard entries count | ≥ 1 stock with data |
| DASH-04 | GET /dashboard/summary with token | 200, signal counts |
| DASH-05 | GET /dashboard/stock/INDY with token | 200, has broker_entries |
| DASH-06 | GET /dashboard/stock/INDY recent_prices count | ≥ 10 price records |
| DASH-07 | GET /dashboard/stock/INDY api_signals array | present (may be empty if not synced) |
| DASH-08 | GET /dashboard/stock/INVALID with token | 404 |
| DASH-09 | GET /api/v1/health (public) | 200, status=ok |

### Suite 3 — E2E API Flows
**File:** `backend/tests/e2e_vps.py`

Full user journey via HTTP:
1. Register new account → receive JWT
2. Fetch leaderboard with JWT → 19 stocks
3. Fetch stock detail (INDY) → has broker_entries, recent_prices, weekly_metrics
4. Verify entry prices exposed: `entry_ideal_price` field present in api_signals
5. Fetch summary → signal counts non-null
6. Try leaderboard without token → 401
7. Token decoded contains correct user ID

### Suite 4 — Browser E2E (Playwright)
**File:** `frontend/tests/e2e.spec.ts`

| ID | Flow | Steps | Expected |
|---|---|---|---|
| E2E-01 | Landing page renders | Visit `/` | Title contains "Tradevelix", CTA buttons visible |
| E2E-02 | Redirect when not logged in | Visit `/dashboard` | Redirected to `/login` |
| E2E-03 | Register flow | Fill form, submit | Redirected to `/dashboard`, leaderboard visible |
| E2E-04 | Login flow | Enter credentials, submit | Redirected to `/dashboard` |
| E2E-05 | Wrong password | Enter wrong password | Error message shown |
| E2E-06 | Dashboard loads data | After login | Table rows present, signal badges visible |
| E2E-07 | Filter tabs | Click "BUY Signals" | Only BUY/STRONG_BUY rows shown |
| E2E-08 | Stock detail navigation | Click a stock row | URL changes to `/stock/{ticker}` |
| E2E-09 | Evidence cards expand | Click "🐋 Whale Net" card | Evidence panel slides open |
| E2E-10 | Price chart renders | On stock detail | Chart SVG elements present |
| E2E-11 | Broker table present | On stock detail | Buy/sell side tables visible |
| E2E-12 | Back navigation | Click back button | Returns to `/dashboard` |
| E2E-13 | Theme toggle | Click sun/moon | Body attribute changes |
| E2E-14 | Logout flow | Click logout button | Redirected to landing page |
| E2E-15 | Search in top nav | Type ticker, press Enter | Navigates to stock detail |
| E2E-16 | Extension errors suppressed | Load page with wallet extension | No crash screen shown |

### Suite 5 — Security Checks
| ID | Check | Expected |
|---|---|---|
| SEC-01 | No `.env` or API keys in dist bundle | 0 occurrences of RAPIDAPI_KEY |
| SEC-02 | All dashboard routes return 401 without auth | Verified in DASH-01 |
| SEC-03 | JWT expires after 7 days | Token `exp` field correct |
| SEC-04 | Password not stored in plain text | DB has bcrypt hash |
| SEC-05 | CORS allows frontend origin | OPTIONS returns correct headers |

### Suite 6 — Performance
| ID | Check | Threshold |
|---|---|---|
| PERF-01 | Landing page load (nginx static) | < 1s |
| PERF-02 | Login response time | < 500ms |
| PERF-03 | Leaderboard endpoint | < 2s |
| PERF-04 | Stock detail endpoint | < 3s |
| PERF-05 | Page TTI after auth (browser) | < 4s |

---

## Output Format

```
# QA Report — Tradevelix v3.0.0
Date: {date}

## Results
| Suite | Tests | Passed | Failed | Skipped |
|-------|-------|--------|--------|---------|
| Calculations | 13 | X | X | X |
| API           | 16 | X | X | X |
| E2E API flows | 7  | X | X | X |
| Browser E2E   | 16 | X | X | X |
| Security      | 5  | X | X | X |
| Performance   | 5  | X | X | X |

## Failed Tests
{list each failure with actual vs expected}

## Verdict: APPROVED / NEEDS FIXES / CRITICAL ISSUES
```

---

## Self-correction rules

- **CALC test fails** → fix `calculation_engine.py`
- **AUTH test fails** → fix `api/v1/auth.py` or `core/security.py`
- **DASH 401 fails** → fix `get_current_user` dependency in `dashboard.py`
- **E2E-02 redirect fails** → fix `ProtectedRoute.tsx`
- **E2E-03/04 form fails** → fix `Login.tsx` / `Register.tsx`
- **SEC-01 fails** → rebuild with correct `VITE_API_URL` in `.env.production`
- **Any CRITICAL** → do not deploy, fix and re-run full suite
