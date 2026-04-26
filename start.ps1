# Remora Trading Tools - Dev Start Script (PowerShell)
# Usage: .\start.ps1                        -- starts backend only (local dev)
#        .\start-scheduler.ps1              -- starts scheduler (separate window)
#        docker-compose up -d               -- starts everything via Docker

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

Write-Host ""
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host "   Remora Trading Tools - Starting..." -ForegroundColor Cyan
Write-Host "==============================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check .env
if (-not (Test-Path ".env")) {
    Write-Host "  [WARN] No .env file found. Creating from .env.example..." -ForegroundColor Yellow
    Copy-Item ".env.example" ".env"
    Write-Host "  Please edit .env with your credentials before starting." -ForegroundColor Yellow
    exit 1
}

# Step 2: Check PostgreSQL
Write-Host "  Step 1: Checking PostgreSQL..." -ForegroundColor Cyan
try {
    $pgService = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pgService) {
        if ($pgService.Status -ne "Running") {
            Write-Host "  PostgreSQL service found but not running. Starting..." -ForegroundColor Yellow
            Start-Service $pgService.Name
            Write-Host "  [OK] PostgreSQL service started" -ForegroundColor Green
        } else {
            Write-Host "  [OK] PostgreSQL is running" -ForegroundColor Green
        }
    } else {
        # Try port check
        $tcpTest = Test-NetConnection -ComputerName localhost -Port 5432 -WarningAction SilentlyContinue
        if ($tcpTest.TcpTestSucceeded) {
            Write-Host "  [OK] PostgreSQL is listening on port 5432" -ForegroundColor Green
        } else {
            Write-Host "  [FAIL] PostgreSQL is NOT running on localhost:5432" -ForegroundColor Red
            Write-Host ""
            Write-Host "  SETUP INSTRUCTIONS:" -ForegroundColor Yellow
            Write-Host "  1. Install PostgreSQL 15+: https://www.postgresql.org/download/windows/" -ForegroundColor Yellow
            Write-Host "  2. Create the database:" -ForegroundColor Yellow
            Write-Host '     psql -U postgres -c "CREATE USER remora WITH PASSWORD ''remora_password'';"' -ForegroundColor Yellow
            Write-Host '     psql -U postgres -c "CREATE DATABASE remora OWNER remora;"' -ForegroundColor Yellow
            Write-Host "  3. Re-run this script." -ForegroundColor Yellow
            exit 1
        }
    }
} catch {
    Write-Host "  [WARN] Could not check PostgreSQL service: $_" -ForegroundColor Yellow
}

# Step 3: Check Python
Write-Host "  Step 2: Checking Python..." -ForegroundColor Cyan
try {
    $pyVersion = python --version 2>&1
    Write-Host "  [OK] Python: $pyVersion" -ForegroundColor Green
} catch {
    Write-Host "  [FAIL] Python not found. Install Python 3.11+" -ForegroundColor Red
    exit 1
}

# Step 4: Install dependencies
Write-Host "  Step 3: Installing Python dependencies..." -ForegroundColor Cyan
Set-Location "$ScriptDir\backend"
pip install -r requirements.txt -q 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Some dependencies may have failed to install" -ForegroundColor Yellow
}

# Step 5: Run database initialization
Write-Host "  Step 4: Initializing database..." -ForegroundColor Cyan
python -c "
import asyncio
from app.database import init_db
asyncio.run(init_db())
print('Database tables created/verified')
" 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] Database initialized" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Database init failed - tables may already exist" -ForegroundColor Yellow
}

# Step 5: Run Alembic migrations
Write-Host "  Step 5: Running Alembic migrations..." -ForegroundColor Cyan
alembic upgrade head 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Host "  [OK] Migrations applied" -ForegroundColor Green
} else {
    Write-Host "  [WARN] Migration may have issues (tables may already exist)" -ForegroundColor Yellow
}

# Step 6: Start uvicorn
Write-Host ""
Write-Host "  Starting Remora Backend on http://localhost:8000" -ForegroundColor Cyan
Write-Host "  API Docs: http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host ""

New-Item -ItemType Directory -Path "$ScriptDir\backend\logs" -Force | Out-Null

Set-Location "$ScriptDir\backend"
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload 2>&1 | Tee-Object -FilePath "$ScriptDir\backend\logs\backend.log"