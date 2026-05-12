# Generates a self-signed code signing certificate for Ghent.
#
# Output: certs/ghent-signing.pfx (password-protected)
#
# After generating, trust it on your machine:
#   Import-Certificate -FilePath certs\ghent-signing.cer -CertStoreLocation Cert:\CurrentUser\Root
#
# The .pfx is used by build-msi.ps1 to sign the MSI.
[CmdletBinding()]
param(
    [string]$Password = 'ghent-dev',
    [string]$Subject  = 'CN=Ghent Dev, O=dleblond312'
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$CertDir     = Join-Path $ProjectRoot 'certs'

New-Item -ItemType Directory -Force -Path $CertDir | Out-Null

$pfxPath = Join-Path $CertDir 'ghent-signing.pfx'
$cerPath = Join-Path $CertDir 'ghent-signing.cer'

if (Test-Path $pfxPath) {
    Write-Host "Certificate already exists at $pfxPath"
    Write-Host "Delete it first if you want to regenerate."
    exit 0
}

Write-Host "Creating self-signed code signing certificate..."
Write-Host "  Subject: $Subject"

$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject $Subject `
    -FriendlyName 'Ghent Code Signing (Dev)' `
    -CertStoreLocation Cert:\CurrentUser\My `
    -NotAfter (Get-Date).AddYears(5) `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -HashAlgorithm SHA256

$securePassword = ConvertTo-SecureString -String $Password -Force -AsPlainText

# Export .pfx (private key) for signing
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePassword | Out-Null

# Export .cer (public key) for trusting
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

# Clean up from personal store
Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "Created:"
Write-Host "  $pfxPath  (private key, password: '$Password')"
Write-Host "  $cerPath  (public key)"
Write-Host ""
Write-Host "To trust this cert on your machine (run once, elevated):"
Write-Host "  Import-Certificate -FilePath certs\ghent-signing.cer -CertStoreLocation Cert:\CurrentUser\Root"
