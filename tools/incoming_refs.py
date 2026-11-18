"""Incoming references into the bytes a builder overwrites (D0 item 2, R-D02). The toolchain objdump disassembles the
raw IROM of a base image. A branch, call, jump or l32r literal whose target lies in an overwritten range counts as a
reference when its instruction lies outside that range and outside the dead span that holds the range. One counted
reference fails the build. Host only."""
import importlib.util
import os
import re
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OBJDUMP = os.path.expanduser('~/xtensa-esp-elf/bin/xtensa-esp32s3-elf-objdump')
IROM_BASE = 0x42000020
LINE = re.compile(r'^\s*([0-9a-f]+):\t[0-9a-f ]+\t(\S+)\s*(.*)$')
HEX = re.compile(r'0x([0-9a-f]+)')

# Dead stock bodies (R-D02, owner 18 Nov). Each head is replaced by a no-fallthrough trampoline (entry a1, 32 ...
# callx8 a8; retw.n, 0x1c B), so no instruction of the old body can run. The references inside a body are dead code.
DEAD_SPANS = {
    # Stock function at 0x42049670 (stock head 368100, entry a1, 64). It runs to 0x4204976b. The next stock entry is
    # 0x4204976c. The popup range 0x42049690, the hook word 0x420496b8 and the L1 range 0x420496d8 lie in its body.
    0x42049670: 0x4204976c,
    # Stock function at 0x4205bd90 (stock head 364100). The card range 0x4205bdb0 lies in its body. The next stock
    # entry after the reference 0x4205bdeb is 0x4205bdf0.
    0x4205bd90: 0x4205bdf0,
}
TRAMP_HEAD = bytes.fromhex('364100')       # entry a1, 32
TRAMP_TAIL = bytes.fromhex('e008001df0')   # callx8 a8; retw.n, at head + 0x17
TRAMP_TAIL_AT = 0x17
TRAMP_SIZE = 0x1c


def load_irom(path):
    """The IROM bytes of an ESP image, read with the espimg module of the cc700-backup tree (as the builders do)."""
    spec = importlib.util.spec_from_file_location('espimg', ROOT.parent / 'cc700-backup/tools/espimg.py')
    espimg = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(espimg)
    _, segments, _ = espimg.read(Path(path).read_bytes())
    return bytes(next(data for address, data in segments if address == IROM_BASE))


def sweep(code, base, objdump=OBJDUMP):
    """Disassembly lines of a raw code image that starts at address base (one linear sweep)."""
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'code.bin')
        with open(path, 'wb') as f:
            f.write(bytes(code))
        out = subprocess.run([objdump, '-D', '-b', 'binary', '-m', 'xtensa', f'--adjust-vma={hex(base)}', path],
                             capture_output=True, text=True, check=True).stdout
    return out.splitlines()


def instructions(lines):
    """(address, mnemonic, operands) of each instruction line of a sweep, in address order."""
    out = []
    for line in lines:
        m = LINE.match(line)
        if m and m.group(2) != '.byte':
            out.append((int(m.group(1), 16), m.group(2), m.group(3)))
    return out


def target_of(mnemonic, ops):
    """The address a branch, call or jump goes to, or the literal value of l32r, or None."""
    if mnemonic == 'l32r':
        vals = HEX.findall(ops)
        return int(vals[1], 16) if len(vals) >= 2 else None
    if mnemonic.startswith(('call', 'j', 'b', 'loop')) and not mnemonic.startswith('callx'):
        vals = HEX.findall(ops)
        return int(vals[-1], 16) if vals else None
    return None


def is_entry(code, offset):
    """A windowed function entry, entry a1, N (bytes 36 x1 00)."""
    return code[offset] == 0x36 and code[offset + 1] & 0xF == 1 and code[offset + 2] == 0


def entries(code, base):
    """The 4-aligned addresses of the image that hold an entry a1 instruction."""
    return [base + i for i in range(0, len(code) - 2, 4) if (base + i) % 4 == 0 and is_entry(code, i)]


def per_function(code, base, objdump=OBJDUMP):
    """Instructions of the image, decoded by function (R-D02 rule 4). A function runs from its entry to the next entry,
    and each one is decoded from its own entry, so a desynchronised sweep cannot hide a branch of another function.
    Bytes before the first entry are one more piece. Returns (sorted instructions, count of pieces)."""
    heads = entries(code, base)
    pieces = []
    if not heads or heads[0] > base:
        pieces.append((base, heads[0] if heads else base + len(code)))
    pieces.extend(zip(heads, heads[1:] + [base + len(code)]))

    def decode(item):
        head, end = item
        return instructions(sweep(code[head - base:end - base], head, objdump))

    keep = []
    with ThreadPoolExecutor(max_workers=os.cpu_count() or 1) as pool:
        for part in pool.map(decode, pieces):
            keep.extend(part)
    keep.sort()
    return keep, len(pieces)


def references(insts, ranges):
    """{name: [(source, mnemonic, target), ...]}: each instruction that targets a range (address, size) from outside
    the range. The caller removes the sources in a dead span."""
    hits = {name: [] for name in ranges}
    for src, mnemonic, ops in insts:
        t = target_of(mnemonic, ops)
        if t is None:
            continue
        for name, (address, size) in ranges.items():
            if address <= t < address + size and not address <= src < address + size:
                hits[name].append((src, mnemonic, t))
    return hits


def incoming(lines, ranges):
    """{name: [(hex source, mnemonic, hex target), ...]} for the lines of one sweep (no dead-span removal)."""
    return {name: [(hex(s), m, hex(t)) for s, m, t in found]
            for name, found in references(instructions(lines), ranges).items()}


def check_spans(code, base, spans):
    """Each dead span that lies in the image must start with the 0x1c B trampoline. Raises ValueError otherwise."""
    for start, end in spans.items():
        if end <= start or end - start < TRAMP_SIZE:
            raise ValueError(f'dead span {hex(start)}..{hex(end)} is empty')
        if not (base <= start and end <= base + len(code)):
            continue
        head = start - base
        if code[head:head + 3] != TRAMP_HEAD or code[head + TRAMP_TAIL_AT:head + TRAMP_TAIL_AT + 5] != TRAMP_TAIL:
            raise ValueError(f'dead span head {hex(start)} is not the 0x1c B trampoline')


def check(code, base, ranges, spans, objdump=OBJDUMP):
    """The receipt: {name: {'outside': 0, 'dead': [hex source, ...]}}. Raises ValueError at the first counted reference.
    ranges: {name: (address, size)}. spans: DEAD_SPANS, or a synthetic dict in a test."""
    check_spans(code, base, spans)
    insts, _ = per_function(code, base, objdump)
    found = references(insts, ranges)
    receipt = {}
    for name, (address, size) in ranges.items():
        holder = next((s for s, e in spans.items() if s <= address and address + size <= e), None)
        outside, dead = [], []
        for src, mnemonic, target in found[name]:
            if holder is not None and holder <= src < spans[holder]:
                dead.append(hex(src))
            else:
                outside.append((src, mnemonic, target))
        if outside:
            src, mnemonic, target = outside[0]
            raise ValueError(f'incoming reference into {name}: {hex(src)} {mnemonic} {hex(target)}')
        receipt[name] = {'outside': 0, 'dead': dead}
    return receipt
