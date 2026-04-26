# Remora Trading Tools - Scheduler (PowerShell)
# Runs automated daily/weekly data syncs via APScheduler.
# Usage: .\start-scheduler.ps1

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "  Remora Scheduler starting..." -ForegroundColor Cyan
Write-Host "  Schedule: daily sync 18:00 WIB (Mon-Fri), weekly sync Sat 10:00 WIB" -ForegroundColor Gray
Write-Host ""

Set-Location "$ScriptDir\backend"

if (-not (Test-Path "$ScriptDir\.env")) {
    Write-Host "  [FAIL] .env not found. Run start.ps1 first." -ForegroundColor Red
    exit 1
}

New-Item -ItemType Directory -Path "$ScriptDir\backend\logs" -Force | Out-Null

Write-Host "  Starting scheduler (Ctrl+C to stop)..." -ForegroundColor Cyan
python -m app.scheduler 2>&1 | Tee-Object -FilePath "$ScriptDir\backend\logs\scheduler.log"
