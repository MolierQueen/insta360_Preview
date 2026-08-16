#!/usr/bin/env python3
"""Launch the local Insta360 API and web UI together."""

from __future__ import annotations

import argparse
import signal
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def wait_for_port(port: int, processes: list[subprocess.Popen], timeout: float = 60.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            return False
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.3):
                return True
        except OSError:
            time.sleep(0.25)
    return False


def port_is_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="启动 Insta360 本地 Web App")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if port_is_open(8765):
        web_ready = port_is_open(3000) or wait_for_port(3000, [], timeout=60.0)
        if web_ready:
            if not args.no_browser:
                webbrowser.open("http://localhost:3000/")
            return 0
        print("本地相机服务正在启动，但网页未能准备完成。", file=sys.stderr)
        return 1

    api = subprocess.Popen(
        [sys.executable, str(ROOT / "tools" / "insta360_web_server.py")],
        cwd=ROOT,
    )
    web = subprocess.Popen(["npm", "run", "dev"], cwd=ROOT / "web")
    children = [api, web]

    def stop(*_args) -> None:
        for child in children:
            if child.poll() is None:
                child.terminate()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        api_ready = wait_for_port(8765, children)
        web_ready = wait_for_port(3000, children)
        if not api_ready or not web_ready:
            print("本地服务启动超时，请查看上方错误。", file=sys.stderr)
            return api.returncode or web.returncode or 1
        print("Insta360 Web App: http://localhost:3000/")
        if not args.no_browser:
            webbrowser.open("http://localhost:3000/")
        while all(child.poll() is None for child in children):
            time.sleep(0.5)
    finally:
        stop()
        for child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
