<p align="center">
  <img src="docs/assets/monkey.gif" width="200" alt="SessionManagerPro Mascot" />
</p>

<div align="center">

# 🐵 SessionManagerPro (SMP)

### *Enterprise Anti-Detect Stealth Browser Orchestrator* 🎭✨

**Bypass modern anti-fraud algorithms, orchestrate multi-threaded driverless profiles, load custom extensions, and isolate proxy tunnels with authentic hardware signatures.**

[![Python](https://img.shields.io/badge/Python-3.10%20%7C%203.11-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://www.python.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![React](https://img.shields.io/badge/React-19.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![C#](https://img.shields.io/badge/C%23-WPF%20%2F%20WebView2-239120?style=for-the-badge&logo=csharp&logoColor=white)](https://learn.microsoft.com/dotnet/csharp/)
[![Engine](https://img.shields.io/badge/Engine-Zendriver%20(CDP)-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white)](https://github.com/cdpdriver/zendriver)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011-0078D6?style=for-the-badge&logo=windows&logoColor=white)](https://www.microsoft.com/windows)
[![License](https://img.shields.io/badge/License-MIT-amber?style=for-the-badge)](LICENSE)

</div>

---

## 📑 Table of Contents

- [Overview & Architecture](#-overview--architecture)
- [Tech Stack & Ecosystem](#-tech-stack--ecosystem)
- [Enterprise Features](#-enterprise-features)
- [Project Directory Layout](#-project-directory-layout)
- [Quickstart Guide](#-quickstart-guide)
  - [Prerequisites](#1-prerequisites)
  - [Environment Setup](#2-environment-setup)
  - [Running the Application](#3-running-the-application)
  - [Production Builds](#4-compilation--production-builds)
- [Deep Dive Documentation](#-deep-dive-documentation)
- [Command Reference](#-command-reference)
- [Special Thanks & Credits](#-special-thanks--credits)
- [License](#-license)

---

## 💎 Overview & Architecture

Modern anti-fraud algorithms (such as Cloudflare Turnstile, Datadome, Akamai, and Kasada) detect automated browser instances by inspecting **entropy inconsistencies** and traditional **WebDriver artifacts** (`navigator.webdriver`, chromedriver fingerprints, unnatural canvas noise).

**SessionManagerPro** solves this at the architectural level:
- **Driverless CDP Architecture**: Powered by **Zendriver** (async successor to `nodriver`), communicating directly with the browser via Chrome DevTools Protocol (CDP) over WebSockets with **zero WebDriver binaries or flags**.
- **Deterministic Hardware Mapping**: Replaces synthetic randomness with captured hardware profiles from authentic physical machines.
- **Hybrid Micro-Orchestrator**: Blends an ultra-lightweight **C# WPF + WebView2** native desktop host with a **Node.js Express / WebSocket** backend and an **isolated Python stealth worker**.
- **Zero-Leak Proxy Tunnels**: Generates dynamic background proxy authentication extensions (`webRequestAuthProvider`) ensuring authenticated SOCKS5/HTTP proxies work with zero DNS or WebRTC leaks.
- **Zero-Zombie Reaper**: Continuous OS-level process management cleans orphaned browser instances, leftover lockfiles (`SingletonLock`), and socket handles automatically.

---

## 🧰 Tech Stack & Ecosystem

| Layer | Technology | Version | Purpose in SessionManagerPro |
| :---: | :--- | :---: | :--- |
| <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/python/python-original.svg" width="22" height="22" /> | **Python & Zendriver** | `3.10+ / 3.11` | Subprocess browser worker, `zendriver` CDP engine, WebGL/Canvas spoofing & driverless automation |
| <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/nodejs/nodejs-original.svg" width="22" height="22" /> | **Node.js & Express** | `18+ LTS` | High-throughput backend REST API server, concurrency queue manager & real-time WebSocket telemetry hub |
| <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/react/react-original.svg" width="22" height="22" /> | **React** | `19.0` | Cyber-dark glassmorphism operator dashboard, reactive state management & modular component architecture |
| <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/typescript/typescript-original.svg" width="22" height="22" /> | **TypeScript** | `5.0+` | Strict compile-time type safety across all frontend API contracts, WebSocket payloads, and UI states |
| <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/csharp/csharp-original.svg" width="22" height="22" /> | **C# / .NET** | `4.8+` | Native Windows desktop wrapper executable hosting Microsoft Edge WebView2 Evergreen |
| <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/chrome/chrome-original.svg" width="22" height="22" /> | **Chromium (Chrome / Edge)** | `Latest Stable` | Driverless runtime isolated with sticky SOCKS5/HTTP proxies and authentic hardware fingerprints |
| <img src="https://raw.githubusercontent.com/devicons/devicon/master/icons/vitejs/vitejs-original.svg" width="22" height="22" /> | **Vite** | `6.0+` | Sub-second frontend Hot Module Replacement (HMR) and ultra-compact production bundling |

---

## 🌟 Enterprise Features

- 🎭 **100% Authentic Physical Fingerprints**: Zero synthetic RNG noise. Viewports, GPU models (`UNMASKED_RENDERER_WEBGL`), audio contexts, CPU threads, and RAM are mapped from genuine captured systems.
- ⚡ **Driverless CDP Execution**: Direct WebSocket CDP connection completely eliminates `navigator.webdriver` artifacts and Selenium detection hooks.
- 🛡️ **WebRTC Leak Armor**: Strict `--force-webrtc-ip-handling-policy=disable_non_proxied_udp` forces WebRTC packets through your proxy tunnel, or disables WebRTC completely with `--disable-webrtc`.
- 🧩 **Seamless Extension Loading**: Supports unpacked `.crx`, `.zip`, and directory extensions loaded directly via Chromium's extension pipeline.
- ⚡ **Dynamic Concurrency Stepper**: Control concurrent session load with a live stepper bar (from 1 to 20+ profiles simultaneously) without freezing host CPU or exhausting memory.
- 👻 **Ephemeral & Cloaked Modes**: Run disposable sessions that wipe cookies and cache on exit, or cloak sessions completely in the background without rendering an interactive GUI.
- 🧹 **Zero-Zombie Reaper Subsystem**: Auto-detects and terminates orphaned processes, leftover `SingletonLock` files, and stale port bindings automatically.

---

## 📂 Project Directory Layout

```text
SessionManagerPro/
├── backend/                     # Node.js REST API server & WebSocket orchestrator
│   └── src/                     # Express routes, session manager & browser_worker.py (Zendriver)
├── data/                        # Persistent profiles, session configurations & cookies
├── docs/                        # Deep dive technical documentation guides
│   ├── assets/                  # Local documentation assets and mascots
│   ├── ARCHITECTURE.md          # IPC dataflow, threading model & zombie reaper specs
│   ├── BUILD_GUIDE.md           # C# csc.exe compiler flags & Vite bundling guide
│   ├── CONFIGURATION.md         # Proxies, hardware fingerprints & WebRTC policies
│   └── INSTALLATION.md          # Comprehensive OS setup & venv configuration
├── frontend/                    # Modern React 19 + Vite dashboard
│   └── src/                     # Dashboard components, WebSocket client & cyber UI
├── launcher/                    # C# native desktop wrapper (SessionManagerPro.cs)
├── resources/                   # Fingerprint databases (.json.gz), proxies & extensions
├── scripts/                     # PowerShell automation scripts (build-exe.ps1)
└── SessionManagerPro.exe        # Standalone compiled native Windows desktop application
```

---

## ⚡ Quickstart Guide

### 1. Prerequisites
- **Operating System**: Windows 10 or Windows 11 (64-bit)
- **Browser**: Google Chrome or Microsoft Edge installed
- **Node.js**: `v18.0.0` or higher ([Download Node.js](https://nodejs.org/))
- **Python**: `3.10` or `3.11` (64-bit) ([Download Python](https://www.python.org/))
- **WebView2**: Built into Windows 10/11 ([Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/))

### 2. Environment Setup
```powershell
# 1. Initialize Python virtual environment
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install --upgrade pip
pip install -r requirements.txt

# 2. Install Node.js dependencies
npm install
npm --prefix frontend install

# 3. Verify system environment health
npm run selfcheck
```

### 3. Running the Application
Select your preferred operating mode:

```powershell
# Option A: Launch Native Windows Desktop App (.exe)
npm run app

# Option B: Run via Browser (Express Server + Web Dashboard)
npm start

# Option C: Run via Interactive Terminal CLI
npm run cli
```

### 4. Compilation & Production Builds
```powershell
# Compile both the React Frontend bundle and SessionManagerPro.exe
npm run build
```
*(Or compile individually: `npm run build:ui` for React, `npm run build:exe` for C#).*

---

## 📚 Deep Dive Documentation

Click any documentation link below to read the comprehensive technical guide:

| Guide | Scope & Topics Covered | Documentation Link |
| :--- | :--- | :--- |
| **📦 Installation & Setup** | OS requirements, Python `.venv`, Node dependencies & self-check diagnostics | [**Read docs/INSTALLATION.md ↗**](docs/INSTALLATION.md) |
| **🔨 Build & Compilation** | C# `.NET` `csc.exe`, Vite React bundling, and standalone `SessionManagerPro.exe` | [**Read docs/BUILD_GUIDE.md ↗**](docs/BUILD_GUIDE.md) |
| **⚙️ Configuration & Tuning** | Sticky proxies, authentic hardware fingerprints, extensions, and WebRTC leak armor | [**Read docs/CONFIGURATION.md ↗**](docs/CONFIGURATION.md) |
| **🏛️ System Architecture** | Process tree, stdio JSON IPC, stealth worker subsystem, and session locks | [**Read docs/ARCHITECTURE.md ↗**](docs/ARCHITECTURE.md) |

---

### 🔍 Interactive Topic Explorer

Click any dropdown below to preview topic outlines:

<details open>
<summary><b>📦 Detailed Installation Guide (Prerequisites, Python venv, Node setup)</b></summary>
<br/>

For comprehensive operating system requirements, virtual environment setup, and dependency troubleshooting, consult:  
👉 [**Read docs/INSTALLATION.md ↗**](docs/INSTALLATION.md)

- Prerequisites breakdown (Windows 10/11, Node 18+, Python 3.10+, Chrome/Edge, WebView2)
- Step-by-step PowerShell setup instructions
- Automated health-check verification
</details>

<details>
<summary><b>🔨 Build & Compilation Guide (C# csc.exe, Vite, Binary Outputs)</b></summary>
<br/>

Learn how the hybrid architecture compiles from source into a standalone Windows binary:  
👉 [**Read docs/BUILD_GUIDE.md ↗**](docs/BUILD_GUIDE.md)

- How `scripts/build-exe.ps1` compiles `SessionManagerPro.exe` using .NET `csc.exe`
- How `vite build` bundles the frontend into `frontend/dist/`
- Resolving file locks (`error CS0016`) when rebuilding
</details>

<details>
<summary><b>⚙️ Configuration & Tuning Guide (Proxies, Fingerprints, Extensions, WebRTC)</b></summary>
<br/>

Detailed instructions on fine-tuning sessions, proxies, and extensions:  
👉 [**Read docs/CONFIGURATION.md ↗**](docs/CONFIGURATION.md)

- Proxy authentication formats (HTTP, SOCKS4, SOCKS5)
- Ephemeral proxy auth extensions for zero credential leaks
- Authentic fingerprint library mapping vs synthetic RNG detection
- Extensions Hub (uploading, Global Auto-Injection, profile bindings)
- Launcher Options (WebRTC policies, multi-tab start URLs, ephemeral mode)
</details>

<details>
<summary><b>🏛️ System Architecture & Internal Mechanics</b></summary>
<br/>

Understand the inner workings and data flow of SessionManagerPro:  
👉 [**Read docs/ARCHITECTURE.md ↗**](docs/ARCHITECTURE.md)

- Architecture diagram (WPF WebView2 ➔ Node.js WebSocket ➔ Python Worker ➔ Zendriver CDP)
- IPC communication over JSON-lines stdio
- Chrome DevTools Protocol automation without WebDriver binaries
- Zombie process management and session locking
</details>

---

## ⌨️ Command Reference

| Command | Description |
| :--- | :--- |
| `npm run app` | Launches the compiled native Windows desktop application (`SessionManagerPro.exe`) |
| `npm start` | Starts Express backend and opens dashboard in your default browser |
| `npm run cli` | Launches the interactive terminal management CLI with interactive prompts |
| `npm run build` | Builds both the React web bundle and compiles `SessionManagerPro.exe` |
| `npm run build:ui` | Builds only the React 19 frontend bundle into `frontend/dist/` |
| `npm run build:exe` | Compiles the standalone C# WPF executable using system `csc.exe` |
| `npm run selfcheck` | Verifies Python virtual environment, dependencies, and stealth engine integrity |

---

## 💖 Special Thanks & Credits

SessionManagerPro is powered by groundbreaking open-source driverless browser automation:

- **[Zendriver](https://github.com/cdpdriver/zendriver)** & **[Nodriver](https://github.com/ultrafunkamsterdam/nodriver)** (by [Ultrafunkamsterdam](https://github.com/ultrafunkamsterdam)) — The foundational async Chrome DevTools Protocol engine providing high-performance, driverless browser control without WebDriver artifacts.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details. You are free to use, modify, distribute, and orchestrate sessions as you wish.

---

<div align="center">

### 🖤 Made with Love, Code, & Mischievous Monkeys 🐵

**Copyright © 2026 SessionManagerPro Team. All Rights Reserved.**  
*Bypass limits. Automate seamlessly. Keep smiling!* 😄

</div>
