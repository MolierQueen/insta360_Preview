#!/usr/bin/env python3
"""Local read-only API for browsing an Insta360 camera from a web UI."""

from __future__ import annotations

import argparse
import http.client
import json
import logging
import mimetypes
import platform
import re
import struct
import subprocess
import socket
import tempfile
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from probe_ucd2_replay_readonly import (
    GET_FILE_LIST_FRAMES,
    GET_OPTIONS_FRAME,
    SYNC,
    build_get_file_list_frame,
    extract_frames,
    extract_paths,
    inner_request_code,
    inner_sequence,
    parse_camera_info,
    parse_response,
)


CAMERA_HOST = "192.168.42.1"
CAMERA_PORT = 6666
KEEPALIVE_FRAME = bytes.fromhex("55434432010c0512000000009173b3f3")
ALLOWED_COMMANDS = {8, 13}
OSC_PAGE_SIZE = 100
OSC_MAX_RESPONSE_BYTES = 8 * 1024 * 1024
UCD2_PAGE_SIZE = 100
UCD2_MAX_FILES = 100_000
UCD2_VERIFIED_FILE_LIMIT = len(GET_FILE_LIST_FRAMES) * UCD2_PAGE_SIZE
DATE_PATTERN = re.compile(r"_(\d{8})_(\d{6})_")
ROOT = Path(__file__).resolve().parents[1]


def ultrahdr_tool() -> Path:
    architecture = "arm64" if platform.machine().lower() in {"arm64", "aarch64"} else "x86_64"
    candidates = [
        ROOT / "tools" / "ultrahdr_app",
        ROOT / "tools" / "ultrahdr_app.exe",
        ROOT / "vendor" / "ultrahdr" / f"macos-{architecture}" / "ultrahdr_app",
        ROOT / ".build-cache" / "libultrahdr-build-arm64" / "ultrahdr_app",
        ROOT / ".build-cache" / "libultrahdr-build-x86_64" / "ultrahdr_app",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError("缺少 Ultra HDR 编码组件，请重新构建或安装最新版应用")


def apple_hdr_writer() -> Path:
    architecture = "arm64" if platform.machine().lower() in {"arm64", "aarch64"} else "x86_64"
    candidates = [
        ROOT / "tools" / "apple_adaptive_hdr_writer",
        ROOT / ".build-cache" / f"apple-hdr-writer-{architecture}",
    ]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise RuntimeError("缺少 Apple Adaptive HDR 编码组件，请重新构建最新版 Mac 应用")


def jpeg_dimensions(jpeg: bytes) -> tuple[int, int]:
    offset = 2
    sof_markers = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
    while offset + 9 <= len(jpeg) and jpeg[offset] == 0xFF:
        marker = jpeg[offset + 1]
        if marker in sof_markers:
            return int.from_bytes(jpeg[offset + 7 : offset + 9], "big"), int.from_bytes(jpeg[offset + 5 : offset + 7], "big")
        if marker in {0xDA, 0xD9}:
            break
        length = int.from_bytes(jpeg[offset + 2 : offset + 4], "big")
        if length < 2:
            break
        offset += length + 2
    raise ValueError("无法读取相框照片尺寸")


def exif_payload(jpeg: bytes) -> bytes | None:
    if not jpeg.startswith(b"\xff\xd8"):
        return None
    offset = 2
    while offset + 4 <= len(jpeg) and jpeg[offset] == 0xFF:
        marker = jpeg[offset + 1]
        if marker in {0xDA, 0xD9}:
            break
        if marker == 0x01 or 0xD0 <= marker <= 0xD7:
            offset += 2
            continue
        length = int.from_bytes(jpeg[offset + 2 : offset + 4], "big")
        end = offset + 2 + length
        if length < 2 or end > len(jpeg):
            break
        payload = jpeg[offset + 4 : end]
        if marker == 0xE1 and payload.startswith(b"Exif\x00\x00"):
            return payload
        offset = end
    return None


def gainmap_config(probe_output: str) -> str:
    keys = (
        "maxContentBoost", "minContentBoost", "gamma", "offsetSdr",
        "offsetHdr", "hdrCapacityMin", "hdrCapacityMax", "useBaseColorSpace",
    )
    values: dict[str, str] = {}
    for line in probe_output.splitlines():
        match = re.fullmatch(r"--([A-Za-z]+)\s+(.+)", line.strip())
        if match and match.group(1) in keys:
            values[match.group(1)] = match.group(2)
    missing = [key for key in keys if key not in values]
    if missing:
        raise RuntimeError("原照片不含可读取的标准 HDR 增益参数")
    return "".join(f"--{key} {values[key]}\n" for key in keys)


def media_type(path: str) -> str:
    suffix = Path(path).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".dng", ".insp"}:
        return "photo"
    if suffix in {".mp4", ".lrv", ".insv"}:
        return "video"
    return "other"


def media_mime(path: str) -> str:
    suffix = Path(path).suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".dng": "image/x-adobe-dng",
        ".insp": "image/jpeg",
        ".mp4": "video/mp4",
        ".lrv": "video/mp4",
        ".insv": "video/mp4",
    }.get(suffix, mimetypes.guess_type(path)[0] or "application/octet-stream")


def file_record(path: str) -> dict:
    name = path.rsplit("/", 1)[-1]
    match = DATE_PATTERN.search(name)
    captured_at = None
    if match:
        try:
            captured_at = datetime.strptime(
                "".join(match.groups()), "%Y%m%d%H%M%S"
            ).isoformat()
        except ValueError:
            pass
    return {
        "path": path,
        "name": name,
        "extension": Path(name).suffix.lower().lstrip("."),
        "kind": media_type(path),
        "captured_at": captured_at,
        "media_url": "/api/media?path=" + quote(path, safe=""),
        "download_url": "/api/download?path=" + quote(path, safe=""),
        "thumbnail_url": "/api/media?path=" + quote(path, safe=""),
        "is_proxy": Path(name).suffix.lower() == ".lrv",
    }


def file_records(paths: list[str]) -> list[dict]:
    known = set(paths)
    records = []
    for path in paths:
        item = file_record(path)
        if item["extension"] in {"mp4", "insv"}:
            directory, name = path.rsplit("/", 1)
            proxy_name = re.sub(r"^VID_", "LRV_", name, flags=re.IGNORECASE)
            proxy_name = re.sub(r"\.(?:mp4|insv)$", ".lrv", proxy_name, flags=re.IGNORECASE)
            proxy_path = directory + "/" + proxy_name
            if proxy_path in known:
                item["thumbnail_url"] = "/api/media?path=" + quote(proxy_path, safe="")
                item["proxy_path"] = proxy_path
        records.append(item)
    return records


def parse_directory_listing(data: bytes, directory: str) -> list[str]:
    text = data.decode("utf-8", errors="ignore")
    found: list[str] = []
    for raw in re.findall(r'''href=["']([^"']+)["']''', text, re.IGNORECASE):
        value = unquote(raw.split("?", 1)[0])
        if value.startswith("/"):
            candidate = value
            if candidate.startswith("/DCIM/"):
                candidate = "/storage_internal" + candidate
        else:
            candidate = directory.rstrip("/") + "/" + value.rsplit("/", 1)[-1]
        if media_type(candidate) != "other":
            found.append(candidate)
    found.extend(
        match.decode("utf-8")
        for match in re.findall(
            rb"/storage_internal/DCIM/[A-Za-z0-9_.\-/]+", data
        )
        if media_type(match.decode("utf-8")) != "other"
    )
    return list(dict.fromkeys(found))


def normalize_osc_file_path(entry: dict) -> str | None:
    """Return an HTTP-downloadable camera path from one OSC listFiles entry."""
    raw = entry.get("_localFileUrl") or entry.get("fileUrl")
    if not isinstance(raw, str) or not raw:
        return None
    path = unquote(urlparse(raw).path).replace("\\", "/")
    if path.startswith("/DCIM/"):
        path = "/storage_internal" + path
    if not path.startswith("/storage_internal/DCIM/") or ".." in path.split("/"):
        return None
    return path if media_type(path) != "other" else None


class CameraSession:
    def __init__(self, host: str = CAMERA_HOST, port: int = CAMERA_PORT):
        self.host = host
        self.port = port
        self._socket: socket.socket | None = None
        self._send_lock = threading.Lock()
        self._state_lock = threading.RLock()
        self._condition = threading.Condition(self._state_lock)
        self._responses: dict[int, bytes] = {}
        self._stop = threading.Event()
        self._reader: threading.Thread | None = None
        self._keepalive: threading.Thread | None = None
        self.files: list[str] = []
        self.camera_info: dict | None = None
        self.connected_at: str | None = None
        self.last_error: str | None = None
        self.list_source = "not_loaded"
        self.list_truncated = False

    @property
    def connected(self) -> bool:
        with self._state_lock:
            return self._socket is not None and not self._stop.is_set()

    def status(self) -> dict:
        with self._state_lock:
            counts = {"photo": 0, "video": 0, "other": 0}
            for path in self.files:
                counts[media_type(path)] += 1
            return {
                "connected": self.connected,
                "camera_host": self.host,
                "connected_at": self.connected_at,
                "last_error": self.last_error,
                "file_count": len(self.files),
                "counts": counts,
                "camera_info": self.camera_info,
                "read_only": True,
                "list_source": self.list_source,
                "list_truncated": self.list_truncated,
                "verified_ucd2_limit": UCD2_VERIFIED_FILE_LIMIT,
            }

    def connect(self) -> dict:
        self.disconnect()
        sock = socket.create_connection((self.host, self.port), timeout=6.0)
        sock.settimeout(1.0)
        with self._state_lock:
            self._socket = sock
            self._stop.clear()
            self._responses.clear()
            self.files = []
            self.camera_info = None
            self.last_error = None
            self.connected_at = datetime.now().astimezone().isoformat()
            self.list_source = "not_loaded"
            self.list_truncated = False
        self._reader = threading.Thread(target=self._reader_loop, daemon=True)
        self._reader.start()
        self._keepalive = threading.Thread(target=self._keepalive_loop, daemon=True)
        self._keepalive.start()
        try:
            self._send_exact(SYNC)
            self.camera_info = self._request(GET_OPTIONS_FRAME)
            self.refresh()
        except Exception:
            self.disconnect()
            raise
        return self.status()

    def disconnect(self) -> dict:
        self._stop.set()
        with self._state_lock:
            sock, self._socket = self._socket, None
            self._responses.clear()
            self.files = []
            self.camera_info = None
            self.connected_at = None
            self.list_source = "not_loaded"
            self.list_truncated = False
            self._condition.notify_all()
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            sock.close()
        return self.status()

    def refresh(self) -> list[dict]:
        if not self.connected:
            raise RuntimeError("camera is not connected")
        directory_paths = self._discover_http_directory()
        if directory_paths:
            with self._state_lock:
                self.files = directory_paths
                self.list_source = "http_directory"
                self.list_truncated = False
                return file_records(self.files)

        osc_paths = self._discover_osc_files()
        if osc_paths:
            with self._state_lock:
                self.files = osc_paths
                self.list_source = "osc_paginated"
                self.list_truncated = False
                return file_records(self.files)

        paths, dynamic_pagination = self._discover_ucd2_files()
        with self._state_lock:
            self.files = list(dict.fromkeys(paths))
            self.list_source = (
                "ucd2_paginated" if dynamic_pagination else "ucd2_fixed_pages"
            )
            self.list_truncated = (
                not dynamic_pagination and len(paths) >= UCD2_VERIFIED_FILE_LIMIT
            )
            return file_records(self.files)

    def _discover_ucd2_files(self) -> tuple[list[str], bool]:
        """Read verified pages, then continue with generated read-only pages."""
        paths: list[str] = []
        last_page_size = 0
        for frame in GET_FILE_LIST_FRAMES:
            response_data = self._request(frame, timeout=15.0, parse_info=False)
            page_paths = extract_paths(response_data)
            last_page_size = len(page_paths)
            paths.extend(page_paths)
            if last_page_size < UCD2_PAGE_SIZE:
                return paths, True

        start = len(GET_FILE_LIST_FRAMES) * UCD2_PAGE_SIZE
        inner_number = (inner_sequence(GET_FILE_LIST_FRAMES[-1]) or 29) + 1
        outer_number = (GET_FILE_LIST_FRAMES[-1][7] + 1) & 0xFF
        generated_page_accepted = False
        while start < UCD2_MAX_FILES:
            frame = build_get_file_list_frame(
                start,
                inner_sequence_number=inner_number,
                outer_sequence_number=outer_number,
            )
            try:
                response_data = self._request(frame, timeout=4.0, parse_info=False)
            except (TimeoutError, ConnectionError, RuntimeError, ValueError) as exc:
                logging.warning("UCD2 dynamic page at %d was rejected: %s", start, exc)
                return paths, False

            generated_page_accepted = True
            page_paths = extract_paths(response_data)
            paths.extend(page_paths)
            if len(page_paths) < UCD2_PAGE_SIZE:
                return paths, True
            start += UCD2_PAGE_SIZE
            inner_number = (inner_number + 1) & 0xFFFFFF
            outer_number = (outer_number + 1) & 0xFF

        return paths, generated_page_accepted

    def records(self) -> list[dict]:
        with self._state_lock:
            return file_records(self.files)

    def _discover_http_directory(self) -> list[str]:
        directory = "/storage_internal/DCIM/Camera01/"
        connection = http.client.HTTPConnection(self.host, 80, timeout=4.0)
        try:
            connection.request("GET", directory)
            response = connection.getresponse()
            if response.status != 200:
                response.read(1024)
                return []
            data = response.read(32 * 1024 * 1024 + 1)
            if len(data) > 32 * 1024 * 1024:
                raise RuntimeError("camera directory response exceeds 32 MiB")
            return parse_directory_listing(data, directory)
        except (OSError, http.client.HTTPException):
            return []
        finally:
            connection.close()

    def _discover_osc_files(self) -> list[str]:
        """Read the full SD-card index with the official OSC pagination cursor."""
        try:
            info = self._osc_json_request("GET", "/osc/info")
            api = info.get("api", []) if isinstance(info, dict) else []
            if api and "/osc/commands/execute" not in api:
                return []

            paths: list[str] = []
            seen: set[str] = set()
            start = 0
            total_entries: int | None = None
            while total_entries is None or start < total_entries:
                payload = {
                    "name": "camera.listFiles",
                    "parameters": {
                        "fileType": "all",
                        "startPosition": start,
                        "entryCount": OSC_PAGE_SIZE,
                        "maxThumbSize": None,
                    },
                }
                response = self._osc_json_request(
                    "POST", "/osc/commands/execute", payload
                )
                if response.get("state") != "done":
                    return []
                results = response.get("results")
                if not isinstance(results, dict):
                    return []
                entries = results.get("entries")
                if not isinstance(entries, list):
                    return []
                reported_total = results.get("totalEntries")
                if isinstance(reported_total, int) and reported_total >= 0:
                    total_entries = reported_total
                if not entries:
                    break

                previous_count = len(seen)
                for entry in entries:
                    if not isinstance(entry, dict):
                        continue
                    path = normalize_osc_file_path(entry)
                    if path and path not in seen:
                        seen.add(path)
                        paths.append(path)

                start += len(entries)
                if len(seen) == previous_count:
                    return []
            return paths
        except (OSError, http.client.HTTPException, ValueError, json.JSONDecodeError):
            return []

    def _osc_json_request(
        self, method: str, path: str, payload: dict | None = None
    ) -> dict:
        body = None if payload is None else json.dumps(payload).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "X-XSRF-Protected": "1",
        }
        if body is not None:
            headers["Content-Type"] = "application/json;charset=utf-8"
        connection = http.client.HTTPConnection(self.host, 80, timeout=8.0)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            data = response.read(OSC_MAX_RESPONSE_BYTES + 1)
            if response.status != 200:
                raise ValueError(f"OSC returned HTTP {response.status}")
            if len(data) > OSC_MAX_RESPONSE_BYTES:
                raise ValueError("OSC response exceeds 8 MiB")
            value = json.loads(data.decode("utf-8"))
            if not isinstance(value, dict):
                raise ValueError("OSC response is not an object")
            return value
        finally:
            connection.close()

    def assert_known_path(self, path: str) -> None:
        with self._state_lock:
            if path not in self.files:
                raise ValueError("path is not in the current camera file list")

    def _request(
        self, frame: bytes, timeout: float = 10.0, parse_info: bool = True
    ) -> dict | bytes:
        command = inner_request_code(frame)
        if command not in ALLOWED_COMMANDS:
            raise RuntimeError(f"READ-ONLY policy rejected command {command}")
        sequence = inner_sequence(frame)
        if sequence is None:
            raise ValueError("request has no inner sequence")
        with self._condition:
            self._responses.pop(sequence, None)
        self._send_exact(frame)
        deadline = time.monotonic() + timeout
        with self._condition:
            while sequence not in self._responses:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError(f"waiting for camera response {sequence}")
                if not self.connected:
                    raise ConnectionError(self.last_error or "camera disconnected")
                self._condition.wait(remaining)
            response = self._responses.pop(sequence)
        status, protobuf_data = parse_response(response)
        if status != 200:
            raise RuntimeError(f"camera returned status {status} for command {command}")
        if parse_info:
            return parse_camera_info(protobuf_data)
        return protobuf_data

    def _send_exact(self, data: bytes) -> None:
        with self._send_lock:
            sock = self._socket
            if sock is None:
                raise ConnectionError("camera is not connected")
            sock.sendall(data)

    def _reader_loop(self) -> None:
        buffer = b""
        try:
            while not self._stop.is_set():
                sock = self._socket
                if sock is None:
                    return
                try:
                    chunk = sock.recv(65536)
                except socket.timeout:
                    continue
                if not chunk:
                    raise ConnectionError("camera closed the control connection")
                buffer += chunk
                frames, buffer, _ = extract_frames(buffer)
                with self._condition:
                    for frame in frames:
                        sequence = inner_sequence(frame)
                        if frame[6] == 4 and sequence is not None:
                            self._responses[sequence] = frame
                    self._condition.notify_all()
        except Exception as exc:
            if not self._stop.is_set():
                with self._condition:
                    self.last_error = f"{type(exc).__name__}: {exc}"
                    self._stop.set()
                    self._condition.notify_all()

    def _keepalive_loop(self) -> None:
        while not self._stop.wait(2.0):
            try:
                self._send_exact(KEEPALIVE_FRAME)
            except Exception as exc:
                with self._condition:
                    self.last_error = f"{type(exc).__name__}: {exc}"
                    self._stop.set()
                    self._condition.notify_all()
                return


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "Insta360Local/0.1"

    @property
    def camera(self) -> CameraSession:
        return self.server.camera  # type: ignore[attr-defined]

    def log_message(self, format: str, *args) -> None:
        logging.info("%s - %s", self.address_string(), format % args)

    def end_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "http://localhost:3000")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.send_header("Access-Control-Expose-Headers", "Content-Range, Content-Length")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/status":
                self._json(200, self.camera.status())
            elif parsed.path == "/api/files":
                self._json(200, {"files": self.camera.records()})
            elif parsed.path in {"/api/media", "/api/download"}:
                values = parse_qs(parsed.query)
                path = values.get("path", [""])[0]
                self._proxy_file(path, download=parsed.path == "/api/download")
            else:
                self._json(404, {"error": "not found"})
        except Exception as exc:
            self._json(400, {"error": f"{type(exc).__name__}: {exc}"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/connect":
                self._json(200, self.camera.connect())
            elif parsed.path == "/api/disconnect":
                self._json(200, self.camera.disconnect())
            elif parsed.path == "/api/refresh":
                files = self.camera.refresh()
                self._json(200, {"status": self.camera.status(), "files": files})
            elif parsed.path == "/api/shutdown":
                self.camera.disconnect()
                self._json(200, {"ok": True, "message": "local app stopped"})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            elif parsed.path == "/api/hdr-frame":
                requested_format = parse_qs(parsed.query).get("format", ["universal"])[0]
                self._create_hdr_frame(requested_format)
            else:
                self._json(404, {"error": "not found"})
        except Exception as exc:
            self.camera.last_error = f"{type(exc).__name__}: {exc}"
            self._json(503, {"error": self.camera.last_error, "status": self.camera.status()})

    def _json(self, status: int, value: dict) -> None:
        data = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _create_hdr_frame(self, requested_format: str) -> None:
        if requested_format not in {"apple", "universal"}:
            raise ValueError("不支持的 HDR 输出格式")
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length < 16 or content_length > 512 * 1024 * 1024:
            raise ValueError("HDR 合成数据长度无效")
        payload = self.rfile.read(content_length)
        if len(payload) != content_length or payload[:8] != b"I360HDR1":
            raise ValueError("HDR 合成数据不完整")
        base_length, gain_length = struct.unpack(">II", payload[8:16])
        gain_start = 16 + base_length
        source_start = gain_start + gain_length
        if not base_length or not gain_length or source_start >= len(payload):
            raise ValueError("HDR 图层数据无效")
        base = payload[16:gain_start]
        gain = payload[gain_start:source_start]
        source = payload[source_start:]
        tool = ultrahdr_tool()

        with tempfile.TemporaryDirectory(prefix="insta-hdr-") as folder:
            temp = Path(folder)
            source_path = temp / "source.jpg"
            base_path = temp / "base.jpg"
            gain_path = temp / "gain.jpg"
            config_path = temp / "gainmap.cfg"
            output_path = temp / "framed-hdr.jpg"
            source_path.write_bytes(source)
            base_path.write_bytes(base)
            gain_path.write_bytes(gain)
            probe = subprocess.run(
                [str(tool), "-m", "1", "-j", str(source_path), "-P"],
                check=True, capture_output=True, text=True, timeout=30,
            )
            config_path.write_text(gainmap_config(probe.stdout), encoding="utf-8")
            command = [
                str(tool), "-m", "0", "-i", str(base_path), "-g", str(gain_path),
                "-f", str(config_path), "-z", str(output_path),
            ]
            exif = exif_payload(source)
            if exif:
                exif_path = temp / "exif.bin"
                exif_path.write_bytes(exif)
                command.extend(["-x", str(exif_path)])
            result = subprocess.run(command, capture_output=True, text=True, timeout=60)
            if result.returncode != 0 or not output_path.is_file():
                detail = (result.stderr or result.stdout).strip()
                raise RuntimeError(f"Ultra HDR 编码失败：{detail or result.returncode}")
            if requested_format == "apple":
                writer = apple_hdr_writer()
                raw_path = temp / "framed-hdr-rgbah.raw"
                apple_path = temp / "framed-hdr.heic"
                decode = subprocess.run([
                    str(tool), "-m", "1", "-j", str(output_path), "-o", "0", "-O", "4",
                    "-z", str(raw_path),
                ], capture_output=True, text=True, timeout=120)
                if decode.returncode != 0 or not raw_path.is_file():
                    raise RuntimeError(f"HDR 线性图层生成失败：{(decode.stderr or decode.stdout).strip()}")
                width, height = jpeg_dimensions(base)
                boost_match = re.search(r"^--maxContentBoost\s+([0-9.eE+-]+)", probe.stdout, re.MULTILINE)
                headroom = boost_match.group(1) if boost_match else "3.0"
                adaptive = subprocess.run([
                    str(writer), str(output_path), str(raw_path), str(width), str(height),
                    headroom, str(apple_path),
                ], capture_output=True, text=True, timeout=180)
                if adaptive.returncode != 0 or not apple_path.is_file():
                    raise RuntimeError(f"Apple HDR 编码失败：{(adaptive.stderr or adaptive.stdout).strip()}")
                output = apple_path.read_bytes()
                content_type = "image/heic"
                filename = "framed-hdr.heic"
            else:
                output = output_path.read_bytes()
                content_type = "image/jpeg"
                filename = "framed-hdr.jpg"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(output)))
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.end_headers()
        self.wfile.write(output)

    def _proxy_file(self, path: str, download: bool) -> None:
        if not self.camera.connected:
            raise RuntimeError("camera is not connected")
        self.camera.assert_known_path(path)
        headers = {}
        requested_range = self.headers.get("Range")
        if requested_range:
            headers["Range"] = requested_range
        connection = http.client.HTTPConnection(self.camera.host, 80, timeout=15.0)
        try:
            connection.request("GET", path, headers=headers)
            response = connection.getresponse()
            self.send_response(response.status, response.reason)
            self.send_header("Content-Type", media_mime(path))
            for name in ("Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified"):
                value = response.getheader(name)
                if value:
                    self.send_header(name, value)
            if download:
                filename = path.rsplit("/", 1)[-1].replace('"', "")
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.end_headers()
            while True:
                chunk = response.read(64 * 1024)
                if not chunk:
                    break
                self.wfile.write(chunk)
        finally:
            connection.close()


class CameraApiServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, handler, camera: CameraSession):
        super().__init__(address, handler)
        self.camera = camera


def main() -> int:
    parser = argparse.ArgumentParser(description="Insta360 本地只读 Web API")
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    camera = CameraSession()
    server = CameraApiServer((args.bind, args.port), ApiHandler, camera)
    logging.info("本地只读 API：http://%s:%d", args.bind, args.port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        camera.disconnect()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
