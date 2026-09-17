# 🏛️ System Architecture & Internal Engine Mechanics

Technical specifications of the multi-tier SessionManagerPro orchestration engine, IPC pipeline, and stealth worker subsystem.

---

## 📐 Component Architecture Diagram

```mermaid
graph TD
    User([Operator / Desktop User]) -->|Interacts with UI| WPF[Native Desktop Host<br/>SessionManagerPro.exe (C# WPF / WebView2)]
    
    subgraph Frontend Presentation Layer
        WPF -->|Embedded Web View| React[React 19 Cyber Dashboard<br/>TypeScript + Vite]
        React -->|REST API & WS Client| SVR
    end

    subgraph Node.js Backend Orchestrator
        SVR[Express HTTP & WebSocket Server<br/>Port :3000]
        SVR --> MGR[Session Manager<br/>manager.js]
        MGR --> ORCH[Queue Orchestrator<br/>orchestrator.js]
        MGR --> REAP[Zero-Zombie Reaper<br/>reaper.js]
        MGR --> FP[Fingerprint Hub<br/>fingerprint.js]
        MGR --> EXT[Extension Registry<br/>extension_manager.js]
    end

    subgraph Python Stealth Subsystem
        ORCH -->|Spawns Child Process via JSON-Lines Stdio| WRK[Stealth Worker<br/>browser_worker.py]
        WRK --> INVPW[InvisiblePlaywright Stealth Engine]
        WRK --> PIN[Toolbar Customizer<br/>browser.uiCustomization.state]
        WRK --> MARIO[Marionette Automation Port]
        INVPW --> FF[Firefox Stealth Instance<br/>Hardware-Mapped Canvas / WebGL / Audio]
    end

    subgraph Persistent Storage Layer
        MGR --> DATA_SESS[(data/sessions.json)]
        MGR --> DATA_PROF[(data/profiles/*)]
        MGR --> DATA_COOK[(data/cookies/*)]
    end
```

---

## 🔧 Subsystem Specifications

### 1. Native Desktop Shell (`launcher/SessionManagerPro.cs`)
- **Runtime**: Windows Presentation Foundation (WPF) targeting .NET Framework 4.8.
- **Embedded Engine**: Microsoft Edge WebView2 Evergreen.
- **Process Lifecycle Management**: On launch, probes `http://127.0.0.1:3000/health`. If the server is offline, it automatically spawns the background Node.js process. On window closure, it signals graceful shutdown to active child workers.

---

### 2. Backend Orchestration Layer (`backend/src/`)
- **REST Endpoints**:
  - `GET /api/sessions`: Returns session configurations, active runtimes, and health statuses.
  - `POST /api/sessions/launch`: Dispatches session launch command to the queue orchestrator.
  - `POST /api/sessions/stop`: Requests graceful session termination and cookie persistence.
  - `GET /api/pool`: Provides live statistics on proxy availability and fingerprint pools.
- **WebSocket Streaming (`/ws`)**:
  - Pushes sub-second telemetry updates (runtime duration, open tab count, proxy ping latency, cookie sync events) to the React dashboard.
- **Dynamic Concurrency Control (`orchestrator.js`)**:
  - Employs an asynchronous queue stepper to enforce thread concurrency limits (e.g. max 5 concurrent browsers), preventing CPU spikes and memory exhaustion.
- **Zero-Zombie Reaper (`reaper.js`)**:
  - Periodically scans the Windows process table using `psutil` heuristics.
  - Automatically detects and terminates orphaned `geckodriver.exe` or `firefox.exe` processes whose parent Node.js worker has died, releasing locked ports and `.parent.lock` profile directories.

---

### 3. Stealth Worker Subsystem (`backend/src/browser_worker.py`)
- **IPC Protocol**: Communicates with the Node.js orchestrator via newline-delimited JSON messages over standard input (`stdin`) and standard output (`stdout`).
- **Fingerprint Emulation**:
  - Injects authentic GPU renderer and vendor strings (`UNMASKED_RENDERER_WEBGL`).
  - Emulates physical hardware concurrency (`navigator.hardwareConcurrency`) and device memory (`navigator.deviceMemory`).
  - Spoofs genuine audio context frequencies and client hints without detectable synthetic entropy.
- **Preference Optimization**:
  - Dynamic proxy configuration with remote DNS lookups (`network.proxy.socks_remote_dns = true`).
  - WebRTC proxy candidate enforcement (`media.peerconnection.ice.proxy_only = true`).
  - Automated extension toolbar placement via `browser.uiCustomization.state`.

---

## 🚀 Next Steps

- Return to the [**Main README ↗**](../README.md)
- Check out the [**Installation Guide ↗**](INSTALLATION.md) for environment setup.
- Check out the [**Build Guide ↗**](BUILD_GUIDE.md) to compile the native desktop launcher.
- Check out the [**Configuration Guide ↗**](CONFIGURATION.md) to fine-tune proxies and authentic fingerprints.
