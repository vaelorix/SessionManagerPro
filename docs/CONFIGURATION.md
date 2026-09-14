# ⚙️ Configuration & Tuning Guide

Learn how to configure sticky proxies, authentic fingerprints, startup tabs, WebRTC security, and browser extensions.

---

## 🌐 1. Proxy Setup

Proxies are loaded automatically from:
- `resources/proxies/proxies.txt` or `resources/proxies/proxiesgood.txt`

### Supported Protocols:
- **HTTP / HTTPS**: `http://host:port`
- **SOCKS4**: `socks4://host:port`
- **SOCKS5**: `socks5://host:port`

### Supported Formats:
```text
host:port:username:password
http://username:password@host:port
socks5://username:password@host:port
```
*Note: SessionManagerPro automatically resolves egress timezone from the proxy IP and isolates DNS and WebRTC traffic directly through the proxy tunnel.*

---

## 🎭 2. Authentic Fingerprint Library

Fingerprints are stored in:
- `resources/fpts/*.json.gz`

### Non-Randomization Guarantee:
Unlike standard anti-detect browsers that randomize canvas noise, GPU models, and core counts (creating mathematically unnatural fingerprint signatures that anti-fraud systems detect), SessionManagerPro utilizes **100% genuine captured hardware profiles**:
- **Hardware Concurrency & RAM**: Derived from real physical machines.
- **WebGL GPU Vendor & Renderer**: Matched to exact GPU hardware specs.
- **Screen Viewport & Color Depth**: Matches genuine laptop and monitor resolutions.
- **Client Hints (`navigator.userAgentData`)**: Mapped to exact Chromium / Windows platform versions.

---

## 🧩 3. Extensions Hub & Auto-Toolbar Pinning

Extensions are stored in:
- `resources/extensions/` or uploaded via the **Extensions Hub** GUI.

### Key Capabilities:
- **Auto-Unpacking**: Accepts `.xpi`, `.crx`, or `.zip` archives.
- **Global Injection**: When enabled, the extension is auto-injected into **every** launched browser session.
- **Profile-Bound Injection**: When global mode is disabled, assign extensions to specific profiles.
- **Auto-Pinning to Navigation Toolbar**: Loaded extensions are automatically pinned to Firefox's top navigation bar via `browser.uiCustomization.state` injection.

---

## 🛡️ 4. Profile Launcher Options

Configured via the **Options Modal** (sliders icon next to the launch URL bar):

| Option | Values | Effect |
| :--- | :--- | :--- |
| **Multi-Tab Startup URLs** | `urls (one per line)` | Automatically opens background tabs upon launch. Preset buttons for leak-testing (Whoer, Browserleaks, Pixelscan). |
| **WebRTC Policy** | `Proxy Only` | Routes WebRTC ICE strictly via proxy (prevents real IP leak while keeping WebRTC enabled). |
| | `Disabled` | Completely turns off `media.peerconnection` in Firefox (guarantees 0 WebRTC packets). |
| | `Default` | Standard browser behavior without proxy isolation. |
| **Ephemeral / Pristine Mode** | `true / false` | Prevents writing cookies, cache, or history back to disk on exit (leaves profile pristine). |
| **Cloaked Background** | `true / false` | Runs profile headlessly in the background without rendering an interactive GUI desktop window. |

<!-- docs: toolbar pinning -->
