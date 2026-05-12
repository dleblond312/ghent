# dev-stop.ps1 — restore the scheduled task after a dev session
# Run via: npm run dev:stop

$taskName = 'Ghent'
$port = 9420

# Kill any leftover tsx/node on the port
$pids = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
foreach ($p in $pids) {
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    Write-Host "Killed PID $p on :$port"
}

Start-Sleep 1
Start-ScheduledTask -TaskName $taskName
Write-Host "Scheduled task '$taskName' restarted."
Start-Sleep 3
Get-Content "$env:LOCALAPPDATA\Ghent\task.log" -Tail 5
