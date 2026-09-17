"""
InvisiblePlaywright Worker Process for SessionManagerPro.
Manages a persistent, undetected Firefox session using invisible_playwright.
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

from invisible_playwright.async_api import InvisiblePlaywright
from marionette_installer import find_free_port, install_extensions_via_marionette


def emit(event_type: str, **kwargs):
    """Emit JSON event to stdout for Node.js parent process."""
    payload = {"event": event_type, **kwargs}
    try:
        sys.stdout.write(json.dumps(payload) + "\n")
        sys.stdout.flush()
    except Exception:
        pass


def log_err(msg: str):
    """Log error message to stderr."""
    try:
        sys.stderr.write(f"[worker] {msg}\n")
        sys.stderr.flush()
    except Exception:
        pass


def extract_extension_widget_ids(extension_paths: List[str]) -> List[str]:
    """Extract browser-action widget IDs from extension .xpi / zip / directory paths to pin them to the toolbar."""
    import zipfile
    widget_ids = []
    for p_str in extension_paths:
        try:
            p = Path(p_str)
            if not p.exists():
                continue
            addon_id = ""
            if p.is_dir():
                mf = p / "manifest.json"
                if mf.is_file():
                    data = json.loads(mf.read_text(encoding="utf-8", errors="ignore"))
                    addon_id = (
                        data.get("browser_specific_settings", {}).get("gecko", {}).get("id") or
                        data.get("applications", {}).get("gecko", {}).get("id")
                    )
            elif p.is_file():
                with zipfile.ZipFile(p) as zf:
                    for name in zf.namelist():
                        if name.lower() == "manifest.json" or name.lower().endswith("/manifest.json"):
                            raw = zf.read(name).decode("utf-8", errors="ignore")
                            data = json.loads(raw)
                            addon_id = (
                                data.get("browser_specific_settings", {}).get("gecko", {}).get("id") or
                                data.get("applications", {}).get("gecko", {}).get("id")
                            )
                            break
            if not addon_id:
                addon_id = p.stem

            clean_id = re.sub(r"[@.]", "_", addon_id)
            widget_ids.append(f"{clean_id}-browser-action")
        except Exception:
            pass
    return widget_ids


def ensure_widgets_pinned_in_state(profile_dir: Path, widget_ids: List[str], extra_prefs: Dict[str, Any]):
    """Ensure all specified widget IDs are placed in placements['nav-bar'] in browser.uiCustomization.state."""
    if not widget_ids:
        return

    default_navbar = [
        "back-button", "forward-button", "stop-reload-button",
        "customizableui-special-spring1", "vertical-spacer", "urlbar-container",
        "customizableui-special-spring2", "downloads-button",
        "fxa-toolbar-menu-button", "reset-pbm-toolbar-button", "unified-extensions-button"
    ]
    state = {
        "placements": {
            "widget-overflow-fixed-list": [],
            "unified-extensions-area": [],
            "nav-bar": list(default_navbar),
            "toolbar-menubar": ["menubar-items"],
            "TabsToolbar": ["firefox-view-button", "tabbrowser-tabs", "new-tab-button", "alltabs-button"],
            "vertical-tabs": [],
            "PersonalToolbar": ["personal-bookmarks"]
        },
        "seen": ["developer-button"],
        "dirtyAreaCache": ["nav-bar", "unified-extensions-area", "TabsToolbar", "PersonalToolbar"],
        "currentVersion": 24,
        "newElementCount": 0
    }

    # Check if prefs.js or user.js already has an existing browser.uiCustomization.state
    for pref_fname in ("prefs.js", "user.js"):
        fpath = profile_dir / pref_fname
        if fpath.is_file():
            try:
                content = fpath.read_text(encoding="utf-8", errors="ignore")
                match = re.search(r'user_pref\(\s*"browser\.uiCustomization\.state"\s*,\s*"((?:\\.|[^"\\])*)"\s*\);', content)
                if match:
                    escaped = match.group(1)
                    unescaped = escaped.encode("utf-8").decode("unicode_escape").replace('\\"', '"')
                    parsed = json.loads(unescaped)
                    if isinstance(parsed, dict) and "placements" in parsed:
                        state = parsed
                        break
            except Exception:
                pass

    placements = state.setdefault("placements", {})
    navbar = placements.setdefault("nav-bar", default_navbar)
    uea = placements.setdefault("unified-extensions-area", [])
    seen = state.setdefault("seen", [])

    for wid in widget_ids:
        if wid in uea:
            uea.remove(wid)
        if wid not in navbar:
            navbar.append(wid)
        if wid not in seen:
            seen.append(wid)

    serialized = json.dumps(state)
    extra_prefs["browser.uiCustomization.state"] = serialized


class BrowserWorker:
    def __init__(self, args: argparse.Namespace):
        self.session_id = args.id
        self.profile_dir = Path(args.profile_dir).resolve()
        self.seed = int(args.seed) if args.seed is not None else None
        self.headless = args.headless
        self.initial_url = (args.url or "").strip()
        self.timezone = (args.timezone or "").strip()
        self.locale = (args.locale or "auto").strip()
        self.cookies_file = Path(args.cookies_file).resolve() if args.cookies_file else None

        # Parse start URLs
        self.start_urls: List[str] = []
        if getattr(args, "start_urls", None):
            try:
                raw_urls = json.loads(args.start_urls) if isinstance(args.start_urls, str) else args.start_urls
                if isinstance(raw_urls, list):
                    self.start_urls = [str(u).strip() for u in raw_urls if u]
            except Exception as e:
                log_err(f"Failed to parse start_urls: {e}")
        if not self.start_urls and self.initial_url:
            self.start_urls = [self.initial_url]

        self.webrtc_policy = getattr(args, "webrtc_policy", "proxy_only") or "proxy_only"
        self.ephemeral = getattr(args, "ephemeral", False)

        # Parse exact fingerprint spec
        self.fp_spec: Optional[Dict[str, Any]] = None
        if getattr(args, "fingerprint_spec", None):
            try:
                self.fp_spec = json.loads(args.fingerprint_spec) if isinstance(args.fingerprint_spec, str) else args.fingerprint_spec
            except Exception as e:
                log_err(f"Failed to parse fingerprint_spec: {e}")

        # Parse extra prefs
        self.extra_prefs_input: Dict[str, Any] = {}
        if getattr(args, "extra_prefs", None):
            try:
                p = json.loads(args.extra_prefs) if isinstance(args.extra_prefs, str) else args.extra_prefs
                if isinstance(p, dict):
                    self.extra_prefs_input = p
            except Exception as e:
                log_err(f"Failed to parse extra_prefs: {e}")

        # Parse extensions
        self.extensions: List[str] = []
        if getattr(args, "extensions", None):
            try:
                raw_ext = json.loads(args.extensions) if isinstance(args.extensions, str) else args.extensions
                if isinstance(raw_ext, list):
                    self.extensions = [str(x) for x in raw_ext if x]
            except Exception as e:
                log_err(f"Failed to parse extensions: {e}")

        # Parse proxy
        self.proxy_dict: Optional[Dict[str, str]] = None
        self.proxy_raw: Optional[Dict[str, Any]] = None
        if args.proxy:
            try:
                p = json.loads(args.proxy) if isinstance(args.proxy, str) else args.proxy
                if p and p.get("host") and p.get("port"):
                    self.proxy_raw = p
                    scheme = p.get("scheme", "http").lower()
                    if not scheme.startswith(("http", "socks")):
                        scheme = "http"
                    server = f"{scheme}://{p['host']}:{p['port']}"
                    proxy_obj = {"server": server}
                    if p.get("username"):
                        proxy_obj["username"] = str(p["username"])
                    if p.get("password"):
                        proxy_obj["password"] = str(p["password"])
                    self.proxy_dict = proxy_obj
            except Exception as e:
                log_err(f"Failed to parse proxy: {e}")

        # Parse pin
        self.pin_dict: Optional[Dict[str, Any]] = None
        if args.pin:
            try:
                self.pin_dict = json.loads(args.pin) if isinstance(args.pin, str) else args.pin
            except Exception as e:
                log_err(f"Failed to parse pin: {e}")

        self.ctx = None
        self.closing = False
        self.closed_by_user = False
        self.input_queue: asyncio.Queue[str] = asyncio.Queue()
        self.running = True

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
                if not line:  # EOF -> parent closed pipe
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
        if not self.ctx or self.closing or self.ephemeral:
            return 0
        try:
            cookies = await self.ctx.cookies()
            if self.cookies_file:
                self.cookies_file.parent.mkdir(parents=True, exist_ok=True)
                with open(self.cookies_file, "w", encoding="utf-8") as f:
                    json.dump(cookies, f, indent=2)
            emit("cookies", count=len(cookies))
            return len(cookies)
        except Exception:
            return 0

    def collect_tabs(self) -> List[str]:
        """Collect current URLs of open pages."""
        if not self.ctx or self.closing:
            return []
        try:
            return [p.url for p in self.ctx.pages if p.url and p.url != "about:blank"]
        except Exception:
            return []

    async def attach_page(self, page):
        """Track page lifecycle and navigation."""
        def on_navigated(frame):
            if frame == page.main_frame and not self.closing:
                tabs = self.collect_tabs()
                emit("tabs", tabs=tabs, currentUrl=page.url)

        page.on("framenavigated", on_navigated)

        def on_page_close():
            if not self.closing:
                tabs = self.collect_tabs()
                emit("tabs", tabs=tabs)
                # Check if all pages are closed
                if self.ctx and len(self.ctx.pages) == 0:
                    self.closed_by_user = True
                    self.closing = True
                    self.running = False
                    emit("disconnected", reason="closed by user")
                    try:
                        asyncio.get_running_loop().call_soon(lambda: os._exit(0))
                    except Exception:
                        os._exit(0)

        page.on("close", on_page_close)

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
                if self.ctx and not self.closing:
                    p = await self.ctx.new_page()
                    await self.attach_page(p)
                    if url:
                        target = url.strip()
                        if not target.startswith(("http://", "https://", "about:")):
                            target = "https://" + target
                        try:
                            await p.goto(target, wait_until="commit", timeout=20000)
                        except Exception:
                            pass
            elif action == "get_state":
                tabs = self.collect_tabs()
                cookie_count = await self.dump_cookies()
                emit("state", tabs=tabs, cookieCount=cookie_count)
        except Exception as e:
            log_err(f"Error executing command: {e}")

    def on_context_close(self):
        """Handle browser window close or disconnect."""
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

    def force_reveal_windows(self, force_bring_top: bool = True) -> List[int]:
        """On Windows in headed mode, uncloak, restore, elevate Z-order and foreground Firefox windows."""
        if self.headless or sys.platform != "win32":
            return []
        try:
            import ctypes
            import ctypes.wintypes as w
            u = ctypes.windll.user32
            d = ctypes.windll.dwmapi
            k32 = ctypes.windll.kernel32

            SW_RESTORE = 9
            SW_SHOW = 5
            DWMWA_CLOAK = 13
            DWMWA_CLOAKED = 14
            HWND_TOPMOST = -1
            HWND_NOTOPMOST = -2
            SWP_NOMOVE = 0x0002
            SWP_NOSIZE = 0x0001
            SWP_SHOWWINDOW = 0x0040

            ff_pids = set()
            for p in psutil.process_iter(['pid', 'name']):
                try:
                    if 'firefox' in (p.info['name'] or '').lower():
                        ff_pids.add(p.info['pid'])
                except Exception:
                    pass

            if not ff_pids:
                return []

            revealed = []
            def enum_cb(hwnd, lParam):
                pid = w.DWORD()
                u.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
                if pid.value in ff_pids:
                    cname = ctypes.create_unicode_buffer(256)
                    u.GetClassNameW(hwnd, cname, 256)
                    if cname.value == "MozillaWindowClass":
                        # 1. Uncloak if cloaked
                        cloaked = w.DWORD()
                        hr = d.DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, ctypes.byref(cloaked), 4)
                        if hr == 0 and cloaked.value != 0:
                            uncloak_val = ctypes.c_int(0)
                            d.DwmSetWindowAttribute(hwnd, DWMWA_CLOAK, ctypes.byref(uncloak_val), 4)
                            log_err(f"Uncloaked Firefox window (hwnd={hwnd}, DWMWA_CLOAK=0)")

                        if force_bring_top:
                            # 2. Restore and Show
                            u.ShowWindow(hwnd, SW_RESTORE)
                            u.ShowWindow(hwnd, SW_SHOW)

                            # 3. Z-order elevation in front of Edge WebView / other active windows
                            u.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)
                            u.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)

                            # 4. Attach thread input to bypass Windows Focus Stealing Prevention
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

                        revealed.append(hwnd)
                return True

            WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.c_int, ctypes.c_int)
            u.EnumWindows(WNDENUMPROC(enum_cb), 0)
            return revealed
        except Exception as ex:
            log_err(f"Notice during force_reveal_windows: {ex}")
            return []

    async def periodic_tasks(self):
        """Periodically sync cookies, tabs, and keep headed window uncloaked."""
        cycle = 0
        while not self.closing and self.running:
            await asyncio.sleep(2)
            cycle += 1
            if self.closing or not self.running:
                break
            if self.ctx and getattr(self.ctx, "is_closed", lambda: False)():
                self.on_context_close()
                break
            try:
                # In headed mode on Windows, keep window visible and uncloaked
                if not self.headless and sys.platform == "win32":
                    self.force_reveal_windows(force_bring_top=(cycle <= 3))

                await self.dump_cookies()
                tabs = self.collect_tabs()
                emit("tabs", tabs=tabs)
            except Exception as e:
                err_str = str(e).lower()
                if "pipe closed" in err_str or "target closed" in err_str or "connection closed" in err_str:
                    self.on_context_close()
                    break

    async def command_listener(self):
        """Listen for and process stdin commands."""
        while not self.closing and self.running:
            try:
                cmd_raw = await self.input_queue.get()
                await self.handle_command(cmd_raw)
            except asyncio.CancelledError:
                break
            except Exception as e:
                log_err(f"Command listener error: {e}")

    async def shutdown(self):
        """Gracefully close browser and exit."""
        if self.closing and not self.running:
            return
        self.closing = True
        self.running = False
        try:
            if self.ctx:
                try:
                    await self.dump_cookies()
                except Exception:
                    pass
                await self.ctx.close()
        except Exception as e:
            log_err(f"Error during context close: {e}")
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
            if exc and "TargetClosedError" in str(type(exc)):
                return
            l.default_exception_handler(context)

        loop.set_exception_handler(exception_handler)

        threading.Thread(target=self.read_stdin_thread, args=(loop,), daemon=True).start()

        self.profile_dir.mkdir(parents=True, exist_ok=True)

        # Clean stale locks and session markers that cause startup freezes or crash dialogs
        for stale_name in (
            "parent.lock",
            ".startup-incomplete",
            "MarionetteActivePort",
            "sessionstore.jsonlz4",
            "sessionstore-backups",
        ):
            stale_path = self.profile_dir / stale_name
            if stale_path.is_file():
                try:
                    stale_path.unlink()
                except Exception:
                    pass
            elif stale_path.is_dir():
                try:
                    import shutil
                    shutil.rmtree(stale_path, ignore_errors=True)
                except Exception:
                    pass

        # In headed mode, ensure zoom.stealth.cloak_windows is not persisted as true in prefs.js or user.js
        if not self.headless:
            for pref_fname in ("prefs.js", "user.js"):
                target_file = self.profile_dir / pref_fname
                if target_file.is_file():
                    try:
                        raw = target_file.read_text(encoding="utf-8", errors="ignore")
                        sanitized = re.sub(
                            r'user_pref\(\s*["\']zoom\.stealth\.cloak_windows["\']\s*,\s*true\s*\);',
                            'user_pref("zoom.stealth.cloak_windows", false);',
                            raw,
                            flags=re.IGNORECASE,
                        )
                        if sanitized != raw:
                            target_file.write_text(sanitized, encoding="utf-8")
                            log_err(f"Sanitized zoom.stealth.cloak_windows to false in {pref_fname}")
                    except Exception as e:
                        log_err(f"Notice: unable to sanitize {pref_fname} cloak pref: {e}")

        py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        emit("starting", id=self.session_id, profileDir=str(self.profile_dir), python=py_ver)

        launch_kwargs: Dict[str, Any] = {
            "profile_dir": self.profile_dir,
            "headless": self.headless,
            "humanize": True,
        }

        # Ensure exact fingerprint pin specs (GPU, screen, concurrency, dpr)
        if not self.pin_dict:
            self.pin_dict = {}
        if self.fp_spec:
            vp = self.fp_spec.get("viewport") or {}
            scr = self.fp_spec.get("screen") or {}
            w = scr.get("width") or vp.get("width")
            h = scr.get("height") or vp.get("height")
            if w and h:
                self.pin_dict.setdefault("screen.width", int(w))
                self.pin_dict.setdefault("screen.height", int(h))
                self.pin_dict.setdefault("screen.avail_width", int(scr.get("availWidth") or w))
                self.pin_dict.setdefault("screen.avail_height", int(scr.get("availHeight") or h))
            if vp.get("deviceScaleFactor"):
                self.pin_dict.setdefault("screen.dpr", float(vp["deviceScaleFactor"]))
            if self.fp_spec.get("hardwareConcurrency"):
                self.pin_dict.setdefault("hardware.concurrency", int(self.fp_spec["hardwareConcurrency"]))
            gl = self.fp_spec.get("webgl") or {}
            if gl.get("vendor"):
                self.pin_dict.setdefault("gpu.vendor", str(gl["vendor"]))
            if gl.get("renderer"):
                self.pin_dict.setdefault("gpu.renderer", str(gl["renderer"]))

        if self.seed is not None:
            launch_kwargs["seed"] = self.seed
        if self.proxy_dict:
            launch_kwargs["proxy"] = self.proxy_dict
        if self.pin_dict:
            launch_kwargs["pin"] = self.pin_dict
        if self.locale and self.locale != "auto":
            launch_kwargs["locale"] = self.locale

        # Timezone resolution:
        # If an explicit timezone is given, use it.
        # If behind a proxy and timezone is empty/"auto", discover egress timezone safely with fallback
        # to "UTC" so that network latency during DNS discovery never triggers GeoTimezoneError crash.
        if self.timezone and self.timezone.lower() != "auto":
            launch_kwargs["timezone"] = self.timezone
        elif self.proxy_dict:
            try:
                from invisible_core._geo import discover_egress_ip, ip_to_timezone, ensure_geoip_mmdb
                egress_ip = discover_egress_ip(self.proxy_dict)
                if egress_ip:
                    discovered_tz = ip_to_timezone(egress_ip, ensure_geoip_mmdb())
                    if discovered_tz:
                        launch_kwargs["timezone"] = discovered_tz
                        log_err(f"Auto-resolved proxy timezone: {discovered_tz}")
            except Exception as tz_err:
                log_err(f"Proxy timezone fallback ({tz_err}); defaulting to UTC")
                launch_kwargs["timezone"] = "UTC"
        elif self.timezone:
            launch_kwargs["timezone"] = self.timezone

        extra_prefs: Dict[str, Any] = {
            "browser.delayedStartup.idleDelay": 0,
            "zoom.stealth.cloak_windows": bool(self.headless),
        }
        if sys.platform == "win32":
            extra_prefs.update({
                "security.sandbox.gpu.level": 0,
                "security.sandbox.content.level": 4,
            })
        extra_args: List[str] = []

        # WebRTC leak policy handling
        if self.webrtc_policy == "disabled":
            extra_prefs["media.peerconnection.enabled"] = False
            extra_prefs["media.peerconnection.ice.proxy_only"] = True
        elif self.webrtc_policy == "proxy_only":
            extra_prefs["media.peerconnection.enabled"] = True
            extra_prefs["media.peerconnection.ice.proxy_only"] = True

        # Custom extra preferences
        if self.extra_prefs_input:
            extra_prefs.update(self.extra_prefs_input)

        # Enforce uncloaked windows in headed mode regardless of extra_prefs_input
        if not self.headless:
            extra_prefs["zoom.stealth.cloak_windows"] = False

        # Configure proxy routing and WebRTC isolation through proxy
        if self.proxy_raw and self.proxy_raw.get("host") and self.proxy_raw.get("port"):
            host = str(self.proxy_raw["host"])
            port = int(self.proxy_raw["port"])
            scheme = str(self.proxy_raw.get("scheme", "http")).lower()

            extra_prefs.update({
                "network.proxy.type": 1,
                "network.proxy.share_proxy_settings": True,
                "network.proxy.allow_bypass": False,
                "network.proxy.failover_direct": False,
                "media.peerconnection.ice.proxy_only": True,
            })
            if scheme.startswith("socks"):
                extra_prefs.update({
                    "network.proxy.socks": host,
                    "network.proxy.socks_port": port,
                    "network.proxy.socks_version": 4 if "4" in scheme else 5,
                    "network.proxy.socks_remote_dns": True,
                })
            else:
                extra_prefs.update({
                    "network.proxy.http": host,
                    "network.proxy.http_port": port,
                    "network.proxy.ssl": host,
                    "network.proxy.ssl_port": port,
                })

        mario_port: Optional[int] = None
        if self.extensions:
            mario_port = find_free_port(3100)
            extra_args.append("--marionette")
            extra_prefs.update({
                "marionette.enabled": True,
                "marionette.port": mario_port,
                "marionette.defaultPrefs.port": mario_port,
            })
            log_err(f"Configured Marionette on port {mario_port} for {len(self.extensions)} extension(s)")

            # Auto-pin loaded extensions to the Firefox navigation toolbar
            ext_widget_ids = extract_extension_widget_ids(self.extensions)
            if ext_widget_ids:
                ensure_widgets_pinned_in_state(self.profile_dir, ext_widget_ids, extra_prefs)
                log_err(f"Configured toolbar pin for {len(ext_widget_ids)} extension(s): {ext_widget_ids}")

        launch_kwargs["extra_prefs"] = extra_prefs
        launch_kwargs["extra_args"] = extra_args

        import time
        t_launch_start = time.time()
        log_err(f"Launching InvisiblePlaywright session {self.session_id}...")

        try:
            async with InvisiblePlaywright(**launch_kwargs) as ctx:
                log_err(f"InvisiblePlaywright context created in {time.time()-t_launch_start:.2f}s")
                self.ctx = ctx

                ctx.on("close", self.on_context_close)

                # Inject exact fingerprint specifications (WebGL, Screen, Hardware) into all frames
                init_script = self.generate_fingerprint_init_script()
                if init_script:
                    try:
                        await ctx.add_init_script(script=init_script)
                        log_err("Injected exact fingerprint specs (WebGL GPU, Screen, Navigator) into context")
                    except Exception as init_err:
                        log_err(f"Notice: failed to add init script: {init_err}")

                # Acquire primary page with safe timeout
                if ctx.pages:
                    first_page = ctx.pages[0]
                else:
                    log_err("Opening primary page...")
                    try:
                        first_page = await asyncio.wait_for(ctx.new_page(), timeout=45.0)
                    except asyncio.TimeoutError:
                        log_err("Primary page creation timed out, checking ctx.pages...")
                        first_page = ctx.pages[0] if ctx.pages else None

                if first_page:
                    if self.fp_spec:
                        vp = self.fp_spec.get("viewport") or {}
                        if vp.get("width") and vp.get("height"):
                            try:
                                await first_page.set_viewport_size({"width": int(vp["width"]), "height": int(vp["height"])})
                            except Exception:
                                pass
                    await self.attach_page(first_page)
                    self.force_reveal_windows(force_bring_top=True)

                ctx.on("page", lambda p: asyncio.create_task(self.attach_page(p)))

                # Install extensions dynamically via Marionette
                ext_results = []
                if self.extensions and mario_port:
                    log_err(f"Installing {len(self.extensions)} extension(s) via Marionette...")
                    try:
                        ext_results = await asyncio.to_thread(
                            install_extensions_via_marionette,
                            mario_port,
                            self.extensions,
                            35,
                            0.4,
                            self.profile_dir,
                        )
                        log_err(f"Extension installation complete: {ext_results}")
                    except Exception as ext_err:
                        log_err(f"Error during extension installation: {ext_err}")
                    self.force_reveal_windows(force_bring_top=True)

                # Normalize and navigate to start URLs (multi-tab support)
                if self.start_urls:
                    first_url = self.start_urls[0]
                    if not first_url.startswith(("http://", "https://", "about:")):
                        first_url = "https://" + first_url
                    if first_page and not self.closing:
                        try:
                            log_err(f"Navigating primary tab to {first_url}...")
                            await first_page.goto(first_url, wait_until="commit", timeout=20000)
                        except Exception as e:
                            log_err(f"Initial navigation notice: {e}")
                        self.force_reveal_windows(force_bring_top=True)

                    for next_url in self.start_urls[1:]:
                        if self.closing:
                            break
                        if not next_url.startswith(("http://", "https://", "about:")):
                            next_url = "https://" + next_url
                        try:
                            log_err(f"Opening additional tab: {next_url}...")
                            new_page = await ctx.new_page()
                            await self.attach_page(new_page)
                            await new_page.goto(next_url, wait_until="commit", timeout=20000)
                        except Exception as e:
                            log_err(f"Additional tab navigation notice: {e}")

                # Final reveal to ensure browser window is foregrounded
                self.force_reveal_windows(force_bring_top=True)

                # Rapid cookie dump now that page target is ready
                cookie_count = await self.dump_cookies()

                # Emit ready event to parent Node process
                emit(
                    "ready",
                    id=self.session_id,
                    seed=ctx.seed if hasattr(ctx, "seed") else self.seed,
                    tabs=self.collect_tabs(),
                    cookieCount=cookie_count,
                )
                log_err(f"Session {self.session_id} ready in {time.time()-t_launch_start:.2f}s!")

                # Report loaded extensions
                for res in ext_results:
                    emit(
                        "extension_loaded",
                        id=self.session_id,
                        path=res.get("path"),
                        addonId=res.get("addonId"),
                        success=res.get("success", False),
                    )

                # Start background periodic tasks and command listener
                periodic_task = asyncio.create_task(self.periodic_tasks())
                cmd_task = asyncio.create_task(self.command_listener())

                # Wait until shutdown requested or context closed
                while not self.closing and self.running:
                    if getattr(ctx, "is_closed", lambda: False)():
                        self.on_context_close()
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
    parser = argparse.ArgumentParser(description="InvisiblePlaywright Browser Worker")
    parser.add_argument("--id", required=True, help="Session ID")
    parser.add_argument("--profile-dir", required=True, help="Path to profile user data dir")
    parser.add_argument("--seed", type=int, default=None, help="Fingerprint random seed (int)")
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
    parser.add_argument("--ephemeral", action="store_true", help="Ephemeral incognito mode: wipe profile on close")
    parser.add_argument("--fingerprint-spec", default=None, help="Exact fingerprint specification JSON string")
    parser.add_argument("--extra-prefs", default=None, help="Custom user preferences JSON string")

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
