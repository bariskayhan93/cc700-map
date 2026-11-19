#!/usr/bin/env python3
"""Machine gates of the review harness (docs/current/review-harness.md). Host only: never opens a port.

Usage: python3 -I tools/review_gate.py --since <rev> [--tests] [--image]
Each gate prints PASS, FAIL or INFO with the file and the value. Exit 1 when a gate fails.
  G1 public repo     no tracked private path or binary, no coordinate pair in the added lines
  G2 runner          every test file of the range runs in tools/validate_local.py
  G3 C rules         host -Werror build; no library call, no writable global; no float in the core
  G4 stack           deepest adapter path from the device compiler call graph, and the room left for stock calls
  G5 limits          each limit has one value in C, page and builder
  G6 formats         the live writers of each layer format
  G7 image           (--image) the pack image rebuilds from the sources with the same SHA-256
  G8 release text    the release text names the image file that has the pack SHA-256
  G9 tests           (--tests) the validation runner, then the suites of the range that it does not run
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
XT = Path.home() / 'xtensa-esp-elf/bin/xtensa-esp32s3-elf-'
PACK = ROOT / '.local/cc26-pack'
RELEASE = ROOT / 'docs/releases/cc26-2026-11-18.md'
WB = ROOT / 'firmware/wayback'
CORE_NO_FLOAT = ('firmware/wayback/wayback.c', 'firmware/wayback/wb_grey.c', 'firmware/wayback/wb_grey_draw.c', 'firmware/raster/raster.c',
                 'firmware/view/view.c', 'firmware/elev/elev.c', 'firmware/mapdec/mapdec.c')
LIB_CALL = re.compile(r'\b(memcpy|memset|memmove|strlen|strcpy|malloc|calloc|realloc|free|printf|sprintf)\s*\(')
COORD_PAIR = re.compile(r'-?\b\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}\b')
PRIVATE_EXT = ('.bin', '.gpx', '.fit', '.ccwb', '.elf')
STACK_ROOT = 'wb_rt'
STACK_LIMIT = 3968                          # WBD_STACK: free stack wb_rt needs before any file call
# The core (wayback.c, wb_grey.c) calls only these callbacks indirectly. An indirect call in wb_device.c goes to stock
# code: it is counted as 0 B here, and the room left for it is reported.
CALLBACKS = ('wbd_read', 'wbd_file', 'gd_line', 'pick_visit')
CORE_FILES = ('wayback.ci', 'wb_grey.ci')
# The cc27 adapter tree for the stack graph: (directory, source) under firmware/.
STACK_SOURCES = (('wayback', 'wb_device.c'), ('wayback', 'wayback.c'), ('wayback', 'wb_grey.c'), ('wayback', 'wb_grey_draw.c'),
                 ('raster', 'raster.c'), ('view', 'view.c'), ('elev', 'elev.c'))

# One limit, each place that states it: (file, regex with one group, transform to a common value).
HEX_OR_DEC = lambda s: int(s, 0)
LIMITS = {
    'line points': [('firmware/wayback/wb_device.c', r'#define WBD_POINTS (\d+)u', int),
                    ('firmware/wayback/wb_grey.h', r'#define GL_POINTS (\d+)u', int),
                    ('js/wayback_grey_layer.js', r'const MAX_POINTS = (\d+);', int)],
    'grey cell units': [('firmware/wayback/wb_grey.c', r'#define GL_CELL (\d+)', int),
                        ('js/wayback_grey_layer.js', r'CELL_SHIFT = (\d+),', lambda s: 1 << int(s))],
    'grey quantum units': [('firmware/wayback/wb_grey.c', r'qx \* (\d+);', int),
                           ('js/wayback_grey_layer.js', r'QUANTUM_SHIFT = (\d+),', lambda s: 1 << int(s))],
    'grey body max B': [('firmware/wayback/wb_grey.c', r'#define GL_BODY (\d+)u', int),
                        ('js/wayback_grey_layer.js', r'const MAX_BODY = (\d+);', int)],
    'grey screen cells': [('firmware/wayback/wb_grey.h', r'#define GL_CELLS (\d+)u', int),
                          ('js/screen_proof.js', r'MAX_CELLS = (\d+),', int)],
    'elevation columns': [('firmware/elev/elev.h', r'#define EL_COLS (\d+)u', int), ('js/elevation_section.js', r'COLS: (\d+),', int)],
    'elevation block B': [('firmware/elev/elev.h', r'#define EL_BLOCK (\d+)u', int), ('js/elevation_section.js', r'BLOCK: (\d+),', int)],
    'node distance max m': [('firmware/wayback/wayback.c', r'\(hi >> 19\) & (0x[0-9A-F]+)u', lambda s: 2 * int(s, 0)),   # 2 m steps
                            ('js/wayback_format.js', r'MAX_DIST_M_V3 = (\d+);', int)],
    'extra length max dm': [('firmware/wayback/wayback.c', r'WB_EXTRA_LEN_MASK (0x[0-9A-F]+)u', HEX_OR_DEC),
                            ('js/wayback_format.js', r'MAX_LEN_DM_V2 = (0x[0-9A-F]+);', HEX_OR_DEC)],
    'piece units max': [('firmware/wayback/wayback.c', r'dx > (\d+) \|\|', int),
                        ('firmware/wayback/wayback.c', r'#define WB_NEAR (\d+)u', lambda s: int(s) - 240),
                        ('js/wayback_format.js', r'MAX_PIECE_UNITS = (\d+);', int)],
    'block entry points max': [('firmware/mapdec/mapdec.c', r'#define MD_CNT_MAX (\d+)u', int),
                               ('js/map_codec.js', r'const CNT_MAX = (\d+);', int)],
    'area start': [('tools/area2_image.py', r'AREA_LIMIT = AREA_END - (0x[0-9A-Fa-f]+)', HEX_OR_DEC),
                   ('tools/cc26_build.py', r'if not (0x[0-9a-f]+) <= word', HEX_OR_DEC)],
    'area end': [('tools/area2_image.py', r'AREA_END = (0x[0-9a-f]+)', HEX_OR_DEC),
                 ('tools/cc26_build.py', r'<= word < (0x[0-9a-f]+)', HEX_OR_DEC)],
}
# Writers of each layer format: (layer, format, regex of a call outside the tests).
WRITERS = [('way-back', 'version 1', r'\bencodeWayback\('), ('way-back', 'version 3', r'\bencodeWaybackV3\('),
           ('map block', 'protobuf', r'fb\(2, \[\.\.\.fu\(1, n\)'), ('map block', 'scheme D', r'\bencodeBlockD\(')]


def git(*args):
    return subprocess.run(['git', '-C', str(ROOT), *args], capture_output=True, text=True, check=True).stdout


def say(results, gate, ok, text):
    results.append((gate, ok, text))
    print(f'{gate} {"PASS" if ok is True else "FAIL" if ok is False else "INFO"}  {text}')


def coord_pairs(text):
    """Coordinate pairs in text: two decimals with 4 or more fraction digits, each a plausible degree value."""
    out = []
    for m in COORD_PAIR.finditer(text):
        a, b = (float(v) for v in re.split(r'\s*,\s*', m.group(0)))
        if abs(a) <= 90 and abs(b) <= 180 and (abs(a) > 1 or abs(b) > 1):
            out.append(m.group(0))
    return out


def g1_public(r, since):
    tracked = git('ls-files').split()
    bad = [p for p in tracked if p.startswith('.local/') or p.endswith(PRIVATE_EXT)]
    say(r, 'G1', not bad, f'tracked private paths or binaries: {len(bad)}' + (f' ({bad[0]})' if bad else ''))
    hits = []
    for line in git('diff', '-U0', since, 'HEAD').splitlines():
        if line.startswith('+++ '):
            name = line[6:]
        elif line.startswith('+'):
            hits += [f'{name}: {p}' for p in coord_pairs(line)]
    say(r, 'G1', not hits, f'coordinate pairs in added lines: {len(hits)}' + (f' ({hits[0]})' if hits else ''))


def g2_runner(r, since):
    runner = (ROOT / 'tools/validate_local.py').read_text()
    changed = [p for p in git('diff', '--name-only', since, 'HEAD').split() if re.fullmatch(r'tools/test_.*\.mjs', p)]
    missing = [p for p in changed if (ROOT / p).exists() and Path(p).name not in runner]
    say(r, 'G2', not missing, 'node suites of the range that the runner does not run: ' + (', '.join(missing) or 'none'))


def c_sources(since):
    return [p for p in git('diff', '--name-only', since, 'HEAD').split()
            if p.startswith('firmware/') and p.endswith('.c') and (ROOT / p).exists()]


def g3_c(r, since):
    for p in c_sources(since):
        text = (ROOT / p).read_text()
        code = re.sub(r'/\*.*?\*/|//[^\n]*', '', text, flags=re.S)
        calls = sorted(set(LIB_CALL.findall(code)) - ({'free'} if 'mapdec' in p else set()))
        top = [l for l in code.splitlines() if re.match(r'(?!(static\s+)?(const|typedef|extern)\b)'   # a const table is not writable
                                                         r'[A-Za-z_][\w\s\*]*\b\w+(\[[^\]]*\])?\s*(=[^;]*)?;\s*$', l)]
        floats = re.findall(r'\b(float|double)\b', code) if p in CORE_NO_FLOAT else []
        cc = subprocess.run(['cc', '-std=gnu11', '-DHOST', '-Wall', '-Wextra', '-Wshadow', '-Wvla', '-Werror',
                             '-fsyntax-only', '-I', str(ROOT / Path(p).parent), str(ROOT / p)], capture_output=True, text=True)
        ok = not calls and not top and not floats and cc.returncode == 0
        detail = [f'library calls {calls}' if calls else '', f'file-scope variables {top[:1]}' if top else '',
                  f'float in the core: {len(floats)}' if floats else '', cc.stderr.strip().splitlines()[0] if cc.returncode else '']
        say(r, 'G3', ok, f'{p}: ' + ('; '.join(d for d in detail if d) or 'host -Werror build, no library call, no global'))


def stack_graph(tmp):
    """{function: (own bytes, {callees})} from -fcallgraph-info=su of the cc27 adapter tree."""
    fw = ROOT / 'firmware'
    inc = [a for d in ('common', 'raster', 'view', 'elev', 'wayback') for a in ('-I', str(fw / d))]
    subprocess.run([str(XT) + 'gcc', '-Os', '-mlongcalls', '-mtext-section-literals', '-ffreestanding', '-fno-builtin',
                    '-nostdlib', '-std=gnu11', '-fcallgraph-info=su', *inc, '-c', *(str(fw / d / n) for d, n in STACK_SOURCES)],
                   cwd=tmp, check=True, capture_output=True)
    nodes, edges = {}, {}
    name = lambda t: t.split(':')[-1]   # a compiler clone (name$constprop$0) is its own node
    for ci in tmp.glob('*.ci'):
        for line in ci.read_text().splitlines():
            m = re.match(r'node: \{ title: "([^"]+)" label: "[^\\]+\\n[^\\]+\\n(\d+) bytes', line)
            if m:
                nodes[name(m[1])] = int(m[2])
            m = re.match(r'edge: \{ sourcename: "([^"]+)" targetname: "([^"]+)"', line)
            if m and m[2] == '__indirect_call':
                if ci.name in CORE_FILES:
                    edges.setdefault(name(m[1]), set()).update(CALLBACKS)
            elif m:
                edges.setdefault(name(m[1]), set()).add(name(m[2]))
    return nodes, edges


def deepest(nodes, edges, f, seen=()):
    """(bytes, path) of the deepest call chain from f."""
    if f in seen:
        raise ValueError('recursion: ' + ' > '.join(seen + (f,)))
    best = (0, [])
    for g in edges.get(f, ()):
        if g in nodes or g in edges:
            best = max(best, deepest(nodes, edges, g, seen + (f,)))
    return nodes.get(f, 0) + best[0], [f] + best[1]


def g4_stack(r):
    if not Path(str(XT) + 'gcc').exists():
        say(r, 'G4', None, 'device compiler absent: stack not measured')
        return
    with tempfile.TemporaryDirectory() as t:
        nodes, edges = stack_graph(Path(t))
    total, path = deepest(nodes, edges, STACK_ROOT)
    # Each indirect call of the core counts as the deepest callback: the value is an upper bound.
    say(r, 'G4', total < STACK_LIMIT, f'deepest path (upper bound) {total} B of {STACK_LIMIT} B: ' + ' > '.join(path))
    say(r, 'G4', None, f'room left for the stock calls (fread, cc_line): at least {STACK_LIMIT - total} B, not measured')


def g5_limits(r):
    for name, places in LIMITS.items():
        vals = []
        for f, rx, conv in places:
            m = re.search(rx, (ROOT / f).read_text())
            vals.append((f, conv(m.group(1)) if m else None))
        ok = all(v is not None for _, v in vals) and len({v for _, v in vals}) == 1
        say(r, 'G5', ok, f'{name}: ' + ', '.join(f'{Path(f).name}={v}' for f, v in vals))


def g6_formats(r):
    files = [p for p in git('ls-files', 'js', 'tools').split() if p.endswith(('.js', '.mjs'))
             and not Path(p).name.startswith('test_')]
    for layer, fmt, rx in WRITERS:
        users = sorted(p for p in files if re.search(rx, (ROOT / p).read_text()) and
                       not re.search(r'export function ' + rx[2:], (ROOT / p).read_text()))
        say(r, 'G6', None, f'{layer} {fmt} writers: ' + (', '.join(users) or 'none'))


def g7_image(r):
    sys.path.insert(0, str(ROOT / 'tools'))
    import cc26_build
    import wayback_device_build as wdb
    m = json.loads((PACK / 'manifest-cc26.json').read_text())
    commit = m['source_commit']
    drift = git('diff', '--name-only', commit, 'HEAD', '--', 'firmware/wayback', 'firmware/mapdraw', 'tools/cc26_build.py',
                'tools/area2_image.py', 'tools/incoming_refs.py', 'tools/wayback_device_build.py').split()
    say(r, 'G7', not drift, f'sources changed since {commit}: ' + (', '.join(drift) or 'none'))
    wdb.source_mark = lambda: m['version'][-7:]   # the build mark (the commit before the 18 Nov time rewrite)
    with tempfile.TemporaryDirectory() as t:
        image, _ = cc26_build.build((ROOT / '.local/cc25/ota_1_cc25.bin').read_bytes(), Path(t))
    got = hashlib.sha256(image).hexdigest()
    say(r, 'G7', got == m['image_sha256'], f'rebuilt image {got[:16]}, pack {m["image_sha256"][:16]}')


def g8_release(r):
    m = json.loads((PACK / 'manifest-cc26.json').read_text())
    text = RELEASE.read_text()
    f = re.search(r'\| File \| `([^`]+)`', text)
    path = ROOT / f.group(1) if f else None
    real = hashlib.sha256(path.read_bytes()).hexdigest() if path and path.exists() else None
    say(r, 'G8', real == m['image_sha256'], f'release file {f.group(1) if f else "?"}: SHA-256 {str(real)[:16]}')
    for k, v in (('image SHA-256', m['image_sha256']), ('image bytes', f'{m["image_bytes"]:,}'),
                 ('code bytes', f'{m["code_bytes"]:,}')):
        say(r, 'G8', v in text, f'release text has the {k} {v[:16]}')


def g9_tests(r, since):
    v = subprocess.run([sys.executable, '-I', 'tools/validate_local.py'], cwd=ROOT, capture_output=True, text=True)
    tail = (v.stdout.strip().splitlines() or [''])[-1]
    say(r, 'G9', v.returncode in (0, 2), f'validate_local.py exit {v.returncode} (2 = known gaps): {tail[:120]}')
    runner = (ROOT / 'tools/validate_local.py').read_text()
    changed = set(git('diff', '--name-only', since, 'HEAD').split())
    rest = sorted(p.name for p in (ROOT / 'tools').glob('test_*.mjs')
                  if p.name not in runner and f'tools/{p.name}' in changed)   # older suites need a browser or inputs
    for name in rest:
        t = subprocess.run(['node', '--test', 'tools/' + name], cwd=ROOT, capture_output=True, text=True)
        n = re.search(r'ℹ pass (\d+)', t.stdout)
        say(r, 'G9', t.returncode == 0, f'{name}: exit {t.returncode}, pass {n.group(1) if n else "?"}')


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--since', required=True)
    p.add_argument('--tests', action='store_true')
    p.add_argument('--image', action='store_true')
    a = p.parse_args()
    r = []
    g1_public(r, a.since)
    g2_runner(r, a.since)
    g3_c(r, a.since)
    g4_stack(r)
    g5_limits(r)
    g6_formats(r)
    if a.image:
        g7_image(r)
    g8_release(r)
    if a.tests:
        g9_tests(r, a.since)
    failed = [x for x in r if x[1] is False]
    print(f'{len(failed)} failed, {sum(x[1] is True for x in r)} passed, {sum(x[1] is None for x in r)} info')
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
