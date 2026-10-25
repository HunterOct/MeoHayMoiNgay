# Cloudflare Free staging auth setup (local only)
# Run: powershell -ExecutionPolicy Bypass -File .\scripts\set-cloudflare-auth.ps1
# The token is read with Read-Host -AsSecureString and is never printed.

$ErrorActionPreference = "Stop"

Write-Host "Cloudflare Free - M0.5 staging auth" -ForegroundColor Cyan
Write-Host "Use a scoped token: Workers Scripts:Edit + D1:Edit; no R2/Zone/Billing."
Write-Host ""

$secure = Read-Host -AsSecureString "Paste Cloudflare API token (hidden)"
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

$token = $token.Trim()
if (-not $token) {
  Write-Error "Token is empty. Nothing written."
  exit 1
}
Write-Host "Token length: $($token.Length) (Cloudflare API tokens are usually 40 characters)."

$account = Read-Host "Cloudflare Account ID (optional, press Enter to skip)"
$root = Split-Path -Parent $PSScriptRoot
$path = Join-Path $root ".env.wrangler"

$lines = @("CLOUDFLARE_API_TOKEN=$token")
if ($account -and $account.Trim()) {
  $lines += "CLOUDFLARE_ACCOUNT_ID=$($account.Trim())"
}

Set-Content -Path $path -Value $lines -Encoding ascii

try {
  $user = $env:USERNAME
  if ($env:USERDOMAIN) { $user = "$env:USERDOMAIN\$env:USERNAME" }
  icacls $path /inheritance:r /grant:r "${user}:(R,W)" | Out-Null
} catch {
  Write-Warning "Could not restrict file ACL automatically. Check permissions on .env.wrangler."
}

$token = $null
[GC]::Collect()

Write-Host ""
Write-Host "Saved to $path" -ForegroundColor Green
Write-Host "The token was not printed. Do not commit this file."
Write-Host "Verifying token with Cloudflare (no token will be printed)..."
Push-Location $root
try {
  npx wrangler whoami --env-file .env.wrangler
} catch {
  Write-Warning "Verification command failed. Check the token type/scopes/expiry."
} finally {
  Pop-Location
}
Write-Host ""
Write-Host "If the account is shown and it is the Free plan, tell the assistant: da nhap"
Write-Host "Do not paste the token into chat."
