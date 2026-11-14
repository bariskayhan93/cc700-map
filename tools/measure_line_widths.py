#!/usr/bin/env python3
"""Measure route-line and road widths in CC700 photos and preview renders.

Finds the display area (bright rectangle), rescales to a 240-px-wide device
screen, then measures perpendicular run lengths of:
  - route red pixels (near #d62828, red-dominant, saturated),
  - white road cores bounded by dark edges.
Reports medians in device pixels. Read-only.

Usage: python3 -I measure_line_widths.py <image> [--label NAME]
Run with a Pillow-capable interpreter.
"""
import sys

from PIL import Image


def load(path):
    im = Image.open(path)
    im = im.convert("RGB")
    return im


def find_screen(im):
    """Return (x0, y0, x1, y1) of the bright display area."""
    g = im.convert("L")
    w, h = g.size
    px = g.load()
    # threshold: screen is much brighter than bezel
    lit = [[1 if px[x, y] > 90 else 0 for x in range(w)] for y in range(0, h, 4)]
    cols = [sum(lit[y][x] for y in range(len(lit))) for x in range(w)]
    rows = [sum(r) for r in lit]
    def span(v, frac=0.45):
        n = max(v) or 1
        xs = [i for i, c in enumerate(v) if c > frac * n]
        return min(xs), max(xs)
    x0, x1 = span(cols)
    y0, y1 = span(rows)
    return x0, y0 * 4, x1, y1 * 4


def is_route(r, g, b):
    return r > 120 and r > g * 1.8 and r > b * 1.8 and (r - max(g, b)) > 50


def is_white(r, g, b):
    return r > 205 and g > 205 and b > 200


def is_edge(r, g, b):
    return r < 120 and g < 120 and b < 130


def measure(im, label):
    x0, y0, x1, y1 = find_screen(im)
    sw = x1 - x0
    scale = 240.0 / sw
    px = im.load()
    route_runs, core_runs, edge_runs = [], [], []
    for y in range(y0 + 2, y1 - 2, 1):
        run = 0
        for x in range(x0, x1):
            r, g, b = px[x, y]
            if is_route(r, g, b):
                run += 1
            else:
                if run:
                    route_runs.append(run)
                run = 0
        if run:
            route_runs.append(run)
    # white cores with dark edges: horizontal scan for edge..white..edge triples
    for y in range(y0 + 2, y1 - 2, 2):
        x = x0
        while x < x1 - 4:
            r, g, b = px[x, y]
            if is_edge(r, g, b):
                e = 1
                while x + e < x1 and is_edge(*px[x + e, y]):
                    e += 1
                w = 0
                xx = x + e
                while xx + w < x1 and is_white(*px[xx + w, y]):
                    w += 1
                if w >= 1 and xx + w + 1 < x1 and is_edge(*px[xx + w, y]):
                    core_runs.append(w)
                    edge_runs.append(e)
                x = xx + w
            else:
                x += 1

    def med(v):
        v = sorted(v)
        return (v[len(v) // 2] if v else 0)

    def top(v, n=6):
        return sorted(v, reverse=True)[:n]

    print(f"[{label}] screen {x1-x0}x{y1-y0} photo-px, scale {scale:.3f} device-px/photo-px")
    if route_runs:
        print(f"  route:  n={len(route_runs)}  median {med(route_runs)*scale:.1f}  "
              f"p90 {sorted(route_runs)[int(len(route_runs)*0.9)]*scale:.1f} device-px  "
              f"top runs(photo-px) {top(route_runs)}")
    else:
        print("  route:  none found")
    if core_runs:
        print(f"  cores:  n={len(core_runs)}  median {med(core_runs)*scale:.1f} device-px")
    if edge_runs:
        print(f"  edges:  n={len(edge_runs)}  median {med(edge_runs)*scale:.1f} device-px")
    if core_runs and route_runs:
        print(f"  route/core ratio ~ {med(route_runs)/max(1,med(core_runs)):.2f}")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    label = next((a[5:] for a in sys.argv[1:] if a.startswith("--label")), args[0])
    measure(load(args[0]), label)
