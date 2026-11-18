#!/usr/bin/env python3
"""Build the cc26 way-back candidate (D5): the adapter and the way-back core in the second code area (D4, E8), with
the hook literal 0x420496b8 set to wb_rt and the version text. Base: only the C4 image (ac48ba3d). Writes files only.
Never flashes: the receipt says device_written false."""
import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import area2_image as a2  # noqa: E402
import incoming_refs as ir  # noqa: E402
import wayback_device_build as wdb  # noqa: E402  (CALLED, is_entry_a1, source_mark)

BASE_SHA = 'ac48ba3dfccd722b97676367f7f7f9b97c0b51871dcc71227b1ae3bd41676f96'
PREFIX = str(Path.home() / 'xtensa-esp-elf/bin/xtensa-esp32s3-elf-')
IROM = 0x42000020
DROM = 0x3c1e0020
HOOK = 0x420496b8           # tramp_rt literal: base value 0x421dd920 (cc_rt), new value wb_rt
HOOK_BASE = 0x421dd920
VERSION_PREFIX = b'CC700_V1.414-cc26-'
# Frame of wb_rt as the compiler built it for cc26. A different frame means different compiled code: refused.
HOOK_FRAME = 32
TREE = ('wayback.c', 'wayback.h', 'wb_grey.c', 'wb_grey.h', 'wb_device.c', 'wb_tramp.S', 'wb_area2.ld')
MAP_TREE = ('map.c', 'fw.h', 'md_tramp.S')   # firmware/mapdraw: v21 cc_iter and cc_line with A and B (after the 18 Nov crash)
# Map draw hooks: literal address -> (base value = v21 function, section of the new word).
MAP_HOOKS = {0x42049678: (0x421dcb2c, '.lit_cc_iter'), 0x4205bd98: (0x421dc988, '.lit_cc_line')}
MAP_TRAMPS = {0x42049678: 0x42049670, 0x4205bd98: 0x4205bd90}   # each literal is read only by its own 28-byte tramp
# The v21 tables that the area-2 build reads from the base (no data in the second code area): symbol -> address.
MAP_TABLES = {'LEVEL': 0x3c1ddf20, 'FILLS': 0x3c1ddf36, 'OPS': 0x3c1ddf40}
CFLAGS = ['-Os', '-mlongcalls', '-mtext-section-literals', '-ffreestanding', '-fno-builtin', '-nostdlib',
          '-Wall', '-Wextra', '-Werror', '-std=gnu11', '-fstack-usage']


def esp_module():
    spec = importlib.util.spec_from_file_location('cc26_espimg', ROOT.parent / 'cc700-backup/tools/espimg.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def run(*args, cwd=None):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True, check=True, cwd=cwd).stdout


def read_any(segs, address, n):
    for a, d in segs:
        if a <= address and address + n <= a + len(d):
            return bytes(d[address - a:address - a + n])
    raise ValueError('address outside the base image: ' + hex(address))


def check_called(base):
    """Each firmware entry the adapter calls begins with an entry instruction (D0 item 6, D5 step 5)."""
    _, segs, _ = esp_module().read(base)
    for address in wdb.CALLED:
        if not wdb.is_entry_a1(read_any(segs, address, 3)):
            raise ValueError('called function drift: ' + hex(address))


def check_map_tables(segs, t, prefix):
    """The area-2 map.c reads LEVEL, FILLS and OPS from the base: the bytes there must be the tables of the source."""
    obj = t / 'tables.o'
    run(prefix + 'gcc', *CFLAGS, '-c', '-o', obj, t / 'map.c', cwd=t)
    (t / 'tables.su').unlink(missing_ok=True)   # not part of the image
    run(prefix + 'objcopy', '-O', 'binary', '-j', '.rodata', obj, t / 'rodata.bin')
    rodata = (t / 'rodata.bin').read_bytes()
    for line in run(prefix + 'nm', '-S', obj).splitlines():
        f = line.split()
        if len(f) == 4 and f[3] in MAP_TABLES:
            off, size = int(f[0], 16), int(f[1], 16)
            # 0x3c1d.... is the data-bus alias of the same flash page as 0x421d.... (v21 put its tables after its .text)
            if read_any(segs, MAP_TABLES[f[3]] - 0x3c000000 + 0x42000000, size) != rodata[off:off + size]:
                raise ValueError('map table differs from the base: ' + f[3])
            MAP_TABLES_SEEN.add(f[3])
    if MAP_TABLES_SEEN != set(MAP_TABLES):
        raise ValueError('map tables not found in the source: ' + str(set(MAP_TABLES) - MAP_TABLES_SEEN))


MAP_TABLES_SEEN = set()


def literal_outside(insts, address, size, spans):
    """Literal references (l32r) into [address, address + size) from outside it and outside the dead span."""
    holder = next((s for s, e in spans.items() if s <= address and address + size <= e), None)
    dead, outside = [], []
    for src, mnemonic, ops in insts:
        if mnemonic != 'l32r':
            continue
        vals = re.findall(r'0x([0-9a-f]+)', ops)
        if len(vals) < 1 or not address <= int(vals[0], 16) < address + size:
            continue
        if holder is not None and holder <= src < spans[holder]:
            dead.append(hex(src))
        else:
            outside.append(hex(src))
    return {'outside': len(outside), 'dead': dead, 'outside_at': outside}


def build(base, outdir, prefix=PREFIX):
    """Returns (image bytes, receipt). Refuses any base but the C4 image."""
    if hashlib.sha256(base).hexdigest() != BASE_SHA:
        raise ValueError('expected exact C4 base (ac48ba3d)')
    esp = esp_module()
    header, segs, _ = esp.read(base)
    if esp.build(header, segs) != base:
        raise ValueError('baseline roundtrip failed')
    if read_any(segs, HOOK, 4) != HOOK_BASE.to_bytes(4, 'little'):
        raise ValueError('hook literal drift')
    check_called(base)
    irom = bytes(next(d for a, d in segs if a == IROM))
    spans_ok = ir.check_spans(irom, IROM, ir.DEAD_SPANS)
    outdir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        for n in TREE:
            (t / n).write_bytes((ROOT / 'firmware/wayback' / n).read_bytes())
        for n in MAP_TREE:
            (t / n).write_bytes((ROOT / 'firmware/mapdraw' / n).read_bytes())
        check_map_tables(segs, t, prefix)
        elf = t / 'cc26.elf'
        run(prefix + 'gcc', *CFLAGS, '-Wl,-T,' + str(t / 'wb_area2.ld'), '-Wl,--gc-sections', '-Wl,-e,wb_rt',
            '-DCC26_AREA2', '-o', elf, t / 'wb_device.c', t / 'wayback.c', t / 'wb_grey.c', t / 'wb_tramp.S',
            t / 'map.c', t / 'md_tramp.S', '-lgcc', cwd=t)
        undefined = run(prefix + 'nm', '-u', elf).strip()
        if undefined:
            raise ValueError('undefined symbols: ' + undefined.splitlines()[0])
        dis = run(prefix + 'objdump', '-d', elf)
        block = dis.split('<wb_rt>:')[1].split('\n\n')[0]
        if f'entry\ta1, {HOOK_FRAME}' not in block:
            raise ValueError(f'wb_rt frame differs from {HOOK_FRAME}')
        code = bytes()
        lit = bytes()
        run(prefix + 'objcopy', '-O', 'binary', '-j', '.text', elf, t / 'text.bin')
        run(prefix + 'objcopy', '-O', 'binary', '-j', '.lit_wb_rt', elf, t / 'lit.bin')
        code = (t / 'text.bin').read_bytes()
        lit = (t / 'lit.bin').read_bytes()
        map_lits = {}
        for address, (_, section) in MAP_HOOKS.items():
            run(prefix + 'objcopy', '-O', 'binary', '-j', section, elf, t / 'm.bin')
            map_lits[address] = (t / 'm.bin').read_bytes()
        stack = sorted(l.split('\t')[0].split(':')[-1] + ' ' + l.split('\t')[1] for f in t.glob('*.su') for l in f.read_text().splitlines())
        (outdir / 'cc26.dis').write_text(dis)
    if len(code) > a2.AREA_LIMIT:
        raise ValueError(f'code {len(code)} B is over {a2.AREA_LIMIT} B')
    word = int.from_bytes(lit, 'little')
    if not 0x4237b134 <= word < 0x42380000 or len(lit) != 4:
        raise ValueError('hook target outside the second code area')
    # Literal references into the hook word (D0 item 2): the base is checked before the change.
    insts, _ = ir.per_function(irom, IROM, ir.OBJDUMP)
    hook_refs = literal_outside(insts, HOOK, 4, ir.DEAD_SPANS)
    if hook_refs['outside']:
        raise ValueError('literal reference into the hook word from outside: ' + hook_refs['outside_at'][0])
    map_refs = {}
    for address, (old, _) in MAP_HOOKS.items():
        if read_any(segs, address, 4) != old.to_bytes(4, 'little'):
            raise ValueError('map hook literal drift: ' + hex(address))
        w = int.from_bytes(map_lits[address], 'little')
        if len(map_lits[address]) != 4 or not 0x4237b134 <= w < 0x42380000:
            raise ValueError('map hook target outside the second code area: ' + hex(address))
        refs = [src for src, m, ops in insts if m == 'l32r' and any(int(v, 16) == address for v in re.findall(r'0x([0-9a-f]+)', ops)[:1])]
        if any(not MAP_TRAMPS[address] <= int(r) < MAP_TRAMPS[address] + 28 for r in refs) or not refs:
            raise ValueError('map hook literal read outside its tramp: ' + hex(address))
        map_refs[hex(address)] = {'target': hex(w), 'refs': [hex(r) for r in refs]}
    # The base with the version text and the hook word, then the second code area.
    version = VERSION_PREFIX + wdb.source_mark().encode()
    new = [[a, bytearray(d)] for a, d in segs]
    dr = next(d for a, d in new if a == DROM)
    dr[16:48] = version + bytes(32 - len(version))
    ir_ = next(d for a, d in new if a == IROM)
    ir_[HOOK - IROM:HOOK - IROM + 4] = lit
    for address, map_word in map_lits.items():
        ir_[address - IROM:address - IROM + 4] = map_word
    image = a2.add_area2(esp.build(header, new), code)
    h, s, _ = esp.read(image)
    if esp.build(h, s) != image or len(image) > 0x420000:
        raise ValueError('candidate roundtrip failed')
    receipt = {'version': version.decode(), 'source_commit': version[-7:].decode(),
               'source_dirty': bool(run('git', '-C', str(ROOT), 'status', '--porcelain', '--', 'firmware/wayback',
                                        'firmware/mapdraw', 'tools/cc26_build.py', 'tools/area2_image.py').strip()),
               'base_sha256': BASE_SHA, 'image_sha256': hashlib.sha256(image).hexdigest(), 'image_bytes': len(image),
               'code_bytes': len(code), 'area_bytes': a2.AREA_LIMIT, 'hook_target': hex(word), 'hook_word_hex': lit.hex(),
               'undefined_symbols': undefined, 'incoming': {'hook': hook_refs}, 'map_hooks': map_refs, 'dead_spans_ok': spans_ok is None,
               'stack_usage': stack, 'device_written': False}
    return image, receipt


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base', type=Path, default=ROOT / '.local/cc25/ota_1_cc25.bin')
    p.add_argument('--output', type=Path, default=ROOT / '.local/cc26')
    p.add_argument('--prefix', default=PREFIX)
    a = p.parse_args()
    image, receipt = build(a.base.read_bytes(), a.output, a.prefix)
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / 'ota_1_cc26.bin').write_bytes(image)
    (a.output / 'manifest.json').write_text(json.dumps(receipt, indent=1) + '\n')
    print(json.dumps({k: receipt[k] for k in ('version', 'image_sha256', 'image_bytes', 'code_bytes', 'hook_target')}))


if __name__ == '__main__':
    main()
