#!/usr/bin/env python3
"""Code size of the way-back core for the Xtensa target: .text, literal and rodata bytes,
and the undefined symbols that the object needs from a library.

Usage: python3 -I tools/wayback_size.py
Prints one JSON object. Host only: it runs the Xtensa compiler and binutils and never opens a device.
"""
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = Path(os.path.expanduser("~/xtensa-esp-elf/bin"))
PREFIX = "xtensa-esp32s3-elf-"
ROOM = 4376
CFLAGS = ["-Os", "-mlongcalls", "-mtext-section-literals", "-ffreestanding", "-fno-builtin"]


def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True).stdout


def main():
    gcc = TOOLS / (PREFIX + "gcc")
    if not gcc.is_file():
        print(json.dumps({"error": "toolchain not found"}))
        return 2
    src = ROOT / "firmware" / "wayback" / "wayback.c"
    work = Path(tempfile.mkdtemp(prefix="wayback-size-"))
    try:
        obj = work / "wayback.o"
        run([str(gcc), *CFLAGS, "-c", str(src), "-o", str(obj)])
        sizes = run([str(TOOLS / (PREFIX + "size")), "-A", str(obj)])
        symbols = run([str(TOOLS / (PREFIX + "nm")), "-u", str(obj)])
    finally:
        shutil.rmtree(work, ignore_errors=True)

    text = literal = rodata = 0
    for line in sizes.splitlines():
        parts = line.split()
        if len(parts) < 2 or not parts[1].isdigit():
            continue
        name, size = parts[0], int(parts[1])
        if name.startswith(".text"):
            text += size
        elif name.startswith(".literal"):
            literal += size
        elif name.startswith(".rodata"):
            rodata += size
    undefined = sorted(p[1] for p in (line.split() for line in symbols.splitlines()) if len(p) == 2 and p[0] == "U")
    total = text + literal + rodata
    print(json.dumps({
        "text": text,
        "literal": literal,
        "rodata": rodata,
        "total": total,
        "room": ROOM,
        "fits": total <= ROOM,
        "undefined": undefined,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
