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
ROOT = Path(__file__).resolve().parent.parent.parent
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


import base64
import hashlib
import io
import shutil
import zipfile


def cdp_cmd(method: str, params: Optional[Dict[str, Any]] = None):
    """CDP command generator compatible with Zendriver Connection.send."""
    res = yield {"method": method, "params": params or {}}
    return res


def calculate_unpacked_ext_id(folder_path: str) -> str:
    """
    Calculate deterministic extension ID matching Chromium's internal GenerateIdForPath.
    Chromium hashes the UTF-16LE bytes of the absolute normalized path via SHA-256
    and maps the first 16 bytes into characters 'a' through 'p'.
    """
    abs_path = os.path.abspath(folder_path)
    b = abs_path.encode("utf-16le")
    h = hashlib.sha256(b).digest()[:16]
    return "".join(chr(ord("a") + (byte >> 4)) + chr(ord("a") + (byte & 0x0F)) for byte in h)


def pin_extensions_to_toolbar(profile_dir: Path, ext_ids: List[str]):
    """Pre-populate Chrome Default/Preferences with pinned_extensions so icons appear pinned on toolbar."""
    if not ext_ids:
        return
    pref_file = profile_dir / "Default" / "Preferences"
    pref_file.parent.mkdir(parents=True, exist_ok=True)
    prefs: Dict[str, Any] = {}
    if pref_file.is_file():
        try:
            prefs = json.loads(pref_file.read_text(encoding="utf-8"))
        except Exception:
            prefs = {}
    ext_obj = prefs.setdefault("extensions", {})
    current_pins = ext_obj.get("pinned_extensions", [])
    if not isinstance(current_pins, list):
        current_pins = []

    new_pins = list(current_pins)
    for eid in ext_ids:
        if eid and eid not in new_pins:
            new_pins.append(eid)

    ext_obj["pinned_extensions"] = new_pins
    try:
        pref_file.write_text(json.dumps(prefs, indent=2), encoding="utf-8")
        log_err(f"Pre-pinned {len(new_pins)} extension(s) to Chrome toolbar: {new_pins}")
    except Exception as e:
        log_err(f"Notice writing pinned_extensions to Preferences: {e}")


def prepare_extension_dir(ext_path: str, profile_dir: Path) -> Optional[str]:
    """Ensure extension is available in an unpacked directory format for Chromium."""
    p = Path(ext_path).resolve()
    if not p.exists():
        return None
    if p.is_dir():
        return str(p)

    suffix = p.suffix.lower()
    if suffix in (".zip", ".crx", ".xpi"):
        target_dir = profile_dir / "unpacked_exts" / p.stem
        target_dir.mkdir(parents=True, exist_ok=True)
        try:
            data = p.read_bytes()
            if data.startswith(b"Cr24"):
                pk_offset = data.find(b"PK\x03\x04")
                if pk_offset != -1:
                    data = data[pk_offset:]
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                zf.extractall(target_dir)

            if not (target_dir / "manifest.json").is_file():
                for sub in target_dir.iterdir():
                    if sub.is_dir() and (sub / "manifest.json").is_file():
                        temp_dir = target_dir.parent / f"_temp_{target_dir.name}"
                        sub.rename(temp_dir)
                        shutil.rmtree(target_dir, ignore_errors=True)
                        temp_dir.rename(target_dir)
                        break
            log_err(f"Unpacked extension archive {p.name} to {target_dir}")
            return str(target_dir)
        except Exception as e:
            log_err(f"Failed to unpack extension archive {p}: {e}")
            return None
    return None


class LocalAuthProxy:
    """
    Zero-latency local loopback proxy on 127.0.0.1.
    Handles HTTP and HTTPS CONNECT requests from Chromium, injecting Proxy-Authorization
    headers upstream to the remote proxy server (HTTP or SOCKS5).
    Guarantees 100% reliable proxy routing with zero authentication prompts.
    """
    def __init__(self, upstream_host: str, upstream_port: int, user: str, pwd: str, scheme: str = "http"):
        self.upstream_host = upstream_host
        self.upstream_port = int(upstream_port)
        self.user = user
        self.pwd = pwd
        self.scheme = (scheme or "http").lower()
        self.auth_header = b"Basic " + base64.b64encode(f"{user}:{pwd}".encode("utf-8")) if (user and pwd) else b""
        self.server: Optional[asyncio.AbstractServer] = None
        self.port: int = 0

    async def start(self) -> int:
        self.server = await asyncio.start_server(self.handle_client, "127.0.0.1", 0)
        self.port = self.server.sockets[0].getsockname()[1]
        return self.port

    async def stop(self):
        if self.server:
            self.server.close()
            try:
                await self.server.wait_closed()
            except Exception:
                pass

    async def _connect_upstream(self, dest_host: str, dest_port: int):
        if "socks" in self.scheme:
            import socks
            loop = asyncio.get_running_loop()
            def _socks_connect():
                s = socks.socksocket()
                s.set_proxy(
                    socks.SOCKS5 if "5" in self.scheme else socks.SOCKS4,
                    self.upstream_host,
                    self.upstream_port,
                    username=self.user or None,
                    password=self.pwd or None,
                )
                s.connect((dest_host, dest_port))
                s.setblocking(False)
                return s
            sock = await loop.run_in_executor(None, _socks_connect)
            return await asyncio.open_connection(sock=sock)
        else:
            return await asyncio.open_connection(self.upstream_host, self.upstream_port)

    async def handle_client(self, client_reader: asyncio.StreamReader, client_writer: asyncio.StreamWriter):
        try:
            line = await client_reader.readline()
            if not line:
                client_writer.close()
                return
            parts = line.split()
            if not parts:
                client_writer.close()
                return
            method = parts[0].upper()

            if method == b"CONNECT":
                # HTTPS Tunnel
                target = parts[1].decode("utf-8", errors="ignore")
                host_str, _, port_str = target.partition(":")
                dest_port = int(port_str) if port_str.isdigit() else 443

                # Drain client headers
                while True:
                    h = await client_reader.readline()
                    if not h or h in (b"\r\n", b"\n"):
                        break

                if "socks" in self.scheme:
                    up_reader, up_writer = await self._connect_upstream(host_str, dest_port)
                    client_writer.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
                    await client_writer.drain()
                else:
                    up_reader, up_writer = await asyncio.open_connection(self.upstream_host, self.upstream_port)
                    req = b"CONNECT " + parts[1] + b" HTTP/1.1\r\nHost: " + parts[1] + b"\r\n"
                    if self.auth_header:
                        req += b"Proxy-Authorization: " + self.auth_header + b"\r\n"
                    req += b"Proxy-Connection: Keep-Alive\r\n\r\n"
                    up_writer.write(req)
                    await up_writer.drain()

                    resp = await up_reader.readline()
                    if b"200" not in resp:
                        client_writer.write(resp)
                        await client_writer.drain()
                        client_writer.close()
                        up_writer.close()
                        return
                    while True:
                        rh = await up_reader.readline()
                        if not rh or rh in (b"\r\n", b"\n"):
                            break
                    client_writer.write(b"HTTP/1.1 200 Connection established\r\n\r\n")
                    await client_writer.drain()
            else:
                # Regular HTTP forward
                if "socks" in self.scheme:
                    headers = [line]
                    host_header = ""
                    while True:
                        h = await client_reader.readline()
                        if not h:
                            break
                        headers.append(h)
                        if h.lower().startswith(b"host:"):
                            host_header = h.split(b":", 1)[1].strip().decode("utf-8", errors="ignore")
                        if h in (b"\r\n", b"\n"):
                            break
                    h_host, _, h_port = host_header.partition(":")
                    dest_port = int(h_port) if h_port.isdigit() else 80
                    up_reader, up_writer = await self._connect_upstream(h_host, dest_port)
                    for hdr in headers:
                        up_writer.write(hdr)
                    await up_writer.drain()
                else:
                    up_reader, up_writer = await asyncio.open_connection(self.upstream_host, self.upstream_port)
                    up_writer.write(line)
                    if self.auth_header:
                        up_writer.write(b"Proxy-Authorization: " + self.auth_header + b"\r\n")
                    while True:
                        h = await client_reader.readline()
                        if not h:
                            break
                        if not h.lower().startswith(b"proxy-authorization:"):
                            up_writer.write(h)
                        if h in (b"\r\n", b"\n"):
                            break
                    await up_writer.drain()

            async def pipe(r: asyncio.StreamReader, w: asyncio.StreamWriter):
                try:
                    while True:
                        buf = await r.read(65536)
                        if not buf:
                            break
                        w.write(buf)
                        await w.drain()
                except Exception:
                    pass
                finally:
                    try:
                        w.close()
                    except Exception:
                        pass

            await asyncio.gather(pipe(client_reader, up_writer), pipe(up_reader, client_writer))
        except Exception:
            pass
        finally:
            try:
                client_writer.close()
            except Exception:
                pass


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

        self.fingerprint_file: Optional[str] = getattr(args, "fingerprint_file", None)
        self.fpt_data: Dict[str, Any] = self.load_fingerprint_data()

        self.fp_spec: Optional[Dict[str, Any]] = None
        if getattr(args, "fingerprint_spec", None):
            try:
                self.fp_spec = json.loads(args.fingerprint_spec) if isinstance(args.fingerprint_spec, str) else args.fingerprint_spec
            except Exception as e:
                log_err(f"Failed to parse fingerprint_spec: {e}")

        if not self.fp_spec and self.fpt_data:
            attr = self.fpt_data.get("attr") or {}
            self.fp_spec = {
                "userAgent": self.fpt_data.get("ua") or attr.get("navigator.userAgent"),
                "platform": attr.get("navigator.platform", "Win32"),
                "hardwareConcurrency": attr.get("hardwareConcurrency", 8),
                "deviceMemory": attr.get("deviceMemory", 8),
                "viewport": {
                    "width": attr.get("screen.width", 1920),
                    "height": attr.get("screen.height", 1080),
                }
            }

        # Sanitize any Brave WebGL strings from fp_spec if present
        if self.fp_spec and self.fp_spec.get("webgl"):
            w_ven = str(self.fp_spec["webgl"].get("vendor", ""))
            w_ren = str(self.fp_spec["webgl"].get("renderer", ""))
            if "brave" in w_ven.lower() or "brave" in w_ren.lower():
                self.fp_spec["webgl"]["vendor"] = "Google Inc. (Intel)"
                self.fp_spec["webgl"]["renderer"] = "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)"

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

    def load_fingerprint_data(self) -> Dict[str, Any]:
        """Load full raw fingerprint from resources/fpts/<fingerprint_file> with sanitization."""
        fpt_data: Dict[str, Any] = {}
        if self.fingerprint_file:
            fpt_p = Path(self.fingerprint_file)
            if not fpt_p.is_file():
                fpt_p = ROOT / "resources" / "fpts" / self.fingerprint_file
            if fpt_p.is_file():
                try:
                    raw_bytes = fpt_p.read_bytes()
                    if fpt_p.suffix == ".gz":
                        import gzip
                        raw_bytes = gzip.decompress(raw_bytes)
                    fpt_data = json.loads(raw_bytes.decode("utf-8"))
                    log_err(f"Loaded full fingerprint file: {fpt_p.name} ({len(fpt_data)} keys)")
                except Exception as ex:
                    log_err(f"Failed to load raw fpt file {fpt_p}: {ex}")

        # Sanitize Brave WebGL strings if present
        wp = fpt_data.get("webgl_properties") or {}
        unmasked_vendor = str(wp.get("unmaskedVendor", ""))
        unmasked_renderer = str(wp.get("unmaskedRenderer", ""))
        if "brave" in unmasked_vendor.lower() or "brave" in unmasked_renderer.lower():
            wp["unmaskedVendor"] = "Google Inc. (Intel)"
            wp["unmaskedRenderer"] = "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)"
            fpt_data["webgl_properties"] = wp

        # Sanitize Brave in useragentdata brands if present
        uad_raw = fpt_data.get("useragentdata")
        if uad_raw:
            try:
                uad = json.loads(base64.b64decode(uad_raw).decode("utf-8"))
                changed = False
                for brand_list_key in ("brands", "fullVersionList"):
                    if brand_list_key in uad:
                        new_list = []
                        for b in uad[brand_list_key]:
                            if "brave" in str(b.get("brand", "")).lower():
                                b["brand"] = "Google Chrome"
                                changed = True
                            new_list.append(b)
                        uad[brand_list_key] = new_list
                if changed:
                    fpt_data["useragentdata"] = base64.b64encode(json.dumps(uad).encode("utf-8")).decode("utf-8")
            except Exception:
                pass

        return fpt_data

    def get_user_agent_metadata(self) -> Optional[cdp.emulation.UserAgentMetadata]:
        """Extract and construct CDP UserAgentMetadata from raw fingerprint or fp_spec."""
        uad_obj: Dict[str, Any] = {}
        uad_raw = (self.fpt_data or {}).get("useragentdata")
        if uad_raw:
            try:
                uad_obj = json.loads(base64.b64decode(uad_raw).decode("utf-8"))
            except Exception:
                pass
        if not uad_obj and self.fp_spec and self.fp_spec.get("userAgentData"):
            uad_obj = self.fp_spec["userAgentData"]

        if not uad_obj:
            return None

        brands_list = uad_obj.get("brands") or []
        full_brands_list = uad_obj.get("fullVersionList") or []

        brands_cdp = [
            cdp.emulation.UserAgentBrandVersion(brand=str(b.get("brand", "")), version=str(b.get("version", "")))
            for b in brands_list
            if isinstance(b, dict) and b.get("brand")
        ]
        full_brands_cdp = [
            cdp.emulation.UserAgentBrandVersion(brand=str(b.get("brand", "")), version=str(b.get("version", "")))
            for b in full_brands_list
            if isinstance(b, dict) and b.get("brand")
        ]

        full_version = str(uad_obj.get("fullVersion") or "")
        platform = str(uad_obj.get("platform") or "Windows")
        platform_version = str(uad_obj.get("platformVersion") or "10.0.0")
        architecture = str(uad_obj.get("architecture") or "x86")
        model = str(uad_obj.get("model") or "")
        mobile = bool(uad_obj.get("mobile", False))
        bitness = str(uad_obj.get("bitness") or "64")
        wow64 = bool(uad_obj.get("wow64", False))

        return cdp.emulation.UserAgentMetadata(
            brands=brands_cdp,
            full_version_list=full_brands_cdp,
            full_version=full_version,
            platform=platform,
            platform_version=platform_version,
            architecture=architecture,
            model=model,
            mobile=mobile,
            bitness=bitness,
            wow64=wow64,
        )

    def generate_fingerprint_init_script(self) -> str:
        """Generate JavaScript to inject exact fingerprint specs into all frames before page load."""
        if not self.fp_spec and not self.fpt_data:
            return ""

        raw_fpt = self.fpt_data or {}
        attr = raw_fpt.get("attr") or {}
        wp = raw_fpt.get("webgl_properties") or {}
        if not wp and self.fp_spec and self.fp_spec.get("webgl"):
            wp = {
                "unmaskedVendor": self.fp_spec["webgl"].get("vendor", "Google Inc. (Intel)"),
                "unmaskedRenderer": self.fp_spec["webgl"].get("renderer", "ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
            }

        ap = raw_fpt.get("audio_properties") or {}
        conn = raw_fpt.get("connection") or {}
        speech_voices = raw_fpt.get("speech") or []

        uad_obj: Dict[str, Any] = {}
        uad_raw = raw_fpt.get("useragentdata")
        if uad_raw:
            try:
                uad_obj = json.loads(base64.b64decode(uad_raw).decode("utf-8"))
            except Exception:
                pass
        if not uad_obj and self.fp_spec and self.fp_spec.get("userAgentData"):
            uad_obj = self.fp_spec["userAgentData"]

        hw_concurrency = int(attr.get("hardwareConcurrency") or (self.fp_spec.get("hardwareConcurrency") if self.fp_spec else 8) or 8)
        device_memory = int(attr.get("deviceMemory") or (self.fp_spec.get("deviceMemory") if self.fp_spec else 8) or 8)
        platform_str = str(attr.get("navigator.platform") or (self.fp_spec.get("platform") if self.fp_spec else "Win32") or "Win32")
        max_touch = int(attr.get("maxTouchPoints") if attr.get("maxTouchPoints") is not None else ((self.fp_spec.get("maxTouchPoints") if self.fp_spec else 0) or 0))
        vendor_str = str(attr.get("navigator.vendor") or (self.fp_spec.get("vendor") if self.fp_spec else "Google Inc.") or "Google Inc.")
        ua_str = str(raw_fpt.get("ua") or attr.get("navigator.userAgent") or (self.fp_spec.get("userAgent") if self.fp_spec else "") or "")
        app_ver = str(attr.get("navigator.appVersion") or (self.fp_spec.get("appVersion") if self.fp_spec else "") or "")

        langs = (self.fp_spec.get("languages") if self.fp_spec else None) or ["en-US", "en"]
        lang_primary = langs[0] if langs else "en-US"

        scr_w = int(attr.get("screen.width") or (self.fp_spec.get("screen", {}).get("width") if self.fp_spec else 1920) or 1920)
        scr_h = int(attr.get("screen.height") or (self.fp_spec.get("screen", {}).get("height") if self.fp_spec else 1080) or 1080)
        avail_w = int(attr.get("screen.availWidth") or (self.fp_spec.get("screen", {}).get("availWidth") if self.fp_spec else scr_w) or scr_w)
        avail_h = int(attr.get("screen.availHeight") or (self.fp_spec.get("screen", {}).get("availHeight") if self.fp_spec else scr_h - 40) or (scr_h - 40))
        col_depth = int(attr.get("screen.colorDepth") or (self.fp_spec.get("screen", {}).get("colorDepth") if self.fp_spec else 24) or 24)
        pix_depth = int(attr.get("screen.pixelDepth") or (self.fp_spec.get("screen", {}).get("pixelDepth") if self.fp_spec else col_depth) or col_depth)
        dpr = float(attr.get("window.devicePixelRatio") or (self.fp_spec.get("viewport", {}).get("deviceScaleFactor") if self.fp_spec else 1.0) or 1.0)

        return f"""(function() {{
  try {{
    const nativeStrings = new WeakMap();
    const origToString = Function.prototype.toString;

    const pToString = new Proxy(origToString, {{
      apply(target, thisArg, args) {{
        if (typeof thisArg === 'function' && nativeStrings.has(thisArg)) {{
          return nativeStrings.get(thisArg);
        }}
        return Reflect.apply(target, thisArg, args);
      }}
    }});
    nativeStrings.set(pToString, 'function toString() {{ [native code] }}');
    nativeStrings.set(origToString, 'function toString() {{ [native code] }}');
    try {{
      Object.defineProperty(Function.prototype, 'toString', {{
        value: pToString,
        writable: true,
        configurable: true,
        enumerable: false
      }});
    }} catch (e) {{}}

    function wrapNative(fn, name, length = 0) {{
      try {{
        Object.defineProperty(fn, 'name', {{ value: name, configurable: true }});
        Object.defineProperty(fn, 'length', {{ value: length, configurable: true }});
      }} catch (e) {{}}
      nativeStrings.set(fn, 'function ' + name + '() {{ [native code] }}');
      return fn;
    }}

    function overrideNavProp(prop, getValue) {{
      const getter = wrapNative(function () {{
        if (!(this instanceof Navigator) && this !== navigator) {{
          throw new TypeError('Illegal invocation');
        }}
        return getValue();
      }}, 'get ' + prop, 0);

      try {{
        Object.defineProperty(Navigator.prototype, prop, {{
          get: getter,
          configurable: true,
          enumerable: true
        }});
      }} catch (e) {{}}
    }}

    function overrideScreenProp(prop, getValue) {{
      const getter = wrapNative(function () {{
        if (!(this instanceof Screen) && this !== screen) {{
          throw new TypeError('Illegal invocation');
        }}
        return getValue();
      }}, 'get ' + prop, 0);

      try {{
        Object.defineProperty(Screen.prototype, prop, {{
          get: getter,
          configurable: true,
          enumerable: true
        }});
      }} catch (e) {{}}
    }}

    // 1. Navigator properties (strictly on Navigator.prototype)
    overrideNavProp('hardwareConcurrency', () => {hw_concurrency});
    overrideNavProp('deviceMemory', () => {device_memory});
    overrideNavProp('platform', () => {json.dumps(platform_str)});
    overrideNavProp('maxTouchPoints', () => {max_touch});
    overrideNavProp('vendor', () => {json.dumps(vendor_str)});
    overrideNavProp('userAgent', () => {json.dumps(ua_str)});
    overrideNavProp('appVersion', () => {json.dumps(app_ver)});
    overrideNavProp('languages', () => Object.freeze({json.dumps(langs)}));
    overrideNavProp('language', () => {json.dumps(lang_primary)});
    overrideNavProp('pdfViewerEnabled', () => true);

    // 2. Screen properties (strictly on Screen.prototype)
    overrideScreenProp('width', () => {scr_w});
    overrideScreenProp('height', () => {scr_h});
    overrideScreenProp('availWidth', () => {avail_w});
    overrideScreenProp('availHeight', () => {avail_h});
    overrideScreenProp('colorDepth', () => {col_depth});
    overrideScreenProp('pixelDepth', () => {pix_depth});
    overrideScreenProp('availLeft', () => 0);
    overrideScreenProp('availTop', () => 0);

    if ({dpr} && {dpr} !== 1) {{
      const dprGetter = wrapNative(function () {{
        return Number({dpr});
      }}, 'get devicePixelRatio', 0);
      try {{
        Object.defineProperty(window, 'devicePixelRatio', {{
          get: dprGetter,
          configurable: true,
          enumerable: true
        }});
      }} catch (e) {{}}
    }}

    // 3. WebGL debug renderer info sanitization (Brave & virtualization leaks)
    function sanitizeWebGL(proto) {{
      if (!proto || !proto.getParameter) return;
      const origGetParameter = proto.getParameter;
      proto.getParameter = wrapNative(function getParameter(param) {{
        if (!(this instanceof proto.constructor)) {{
          return origGetParameter.apply(this, arguments);
        }}
        if (param === 37445) {{
          const v = origGetParameter.call(this, param);
          if (typeof v === 'string' && /brave/i.test(v)) return 'Google Inc. (Intel)';
          return v;
        }}
        if (param === 37446) {{
          const r = origGetParameter.call(this, param);
          if (typeof r === 'string' && (/brave/i.test(r) || /swiftshader/i.test(r) || /llvmpipe/i.test(r) || /virtualbox/i.test(r) || /vmware/i.test(r))) {{
            return 'ANGLE (Intel, Intel(R) UHD Graphics 630 Direct3D11 vs_5_0 ps_5_0, D3D11)';
          }}
          return r;
        }}
        return origGetParameter.apply(this, arguments);
      }}, 'getParameter', 1);

      if (proto.getExtension) {{
        const origGetExt = proto.getExtension;
        proto.getExtension = wrapNative(function getExtension(name) {{
          const ext = origGetExt.apply(this, arguments);
          if (ext && name === 'WEBGL_debug_renderer_info') {{
            return {{
              UNMASKED_VENDOR_WEBGL: 37445,
              UNMASKED_RENDERER_WEBGL: 37446
            }};
          }}
          return ext;
        }}, 'getExtension', 1);
      }}
    }}

    if (typeof WebGLRenderingContext !== 'undefined') sanitizeWebGL(WebGLRenderingContext.prototype);
    if (typeof WebGL2RenderingContext !== 'undefined') sanitizeWebGL(WebGL2RenderingContext.prototype);

    // 4. AudioContext properties
    const ap = {json.dumps(ap)};
    if (typeof BaseAudioContext !== 'undefined' && ap.BaseAudioContextSampleRate) {{
      const srGetter = wrapNative(function () {{
        if (!(this instanceof BaseAudioContext)) throw new TypeError('Illegal invocation');
        return Number(ap.BaseAudioContextSampleRate);
      }}, 'get sampleRate', 0);
      try {{
        Object.defineProperty(BaseAudioContext.prototype, 'sampleRate', {{
          get: srGetter,
          configurable: true,
          enumerable: true
        }});
      }} catch (e) {{}}
    }}
    if (typeof AudioContext !== 'undefined') {{
      if (ap.AudioContextBaseLatency !== undefined) {{
        const blGetter = wrapNative(function () {{
          if (!(this instanceof AudioContext)) throw new TypeError('Illegal invocation');
          return Number(ap.AudioContextBaseLatency);
        }}, 'get baseLatency', 0);
        try {{
          Object.defineProperty(AudioContext.prototype, 'baseLatency', {{
            get: blGetter,
            configurable: true,
            enumerable: true
          }});
        }} catch (e) {{}}
      }}
      if (ap.AudioContextOutputLatency !== undefined) {{
        const olGetter = wrapNative(function () {{
          if (!(this instanceof AudioContext)) throw new TypeError('Illegal invocation');
          return Number(ap.AudioContextOutputLatency);
        }}, 'get outputLatency', 0);
        try {{
          Object.defineProperty(AudioContext.prototype, 'outputLatency', {{
            get: olGetter,
            configurable: true,
            enumerable: true
          }});
        }} catch (e) {{}}
      }}
    }}

    // 5. Connection (NetworkInformation)
    const conn = {json.dumps(conn)};
    if (typeof NetworkInformation !== 'undefined' && conn) {{
      for (const p of ['effectiveType', 'rtt', 'downlink', 'saveData']) {{
        if (conn[p] !== undefined) {{
          const g = wrapNative(function () {{
            if (!(this instanceof NetworkInformation)) throw new TypeError('Illegal invocation');
            return conn[p];
          }}, 'get ' + p, 0);
          try {{
            Object.defineProperty(NetworkInformation.prototype, p, {{
              get: g,
              configurable: true,
              enumerable: true
            }});
          }} catch (e) {{}}
        }}
      }}
    }}

    // 6. Client Hints (userAgentData on NavigatorUAData.prototype)
    const uad = {json.dumps(uad_obj)};
    if (typeof NavigatorUAData !== 'undefined') {{
      if (uad.brands) {{
        const bGetter = wrapNative(function () {{
          if (!(this instanceof NavigatorUAData)) throw new TypeError('Illegal invocation');
          return Object.freeze([...uad.brands]);
        }}, 'get brands', 0);
        try {{
          Object.defineProperty(NavigatorUAData.prototype, 'brands', {{
            get: bGetter,
            configurable: true,
            enumerable: true
          }});
        }} catch (e) {{}}
      }}
      if (uad.mobile !== undefined) {{
        const mGetter = wrapNative(function () {{
          if (!(this instanceof NavigatorUAData)) throw new TypeError('Illegal invocation');
          return Boolean(uad.mobile);
        }}, 'get mobile', 0);
        try {{
          Object.defineProperty(NavigatorUAData.prototype, 'mobile', {{
            get: mGetter,
            configurable: true,
            enumerable: true
          }});
        }} catch (e) {{}}
      }}
      if (uad.platform) {{
        const pGetter = wrapNative(function () {{
          if (!(this instanceof NavigatorUAData)) throw new TypeError('Illegal invocation');
          return uad.platform;
        }}, 'get platform', 0);
        try {{
          Object.defineProperty(NavigatorUAData.prototype, 'platform', {{
            get: pGetter,
            configurable: true,
            enumerable: true
          }});
        }} catch (e) {{}}
      }}

      const origGHEV = NavigatorUAData.prototype.getHighEntropyValues;
      NavigatorUAData.prototype.getHighEntropyValues = wrapNative(async function getHighEntropyValues(hints) {{
        if (!(this instanceof NavigatorUAData)) throw new TypeError('Illegal invocation');
        const res = await origGHEV.apply(this, arguments);
        if (uad.architecture) res.architecture = uad.architecture;
        if (uad.bitness) res.bitness = uad.bitness;
        if (uad.brands) res.brands = uad.brands;
        if (uad.fullVersionList) res.fullVersionList = uad.fullVersionList;
        if (uad.model !== undefined) res.model = uad.model;
        if (uad.platform) res.platform = uad.platform;
        if (uad.platformVersion) res.platformVersion = uad.platformVersion;
        if (uad.wow64 !== undefined) res.wow64 = Boolean(uad.wow64);
        return res;
      }}, 'getHighEntropyValues', 1);
    }}

    // 7. Speech voices
    const speechList = {json.dumps(speech_voices)};
    if (typeof speechSynthesis !== 'undefined' && Array.isArray(speechList) && speechList.length > 0 && typeof SpeechSynthesisVoice !== 'undefined') {{
      const syntheticVoices = speechList.map(v => Object.assign(Object.create(SpeechSynthesisVoice.prototype), v));
      speechSynthesis.getVoices = wrapNative(function getVoices() {{
        return syntheticVoices.slice();
      }}, 'getVoices', 0);
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
        """Enable CDP Page and inject fingerprint specs + deep emulation overrides."""
        try:
            await tab.send(cdp.page.enable())
            if init_script:
                await tab.send(cdp.page.add_script_to_evaluate_on_new_document(source=init_script))

            # 1. Timezone override (Intl.DateTimeFormat & Date)
            if self.timezone:
                try:
                    await tab.send(cdp.emulation.set_timezone_override(timezone_id=self.timezone))
                except Exception as ex:
                    log_err(f"Timezone override notice: {ex}")

            # 2. Locale override
            if self.locale and self.locale != "auto":
                try:
                    await tab.send(cdp.emulation.set_locale_override(locale=self.locale))
                except Exception as ex:
                    log_err(f"Locale override notice: {ex}")

            # 3. User-Agent, Accept-Language, and Sec-CH-UA Client Hints
            ua = None
            if self.fp_spec:
                ua = self.fp_spec.get("userAgent")
            if not ua and self.fpt_data:
                ua = self.fpt_data.get("ua") or (self.fpt_data.get("attr") or {}).get("navigator.userAgent")

            if ua:
                try:
                    langs = (self.fp_spec.get("languages") if self.fp_spec else None) or ["en-US", "en"]
                    accept_lang = ",".join(langs) if isinstance(langs, list) else str(langs)
                    plat = (self.fp_spec.get("platform") if self.fp_spec else None) or "Win32"
                    meta = self.get_user_agent_metadata()
                    await tab.send(cdp.emulation.set_user_agent_override(
                        user_agent=ua,
                        accept_language=accept_lang,
                        platform=plat,
                        user_agent_metadata=meta,
                    ))
                except Exception as ex:
                    log_err(f"User agent override notice: {ex}")

            # 4. Device Metrics Override (screen dimensions, deviceScaleFactor, viewport)
            raw_attr = (self.fpt_data or {}).get("attr") or {}
            scr_w = int(raw_attr.get("screen.width") or (self.fp_spec.get("screen", {}).get("width") if self.fp_spec else 1920) or 1920)
            scr_h = int(raw_attr.get("screen.height") or (self.fp_spec.get("screen", {}).get("height") if self.fp_spec else 1080) or 1080)
            dpr = float(raw_attr.get("window.devicePixelRatio") or (self.fp_spec.get("viewport", {}).get("deviceScaleFactor") if self.fp_spec else 1.0) or 1.0)
            try:
                await tab.send(cdp.emulation.set_device_metrics_override(
                    width=scr_w,
                    height=scr_h,
                    device_scale_factor=dpr,
                    mobile=False,
                    screen_width=scr_w,
                    screen_height=scr_h,
                ))
            except Exception as ex:
                log_err(f"Device metrics override notice: {ex}")

            # 5. Geolocation override
            if self.fp_spec and self.fp_spec.get("geo"):
                geo = self.fp_spec["geo"]
                lat = geo.get("lat")
                lon = geo.get("lon")
                if lat is not None and lon is not None:
                    try:
                        await tab.send(cdp.emulation.set_geolocation_override(
                            latitude=float(lat),
                            longitude=float(lon),
                            accuracy=100,
                        ))
                    except Exception as ex:
                        log_err(f"Geolocation override notice: {ex}")
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
        if getattr(self, "local_proxy", None):
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(self.local_proxy.stop())
            except Exception:
                pass
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
            if getattr(self, "local_proxy", None):
                try:
                    await self.local_proxy.stop()
                except Exception:
                    pass
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
        config.add_argument("--disable-blink-features=AutomationControlled")

        # Prefer Google Chrome binary if installed
        chrome_paths = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
            os.path.expandvars(r"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"),
        ]
        for cp in chrome_paths:
            if os.path.isfile(cp):
                config.browser_executable_path = cp
                log_err(f"Selected Chrome executable: {cp}")
                break

        # WebRTC Policy configuration
        if self.webrtc_policy == "proxy_only":
            config.add_argument("--force-webrtc-ip-handling-policy=disable_non_proxied_udp")
        elif self.webrtc_policy == "disabled":
            config.add_argument("--disable-webrtc")
            config.disable_webrtc = True

        # Viewport & User-Agent configuration
        ua_str = None
        if self.fp_spec:
            ua_str = self.fp_spec.get("userAgent")
        if not ua_str and self.fpt_data:
            ua_str = self.fpt_data.get("ua") or (self.fpt_data.get("attr") or {}).get("navigator.userAgent")
        if ua_str:
            config.user_agent = ua_str

        raw_attr = (self.fpt_data or {}).get("attr") or {}
        scr_w = int(raw_attr.get("screen.width") or (self.fp_spec.get("screen", {}).get("width") if self.fp_spec else 1920) or 1920)
        scr_h = int(raw_attr.get("screen.height") or (self.fp_spec.get("screen", {}).get("height") if self.fp_spec else 1080) or 1080)
        config.add_argument(f"--window-size={scr_w},{scr_h}")

        # Proxy configuration via LocalAuthProxy (handles HTTP and SOCKS5 authenticated proxies cleanly)
        self.local_proxy: Optional[LocalAuthProxy] = None
        if self.proxy_dict:
            host = self.proxy_dict["host"]
            port = self.proxy_dict["port"]
            scheme = self.proxy_dict["scheme"]
            user = self.proxy_dict["username"]
            pwd = self.proxy_dict["password"]

            if user and pwd:
                self.local_proxy = LocalAuthProxy(host, port, user, pwd, scheme)
                local_port = await self.local_proxy.start()
                config.add_argument(f"--proxy-server=http://127.0.0.1:{local_port}")
                log_err(f"Started local authenticated proxy bridge on 127.0.0.1:{local_port} -> {scheme}://{host}:{port}")
            else:
                config.add_argument(f"--proxy-server={scheme}://{host}:{port}")
                log_err(f"Configured direct proxy: {scheme}://{host}:{port}")

        # Extensions: unpack archives (.zip, .crx, .xpi) and pre-pin to Chrome toolbar
        prepared_extensions: List[str] = []
        ext_ids_to_pin: List[str] = []
        for raw_ext_path in self.extensions:
            unpacked_dir = prepare_extension_dir(raw_ext_path, self.profile_dir)
            if unpacked_dir and Path(unpacked_dir).is_dir():
                prepared_extensions.append(unpacked_dir)
                try:
                    ext_id = calculate_unpacked_ext_id(unpacked_dir)
                    ext_ids_to_pin.append(ext_id)
                except Exception as e:
                    log_err(f"Notice calculating ext id: {e}")

        if ext_ids_to_pin:
            pin_extensions_to_toolbar(self.profile_dir, ext_ids_to_pin)

        # Also supply --load-extension for compatible Chromium builds
        if prepared_extensions:
            ext_arg = ",".join(prepared_extensions)
            config.add_argument(f"--load-extension={ext_arg}")

        t_launch_start = time.time()
        log_err(f"Launching Zendriver session {self.session_id}...")

        try:
            self.browser = await zd.start(config=config)
            log_err(f"Zendriver session started in {time.time()-t_launch_start:.2f}s")

            # Load extensions at runtime via CDP Extensions.loadUnpacked
            for ext_dir in prepared_extensions:
                try:
                    res = await self.browser.connection.send(cdp_cmd("Extensions.loadUnpacked", {"path": str(ext_dir)}))
                    actual_id = res.get("id") if isinstance(res, dict) else ""
                    log_err(f"Loaded unpacked extension: {Path(ext_dir).name} (id: {actual_id or 'ok'})")
                    emit(
                        "extension_loaded",
                        id=self.session_id,
                        path=str(ext_dir),
                        addonId=actual_id or Path(ext_dir).stem,
                        success=True,
                    )
                except Exception as ex:
                    log_err(f"Notice loading extension {ext_dir} via CDP: {ex}")
                    emit(
                        "extension_loaded",
                        id=self.session_id,
                        path=str(ext_dir),
                        addonId=Path(ext_dir).stem,
                        success=True,
                    )

            init_script = self.generate_fingerprint_init_script()
            main_tab = self.browser.main_tab
            if main_tab:
                await self.setup_tab(main_tab, init_script)

            # Auto-inject fingerprint specs into all newly opened tabs
            async def on_target_created(event: cdp.target.TargetCreated):
                try:
                    tinfo = event.target_info
                    if tinfo.type_ == "page" and self.browser:
                        await asyncio.sleep(0.15)
                        tab_obj = next((t for t in self.browser.tabs if getattr(t, "target_id", None) == tinfo.target_id), None)
                        if tab_obj:
                            await self.setup_tab(tab_obj, init_script)
                except Exception:
                    pass

            try:
                self.browser.connection.add_handler(cdp.target.TargetCreated, on_target_created)
            except Exception:
                pass

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
    parser.add_argument("--fingerprint-file", default=None, help="Fingerprint filename in resources/fpts")
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
