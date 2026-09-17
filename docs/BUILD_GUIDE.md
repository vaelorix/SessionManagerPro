# 🔨 Compilation & Build Guide

SessionManagerPro is a hybrid application featuring a **React 19 Vite Web Application** hosted within a **Native C# Windows WPF Executable** via Microsoft Edge WebView2.

---

## ⚡ Quick Build Commands

| Target | Command | Output Artifact |
| :--- | :--- | :--- |
| **All-in-One Full Build** | `npm run build` | Builds both Web UI and `SessionManagerPro.exe` |
| **Frontend UI Only** | `npm run build:ui` | `frontend/dist/` (static web bundle) |
| **Native Executable Only** | `npm run build:exe` | `SessionManagerPro.exe` (16 KB binary) |

---

## 🖥️ 1. Building the Frontend Web Bundle

The frontend is constructed using **React 19**, **TypeScript**, **Lucide Icons**, and **Vite**.

```powershell
npm run build:ui
```
*Behind the scenes:*
- Runs `tsc -b` to type-check all TypeScript files.
- Executes `vite build` to optimize and bundle CSS/JS into `frontend/dist/`.
- The production bundle is served automatically by Express at `http://127.0.0.1:3000`.

---

## 📦 2. Compiling the Native Desktop Executable (`SessionManagerPro.exe`)

The desktop launcher is written in lightweight C# (`launcher/SessionManagerPro.cs`) and compiles directly using Microsoft's native .NET C# compiler (`csc.exe`) without needing heavy Visual Studio installations.

```powershell
npm run build:exe
```
*Behind the scenes:*
- Executes `scripts/build-exe.ps1`.
- Locates the system .NET Framework compiler at:
  `$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe`
- References Windows Presentation Foundation (`PresentationCore`, `PresentationFramework`, `WindowsBase`) and `Microsoft.Web.WebView2.Wpf.dll`.
- Produces a fast, standalone `SessionManagerPro.exe` in the workspace root.

---

## 🚨 Troubleshooting Build Issues

### Issue: `error CS0016: Could not write to output file 'SessionManagerPro.exe' -- 'The process cannot access the file because it is being used by another process.'`
**Cause**: An existing instance of `SessionManagerPro.exe` is currently open and running.  
**Fix**:
1. Close the running desktop application window.
2. In PowerShell, terminate any lingering processes:
   ```powershell
   Stop-Process -Name SessionManagerPro -Force -ErrorAction SilentlyContinue
   ```
3. Re-run `npm run build:exe`.

### Issue: `WebView2 Loader Missing`
**Cause**: The WebView2 Evergreen Runtime is not installed on older Windows builds.  
**Fix**: Download and install the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
