#!/usr/bin/env python3
"""Passively capture Insta360 UCD2 frames without sending socket data."""

from __future__ import annotations

import argparse
import json
import logging
import socket
import time
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAGIC = b"UCD2"
MIN_BODY_LENGTH = 8
MAX_BODY_LENGTH = 255


def extract_frames(buffer: bytes) -> tuple[list[bytes], bytes, int]:
    """Extract frames; observed byte 5 gives the length after the magic."""
    frames: list[bytes] = []
    discarded = 0
    while True:
        magic_at = buffer.find(MAGIC)
        if magic_at < 0:
            keep = min(len(buffer), len(MAGIC) - 1)
            discarded += len(buffer) - keep
            return frames, buffer[-keep:] if keep else b"", discarded
        if magic_at:
            discarded += magic_at
            buffer = buffer[magic_at:]
        if len(buffer) < 6:
            return frames, buffer, discarded
        body_length = buffer[5]
        if not MIN_BODY_LENGTH <= body_length <= MAX_BODY_LENGTH:
            discarded += 1
            buffer = buffer[1:]
            continue
        frame_length = len(MAGIC) + body_length
        if len(buffer) < frame_length:
            return frames, buffer, discarded
        frames.append(buffer[:frame_length])
        buffer = buffer[frame_length:]


def describe_frame(frame: bytes, received_after_ms: int) -> dict:
    item = {
        "received_after_ms": received_after_ms,
        "frame_length": len(frame),
        "version": frame[4],
        "body_length": frame[5],
        "raw_hex": frame.hex(),
    }
    # Names remain neutral until a client request/response pair is captured.
    if len(frame) >= 12:
        item.update(
            {
                "message_type": frame[6],
                "field_7": frame[7],
                "field_8_11_hex": frame[8:12].hex(),
                "tail_hex": frame[12:].hex(),
            }
        )
    return item


def main() -> int:
    parser = argparse.ArgumentParser(
        description="只接收、不发送：被动抓取 Insta360 6666/TCP 的 UCD2 帧"
    )
    parser.add_argument("--host", default="192.168.42.1", help="相机 IP")
    parser.add_argument("--port", default=6666, type=int, help="相机控制端口")
    parser.add_argument("--duration", default=12.0, type=float, help="抓取秒数")
    parser.add_argument("--max-frames", default=12, type=int, help="最多保存帧数")
    parser.add_argument("--output", type=Path, help="JSON 输出路径")
    args = parser.parse_args()

    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output = (args.output or ROOT / "output" / f"ucd2-passive-{stamp}.json").resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    log_path = output.with_suffix(".log")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(message)s",
        handlers=[logging.StreamHandler(), logging.FileHandler(log_path, encoding="utf-8")],
    )
    result = {
        "capture_version": 1,
        "safety": "passive receive only; zero application bytes sent",
        "host": args.host,
        "port": args.port,
        "started_at": datetime.now().astimezone().isoformat(),
        "frames": [],
        "discarded_bytes": 0,
        "remaining_buffer_hex": "",
        "error": None,
    }
    sock: socket.socket | None = None
    buffer = b""
    started = time.monotonic()
    try:
        logging.info("被动连接 %s:%d；不会发送任何应用数据", args.host, args.port)
        sock = socket.create_connection((args.host, args.port), timeout=5.0)
        sock.settimeout(1.0)
        deadline = started + args.duration
        while time.monotonic() < deadline and len(result["frames"]) < args.max_frames:
            try:
                chunk = sock.recv(4096)
            except socket.timeout:
                continue
            if not chunk:
                break
            buffer += chunk
            frames, buffer, discarded = extract_frames(buffer)
            result["discarded_bytes"] += discarded
            for frame in frames:
                item = describe_frame(
                    frame, round((time.monotonic() - started) * 1000)
                )
                result["frames"].append(item)
                logging.info(
                    "UCD2 len=%d type=%s field7=%s tail=%s",
                    item["frame_length"], item.get("message_type"),
                    item.get("field_7"), item.get("tail_hex"),
                )
                if len(result["frames"]) >= args.max_frames:
                    break
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        logging.error("抓取失败：%s", result["error"])
    finally:
        if sock is not None:
            sock.close()
        result["remaining_buffer_hex"] = buffer.hex()
        result["finished_at"] = datetime.now().astimezone().isoformat()
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        logging.info("捕获 %d 帧；JSON：%s", len(result["frames"]), output)
        logging.info("日志：%s", log_path)
    return 1 if result["error"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
