# 📦 Installation & Environment Setup Guide

Comprehensive setup instructions for **SessionManagerPro** on Windows 10/11.

---

## 📋 System Requirements

| Component | Minimum Version | Recommended |
| :--- | :--- | :--- |
| **Operating System** | Windows 10 (64-bit) | Windows 11 (64-bit) |
| **Node.js** | `v18.0.0` or higher | `v20.x LTS` |
| **Python** | `3.10` or higher | `3.11.x (64-bit)` |
| **Microsoft Edge WebView2** | Installed by default on Win 10/11 | Latest Evergreen Runtime |
| **.NET Framework** | `4.8+` (contains `csc.exe`) | Included in Windows |

---

## 🛠️ Step-by-Step Installation

### Step 1: Clone or Open the Workspace
Ensure you are in the project root directory:
```powershell
cd "path/to/launcher"
```

### Step 2: Set Up Python Virtual Environment
SessionManagerPro leverages `invisible_playwright` to execute hardware-accurate stealth Firefox sessions.

```powershell
# Create virtual environment
python -m venv .venv

# Activate virtual environment
.\.venv\Scripts\Activate.ps1

# Upgrade pip and install required dependencies
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 3: Fetch the Stealth Browser Engine
Download the pre-compiled Firefox browser binaries matching `invisible_playwright`:
```powershell
.\.venv\Scripts\python.exe -m invisible_playwright fetch
```

### Step 4: Install Node.js Dependencies
Install root and backend packages:
```powershell
npm install
npm --prefix frontend install
```

### Step 5: Verify Your Installation
Run the automated self-check script to confirm Python, Node.js, and browser dependencies are intact:
```powershell
npm run selfcheck
```
*Expected output:*
```text
selfcheck ok — Python 3.11.x + invisible_playwright stealth engine verified
```

---

## 🚀 Next Steps

- Check out the [**Build Guide ↗**](BUILD_GUIDE.md) to compile the native desktop launcher.
- Check out the [**Configuration Guide ↗**](CONFIGURATION.md) to import proxies and authentic fingerprints.
- Check out the [**System Architecture Guide ↗**](ARCHITECTURE.md) to explore the internal engine mechanics.
