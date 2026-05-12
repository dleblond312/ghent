# Called by the MSI's UnregisterTask custom action before files are removed.
# Idempotent — safe to re-run.
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$TaskName = 'Ghent'

try {
    # Append uninstall event to local diagnostics log first (best-effort).
    try {
        $dataDir = Join-Path $env:LOCALAPPDATA 'Ghent'
        if (Test-Path -LiteralPath $dataDir) {
            $entry = [ordered]@{ ts = (Get-Date -Format 'o'); kind = 'uninstall'; user = $env:USERNAME }
            [System.IO.File]::AppendAllText(
                (Join-Path $dataDir 'events.jsonl'),
                ($entry | ConvertTo-Json -Compress) + "`n",
                [System.Text.Encoding]::UTF8
            )
        }
    } catch { <# best-effort — never fail the uninstall #> }

    # 1. Stop and remove the scheduled task.
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

    # 2. Remove the AUMID Start Menu shortcut.
    $shortcut = Join-Path ([Environment]::GetFolderPath('Programs')) 'Ghent.lnk'
    if (Test-Path $shortcut) {
        Remove-Item $shortcut -Force -ErrorAction SilentlyContinue
    }

    # 3. Remove the AUMID registry key (best-effort; harmless if it persists).
    $aumidKey = 'HKCU:\Software\Classes\AppUserModelId\Snore.DesktopToasts.0.7.0'
    if (Test-Path $aumidKey) {
        Remove-Item $aumidKey -Recurse -Force -ErrorAction SilentlyContinue
    }

    # 4. Leave %LOCALAPPDATA%\Ghent\ alone — it has the user's config
    #    and event log. They can delete it manually if they want a clean slate.
} catch {
    Write-Error "uninstall-task-msi.ps1 failed: $($_.Exception.Message)"
}
exit 0
