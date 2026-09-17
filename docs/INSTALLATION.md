# 📦 Installation & Environment Setup Guide

Comprehensive setup, dependency verification, and troubleshooting instructions for **SessionManagerPro** on Windows 10/11 (64-bit).

---

## 📋 System Requirements & Compatibility

| Component | Minimum Version | Recommended Version | Verification Command |
| :--- | :--- | :--- | :--- |
| **Operating System** | Windows 10 (Build 19041+) | Windows 11 (64-bit) | `winver` |
| **Python** | `3.10` (64-bit) | `3.11.x` (64-bit) | `python --version` |
| **Node.js** | `v18.0.0` | `v20.x LTS` or higher | `node --version` |
| **npm** | `v9.0.0` | `v10.x` | `npm --version` |
| **WebView2** | Evergreen Runtime | Built-in on Windows 10/11 | Installed in System32 |
| **.NET Framework** | `4.8+` | Windows Native `csc.exe` | Included with Windows |

---

## 🛠️ Step-by-Step Setup

### Step 1: Open Terminal in Project Directory
Open PowerShell as a standard user (or Administrator if execution policies are restricted) and navigate to the project directory:

```powershell
cd "c:\path\to\launcher"
```

---

### Step 2: Configure Python Virtual Environment
SessionManagerPro isolates all stealth engine packages inside a local virtual environment (`.venv`) to avoid dependency collisions with system-level Python installations.

```powershell
# 1. Create a dedicated virtual environment
python -m venv .venv

# 2. Activate the virtual environment
.\.venv\Scripts\Activate.ps1

# 3. Upgrade pip tooling
pip install --upgrade pip setuptools wheel

# 4. Install production dependencies
pip install -r requirements.txt
```

---

### Step 3: Fetch the Stealth Browser Engine
Download the official undetected Firefox browser binaries matching `invisible_playwright`:

```powershell
.\.venv\Scripts\python.exe -m invisible_playwright fetch
```

*Note: This command downloads the tailored browser binaries to your local AppData directory.*

---

### Step 4: Install Node.js Dependencies
Install root orchestrator dependencies and the React 19 dashboard dependencies:

```powershell
# 1. Install root dependencies (Express, WebSockets, Chalk, Inquirer)
npm install

# 2. Install frontend dependencies (React 19, TypeScript, Lucide, Vite)
npm --prefix frontend install
```

---

### Step 5: Run Automated Health Check
Run the built-in diagnostic test to verify that all Python, Node.js, and browser dependencies are correctly linked:

```powershell
npm run selfcheck
```

**Expected Successful Output:**
```text
selfcheck ok — Python 3.11.x + invisible_playwright stealth engine verified
```

---

## 🚨 Troubleshooting & Diagnostics

### 1. PowerShell Script Execution Error (`Activate.ps1`)
**Error:**
```text
File ...\Activate.ps1 cannot be loaded because running scripts is disabled on this system.
```
**Solution:**
Enable local script execution for the current user:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

---

### 2. Python Architecture Mismatch (32-bit vs 64-bit)
**Error:**
```text
ImportError: DLL load failed while importing _maxminddb: %1 is not a valid Win32 application.
```
**Solution:**
Ensure you have installed a **64-bit** build of Python 3.10 or 3.11. Verify in PowerShell:
```powershell
python -c "import platform; print(platform.architecture())"
# Output should be: ('64bit', 'WindowsPE')
```

---

### 3. Missing Microsoft Edge WebView2 Runtime
If launching `SessionManagerPro.exe` indicates that the WebView2 runtime could not be located:
1. Download the Evergreen Standalone Installer from the [Microsoft Edge WebView2 Portal](https://developer.microsoft.com/microsoft-edge/webview2/).
2. Run the installer and restart the application.

---

## 🚀 Next Steps

- Return to the [**Main README ↗**](../README.md)
- Check out the [**Build Guide ↗**](BUILD_GUIDE.md) to compile the standalone desktop launcher.
- Check out the [**Configuration Guide ↗**](CONFIGURATION.md) to import proxies and authentic fingerprints.
- Check out the [**System Architecture Guide ↗**](ARCHITECTURE.md) to explore the internal engine mechanics.
