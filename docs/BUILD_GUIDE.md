# 🔨 Compilation & Build Pipeline Guide

SessionManagerPro utilizes a hybrid architecture featuring an optimized **React 19 Vite Web Application** bundled into a **Native C# Windows WPF Executable** via Microsoft Edge WebView2 Evergreen.

---

## ⚡ Quick Build Reference

| Target | Command | Output Artifact | Description |
| :--- | :--- | :--- | :--- |
| **All-in-One Full Build** | `npm run build` | `frontend/dist/` & `SessionManagerPro.exe` | Complete production pipeline build |
| **Frontend UI Only** | `npm run build:ui` | `frontend/dist/` (static web bundle) | Compiles TypeScript and runs `vite build` |
| **Native Executable Only** | `npm run build:exe` | `SessionManagerPro.exe` (16 KB binary) | Invokes PowerShell compiler script |

---

## 🖥️ 1. Building the Frontend Web Bundle

The frontend application is constructed with **React 19**, **TypeScript 5**, **Lucide Icons**, and **Vite 6**.

```powershell
npm run build:ui
```

### Compiler Lifecycle:
1. **Type Verification**: Executes `tsc -b` to enforce compile-time type safety across all React components, WebSocket hooks, and state reducers.
2. **Minification & Asset Optimization**: Executes `vite build` with Rollup treeshaking, producing minified ES modules and bundled CSS in `frontend/dist/`.
3. **Static Serving**: In production, the Express server automatically routes static assets directly from `frontend/dist/`.

---

## 📦 2. Compiling the Native Desktop Binary (`SessionManagerPro.exe`)

The desktop launcher is written in lightweight C# (`launcher/SessionManagerPro.cs`) and compiles directly using Microsoft's native .NET C# compiler (`csc.exe`) without requiring heavy IDEs like Visual Studio.

```powershell
npm run build:exe
```

### Compilation Internals (`scripts/build-exe.ps1`):
The build automation script executes the following sequence:
1. **Compiler Discovery**: Locates the 64-bit .NET Framework compiler:
   ```powershell
   $csc = "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
   ```
2. **Assembly References**: Links standard Windows Presentation Foundation (WPF) assemblies and the WebView2 WPF wrapper:
   - `PresentationCore.dll`
   - `PresentationFramework.dll`
   - `WindowsBase.dll`
   - `System.Xaml.dll`
   - `Microsoft.Web.WebView2.Wpf.dll`
3. **Target Flags**:
   - `/target:winexe` (suppresses the background console window for a clean desktop feel).
   - `/platform:x64` (targets native 64-bit Windows architecture).
   - `/optimize+` (enables compiler IL optimizations).

---

## 🚨 Troubleshooting Build Issues

### 1. Error `CS0016`: File Access Lock
**Error Message:**
```text
error CS0016: Could not write to output file 'SessionManagerPro.exe' -- 'The process cannot access the file because it is being used by another process.'
```
**Cause**: An active instance of `SessionManagerPro.exe` is running in memory and holds a write lock on the binary.  
**Solution**:
Terminate running instances and recompile:
```powershell
Stop-Process -Name SessionManagerPro -Force -ErrorAction SilentlyContinue
npm run build:exe
```

---

### 2. Missing WebView2 DLL References
**Error Message:**
```text
CS0246: The type or namespace name 'Microsoft.Web.WebView2' could not be found
```
**Cause**: The WebView2 NuGet package DLL was moved or deleted.  
**Solution**:
Verify that `Microsoft.Web.WebView2.Wpf.dll` and `Microsoft.Web.WebView2.Core.dll` exist in your project root or `launcher/` directory.

---

## 🚀 Next Steps

- Return to the [**Main README ↗**](../README.md)
- Check out the [**Installation Guide ↗**](INSTALLATION.md) for environment requirements.
- Check out the [**Configuration Guide ↗**](CONFIGURATION.md) to import proxies and authentic fingerprints.
- Check out the [**System Architecture Guide ↗**](ARCHITECTURE.md) to explore the internal engine mechanics.
