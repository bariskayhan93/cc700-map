// Far map (route-file section type 4 "CCFM", version 1). Design: docs/superpowers/specs/2026-11-23-far-map-design.md.
// Ways with their class outside the detail reach of the class, and green and water areas, cut at 256 m cells on the
// 0.5 m grid of the way-back frame. The unit draws it in every map frame under the detail map (firmware/wayback/wb_far.c).
// Pure code: the page and the host tools use it.
import {forEachScreen, lineWorkBound} from './screen_proof.js';
import {makeFrame} from './wayback_format.js';
import {REACH} from './wayback_tree.js';
import {bikeWay} from './recovery_graph.js';
import {HANDOVER_M, MAIN_HANDOVER_M} from './mapsec.js';

export const FAR = {MAIN: 0, MINOR: 1, CYCLE: 2, TRACK: 3, PATH: 4, WATERLINE: 5, WATER: 8, FOREST: 9, GREEN: 10, BUILT: 11};
export const FAR_CAPS = {pixCap: 150000, ptCap: 4096, fillCap: 61440};   // the unit checks pixCap and ptCap; fillCap is written but not read; FAR_US 150 ms is an emergency stop only
const MAGIC = [0x43, 0x43, 0x46, 0x4D];          // "CCFM"
const VERSION = 1, CELL_SHIFT = 12, Q_SHIFT = 3, CELL = 1 << CELL_SHIFT, Q = 1 << Q_SHIFT, U_M = 16;
const MAX_POINTS = 32, MAX_RING = 64, MAX_BODY = 2048, MAX_CELLS = 16384, MAX_KEYS = 256, HEADER = 48, ENTRY = 8, SENTINEL = 0xFFFFFFFF;
const LINE_TOL = 40, AREA_TOL = 12 * U_M, AREA_MIN = 5000, STEP_M = 20;
// detail reach of each line class; the far line starts where the detail map stops. WP 6: a file with a far map carries the
// handover detail map (js/mapsec.js HANDOVER_M, MAIN_HANDOVER_M), so small classes hand over at 300 m and main roads at 600 m.
export const DETAIL_REACH = {[FAR.MAIN]: MAIN_HANDOVER_M, [FAR.MINOR]: HANDOVER_M, [FAR.CYCLE]: HANDOVER_M, [FAR.TRACK]: HANDOVER_M, [FAR.PATH]: HANDOVER_M, [FAR.WATERLINE]: HANDOVER_M};
// unit draw order and widths in pixels (edge, core)
// streets in style D as the unit draws and counts them (wb_far.c fm_style: edge 4 + core 2, 0f1d019), main roads one thin line
export const DRAW_ORDER = [FAR.BUILT, FAR.WATER, FAR.FOREST, FAR.GREEN, FAR.WATERLINE, FAR.PATH, FAR.TRACK, FAR.CYCLE, FAR.MINOR, FAR.MAIN];
export const WIDTHS = {[FAR.MAIN]: [4], [FAR.MINOR]: [4, 2], [FAR.CYCLE]: [2], [FAR.TRACK]: [2], [FAR.PATH]: [1], [FAR.WATERLINE]: [2]};

const MAIN = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
// Bike rule (js/recovery_graph.js bikeWay): ways to ride and exit ways (WP 6) are drawn; motorways, driveways, private ways, trails are cut.
export function farClassOf(t = {}) {
  const h = t.highway;
  if (!h) return ['river', 'stream', 'canal'].includes(t.waterway) ? FAR.WATERLINE : null;
  const bw = bikeWay(t);
  if (bw === 'exit') return h === 'track' ? FAR.TRACK : FAR.PATH;   // WP 6: the way-back graph uses exit ways, so the map shows them
  if (bw !== 'ride') return null;
  if (MAIN.has(h)) return FAR.MAIN;
  if (h === 'cycleway' || t.bicycle === 'designated') return FAR.CYCLE;
  if (h === 'track') return FAR.TRACK;
  if (h === 'path' || h === 'footway' || h === 'bridleway' || h === 'pedestrian' || h === 'steps') return FAR.PATH;
  return FAR.MINOR;
}
const GREEN_LU = new Set(['grass', 'meadow', 'recreation_ground', 'village_green', 'allotments', 'cemetery', 'orchard']);
const GREEN_LE = new Set(['park', 'garden', 'golf_course', 'nature_reserve']), GREEN_NA = new Set(['scrub', 'heath', 'grassland', 'wetland']);
export function areaClassOf(t = {}) {
  if (['residential', 'commercial', 'industrial', 'retail'].includes(t.landuse)) return FAR.BUILT;
  if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir' || t.landuse === 'basin') return FAR.WATER;
  if (t.landuse === 'forest' || t.natural === 'wood') return FAR.FOREST;
  if (GREEN_LU.has(t.landuse) || GREEN_LE.has(t.leisure) || GREEN_NA.has(t.natural)) return FAR.GREEN;
  return null;
}

// Distance to the route in metres: a chamfer map on a 32 m grid over the route box plus the reach (error < 32 m).
function distanceMap(routeU, reachM) {
  const GS = 32 * U_M, pad = (reachM + 200) * U_M;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of routeU) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
  const NX = Math.ceil((x1 - x0) / GS) + 2, NY = Math.ceil((y1 - y0) / GS) + 2, D = new Float32Array(NX * NY).fill(1e9);
  // exact distance near the route (the cells next to it), chamfer beyond
  const seg = [];
  for (let i = 1; i < routeU.length; i++) seg.push([routeU[i - 1], routeU[i]]);
  const exact = (px, py) => { let b = Infinity; for (const [a, c] of seg) { const dx = c[0] - a[0], dy = c[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L)); b = Math.min(b, Math.hypot(px - a[0] - dx * t, py - a[1] - dy * t)); } return b / U_M; };
  for (const [a, c] of seg) { const n = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / (GS / 2)) || 1;
    for (let k = 0; k <= n; k++) { const gx = Math.round((a[0] + (c[0] - a[0]) * k / n - x0) / GS), gy = Math.round((a[1] + (c[1] - a[1]) * k / n - y0) / GS); D[gy * NX + gx] = 0; } }
  const d1 = 32, d2 = 32 * Math.SQRT2, at = (x, y) => y * NX + x;
  for (let y = 0; y < NY; y++) for (let x = 0; x < NX; x++) { let v = D[at(x, y)]; if (x) v = Math.min(v, D[at(x - 1, y)] + d1); if (y) { v = Math.min(v, D[at(x, y - 1)] + d1); if (x) v = Math.min(v, D[at(x - 1, y - 1)] + d2); if (x < NX - 1) v = Math.min(v, D[at(x + 1, y - 1)] + d2); } D[at(x, y)] = v; }
  for (let y = NY - 1; y >= 0; y--) for (let x = NX - 1; x >= 0; x--) { let v = D[at(x, y)]; if (x < NX - 1) v = Math.min(v, D[at(x + 1, y)] + d1); if (y < NY - 1) { v = Math.min(v, D[at(x, y + 1)] + d1); if (x < NX - 1) v = Math.min(v, D[at(x + 1, y + 1)] + d2); if (x) v = Math.min(v, D[at(x - 1, y + 1)] + d2); } D[at(x, y)] = v; }
  // near the reach limits the chamfer error matters: use the exact distance there (grid value within 1,200 m)
  return ([px, py]) => { const gx = Math.round((px - x0) / GS), gy = Math.round((py - y0) / GS);
    if (gx < 0 || gy < 0 || gx >= NX || gy >= NY) return 1e9; const g = D[at(gx, gy)]; return g <= 1200 ? exact(px, py) : g; };
}

function rdp(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1; const st = [[0, pts.length - 1]];
  while (st.length) { const [a, b] = st.pop(); let m = -1, md = tol; const [x1, y1] = pts[a], [x2, y2] = pts[b], L = Math.hypot(x2 - x1, y2 - y1);
    for (let i = a + 1; i < b; i++) { const d = L ? Math.abs((x2 - x1) * (y1 - pts[i][1]) - (x1 - pts[i][0]) * (y2 - y1)) / L : Math.hypot(pts[i][0] - x1, pts[i][1] - y1); if (d > md) { md = d; m = i; } }
    if (m >= 0) { keep[m] = 1; st.push([a, m], [m, b]); } }
  return pts.filter((_, i) => keep[i]);
}
const keyOf = (x, y) => ((Math.floor(y / CELL) << 16) | Math.floor(x / CELL)) >>> 0;
const snap = (v, c) => c + Q * Math.min(512, Math.max(0, Math.round((v - c) / Q)));

// Far runs of one way: densify to 20 m, keep the points outside the class reach and inside the reach; a run starts and
// ends at the interpolated reach crossing.
function farRuns(ptsU, dist, lim, reachM) {
  const D = [ptsU[0]];
  for (let i = 1; i < ptsU.length; i++) { const a = ptsU[i - 1], b = ptsU[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (STEP_M * U_M)));
    for (let k = 1; k <= n; k++) D.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  const d = D.map(dist), inFar = v => v > lim && v <= reachM, runs = []; let run = null;
  const cross = (i, j) => { const t = Math.max(0, Math.min(1, (lim - d[i]) / ((d[j] - d[i]) || 1))); return [D[i][0] + (D[j][0] - D[i][0]) * t, D[i][1] + (D[j][1] - D[i][1]) * t]; };
  for (let i = 0; i < D.length; i++) {
    if (inFar(d[i])) { if (!run) { run = i && d[i - 1] <= lim ? [cross(i - 1, i)] : []; runs.push(run); } run.push(D[i]); }
    else if (run) { if (d[i] <= lim) run.push(cross(i - 1, i)); run = null; }
  }
  return runs.filter(r => r.length >= 2);
}
// Split each segment at the cell borders, so every segment is inside one cell.
function atBorders(pts) {
  const out = [pts[0]];
  for (let k = 1; k < pts.length; k++) {
    const [ax, ay] = pts[k - 1], [bx, by] = pts[k], ts = [];
    for (const [a, b, dim] of [[ax, bx, 0], [ay, by, 1]]) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      for (let g = Math.ceil(lo / CELL) * CELL; g < hi; g += CELL) if (g > lo) ts.push((g - a) / (b - a));
    }
    for (const t of ts.sort((p, q) => p - q)) out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    out.push(pts[k]);
  }
  return out;
}
function cutLine(pts, add) {
  const s = atBorders(rdp(pts, LINE_TOL)); let cur = null;
  for (let k = 0; k + 1 < s.length; k++) {
    const key = keyOf((s[k][0] + s[k + 1][0]) / 2, (s[k][1] + s[k + 1][1]) / 2);
    if (!cur || cur.key !== key || cur.pts.length === MAX_POINTS) { cur = {key, pts: [s[k]]}; add(cur); }
    cur.pts.push(s[k + 1]);
  }
}
// Sutherland-Hodgman against one cell square
function clip(ring, x0, y0, x1, y1) {
  let out = ring;
  for (const [inside, hit] of [
    [p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
    [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [p => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
    [p => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]]]) {
    const inp = out; out = [];
    for (let i = 0; i < inp.length; i++) { const a = inp[(i + inp.length - 1) % inp.length], b = inp[i];
      if (inside(b)) { if (!inside(a)) out.push(hit(a, b)); out.push(b); } else if (inside(a)) out.push(hit(a, b)); }
    if (!out.length) break;
  }
  return out;
}
const ringArea = r => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);

// ways: [{tags, pts: [[lat, lon], ...]}]; areas: [{tags, rings: [[[lat, lon], ...], ...]}] (outer rings); route: [[lat, lon]].
// Returns cells [{key, items: [{cls, pts}]}], keys ascending, points on the 0.5 m grid of their cell.
export function buildFarCells({ways = [], areas = [], route, frame, reachM}) {
  const routeU = route.map(frame.toUnits), dist = distanceMap(routeU, reachM), byCell = new Map();
  const add = (cls, key, pts) => { if (!byCell.has(key)) byCell.set(key, []); byCell.get(key).push({cls, pts}); };
  for (const w of ways) {
    const cls = farClassOf(w.tags); if (cls === null || w.pts.length < 2) continue;
    for (const run of farRuns(w.pts.map(frame.toUnits), dist, DETAIL_REACH[cls], reachM)) cutLine(run, c => add(cls, c.key, c.pts));
  }
  for (const a of areas) {
    const cls = areaClassOf(a.tags); if (cls === null) continue;
    for (const ringLL of a.rings) {
      let ring = ringLL.map(frame.toUnits); if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring = ring.slice(0, -1);
      if (ring.length < 3 || ringArea(ring) / (U_M * U_M) < AREA_MIN) continue;
      if (!ring.some(p => dist(p) <= reachM)) continue;
      ring = rdp([...ring, ring[0]], AREA_TOL).slice(0, -1); if (ring.length < 3) continue;
      let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
      for (const [x, y] of ring) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
      for (let cy = Math.floor(by0 / CELL); cy <= Math.floor(by1 / CELL); cy++) for (let cx = Math.floor(bx0 / CELL); cx <= Math.floor(bx1 / CELL); cx++) {
        const X0 = cx * CELL, Y0 = cy * CELL;
        if (dist([X0 + CELL / 2, Y0 + CELL / 2]) > reachM + 200) continue;
        let part = clip(ring, X0, Y0, X0 + CELL, Y0 + CELL);
        if (part.length < 3 || ringArea(part) < Q * Q) continue;
        for (let tol = AREA_TOL; part.length > MAX_RING; tol *= 2) part = rdp([...part, part[0]], tol).slice(0, -1);
        add(cls, ((cy << 16) | cx) >>> 0, part);
      }
    }
  }
  return [...byCell.keys()].sort((a, b) => a - b).map(key => {
    const cx = (key & 0xFFFF) * CELL, cy = (key >>> 16) * CELL;
    return {key, items: byCell.get(key).map(i => ({cls: i.cls, pts: i.pts.map(([x, y]) => [snap(x, cx), snap(y, cy)])}))
      .filter(i => i.pts.length >= (i.cls >= FAR.WATER ? 3 : 2))};
  }).filter(c => c.items.length);
}

function varint(out, v) { let x = v >>> 0; while (x >= 0x80) { out.push((x & 0x7F) | 0x80); x >>>= 7; } out.push(x); }
const zz = v => (v >= 0 ? 2 * v : -2 * v - 1), unzz = z => (z % 2 === 0 ? z / 2 : -(z + 1) / 2);
function body(cell) {
  const out = [], cx = (cell.key & 0xFFFF) * CELL, cy = (cell.key >>> 16) * CELL;
  const groups = DRAW_ORDER.map(cls => [cls, cell.items.filter(i => i.cls === cls)]).filter(g => g[1].length);
  varint(out, groups.length);
  for (const [cls, items] of groups) {
    out.push(cls); varint(out, items.length);
    for (const {pts} of items) {
      const q = pts.map(([x, y]) => [(x - cx) / Q, (y - cy) / Q]), max = cls >= FAR.WATER ? MAX_RING : MAX_POINTS;
      if (q.length < 2 || q.length > max || q.some(([a, b]) => !Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > 512 || b > 512)) throw new Error('far map: bad item');
      varint(out, q.length); out.push(q[0][0] & 0xFF, q[0][0] >> 8, q[0][1] & 0xFF, q[0][1] >> 8);
      for (let k = 1; k < q.length; k++) { varint(out, zz(q[k][0] - q[k - 1][0])); varint(out, zz(q[k][1] - q[k - 1][1])); }
    }
  }
  if (out.length > MAX_BODY) throw new Error('far cell over 2048 B');
  return out;
}
// Header (48 B): "CCFM", cell shift, quantum shift, version, stride shift; u32 cells, body bytes, pixCap, ptCap, fillCap,
// directory keys; the unit frame i32 lat0E7, i32 lon0E7, u32 latU, u32 lonU (as the way-back header): the far map works
// without way-back data. Then the directory (every stride-th key), the table (key, body offset; sentinel), the bodies.
export function encodeFar(cells, caps = FAR_CAPS, frame) {
  if (!frame) throw new Error('far map: no frame');
  const n = cells.length; if (!n) return null; if (n > MAX_CELLS) throw new Error('far map over 16,384 cells');
  const bodies = cells.map(body); let shift = 4; while (Math.ceil(n / (1 << shift)) > MAX_KEYS) shift++;
  const stride = 1 << shift, m = Math.ceil(n / stride), total = bodies.reduce((t, b) => t + b.length, 0);
  const bytes = new Uint8Array(HEADER + 4 * m + (n + 1) * ENTRY + total), dv = new DataView(bytes.buffer);
  bytes.set(MAGIC, 0); bytes[4] = CELL_SHIFT; bytes[5] = Q_SHIFT; bytes[6] = VERSION; bytes[7] = shift;
  [n, total, caps.pixCap, caps.ptCap, caps.fillCap, m].forEach((v, i) => dv.setUint32(8 + 4 * i, v, true));
  dv.setInt32(32, frame.lat0E7, true); dv.setInt32(36, frame.lon0E7, true); dv.setUint32(40, frame.latU, true); dv.setUint32(44, frame.lonU, true);
  for (let j = 0; j < m; j++) dv.setUint32(HEADER + 4 * j, cells[stride * j].key, true);
  let at = HEADER + 4 * m, off = 0;
  cells.forEach((c, i) => { dv.setUint32(at, c.key, true); dv.setUint32(at + 4, off, true); at += ENTRY; off += bodies[i].length; });
  dv.setUint32(at, SENTINEL, true); dv.setUint32(at + 4, total, true); at += ENTRY;
  for (const b of bodies) { bytes.set(b, at); at += b.length; }
  return bytes;
}
export function readFar(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < HEADER || MAGIC.some((x, i) => b[i] !== x) || b[4] !== CELL_SHIFT || b[5] !== Q_SHIFT || b[6] !== VERSION) throw new Error('far map: bad header');
  const [n, total, pixCap, ptCap, fillCap, m] = [0, 1, 2, 3, 4, 5].map(i => dv.getUint32(8 + 4 * i, true));
  const tab = HEADER + 4 * m, bodyAt = tab + (n + 1) * ENTRY, cells = [];
  if (bodyAt + total !== b.length) throw new Error('far map: bad size');
  for (let i = 0; i < n; i++) {
    const key = dv.getUint32(tab + i * ENTRY, true), s = dv.getUint32(tab + i * ENTRY + 4, true), e = dv.getUint32(tab + (i + 1) * ENTRY + 4, true);
    let p = bodyAt + s; const end = bodyAt + e, rv = () => { let v = 0, k = 0, x; do { if (p >= end) throw new Error('far map: cut body'); x = b[p++]; v += (x & 0x7F) * 2 ** (7 * k++); } while (x & 0x80); return v; };
    const cx = (key & 0xFFFF) * CELL, cy = (key >>> 16) * CELL, items = [];
    for (let g = rv(); g > 0; g--) { const cls = b[p++]; for (let c = rv(); c > 0; c--) { const np = rv(), pts = [[b[p] | b[p + 1] << 8, b[p + 2] | b[p + 3] << 8]]; p += 4;
      for (let k = 1; k < np; k++) pts.push([pts[k - 1][0] + unzz(rv()), pts[k - 1][1] + unzz(rv())]);
      items.push({cls, pts: pts.map(([x, y]) => [cx + x * Q, cy + y * Q])}); } }
    if (p !== end) throw new Error('far map: body length');
    cells.push({key, items});
  }
  return {caps: {pixCap, ptCap, fillCap}, frame: {lat0E7: dv.getInt32(32, true), lon0E7: dv.getInt32(36, true), latU: dv.getUint32(40, true), lonU: dv.getUint32(44, true)}, cells};
}

// Line work and points of the items of one cell (areas: their ring points; the fill is bounded by the canvas).
const itemWork = i => i.cls >= FAR.WATER ? 0 : (WIDTHS[i.cls] || [2]).reduce((s, w) => s + lineWorkBound(i.pts, w), 0);
function costs(cells) { return new Map(cells.map(c => [c.key, c.items.reduce((s, i) => ({work: s.work + itemWork(i), points: s.points + i.pts.length}), {work: 0, points: 0})])); }
export function proveFar(cells, caps = FAR_CAPS) {
  const cost = costs(cells); let over = 0, screens = 0, worstWork = 0, worstPoints = 0;
  forEachScreen(cells, 1024, 16, (x, y, course, key, offsets) => { let w = 0, p = 0;
    for (const o of offsets) { const c = cost.get(key + o); if (c) { w += c.work; p += c.points; } }
    screens++; worstWork = Math.max(worstWork, w); worstPoints = Math.max(worstPoints, p); if (w > caps.pixCap || p > caps.ptCap) over++; });
  return {screens, over, worstWork, worstPoints};
}
// While a screen is over a cap: remove, in its cells, the shortest line; main roads last.
export function fitFar(cells, caps = FAR_CAPS, maxRemovals = 20000) {
  const work = cells.map(c => ({key: c.key, items: c.items.slice()})), byKey = new Map(work.map(c => [c.key, c])), cost = costs(work);
  let removedLines = 0;
  const len = p => p.slice(1).reduce((s, q, k) => s + Math.hypot(q[0] - p[k][0], q[1] - p[k][1]), 0);
  forEachScreen(work, 1024, 16, (x, y, course, key, offsets) => {
    const sum = () => offsets.reduce((s, o) => { const c = cost.get(key + o); return c ? {w: s.w + c.work, p: s.p + c.points} : s; }, {w: 0, p: 0});
    for (let s = sum(); s.w > caps.pixCap || s.p > caps.ptCap; s = sum()) {
      let best = null;
      for (const o of offsets) { const c = byKey.get(key + o); if (!c) continue;
        c.items.forEach((it, i) => { if (it.cls >= FAR.WATER) return; const r = it.cls === FAR.MAIN ? 1 : 0, l = len(it.pts);   // shortest first, main roads last
          if (!best || r < best.r || (r === best.r && l < best.l)) best = {c, i, r, l}; }); }
      if (!best) break;
      const it = best.c.items.splice(best.i, 1)[0], c = cost.get(best.c.key); c.work -= itemWork(it); c.points -= it.pts.length;
      if (++removedLines > maxRemovals) throw new Error('far fit: too many removals');
    }
  });
  const out = work.filter(c => c.items.length);
  return {cells: out, removedLines, proof: proveFar(out, caps)};
}

// The section bytes of one route file (null: no far cell). w: the result of addWayback (snapshot, bbox, route, reach);
// src: captureFarSource. The frame covers the query box, so every far point has non-negative units.
export function farSection(w, src, caps = FAR_CAPS, reachM = REACH[w.reach].air) {
  const [s, wl, n, e] = w.bbox, frame = makeFrame([[s, wl], [n, e]]), node = new Map(w.snapshot.nodes.map(x => [x.id, x.point]));
  const ways = w.snapshot.ways.map(x => ({tags: x.tags, pts: x.nodes.map(id => node.get(id)).filter(Boolean)}));
  for (const l of src.waterLines) ways.push({tags: l.tags, pts: l.pts});
  const cells = buildFarCells({ways, areas: src.areas, route: w.route.map(r => r.point), frame, reachM});
  if (!cells.length) return null;
  const fit = fitFar(cells, caps);
  return fit.cells.length ? {bytes: encodeFar(fit.cells, caps, frame), removedLines: fit.removedLines, cells: fit.cells.length} : null;
}
