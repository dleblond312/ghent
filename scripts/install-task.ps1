# Sets up Windows scheduled task to run the listener at logon.
# Run as your user, NOT elevated.
#
# Usage:
#   pwsh ./scripts/install-task.ps1
#   pwsh ./scripts/install-task.ps1 -Remove

[CmdletBinding()]
param(
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$TaskName = 'Ghent'
$ProjectRoot = Split-Path -Parent $PSScriptRoot

$LogFile = Join-Path $ProjectRoot 'logs/task.log'
$VbsShim = Join-Path $ProjectRoot 'scripts/run-hidden.vbs'

if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed scheduled task '$TaskName'"
    exit 0
}

if (-not (Test-Path (Join-Path $ProjectRoot 'src/server.ts'))) { throw "src/server.ts not found in $ProjectRoot" }
if (-not (Test-Path $VbsShim)) { throw "VBS launcher not found at $VbsShim" }

# Use wscript.exe + a VBS shim so no console window flashes on launch.
# powershell.exe -WindowStyle Hidden does NOT suppress child cmd.exe windows.
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$VbsShim`"" -WorkingDirectory $ProjectRoot
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -RestartCount 5 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -ExecutionTimeLimit (New-TimeSpan -Days 0)
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName `
    -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
    -Description 'Ghent - Windows toasts for new comments on PRs you authored.' `
    -Force | Out-Null

Write-Host "Installed scheduled task '$TaskName'."
Write-Host "Start now:  Start-ScheduledTask -TaskName $TaskName"
Write-Host "Logs at:    $LogFile"
