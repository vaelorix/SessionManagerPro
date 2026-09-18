$ErrorActionPreference = "Stop"

$rootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$makensis = Join-Path $rootDir "tools\nsis-bundle\nsis-bundle\windows\makensis.exe"
$nsiScript = Join-Path $rootDir "installer\SessionManagerPro.nsi"
$outputSetup = Join-Path $rootDir "dist-installer\SessionManagerPro-Setup.exe"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "   SessionManagerPro -- Full Standalone Installer Build   " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Check makensis
if (-not (Test-Path $makensis)) {
    Write-Error "NSIS compiler not found at: $makensis"
    exit 1
}

# 2. Build Frontend UI
Write-Host "`n[1/5] Building Frontend UI..." -ForegroundColor Yellow
Push-Location (Join-Path $rootDir "frontend")
npm run build
Pop-Location

# 3. Build C# Launcher Exe
Write-Host "`n[2/5] Compiling SessionManagerPro.exe..." -ForegroundColor Yellow
& (Join-Path $rootDir "scripts\build-exe.ps1")

# 4. Verify Bundled Runtimes (Zero User Prerequisites)
Write-Host "`n[3/5] Verifying Bundled Runtimes (Node.js and Python)..." -ForegroundColor Yellow
$nodeExe = Join-Path $rootDir "runtime\node\node.exe"
$pythonExe = Join-Path $rootDir "runtime\python\python.exe"

if (-not (Test-Path $nodeExe)) {
    Write-Error "Embedded Node.js executable missing at: $nodeExe"
    exit 1
}
if (-not (Test-Path $pythonExe)) {
    Write-Error "Embedded Python executable missing at: $pythonExe"
    exit 1
}
Write-Host "Runtimes verified: Node.js and Python standalone engines ready." -ForegroundColor Green

# 5. Compile NSIS Installer
Write-Host "`n[4/5] Compiling NSIS Setup Installer with Solid LZMA..." -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $rootDir "dist-installer"))) {
    New-Item -ItemType Directory -Path (Join-Path $rootDir "dist-installer") | Out-Null
}

& $makensis $nsiScript
if ($LASTEXITCODE -ne 0) {
    Write-Error "NSIS compilation failed with exit code $LASTEXITCODE"
    exit 1
}

# 6. Summary & Verification
if (Test-Path $outputSetup) {
    $setupItem = Get-Item $outputSetup
    $sizeMb = [math]::Round($setupItem.Length / 1MB, 2)
    $len = $setupItem.Length
    $hash = (Get-FileHash $outputSetup -Algorithm SHA256).Hash

    Write-Host "`n[5/5] BUILD SUCCESSFUL!" -ForegroundColor Green
    Write-Host "Installer:  $outputSetup" -ForegroundColor Cyan
    Write-Host "Size:       $sizeMb MB ($len bytes)" -ForegroundColor Cyan
    Write-Host "SHA256:     $hash" -ForegroundColor Cyan
} else {
    Write-Error "Failed to generate installer executable: $outputSetup"
    exit 1
}
