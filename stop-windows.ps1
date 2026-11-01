<#
Stops Data Handyman's backend and frontend started by run-windows.ps1 (or
run-windows.bat): finds whatever is listening on their ports and closes
it, including the PowerShell window it's running in.

Run it from a PowerShell window opened in this folder:

    powershell -ExecutionPolicy Bypass -File .\stop-windows.ps1

or just double-click stop-windows.bat.
#>

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "    $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "    $msg" }

function Stop-ServiceOnPort([int]$port, [string]$label) {
    Write-Step "Stopping the $label (port $port)"
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $conn) {
        Write-Ok 'Not running'
        return
    }
    $processId = $conn.OwningProcess
    # taskkill /T kills the whole process tree, not just the one PID --
    # the PowerShell window run-windows.ps1 opened is the parent of
    # uvicorn/npm, so this also closes that window instead of leaving it
    # open and empty.
    & taskkill /PID $processId /T /F | Out-Null
    Write-Ok "Stopped (was PID $processId)"
}

try {
    Stop-ServiceOnPort 8000 'backend'
    Stop-ServiceOnPort 5173 'frontend'
    Write-Host "`nDone." -ForegroundColor Green
}
catch {
    Write-Host "`n$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
