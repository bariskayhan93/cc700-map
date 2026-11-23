#!/usr/bin/env python3
"""Build the cc27 image (Task 13): the cc27 tree (firmware/common, raster, view, mapdraw, wayback) in the second
code area of the C4 image, with the 3 hook literals (wb_rt, cc_iter, cc_line) and the version text. Base: only the C4
image (ac48ba3d). The cc26 record (tools/cc26_build.py) stays; this builder imports its checks. Writes files only.
Never flashes: the receipt says device_written false."""
import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import area2_image as a2  # noqa: E402
import cc26_build as c26  # noqa: E402  (read_any, check_map_tables, literal_outside, esp_module, run)
import incoming_refs as ir  # noqa: E402
import wayback_device_build as wdb  # noqa: E402  (CALLED, is_entry_a1, source_mark)

BASE_SHA = c26.BASE_SHA
PREFIX = c26.PREFIX
IROM, DROM, HOOK, HOOK_BASE = c26.IROM, c26.DROM, c26.HOOK, c26.HOOK_BASE
VERSION_PREFIX = b'CC700_V1.414-cc27-'
CODE_LIMIT = 20172 - 1768       # the second code area less the 1,768 B reserve (design: code limit 18,404 B)
FRAME_LIMIT = 512               # no function frame above 512 B (.su)
# Frame of wb_rt in the first clean cc27 build (19 Nov). A different frame means different compiled code: refused.
HOOK_FRAME = 32
# Stock calls of the cc27 tree: the cc26 list, and heap_caps_malloc, free and the block lock and unlock.
CALLED = tuple(wdb.CALLED) + (0x403763e0, 0x40376398, 0x420494a4, 0x420494b8, 0x4205bf0c)
# The cc27 tree, copied flat into the build directory: directory under firmware/ -> files.
TREE = {'common': ('types.h', 'fw.h', 'text.h'), 'raster': ('raster.h', 'raster.c'), 'view': ('view.h', 'view.c'),
        'mapdraw': ('map.c', 'md_tramp.S', 'proj.h', 'proj.c'),
        'wayback': ('wayback.h', 'wayback.c', 'wb_grey.h', 'wb_grey.c', 'wb_grey_draw.h', 'wb_grey_draw.c', 'wb_far.h', 'wb_far.c', 'wb_device.c',
                    'wb_tramp.S', 'km_tramp.S', 'wb_area2.ld'), 'elev': ('elev.h', 'elev.c', 'elev_font.h')}
SOURCES = ('wb_device.c', 'wayback.c', 'wb_grey.c', 'wb_grey_draw.c', 'wb_far.c', 'wb_tramp.S', 'km_tramp.S', 'map.c', 'md_tramp.S', 'raster.c', 'view.c', 'proj.c', 'elev.c')
run = c26.run
# The IROM tail after the C4 code (the cc25 method, tools/cc25_build.py): the lens chart module elev.o runs there.
TAIL = 0x421debac
PAGE_END = 0x421e0000
RESERVE = 1768               # free room kept in the code page (budget-plan-2026-11-16.md)
TAIL_SOURCES = ('elev.c',)
# The stock remaining-distance overlay call and its trampoline (design 2026-11-23 section 8).
KM_CALL, KM_CALL_OLD, KM_TRAMP, KM_TRAMP_SIZE = 0x4204ca2e, bytes.fromhex('e54d0f'), 0x4205bdd0, 0x1c
KM_DEAD = (0x4205bd90, 0x4205bdf0)  # the dead stock body that holds the trampoline (incoming_refs.DEAD_SPANS)


def call8(at, target):
    """The 3 bytes of call8 target at address at (op0 5, n 2, offset = (target - (at & ~3) - 4) / 4)."""
    off = target - ((at & ~3) + 4)
    if off % 4 or not -(1 << 19) <= off < (1 << 19):
        raise ValueError('call8 target out of range')
    return (0x25 | ((off >> 2) & 0x3ffff) << 6).to_bytes(3, 'little')


def check_called(base):
    """Each stock function that the cc27 tree calls begins with an entry instruction (D0 item 6)."""
    _, segs, _ = c26.esp_module().read(base)
    for address in CALLED:
        if not wdb.is_entry_a1(c26.read_any(segs, address, 3)):
            raise ValueError('called function drift: ' + hex(address))


def apply_cc28g_line(irom, code):
    """Apply the pinned IROM changes to IROM built from the verified C4 base."""
    if hashlib.sha256(code).hexdigest() != '121dd6d312ec38113092bb8638756adb160d628ba4a74a7b3dde685218224107':
        raise ValueError('expected exact cc28g cc_seg code')
    old_body = bytes.fromhex(
        '366100721501820509b21500809723a1fbff62150489119921b9018153fbe00800b80188119821a79b17a2a00'
        'ca0882082450982afff824508a6590582c7fe825501dd05cd04bd03ad02815cfae008006255047255011df0'
    )
    patches = ((0x4203f390, bytes.fromhex('ded0c800'), bytes.fromhex('4a4a4a00')),
               (0x421ddc1c, old_body, code))
    for address, old, new in patches:
        offset = address - IROM
        if len(old) != len(new) or irom[offset:offset + len(old)] != old:
            raise ValueError(f'cc28g old bytes differ at {address:#x}')
    for address, old, new in patches:
        offset = address - IROM
        irom[offset:offset + len(old)] = new


def build(base, outdir, prefix=PREFIX, *, cc28g_line=None):
    """Returns (image bytes, receipt). Refuses any base but the C4 image."""
    if hashlib.sha256(base).hexdigest() != BASE_SHA:
        raise ValueError('expected exact C4 base (ac48ba3d)')
    esp = c26.esp_module()
    header, segs, _ = esp.read(base)
    if esp.build(header, segs) != base:
        raise ValueError('baseline roundtrip failed')
    if c26.read_any(segs, HOOK, 4) != HOOK_BASE.to_bytes(4, 'little'):
        raise ValueError('hook literal drift')
    check_called(base)
    irom = bytes(next(d for a, d in segs if a == IROM))
    spans_ok = ir.check_spans(irom, IROM, ir.DEAD_SPANS)
    outdir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        t = Path(tmp)
        for d, names in TREE.items():
            for n in names:
                (t / n).write_bytes((ROOT / 'firmware' / d / n).read_bytes())
        c26.check_map_tables(segs, t, prefix)
        elf = t / 'cc27.elf'
        # -ffunction-sections: gc-sections drops each function that the unit never calls, not only whole files
        for s in TAIL_SOURCES:
            run(prefix + 'gcc', *c26.CFLAGS, '-ffunction-sections', '-DCC26_AREA2', '-c', '-o', t / s.replace('.c', '.o'), t / s, cwd=t)
        run(prefix + 'gcc', *c26.CFLAGS, '-ffunction-sections', '-Wl,-T,' + str(t / 'wb_area2.ld'), '-Wl,--gc-sections', '-Wl,-e,wb_rt',
            '-DCC26_AREA2', '-o', elf, *(t / s for s in SOURCES if s not in TAIL_SOURCES),
            *(t / s.replace('.c', '.o') for s in TAIL_SOURCES), '-lgcc', cwd=t)
        undefined = run(prefix + 'nm', '-u', elf).strip()
        if undefined:
            raise ValueError('undefined symbols: ' + undefined.splitlines()[0])
        dis = run(prefix + 'objdump', '-d', elf)
        m = re.search(r'entry\ta1, (\d+)', dis.split('<wb_rt>:')[1].split('\n\n')[0])
        frame = int(m.group(1)) if m else None
        if frame != HOOK_FRAME:
            raise ValueError(f'wb_rt frame {frame} differs from {HOOK_FRAME}')
        run(prefix + 'objcopy', '-O', 'binary', '-j', '.text', elf, t / 'text.bin')
        run(prefix + 'objcopy', '-O', 'binary', '-j', '.lit_wb_rt', elf, t / 'lit.bin')
        run(prefix + 'objcopy', '-O', 'binary', '-j', '.tail_text', elf, t / 'tail.bin')
        run(prefix + 'objcopy', '-O', 'binary', '-j', '.tramp_km', elf, t / 'km.bin')
        code, lit = (t / 'text.bin').read_bytes(), (t / 'lit.bin').read_bytes()
        tail, km_tramp = (t / 'tail.bin').read_bytes(), (t / 'km.bin').read_bytes()
        km_target = int(re.search(r'([0-9a-f]+) [Tt] wb_km$', run(prefix + 'nm', elf), re.M).group(1), 16)
        map_lits = {}
        for address, (_, section) in c26.MAP_HOOKS.items():
            run(prefix + 'objcopy', '-O', 'binary', '-j', section, elf, t / 'm.bin')
            map_lits[address] = (t / 'm.bin').read_bytes()
        stack = sorted(l.split('\t')[0].split(':')[-1] + ' ' + l.split('\t')[1] for f in t.glob('*.su') if f.name != 'tables.su'
                       for l in f.read_text().splitlines())
        symbols = sorted({f[2] for f in (l.split() for l in run(prefix + 'nm', elf).splitlines()) if len(f) == 3 and f[1] in 'Tt'})
        (outdir / 'cc27.dis').write_text(dis)
    max_frame = max(int(s.rsplit(' ', 1)[1]) for s in stack)
    if max_frame > FRAME_LIMIT:
        raise ValueError(f'a function frame of {max_frame} B is above {FRAME_LIMIT} B')
    if len(code) > CODE_LIMIT:
        raise ValueError(f'code {len(code)} B is over {CODE_LIMIT} B (the 1,768 B reserve)')
    word = int.from_bytes(lit, 'little')
    if not 0x4237b134 <= word < 0x42380000 or len(lit) != 4:
        raise ValueError('hook target outside the second code area')
    if IROM + len(irom) != TAIL:
        raise ValueError('the C4 IROM does not end at the tail start')
    if TAIL + len(tail) > PAGE_END - RESERVE:
        raise ValueError(f'tail code {len(tail)} B leaves less than the {RESERVE} B reserve before {PAGE_END:#x}')
    if len(km_tramp) != KM_TRAMP_SIZE or int.from_bytes(km_tramp[8:12], 'little') != km_target:
        raise ValueError('km_tramp is not the 0x1c B form with the wb_km literal')
    if irom[KM_CALL - IROM:KM_CALL - IROM + 3] != KM_CALL_OLD:
        raise ValueError('the km overlay call drifted')
    insts, _ = ir.per_function(irom, IROM, ir.OBJDUMP)
    hook_refs = c26.literal_outside(insts, HOOK, 4, ir.DEAD_SPANS)
    if hook_refs['outside']:
        raise ValueError('literal reference into the hook word from outside: ' + hook_refs['outside_at'][0])
    km_refs = [hex(src) for src, _, _ in ir.references(insts, {'km': (KM_TRAMP, KM_TRAMP_SIZE)})['km']]
    if any(not KM_DEAD[0] <= int(r, 16) < KM_DEAD[1] for r in km_refs):
        raise ValueError('reference into km_tramp from outside its dead span: ' + ', '.join(km_refs))
    map_refs = {}
    for address, (old, _) in c26.MAP_HOOKS.items():
        if c26.read_any(segs, address, 4) != old.to_bytes(4, 'little'):
            raise ValueError('map hook literal drift: ' + hex(address))
        w = int.from_bytes(map_lits[address], 'little')
        if len(map_lits[address]) != 4 or not 0x4237b134 <= w < 0x42380000:
            raise ValueError('map hook target outside the second code area: ' + hex(address))
        refs = [src for src, mn, ops in insts if mn == 'l32r' and any(int(v, 16) == address for v in re.findall(r'0x([0-9a-f]+)', ops)[:1])]
        if not refs or any(not c26.MAP_TRAMPS[address] <= int(r) < c26.MAP_TRAMPS[address] + 28 for r in refs):
            raise ValueError('map hook literal read outside its tramp: ' + hex(address))
        map_refs[hex(address)] = {'target': hex(w), 'refs': [hex(r) for r in refs]}
    version = VERSION_PREFIX + wdb.source_mark().encode()
    if len(version) > 32:
        raise ValueError('version text above 32 B')
    new = [[a, bytearray(d)] for a, d in segs]
    dr = next(d for a, d in new if a == DROM)
    dr[16:48] = version + bytes(32 - len(version))
    ir_ = next(d for a, d in new if a == IROM)
    ir_[HOOK - IROM:HOOK - IROM + 4] = lit
    for address, map_word in map_lits.items():
        ir_[address - IROM:address - IROM + 4] = map_word
    km_new = call8(KM_CALL, KM_TRAMP)
    ir_[KM_CALL - IROM:KM_CALL - IROM + 3] = km_new
    ir_[KM_TRAMP - IROM:KM_TRAMP - IROM + KM_TRAMP_SIZE] = km_tramp
    ir_.extend(tail)
    if cc28g_line is not None:
        apply_cc28g_line(ir_, cc28g_line)
    image = a2.add_area2(esp.build(header, new), code)
    h, s, _ = esp.read(image)
    if esp.build(h, s) != image or len(image) > 0x420000:
        raise ValueError('candidate roundtrip failed')
    dirty = run('git', '-C', str(ROOT), 'status', '--porcelain', '--', 'firmware', 'tools/cc27_build.py', 'tools/cc26_build.py',
                'tools/area2_image.py').strip()
    receipt = {'version': version.decode(), 'source_commit': version[-7:].decode(), 'source_dirty': bool(dirty),
               'base_sha256': BASE_SHA, 'image_sha256': hashlib.sha256(image).hexdigest(), 'image_bytes': len(image),
               'cc28g_line': cc28g_line is not None, 'code_bytes': len(code), 'code_sha256': hashlib.sha256(code).hexdigest(), 'code_limit': CODE_LIMIT,
               'area_bytes': a2.AREA_LIMIT, 'hook_target': hex(word), 'hook_word_hex': lit.hex(), 'hook_frame': frame,
               'undefined_symbols': undefined, 'incoming': {'hook': hook_refs, 'km': {'outside': 0, 'dead': km_refs}}, 'map_hooks': map_refs, 'dead_spans_ok': spans_ok is None,
               'tail_bytes': len(tail), 'tail_free': PAGE_END - TAIL - len(tail), 'km_target': hex(km_target),
               'km_call': {'at': hex(KM_CALL), 'old': KM_CALL_OLD.hex(), 'new': km_new.hex()},
               'stack_usage': stack, 'max_frame': max_frame, 'sources': list(SOURCES), 'symbols': symbols, 'device_written': False}
    return image, receipt


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base', type=Path, default=ROOT / '.local/cc25/ota_1_cc25.bin')
    p.add_argument('--output', type=Path, default=ROOT / '.local/cc27')
    p.add_argument('--prefix', default=PREFIX)
    p.add_argument('--cc28g-line', type=Path, help='pinned 88-byte cc28g cc_seg code input')
    a = p.parse_args()
    line = a.cc28g_line.read_bytes() if a.cc28g_line else None
    image, receipt = build(a.base.read_bytes(), a.output, a.prefix, cc28g_line=line)
    a.output.mkdir(parents=True, exist_ok=True)
    (a.output / 'ota_1_cc27.bin').write_bytes(image)
    (a.output / 'manifest.json').write_text(json.dumps(receipt, indent=1) + '\n')
    print(json.dumps({k: receipt[k] for k in ('version', 'image_sha256', 'image_bytes', 'code_bytes', 'max_frame', 'hook_frame', 'source_dirty')}))


if __name__ == '__main__':
    main()
