#!/usr/bin/env python3
"""Route file map-block audit for the CC700.

Decodes a route_*.bin exactly as the patched loader sees it: the per-section
block index at header 0x5c, every block's entries, and each block's geographic
window. Cross-checks which block should be visible at a given route distance
and whether that block has entries near the route there.

Usage: python3 -I route_block_audit.py <route.bin> [--at DISTANCE_M]
"""
import math
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "cc700-backup/tools"))
from ride import route, parse, unzz, SC  # noqa: E402

KY = 111195.0


def blocks_of(f):
    mo = struct.unpack_from("<I", f, 0x5c)[0]
    L = struct.unpack_from("<I", f, mo)[0]
    offs = [dict(parse(v)).get(1, 0) for k, v in parse(f[mo + 4:mo + 4 + L]) if k == 2]
    body = mo + 4 + L
    out = []
    for o in offs:
        bl = struct.unpack_from("<I", f, body + o)[0]
        ents = []
        for k, v in parse(f[body + o + 4:body + o + 4 + bl]):
            if k != 2:
                continue
            e = parse(v)
            n = st = la = lo = 0
            pts = []
            for a, b in e:
                if a == 1:
                    n = b
                elif a == 2:
                    st = b
                elif a == 3:
                    la = unzz(b)
                elif a == 4:
                    lo = unzz(b)
                elif a == 6:
                    q = dict(parse(b))
                    pts.append((unzz(q.get(1, 0)), unzz(q.get(2, 0))))
            ents.append((n, st, la, lo, pts))
        out.append({"off": o, "bytes": 4 + bl, "ents": ents})
    return offs, body, out


def entry_geometry(entry):
    """Encoded class-12 point pairs are UTF-8 payload, not coordinates."""
    _, style, lat, lon, points = entry
    return [] if style & 15 == 12 else [(lat, lon), *points]


def main(path, at=None):
    f, secs = route(path)
    offs, body, blocks = blocks_of(f)
    uniq = sorted({b["off"] for b in blocks})
    by_off = {b["off"]: b for b in blocks}

    print(f"file: {len(f)} bytes, {len(secs)} sections, "
          f"{len(offs)} index entries, {len(uniq)} distinct blocks")
    total = secs[-1]["pts"][-1][2] if secs else 0
    print(f"route length: {total:.0f} m")

    # cumulative distance of section boundaries
    bounds = [0.0]
    for s in secs:
        bounds.append(s["pts"][-1][2])

    print("\nsec  len_m  pts  block_off  entries  block_covers_m")
    for i, s in enumerate(secs):
        off = offs[i] if i < len(offs) else None
        b = by_off.get(off)
        # which route distances does this block's index span cover
        span = [j for j, o in enumerate(offs) if o == off]
        cover = f"{bounds[min(span)]:.0f}-{bounds[max(span) + 1]:.0f}" if span else "?"
        print(f"{i:3d} {s['len']:6.0f} {s['cnt']:4d}  {off:8d}  "
              f"{len(b['ents']) if b else 0:7d}  {cover}")

    print("\nblock  off     bytes  entries  pts  styled  window(lat/lon box, m)")
    for u in uniq:
        b = by_off[u]
        lat0 = 51.18
        kx = KY * math.cos(math.radians(lat0))
        xs = [p[1] * SC * kx for e in b["ents"] for p in entry_geometry(e)]
        ys = [p[0] * SC * KY for e in b["ents"] for p in entry_geometry(e)]
        if not xs:
            print(f"{u:6d} {b['bytes']:7d}  {len(b['ents']):7d}  EMPTY BLOCK")
            continue
        w = max(xs) - min(xs)
        h = max(ys) - min(ys)
        print(f"{u:6d} {b['bytes']:7d}  {len(b['ents']):7d}  "
              f"{sum(len(e[4]) for e in b['ents']):4d}  "
              f"{sum(1 for e in b['ents'] if e[1]):6d}  "
              f"{w:.0f} x {h:.0f}  centre "
              f"({(min(ys)+max(ys))/2/KY:.5f},{(min(xs)+max(xs))/2/kx:.5f})")

    if at is not None:
        k = next((i for i, s in enumerate(secs) if s["pts"][-1][2] >= at), len(secs) - 1)
        off = offs[k]
        b = by_off[off]
        # nearest route point to 'at'
        pt = min((p for s in secs for p in s["pts"]), key=lambda p: abs(p[2] - at))
        kx = KY * math.cos(math.radians(pt[0]))
        near = 0
        dmin = 1e9
        for e in b["ents"]:
            for p in entry_geometry(e):
                d = math.hypot((p[1] * SC - pt[1]) * kx, (p[0] * SC - pt[0]) * KY)
                dmin = min(dmin, d)
                if d < 250:
                    near += 1
        print(f"\n-- at {at:.0f} m: section {k}, block off {off}, "
              f"{len(b['ents'])} entries; nearest entry point {dmin:.0f} m, "
              f"{near} points within 250 m of ({pt[0]:.6f},{pt[1]:.6f})")


if __name__ == "__main__":
    dist = None
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(sys.argv) > 3 and sys.argv[2] == "--at":
        dist = float(sys.argv[3])
    main(args[0], dist)
