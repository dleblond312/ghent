# Ghent - first-run configuration wizard
# Displays a WinForms dialog to collect username + personal access token, then
# writes config.json to %LOCALAPPDATA%\Ghent\.
#
# Usage:
#   setup-config.ps1                   # show dialog, then restart task if running
#   setup-config.ps1 -InstallRoot "C:\Program Files\Ghent\."   # from MSI CA
[CmdletBinding()]
param(
    [string]$InstallRoot = ''
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$cfgDir  = Join-Path $env:LOCALAPPDATA 'Ghent'
$cfgPath = Join-Path $cfgDir 'config.json'

# ── Load any existing config so we can pre-fill the form ────────────────────

$existing = @{}
if (Test-Path $cfgPath) {
    try {
        $raw = [System.IO.File]::ReadAllText($cfgPath)
        if ($raw[0] -eq [char]0xFEFF) { $raw = $raw.Substring(1) }   # strip BOM
        $existing = $raw | ConvertFrom-Json -AsHashtable
    } catch {
        # Ignore parse errors; start fresh
    }
}

# ── Build the form ───────────────────────────────────────────────────────────

$form = [System.Windows.Forms.Form]::new()
$form.Text            = 'Ghent — Setup'
$form.ClientSize      = [System.Drawing.Size]::new(480, 310)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox     = $false
$form.StartPosition   = 'CenterScreen'
$form.Font            = [System.Drawing.Font]::new('Segoe UI', 9)

function Add-Label($text, $x, $y) {
    $lbl = [System.Windows.Forms.Label]::new()
    $lbl.Text = $text; $lbl.Location = [System.Drawing.Point]::new($x, $y)
    $lbl.AutoSize = $true
    $form.Controls.Add($lbl)
}
function Add-TextBox($x, $y, $w, $value, [switch]$Password) {
    $tb = [System.Windows.Forms.TextBox]::new()
    $tb.Location = [System.Drawing.Point]::new($x, $y)
    $tb.Width    = $w
    $tb.Text     = $value
    if ($Password) { $tb.PasswordChar = '*' }
    $form.Controls.Add($tb)
    return $tb
}

# GitHub Enterprise hostname  (derive from existing apiBase or default)
$defaultHost = if ($existing.apiBase) {
    ([uri]$existing.apiBase).Host
} else { 'your-company.ghe.com' }

Add-Label 'GitHub Enterprise hostname:' 20 20
$tbHost = Add-TextBox 20 42 430 $defaultHost

Add-Label 'Your GitHub username:' 20 85
$tbUser = Add-TextBox 20 107 200 ($existing.username ?? '')

Add-Label 'Personal access token  (repo + notifications scopes):' 20 150
$tbToken = Add-TextBox 20 172 430 ($existing.token ?? '') -Password

Add-Label 'Poll interval (seconds, minimum 30):' 20 215
$tbInterval = Add-TextBox 20 237 80 ($existing.pollIntervalSec ?? '60')

# Help link
$lnk = [System.Windows.Forms.LinkLabel]::new()
$lnk.Text     = 'How to create a token'
$lnk.Location = [System.Drawing.Point]::new(120, 240)
$lnk.AutoSize = $true
$lnk.add_LinkClicked({
    Start-Process "https://$($tbHost.Text)/settings/tokens/new?scopes=repo,notifications"
})
$form.Controls.Add($lnk)

# OK / Cancel
$btnOK = [System.Windows.Forms.Button]::new()
$btnOK.Text     = 'Save'
$btnOK.Location = [System.Drawing.Point]::new(280, 270)
$btnOK.Width    = 80
$btnOK.DialogResult = 'OK'
$form.AcceptButton = $btnOK
$form.Controls.Add($btnOK)

$btnCancel = [System.Windows.Forms.Button]::new()
$btnCancel.Text     = 'Cancel'
$btnCancel.Location = [System.Drawing.Point]::new(370, 270)
$btnCancel.Width    = 90
$btnCancel.DialogResult = 'Cancel'
$form.CancelButton = $btnCancel
$form.Controls.Add($btnCancel)

# ── Validate on OK ──────────────────────────────────────────────────────────

$btnOK.add_Click({
    $errors = @()
    if ([string]::IsNullOrWhiteSpace($tbHost.Text))     { $errors += 'Hostname is required.' }
    if ([string]::IsNullOrWhiteSpace($tbUser.Text))     { $errors += 'Username is required.' }
    if ([string]::IsNullOrWhiteSpace($tbToken.Text))    { $errors += 'Personal access token is required.' }
    $interval = 60
    if (-not [int]::TryParse($tbInterval.Text, [ref]$interval) -or $interval -lt 30) {
        $errors += 'Poll interval must be a number >= 30.'
    }
    if ($errors.Count -gt 0) {
        [System.Windows.Forms.MessageBox]::Show(
            ($errors -join "`n"), 'Validation error',
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Warning
        )
        $form.DialogResult = 'None'   # keep form open
    }
})

$result = $form.ShowDialog()
if ($result -ne 'OK') { exit 0 }    # user cancelled — leave existing config alone

# ── Write config.json ────────────────────────────────────────────────────────

$interval = [int]$tbInterval.Text
$apiBase  = "https://$($tbHost.Text.Trim().TrimEnd('/'))/api/v3"

$cfg = [ordered]@{
    username        = $tbUser.Text.Trim()
    token           = $tbToken.Text.Trim()
    apiBase         = $apiBase
    mode            = 'poll'
    pollIntervalSec = $interval
    port            = ($existing.port ?? 51847)
    webhookSecret   = ($existing.webhookSecret ?? '')
    registerRepos   = ($existing.registerRepos ?? '')
}

New-Item -ItemType Directory -Force $cfgDir | Out-Null
[System.IO.File]::WriteAllText(
    $cfgPath,
    ($cfg | ConvertTo-Json),
    [System.Text.UTF8Encoding]::new($false)   # UTF-8, no BOM
)

[System.Windows.Forms.MessageBox]::Show(
    "Configuration saved to:`n$cfgPath`n`nGhent will start polling on next login (or you can start it now from Task Scheduler).",
    'Saved',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
)

# ── Restart the scheduled task if it's already registered ───────────────────
$task = Get-ScheduledTask -TaskName 'Ghent' -ErrorAction SilentlyContinue
if ($task) {
    if ($task.State -eq 'Running') {
        Stop-ScheduledTask -TaskName 'Ghent' -ErrorAction SilentlyContinue
    }
    Start-ScheduledTask -TaskName 'Ghent' -ErrorAction SilentlyContinue
}

exit 0
