#!/usr/bin/env python3
"""Analyze a GPX track for self-approach/self-crossing geometry.

The CC700 patch picks the map block from the route section nearest to the
GPS position (blk.c cc_nearest_sec). Sections that pass the same corridor
twice (out-and-back, loops, crossings) are the known weak spot, so this
reports where non-adjacent parts of the track come close to each other.

Usage: python3 -I analyze_gpx_geometry.py <file.gpx>
"""
import math
import sys
import xml.etree.ElementTree as ET

NS = "{http://www.topografix.com/GPX/1/1}"


def load(path):
    root = ET.parse(path).getroot()
    pts = []
    for trkpt in root.iter(NS + "trkpt"):
        pts.append((float(trkpt.get("lat")), float(trkpt.get("lon"))))
    return pts


def main(path):
    pts = load(path)
    n = len(pts)
    if n < 2:
        print("too few points")
        return
    # local metric: metres per degree at this latitude
    lat0 = sum(p[0] for p in pts) / n
    ky = 111195.0
    kx = 111195.0 * math.cos(math.radians(lat0))
    m = lambda a, b: math.hypot((a[1] - b[1]) * kx, (a[0] - b[0]) * ky)

    total = 0.0
    cum = [0.0]
    for i in range(n - 1):
        total += m(pts[i], pts[i + 1])
        cum.append(total)

    print(f"points: {n}  total: {total:.0f} m")
    gaps = [m(pts[i], pts[i + 1]) for i in range(n - 1)]
    print(f"segment length: min {min(gaps):.1f}  max {max(gaps):.1f}  "
          f"mean {sum(gaps) / len(gaps):.1f} m")

    # non-adjacent self-approaches below 60 m (2x the 25 m hysteresis margin)
    print("\nnon-adjacent approaches < 60 m (meters along route):")
    hits = []
    for i in range(n - 1):
        ax, ay = pts[i][0], pts[i][1]
        bx, by = pts[i + 1][0], pts[i + 1][1]
        for j in range(i + 2, n - 1):
            if cum[j] - cum[i + 1] < 60:
                continue  # adjacent corridor, skip quickly
            if cum[j] - cum[i] > total:  # unreachable
                break
            cx, cy = pts[j][0], pts[j][1]
            dx, dy = pts[j + 1][0] - cx, pts[j + 1][1] - cy
            l2 = ((bx - ax) * dy - (by - ay) * dx)
            # cheap bounding-box reject in degrees before real math
            if max(ax, bx) + 0.001 < min(cx, pts[j + 1][0]) or \
               min(ax, bx) - 0.001 > max(cx, pts[j + 1][0]) or \
               max(ay, by) + 0.002 < min(cy, pts[j + 1][1]) or \
               min(ay, by) - 0.002 > max(cy, pts[j + 1][1]):
                continue
            # point-segment distances both ways (approximate, endpoint based)
            d = min(m(pts[i], pts[j]), m(pts[i + 1], pts[j]),
                    m(pts[i], pts[j + 1]), m(pts[i + 1], pts[j + 1]))
            if d < 60:
                hits.append((cum[i], cum[j], d))
    # collapse to the closest pair per corridor encounter
    shown = 0
    last_j = -1000.0
    for a, b, d in sorted(hits, key=lambda h: h[2]):
        if b - last_j < 100 and shown:
            continue
        print(f"  at {a:7.0f} m and {b:7.0f} m: {d:5.1f} m apart")
        last_j = b
        shown += 1
        if shown >= 25:
            print("  ... (more omitted)")
            break
    if not shown:
        print("  none")


if __name__ == "__main__":
    main(sys.argv[1])
