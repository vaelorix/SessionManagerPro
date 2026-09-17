# ⚙️ Configuration & Hardware Tuning Guide

Comprehensive guide to configuring sticky proxy pipelines, physical hardware fingerprints, automatic extension toolbar pinning, and WebRTC leak armor in **SessionManagerPro**.

---

## 🌐 1. Proxy Architecture & Protocols

SessionManagerPro isolates every profile session within its own authenticated proxy tunnel.

### Supported Protocols:
- **HTTP / HTTPS**: Standard web tunneling with Basic authentication.
- **SOCKS4**: TCP tunneling.
- **SOCKS5**: TCP/UDP tunneling with remote DNS resolution (`socks5h://`).

### Auto-Loaded Proxy File Paths:
- `resources/proxies/proxies.txt`
- `resources/proxies/proxiesgood.txt`

### Supported String Formats:
```text
# Standard host-port with user credentials
host:port:username:password

# Explicit URI format
http://username:password@host:port
socks5://username:password@host:port
socks5h://username:password@host:port
```

### Egress IP & Timezone Synchronization:
When a proxy is bound to a session:
1. The orchestrator resolves the egress IP via external lookup.
2. The local `maxminddb` database extracts the geographical coordinates and IANA timezone (e.g. `America/New_York`, `Europe/London`).
3. Firefox’s `Intl.DateTimeFormat` timezone is dynamically overridden to match the proxy egress country, preventing timezone-offset mismatch detection.

---

## 🎭 2. Authentic Physical Fingerprints vs Synthetic RNG

Commercial anti-detect browsers typically randomize browser properties using synthetic Math.random() noise (e.g., adding ±0.001 to canvas pixel colors or picking random WebGL GPU renderer strings).

Modern fraud engines flag these profiles because the combination of parameters is mathematically impossible on real hardware (e.g., a mobile GPU renderer paired with a desktop CPU thread count).

### SessionManagerPro Non-Randomization Model:
Fingerprints in `resources/fpts/*.json.gz` are captured from **100% genuine physical machines**:

| Property | Implementation in SessionManagerPro | Anti-Detection Benefit |
| :--- | :--- | :--- |
| **`UNMASKED_RENDERER_WEBGL`** | Exact physical vendor/renderer string | Matches GPU shader capabilities |
| **`navigator.hardwareConcurrency`** | Genuine physical core count (4, 8, 12, 16, 24) | Avoids unnatural synthetic thread allocations |
| **`navigator.deviceMemory`** | Actual RAM capacity (4, 8, 16, 32 GB) | Consistent with hardware class |
| **Screen Resolution & DPR** | Physical monitor dimensions (`1920x1080`, `2560x1440`) | Device pixel ratio and color depth remain coherent |
| **High Entropy Client Hints** | Matched to Chromium / Windows build tags | Prevents header vs JavaScript mismatch |

---

## 🧩 3. Extension Management & Frame-1 Toolbar Pinning

Extensions are managed via the **Extensions Hub** modal or placed directly in `resources/extensions/`.

### Supported Archive Types:
- `.xpi` (Firefox Add-on Package)
- `.crx` (Packed Chromium Extension)
- `.zip` (Unpacked Extension Directory)

### Frame-1 Toolbar Pinning Mechanics:
Standard browser automation leaves loaded extensions hidden in the overflow puzzle-piece menu. SessionManagerPro guarantees that loaded extensions appear pinned directly to Firefox's primary navigation toolbar immediately on boot:

```json
{
  "placements": {
    "nav-bar": [
      "back-button",
      "forward-button",
      "stop-reload-button",
      "urlbar-container",
      "custom-extension-widget-id"
    ]
  }
}
```
*The worker injects this placement state directly into `browser.uiCustomization.state` before Marionette launches the browser instance.*

---

## 🛡️ 4. Profile Launcher Options

Configure advanced runtime options via the **Options Modal** (sliders icon next to the launch button):

| Setting | Configuration Values | Technical Behavior |
| :--- | :--- | :--- |
| **Multi-Tab Startup URLs** | URL list (one per line) | Automatically launches secondary tabs on startup. Preset buttons included for `whoer.net`, `browserleaks.com`, and `pixelscan.net`. |
| **WebRTC Policy** | `Proxy Only` *(Recommended)* | Configures `media.peerconnection.ice.proxy_only = true`. All ICE candidate queries are forced through the proxy tunnel, preventing local/public IP leaks while keeping WebRTC operational. |
| | `Disabled` | Sets `media.peerconnection.enabled = false`. Zero WebRTC network traffic is emitted. |
| | `Default` | Standard browser behavior without proxy isolation. |
| **Ephemeral / Pristine Mode** | `true` / `false` | When enabled, cookies, IndexedDB, and local cache are kept in memory and discarded on shutdown, leaving profile storage pristine. |
| **Cloaked Background** | `true` / `false` | Runs profile headlessly in the background without rendering an interactive GUI desktop window. |

---

## 🚀 Next Steps

- Return to the [**Main README ↗**](../README.md)
- Check out the [**Installation Guide ↗**](INSTALLATION.md) for environment requirements.
- Check out the [**Build Guide ↗**](BUILD_GUIDE.md) to compile the native desktop launcher.
- Check out the [**System Architecture Guide ↗**](ARCHITECTURE.md) to explore the internal engine mechanics.
