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

Write-Host "Compiling native Windows launcher: $outputExe"
& $csc /target:winexe /optimize+ /platform:anycpu /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.dll "/out:$outputExe" "$sourceFile"

if (Test-Path $outputExe) {
    $size = (Get-Item $outputExe).Length
    Write-Host "SUCCESS: SessionManagerPro.exe built ($size bytes)" -ForegroundColor Green
} else {
    Write-Error "Compilation failed."
    exit 1
}
