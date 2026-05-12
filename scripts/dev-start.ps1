# dev-start.ps1 — stop the prod scheduled task and hand port 9420 to tsx --watch
# Run via: npm run dev
# Stop via: Ctrl+C (tsx exits), then npm run dev:stop to restart the task

$taskName = 'Ghent'
$port = 9420

Write-Host "Stopping scheduled task '$taskName'..."
Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

# Kill anything still holding port 9420
$pids = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
foreach ($p in $pids) {
    Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
    Write-Host "  Killed PID $p on :$port"
}

Write-Host ""
Write-Host "Dev mode: tsx --watch src/server.ts"
Write-Host "  -> Save any .ts file to hot-reload"
Write-Host "  -> Ctrl+C to stop; run 'npm run dev:stop' to restore the task"
Write-Host ""

npx tsx --watch src/server.ts
