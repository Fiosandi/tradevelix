#!/usr/bin/env bash
# Remora Trading Tools - Dev Start Script (Bash/WSL)
# Usage: ./start.sh                  -- starts backend (local dev, no Docker)
#        ./start-scheduler.sh        -- starts APScheduler (separate terminal)
#        docker-compose up -d        -- starts everything via Docker

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "🦈==========================================🦈"
echo "   Remora Trading Tools - Starting..."
echo "🦈==========================================🦈"
echo ""

# Step 1: Check .env
if [ ! -f ".env" ]; then
    echo "⚠️  No .env file found. Creating from .env.example..."
    cp .env.example .env
    echo "📝 Please edit .env with your credentials before starting."
    exit 1
fi

# Step 2: Check PostgreSQL
echo "📋 Step 1: Checking PostgreSQL..."
if command -v pg_isready &> /dev/null; then
    if pg_isready -h localhost -p 5432 &> /dev/null; then
        echo "   ✅ PostgreSQL is running"
    else
        echo "   ❌ PostgreSQL is not running on localhost:5432"
        echo "   Start it with: sudo systemctl start postgresql"
        echo "   Or on Windows: net start postgresql-x64-15"
        exit 1
    fi
else
    echo "   ⚠️  pg_isready not found. Ensure PostgreSQL is running manually."
fi

# Step 3: Check Python
echo "📋 Step 2: Checking Python..."
if ! command -v python &> /dev/null; then
    echo "   ❌ Python not found. Install Python 3.11+"
    exit 1
fi
echo "   ✅ Python: $(python --version)"

# Step 4: Install dependencies
echo "📋 Step 3: Installing Python dependencies..."
cd backend
if [ -f "requirements.txt" ]; then
    pip install -r requirements.txt -q
    echo "   ✅ Dependencies installed"
else
    echo "   ❌ requirements.txt not found"
    exit 1
fi

# Step 5: Run database migrations
echo "📋 Step 4: Running database migrations..."
if [ -d "alembic" ]; then
    alembic upgrade head
    echo "   ✅ Migrations applied"
else
    echo "   ⚠️  No alembic directory found, skipping migrations"
fi

# Step 6: Start uvicorn
echo ""
echo "🦈 Starting Remora Backend on http://localhost:8000"
echo "   API Docs: http://localhost:8000/docs"
echo ""

# Create logs directory
mkdir -p logs

uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload 2>&1 | tee logs/backend.log