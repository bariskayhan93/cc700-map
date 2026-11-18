#!/usr/bin/env python3
"""Build the cc25 candidate (scheme D map blocks, firmware/mapdec). It changes only named bytes of the exact
cc23 base with the loop-start trampoline fix: the code at 0x421de800, the entries literal at 0x4203e3ec and the
version text. Writes ota_1_cc25.bin and manifest.json (device_written false) to the output folder. It never
opens a device and never flashes."""
import argparse
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PREFIX = str(Path.home() / 'xtensa-esp-elf' / 'bin' / 'xtensa-esp32s3-elf-')
BASE_SHA = 'd225e17970940be7b153c524aebcfc60f4ca7ae8cd74696ef2282396e461ce04'   # cc23 + trampoline fix (the only base)
VERSION = b'CC700_V1.414-cc25'
IROM = 0x42000020
TAIL = 0x421de800
PAGE_END = 0x421e0000
RESERVE = 1768           # free room kept in the cc23 code page (budget-plan-2026-11-16.md); not changed (D0 item 8)
CODE_MAX = 1024            # plan E4: text and constants at most 1,024 B
HOOK = 0x4203e3ec          # the entries callback literal of the block loader
HOOK_BASE = 0x42049368     # the stock entries callback (the literal's value in the base)
DROM = 0x3c1e0020
DROM_VERSION_AT = 16
# Stock and firmware functions that the module calls. Each must begin with an Xtensa `entry` instruction.
CALLED = (0x42049368, 0x403763e0, 0x40376398)   # stock callback, malloc, free
SCOPES = {'.text': (TAIL, CODE_MAX), '.lit_md': (HOOK, 4)}


def esp_module():
    spec = importlib.util.spec_from_file_location('cc25_espimg', ROOT.parent / 'cc700-backup' / 'tools' / 'espimg.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def run(*args):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True, check=True).stdout


def seg_at(segs, addr, n):
    """Bytes [addr, addr + n) of the base image, from the segment that holds them."""
    for a, d in segs:
        if a <= addr and addr + n <= a + len(d):
            return bytes(d[addr - a:addr - a + n])
    raise ValueError(f'address {addr:#x} is not in the base image')


def build_candidate(base, sections, fragment_read):
    base_sha = hashlib.sha256(base).hexdigest()
    if base_sha != BASE_SHA:
        raise ValueError('expected the exact cc23 base with the trampoline fix')
    if set(sections) != set(SCOPES):
        raise ValueError('fragment inventory differs')
    esp = esp_module()
    header, segs, _ = esp.read(base)
    if esp.build(header, segs) != base:
        raise ValueError('baseline roundtrip failed')
    before = [(a, bytes(d)) for a, d in segs]
    irom = next(d for a, d in segs if a == IROM)
    drom = next(d for a, d in segs if a == DROM)
    if IROM + len(irom) != TAIL:
        raise ValueError('cc23 tail differs')
    if seg_at(segs, HOOK, 4) != HOOK_BASE.to_bytes(4, 'little'):
        raise ValueError('entries literal differs from the stock callback')
    for addr in CALLED:
        if seg_at(segs, addr, 1) != b'\x36':
            raise ValueError('called function drift: ' + hex(addr))
    payloads = {}
    spans = []
    for name, item in sections.items():
        address = int(item['address'], 16)
        size = item['bytes']
        expected, capacity = SCOPES[name]
        if type(size) is not int or size <= 0 or address != expected or size > capacity:
            raise ValueError('fragment outside scope: ' + name)
        data = fragment_read(item['file'])
        if len(data) != size or hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('fragment hash mismatch')
        payloads[name] = data
        spans.append((address, address + size, name))
    literal = int.from_bytes(payloads['.lit_md'], 'little')
    if not TAIL <= literal < TAIL + len(payloads['.text']):
        raise ValueError('hook target outside the new code')
    old_size = len(irom)
    for address, end, name in sorted(spans):
        at = address - IROM
        if end - IROM > len(irom):
            irom.extend(bytes(end - IROM - len(irom)))
        irom[at:at + len(payloads[name])] = payloads[name]
    if IROM + len(irom) > PAGE_END:
        raise ValueError('code page overflow')
    if PAGE_END - IROM - len(irom) < RESERVE:
        raise ValueError(f'free space below the {RESERVE} B reserve')
    drom[DROM_VERSION_AT:DROM_VERSION_AT + 32] = VERSION + bytes(32 - len(VERSION))
    deltas = []
    for (oldaddr, old), (address, data) in zip(before, segs):
        if oldaddr != address or len(data) < len(old):
            raise ValueError('segment layout drift')
        allowed = []
        if address == IROM:
            allowed = [(HOOK - IROM, HOOK - IROM + 4), (old_size, len(data))]
        if address == DROM:
            allowed = [(DROM_VERSION_AT, DROM_VERSION_AT + 32)]
        changed = 0
        for i, v in enumerate(data):
            if i < len(old) and v == old[i]:
                continue
            if not any(a <= i < b for a, b in allowed):
                raise ValueError('unscoped image delta')
            changed += 1
        if changed:
            deltas.append({'segment': hex(address), 'changed_or_added_bytes': changed})
    image = esp.build(header, segs)
    h, s, _ = esp.read(image)
    if esp.build(h, s) != image or len(image) > 0x420000:
        raise ValueError('candidate roundtrip failed')
    return image, {'version': VERSION.decode(), 'base_sha256': base_sha,
                   'image_sha256': hashlib.sha256(image).hexdigest(), 'image_bytes': len(image),
                   'code_bytes': len(payloads['.text']), 'code_max': CODE_MAX,
                   'page_free_bytes': PAGE_END - IROM - len(irom), 'hook_target': hex(literal),
                   'structural_roundtrip': True, 'segment_delta': deltas, 'device_written': False}


def build(base_path, out, prefix=DEFAULT_PREFIX):
    base = Path(base_path).read_bytes()
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    src = ROOT / 'firmware' / 'mapdec'
    elf = out / 'mapdec.elf'
    run(prefix + 'gcc', '-Os', '-mlongcalls', '-mtext-section-literals', '-ffreestanding', '-fno-builtin',
        '-nostdlib', '-ffunction-sections', '-Wall', '-Wextra', '-Werror', '-Wl,-T,' + str(src / 'mapdec.ld'),
        '-Wl,--gc-sections', '-Wl,-e,cc_entries', '-o', elf, src / 'mapdec.c')
    if run(prefix + 'nm', '-u', elf).strip():
        raise ValueError('undefined symbols')
    sections = {}
    for line in run(prefix + 'objdump', '-h', elf).splitlines():
        f = line.split()
        if len(f) < 7 or not f[0].isdigit() or not int(f[2], 16) or f[1].startswith('.debug'):
            continue
        name, size, addr = f[1], int(f[2], 16), int(f[3], 16)
        if name not in SCOPES:
            raise ValueError('unexpected section ' + name)
        path = out / (name[1:] + '.bin')
        run(prefix + 'objcopy', '-O', 'binary', '-j', name, elf, path)
        sections[name] = {'address': hex(addr), 'bytes': size, 'file': path.name,
                          'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
    (out / 'mapdec.dis').write_text(run(prefix + 'objdump', '-d', elf))
    image, receipt = build_candidate(base, sections, lambda n: (out / n).read_bytes())
    (out / 'ota_1_cc25.bin').write_bytes(image)
    receipt['elf'] = str(elf)
    receipt['sections'] = sections
    (out / 'manifest.json').write_text(json.dumps(receipt, indent=1) + '\n')
    return image, receipt


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base', type=Path, default=ROOT / '.local' / 'mining' / 'ota_1_cc23trampfix.bin')
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--prefix', default=DEFAULT_PREFIX)
    a = p.parse_args()
    _, receipt = build(a.base, a.output, a.prefix)
    print(json.dumps({k: receipt[k] for k in ('version', 'image_sha256', 'image_bytes', 'code_bytes', 'hook_target')}))


if __name__ == '__main__':
    main()
