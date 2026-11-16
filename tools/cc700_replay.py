#!/usr/bin/env python3
"""Partial CC700 map coverage model, not full firmware simulation.

Calls cc_nearest_sec from preserved C source, with Python loader/gate models:
  - the route file the device navigated (points, sections, block index),
  - the ride's GPS track (FIT),
  - the device log's per-second road index (ground truth of the firmware matcher).

For each GPS sample it counts stored map vertices within an assumed 300 m
radius. This is not rendered visibility: edges can cross the screen without
nearby vertices, and projection, clipping, fills, allocations and timing are
not executed. Python point-to-section mapping is reconstructed, not a capture
of firmware point payload +40. Missing road values are explicitly held.

With --loader-source, also execute the complete loader/gate/selector C using
host address adapters and a disclosed single-file stock-resolver fixture.

Usage:
  python3 -I cc700_replay.py <route.bin> <ride.fit.raw|extracted> <device.log> [--fix]
"""
import ctypes
import argparse
from datetime import datetime
import math
import os
import re
import struct
import subprocess
import sys
import tempfile
from pathlib import Path
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.expanduser("~/cc700-backup/tools"))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ride import route  # noqa: E402
from fit_track import read_track  # noqa: E402

KY = 111195.0
PATCH_SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".local", "cc700-evidence-20261113", "patch", "src", "blk.c")
SCREEN_R = 300.0  # m: half-diagonal of the visible map at typical zoom


def point_callback(arr, callback_type):
    """Keep each point at a distinct stable address while C reads a segment."""
    def cb(i):
        return ctypes.addressof(arr) + 2 * i * ctypes.sizeof(ctypes.c_float)
    return callback_type(cb)


def visibility_proxy(coverage, yaw, gate_bypassed):
    """Three-valued vertex-coverage proxy; None means missing gate evidence."""
    if not coverage:
        return False
    if gate_bypassed:
        return True
    return None if yaw is None else yaw == 0


def build_lib():
    """Compile the real cc_nearest_sec from the patch source into a host .so."""
    so = os.path.join(tempfile.gettempdir(), "libblk_replay.so")
    subprocess.run(
        ["cc", "-shared", "-fPIC", "-O2", "-DHOST", "-o", so, PATCH_SRC],
        check=True, capture_output=True)
    return so


def load_points_sections_blocks(path):
    f, secs = route(path)
    mo = struct.unpack_from("<I", f, 0x5c)[0]
    L = struct.unpack_from("<I", f, mo)[0]
    from ride import parse
    offs = [dict(parse(v)).get(1, 0) for k, v in parse(f[mo + 4:mo + 4 + L]) if k == 2]
    body = mo + 4 + L
    blocks = {}
    for o in offs:
        if o in blocks:
            continue
        bl = struct.unpack_from("<I", f, body + o)[0]
        pts = []
        from ride import unzz, SC
        for k, v in parse(f[body + o + 4:body + o + 4 + bl]):
            if k != 2:
                continue
            for a, b in parse(v):
                if a == 6:
                    q = dict(parse(b))
                    pts.append((unzz(q.get(1, 0)) * SC, unzz(q.get(2, 0)) * SC))
        blocks[o] = pts
    # device point list: all section points, shared endpoints de-duplicated
    pts, sec_start = [], []
    for s in secs:
        sec_start.append(max(0, len(pts) - 1))
        for j, p in enumerate(s["pts"]):
            if j == 0 and pts:
                continue
            pts.append((p[0], p[1]))
    return pts, sec_start, offs, blocks


def load_log_roads(path):
    """Return {HH:MM:SS: {road?, yaw?}}; missing values remain missing."""
    out = {}
    lines = Path(path).read_bytes().decode("latin1").split("\n")
    for l in lines:
        m = re.match(r"\[\w\]:\S+ (\d\d:\d\d:\d\d)", l)
        if not m:
            continue
        t = m.group(1)
        r = re.search(r"AllPointNum:\d+,road:(\d+),", l)
        if r:
            out.setdefault(t, {})["road"] = int(r.group(1))
        y = re.search(r"YawFlag:(\d+)", l)
        if y:
            out.setdefault(t, {})["yaw"] = int(y.group(1))
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("route_bin")
    parser.add_argument("fit_path")
    parser.add_argument("log_path")
    parser.add_argument("--fix", action="store_true", help="Model the v17 draw-gate bypass")
    parser.add_argument("--log-timezone", default="Europe/Berlin", help="Timezone of device log, default Europe/Berlin")
    parser.add_argument("--loader-source", type=Path, help="Also execute complete loader/gate C through host address adapters")
    parser.add_argument("--file-type", type=int, default=0, help="Single route file slot for full C replay; default 0")
    args = parser.parse_args()
    route_bin, fit_path, log_path, fix = args.route_bin, args.fit_path, args.log_path, args.fix
    log_tz = ZoneInfo(args.log_timezone)
    pts, sec_start, offs, blocks = load_points_sections_blocks(route_bin)
    npt, nsec = len(pts), len(sec_start)
    print(f"route: {npt} points, {nsec} sections, {len(blocks)} blocks")

    rec = read_track(fit_path, tz_offset=0)
    print(f"ride: {len(rec)} fixes")
    print(f"partial coverage model; log timezone {args.log_timezone}; radius {SCREEN_R:g} m")
    log = load_log_roads(log_path)
    loader = None
    if args.loader_source:
        from patch_loader_host import LoaderHost
        loader = LoaderHost(args.loader_source)
        print(f"full loader/gate C SHA-256: {loader.source_sha256}; single-file slot {args.file_type}")

    so = build_lib()
    lib = ctypes.CDLL(so)
    FT = ctypes.c_float
    PFT = ctypes.POINTER(FT)
    CB = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_uint32)  # float* as void*
    lib.cc_nearest_sec.restype = ctypes.c_uint32
    lib.cc_nearest_sec.argtypes = [PFT, ctypes.c_uint32, CB, ctypes.c_uint32]

    arr = (FT * (2 * npt))()
    for i, (la, lo) in enumerate(pts):
        arr[2 * i], arr[2 * i + 1] = la, lo
    pt_at = point_callback(arr, CB)

    pos = (FT * 2)()

    def sec_of(pi):  # section containing point index pi
        for s in range(nsec - 1, -1, -1):
            if pi >= sec_start[s]:
                return s
        return 0

    payload_roads = [sec_of(i) for i in range(npt)]
    if payload_roads:
        payload_roads[-1] = nsec  # final endpoint has no outgoing section

    # bucket block points into a coarse grid for fast coverage counts
    def coverage(off, la, lo):
        kx = KY * math.cos(math.radians(la))
        bx = [p[1] * kx for p in blocks[off]]
        by = [p[0] * KY for p in blocks[off]]
        n = 0
        for x, y in zip(bx, by):
            dx = x - lo * kx
            dy = y - la * KY
            if dx * dx + dy * dy < SCREEN_R * SCREEN_R:
                n += 1
        return n

    print("\ntime     road_fw  point-segment  v16-sec  v17-sec  v16-nearby-vertices  yaw")
    from collections import Counter
    stats = Counter()
    blanks_v16 = blanks_fixed = unknown_v16 = unknown_fixed = 0
    held_roads = missing_yaws = 0
    for ts, la, lo in rec:
        if ts is None:
            continue
        hh_mm_ss = datetime.fromtimestamp(ts, log_tz).strftime("%H:%M:%S")
        key = hh_mm_ss
        road_fw = (log.get(key) or {}).get("road")
        if road_fw is None:  # hold last known
            held_roads += 1
            road_fw = stats.get("last_road", 0)
        stats["last_road"] = road_fw
        yaw = (log.get(key) or {}).get("yaw")
        missing_yaws += yaw is None
        pos[0], pos[1] = la, lo
        pi = lib.cc_nearest_sec(pos, npt, pt_at, road_fw)
        sec = sec_of(pi) if pi < npt else nsec - 1
        used_v16 = pi if pi < len(offs) else len(offs) - 1
        # v17: point index -> its section (fw point payload +40), follow only when
        # the firmware index is stuck or behind by more than one section
        d = sec - road_fw if sec >= road_fw else road_fw - sec
        used_fix = sec if d > 1 else road_fw
        off_v16, off_fix = offs[used_v16], offs[used_fix]
        cov_v16 = coverage(off_v16, la, lo)
        cov_fix = coverage(off_fix, la, lo)
        # v16 as shipped also honors the stock off-route draw gate; v17 bypasses it
        vis_v16 = visibility_proxy(cov_v16, yaw, False)
        vis_fix = visibility_proxy(cov_fix, yaw, fix)
        if loader is not None:
            loader.setup(pts, payload_roads, (la,lo), len(offs),
                         mappings=[(args.file_type,i) for i in range(nsec+1)], degrees=True)
            selected=loader.run(road_fw,args.file_type)
            loader.lib.cc_gate()
            draw=loader.lib.host_metric(6)>0
            used=selected["section"]
            visible=used is not None and draw and coverage(offs[used],la,lo)>0
            stats["loader_absent"] += not visible
            stats["loader_indexed_lookups"] += selected["indexed_lookups"]
            stats["loader_resolutions"] += selected["resolutions"]
            off=offs[used] if used is not None else None
            if "loader_block" in stats and stats["loader_block"]!=off:
                stats["loader_switches"]+=1
            stats["loader_block"]=off
        blanks_v16 += vis_v16 is False
        blanks_fixed += vis_fix is False
        unknown_v16 += vis_v16 is None
        unknown_fixed += vis_fix is None
        prev_block_fix = stats.get("block_fix")
        if prev_block_fix is not None and prev_block_fix != off_fix:
            stats["switches"] = stats.get("switches", 0) + 1
        stats["block_fix"] = off_fix
        if key.endswith("0") or key.endswith("5"):  # sample every 5 s
            print(f"{key}  {road_fw:5d}  {pi:5d}  {used_v16:4d}  "
                  f"{used_fix:4d}   {cov_v16:5d}     yaw={yaw}")
    tot = len([1 for r in rec if r[0]])
    print(f"\ncoverage-proxy absent samples: v16 {blanks_v16}/{tot}, unknown {unknown_v16}; "
          f"v17 {'(gate bypassed)' if fix else '(gate active)'} {blanks_fixed}/{tot}, unknown {unknown_fixed}")
    print(f"missing exact-second log evidence: road held {held_roads}/{tot}; yaw unknown {missing_yaws}/{tot}")
    timestamps = [r[0] for r in rec if r[0] is not None]
    elapsed = max(timestamps) - min(timestamps) if timestamps else 0
    print(f"v17 modeled block switches: {stats.get('switches', 0)}; {tot} samples over {elapsed} elapsed seconds")
    if loader is not None:
        print(f"full loader C: coverage-proxy absent {stats['loader_absent']}/{tot}; "
              f"block switches {stats['loader_switches']}; indexed lookups {stats['loader_indexed_lookups']}; "
              f"section resolutions {stats['loader_resolutions']}")
        print("Stock resolver uses a single-file fixture; GPS filtering, scheduling and rendered visibility remain outside replay.")
        loader.close()


if __name__ == "__main__":
    main()
