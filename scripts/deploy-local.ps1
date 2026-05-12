# deploy-local.ps1 — copy bundle to install dir, bounce the service
# Requires: icacls "C:\Program Files\Ghent" /grant "$env:USERNAME:(OI)(CI)F" /T
# (one-time setup, already done)

$installDir = "C:\Program Files\Ghent"
$bundleDir  = "$PSScriptRoot\..\build\bundle"
$scriptsDir = "$PSScriptRoot"

Write-Host "Copying files to $installDir ..."
Copy-Item "$bundleDir\server.cjs" "$installDir\server.cjs" -Force
Copy-Item "$scriptsDir\run-hidden-msi.vbs" "$installDir\scripts\run-hidden-msi.vbs" -Force
# Copy assets (icons etc.)
if (Test-Path "$bundleDir\assets") {
    Copy-Item "$bundleDir\assets" "$installDir\assets" -Recurse -Force
}
Write-Host "  server.cjs  -> $((Get-Item "$installDir\server.cjs").LastWriteTime)"

Write-Host "Bouncing service ..."
Get-NetTCPConnection -LocalPort 9420 -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique |
    ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue; Write-Host "  Killed PID $_" }
Start-Sleep 1
Start-ScheduledTask -TaskName Ghent
Start-Sleep 4

Write-Host "`nLast 5 log lines:"
$devLog     = "$PSScriptRoot\..\logs\task.log"
$installLog = "$env:LOCALAPPDATA\Ghent\task.log"
$logToRead  = if (Test-Path $installLog) { $installLog } elseif (Test-Path $devLog) { $devLog } else { $null }
if ($logToRead) { Get-Content $logToRead -Tail 5 } else { Write-Host "(no log yet)" }
