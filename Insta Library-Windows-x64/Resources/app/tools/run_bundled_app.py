#!/usr/bin/env python3
"""Launch the API and production web server from a self-contained app bundle."""

from __future__ import annotations

import argparse
import os
import signal
import socket
import subprocess
import sys
import time
import webbrowser
from pathlib import Path


TOOLS = Path(__file__).resolve().parent
APP_ROOT = TOOLS.parent
RESOURCES = APP_ROOT.parent
RUNTIME = RESOURCES / "runtime"


def bundled_node() -> Path:
    """Return the bundled Node executable on macOS or Windows."""
    return RUNTIME / ("node.exe" if os.name == "nt" else "node")


def port_is_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.3):
            return True
    except OSError:
        return False


def wait_for_port(port: int, processes: list[subprocess.Popen], timeout: float = 45.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if any(process.poll() is not None for process in processes):
            return False
        if port_is_open(port):
            return True
        time.sleep(0.2)
    return False


def main() -> int:
    parser = argparse.ArgumentParser(description="启动自包含 Insta Library")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    if port_is_open(8765):
        if port_is_open(3000) or wait_for_port(3000, [], timeout=30.0):
            if not args.no_browser:
                webbrowser.open("http://localhost:3000/")
            return 0
        return 1

    environment = os.environ.copy()
    environment["INSTA_WEB_DIST"] = str(APP_ROOT / "web-dist")
    environment["PYTHONPATH"] = str(APP_ROOT / "python-packages")
    environment["PYTHONDONTWRITEBYTECODE"] = "1"
    environment["PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION"] = "python"

    api = subprocess.Popen(
        [sys.executable, str(TOOLS / "insta360_web_server.py")],
        cwd=APP_ROOT,
        env=environment,
    )
    web = subprocess.Popen(
        [str(bundled_node()), str(TOOLS / "standalone_web_server.mjs")],
        cwd=APP_ROOT,
        env=environment,
    )
    children = [api, web]

    def stop(*_args) -> None:
        for child in children:
            if child.poll() is None:
                child.terminate()

    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    try:
        if not wait_for_port(8765, children) or not wait_for_port(3000, children):
            return api.returncode or web.returncode or 1
        if not args.no_browser:
            webbrowser.open("http://localhost:3000/")
        while all(child.poll() is None for child in children):
            time.sleep(0.4)
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
