"""
Marionette Extension Installer for Firefox / InvisiblePlaywright.
Installs webextensions (.xpi or unpacked folders) dynamically at runtime,
bypassing release signature enforcement and deprecated sideloading restrictions.
"""
from __future__ import annotations

import json
import socket
import time
from pathlib import Path
from typing import Any, Dict, List, Optional


def find_free_port(start_port: int = 2830, max_port: int = 4000) -> int:
    """Find an available TCP port for Marionette in the specified range."""
    for port in range(start_port, max_port):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(("127.0.0.1", port))
                return port
            except OSError:
                continue
    return 2828


def install_extensions_via_marionette(
    port: int,
    paths: List[str],
    max_retries: int = 35,
    retry_delay: float = 0.4,
    profile_dir: Optional[Any] = None,
) -> List[Dict[str, Any]]:
    """
    Connects to Firefox Marionette server on 127.0.0.1:port and installs
    extensions (.xpi or unpacked directories) temporarily.
    """
    if not paths:
        return []

    actual_port = port

    # If profile_dir has MarionetteActivePort file, prefer that port
    if profile_dir:
        try:
            active_file = Path(profile_dir) / "MarionetteActivePort"
            if active_file.exists():
                text = active_file.read_text().strip()
                if text.isdigit():
                    actual_port = int(text)
        except Exception:
            pass

    sock: Optional[socket.socket] = None
    connected = False

    for attempt in range(max_retries):
        if profile_dir and not connected:
            try:
                active_file = Path(profile_dir) / "MarionetteActivePort"
                if active_file.exists():
                    text = active_file.read_text().strip()
                    if text.isdigit():
                        actual_port = int(text)
            except Exception:
                pass

        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(1.5)
        try:
            s.connect(("127.0.0.1", actual_port))
            sock = s
            connected = True
            break
        except (ConnectionRefusedError, TimeoutError, OSError):
            try:
                s.close()
            except Exception:
                pass
            time.sleep(retry_delay)

    if not connected or sock is None:
        return [
            {
                "path": p,
                "addonId": None,
                "error": f"Failed to connect to Marionette on port {actual_port}",
                "success": False,
            }
            for p in paths
        ]

    try:
        sock.settimeout(20.0)

        # Drain initial Marionette handshake banner
        try:
            sock.recv(2048)
        except Exception:
            pass

        def send_cmd(msg_id: int, cmd: str, params: Optional[dict] = None) -> Optional[Any]:
            payload = [0, msg_id, cmd, params or {}]
            raw = json.dumps(payload)
            msg = f"{len(raw)}:{raw}".encode("utf-8")
            sock.sendall(msg)

            buf = b""
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                buf += chunk
                if b":" in buf:
                    prefix, rest = buf.split(b":", 1)
                    try:
                        expected_len = int(prefix.decode("utf-8"))
                        if len(rest) >= expected_len:
                            return json.loads(rest[:expected_len].decode("utf-8"))
                    except ValueError:
                        pass
            return None

        # 1. Establish Marionette session with moz:windowless so it doesn't deadlock
        # waiting for browser-delayed-startup-finished on windowless/silent startup
        session_params = {
            "capabilities": {
                "alwaysMatch": {
                    "moz:windowless": True
                }
            }
        }
        send_cmd(1, "WebDriver:NewSession", session_params)

        # 2. Install each extension
        results = []
        for idx, ext_path in enumerate(paths, start=2):
            resolved_path = str(Path(ext_path).resolve())
            try:
                res = send_cmd(idx, "Addon:Install", {"path": resolved_path, "temporary": True})
                addon_id = None
                if res and len(res) >= 4 and isinstance(res[3], dict):
                    addon_id = res[3].get("value")
                success = bool(addon_id)
                err = None if success else (str(res[2]) if res and len(res) >= 3 else "Unknown installation failure")
                results.append({"path": resolved_path, "addonId": addon_id, "error": err, "success": success})
            except Exception as ex:
                results.append({"path": resolved_path, "addonId": None, "error": str(ex), "success": False})

        return results
    finally:
        try:
            sock.close()
        except Exception:
            pass
