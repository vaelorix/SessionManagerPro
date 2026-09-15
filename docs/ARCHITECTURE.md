# 🏛️ Architecture & Internal Engine Mechanics

Technical deep-dive into the SessionManagerPro orchestration engine and stealth subsystem.

---

## 📐 High-Level Architecture Diagram

```mermaid
graph TD
    User([User / Operator]) -->|Interacts with| GUI[Native Desktop Wrapper<br/>SessionManagerPro.exe (WPF/WebView2)]
    GUI -->|HTTP/REST & WebSockets| SVR[Backend Server<br/>Node.js Express / WS :3000]
    
    subgraph Node.js Backend Orchestrator
        SVR --> MGR[Session Manager<br/>manager.js]
        MGR --> ORCH[Orchestrator<br/>orchestrator.js]
        MGR --> REAP[Zombie Reaper<br/>reaper.js]
        MGR --> FP[Fingerprint Hub<br/>fingerprint.js]
        MGR --> EXT[Extension Registry<br/>extension_manager.js]
    end

    subgraph Python Stealth Subsystem
        ORCH -->|Spawns via IPC Stdin/Stdout| WRK[Browser Worker<br/>browser_worker.py]
        WRK --> INVPW[InvisiblePlaywright Engine]
        WRK --> PIN[Toolbar Pinning Injector<br/>browser.uiCustomization.state]
        WRK --> MARIO[Marionette Port Injector]
        INVPW --> FF[Firefox Stealth Instance<br/>Hardware-Mapped GPU/Canvas/WebGL]
    end

    subgraph Storage Layer
        MGR --> DATA_SESS[(data/sessions.json)]
        MGR --> DATA_PROF[(data/profiles/*)]
        MGR --> DATA_COOK[(data/cookies/*)]
    end
```

---

## 🔧 Subsystem Breakdown

### 1. Native Desktop Shell (`launcher/SessionManagerPro.cs`)
- Lightweight C# WPF application targeting .NET Framework 4.8.
- Embeds Microsoft Edge WebView2 Evergreen Runtime.
- Automates lifecycle: on launch, ensures backend Node.js server is active; on close, cleans up processes.

### 2. Backend Orchestration Layer (`backend/src/`)
- **`server.js`**: Express server exposing REST API endpoints (`/api/sessions`, `/api/pool`, `/api/resources`, `/api/extensions`) and a bidirectional WebSocket (`ws://127.0.0.1:3000/ws`) for real-time telemetry (active duration, open tabs, live cookie count).
- **`orchestrator.js`**: Concurrency queue manager that respects the operator's thread stepper limit, scheduling launches without spiking host CPU.
- **`reaper.js`**: Scans the operating system process table for orphaned geckodriver or Firefox worker processes, releasing stale locks (`parent.lock`, `MarionetteActivePort`).

### 3. Stealth Worker (`backend/src/browser_worker.py`)
- Executes in an isolated Python 3 subprocess communicating with the parent Node.js orchestrator via JSON lines over standard I/O pipes.
- Injects exact hardware properties into all browser frames:
  - `navigator.hardwareConcurrency` & `navigator.deviceMemory`
  - WebGL `UNMASKED_VENDOR_WEBGL` & `UNMASKED_RENDERER_WEBGL`
  - High-entropy Client Hints (`getHighEntropyValues`)
  - Screen dimensions, viewport, and Device Pixel Ratio (`devicePixelRatio`).
- Dynamically configures Firefox preferences:
  - Strict proxy routing (DNS remote resolution, socks5 authentication).
  - WebRTC candidate filtering (`media.peerconnection.ice.proxy_only`).
  - Pre-boots extension placement directly in `placements['nav-bar']` to guarantee frame-1 toolbar pinning.

<!-- docs: customizableui -->
