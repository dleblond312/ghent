# Called by the MSI's RegisterTask custom action after files are laid down.
# Runs as the installing user (Impersonate=yes), so the per-user scheduled
# task and Start Menu shortcut land in the right place.
#
# Usage (called by MSI):
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File install-task-msi.ps1 -InstallRoot "C:\Program Files\Ghent\"
[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$InstallRoot
)

$ErrorActionPreference = 'Continue'   # never fail the MSI on a soft error
$TaskName = 'Ghent'

try {
    # Strip both trailing backslash and trailing dot. The MSI passes
    # "[INSTALLFOLDER]." to dodge the `\"` quoting trap; we normalize here.
    $InstallRoot = $InstallRoot.TrimEnd('\').TrimEnd('.').TrimEnd('\')
    if (-not (Test-Path -LiteralPath $InstallRoot)) {
        throw "InstallRoot does not exist: $InstallRoot"
    }
    $vbsShim = Join-Path $InstallRoot 'scripts\run-hidden-msi.vbs'
    $registerAumid = Join-Path $InstallRoot 'scripts\register-aumid.ps1'

    # 1. Register AUMID-tagged Start Menu shortcut so toasts show as "Ghent"
    #    and the app appears in Settings -> Notifications.
    if (Test-Path $registerAumid) {
        & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $registerAumid -InstallRoot $InstallRoot
    }

    # 2. Register scheduled task running at logon, hidden via wscript shim.
    if (Test-Path $vbsShim) {
        $action = New-ScheduledTaskAction `
            -Execute 'wscript.exe' `
            -Argument "`"$vbsShim`"" `
            -WorkingDirectory $InstallRoot
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
        $settings = New-ScheduledTaskSettingsSet `
            -AllowStartIfOnBatteries `
            -DontStopIfGoingOnBatteries `
            -StartWhenAvailable `
            -RestartCount 5 `
            -RestartInterval (New-TimeSpan -Minutes 1) `
            -ExecutionTimeLimit (New-TimeSpan -Days 0)
        $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

        Register-ScheduledTask `
            -TaskName $TaskName `
            -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
            -Description 'Ghent - Windows toasts for new comments on PRs you authored.' `
            -Force | Out-Null

        # Start the task immediately so the server is running when the
        # config page opens. The server handles unconfigured state gracefully.
        Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    }

    # Give the server a moment to start, then open the config UI.
    Start-Sleep -Seconds 2
    Start-Process 'http://localhost:9420/'
} catch {
    # Swallow errors so the install still succeeds. Diagnostics land in the
    # Windows Application event log via Write-Error.
    Write-Error "install-task.ps1 failed: $($_.Exception.Message)"
}

# Append install event to local diagnostics log (best-effort — never fails the MSI).
try {
    $dataDir = Join-Path $env:LOCALAPPDATA 'Ghent'
    if (-not (Test-Path -LiteralPath $dataDir)) { [void](New-Item -ItemType Directory -Path $dataDir -Force) }
    $entry = [ordered]@{ ts = (Get-Date -Format 'o'); kind = 'install'; installRoot = $InstallRoot; user = $env:USERNAME }
    [System.IO.File]::AppendAllText(
        (Join-Path $dataDir 'events.jsonl'),
        ($entry | ConvertTo-Json -Compress) + "`n",
        [System.Text.Encoding]::UTF8
    )
} catch { <# best-effort — never fail the MSI #> }

exit 0
