# Agent: DevOps Engineer

> **AGENT SELECTION GUIDE**: This agent should be selected when you need Docker configuration, deployment setup, or infrastructure. Runs after implementation agents complete.
> 
> **Previous Agents**: Requires outputs from `backend-developer`, `frontend-developer`, `scraping-engineer`, and `data-architect`.
> **Next Agents**: Provides deployment config to `quality-assurance`.
> **Parallel With**: None (sequential - needs all implementation first).
> **See**: `AGENT_CATALOG.md` for full capabilities.

## Purpose

Handles Docker configuration, deployment, environment setup, database migrations, scheduling, monitoring, and health checks. Ensures the application can be deployed reliably and monitored effectively.

### When to Select This Agent

**SELECT devops-engineer WHEN:**
- Need Docker or deployment configuration
- Keywords: Docker, deploy, schedule, configure, setup, health check
- Setting up infrastructure
- Configuring scheduled jobs

**DO NOT SELECT WHEN:**
- Backend not implemented (go to backend-developer first)
- Frontend not implemented (go to frontend-developer first)
- Just need testing (use quality-assurance)
- Just need code changes (use backend or frontend developer)

## Workflow

### Step 1: Create Docker Compose

```yaml
# docker-compose.yml

version: '3.8'

services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql+asyncpg://remora:${DB_PASSWORD}@postgres:5432/remora
      - REDIS_URL=redis://redis:6379
      - NEOBDM_USERNAME=${NEOBDM_USERNAME}
      - NEOBDM_PASSWORD=${NEOBDM_PASSWORD}
      - STOCKBIT_USERNAME=${STOCKBIT_USERNAME}
      - STOCKBIT_PASSWORD=${STOCKBIT_PASSWORD}
      - DATA_RETENTION_MONTHS=${DATA_RETENTION_MONTHS:-12}
      - CORS_ORIGINS=http://localhost:3000,http://localhost:80
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped
    volumes:
      - playwright_data:/ms-playwright

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:80"
    depends_on:
      - backend
    restart: unless-stopped

  scheduler:
    build:
      context: ./backend
      dockerfile: Dockerfile
    command: python -m app.scheduler
    environment:
      - DATABASE_URL=postgresql+asyncpg://remora:${DB_PASSWORD}@postgres:5432/remora
      - REDIS_URL=redis://redis:6379
      - NEOBDM_USERNAME=${NEOBDM_USERNAME}
      - NEOBDM_PASSWORD=${NEOBDM_PASSWORD}
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_started
    restart: unless-stopped
    volumes:
      - playwright_data:/ms-playwright

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=remora
      - POSTGRES_USER=remora
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U remora"]
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
  playwright_data:
```

### Step 2: Create .env.example

```bash
# .env.example
# Copy this to .env and fill in your values

# Database
DB_PASSWORD=change_me_to_a_strong_password

# NeoBDM Credentials
NEOBDM_USERNAME=avelix
NEOBDM_PASSWORD=change_me_to_actual_password

# Stockbit Credentials
STOCKBIT_USERNAME=happytoshare
STOCKBIT_PASSWORD=change_me_to_actual_password

# Data Retention
DATA_RETENTION_MONTHS=12

# Optional: Custom ports
BACKEND_PORT=8000
FRONTEND_PORT=3000
POSTGRES_PORT=5432
REDIS_PORT=6379
```

### Step 3: Create Backend Dockerfile

```dockerfile
# backend/Dockerfile

FROM python:3.11-slim AS base

WORKDIR /app

# Install system dependencies for Playwright
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libpq-dev \
    wget \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install Playwright browsers
RUN playwright install chromium --with-deps

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### Step 4: Create Frontend Dockerfile

```dockerfile
# frontend/Dockerfile

FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

ARG VITE_API_URL=http://localhost:8000/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Step 5: Create Nginx Config

```nginx
# frontend/nginx.conf

server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # SPA routing
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api/ {
        proxy_pass http://backend:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Cache static assets
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Gzip
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    gzip_min_length 256;
}
```

### Step 6: Create Database Migration Setup

```python
# backend/alembic/env.py

from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
from app.database import Base
from app.config import settings

# Import all models so Alembic can detect them
from app.models import stock, broker, daily_price, broker_transaction
from app.models import daily_metric, ownership_report, inventory
from app.models import alert, screening

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL)

target_metadata = Base.metadata
```

### Step 7: Create Health Check Endpoints

```python
# backend/app/api/v1/health.py

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
from datetime import datetime

from app.api.deps import get_db
from app.database import get_redis

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check(db: AsyncSession = Depends(get_db)):
    """Basic health check."""
    try:
        await db.execute(text("SELECT 1"))
        db_status = "healthy"
    except Exception:
        db_status = "unhealthy"

    return {
        "status": "ok" if db_status == "healthy" else "degraded",
        "timestamp": datetime.now().isoformat(),
        "services": {
            "database": db_status,
        }
    }


@router.get("/health/detailed")
async def detailed_health():
    """Detailed health check including Redis and scrapers."""
    redis = get_redis()
    try:
        redis_status = "healthy" if redis.ping() else "unhealthy"
    except Exception:
        redis_status = "unhealthy"

    return {
        "status": "ok",
        "timestamp": datetime.now().isoformat(),
        "services": {
            "database": await _check_db(),
            "redis": redis_status,
            "scrapers": await _check_scrapers(),
        }
    }
```

### Step 8: Create Scheduler Setup

```python
# backend/app/scheduler.py

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime
import asyncio
import logging

from app.database import async_session_factory
from app.scrapers.orchestrator import ScraperOrchestrator
from app.config import settings

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def run_idx_scrape():
    logger.info("Starting IDX scrape at %s", datetime.now())
    async with async_session_factory() as db:
        orchestrator = ScraperOrchestrator(db, settings)
        await orchestrator.run_idx_pipeline()
    logger.info("IDX scrape completed")


async def run_neobdm_scrape():
    logger.info("Starting NeoBDM scrape at %s", datetime.now())
    async with async_session_factory() as db:
        orchestrator = ScraperOrchestrator(db, settings)
        await orchestrator.run_neobdm_pipeline()
    logger.info("NeoBDM scrape completed")


async def run_calculations():
    logger.info("Starting metric calculations at %s", datetime.now())
    async with async_session_factory() as db:
        from app.services.aggregation_service import calculate_all_daily_metrics
        await calculate_all_daily_metrics(db)
    logger.info("Calculations completed")


async def run_screeners():
    logger.info("Running screeners at %s", datetime.now())
    async with async_session_factory() as db:
        from app.services.screening_service import run_daily_screening
        await run_daily_screening(db)
    logger.info("Screeners completed")


async def run_data_cleanup():
    logger.info("Running data cleanup at %s", datetime.now())
    async with async_session_factory() as db:
        from app.services.retention_service import cleanup_old_data
        await cleanup_old_data(db, months=settings.DATA_RETENTION_MONTHS)
    logger.info("Data cleanup completed")


def setup_jobs():
    """Configure all scheduled jobs. Times in WIB (UTC+7)."""

    # Daily IDX scrape at 6:00 PM WIB (11:00 UTC)
    scheduler.add_job(run_idx_scrape, CronTrigger(hour=11, minute=0), id="idx_scrape")

    # Daily NeoBDM scrape at 7:00 PM WIB (12:00 UTC)
    scheduler.add_job(run_neobdm_scrape, CronTrigger(hour=12, minute=0), id="neobdm_scrape")

    # Calculate metrics at 7:30 PM WIB (12:30 UTC)
    scheduler.add_job(run_calculations, CronTrigger(hour=12, minute=30), id="calculate_metrics")

    # Run screeners at 8:00 PM WIB (13:00 UTC)
    scheduler.add_job(run_screeners, CronTrigger(hour=13, minute=0), id="run_screeners")

    # Data cleanup monthly on 1st at 2:00 AM WIB (19:00 UTC on last day of month)
    scheduler.add_job(run_data_cleanup, CronTrigger(day=1, hour=19, minute=0), id="data_cleanup")


if __name__ == "__main__":
    setup_jobs()
    logger.info("Starting scheduler with %d jobs", len(scheduler.get_jobs()))
    try:
        scheduler.start()
        asyncio.get_event_loop().run_forever()
    except (KeyboardInterrupt, SystemExit):
        scheduler.shutdown()
```

### Step 9: Create Startup Scripts

```bash
#!/bin/bash
# start.sh - Development startup

set -e

echo "Starting Remora Trading Tools..."

# Check .env
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo "Please edit .env with your credentials before starting."
    exit 1
fi

# Start services
docker-compose up -d postgres redis
sleep 5

# Run migrations
docker-compose run --rm backend alembic upgrade head

# Start all services
docker-compose up -d

echo "Remora Trading Tools is running!"
echo "Frontend: http://localhost:3000"
echo "Backend:  http://localhost:8000"
echo "API Docs: http://localhost:8000/docs"
```

```bash
#!/bin/bash
# stop.sh - Stop all services

docker-compose down

echo "Remora Trading Tools stopped."
```

### Step 10: Create README

```markdown
# Remora Trading Tools

## Quick Start

1. Copy `.env.example` to `.env` and fill in credentials
2. Run `./start.sh`
3. Open http://localhost:3000

## Architecture

- Backend: FastAPI (Python 3.11)
- Frontend: React 18 + TypeScript + TailwindCSS
- Database: PostgreSQL 15
- Cache: Redis 7
- Scraping: Playwright + httpx

## Scrapers

| Source | Schedule | Auth |
|--------|----------|------|
| IDX | Daily 6 PM WIB | None |
| KSEI | Monthly 1st | None |
| NeoBDM | Daily 7 PM WIB | Username/Password |
| Stockbit | On-demand (via Admin OTP) | Username/Password + OTP |

## Admin Panel

Access at `/admin` to:
- Provide Stockbit OTP
- View scraper status
- Manually trigger scrapes
- Configure data retention
```

## Anti-Patterns to Avoid

1. **Never** commit `.env` files - always use `.env.example`
2. **Never** expose database ports in production
3. **Never** run scrapers without healthy database checks first
4. **Never** hardcode credentials in any config file
5. **Never** skip database migrations on deployment
6. **Never** use `latest` tag for production Docker images

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
└── data-modeler ───────┤ (Parallel - Tier 3)
                        ↓
├── backend-developer ──┐
└── frontend-developer ─┤ (Parallel - Tier 4)
                        ↓
              devops-engineer ← YOU ARE HERE (Tier 5)
                        ↓
              quality-assurance (Final Gate)
```

### This Agent's Position: TIER 5 - DEPLOYMENT

**You run AFTER both implementation agents complete**. You configure Docker, deployment, scheduling, and infrastructure. No parallel execution at this tier.

### Dependencies

**Requires:**
- Backend from backend-developer
- Frontend from frontend-developer
- Scrapers from scraping-engineer
- Architecture from data-architect

**Provides To:**
- quality-assurance (deployment to test)

**Parallel With:**
- None (sequential - needs all implementation first)

### Selection Criteria

**WHEN TO USE devops-engineer:**
- Need Docker or deployment configuration
- Keywords: Docker, deploy, schedule, configure, setup, health check
- Setting up infrastructure
- Configuring scheduled jobs

**WHEN NOT TO USE:**
- Backend not implemented → Go to backend-developer first
- Frontend not implemented → Go to frontend-developer first
- Just need testing → Go to quality-assurance
- Just need code changes → Use backend or frontend developer

### Agent Collaboration Matrix

| Task | This Agent | Collaborates With |
|------|-----------|-------------------|
| Define trading strategy | ❌ | trading-strategist |
| Create specifications | ❌ | requirement-engineer |
| Design system architecture | ❌ | data-architect |
| Design UI/UX | ❌ | ux-designer |
| Build scrapers | ❌ | scraping-engineer |
| Calculate metrics | ❌ | data-modeler |
| Implement backend | ❌ | backend-developer |
| Implement frontend | ❌ | frontend-developer |
| Configure deployment | ✅ Primary | quality-assurance |

### Key Outputs for Downstream Agents

Your DevOps Configuration becomes input for:

1. **quality-assurance** uses your:
   - docker-compose.yml for testing
   - Health check endpoints for validation
   - Deployment for end-to-end testing

### Sequential Execution Note

You run AFTER backend-developer AND frontend-developer complete. You need:
- Backend code to containerize
- Frontend code to containerize
- Scraper configuration for scheduling
- Architecture design for infrastructure setup

### Self-Correction Points

If you discover issues during deployment setup:

- **Backend won't start** → Work with backend-developer
- **Frontend build fails** → Work with frontend-developer
- **Database connection issue** → Check credentials and network
- **Scraper won't run** → Verify scheduler configuration

### Communication Protocol

1. **Input:** Read Backend, Frontend, Scrapers, Architecture Design
2. **Process:** Configure Docker Compose, Dockerfiles, Nginx, Scheduler, Health checks
3. **Output:** Produce DevOps Configuration (docker-compose.yml, scripts, configs)
4. **Sequential:** Wait for both implementation agents to complete first
5. **Handoff:** Provide deployment to quality-assurance for testing
6. **Status:** Report "COMPLETED" to orchestrator when done