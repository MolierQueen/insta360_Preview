#!/usr/bin/env python3
"""Read-only compatibility probe for Insta360 cameras over Wi-Fi.

Allowed camera commands:
  8  PHONE_COMMAND_GET_OPTIONS
  13 PHONE_COMMAND_GET_FILE_LIST

The upstream proof-of-concept synchronizes the camera clock in Open().  This
wrapper explicitly disables that write and rejects every non-whitelisted
command before it reaches the socket.
"""

from __future__ import annotations

import argparse
import json
import logging
import queue
import sys
import time
from datetime import datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / "vendor" / "insta360-wifi-api"
sys.path.insert(0, str(VENDOR / "pb2"))
sys.path.insert(0, str(VENDOR))

import insta360  # noqa: E402


class ReadOnlyCamera(insta360.camera):
    """Vendor client restricted to two read-only command codes."""

    ALLOWED_COMMANDS = {
        insta360.camera.PHONE_COMMAND_GET_OPTIONS,
        insta360.camera.PHONE_COMMAND_GET_FILE_LIST,
    }

    def SyncLocalTimeToCamera(self, timestamp=None, seconds_from_GMT=None):
        self.logger.info("READ-ONLY: skipped automatic camera time synchronization")
        return None

    def SendMessage(self, message, message_code):
        if message_code not in self.ALLOWED_COMMANDS:
            raise RuntimeError(
                f"READ-ONLY safety policy rejected camera command {message_code}"
            )
        return super().SendMessage(message, message_code)


def wait_connected(camera: ReadOnlyCamera, timeout: float) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if camera.is_connected:
            return
        time.sleep(0.1)
    raise TimeoutError(
        "没有完成 6666/TCP 同步握手；请确认 Mac 已连接相机 Wi-Fi，"
        "相机地址正确，且官方 App 已关闭。"
    )


def wait_response(
    responses: "queue.Queue[dict]", message_code: int, timeout: float
) -> dict:
    deadline = time.monotonic() + timeout
    deferred: list[dict] = []
    try:
        while time.monotonic() < deadline:
            remaining = max(0.1, deadline - time.monotonic())
            try:
                response = responses.get(timeout=remaining)
            except queue.Empty:
                break
            if response.get("message_code") == message_code:
                return response
            deferred.append(response)
    finally:
        for response in deferred:
            responses.put(response)
    raise TimeoutError(f"等待相机命令 {message_code} 的响应超时")


def close_safely(camera: ReadOnlyCamera | None) -> None:
    if camera is None:
        return
    try:
        camera.Close()
    except (OSError, AttributeError):
        pass


def main() -> int:
    parser = argparse.ArgumentParser(
        description="只读探测 Insta360 相机信息和 SD 卡文件列表"
    )
    parser.add_argument("--host", default="192.168.42.1", help="相机 IP")
    parser.add_argument("--port", default=6666, type=int, help="相机控制端口")
    parser.add_argument("--timeout", default=12.0, type=float, help="每步超时秒数")
    parser.add_argument(
        "--output",
        type=Path,
        help="JSON 输出文件；默认写入 output/probe-时间.json",
    )
    args = parser.parse_args()

    output = args.output
    if output is None:
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        output = ROOT / "output" / f"probe-{stamp}.json"
    output = output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    log_path = output.with_suffix(".log")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-8s %(message)s",
        handlers=[logging.StreamHandler(), logging.FileHandler(log_path, encoding="utf-8")],
    )

    responses: "queue.Queue[dict]" = queue.Queue()
    camera: ReadOnlyCamera | None = None
    result = {
        "probe_version": 1,
        "host": args.host,
        "port": args.port,
        "started_at": datetime.now().astimezone().isoformat(),
        "read_only_commands": [8, 13],
        "camera_info": None,
        "file_list": None,
        "error": None,
    }

    try:
        camera = ReadOnlyCamera(
            host=args.host,
            port=args.port,
            callback=responses.put,
        )
        logging.info("连接相机 %s:%d", args.host, args.port)
        camera.Open()
        wait_connected(camera, args.timeout)
        logging.info("同步握手成功；开始只读查询")

        camera.GetCameraInfo()
        result["camera_info"] = wait_response(
            responses,
            camera.PHONE_COMMAND_GET_OPTIONS,
            args.timeout,
        )
        logging.info("已收到相机和存储信息")

        camera.GetCameraFilesList()
        result["file_list"] = wait_response(
            responses,
            camera.PHONE_COMMAND_GET_FILE_LIST,
            args.timeout,
        )
        logging.info("已收到文件列表")
    except Exception as exc:
        result["error"] = f"{type(exc).__name__}: {exc}"
        logging.error("探测失败：%s", result["error"])
    finally:
        close_safely(camera)
        result["finished_at"] = datetime.now().astimezone().isoformat()
        output.write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        logging.info("JSON：%s", output)
        logging.info("日志：%s", log_path)

    if result["error"]:
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
