#!/usr/bin/env python3
"""Build an ICNS container from a standard macOS iconset using only stdlib."""

from __future__ import annotations

import argparse
import struct
from pathlib import Path


CHUNKS = (
    (b"ic11", "icon_16x16@2x.png"),
    (b"ic07", "icon_128x128.png"),
    (b"ic13", "icon_128x128@2x.png"),
)


def build(iconset: Path, output: Path) -> None:
    chunks = []
    for kind, filename in CHUNKS:
        data = (iconset / filename).read_bytes()
        chunks.append(kind + struct.pack(">I", len(data) + 8) + data)
    payload = b"".join(chunks)
    output.write_bytes(b"icns" + struct.pack(">I", len(payload) + 8) + payload)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("iconset", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.iconset, args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
