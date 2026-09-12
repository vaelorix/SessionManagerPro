"""
Extension Unpacker and Manifest Inspector for SessionManagerPro.
Supports .xpi, .zip, .crx, and unpacked directory extensions.
"""
from __future__ import annotations

import base64
import io
import json
import os
import sys
import zipfile
from pathlib import Path


def read_manifest_from_zip(zf: zipfile.ZipFile) -> dict:
    for name in zf.namelist():
        if name.lower() == "manifest.json" or name.lower().endswith("/manifest.json"):
            try:
                raw = zf.read(name).decode("utf-8", errors="ignore")
                return json.loads(raw)
            except Exception:
                pass
    return {}


def extract_icon_from_zip(zf: zipfile.ZipFile, manifest: dict) -> str:
    icons = manifest.get("icons", {})
    if not isinstance(icons, dict):
        return ""
    candidates = ["48", "128", "32", "16"] + list(icons.keys())
    for size in candidates:
        if size in icons and isinstance(icons[size], str):
            icon_path = icons[size].lstrip("/")
            for member in zf.namelist():
                if member.lower() == icon_path.lower() or member.lower().endswith("/" + icon_path.lower()):
                    try:
                        data = zf.read(member)
                        ext = Path(member).suffix.lstrip(".").lower() or "png"
                        mime = "image/svg+xml" if ext == "svg" else f"image/{ext}"
                        b64 = base64.b64encode(data).decode("ascii")
                        return f"data:{mime};base64,{b64}"
                    except Exception:
                        pass
    return ""


def extract_icon_from_dir(ext_dir: Path, manifest: dict) -> str:
    icons = manifest.get("icons", {})
    if not isinstance(icons, dict):
        return ""
    candidates = ["48", "128", "32", "16"] + list(icons.keys())
    for size in candidates:
        if size in icons and isinstance(icons[size], str):
            icon_file = ext_dir / icons[size].lstrip("/")
            if icon_file.is_file():
                try:
                    data = icon_file.read_bytes()
                    ext = icon_file.suffix.lstrip(".").lower() or "png"
                    mime = "image/svg+xml" if ext == "svg" else f"image/{ext}"
                    b64 = base64.b64encode(data).decode("ascii")
                    return f"data:{mime};base64,{b64}"
                except Exception:
                    pass
    return ""


def get_zip_bytes(file_path: Path) -> bytes:
    data = file_path.read_bytes()
    # Handle Chrome CRX (Cr24 header)
    if data.startswith(b"Cr24"):
        pk_offset = data.find(b"PK\x03\x04")
        if pk_offset != -1:
            return data[pk_offset:]
    return data


def inspect_extension(file_path: Path) -> dict:
    p = Path(file_path).resolve()
    if not p.exists():
        return {"error": f"Path does not exist: {p}"}

    if p.is_dir():
        manifest_file = p / "manifest.json"
        manifest = {}
        if manifest_file.is_file():
            try:
                manifest = json.loads(manifest_file.read_text(encoding="utf-8", errors="ignore"))
            except Exception as e:
                return {"error": f"Invalid manifest.json: {e}"}
        icon = extract_icon_from_dir(p, manifest)
        return {
            "name": manifest.get("name") or p.name,
            "version": manifest.get("version") or "1.0",
            "description": manifest.get("description") or "",
            "icon": icon,
            "type": "directory",
            "path": str(p),
            "manifestVersion": manifest.get("manifest_version", 2),
        }

    # .xpi, .zip, .crx
    try:
        zip_bytes = get_zip_bytes(p)
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            manifest = read_manifest_from_zip(zf)
            icon = extract_icon_from_zip(zf, manifest)
            ext_type = p.suffix.lower().lstrip(".") or "xpi"
            return {
                "name": manifest.get("name") or p.stem,
                "version": manifest.get("version") or "1.0",
                "description": manifest.get("description") or "",
                "icon": icon,
                "type": ext_type,
                "path": str(p),
                "manifestVersion": manifest.get("manifest_version", 2),
            }
    except Exception as e:
        return {"error": f"Failed to inspect archive: {e}"}


def unpack_archive(src_path: Path, dest_dir: Path) -> dict:
    p = Path(src_path).resolve()
    dest = Path(dest_dir).resolve()
    dest.mkdir(parents=True, exist_ok=True)

    try:
        zip_bytes = get_zip_bytes(p)
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            names = zf.namelist()
            has_root_manifest = any(n.lower() == "manifest.json" for n in names)

            zf.extractall(dest)

            # If manifest was inside a subfolder, promote contents
            if not has_root_manifest:
                for sub in dest.iterdir():
                    if sub.is_dir() and (sub / "manifest.json").is_file():
                        import shutil
                        temp_dir = dest.parent / f"_temp_{dest.name}"
                        sub.rename(temp_dir)
                        shutil.rmtree(dest, ignore_errors=True)
                        temp_dir.rename(dest)
                        break

            return inspect_extension(dest)
    except Exception as e:
        return {"error": f"Failed to unpack archive: {e}"}


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: ext_tool.py <inspect|unpack> <path> [dest]"}))
        sys.exit(1)

    cmd = sys.argv[1].lower()
    target_path = Path(sys.argv[2])

    if cmd == "inspect":
        res = inspect_extension(target_path)
        print(json.dumps(res))
    elif cmd == "unpack":
        if len(sys.argv) < 4:
            print(json.dumps({"error": "unpack requires destination directory"}))
            sys.exit(1)
        dest_path = Path(sys.argv[3])
        res = unpack_archive(target_path, dest_path)
        print(json.dumps(res))
    else:
        print(json.dumps({"error": f"Unknown command: {cmd}"}))

# [ext] zip and crx
