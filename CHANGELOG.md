# Tradevelix Changelog

## April 2026

### Features shipped
- **Backtest engine** — Replay Three Doors signals (STRONG_BUY / BUY) against 120 days of OHLCV history. Entry at open after signal week, stop at floor −5%, T1 +12%, T2 +25%, time-stop 35d. Accessible at `/backtest`.
- **Price chart date range** — 1M / 3M / Max toggle on StockDetail. Fetches 120 days by default, slices client-side.
- **Pump risk badge** — `⚠ PUMP` shown on Dashboard leaderboard rows and StockDetail hero when `pump_dump score > 6`. Sync already runs weekly.
- **Entry price zone** — Green `ReferenceArea` band on price chart between `entry_ideal_price` and `entry_max_price` from API. Shows exact Rp range in Three Doors summary.
- **8-week trend chart** — Whale Net Lots (bars) + Retail Exit % (line) trend per stock. Signal color on each point. Endpoint: `GET /dashboard/stock/{ticker}/history`.
- **Dynamic whale classification** — Rp 200M transaction value threshold. Known retail brokers can be reclassified as whale if behavior matches.
- **JWT auth** — bcrypt + python-jose, 7-day token. Landing page + login/register flow.
- **Admin page** — Sync controls (daily/weekly/bulk/price-history backfill) + API budget monitor sourced from DB (accurate across restarts).
- **3-key API rotation** — 2700 calls/month across 3 RapidAPI keys. Rotates automatically on exhaustion.
- **Dark / light theme** — CSS variable system (`--buy`, `--sell`, `--whale`, `--floor`, etc.).

### Bugs fixed
- Chart dates now show `dd mmm yy` format (was `MM-DD`)
- Kekompakan evidence panel shows proper empty state when no broker data
- Dashboard "Week undefined – undefined" header fixed
- Y-axis showing decimal prices (934,36) fixed with `Math.round()`
- Broker table header/row misalignment fixed
- API budget showing 0 fixed — now reads from `sync_logs` table not in-memory counter
- Signal weights corrected to 40/30/20/10 (whale/retail/VPA/kekompakan)

### Infrastructure
- VPS: Ubuntu 24.04 at `43.134.173.106`, nginx + uvicorn + systemd
- 120-day OHLCV backfill: 2240 records across 19 stocks (Jan–Apr 2026)
- Scheduler: daily 18:00 WIB (Mon–Fri) + weekly Saturday 10:00 WIB

---

---

## April 2026 (cont.)

### Added
- **Broker Inventory** `/broker-flow` — candlestick + cumulative broker net lot lines, tektok detection, interactive legend
- **Broker History Backfill** admin button — 4w/12w options (~76–228 API calls). Required for inventory broker lines
- **Admin User Management** — registered users table with totals (active, new this week, admins, paid placeholder)
- **Major Holder panel** on StockDetail — IDX/KSEI 5%+ movements synced weekly

### Fixed
- Inventory chart: hidden anchor Line makes price Y-axis scale available to Customized candlestick
- Date format dd mmm yy everywhere (chart axes, tooltips, breadcrumbs)
- Metric cards: whale+retail open together; alignItems:start removes white space
- Kekompakan evidence empty state
- Avg price `Rp` prefix in all broker tables

---

## Late April 2026

### Added
- **Trade Signal Cards** `/signals` — generated after every calculation; entry/stop/T1/T2 with price ladder progress bar, whale broker chips, VPA badge
- **Paid user gating** — `is_paid` column on users table; Admin toggle per user; `is_admin` + `is_paid` returned in JWT login response
- **Admin Panel tabbed redesign** — full-width layout, "Member Management" tab (user table + stat cards) and "API & System" tab (sync cards grid, budget bar, logs). `maxWidth: 960` removed.
- **Admin quick-access button** in top nav for admin users (⚡ Admin pill)
- 5 new watchlist stocks: BNBR, WIFI, INET, ESSA, BULL (24 total)

### Fixed — Critical: Broker Data Methodology
- **Three Doors analysis is behavioural, NOT weekly.** It detects dominant broker volume spikes and behavioral change, not 7-day calendar windows. Corrected sync to use **YTD (Jan 1 → last settled Friday)**.
- **Market Reaper API inflates broker data for the current trading week** — T+2 settlement means `to_date` must be a Friday ≥2 days in the past. Using `to_date = today (Saturday/Sunday)` returned 10-15× inflated lot counts.
- `broker_entries.is_whale` was only set from the hardcoded list (AI, BK, YU…). Fixed: calculation engine now updates `is_whale` to reflect `classify_whales_dynamic()` output. Dominant brokers like LG (736B value, 10M+ lots YTD) now correctly show as whale in evidence panels.
- Broker summary query in calculation_engine was `date_from >= week_start - 3 days` which excluded YTD summaries starting Jan 1. Fixed to `date_from <= week_end` (any summary covering this period).
- Admin page white space bug (was `maxWidth: 960`, left-aligned). Fixed with full-width tabbed layout.
- Dashboard error message "Cannot reach backend (port 8000)" replaced with proper 401 / server error / connection error distinction.

### Fixed — Data
- BNBR, ESSA, INET got 0 price rows due to rate limiting (new stocks at end of watchlist). Fixed with targeted single-stock sync via Admin → Resync.

### Documentation
- `HOWTO.md` — full beginner guide in Bahasa Indonesia with glossary (Whale, Retail, Akumulasi, Distribusi, Bandar Floor, Kekompakan, etc.), Three Doors flow diagram, step-by-step checklist, conviction tiers, FAQ

---

## Late April 2026 (cont.)

### Added — Whale Classification Tier B
- **Split-order accumulator detection** in `classify_whales_dynamic()`. Catches algorithmic accumulators that fragment large orders into many small txns to evade the lot/tx threshold.
- Rule: value≥1B (retail) or 500M (non-retail) AND flow_share≥3% AND conviction≥60% AND lot/tx≥30.
- The lot/tx≥30 filter distinguishes split-orders (avg 30-100 lots) from genuine retail aggregation (avg 1-15 lots). The conviction filter rules out market-makers churning both sides.
- Tests: `test_split_order_accumulator_caught`, `test_market_maker_not_caught_by_tier_b`.

### Cleanup
- Removed 23 unused/one-off files: deploy_*.py bootstrap scripts (had plaintext VPS password), check_vps*.py diagnostics, full_backfill.py / resync_monthly.py / seed_shareholders.py (VPS-only paths), backend/=4.0.0 stray, backend/add_columns.py (superseded by alembic), backend/test_db.py (loaded wrong .env), Vite scaffold (main.ts, counter.ts, vite/typescript/hero assets), empty frontend.err/log, empty backend/app/scheduler/.
- Fixed favicon path in `frontend/index.html` (`/vite.svg` → `/favicon.svg`).

### Added — Alert Evaluator
- New service `app/services/alert_engine.py` evaluates the `alerts` table against the latest WeeklyMetric / DailyPrice. Hooks into `SyncService.run_calculations()` after weekly metrics + trade signals land. Triggered alerts get `triggered_at = now()` and survive in place — user re-arms manually.
- Supported types: `RETAIL_EXIT_ABOVE`, `WHALE_NET_ABOVE`, `WHALE_NET_BELOW`, `FLOOR_DISTANCE_BELOW`, `PRICE_ABOVE`, `PRICE_BELOW`, `SIGNAL_EQUALS`. Conditions stored as JSONB (`{"threshold": 65}` or `{"value": "STRONG_BUY"}`).
- Endpoints: `GET /alerts`, `POST /alerts`, `DELETE /alerts/{id}`, `POST /alerts/{id}/rearm`, `POST /alerts/evaluate` (admin manual run).
- New `/alerts` page with armed/triggered split sections, inline create form (ticker + type + value), per-row delete and re-arm. Sidebar entry under Signals group.

### Updated — Landing Page
- Replaced marketing-style copy ("See where the whales are moving" / Three Doors hero / 6-feature grid / multi-CTA) with a plain, first-person framing: "Trading analysis tools for IDX." Single short paragraph, four-bullet what's-inside list, two CTAs, single footer line. No buzzwords, no stats bar, no BETA badge.

### Added — Per-Key API Budget Tracking
- `MarketReaperClient` now reads RapidAPI's `X-RateLimit-Requests-Limit` / `X-RateLimit-Requests-Remaining` headers on every response and treats them as truth for per-key call counts. Pre-header local counter still drives rotation, but the displayed numbers come from upstream.
- Per-key state is persisted to `TRADEVELIX_API_STATE` (defaults to `/tmp/tradevelix_api_state.json`) so usage survives uvicorn restarts. State auto-resets when the calendar month rolls over.
- New schema `ApiKeyUsage` with `calls_used / calls_limit / calls_remaining / last_call_at / header_observed`. `SyncService.get_api_usage` prefers header-truth when at least one key has been observed and falls back to `sync_logs` aggregation otherwise.
- Admin → System tab now shows a per-key bar list under the global Monthly Budget bar, with active-key tag, key preview, last-call timestamp, and unobserved-state hint.

### Added — KSEI Parser Dry-Run Script
- `backend/scripts/test_ksei_parser.py` runs the parser against a local PDF with no DB writes; prints sample rows + entity-type / status / ticker breakdowns, and flags suspicious counts (rows with 0 shares or null %) that suggest column drift.
- Use this BEFORE uploading via Admin to validate that the legacy column offsets still hold for current KSEI PDFs: `python scripts/test_ksei_parser.py /path/to/file.pdf 2026-03-01`.

### Added — Stock Ownership Composition `/ownership`
- New page surfacing KSEI monthly stockholder rosters: summary strip (Foreign/Local/Retail/Holder count), 12-month stacked bar chart (entity-type composition), Local-vs-Foreign breakdown tables, SID trend area chart, Major Shareholders table.
- Backend models `KseiOwnership` + `KseiSidHistory` + alembic migration 003. `pdfplumber` parser in `app/services/ksei_parser.py` follows the column mapping from the legacy Streamlit project (kode/holder/status/shares/percentage). Parser auto-classifies holders by name into Corporate / Individual / MutualFund / Insurance / Bank / Pension / Foundation / Other.
- Endpoints: `POST /admin/ownership/upload` (multipart, admin-only), `GET /ownership/{ticker}`, `GET /admin/ownership/jobs`. Upload uses `UploadJob` for tracking; idempotent on `(stock_id, snapshot_month, holder_name)`.
- Admin page now has a "KSEI Ownership Upload" card (month picker + PDF input). Sidebar gains an Ownership entry under Insights.
- **Note**: parser column offsets are inherited from the old project; the first uploaded PDF should be sanity-checked. The `_parse_row` fallback scans for any cell matching `^[A-Z]{3,5}$` so column drift doesn't crash the whole import.

---

## Pending (see memory/project_roadmap.md)
1. Broker history backfill — operational, run from Admin → System tab when needed
2. KSEI parser column-tuning against real PDF — run `backend/scripts/test_ksei_parser.py <pdf> <month>` first; tune offsets in `_parse_row` if zero-share / null-pct rates are >10%
