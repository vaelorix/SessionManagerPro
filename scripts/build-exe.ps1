$ErrorActionPreference = "Stop"

$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
    $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}

if (-not (Test-Path $csc)) {
    Write-Error "Microsoft .NET Framework C# compiler (csc.exe) not found."
    exit 1
}

$rootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
$sourceFile = Join-Path $rootDir "launcher\SessionManagerPro.cs"
$outputExe = Join-Path $rootDir "SessionManagerPro.exe"

# If SessionManagerPro is running, check if existing executable can be kept
$running = Get-Process -Name "SessionManagerPro" -ErrorAction SilentlyContinue
if ($running) {
    if (Test-Path $outputExe) {
        $size = (Get-Item $outputExe).Length
        Write-Host "NOTE: SessionManagerPro.exe is currently running. Existing executable is valid ($size bytes)." -ForegroundColor Yellow
        Write-Host "SUCCESS: Kept active SessionManagerPro.exe ($size bytes). Close app to recompile." -ForegroundColor Green
        exit 0
    } else {
        Write-Error "SessionManagerPro.exe is currently running and output file cannot be written. Please close SessionManagerPro first."
        exit 1
    }
}

Write-Host "Compiling native Windows launcher: $outputExe"
& $csc /target:winexe /optimize+ /platform:anycpu /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.dll "/out:$outputExe" "$sourceFile"

if ($LASTEXITCODE -eq 0 -and (Test-Path $outputExe)) {
    $size = (Get-Item $outputExe).Length
    Write-Host "SUCCESS: SessionManagerPro.exe built ($size bytes)" -ForegroundColor Green
} else {
    Write-Error "Compilation failed with exit code $LASTEXITCODE. If SessionManagerPro is running, please close it first."
    exit 1
}
