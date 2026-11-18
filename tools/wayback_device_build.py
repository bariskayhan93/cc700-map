#!/usr/bin/env python3
"""Shared checks of the way-back device builds (tools/cc26_build.py). The cc23 build path is retired (18 Nov 2026):
the restore image cc23wb2fix is a saved file, and its sources are at d9aa2f8^."""
import re
import subprocess
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]


def source_mark():
    """Build mark (D0 item 9): the first 7 hex digits of the source commit, at the end of the version text."""
    head=subprocess.run(['git','-C',str(ROOT),'rev-parse','--short=7','HEAD'],capture_output=True,text=True,check=True).stdout.strip()
    if not re.fullmatch(r'[0-9a-f]{7}',head): raise ValueError('source commit is not 7 hex digits')
    return head


# Stock and v21 functions that the adapter calls. Each must begin with an Xtensa `entry` instruction.
# The four adapter callees of wb_device.c (fw_take, fw_file_give, fw_clock, fw_task_stack) are listed too (D0 item 6).
CALLED=(0x421dd920,0x421dd218,0x421b85b0,0x421b7de0,0x421b8848,0x421b8818,0x4204c7a8,0x4204c1bc,0x420dbcd0,
        0x40381868,0x403813c0,0x403779f4,0x403832e0)


def is_entry_a1(b3):
    """The 3-byte Xtensa `entry a1, imm`: opcode byte 0x36, register field a1, and op2 (high nibble of byte 2) 0."""
    return len(b3)==3 and b3[0]==0x36 and (b3[1]&0x0f)==1 and (b3[2]>>4)==0
