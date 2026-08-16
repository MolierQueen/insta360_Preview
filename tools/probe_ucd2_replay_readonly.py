#!/usr/bin/env python3
"""Replay two captured, read-only UCD2 requests to an Insta360 camera."""

from __future__ import annotations

import argparse
import http.client
import json
import logging
import re
import socket
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import quote


ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor" / "insta360-wifi-api"
sys.path.insert(0, str(VENDOR / "pb2"))

from google.protobuf import json_format  # noqa: E402
import get_options_pb2  # noqa: E402


MAGIC = b"UCD2"
SYNC = bytes.fromhex("11000000060000affaaffaaffaaffaaffa")

# Captured from the official iOS app.  The inner command codes are 8
# (GET_OPTIONS) and 13 (GET_FILE_LIST).  Their four-byte integrity fields are
# retained verbatim; no write command can be constructed by this probe.
GET_OPTIONS_FRAME = bytes.fromhex(
    "55434432010c040f1d000000"
    "0800020100008000000a12440f1e30596e727374759b01a101a701c601"
    "6792a60b"
)
GET_FILE_LIST_FRAMES = [
    bytes.fromhex(value)
    for value in (
        # start=0 (omitted), 100, 200, 300 and 400.  Each requests at most
        # 100 current paths from internal storage.
        "55434432010c041f130000000d00020f0000800000080218ffffffff072002e44acc07",
        "55434432010c0422150000000d00021200008000000802106418ffffffff072002bc728c37",
        "55434432010c0426160000000d0002160000800000080210c80118ffffffff07200290a8ce20",
        "55434432010c042b160000000d00021b0000800000080210ac0218ffffffff0720029d4e6596",
        "55434432010c042d160000000d00021d0000800000080210900318ffffffff07200225e6b0ca",
    )
]
GET_FILE_LIST_FRAME = GET_FILE_LIST_FRAMES[0]
ALLOWED_COMMANDS = {8, 13}


def ucd2_frame_length(buffer: bytes) -> int | None:
    if len(buffer) < 12 or not buffer.startswith(MAGIC):
        return None
    return 16 + int.from_bytes(buffer[8:12], "little")


def extract_frames(buffer: bytes) -> tuple[list[bytes], bytes, int]:
    frames: list[bytes] = []
    discarded = 0
    while True:
        at = buffer.find(MAGIC)
        if at < 0:
            keep = min(3, len(buffer))
            discarded += len(buffer) - keep
            return frames, buffer[-keep:] if keep else b"", discarded
        if at:
            discarded += at
            buffer = buffer[at:]
        length = ucd2_frame_length(buffer)
        if length is None or len(buffer) < length:
            return frames, buffer, discarded
        if length > 16 * 1024 * 1024:
            discarded += 1
            buffer = buffer[1:]
            continue
        frames.append(buffer[:length])
        buffer = buffer[length:]


def inner_request_code(frame: bytes) -> int:
    length = ucd2_frame_length(frame)
    if length != len(frame) or frame[6] != 4:
        raise ValueError("not a complete UCD2 data frame")
    payload = frame[12:-4]
    if len(payload) < 9:
        raise ValueError("UCD2 payload is too short")
    return int.from_bytes(payload[0:2], "little")


def inner_sequence(frame: bytes) -> int | None:
    payload = frame[12:-4]
    if frame[6] != 4 or len(payload) < 9:
        return None
    return int.from_bytes(payload[3:6], "little")


def send_readonly(sock: socket.socket, frame: bytes) -> None:
    command = inner_request_code(frame)
    if command not in ALLOWED_COMMANDS:
        raise RuntimeError(f"READ-ONLY policy rejected command {command}")
    sock.sendall(frame)


def receive_response(
    sock: socket.socket, expected_sequence: int, timeout: float, buffer: bytes
) -> tuple[bytes, bytes, list[dict]]:
    deadline = time.monotonic() + timeout
    observed: list[dict] = []
    while time.monotonic() < deadline:
        frames, buffer, discarded = extract_frames(buffer)
        if discarded:
            observed.append({"discarded_bytes": discarded})
        for frame in frames:
            payload = frame[12:-4]
            item = {
                "type": frame[6],
                "outer_sequence": frame[7],
                "payload_length": len(payload),
                "inner_sequence": inner_sequence(frame),
            }
            observed.append(item)
            if frame[6] == 4 and item["inner_sequence"] == expected_sequence:
                return frame, buffer, observed
        try:
            chunk = sock.recv(65536)
        except socket.timeout:
            continue
        if not chunk:
            break
        buffer += chunk
    raise TimeoutError(f"waiting for response sequence {expected_sequence}")


def parse_response(frame: bytes) -> tuple[int, bytes]:
    payload = frame[12:-4]
    if len(payload) < 9:
        raise ValueError("response payload is too short")
    return int.from_bytes(payload[:2], "little"), payload[9:]


def parse_camera_info(protobuf_data: bytes) -> dict:
    message = get_options_pb2.GetOptions()
    message.ParseFromString(protobuf_data)
    return json_format.MessageToDict(message, preserving_proto_field_name=True)


def extract_paths(protobuf_data: bytes) -> list[str]:
    matches = re.findall(
        rb"/(?:storage_internal/)?DCIM/[A-Za-z0-9_.\-/]+", protobuf_data
    )
    return list(dict.fromkeys(value.decode("utf-8") for value in matches))


def candidate_http_paths(storage_path: str) -> list[str]:
    dcim_at = storage_path.find("/DCIM/")
    dcim_path = storage_path[dcim_at:] if dcim_at >= 0 else storage_path
    return list(
        dict.fromkeys(
            quote(path, safe="/")
            for path in (dcim_path, storage_path, "/files" + dcim_path)
        )
    )


def probe_http_heads(host: str, storage_path: str) -> list[dict]:
    results = []
    for path in candidate_http_paths(storage_path):
        connection = http.client.HTTPConnection(host, 80, timeout=3.0)
        try:
            connection.request("HEAD", path)
            response = connection.getresponse()
            results.append(
                {
                    "path": path,
                    "status": response.status,
                    "reason": response.reason,
                    "content_length": response.getheader("Content-Length"),
                    "content_type": response.getheader("Content-Type"),
                    "www_authenticate": response.getheader("WWW-Authenticate"),
                }
            )
            response.read()
        except Exception as exc:
            results.append({"path": path, "error": f"{type(exc).__name__}: {exc}"})
        finally:
            connection.close()
    return results


def probe_http_ranges(host: str, storage_path: str) -> list[dict]:
    """Read at most 16 body bytes while the UCD2 control socket remains open."""
    results = []
    for path in candidate_http_paths(storage_path)[:2]:
        connection = http.client.HTTPConnection(host, 80, timeout=3.0)
        try:
            connection.request("GET", path, headers={"Range": "bytes=0-0"})
            response = connection.getresponse()
            sample = response.read(16)
            results.append(
                {
                    "path": path,
                    "status": response.status,
                    "reason": response.reason,
                    "content_length": response.getheader("Content-Length"),
                    "content_range": response.getheader("Content-Range"),
                    "accept_ranges": response.getheader("Accept-Ranges"),
                    "content_type": response.getheader("Content-Type"),
                    "sample_hex": sample.hex(),
                    "sample_length": len(sample),
                }
            )
        except Exception as exc:
            results.append({"path": path, "error": f"{type(exc).__name__}: {exc}"})
        finally:
            connection.close()
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description="只读重放 UCD2 相机信息和文件列表请求")
    parser.add_argument("--host", default="192.168.42.1")
    parser.add_argument("--port", type=int, default=6666)
    parser.add_argument("--timeout", type=float, default=15.0)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output = (args.output or ROOT / "output" / f"ucd2-replay-{stamp}.json").resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    log_path = output.with_suffix(".log")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(message)s",
        handlers=[logging.StreamHandler(), logging.FileHandler(log_path, encoding="utf-8")],
    )
    result = {
        "probe_version": 1,
        "safety": "fixed captured frames; allowed inner commands 8 and 13 only",
        "host": args.host,
        "camera_info": None,
        "files": [],
        "http_head_probes": [],
        "http_range_probes": [],
        "observed_frames": [],
        "error": None,
    }
    sock: socket.socket | None = None
    buffer = b""
    try:
        # Audit constants before opening a network connection.
        assert inner_request_code(GET_OPTIONS_FRAME) == 8
        assert all(inner_request_code(frame) == 13 for frame in GET_FILE_LIST_FRAMES)
        sock = socket.create_connection((args.host, args.port), timeout=5.0)
        sock.settimeout(1.0)
        logging.info("发送固定同步字节和只读命令 8")
        sock.sendall(SYNC)
        send_readonly(sock, GET_OPTIONS_FRAME)
        frame, buffer, seen = receive_response(sock, 1, args.timeout, buffer)
        result["observed_frames"].extend(seen)
        status, protobuf_data = parse_response(frame)
        if status != 200:
            raise RuntimeError(f"GET_OPTIONS returned status {status}")
        result["camera_info"] = parse_camera_info(protobuf_data)
        logging.info("命令 8 成功；发送固定只读命令 13")

        all_paths: list[str] = []
        for page_number, request_frame in enumerate(GET_FILE_LIST_FRAMES, start=1):
            expected_sequence = inner_sequence(request_frame)
            assert expected_sequence is not None
            send_readonly(sock, request_frame)
            frame, buffer, seen = receive_response(
                sock, expected_sequence, args.timeout, buffer
            )
            result["observed_frames"].extend(seen)
            status, protobuf_data = parse_response(frame)
            if status != 200:
                raise RuntimeError(
                    f"GET_FILE_LIST page {page_number} returned status {status}"
                )
            page_paths = extract_paths(protobuf_data)
            all_paths.extend(page_paths)
            logging.info("文件页 %d 返回 %d 个路径", page_number, len(page_paths))
        result["files"] = list(dict.fromkeys(all_paths))
        result["file_count"] = len(result["files"])
        logging.info("命令 13 成功；解析出 %d 个路径", len(result["files"]))
        if result["files"]:
            result["http_head_probes"] = probe_http_heads(
                args.host, result["files"][0]
            )
            logging.info("已完成 %d 个只读 HTTP HEAD 测试", len(result["http_head_probes"]))
            result["http_range_probes"] = probe_http_ranges(
                args.host, result["files"][0]
            )
            logging.info(
                "已完成 %d 个最多读取 16 字节的 HTTP Range 测试",
                len(result["http_range_probes"]),
            )
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        logging.error("探测失败：%s", result["error"])
    finally:
        if sock is not None:
            sock.close()
        result["finished_at"] = datetime.now().astimezone().isoformat()
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        logging.info("JSON：%s", output)
        logging.info("日志：%s", log_path)
    return 1 if result["error"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
