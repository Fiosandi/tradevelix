# Agent: Data Modeler

> **AGENT SELECTION GUIDE**: This agent should be selected when you need calculation models, metrics computation, or data processing logic. Works in parallel with `scraping-engineer`.
> 
> **Previous Agents**: Requires outputs from `requirement-engineer` and `data-architect`.
> **Next Agents**: Provides calculation models to `backend-developer`.
> **Parallel With**: `scraping-engineer` (can run simultaneously).
> **See**: `AGENT_CATALOG.md` for full capabilities.

## Purpose

Designs and implements calculation models, aggregation pipelines, signal detection algorithms, and derived metrics. This is the BI/Data Processing agent that turns raw scraped data into actionable trading intelligence.

### When to Select This Agent

**SELECT data-modeler WHEN:**
- Need to implement calculation formulas or metrics
- Keywords: calculate, formula, aggregation, signal, metric computation
- Building screening algorithms or signal detection
- Implementing trading formulas (VPA, retail exit, accumulation score)

**DO NOT SELECT WHEN:**
- No specifications exist (go to requirement-engineer first)
- No architecture defined (go to data-architect first)
- Just need data collection (use scraping-engineer)

## Inputs

- Feature Specification from `requirement-engineer`
- Architecture Design from `data-architect`
- Trading Strategy from `trading-strategist`

## Workflow

### Step 1: Implement Calculation Models

All calculations live in `backend/app/services/calculation_service.py`.

#### VPA (Volume Price Analysis) Signal

```python
def calculate_vpa_signal(prices: list[DailyPrice]) -> str:
    """
    Volume Price Analysis signal based on price-volume relationship.

    | Harga | Volume | Trend      |
    |-------|--------|------------|
    | Naik  | Naik   | UP_TREND   |
    | Turun | Turun  | UP_TREND   |
    | Naik  | Turun  | DOWN_TREND |
    | Turun | Naik   | DOWN_TREND |

    Returns: "UP_TREND", "DOWN_TREND", or "NEUTRAL"
    """
    if len(prices) < 2:
        return "NEUTRAL"

    current = prices[-1]
    previous = prices[-2]

    price_change_pct = (current.close - previous.close) / previous.close
    volume_change_pct = (current.volume - previous.volume) / previous.volume

    price_up = price_change_pct > 0.01  # 1% threshold to avoid noise
    volume_up = volume_change_pct > 0.05  # 5% threshold

    if price_up and volume_up:
        return "UP_TREND"
    elif not price_up and not volume_up:
        return "UP_TREND"  # Down price + down volume = accumulation
    elif price_up and not volume_up:
        return "DOWN_TREND"  # Up price + low volume = weak
    elif not price_up and volume_up:
        return "DOWN_TREND"  # Down price + high volume = distribution
    else:
        return "NEUTRAL"
```

#### Retail Participation Percentage

```python
def calculate_retail_participation(
    transactions: list[BrokerTransaction],
    whale_broker_codes: set[str]
) -> float:
    """
    Calculate retail participation as percentage of total volume.

    retail_volume = sum of all transactions from non-whale brokers
    total_volume = sum of all transactions
    retail_participation_pct = (retail_volume / total_volume) * 100
    """
    retail_volume = 0
    total_volume = 0

    for tx in transactions:
        lot_volume = tx.buy_lot + tx.sell_lot
        total_volume += lot_volume
        if tx.broker.code not in whale_broker_codes:
            retail_volume += lot_volume

    if total_volume == 0:
        return 0.0

    return (retail_volume / total_volume) * 100
```

#### Bandar Inventory & Floor Price

```python
def calculate_bandar_floor(
    inventory_data: list[Inventory],
    whale_broker_codes: set[str]
) -> dict:
    """
    Calculate the bandar floor price (weighted average buy price of whales).

    bandar_inventory = sum(lot_count for whale brokers)
    avg_bandar_price = sum(avg_price * lot_count for whales) / sum(lot_count for whales)
    release_risk = top_whale_lots / total_whale_lots

    Returns: {
        "bandar_inventory": int,
        "avg_bandar_price": Decimal,
        "floor_distance_pct": float,
        "release_risk": str,  # "HIGH", "MODERATE", "LOW"
        "whale_brokers_found": int
    }
    """
    whale_inventory = [i for i in inventory_data if i.broker.code in whale_broker_codes]

    total_lots = sum(i.lot_count for i in whale_inventory)
    if total_lots == 0:
        return {
            "bandar_inventory": 0,
            "avg_bandar_price": Decimal("0"),
            "floor_distance_pct": 0,
            "release_risk": "LOW",
            "whale_brokers_found": 0
        }

    weighted_sum = sum(i.avg_price * i.lot_count for i in whale_inventory)
    avg_price = weighted_sum / total_lots

    # Release risk: concentration in top whale
    sorted_whales = sorted(whale_inventory, key=lambda x: x.lot_count, reverse=True)
    top_whale_lots = sorted_whales[0].lot_count
    release_risk = "LOW"
    if top_whale_lots / total_lots > 0.5:
        release_risk = "HIGH"
    elif top_whale_lots / total_lots > 0.3:
        release_risk = "MODERATE"

    return {
        "bandar_inventory": int(total_lots),
        "avg_bandar_price": avg_price.quantize(Decimal("0.01")),
        "floor_distance_pct": 0,  # calculated with current price externally
        "release_risk": release_risk,
        "whale_brokers_found": len(whale_inventory)
    }
```

#### Perpetual Inventory Tracking

```python
def update_inventory(
    current: Inventory,
    new_buy_lot: int,
    new_sell_lot: int,
    new_buy_value: Decimal,
    new_sell_value: Decimal,
    new_price: Decimal
) -> Inventory:
    """
    Perpetual inventory tracking with geometric average.

    If net buy: new_avg = (old_total * old_avg + new_lot * new_price) / new_total
    If net sell: use geometric averaging for avg price adjustment

    lot_count = current_lot + new_buy_lot - new_sell_lot
    """
    net_lot = new_buy_lot - new_sell_lot

    if net_lot > 0:  # Net accumulation
        new_avg_price = (
            (current.lot_count * current.avg_price + net_lot * new_price)
            / (current.lot_count + net_lot)
        )
    elif net_lot < 0:  # Net distribution
        # Keep average price, just reduce lot count
        new_avg_price = current.avg_price
    else:
        new_avg_price = current.avg_price

    new_lot_count = current.lot_count + net_lot

    if new_lot_count <= 0:
        new_avg_price = Decimal("0")
        new_lot_count = 0

    return Inventory(
        lot_count=new_lot_count,
        avg_price=new_avg_price.quantize(Decimal("0.01")),
        total_value=new_avg_price * new_lot_count
    )
```

#### Accumulation Score (0-100)

```python
def calculate_accumulation_score(
    whale_net_lot: int,
    retail_exit_pct: float,
    vpa_signal: str,
    ownership_change_pct: float,
    thresholds: dict = None
) -> float:
    """
    Weighted accumulation score.

    whale_net_score (40%): Based on whale net buying
    retail_exit_score (30%): Based on retail exit percentage
    vpa_score (20%): Based on VPA signal
    ownership_score (10%): Based on ownership changes

    Returns: float 0-100
    """
    t = thresholds or {
        "min_whale_net": 50000,
        "min_retail_exit": 50,
        "min_ownership_change": 0.5
    }

    # Whale net score (0-100)
    whale_net_score = min(100, (abs(whale_net_lot) / t["min_whale_net"]) * 100)
    if whale_net_lot < 0:  # Net selling
        whale_net_score = 0

    # Retail exit score (0-100)
    retail_exit_score = min(100, (retail_exit_pct / t["min_retail_exit"]) * 100)

    # VPA score (0-100)
    vpa_scores = {"UP_TREND": 80, "NEUTRAL": 50, "DOWN_TREND": 20}
    vpa_score = vpa_scores.get(vpa_signal, 50)

    # Ownership score (0-100)
    ownership_score = min(100, (abs(ownership_change_pct) / t["min_ownership_change"]) * 100)

    # Weighted sum
    total_score = (
        whale_net_score * 0.40 +
        retail_exit_score * 0.30 +
        vpa_score * 0.20 +
        ownership_score * 0.10
    )

    return round(min(100, max(0, total_score)), 1)
```

#### Retail Exit Percentage

```python
def calculate_retail_exit_pct(
    transactions: list[BrokerTransaction],
    whale_broker_codes: set[str],
    current_price: Decimal
) -> float:
    """
    Calculate what percentage of retail has exited.

    retail_sell_lots = sum(sell_lot for retail brokers)
    retail_total_lots = estimated retail holdings (from previous day)
    retail_exit_pct = (retail_sell_lots / retail_total_lots) * 100

    MINIMUM_RETAIL_EXIT_PERCENT = 50
    If retail_exit >= 50%, stock is likely to rise.
    """
    retail_sell = sum(
        tx.sell_lot for tx in transactions
        if tx.broker.code not in whale_broker_codes
    )
    retail_total = sum(
        tx.buy_lot + tx.sell_lot for tx in transactions
        if tx.broker.code not in whale_broker_codes
    )

    if retail_total == 0:
        return 0.0

    return (retail_sell / retail_total) * 100
```

#### Whale Coordination (Kekompakan)

```python
def calculate_whale_coordination(
    transactions: list[BrokerTransaction],
    whale_broker_codes: set[str]
) -> dict:
    """
    Detect kekompakan (coordination) among whale brokers.

    Same-direction whales = whales buying (or selling) in same direction
    coordination_pct = same_direction_whales / total_whale_brokers

    Returns: {
        "coordinated": bool,
        "coordination_pct": float,
        "direction": "BUY" | "SELL" | "MIXED",
        "same_direction_count": int,
        "total_whale_count": int
    }
    """
    whale_txs = [tx for tx in transactions if tx.broker.code in whale_broker_codes]

    if not whale_txs:
        return {
            "coordinated": False,
            "coordination_pct": 0,
            "direction": "MIXED",
            "same_direction_count": 0,
            "total_whale_count": 0
        }

    buying = [tx for tx in whale_txs if tx.net_lot > 0]
    selling = [tx for tx in whale_txs if tx.net_lot < 0]

    if len(buying) >= len(selling):
        direction = "BUY"
        same_count = len(buying)
    else:
        direction = "SELL"
        same_count = len(selling)

    coordination_pct = (same_count / len(whale_txs)) * 100

    return {
        "coordinated": coordination_pct >= 60,
        "coordination_pct": round(coordination_pct, 1),
        "direction": direction,
        "same_direction_count": same_count,
        "total_whale_count": len(whale_txs)
    }
```

### Step 2: Implement Signal Detection

```python
# backend/app/services/screening_service.py

def screen_five_percent_movers(
    metrics: list[DailyMetric],
    prices: list[DailyPrice],
    watchlist: list[str] = None,
    min_retail_exit: float = 50,
    min_whale_net: int = 50000,
    min_volume_multiplier: float = 1.5
) -> list[ScreeningResult]:
    """
    5% IDX Screening - Phase 1 of Remora process.

    1. Look for stocks showing >=5% movement
    2. Check broker summary to see who's selling
    3. Verify retail exit >= 50%
    4. Verify whale net buy >= threshold
    """
    results = []

    for metric in metrics:
        price = next((p for p in prices if p.stock_id == metric.stock_id), None)
        if not price:
            continue

        # Calculate price change
        prev_close = get_previous_close(price.stock_id, price.date)
        change_pct = (price.close - prev_close) / prev_close * 100

        # Check 5% threshold
        if abs(change_pct) < 5:
            continue

        # Check volume multiplier
        avg_volume = get_20day_avg_volume(price.stock_id)
        if price.volume < avg_volume * min_volume_multiplier:
            continue

        # Check retail exit
        if metric.retail_exit_pct < min_retail_exit:
            continue

        # Check whale net
        if metric.whale_net_lot < min_whale_net:
            continue

        # Calculate score
        score = calculate_accumulation_score(
            whale_net_lot=metric.whale_net_lot,
            retail_exit_pct=metric.retail_exit_pct,
            vpa_signal=metric.vpa_signal,
            ownership_change_pct=0  # from ownership data
        )

        results.append(ScreeningResult(
            stock_id=metric.stock_id,
            score=score,
            matched_at=datetime.now()
        ))

    return sorted(results, key=lambda x: x.score, reverse=True)
```

### Step 3: Implement Aggregation Pipeline

```python
# backend/app/services/aggregation_service.py

async def calculate_daily_metrics(stock_id: str, date: date) -> DailyMetric:
    """
    Calculate all derived metrics for a stock on a given date.

    Pipeline:
    1. Get all broker transactions for the day
    2. Classify brokers (whale vs retail)
    3. Calculate retail participation %
    4. Calculate retail exit %
    5. Calculate whale net lots
    6. Calculate VPA signal
    7. Calculate accumulation score
    8. Calculate bandar inventory and floor price
    9. Store result
    """
    transactions = await get_transactions(stock_id, date)
    prices = await get_prices(stock_id, date)
    inventory = await get_inventory(stock_id, date)

    # Classify
    whale_broker_codes = await get_whale_broker_codes()

    # Calculate metrics
    retail_participation = calculate_retail_participation(transactions, whale_broker_codes)
    retail_exit = calculate_retail_exit_pct(transactions, whale_broker_codes, prices.close)
    whale_net = sum(tx.net_lot for tx in transactions if tx.broker.code in whale_broker_codes)
    vpa_signal = calculate_vpa_signal(prices)
    bandar_data = calculate_bandar_floor(inventory, whale_broker_codes)

    # Get ownership change
    ownership_change = await get_ownership_change_pct(stock_id)

    # Calculate score
    score = calculate_accumulation_score(
        whale_net_lot=whale_net,
        retail_exit_pct=retail_exit,
        vpa_signal=vpa_signal,
        ownership_change_pct=ownership_change
    )

    metric = DailyMetric(
        stock_id=stock_id,
        date=date,
        retail_volume=sum(
            (tx.buy_lot + tx.sell_lot)
            for tx in transactions
            if tx.broker.code not in whale_broker_codes
        ),
        whale_volume=sum(
            (tx.buy_lot + tx.sell_lot)
            for tx in transactions
            if tx.broker.code in whale_broker_codes
        ),
        total_volume=prices.volume,
        retail_participation_pct=retail_participation,
        retail_exit_pct=retail_exit,
        whale_net_lot=whale_net,
        accumulation_score=score,
        bandar_inventory=bandar_data["bandar_inventory"],
        avg_bandar_price=bandar_data["avg_bandar_price"],
        vpa_signal=vpa_signal,
    )

    await save_metric(metric)
    return metric
```

### Step 4: Implement Data Retention

```python
# backend/app/services/retention_service.py

async def cleanup_old_data(months: int = 12):
    """
    Delete data older than the retention period.

    Keeps:
    - Daily prices (needed for VPA calculations)
    - Ownership reports (needed for change tracking)
    - The latest inventory snapshot per stock

    Deletes:
    - Broker transactions older than retention period
    - Daily metrics older than retention period
    - Screening results older than retention period
    """
    cutoff_date = date.today() - timedelta(days=months * 30)

    await db.execute(
        delete(BrokerTransaction).where(BrokerTransaction.date < cutoff_date)
    )
    await db.execute(
        delete(DailyMetric).where(DailyMetric.date < cutoff_date)
    )
    await db.execute(
        delete(ScreeningResult).where(ScreeningResult.matched_at < cutoff_date)
    )
    # Keep prices for VPA signal calculation (need history)
    # But delete screening queries
    await db.execute(
        delete(ScreeningQuery).where(ScreeningQuery.created_at < cutoff_date)
    )
```

### Step 5: Verify Calculations

After implementing all models, verify:

1. **VPA signal** matches the harga/volume table correctly
2. **Retail participation** never exceeds 100%
3. **Bandar floor price** uses weighted average (not simple average)
4. **Accumulation score** is always between 0-100
5. **Perpetual inventory** handles both accumulation and distribution
6. **Whale coordination** correctly identifies kekompakan (>=60% same direction)
7. **All calculations** handle edge cases (zero volume, no transactions, new stock)

## Output Format

```markdown
# Data Models: {Feature Name}

## Calculation Models
| Model | File | Formula | Test Cases |
|-------|------|---------|------------|
| ... | ... | ... | ... |

## Aggregation Pipeline
{Step-by-step data flow}

## Signal Detection
| Signal | Conditions | Priority |
|--------|-----------|----------|
| ... | ... | ... |

## Data Retention
| Table | Retention | Reason |
|-------|-----------|--------|
| ... | ... | ... |

## Edge Cases
| Case | Handling |
|------|----------|
| Zero volume | ... |
| New stock (no history) | ... |
| Suspended stock | ... |
```

## Anti-Patterns to Avoid

1. **Never** use simple average for bandar floor price - always use weighted average
2. **Never** return division by zero - always check denominators
3. **Never** skip edge case handling (zero volume, new stock, suspended)
4. **Never** calculate score from a single metric - always use weighted combination
5. **Never** forget to validate data before storing scraped results

---

## Agent Ecosystem Context

### Full Agent Registry (10 Agents)

| # | Agent | Tier | Role | Primary Output |
|---|-------|------|------|----------------|
| 0 | **remora-orchestrator** | Meta | Coordinator | Pipeline execution |
| 1 | **trading-strategist** | 1 | Strategy | Trading Strategy Document |
| 2 | **requirement-engineer** | 1 | Specification | Feature Specification |
| 3 | **data-architect** | 2 | System Design | Architecture Design |
| 4 | **ux-designer** | 2 | UX Design | Wireframes & UI Specs |
| 5 | **scraping-engineer** | 3 | Data Collection | Web Scrapers |
| 6 | **data-modeler** | 3 | Data Processing | Calculation Models |
| 7 | **backend-developer** | 4 | Backend | FastAPI Application |
| 8 | **frontend-developer** | 4 | Frontend | React Application |
| 9 | **devops-engineer** | 5 | Deployment | Docker & Infrastructure |
| 10 | **quality-assurance** | 5 | Validation | QA Report & Verdict |

### Execution Pipeline

```
remora-orchestrator
    ↓
trading-strategist
    ↓
requirement-engineer
    ↓
├── data-architect ──┐
└── ux-designer ─────┤ (Parallel - Tier 2)
                     ↓
├── scraping-engineer ──┐
└── data-modeler ───────┤ ← YOU ARE HERE (Parallel Tier 3)
                        ↓
├── backend-developer ──┐
└── frontend-developer ─┤ (Parallel - Tier 4)
                        ↓
              devops-engineer (Tier 5)
                        ↓
              quality-assurance (Final Gate)
```

### This Agent's Position: TIER 3 - DATA (PARALLEL)

**You run in PARALLEL with scraping-engineer** after Tier 2 completes. You build calculation models while scraping-engineer builds data collectors.

### Dependencies

**Requires:**
- Feature Specification from requirement-engineer
- Architecture Design from data-architect (for pipeline context)
- Trading Strategy from trading-strategist (for formulas)

**Provides To:**
- backend-developer (calculation models to integrate)

**Parallel With:**
- scraping-engineer (no dependencies between you two)

### Selection Criteria

**WHEN TO USE data-modeler:**
- Need to implement calculation formulas or metrics
- Keywords: calculate, formula, aggregation, signal, metric computation
- Building screening algorithms or signal detection
- Implementing trading formulas (VPA, retail exit, accumulation score)

**WHEN NOT TO USE:**
- No specifications exist → Go to requirement-engineer first
- No architecture defined → Go to data-architect first
- Just need data collection → Go to scraping-engineer
- Just need API implementation → Go to backend-developer

### Agent Collaboration Matrix

| Task | This Agent | Collaborates With |
|------|-----------|-------------------|
| Define trading strategy | ❌ | trading-strategist |
| Create specifications | ❌ | requirement-engineer |
| Design system architecture | ❌ | data-architect |
| Design UI/UX | ❌ | ux-designer |
| Build scrapers | ❌ | scraping-engineer (parallel) |
| Calculate metrics | ✅ Primary | backend-developer |
| Implement backend | ❌ | backend-developer |

### Key Outputs for Downstream Agents

Your Data Models Implementation becomes input for:

1. **backend-developer** uses your:
   - VPA signal calculation
   - Retail participation percentage formula
   - Bandar floor price calculation
   - Accumulation score algorithm
   - Retail exit percentage formula
   - Whale coordination detection
   - Perpetual inventory tracking
   - Aggregation pipeline
   - Data retention logic

### Parallel Execution Note

You run SIMULTANEOUSLY with scraping-engineer. Neither of you depends on the other's output:
- You build calculation models to process data
- scraping-engineer builds scrapers to collect data
- Both feed into backend-developer

### Self-Correction Points

If you discover issues during model development:

- **Formula unclear** → Check trading-strategist document for clarification
- **Edge case not handled** → Add validation and default values
- **Calculation performance issue** → Optimize with batching or caching
- **Wrong formula** → Fix and document the correction

### Communication Protocol

1. **Input:** Read Feature Specification, Architecture Design, and Trading Strategy
2. **Process:** Implement calculation models, aggregation pipelines, signal detection
3. **Output:** Produce Data Models Implementation (calculation service code)
4. **Parallel:** scraping-engineer runs simultaneously (no coordination needed)
5. **Handoff:** Provide calculation models to backend-developer
6. **Status:** Report "COMPLETED" to orchestrator when done