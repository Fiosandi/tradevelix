# Remora Trading Tools — Project Context

## Architecture (CRITICAL)
**Bulk Sync → Local DB → Internal Calculation**
- API called ONLY by scheduled jobs / admin endpoints. NEVER on user request.
- All data lives in PostgreSQL. All calculations run locally.
- Frontend reads only from FastAPI REST endpoints.

## Stack
- **Backend:** Python 3.12, FastAPI, SQLAlchemy 2.0 async, asyncpg, APScheduler
- **Frontend:** React 19, TypeScript, Vite, Recharts, CSS custom properties (no Tailwind JIT dynamic class composition)
- **DB:** PostgreSQL 16, database `remora`, user `remora` (password in `backend/.env`)
- **Deploy:** Ubuntu 24.04 VPS `43.134.173.106` — nginx:80 serves `/opt/remora/frontend/dist`, proxies `/api/` to uvicorn:8000

## Broker Classification
- **Known whales (base prior):** `AI, BK, YU, BB, AS, SS, CS`
- **Known retail (base prior):** `YP, XL, PD, XC, CP, AB`
- **Dynamic override (per stock/week):** `classify_whales_dynamic()` in `calculation_engine.py`
  - **Tier A — Block trader:** single big-ticket trades (high `lots/freq`)
    - Non-retail: value≥500M & lot/tx≥50, OR value≥200M & lot/tx≥100
    - Retail override: value≥200M & lot/tx≥200
    - Example: XL in BUVA trading 5000 lots in 8 transactions (625 lots/tx)
  - **Tier B — Split-order accumulator:** algo that fragments orders to hide footprint
    - value≥1B (retail) or 500M (non-retail), flow_share≥3%, conviction≥60%, lot/tx≥30
    - The lot/tx≥30 filter rules out genuine retail aggregation (avg 1-15 lots/tx)
    - The conviction filter rules out market-makers churning both sides
  - The hardcoded lists are priors, NOT rules. Behaviour is the ground truth.

## Three Doors — Correct Methodology
**Behavioural, NOT calendar-weekly.** Identifies dominant broker accumulation/distribution
by volume spike + change in who is transacting. The analysis window is "since the behavior
started", approximated by YTD (Jan 1 → last settled Friday).

**Broker data window**: `from=Jan 1`, `to=last settled Friday (≥2 days ago)`.
Market Reaper API returns inflated data for the current trading week (T+2 settlement).
Using `to_date` from the current week always gives wrong lot counts — use prior Friday.

## 24-Stock Watchlist
`BUVA, BIPI, VKTR, BUMI, BRMS, ENRG, SUPA, COCO, PTRO, CUAN, IMPC, INDY, MBSS, PSKT, PANI, CBDK, ITMG, INKP, TKIM, BNBR, WIFI, INET, ESSA, BULL`

## API Budget
3 RapidAPI keys × 900/month = **2,700 total/month**. ~141 used as of April 2026.
Keys in `backend/.env` as `RAPIDAPI_KEYS` (comma-separated). Client rotates automatically on key exhaustion.

## Scheduler
- Daily: Mon–Fri 18:00 WIB → `sync_daily_all()` (~24 API calls)
- Weekly: Saturday 10:00 WIB → `sync_weekly_all()` + `run_calculations()` (~90 API calls)

## DB Models (13 tables)
| Table | Purpose |
|---|---|
| `stocks` | Master stock list |
| `daily_prices` | OHLCV + foreign flow |
| `broker_summaries` / `broker_entries` | Weekly broker buy/sell aggregates |
| `weekly_metrics` | Three Doors results (whale_net, retail_exit, kekompakan, bandar_floor, overall_signal) |
| `api_signals` | API raw signals: accumulation/distribution/smart_money/sentiment/pump_dump |
| `trade_signals` | entry/stop/target levels per BUY signal |
| `alerts` | ⚠ EXISTS, UNUSED — user alert conditions |
| `brokers` / `sectors` | Master data |
| `sync_logs` / `api_raw_responses` | Operational tracking |
| `major_holder_movements` | IDX/KSEI 5%+ disclosure events from API |
| `ksei_ownership` | Monthly ≥1% holder roster parsed from KSEI PDFs (entity-type classified) |
| `ksei_sid_history` | Monthly SID (Single Investor ID) count — retail-interest proxy |
| `upload_jobs` | KSEI PDF upload tracking |

## Key Files
| File | Purpose |
|---|---|
| `backend/app/services/calculation_engine.py` | Three Doors math, signal weights |
| `backend/app/services/sync_service.py` | All sync orchestration |
| `backend/app/clients/market_reaper.py` | API client with 3-key rotation |
| `backend/app/api/v1/dashboard.py` | FastAPI routes |
| `frontend/src/pages/Dashboard.tsx` | Leaderboard page |
| `frontend/src/pages/StockDetail.tsx` | Stock analysis with evidence cards |
| `frontend/src/api.ts` | All frontend API calls |
| `frontend/src/style.css` | CSS design tokens (--buy, --sell, --whale, etc.) |

## Pending work
1. `TradeSignal` table exists but never populated — generate after calculations, build `/signals` page
2. `Alert` table exists but evaluator not written
3. See `CHANGELOG.md` for full history of what's shipped
