# Remora Trading Tools - Stop Script (PowerShell)
# Usage: .\stop.ps1

Write-Host ""
Write-Host "Stopping Remora Trading Tools..." -ForegroundColor Cyan

# Find and kill uvicorn processes
$uvicornProcesses = Get-Process -Name "python" -ErrorAction SilentlyContinue | 
    Where-Object { $_.CommandLine -like "*uvicorn*" -or $_.CommandLine -like "*app.main*" }

if ($uvicornProcesses) {
    $uvicornProcesses | Stop-Process -Force
    Write-Host "  [OK] uvicorn stopped" -ForegroundColor Green
} else {
    # Try by port
    $connections = Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue
    if ($connections) {
        $pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($pid in $pids) {
            Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
        }
        Write-Host "  [OK] Process on port 8000 stopped" -ForegroundColor Green
    } else {
        Write-Host "  [INFO] No uvicorn process found" -ForegroundColor Gray
    }
}

Write-Host ""
Write-Host "Remora Trading Tools stopped." -ForegroundColor Cyan