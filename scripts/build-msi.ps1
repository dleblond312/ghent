# Builds dist/Ghent-<version>.msi from scratch.
#
# Steps:
#   1. Verify WiX toolchain (auto-install via dotnet tool if missing).
#   2. Run npm bundle (esbuild + node-notifier prod tree).
#   3. Download portable Node runtime (cached under build/cache/).
#   4. Stage everything into build/stage/ matching the MSI layout.
#   5. wix build -> dist/Ghent-<version>.msi  (auto-harvests stage tree)
#
# Idempotent. Run with -Clean to nuke build/ first.
# Pass -SignPfx to sign the MSI with a certificate.
[CmdletBinding()]
param(
    [string]$Version = '',
    [string]$NodeVersion = '22.11.0',  # current LTS
    [string]$SignPfx = '',
    [string]$SignPassword = '',
    [switch]$Clean
)

$ErrorActionPreference = 'Stop'
$ProjectRoot  = Split-Path -Parent $PSScriptRoot
$BuildDir     = Join-Path $ProjectRoot 'build'
$CacheDir     = Join-Path $BuildDir   'cache'
$StageDir     = Join-Path $BuildDir   'stage'
$BundleDir    = Join-Path $BuildDir   'bundle'
$InstallerDir = Join-Path $ProjectRoot 'installer'
$DistDir      = Join-Path $ProjectRoot 'dist'

if (-not $Version) {
    $pkgJson = Join-Path $ProjectRoot 'package.json'
    if (-not (Test-Path $pkgJson)) { throw "package.json not found at $pkgJson" }
    $Version = (Get-Content $pkgJson -Raw | ConvertFrom-Json).version
    if (-not $Version) { throw 'Could not determine version from package.json' }
}

function Step($msg) { Write-Host "==> $msg" -ForegroundColor Cyan }

if ($Clean -and (Test-Path $BuildDir)) {
    Step 'Cleaning build/'
    Remove-Item $BuildDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $BuildDir, $CacheDir, $DistDir | Out-Null

# ---------------------------------------------------------------------------
# 1. WiX toolchain
# ---------------------------------------------------------------------------
Step 'Checking WiX toolchain'
$wix = Get-Command wix -ErrorAction SilentlyContinue
if (-not $wix) {
    Write-Host '   wix CLI not found - installing as dotnet global tool...'
    & dotnet tool install --global wix
    if ($LASTEXITCODE -ne 0) { throw 'Failed to install WiX. Run: dotnet tool install --global wix' }
    $toolsBin = Join-Path $env:USERPROFILE '.dotnet\tools'
    if (Test-Path (Join-Path $toolsBin 'wix.exe')) {
        $env:PATH = "$toolsBin;$env:PATH"
    }
    $wix = Get-Command wix -ErrorAction Stop
}
Write-Host "   wix version: $((& wix --version) 2>&1)"

# ---------------------------------------------------------------------------
# 2. Bundle (esbuild + production node_modules)
# ---------------------------------------------------------------------------
Step 'Building bundle'
Push-Location $ProjectRoot
try {
    & npm run bundle
    if ($LASTEXITCODE -ne 0) { throw 'npm run bundle failed' }
} finally { Pop-Location }

# ---------------------------------------------------------------------------
# 3. Portable Node runtime (cached)
# ---------------------------------------------------------------------------
Step "Fetching portable Node $NodeVersion"
$nodeZipName = "node-v$NodeVersion-win-x64"
$nodeZip     = Join-Path $CacheDir "$nodeZipName.zip"
$nodeDir     = Join-Path $CacheDir $nodeZipName
$nodeExeSrc  = Join-Path $nodeDir 'node.exe'

if (-not (Test-Path $nodeExeSrc)) {
    if (-not (Test-Path $nodeZip)) {
        $url = "https://nodejs.org/dist/v$NodeVersion/$nodeZipName.zip"
        Write-Host "   downloading $url"
        Invoke-WebRequest -Uri $url -OutFile $nodeZip -UseBasicParsing
    }
    Write-Host "   extracting"
    Expand-Archive -Path $nodeZip -DestinationPath $CacheDir -Force
}
if (-not (Test-Path $nodeExeSrc)) { throw "node.exe not found at $nodeExeSrc after extract" }

# ---------------------------------------------------------------------------
# 4. Stage everything for the MSI
# ---------------------------------------------------------------------------
Step 'Staging install tree'
if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

# Files at root: node.exe, server.cjs
Copy-Item $nodeExeSrc                          (Join-Path $StageDir 'node.exe')
Copy-Item (Join-Path $BundleDir 'server.cjs')  (Join-Path $StageDir 'server.cjs')

# node_modules tree (just node-notifier + transitive deps)
Copy-Item (Join-Path $BundleDir 'node_modules') $StageDir -Recurse

# Snoretoast (referenced explicitly by config)
$stageSnoreDir = Join-Path $StageDir 'snoretoast'
New-Item -ItemType Directory -Force -Path $stageSnoreDir | Out-Null
Copy-Item (Join-Path $BundleDir 'snoretoast\snoretoast-x64.exe') $stageSnoreDir

# Helper scripts
$stageScriptsDir = Join-Path $StageDir 'scripts'
New-Item -ItemType Directory -Force -Path $stageScriptsDir | Out-Null
Copy-Item (Join-Path $ProjectRoot 'scripts\install-task-msi.ps1')   $stageScriptsDir
Copy-Item (Join-Path $ProjectRoot 'scripts\uninstall-task-msi.ps1') $stageScriptsDir
Copy-Item (Join-Path $ProjectRoot 'scripts\register-aumid.ps1')     $stageScriptsDir
Copy-Item (Join-Path $ProjectRoot 'scripts\run-hidden-msi.vbs')     $stageScriptsDir
Copy-Item (Join-Path $ProjectRoot 'scripts\open-ui.vbs')            $stageScriptsDir
Copy-Item (Join-Path $ProjectRoot 'scripts\setup-config.ps1')        $stageScriptsDir

$stageSize = (Get-ChildItem $StageDir -Recurse | Measure-Object -Property Length -Sum).Sum
Write-Host ("   stage size: {0:N1} MB" -f ($stageSize / 1MB))

# ---------------------------------------------------------------------------
# 5. wix build (auto-harvest via <Files Include="$(var.StageDir)\**" />)
# ---------------------------------------------------------------------------
Step 'Building MSI'
$msiOut = Join-Path $DistDir "Ghent-$Version.msi"

# WiX requires a 4-part numeric version in MSI Version field. Pad if needed.
$msiVersion = $Version
if ($msiVersion -notmatch '^\d+\.\d+\.\d+\.\d+$') {
    $parts = @($msiVersion -split '\.')
    while ($parts.Count -lt 4) { $parts += '0' }
    $msiVersion = ($parts[0..3]) -join '.'
}

$iconFile = Join-Path $PSScriptRoot '..\src\assets\icon.ico'

& wix build `
    (Join-Path $InstallerDir 'Product.wxs') `
    -arch x64 `
    -d "ProductVersion=$msiVersion" `
    -d "StageDir=$StageDir" `
    -d "IconFile=$iconFile" `
    -out $msiOut
if ($LASTEXITCODE -ne 0) { throw 'wix build failed' }

# ---------------------------------------------------------------------------
# 6. Sign MSI (optional)
# ---------------------------------------------------------------------------
if ($SignPfx -and (Test-Path $SignPfx)) {
    Step 'Signing MSI'
    $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    if (-not $signtool) {
        Write-Warning 'signtool.exe not found - skipping signing. Install Windows SDK.'
    } else {
        $signArgs = @('sign', '/fd', 'SHA256', '/f', $SignPfx, '/t', 'http://timestamp.digicert.com')
        if ($SignPassword) { $signArgs += '/p'; $signArgs += $SignPassword }
        $signArgs += $msiOut
        & $signtool.FullName @signArgs
        if ($LASTEXITCODE -ne 0) { throw 'signtool failed' }
        Write-Host "   Signed: $msiOut"
    }
} elseif ($SignPfx) {
    Write-Warning "PFX not found at $SignPfx - skipping signing."
}

$msiSize = (Get-Item $msiOut).Length
Write-Host ''
$sizeMB = '{0:N1}' -f ($msiSize / 1MB)
Step "Built: $msiOut - $sizeMB MB"
