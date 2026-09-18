param(
    [string]$Tag = "v1.0.0",
    [string]$Token = $env:GITHUB_TOKEN
)

$ErrorActionPreference = "Stop"

$rootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$installerPath = Join-Path $rootDir "dist-installer\SessionManagerPro-Setup.exe"

if (-not (Test-Path $installerPath)) {
    Write-Error "Installer executable not found at: $installerPath. Run 'npm run build:installer' first."
    exit 1
}

$fileItem = Get-Item $installerPath
$sizeMb = [math]::Round($fileItem.Length / 1MB, 2)
$sha256 = (Get-FileHash $installerPath -Algorithm SHA256).Hash

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   Publishing SessionManagerPro Installer to GitHub       " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Tag:       $Tag"
Write-Host "File:      $installerPath"
Write-Host "Size:      $sizeMb MB ($($fileItem.Length) bytes)"
Write-Host "SHA256:    $sha256"

$repo = "vaelorix/SessionManagerPro"
$headers = @{
    "Authorization" = "token $Token"
    "Accept"        = "application/vnd.github.v3+json"
    "User-Agent"    = "SessionManagerPro-Release-Bot"
}

# 1. Check if release already exists
Write-Host "`n[1/3] Checking for existing release '$Tag'..." -ForegroundColor Yellow
$release = $null
try {
    $existing = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/tags/$Tag" -Headers $headers -Method Get -ErrorAction SilentlyContinue
    if ($existing -and $existing.id) {
        $release = $existing
        Write-Host "Found existing release ID: $($release.id)" -ForegroundColor Green
    }
} catch {}

# 2. Create release if not present
if (-not $release) {
    Write-Host "[2/3] Creating new release '$Tag' on GitHub..." -ForegroundColor Yellow
    $bodyText = @(
        "## SessionManagerPro $Tag -- Standalone Native Release",
        "",
        "A high-performance session orchestrator and multi-profile browser manager with zero user prerequisites.",
        "",
        "### Key Features:",
        "- **Zero Runtime Prerequisites**: Bundled with dedicated portable Node.js and standalone Python 3.11 with Zendriver stealth CDP engine.",
        "- **Custom Browser Selector**: Automatically detects installed Chrome, Edge, or Chromium browsers with manual executable browsing.",
        "- **Stealth and Isolation**: Isolated user-data directories, sticky residential proxies with local auth bridge, and WebRTC leak prevention.",
        "- **Desktop and Start Menu Shortcuts**: Seamless integration with Windows desktop and application menus.",
        "- **Author and Source**: Maintained by [vaelorix](https://github.com/vaelorix).",
        "",
        "### File Integrity:",
        "- **File**: ``SessionManagerPro-Setup.exe``",
        "- **Size**: $sizeMb MB ($($fileItem.Length) bytes)",
        "- **SHA256**: ``$sha256``"
    ) -join "`n"

    $releasePayload = @{
        tag_name         = $Tag
        target_commitish = "main"
        name             = "SessionManagerPro $Tag - Native Windows Installer"
        body             = $bodyText
        draft            = $false
        prerelease       = $false
    } | ConvertTo-Json

    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases" -Headers $headers -Method Post -Body $releasePayload
    Write-Host "Release created successfully (ID: $($release.id))" -ForegroundColor Green
}

$releaseId = $release.id

# 3. Check if asset already exists in release
Write-Host "`n[3/3] Uploading SessionManagerPro-Setup.exe asset..." -ForegroundColor Yellow
$existingAsset = $release.assets | Where-Object { $_.name -eq "SessionManagerPro-Setup.exe" }
if ($existingAsset) {
    Write-Host "Deleting existing asset ID $($existingAsset.id) before re-uploading..." -ForegroundColor Yellow
    Invoke-RestMethod -Uri "https://api.github.com/repos/$repo/releases/assets/$($existingAsset.id)" -Headers $headers -Method Delete | Out-Null
}

$uploadUrl = "https://uploads.github.com/repos/$repo/releases/$releaseId/assets?name=SessionManagerPro-Setup.exe"

# Upload binary asset with curl to handle large files reliably
& curl.exe -X POST -H "Authorization: token $Token" -H "Content-Type: application/octet-stream" --data-binary "@$installerPath" "$uploadUrl" -s -o "release_upload_response.json"

if (Test-Path "release_upload_response.json") {
    $resp = Get-Content "release_upload_response.json" -Raw | ConvertFrom-Json
    Remove-Item "release_upload_response.json" -Force -ErrorAction SilentlyContinue

    if ($resp.browser_download_url) {
        Write-Host "`n==========================================================" -ForegroundColor Green
        Write-Host "   RELEASE ASSET UPLOADED SUCCESSFULLY!                   " -ForegroundColor Green
        Write-Host "==========================================================" -ForegroundColor Green
        Write-Host "Release URL:       $($release.html_url)" -ForegroundColor Cyan
        Write-Host "Direct Download:   $($resp.browser_download_url)" -ForegroundColor Cyan
        Write-Host "Asset Size:        $([math]::Round($resp.size / 1MB, 2)) MB ($($resp.size) bytes)" -ForegroundColor Cyan
    } else {
        Write-Error "Upload completed but download URL was not found in response. Response: $($resp | Out-String)"
        exit 1
    }
} else {
    Write-Error "Upload response file was not generated."
    exit 1
}
