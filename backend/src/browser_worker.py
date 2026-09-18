"""
Zendriver Worker Process for SessionManagerPro.
Manages a persistent, driverless Chromium session using zendriver (CDP).
Communicates with Node.js backend over JSON lines via stdin/stdout.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import psutil

# Force UTF-8 and line-buffered standard streams
if sys.platform == "win32":
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", line_buffering=True)
    sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8")

LOCAL_DIR = str(Path(__file__).parent.resolve())
if LOCAL_DIR not in sys.path:
    sys.path.insert(0, LOCAL_DIR)

import zendriver as zd
from zendriver import cdp


def emit(event_type: str, **kwargs):
    """Emit JSON event to stdout for Node.js parent process."""
    payload = {"event": event_type, **kwargs}
    try:
        sys.stdout.write(json.dumps(payload) + "\n")
        sys.stdout.flush()
    except Exception:
        pass


def log_err(msg: str):
    """Log diagnostic message to stderr."""
    try:
        sys.stderr.write(f"[worker:zendriver] {msg}\n")
        sys.stderr.flush()
    except Exception:
        pass


def create_proxy_auth_extension(host: str, port: int, user: str, pass_: str, scheme: str = "http", out_dir: Optional[Path] = None) -> Path:
    """Create a temporary Manifest V3 proxy authentication extension for Chromium."""
    ext_dir = out_dir or Path(os.environ.get("TEMP", ".")) / f"proxy_auth_{int(time.time()*1000)}"
    ext_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "version": "1.0.0",
        "manifest_version": 3,
        "name": "SessionManagerPro Proxy Auth",
        "permissions": ["proxy", "webRequest", "webRequestAuthProvider", "storage"],
        "host_permissions": ["<all_urls>"],
        "background": {
            "service_worker": "background.js"
        }
    }
    (ext_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    bg_js = f"""
chrome.proxy.settings.set({{
  value: {{
    mode: "fixed_servers",
    rules: {{
      singleProxy: {{
        scheme: "{scheme}",
        host: "{host}",
        port: {int(port)}
      }},
      bypassList: ["<local>"]
    }}
  }},
  scope: "regular"
}}, function() {{}});

chrome.webRequest.onAuthRequired.addListener(
  function(details) {{
    return {{
      authCredentials: {{
        username: "{user}",
        password: "{pass_}"
      }}
    }};
  }},
  {{urls: ["<all_urls>"]}},
  ["blocking"]
);
"""
    (ext_dir / "background.js").write_text(bg_js.strip(), encoding="utf-8")
    return ext_dir


class BrowserWorker:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.session_id: str = args.id
        self.profile_dir: Path = Path(args.profile_dir).resolve()
        self.seed: Optional[int] = args.seed
        self.headless: bool = bool(args.headless)
        self.timezone: str = args.timezone or ""
        self.locale: str = args.locale or "auto"
        self.cookies_file = Path(args.cookies_file).resolve() if args.cookies_file else None
        self.webrtc_policy: str = (getattr(args, "webrtc_policy", None) or "proxy_only").lower()
        self.ephemeral: bool = bool(getattr(args, "ephemeral", False))

        self.start_urls: List[str] = []
        if getattr(args, "start_urls", None):
            try:
                raw_urls = json.loads(args.start_urls) if isinstance(args.start_urls, str) else args.start_urls
                if isinstance(raw_urls, list):
                    self.start_urls = [str(u) for u in raw_urls if u]
            except Exception as e:
                log_err(f"Failed to parse start_urls: {e}")

        if not self.start_urls and getattr(args, "url", None):
            self.start_urls = [args.url]

        self.fp_spec: Optional[Dict[str, Any]] = None
        if getattr(args, "fingerprint_spec", None):
            try:
                self.fp_spec = json.loads(args.fingerprint_spec) if isinstance(args.fingerprint_spec, str) else args.fingerprint_spec
            except Exception as e:
                log_err(f"Failed to parse fingerprint_spec: {e}")

        self.extensions: List[str] = []
        if getattr(args, "extensions", None):
            try:
                raw_ext = json.loads(args.extensions) if isinstance(args.extensions, str) else args.extensions
                if isinstance(raw_ext, list):
                    self.extensions = [str(x) for x in raw_ext if x]
            except Exception as e:
                log_err(f"Failed to parse extensions: {e}")

        self.proxy_dict: Optional[Dict[str, str]] = None
        self.proxy_raw: Optional[Dict[str, Any]] = None
        if args.proxy:
            try:
                p = json.loads(args.proxy) if isinstance(args.proxy, str) else args.proxy
                if p and p.get("host") and p.get("port"):
                    self.proxy_raw = p
                    scheme = str(p.get("scheme", "http")).lower()
                    if not scheme.startswith(("http", "socks")):
                        scheme = "http"
                    self.proxy_dict = {
                        "server": f"{scheme}://{p['host']}:{p['port']}",
                        "scheme": scheme,
                        "host": str(p["host"]),
                        "port": int(p["port"]),
                        "username": str(p.get("username", "")),
                        "password": str(p.get("password", "")),
                    }
            except Exception as e:
                log_err(f"Failed to parse proxy: {e}")

        self.browser: Optional[zd.Browser] = None
        self.closing: bool = False
        self.closed_by_user: bool = False
        self.input_queue: asyncio.Queue[str] = asyncio.Queue()
        self.running: bool = True

    def generate_fingerprint_init_script(self) -> str:
        """Generate JavaScript to inject exact fingerprint specs into all frames before page load."""
        if not self.fp_spec:
            return ""
        fp_json = json.dumps(self.fp_spec)
        return f"""(function() {{
  try {{
    const fp = {fp_json};
    if (!fp) return;

    // 1. Hardware Concurrency & Device Memory (Strictly from Fingerprint)
    if (fp.hardwareConcurrency) {{
      Object.defineProperty(navigator, 'hardwareConcurrency', {{
        get: () => Number(fp.hardwareConcurrency),
        configurable: true,
        enumerable: true
      }});
    }}
    if (fp.deviceMemory) {{
      Object.defineProperty(navigator, 'deviceMemory', {{
        get: () => Number(fp.deviceMemory),
        configurable: true,
        enumerable: true
      }});
    }}
    if (fp.platform) {{
      Object.defineProperty(navigator, 'platform', {{
        get: () => fp.platform,
        configurable: true,
        enumerable: true
      }});
    }}
    if (fp.maxTouchPoints !== undefined) {{
      Object.defineProperty(navigator, 'maxTouchPoints', {{
        get: () => Number(fp.maxTouchPoints),
        configurable: true,
        enumerable: true
      }});
    }}
    if (fp.vendor) {{
      Object.defineProperty(navigator, 'vendor', {{
        get: () => fp.vendor,
        configurable: true,
        enumerable: true
      }});
    }}
    if (fp.userAgent) {{
      Object.defineProperty(navigator, 'userAgent', {{
        get: () => fp.userAgent,
        configurable: true,
        enumerable: true
      }});
    }}
    if (fp.appVersion) {{
      Object.defineProperty(navigator, 'appVersion', {{
        get: () => fp.appVersion,
        configurable: true,
        enumerable: true
      }});
    }}
    if (fp.languages && fp.languages.length) {{
      Object.defineProperty(navigator, 'languages', {{
        get: () => Object.freeze([...fp.languages]),
        configurable: true,
        enumerable: true
      }});
      Object.defineProperty(navigator, 'language', {{
        get: () => fp.languages[0],
        configurable: true,
        enumerable: true
      }});
    }}

    // 2. Screen & Device Metrics (Strictly from Fingerprint)
    if (fp.screen) {{
      const scr = fp.screen;
      const metrics = {{
        width: scr.width,
        height: scr.height,
        availWidth: scr.availWidth || scr.width,
        availHeight: scr.availHeight || scr.height,
        colorDepth: scr.colorDepth || 24,
        pixelDepth: scr.pixelDepth || scr.colorDepth || 24
      }};
      for (const [k, v] of Object.entries(metrics)) {{
        if (v !== undefined) {{
          Object.defineProperty(screen, k, {{
            get: () => Number(v),
            configurable: true,
            enumerable: true
          }});
        }}
      }}
    }}
    if (fp.viewport && fp.viewport.deviceScaleFactor) {{
      Object.defineProperty(window, 'devicePixelRatio', {{
        get: () => Number(fp.viewport.deviceScaleFactor),
        configurable: true,
        enumerable: true
      }});
    }}

    // 3. WebGL GPU Unmasked Vendor & Renderer
    const patchWebGL = (proto) => {{
      if (!proto || !proto.getParameter) return;
      const origGetParameter = proto.getParameter;
      proto.getParameter = function(param) {{
        if (param === 37445) {{
          return (fp.webgl && fp.webgl.vendor) || "Google Inc. (Intel)";
        }}
        if (param === 37446) {{
          return (fp.webgl && fp.webgl.renderer) || "ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)";
        }}
        return origGetParameter.apply(this, arguments);
      }};
    }};
    if (typeof WebGLRenderingContext !== 'undefined') patchWebGL(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') patchWebGL(WebGL2RenderingContext.prototype);

    // 4. Client Hints (navigator.userAgentData)
    if (fp.userAgentData) {{
      const uad = fp.userAgentData;
      Object.defineProperty(navigator, 'userAgentData', {{
        get: () => ({{
          brands: uad.brands || [
            {{ brand: "Google Chrome", version: "131" }},
            {{ brand: "Chromium", version: "131" }},
            {{ brand: "Not_A Brand", version: "24" }}
          ],
          mobile: Boolean(uad.mobile),
          platform: uad.platform || (fp.platform === "Win32" ? "Windows" : fp.platform || "Windows"),
          getHighEntropyValues: async (hints) => ({{
            architecture: uad.architecture || "x86",
            bitness: uad.bitness || "64",
            brands: uad.brands || [],
            fullVersionList: uad.fullVersionList || [],
            mobile: Boolean(uad.mobile),
            model: uad.model || "",
            platform: uad.platform || "Windows",
            platformVersion: uad.platformVersion || "15.0.0",
            wow64: Boolean(uad.wow64)
          }})
        }}),
        configurable: true,
        enumerable: true
      }});
    }}
  }} catch(e) {{}}
}})();"""

    def read_stdin_thread(self, loop: asyncio.AbstractEventLoop):
        """Thread reading commands from stdin."""
        while self.running:
            try:
                line = sys.stdin.readline()
                if not line:
                    loop.call_soon_threadsafe(self.input_queue.put_nowait, "__EOF__")
                    break
                line = line.strip()
                if line:
                    loop.call_soon_threadsafe(self.input_queue.put_nowait, line)
            except (ValueError, OSError):
                break
            except Exception:
                break

    async def dump_cookies(self) -> int:
        """Extract and persist cookies."""
        if not self.browser or self.closing or self.ephemeral:
            return 0
        try:
            cookies = await self.browser.cookies.get_all()
            if self.cookies_file and cookies:
                self.cookies_file.parent.mkdir(parents=True, exist_ok=True)
                serialized = []
                for c in cookies:
                    if hasattr(c, "to_json"):
                        serialized.append(c.to_json())
                    elif isinstance(c, dict):
                        serialized.append(c)
                    else:
                        serialized.append(str(c))
                with open(self.cookies_file, "w", encoding="utf-8") as f:
                    json.dump(serialized, f, indent=2)
            emit("cookies", count=len(cookies))
            return len(cookies)
        except Exception:
            return 0

    def collect_tabs(self) -> List[Dict[str, str]]:
        """Collect current open tabs and URLs."""
        if not self.browser or self.closing:
            return []
        out = []
        try:
            for t in self.browser.tabs:
                u = getattr(t, "url", "")
                title = getattr(t, "title", "")
                tid = getattr(t, "target_id", "")
                if u and u != "about:blank":
                    out.append({"id": tid, "url": u, "title": title})
        except Exception:
            pass
        return out

    async def bring_browser_to_front(self):
        """Bring the primary browser window to the foreground cleanly without opening extra windows."""
        try:
            if self.browser and self.browser.main_tab:
                await self.browser.main_tab.bring_to_front()
        except Exception:
            pass

        if not self.headless and sys.platform == "win32":
            try:
                import ctypes
                import ctypes.wintypes as w
                u = ctypes.windll.user32
                k32 = ctypes.windll.kernel32

                browser_pids = set()
                for p in psutil.process_iter(['pid', 'name']):
                    try:
                        pname = (p.info['name'] or '').lower()
                        if 'chrome' in pname or 'msedge' in pname or 'brave' in pname:
                            browser_pids.add(p.info['pid'])
                    except Exception:
                        pass

                def enum_cb(hwnd, lParam):
                    pid = w.DWORD()
                    u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                    if pid.value in browser_pids:
                        # CRITICAL: ONLY foreground windows that are ALREADY visible and have an actual title.
                        # NEVER call ShowWindow or restore on hidden GPU/renderer/utility windows.
                        if u.IsWindowVisible(hwnd) and u.GetWindowTextLengthW(hwnd) > 0:
                            cname = ctypes.create_unicode_buffer(256)
                            u.GetClassNameW(hwnd, cname, 256)
                            if "Chrome_WidgetWin" in cname.value:
                                fore_hwnd = u.GetForegroundWindow()
                                fore_thread = u.GetWindowThreadProcessId(fore_hwnd, None) if fore_hwnd else 0
                                target_thread = u.GetWindowThreadProcessId(hwnd, None)
                                cur_thread = k32.GetCurrentThreadId()

                                if cur_thread != target_thread:
                                    u.AttachThreadInput(cur_thread, target_thread, True)
                                if fore_thread and fore_thread != target_thread:
                                    u.AttachThreadInput(fore_thread, target_thread, True)

                                u.BringWindowToTop(hwnd)
                                u.SetForegroundWindow(hwnd)

                                if fore_thread and fore_thread != target_thread:
                                    u.AttachThreadInput(fore_thread, target_thread, False)
                                if cur_thread != target_thread:
                                    u.AttachThreadInput(cur_thread, target_thread, False)
                    return True

                WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)
                u.EnumWindows(WNDENUMPROC(enum_cb), 0)
            except Exception:
                pass

    async def setup_tab(self, tab: zd.Tab, init_script: str):
        """Enable CDP Page and inject fingerprint init script."""
        try:
            await tab.send(cdp.page.enable())
            if init_script:
                await tab.send(cdp.page.add_script_to_evaluate_on_new_document(source=init_script))
        except Exception as e:
            log_err(f"Notice on setup_tab: {e}")

    async def periodic_tasks(self):
        """Periodically sync cookies and tabs."""
        while not self.closing and self.running:
            await asyncio.sleep(2.0)
            if self.closing or not self.running or not self.browser:
                break
            if getattr(self.browser, "stopped", False):
                self.on_browser_close()
                break
            try:
                await self.dump_cookies()
                tabs = self.collect_tabs()
                emit("tabs", tabs=tabs)

                # Check if all user tabs closed
                if not self.browser.tabs:
                    self.closed_by_user = True
                    self.on_browser_close()
                    break
            except Exception as e:
                err_str = str(e).lower()
                if "connection closed" in err_str or "target closed" in err_str:
                    self.on_browser_close()
                    break

    async def command_listener(self):
        """Listen for and process stdin commands from Node.js."""
        while not self.closing and self.running:
            try:
                cmd_raw = await self.input_queue.get()
                await self.handle_command(cmd_raw)
            except asyncio.CancelledError:
                break
            except Exception as e:
                log_err(f"Command listener error: {e}")

    async def handle_command(self, cmd_raw: str):
        """Handle incoming command from Node.js parent."""
        if cmd_raw == "__EOF__":
            log_err("Parent pipe closed. Shutting down worker.")
            await self.shutdown()
            os._exit(0)
            return

        try:
            cmd = json.loads(cmd_raw)
            action = cmd.get("cmd")
            if action == "close":
                self.closing = True
                self.running = False
                await self.shutdown()
                os._exit(0)
            elif action == "new_page":
                url = cmd.get("url")
                if self.browser and not self.closing:
                    target = url.strip() if url else "about:blank"
                    if target and not target.startswith(("http://", "https://", "about:")):
                        target = "https://" + target
                    try:
                        tid = await self.browser.connection.send(cdp.target.create_target(target))
                        init_script = self.generate_fingerprint_init_script()
                        if init_script:
                            nt = next((t for t in self.browser.tabs if getattr(t, "target_id", None) == tid), None)
                            if nt:
                                await self.setup_tab(nt, init_script)
                    except Exception as e:
                        log_err(f"new_page notice: {e}")
            elif action == "get_state":
                tabs = self.collect_tabs()
                cookie_count = await self.dump_cookies()
                emit("state", tabs=tabs, cookieCount=cookie_count)
        except Exception as e:
            log_err(f"Error executing command: {e}")

    def on_browser_close(self):
        """Handle browser exit."""
        if self.closing:
            return
        self.closing = True
        self.running = False
        reason = "closed by user" if self.closed_by_user else "browser window closed"
        emit("disconnected", reason=reason)
        try:
            os._exit(0)
        except Exception:
            pass

    async def shutdown(self):
        """Gracefully close browser and exit."""
        if self.closing and not self.running:
            return
        self.closing = True
        self.running = False
        try:
            if self.browser:
                try:
                    await self.dump_cookies()
                except Exception:
                    pass
                await self.browser.stop()
        except Exception as e:
            log_err(f"Notice during shutdown: {e}")
        finally:
            emit("closed", reason="closed by user" if self.closed_by_user else "normal termination")
            try:
                os._exit(0)
            except Exception:
                pass

    async def run(self):
        loop = asyncio.get_running_loop()

        def exception_handler(l, context):
            exc = context.get("exception")
            if exc and ("TargetClosedError" in str(type(exc)) or "ConnectionClosed" in str(type(exc))):
                return
            l.default_exception_handler(context)

        loop.set_exception_handler(exception_handler)

        threading.Thread(target=self.read_stdin_thread, args=(loop,), daemon=True).start()

        self.profile_dir.mkdir(parents=True, exist_ok=True)

        # Clean stale locks
        for stale in ("parent.lock", "SingletonLock", "SingletonCookie", "SingletonSocket", ".startup-incomplete"):
            sp = self.profile_dir / stale
            if sp.is_file():
                try:
                    sp.unlink()
                except Exception:
                    pass

        py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        emit("starting", id=self.session_id, profileDir=str(self.profile_dir), python=py_ver)

        config = zd.Config()
        config.user_data_dir = str(self.profile_dir)
        config.headless = self.headless

        # WebRTC Policy configuration
        if self.webrtc_policy == "proxy_only":
            config.add_argument("--force-webrtc-ip-handling-policy=disable_non_proxied_udp")
        elif self.webrtc_policy == "disabled":
            config.add_argument("--disable-webrtc")
            config.disable_webrtc = True

        # Viewport configuration
        if self.fp_spec:
            vp = self.fp_spec.get("viewport") or {}
            if vp.get("width") and vp.get("height"):
                config.add_argument(f"--window-size={int(vp['width'])},{int(vp['height'])}")
            if self.fp_spec.get("userAgent"):
                config.user_agent = self.fp_spec["userAgent"]

        # Proxy configuration
        ext_to_load: List[str] = list(self.extensions)
        if self.proxy_dict:
            host = self.proxy_dict["host"]
            port = self.proxy_dict["port"]
            scheme = self.proxy_dict["scheme"]
            user = self.proxy_dict["username"]
            pwd = self.proxy_dict["password"]

            if user and pwd:
                proxy_ext_dir = self.profile_dir / "proxy_auth_ext"
                create_proxy_auth_extension(host, port, user, pwd, scheme, proxy_ext_dir)
                ext_to_load.append(str(proxy_ext_dir))
                log_err(f"Generated authenticated proxy extension at {proxy_ext_dir}")
            else:
                config.add_argument(f"--proxy-server={scheme}://{host}:{port}")
                log_err(f"Configured direct proxy: {scheme}://{host}:{port}")

        # Extensions
        if ext_to_load:
            clean_exts = [p for p in ext_to_load if Path(p).exists()]
            if clean_exts:
                ext_arg = ",".join(clean_exts)
                config.add_argument(f"--load-extension={ext_arg}")
                config.add_argument(f"--disable-extensions-except={ext_arg}")
                log_err(f"Configured {len(clean_exts)} extension(s) in Chromium")

        t_launch_start = time.time()
        log_err(f"Launching Zendriver session {self.session_id}...")

        try:
            self.browser = await zd.start(config=config)
            log_err(f"Zendriver session started in {time.time()-t_launch_start:.2f}s")

            init_script = self.generate_fingerprint_init_script()
            main_tab = self.browser.main_tab
            if main_tab:
                await self.setup_tab(main_tab, init_script)

            # Navigate start URLs cleanly in the SAME window
            if self.start_urls:
                first_url = self.start_urls[0]
                if not first_url.startswith(("http://", "https://", "about:")):
                    first_url = "https://" + first_url

                if main_tab:
                    log_err(f"Navigating primary tab to {first_url}...")
                    try:
                        await main_tab.get(first_url)
                    except Exception as e:
                        log_err(f"Navigation notice: {e}")

                for next_url in self.start_urls[1:]:
                    if self.closing:
                        break
                    if not next_url.startswith(("http://", "https://", "about:")):
                        next_url = "https://" + next_url
                    try:
                        log_err(f"Opening additional tab: {next_url}...")
                        tid = await self.browser.connection.send(cdp.target.create_target(next_url))
                        if init_script:
                            nt = next((t for t in self.browser.tabs if getattr(t, "target_id", None) == tid), None)
                            if nt:
                                await self.setup_tab(nt, init_script)
                    except Exception as e:
                        log_err(f"Additional tab notice: {e}")

            await self.bring_browser_to_front()
            cookie_count = await self.dump_cookies()

            emit(
                "ready",
                id=self.session_id,
                seed=self.seed,
                tabs=self.collect_tabs(),
                cookieCount=cookie_count,
            )
            log_err(f"Session {self.session_id} ready in {time.time()-t_launch_start:.2f}s!")

            for ext_path in self.extensions:
                emit(
                    "extension_loaded",
                    id=self.session_id,
                    path=ext_path,
                    addonId=Path(ext_path).stem,
                    success=True,
                )

            periodic_task = asyncio.create_task(self.periodic_tasks())
            cmd_task = asyncio.create_task(self.command_listener())

            while not self.closing and self.running:
                if getattr(self.browser, "stopped", False):
                    self.on_browser_close()
                    break
                await asyncio.sleep(0.5)

            periodic_task.cancel()
            cmd_task.cancel()
            os._exit(0)

        except Exception as e:
            log_err(f"Session launch error: {e}")
            emit("error", error=str(e))
            raise


def main():
    parser = argparse.ArgumentParser(description="Zendriver Browser Worker")
    parser.add_argument("--id", required=True, help="Session ID")
    parser.add_argument("--profile-dir", required=True, help="Path to profile user data dir")
    parser.add_argument("--seed", type=int, default=None, help="Fingerprint random seed")
    parser.add_argument("--proxy", default=None, help="Proxy JSON object string")
    parser.add_argument("--pin", default=None, help="Fingerprint pin attributes JSON string")
    parser.add_argument("--url", default=None, help="Initial URL to navigate")
    parser.add_argument("--headless", action="store_true", help="Launch in headless mode")
    parser.add_argument("--timezone", default="", help="IANA timezone or auto")
    parser.add_argument("--locale", default="auto", help="Locale tag or auto")
    parser.add_argument("--cookies-file", default=None, help="Path to write cookies JSON file")
    parser.add_argument("--extensions", default=None, help="JSON list of extension paths")
    parser.add_argument("--start-urls", default=None, help="JSON list of start URLs for multi-tab")
    parser.add_argument("--webrtc-policy", default="proxy_only", help="WebRTC policy: proxy_only, disabled, or default")
    parser.add_argument("--ephemeral", action="store_true", help="Ephemeral mode: wipe profile on close")
    parser.add_argument("--fingerprint-spec", default=None, help="Exact fingerprint specification JSON string")
    parser.add_argument("--extra-prefs", default=None, help="Custom preferences JSON string")

    args = parser.parse_args()
    worker = BrowserWorker(args)

    try:
        asyncio.run(worker.run())
        os._exit(0)
    except KeyboardInterrupt:
        os._exit(0)
    except Exception:
        os._exit(1)


if __name__ == "__main__":
    main()
