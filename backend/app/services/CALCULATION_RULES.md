# Remora Trading Tools — Calculation Rules

> **Source of truth for the backend developer implementing the calculation engine.**
> Last updated: 2026-04-12

---

## 1. Classification Priority: API `type` vs Our `brokers.yaml`

### The Problem

The broker-summary API returns a `type` field per broker entry with values:
- `"Asing"` — foreign investor
- `"Lokal"` — domestic investor
- `"Pemerintah"` — government investor

Our system classifies brokers as `WHALE`, `RETAIL`, `MIXED`, or `GOVERNMENT` via `config.py` / `brokers.yaml`.

**These are DIFFERENT dimensions.** `Asing/Lokal/Pemerintah` tells us **nationality**, not **size**. A foreign retail broker and JP Morgan (BK) are both `"Asing"`, but only BK is a whale.

### Decision: Use Our Classification as Primary

| Dimension | Source | Purpose | Priority |
|-----------|--------|---------|----------|
| Whale vs Retail | `WHALE_BROKERS` / `RETAIL_BROKERS` in config.py | Identifies who has big money | **PRIMARY** |
| Asing vs Lokal vs Pemerintah | API `type` field | Identifies investor nationality | **SECONDARY** |

**Rule:** For ALL calculations (retail exit, whale net, bandar floor, kekompakan), use our `WHALE_BROKERS` list to identify whales. The API `type` field is stored as `investor_type` metadata but is **never used** to determine whale/retail status.

**Whale codes (from config.py):** `AI, BK, YU, BB, AS, SS, CS`

**Why this matters:**
- Whales can disguise as local brokers (note in CONTEXT.md)
- A whale like BK (JP Morgan) is `"Asing"` but is still a whale
- A small foreign retail trader using an Asing broker is NOT a whale
- Our list is curated from Indonesian market knowledge — it's our competitive edge

**How it maps on the `BrokerEntry` model:**

```python
# When ingesting brokers_buy / brokers_sell from API:
entry.is_whale = entry.broker_code in settings.whale_brokers_list
entry.investor_type = api_response["type"]  # "Asing", "Lokal", "Pemerintah"
```

---

## 2. Retail Exit Percentage

### Formula

```
retail_exit_pct = retail_sell_lots / (retail_buy_lots + retail_sell_lots) * 100
```

Where:
- `retail_sell_lots` = sum of lots from `BrokerEntry` rows where `is_whale = False AND side = 'SELL'`
- `retail_buy_lots` = sum of lots from `BrokerEntry` rows where `is_whale = False AND side = 'BUY'`

### Source Fields (API → DB → Calculation)

| API Field | DB Column | Used As |
|-----------|-----------|---------|
| `brokers_sell[].slot` (negative) | `BrokerEntry.lots` (stored as abs value) | `retail_sell_lots` if `!is_whale` |
| `brokers_sell[].slotv` | Not stored separately | Redundant with `abs(slot)`, we use `lots` |
| `brokers_buy[].blot` | `BrokerEntry.lots` | `retail_buy_lots` if `!is_whale` |

### Important Nuances

1. **The API separates brokers by NET direction.** A broker that is a net buyer appears in `brokers_buy[]`; a net seller in `brokers_sell[]`. A broker does **NOT** appear in both arrays for the same date range.

2. **`lots` in our DB is always positive.** For sell-side entries, we store `abs(slot)` as `lots`. The `side` column ('BUY' or 'SELL') records direction.

3. **Do NOT use `type` field.** A broker flagged `"Asing"` could be a whale or retail. Only `is_whale` from our classification matters.

4. **`retail_exit_pct` ≥ 50% is bullish.** This means retail is predominantly selling (exiting), which in Remora's framework suggests whales are accumulating from retail.

### Worked Example

```
brokers_buy:
  BK  | lots=91321  | is_whale=True  → whale_buy
  YP  | lots=45000  | is_whale=False → retail_buy
  XL  | lots=30000  | is_whale=False → retail_buy

brokers_sell:
  AG  | lots=105770 | is_whale=False → retail_sell
  PD  | lots=25000  | is_whale=False → retail_sell
  BK  | lots=20000  | is_whale=True  → whale_sell (even whales sell sometimes)

retail_buy_lots  = 45000 + 30000 = 75000
retail_sell_lots = 105770 + 25000 = 130770
retail_exit_pct  = 130770 / (75000 + 130770) * 100 = 63.5%  → BULLISH
```

### Edge Cases

| Case | Handling |
|------|----------|
| Zero retail activity (no retail entries) | Return `0.0` — no retail exit to measure |
| Only retail buys, no sells | Return `0.0` — no exit occurring |
| Only retail sells, no buys | Return `100.0` — complete retail panic exit |
| No entries at all (suspended stock) | Return `0.0` |
| Division denominator zero | Return `0.0` (guarded) |

---

## 3. Whale Net Lots

### Formula

```
whale_net_lots = total_whale_buy_lots − total_whale_sell_lots
```

Where:
- `total_whale_buy_lots` = sum of `lots` from `BrokerEntry` where `is_whale = True AND side = 'BUY'`
- `total_whale_sell_lots` = sum of `lots` from `BrokerEntry` where `is_whale = True AND side = 'SELL'`

### Source Fields (API → DB → Calculation)

| API Field | DB Column | Calculation |
|-----------|-----------|-------------|
| `brokers_buy` where `netbs_broker_code` is a whale | `BrokerEntry.lots` | Add to `whale_buy_lots` |
| `brokers_sell` where `netbs_broker_code` is a whale | `BrokerEntry.lots` | Add to `whale_sell_lots` |

### The Answer is C: Net = total_whale_buy_lots − total_whale_sell_lots

**Why NOT A (buy side only):** Whales can be net sellers. Ignoring the sell side would miss distribution.

**Why NOT B (blot_from_buy + slot_from_sell):** This would ADD sell lots to buy lots, giving total volume, not net position.

**The correct approach:** A whale broker appears EITHER in `brokers_buy` (net buyer) OR `brokers_sell` (net seller). For each whale, determine direction from which list they appear in, then sum accordingly.

### Worked Example

```
brokers_buy:
  BK  | lots=91321  | is_whale=True  → whale_buy
  AI  | lots=45000  | is_whale=True  → whale_buy
  YP  | lots=30000  | is_whale=False → (retail)

brokers_sell:
  YU  | lots=60000  | is_whale=True  → whale_sell
  AG  | lots=105770 | is_whale=False → (retail)

whale_buy_lots  = 91321 + 45000 = 136321
whale_sell_lots = 60000
whale_net_lots  = 136321 − 60000 = 76321  → NET ACCUMULATION ✓
```

### Edge Cases

| Case | Handling |
|------|----------|
| No whale brokers active | Return `0` — neutral, no whale activity |
| All whales are net sellers | Return negative `int` — distribution signal |
| Whale appears in both buy and sell | Should NOT happen per API design; if it does, treat as separate entries and net them |

### Also Calculate

```
whale_net_value = total_whale_buy_value − total_whale_sell_value
```

Using `BrokerEntry.value` (from `bval` / `abs(sval)`) instead of `lots`.

```
whale_count = count of distinct whale broker codes in both buy and sell lists
```

---

## 4. Retail Participation Percentage

### Formula

```
retail_participation_pct = (retail_total_lots / total_market_lots) * 100
```

Where:
- `retail_total_lots` = sum of `lots` from ALL `BrokerEntry` where `is_whale = False` (both buy and sell)
- `total_market_lots` = sum of `lots` from ALL `BrokerEntry` (whale + retail, buy + sell)

### Edge Cases

| Case | Handling |
|------|----------|
| Zero total market lots | Return `0.0` |
| All retail, no whales | Return `100.0` |
| All whales, no retail | Return `0.0` |

> **Note:** `retail_participation_pct` and `retail_exit_pct` are DIFFERENT metrics.
> - `retail_participation_pct` = How much of total volume is retail
> - `retail_exit_pct` = How much of retail activity is selling (panic)
> Both matter. High participation + high exit = retail is dumping shares to whales.

---

## 5. Bandar Floor Price (Weighted Average Whale Buy Price)

### Formula

```
bandar_floor_price = Σ(buy_avg_price × buy_lots) for whale BUY entries
                     ──────────────────────────────────────────────
                     Σ(buy_lots) for whale BUY entries
```

### Source Fields

| API Field | DB Column | Role |
|-----------|-----------|------|
| `netbs_buy_avg_price` | `BrokerEntry.avg_price` | Weighted average buy price of whale |
| `blot` | `BrokerEntry.lots` | Weight (buy lots) of whale |

**CRITICAL: Only use BUY-side whale entries.** Sell-side entries have `netbs_sell_avg_price` which is the average SELL price, not the accumulation price.

### Why Weighted Average (NOT Simple Average)

If BK bought 91,321 lots at avg 8,031 and AI bought 1,000 lots at avg 8,100:
- **Simple average:** (8031 + 8100) / 2 = 8065.5 ← **WRONG**
- **Weighted average:** (8031×91321 + 8100×1000) / (91321+1000) = 8031.75 ← **CORRECT**

The simple average ignores that BK is 91x more influential than AI. The weighted average gives BK's price 98.9% weight.

### Worked Example

```
Whale BUY entries:
  BK  | avg_price=8031 | lots=91321  → weighted = 8031 × 91321 = 733,310,351
  AI  | avg_price=7920 | lots=45000  → weighted = 7920 × 45000 = 356,400,000
  YU  | avg_price=8100 | lots=12000  → weighted = 8100 × 12000 = 97,200,000

Numerator = 733,310,351 + 356,400,000 + 97,200,000 = 1,186,910,351
Denominator = 91321 + 45000 + 12000 = 148,321

bandar_floor_price = 1,186,910,351 / 148,321 = 8,002.66 IDR
```

### Distance to Floor

```
distance_to_floor_pct = ((current_price − bandar_floor_price) / bandar_floor_price) × 100
```

Where `current_price` is the latest `DailyPrice.close` for the stock.

- **Negative distance** = Price is BELOW floor (whales are underwater — potential panic zone)
- **0-5% distance** = Price near floor (strong support zone)
- **>20% distance** = Price far above floor (whales have profit room to distribute)

### Edge Cases

| Case | Handling |
|------|----------|
| No whale BUY entries | Return `0.0` (no floor to calculate) |
| Only whale SELL entries (whales distributing) | Return `0.0` — no accumulation floor exists |
| Single whale buy entry | Return that whale's `avg_price` directly (weighted avg = avg_price) |
| Zero buy lots | Return `0.0` (guard against division by zero) |

---

## 6. VPA Signal (Volume Price Analysis)

### Formula

VPA is a **DAILY** signal calculated from `DailyPrice` data. It requires **at least 2 consecutive trading days**.

```
price_change_pct = (current_close − previous_close) / previous_close × 100
volume_change_pct = (current_volume − previous_volume) / previous_volume × 100

price_up = price_change_pct > THRESHOLD_PRICE   (default: 1.0%)
volume_up = volume_change_pct > THRESHOLD_VOLUME  (default: 5.0%)
```

### Signal Rules

| Price | Volume | Signal | Interpretation |
|-------|--------|--------|---------------|
| Up | Up | **UP_TREND** | Buying pressure — volume confirms price move |
| Down | Down | **UP_TREND** | Selling exhaustion — declining volume on sell-off = accumulation |
| Up | Down | **DOWN_TREND** | Fake rally — price up on low volume = weak |
| Down | Up | **DOWN_TREND** | Distribution — high volume sell-off = smart money exiting |
| Else | Else | **NEUTRAL** | Below threshold changes |

### Source Fields (from `daily_prices` table)

| Field | DB Column | Usage |
|-------|-----------|-------|
| Close price | `DailyPrice.close` | `current_close`, `previous_close` |
| Volume | `DailyPrice.volume` | `current_volume`, `previous_volume` |

### Should Foreign Flow Be Included in VPA?

**No.** VPA is a pure price-volume analysis. Foreign flow is a **separate, corroborating signal.**

**Reasoning:**
- VPA measures market conviction through volume participation
- Foreign flow measures institutional/overseas conviction
- They can diverge: VPA UP_TREND but net foreign sell = mixed signal
- Combining them would dilute VPA's clarity

**Instead, use foreign flow as a SEPARATE metric:**
```
foreign_net = foreign_buy − foreign_sell
foreign_trend = "INFLOW" if foreign_net > 0 else "OUTFLOW"
```

And use it in the **Composite Signal** (Section 8) as a confirming indicator.

### Thresholds and Noise Filtering

| Threshold | Default | Rationale |
|-----------|---------|-----------|
| `THRESHOLD_PRICE` | 1.0% | Avoids reacting to sub-1% noise (transaction costs on IDX) |
| `THRESHOLD_VOLUME` | 5.0% | Avoids reacting to normal volume fluctuations |

For **weekly VPA** (used in `WeeklyMetric`):
- Use the **last trading day of the week** vs **last trading day of previous week**
- Alternatively, average daily VPA signals across the week

### Edge Cases

| Case | Handling |
|------|----------|
| Less than 2 days of price data | Return `"NEUTRAL"` |
| Previous volume is zero | Return `"NEUTRAL"` (can't calculate volume change) |
| Previous close is zero | Return `"NEUTRAL"` (can't calculate price change) |
| Price change exactly at threshold | Use `>` (strictly greater) — 1.0% change does NOT qualify, needs >1.0% |
| Suspended stock (volume = 0) | Return `"NEUTRAL"` |
| Volume exactly equal to previous | Not `volume_up`, but not necessarily `volume_down` either. Must be `>THRESHOLD` for up, must be `< -THRESHOLD` for down |

---

## 7. Kekompakan Score (Whale Coordination)

### Formula

```
kekompakan_score = (same_direction_whale_count / total_active_whale_count) × 100
```

Where:
- `total_active_whale_count` = number of distinct whale broker codes appearing in BrokerEntry for this period
- `same_direction_whale_count` = number of whale brokers on the same side as the majority whale direction

### How to Determine Direction

Since broker data is **aggregated over a date range** (weekly), each whale broker appears in **exactly one** list:

```python
# Build whale directional positions
whale_positions = {}

for entry in broker_entries:
    if entry.is_whale:
        if entry.side == "BUY":
            whale_positions[entry.broker_code] = entry.lots  # positive = net buyer
        elif entry.side == "SELL":
            whale_positions[entry.broker_code] = -entry.lots  # negative = net seller

# Determine overall whale direction
whale_buying_count = sum(1 for v in whale_positions.values() if v > 0)
whale_selling_count = sum(1 for v in whale_positions.values() if v < 0)

if whale_buying_count >= whale_selling_count:
    majority_direction = "BUY"
    same_direction_count = whale_buying_count
else:
    majority_direction = "SELL"
    same_direction_count = whale_selling_count

total_active = len(whale_positions)
kekompakan_score = (same_direction_count / total_active * 100) if total_active > 0 else 0
```

### Coordination Threshold

| Kekompakan Score | Coordination | Signal |
|-----------------|-------------|--------|
| ≥ 80% | STRONG | Whales are highly coordinated — strong signal |
| 60-79% | MODERATE | Some coordination — watch closely |
| < 60% | WEAK/NO | Whales are split — no clear coordination |

**`coordinated = kekompakan_score >= 60`** (boolean flag for signal generation)

### Worked Example

```
Whale positions for week:
  BK  → BUY  lots=91321  (net buyer)
  AI  → BUY  lots=45000  (net buyer)
  YU  → SELL lots=60000  (net seller)
  BB  → BUY  lots=25000  (net buyer)
  SS  → BUY  lots=15000  (net buyer)

whale_buying_count = 4 (BK, AI, BB, SS)
whale_selling_count = 1 (YU)
majority_direction = "BUY"
same_direction_count = 4

kekompakan_score = (4 / 5) × 100 = 80% → COORDINATED (STRONG)
```

### Edge Cases

| Case | Handling |
|------|----------|
| No whale activity | Return `0` (no coordination to measure) |
| Single active whale | Return `100` (trivially coordinated) |
| Equal buy/sell (50/50) | Majority direction = BUY (tie-breaker); kekompakan = 50% → NOT coordinated |
| Whale with zero lots | Exclude from count (not truly "active") |

### Aggregation Caveat

Since broker data is **weekly aggregated**, kekompakan reflects **weekly coordination**. We cannot tell if whales coordinated on a specific day within the week. This is a known limitation of the FREE tier API.

When we upgrade to PRO (daily broker data), we can compute **daily kekompakan** for finer-grained signals.

---

## 8. Composite Accumulation Score (0-100)

### Formula

```
accumulation_score = (
    whale_net_score   × 0.40 +
    retail_exit_score  × 0.30 +
    vpa_score          × 0.20 +
    kekompakan_score    × 0.10
)
```

Clamped to range [0, 100].

### Component Scoring

#### whale_net_score (0-100)

```python
# How much are whales net buying?
MIN_WHALE_NET = 50000  # 50,000 lots baseline

if whale_net_lots > 0:
    whale_net_score = min(100, (whale_net_lots / MIN_WHALE_NET) × 100)
else:
    whale_net_score = 0  # Whales are net SELLING — no accumulation
```

#### retail_exit_score (0-100)

```python
MIN_RETAIL_EXIT = 50.0  # 50% baseline

retail_exit_score = min(100, (retail_exit_pct / MIN_RETAIL_EXIT) × 100)
```

#### vpa_score (0-100)

```python
vpa_scores = {
    "UP_TREND": 80,
    "NEUTRAL": 50,
    "DOWN_TREND": 20,
}
vpa_score = vpa_scores.get(vpa_signal, 50)
```

#### kekompakan_score (0-100)

Already computed in Section 7. Use directly (it's already 0-100).

### Signal Thresholds

| Score | Signal | Action |
|-------|--------|--------|
| 80-100 | STRONG_BUY | Whales accumulating heavily, retail exiting, VPA confirms |
| 60-79 | BUY / WATCH | Good accumulation signs, watch for confirmation |
| 40-59 | NEUTRAL | Mixed signals, no clear direction |
| 20-39 | WAIT | Some distribution signs |
| 0-19 | SELL / AVOID | Whales selling, retail buying (trap) |

### Worked Example

```
whale_net_lots     = 76,321  → whale_net_score  = min(100, 76321/50000 * 100) = 100
retail_exit_pct    = 63.5%   → retail_exit_score = min(100, 63.5/50 * 100)    = 100
vpa_signal         = "UP_TREND" → vpa_score      = 80
kekompakan_score   = 80%      → kekompakan_score  = 80

accumulation_score = (100 × 0.40) + (100 × 0.30) + (80 × 0.20) + (80 × 0.10)
                   = 40 + 30 + 16 + 8
                   = 94 → STRONG_BUY ✓
```

---

## 9. Overall Signal Determination

### Signal Hierarchy

The `overall_signal` in `WeeklyMetric` combines our internal calculations with API pre-computed signals:

```python
def determine_overall_signal(
    accumulation_score: float,    # Our calculation (0-100)
    api_accumulation_score: float, # From /bandar/accumulation
    api_distribution_score: float, # From /bandar/distribution
    api_sentiment: str,           # From /sentiment
    api_smart_money: str,         # From /bandar/smart-money
    vpa_signal: str,              # Our VPA calculation
    foreign_flow_trend: str,      # From daily_prices
) -> tuple[str, int]:
    """Returns (signal, confidence)

    signal: STRONG_BUY | BUY | WATCH | WAIT | SELL | STRONG_SELL
    confidence: 0-100
    """
```

### Signal Rules

| Our Accumulation Score | API Corroboration | Signal | Confidence |
|----------------------|-------------------|--------|-----------|
| ≥ 80 | API accumulation ≥ 5 OR sentiment bullish | STRONG_BUY | 90 |
| ≥ 80 | API contradicts (distribution) | BUY | 70 |
| 60-79 | API confirms | BUY | 75 |
| 60-79 | API contradicts | WATCH | 55 |
| 40-59 | Any | WAIT | 50 |
| 20-39 | API confirms distribution | SELL | 75 |
| < 20 | API distribution ≥ 5 | STRONG_SELL | 90 |
| < 20 | API contradicts (accumulation) | WAIT | 55 |

### Foreign Flow Confirmation

```python
foreign_net = sum(dp.foreign_buy - dp.foreign_sell for dp in week_prices)
foreign_trend = "INFLOW" if foreign_net > 0 else "OUTFLOW"

# Boost confidence by 10 if foreign flow aligns with signal
if signal in ("STRONG_BUY", "BUY") and foreign_trend == "INFLOW":
    confidence += 10
elif signal in ("SELL", "STRONG_SELL") and foreign_trend == "OUTFLOW":
    confidence += 10

confidence = min(100, confidence)
```

---

## 10. Data Flow: API → DB → Calculation → Signal

### Weekly Calculation Pipeline

```
┌─────────────────────┐
│  API Sync Job        │  (Scheduled: Saturday 10:00 WIB)
│  /broker-summary     │  → Upsert BrokerSummary + BrokerEntry
│  /bandar/accumulation│  → Upsert ApiSignal (type=accumulation)
│  /bandar/distribution│  → Upsert ApiSignal (type=distribution)
│  /sentiment          │  → Upsert ApiSignal (type=sentiment)
│  /smart-money        │  → Upsert ApiSignal (type=smart_money)
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  calculate_weekly   │  (Runs after sync completes)
│  For each stock:     │
│  1. Load BrokerEntry │  → find is_whale=True entries
│  2. whale_net_lots   │  → Section 3 formula
│  3. retail_exit_pct  │  → Section 2 formula
│  4. retail_partic.   │  → Section 4 formula
│  5. bandar_floor     │  → Section 5 formula
│  6. kekompakan       │  → Section 7 formula
│  7. VPA signal       │  → Daily, just pick latest
│  8. accum_score      │  → Section 8 formula
│  9. overall_signal   │  → Section 9 formula
│  10. Save WeeklyMetric│
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  generate_signals    │  (Runs after weekly metrics)
│  For each stock:     │
│  - If overall_signal│
│    is BUY/STRONG_BUY│
│  - Create TradeSignal│
│  with entry/stop/   │
│  target prices       │
└─────────────────────┘
```

### Daily Calculation Pipeline

```
┌─────────────────────┐
│  API Sync Job        │  (Scheduled: Mon-Fri 18:00 WIB)
│  /chart/daily/latest │  → Upsert DailyPrice
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  calculate_daily     │  (Runs after sync)
│  For each stock:     │
│  1. VPA signal       │  → Section 6 formula
│  2. Foreign flow     │  → Direct from API data
│  3. Price changes    │  → Week-over-week for WeeklyMetric
└─────────────────────┘
```

---

## 11. API Field → DB Column → Calculation Mapping

### Broker Summary API → BrokerEntry

| API Field | Array | BrokerEntry Column | Type | Notes |
|-----------|-------|--------------------|------|-------|
| `netbs_broker_code` | both | `broker_code` | str | "BK", "AI", etc. |
| `blot` | `brokers_buy` | `lots` | int | Buy lots |
| `netbs_buy_avg_price` | `brokers_buy` | `avg_price` | Decimal | Weighted avg buy price |
| `bval` | `brokers_buy` | `value` | Decimal | Buy value in IDR |
| `slot` | `brokers_sell` | `lots` (as abs) | int | abs(negative slot) = sell lots |
| `netbs_sell_avg_price` | `brokers_sell` | `avg_price` | Decimal | Avg sell price |
| `sval` | `brokers_sell` | `value` (as abs) | Decimal | abs(negative) = sell value |
| `type` | both | `investor_type` | str | "Asing"/"Lokal"/"Pemerintah" |
| `freq` | both | `frequency` | int | Transaction count (may come as str) |
| — | `brokers_buy` | `side` | str | "BUY" (constant) |
| — | `brokers_sell` | `side` | str | "SELL" (constant) |
| — | both | `is_whale` | bool | `broker_code in WHALE_BROKERS` |

### Broker Summary API → BrokerSummary

| API Field | BrokerSummary Column | Type | Notes |
|-----------|---------------------|------|-------|
| `bandar_detector.average` | `avg_price` | Decimal | Overall market average |
| `bandar_detector.avg.accdist` | `avg_accdist` | str | "Big Dist", "Small Acc", etc. |
| `bandar_detector.avg.amount` | `avg_amount` | Decimal | Net amount |
| `bandar_detector.avg.percent` | `avg_percent` | Decimal | Net percent |
| `bandar_detector.avg.vol` | `avg_vol` | Decimal | Net volume |
| `bandar_detector.broker_accdist` | `broker_accdist` | str | "Dist", "Acc", "Neutral" |
| `bandar_detector.total_buyer` | `total_buyer` | int | Number of buying brokers |
| `bandar_detector.total_seller` | `total_seller` | int | Number of selling brokers |
| `from` | `date_from` | date | Start of aggregation period |
| `to` | `date_to` | date | End of aggregation period |

### Daily Price API → DailyPrice

| API Field | DailyPrice Column | Type | Notes |
|-----------|-------------------|------|-------|
| `date` | `date` | date | Trading date |
| `open` | `open` | Decimal | |
| `high` | `high` | Decimal | |
| `low` | `low` | Decimal | |
| `close` | `close` | Decimal | Required |
| `volume` | `volume` | BigInteger | |
| `value` | `value` | Decimal | |
| `foreignbuy` | `foreign_buy` | Decimal | Foreign BUY **value** in IDR (not lots!) |
| `foreignsell` | `foreign_sell` | Decimal | Foreign SELL **value** in IDR (not lots!) |
| `foreignflow` | `foreign_flow` | Decimal | Cumulative foreign position |
| `frequency` | `frequency` | int | Transaction count |
| `shareoutstanding` | `shares_outstanding` | BigInteger | |

### Bandar API → ApiSignal

| API Field | ApiSignal Column | Type | Notes |
|-----------|-----------------|------|-------|
| `accumulation_score` | `score` | Decimal | When signal_type="accumulation" |
| `status` | `status` | str | "NEUTRAL", "ACCUMULATING", etc. |
| `confidence` | `confidence` | int | 0-100 |
| `recommendation` | `recommendation` | str | "BUY", "HOLD", "SELL" |
| `risk_level` | `risk_level` | str | "LOW", "MEDIUM", "HIGH" |
| `entry_zone.ideal_price` | `entry_ideal_price` | Decimal | |
| `entry_zone.max_price` | `entry_max_price` | Decimal | |
| `current_price` | `current_price` | Decimal | |
| `indicators.top_5_brokers` | `top_brokers` | JSONB | List of broker codes |
| `indicators` (full object) | `indicators` | JSONB | Full indicators for reference |

---

## 12. Calculation → WeeklyMetric Mapping

| WeeklyMetric Column | Calculation Source | Section |
|--------------------|--------------------|---------|
| `whale_net_lots` | Section 3: Whale Net | Sum of whale buy lots - whale sell lots |
| `whale_net_value` | Section 3: Whale Net | Sum of whale buy value - whale sell value |
| `whale_count` | Count distinct whale broker codes | In BrokerEntry for this period |
| `retail_exit_percent` | Section 2: Retail Exit % | retail_sell / (retail_buy + retail_sell) × 100 |
| `retail_participation_pct` | Section 4: Retail Participation | retail_total / total_market × 100 |
| `kekompakan_score` | Section 7: Kekompakan | same_direction / total_active × 100 |
| `vpa_signal` | Section 6: VPA | Latest daily VPA signal in the week |
| `price_change_week` | DailyPrice calc | (latest_close - prev_week_close) / prev_week_close × 100 |
| `volume_change_week` | DailyPrice calc | (latest_week_avg_vol - prev_week_avg_vol) / prev_week_avg_vol × 100 |
| `bandar_floor_price` | Section 5: Bandar Floor | Weighted avg buy price of whale BUY entries |
| `distance_to_floor_pct` | Section 5: Distance | (current - floor) / floor × 100 |
| `overall_signal` | Section 9: Signal | STRONG_BUY/BUY/WATCH/WAIT/SELL |
| `confidence_score` | Section 9: Confidence | 0-100 |
| `api_accumulation_score` | ApiSignal (accumulation) | Stored for comparison |
| `api_distribution_score` | ApiSignal (distribution) | Stored for comparison |
| `api_sentiment_status` | ApiSignal (sentiment) | Stored for comparison |
| `api_smart_money_status` | ApiSignal (smart_money) | Stored for comparison |

---

## 13. Complete Edge Case Reference

| Scenario | Handling | Returns |
|----------|---------|---------|
| Zero volume day | Skip VPA, all volume-based calcs return defaults | NEUTRAL, 0.0, 0 |
| No price history (new stock) | VPA needs 2 days minimum | NEUTRAL |
| Suspended stock (volume=0, no trades) | All calcs return defaults | NEUTRAL, 0.0, 0 |
| No broker activity for a stock | No BrokerEntry records | whale_net=0, retail_exit=0, kekompakan=0, floor=0 |
| Only 1 whale active | Kekompakan = 100% (trivially coordinated) | 100% |
| No whales active | No whale floor to calculate, no kekompakan | floor=0, kekompakan=0 |
| Broker appears in both buy+sell | Should not happen (net direction). If it does, treat as separate entries | Net them together |
| Division by zero in any calculation | Guard all divisions with zero-check | 0.0 |
| Negative whale_net (net distribution) | Valid signal — whales are selling | Negative int, whale_net_score=0 |
| retail_exit_pct > 100% | Cannot happen — retail_sell / (retail_buy + retail_sell) ≤ 1.0 | Max = 100% |
| accumulation_score out of range | Clamp to [0, 100] | 0-100 |
| Missing API signals (sync failed) | Use our calculations only, set api_* columns to NULL | Our signal only |
| Rate limit reached (partial sync) | Use whatever data is available, note in sync_logs | Partial data |
| Stock not in watchlist (ad-hoc query) | No data available, return 404 | N/A |

---

## 14. Configuration Defaults (from config.py)

```python
# Whale brokers — our curated list
WHALE_BROKERS = "AI,BK,YU,BB,AS,SS,CS"

# Retail brokers — known small retail (others default to RETAIL)
RETAIL_BROKERS = "YP,XL,PD,XC,CP,AB"

# VPA thresholds
THRESHOLD_PRICE_PCT = 1.0   # 1% minimum price change
THRESHOLD_VOLUME_PCT = 5.0  # 5% minimum volume change

# Accumulation score baselines
MIN_WHALE_NET_LOTS = 50000   # 50K lots baseline for whale_net_score
MIN_RETAIL_EXIT_PCT = 50.0   # 50% baseline for retail_exit_score

# Kekompakan threshold
KEKOMPAKAN_THRESHOLD = 60.0  # 60% = coordinated

# Data retention
DATA_RETENTION_MONTHS = 12
```

> **Note:** All thresholds should be configurable via environment variables or config, not hardcoded in calculation functions. This allows tuning based on market conditions.

---

## 15. Quick Reference: Which Data Source for Which Metric

| Metric | Source | Table | Frequency | Calculated By |
|--------|--------|-------|-----------|---------------|
| VPA Signal | `/chart/daily` | `daily_prices` | Daily | Our code |
| Foreign Flow | `/chart/daily` | `daily_prices` | Daily | Direct from API |
| Price Changes | `/chart/daily` | `daily_prices` | Daily | Our code |
| Whale Net Lots | `/broker-summary` | `broker_entries` | Weekly | Our code |
| Retail Exit % | `/broker-summary` | `broker_entries` | Weekly | Our code |
| Retail Participation | `/broker-summary` | `broker_entries` | Weekly | Our code |
| Bandar Floor Price | `/broker-summary` | `broker_entries` | Weekly | Our code |
| Kekompakan | `/broker-summary` | `broker_entries` | Weekly | Our code |
| Accumulation Score | `/broker-summary` + `daily_prices` | `weekly_metrics` | Weekly | Our code |
| Overall Signal | All of the above | `weekly_metrics` | Weekly | Our code |
| API Accumulation | `/bandar/accumulation` | `api_signals` | Weekly | API pre-computed |
| API Distribution | `/bandar/distribution` | `api_signals` | Weekly | API pre-computed |
| API Sentiment | `/sentiment` | `api_signals` | Weekly | API pre-computed |
| API Smart Money | `/bandar/smart-money` | `api_signals` | Weekly | API pre-computed |

---

## 16. Validation Checklist for Backend Developer

- [ ] **Retail Exit**: Uses `is_whale` flag, NOT `investor_type` from API
- [ ] **Whale Net**: Net = buy lots - sell lots for whale brokers only
- [ ] **Bandar Floor**: Weighted average (avg_price × lots / sum(lots)), NOT simple average
- [ ] **Bandar Floor**: Only uses BUY-side entries, NOT sell-side
- [ ] **VPA**: Uses daily close prices, NOT weekly averages
- [ ] **VPA**: Applies thresholds (1% price, 5% volume) to filter noise
- [ ] **VPA**: Foreign flow is SEPARATE from VPA, NOT combined
- [ ] **Kekompakan**: Uses count of whales, NOT lot sizes
- [ ] **Kekompakan**: Direction based on majority of active whales
- [ ] **Accumulation Score**: Weighted sum (40+30+20+10=100%), NOT equal weights
- [ ] **All divisions**: Guarded against zero denominator
- [ ] **All scores**: Clamped to valid range (0-100 or 0%-100%)
- [ ] **BrokerEntry.lots**: Always stored as positive integer (abs of slot)
- [ ] **BrokerEntry.value**: Always stored as positive Decimal (abs of sval)
- [ ] **BrokerEntry.side**: 'BUY' or 'SELL' determines direction
- [ ] **is_whale**: Set during ingestion from config.py WHALE_BROKERS list
- [ ] **investor_type**: Stored as metadata, NEVER used for whale classification