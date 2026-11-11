// Map layer for the CC700, drawn with the firmware's junction layer (one entry = lines centre -> points).
// Style G5: main roads 3 lines, tertiary 2 lines, streets 1 line, paths long dashes, tracks short dashes.
import { fu, fs, fb, u32le, sc, Bytes } from './pb.js';
import { hav, frame, rdp, sub, offset, lineLen } from './geo.js';
const R = 300;
export const STYLE = {                       // kind: [draw, param, max distance from route (m)]
  1: ['triple', 10, R + 150], 2: ['casing', 3.5, R + 100], 3: ['single', 0, R], 4: ['single', 0, R * 0.4],
  5: ['dash', [24, 12], 100], 6: ['dash', [9, 12], 100],
};
const CAP = 800, AHEAD = 300, BEHIND = 50;
class Corridor {                              // route window, densified, with headings; grid lookup
  constructor(pts, F) {
    this.F = F; this.G = new Map(); const P = pts.map(p => F.m(p[0], p[1]));
    for (let i = 1; i < P.length; i++) {
      const [ax, ay] = P[i - 1], [bx, by] = P[i]; const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.floor(L / 20)), h = Math.atan2(by - ay, bx - ax);
      for (let k = 0; k < n; k++) { const x = ax + (bx - ax) * k / n, y = ay + (by - ay) * k / n; this.add(x, y, h); }
    }
    if (P.length) this.add(P[P.length - 1][0], P[P.length - 1][1], 0);
    this.zone = new Set();                     // cells within ~500 m of the window: everything else is "far" at once
    for (const k of this.G.keys()) { const [x, y] = k.split(',').map(Number); for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) this.zone.add((x + dx) + ',' + (y + dy)); }
    this.box = P.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [1e18, 1e18, -1e18, -1e18]);
  }
  add(x, y, h) { const k = Math.floor(x / 100) + ',' + Math.floor(y / 100); (this.G.get(k) || this.G.set(k, []).get(k)).push([x, y, h]); }
  near(x, y, maxd = 1e9) {                    // -> [distance m, route heading rad]; stops beyond maxd
    const gx = Math.floor(x / 100), gy = Math.floor(y / 100); let best = [1e9, 0];
    if (!this.zone.has(gx + ',' + gy)) return best;
    for (let r = 0; r <= 6; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (const [a, b, h] of this.G.get((gx + dx) + ',' + (gy + dy)) || []) { const d = Math.hypot(x - a, y - b); if (d < best[0]) best = [d, h]; }
      }
      if (best[0] < r * 100 || r * 100 > maxd + 100) break;
    }
    return best;
  }
}
function draw(style, poly, F) {
  const [mode, p] = style;
  if (mode === 'single') return [poly];
  if (mode === 'casing') return [offset(poly, p, F.m, F.g), offset(poly, -p, F.m, F.g)];
  if (mode === 'triple') return [poly, offset(poly, p, F.m, F.g), offset(poly, -p, F.m, F.g)];
  const [on, off] = p, total = lineLen(poly), out = [];
  for (let s = 0; s < total; s += on + off) { const q = sub(poly, s, Math.min(s + on, total)); if (q.length >= 2) out.push(q); }
  return out;
}
const STAR = 4;                                // points per entry (a real junction has up to ~4 branches)
function entry(c, pts) {
  return [...fu(2, 0), ...fs(3, sc(c[0])), ...fs(4, sc(c[1])), ...fu(5, pts.length), ...pts.flatMap(q => fb(6, [...fs(1, sc(q[0])), ...fs(2, sc(q[1]))]))];
}
// segments -> entries: greedy vertex cover, so one entry draws up to STAR segments that meet at a vertex
function encodeSegments(segs, out) {
  const key = q => sc(q[0]) + ',' + sc(q[1]), adj = new Map(), pos = new Map();
  segs.forEach(([a, b], i) => { for (const [u, v] of [[a, b], [b, a]]) { const k = key(u); pos.set(k, u); (adj.get(k) || adj.set(k, []).get(k)).push([i, v]); } });
  const done = new Uint8Array(segs.length);
  const deg = k => adj.get(k).reduce((n, [i]) => n + !done[i], 0);
  const order = [...adj.keys()].sort((x, y) => deg(y) - deg(x));
  const take = k => { const free = adj.get(k).filter(([i]) => !done[i]); for (let n = 0; n < free.length; n += STAR) { const t = free.slice(n, n + STAR); t.forEach(([i]) => done[i] = 1); out.push(entry(pos.get(k), t.map(x => x[1]))); } };
  for (const k of order) if (deg(k) >= 3) take(k);                       // junctions first
  segs.forEach(([a, b], i) => { if (done[i]) return; const kb = key(b); take(deg(kb) >= 2 ? kb : key(a)); });   // chains: every 2nd vertex
  segs.forEach(([a, b], i) => { if (!done[i]) out.push(entry(a, [b])); });
}
function polySegs(poly, segs) { for (let i = 1; i < poly.length; i++) segs.push([poly[i - 1], poly[i]]); }
function entries(lines, cor, scale = 1) {
  const F = cor.F, out = [], [bx0, by0, bx1, by1] = cor.box, byRank = [[], [], [], [], []];
  for (const L of lines) {
    const st = STYLE[L.kind & 0x7f]; if (!st) continue; const lim = st[2] * scale;
    if (L.box[2] < bx0 - lim || L.box[0] > bx1 + lim || L.box[3] < by0 - lim || L.box[1] > by1 + lim) continue;
    const nodes = [];                         // densify to <= 15 m so clipping is exact
    for (let i = 0; i < L.pts.length; i++) {
      const a = L.pts[i], b = L.pts[i + 1] || a; const n = Math.max(1, Math.floor(hav(a, b) / 15));
      for (let k = 0; k < n; k++) nodes.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    const info = nodes.map(q => cor.near(...F.m(q[0], q[1]), lim));
    if (Math.min(...info.map(i => i[0])) > lim) continue;
    const keep = info.map(i => i[0] <= lim), street = (L.kind & 0x7f) <= 3; let run = [];
    const flush = () => { if (run.length >= 2 && lineLen(run) >= 10) for (const p of draw(st, rdp(run, 4, F.m), F)) polySegs(p, byRank[RANK[L.kind & 0x7f]]); run = []; };
    for (let i = 0; i < nodes.length - 1; i++) {
      let ok = keep[i] || keep[i + 1];
      if (ok && !street && Math.max(info[i][0], info[i + 1][0]) <= 25) {     // path running along the route: drop
        const [ax, ay] = F.m(...nodes[i]), [bx, by] = F.m(...nodes[i + 1]);
        const a = (Math.atan2(by - ay, bx - ax) - info[i][1]) * 180 / Math.PI, m = ((a % 180) + 180) % 180, dd = Math.min(m, 180 - m);
        if (dd < 25 && Math.hypot(bx - ax, by - ay) > 5) ok = false;
      }
      if (ok) { if (!run.length) run.push(nodes[i]); run.push(nodes[i + 1]); } else flush();
    }
    flush();
  }
  for (const segs of byRank) encodeSegments(segs, out);
  return out;
}
// sections: [[ [lat,lon,dist_cm], ... ], ...]; lines: [{kind, pts:[[lat,lon]], box:[x0,y0,x1,y1] (local m)}]
const RANK = { 6: 0, 5: 0, 4: 1, 3: 2, 2: 3, 1: 4 };   // draw order: paths first, main roads last (on top at crossings)
// topology clean-up before simplifying: join pieces of the same road, snap dangling ends onto main roads
function topology(lines, F) {
  const key = q => Math.round(q[0] * 1e5) + ',' + Math.round(q[1] * 1e5), ends = new Map();
  const add = (L, e) => { const k = key(e ? L.pts.at(-1) : L.pts[0]); (ends.get(k) || ends.set(k, []).get(k)).push([L, e]); };
  lines = lines.map(L => ({ ...L, pts: L.pts.slice() })); lines.forEach(L => { add(L, 0); add(L, 1); });
  const dead = new Set(), endKeys = new Map(lines.map(L => [L, [key(L.pts[0]), key(L.pts.at(-1))]]));
  const unreg = L => { for (const k of endKeys.get(L)) { const l2 = ends.get(k); if (l2) ends.set(k, l2.filter(x => x[0] !== L)); } };
  for (const k of [...ends.keys()]) {                           // exactly two ends of the same road meet: join them
    const live = ends.get(k);
    if (!live || live.length !== 2) continue;
    const [[A, ea], [B, eb]] = live; if (A === B || A.kind !== B.kind || A.name !== B.name) continue;
    const a = ea ? A.pts : A.pts.slice().reverse(), b = eb ? B.pts.slice().reverse() : B.pts;   // a ends at k, b starts at k
    unreg(A); unreg(B); A.pts = [...a, ...b.slice(1)]; dead.add(B);
    endKeys.set(A, [key(A.pts[0]), key(A.pts.at(-1))]); add(A, 0); add(A, 1);
  }
  lines = lines.filter(L => !dead.has(L));
  const MG = new Map(), cell = 50;                             // grid of main-road segments
  for (const L of lines) if ((L.kind & 0x7f) <= 2) { const P = L.pts.map(q => F.m(q[0], q[1]));
    for (let i = 1; i < P.length; i++) { const a = P[i - 1], b = P[i];
      for (let x = Math.floor(Math.min(a[0], b[0]) / cell); x <= Math.floor(Math.max(a[0], b[0]) / cell); x++)
        for (let y = Math.floor(Math.min(a[1], b[1]) / cell); y <= Math.floor(Math.max(a[1], b[1]) / cell); y++) { const k = x + ',' + y; (MG.get(k) || MG.set(k, []).get(k)).push([L, a, b]); } } }
  const deg = new Map(); lines.forEach(L => [L.pts[0], L.pts.at(-1)].forEach(q => deg.set(key(q), (deg.get(key(q)) || 0) + 1)));
  for (const L of lines) for (const e of [0, 1]) {               // dangling end within 15 m of a main road, pointing to it: extend
    const q = e ? L.pts.at(-1) : L.pts[0], r = e ? L.pts.at(-2) : L.pts[1]; if (!r || deg.get(key(q)) > 1) continue;
    const [x, y] = F.m(q[0], q[1]), [rx, ry] = F.m(r[0], r[1]); let best = null;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const [M, [ax, ay], [bx, by]] of MG.get((Math.floor(x / cell) + dx) + ',' + (Math.floor(y / cell) + dy)) || []) {
      if (M === L) continue;
      const vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
      const px = ax + t * vx, py = ay + t * vy, d = Math.hypot(x - px, y - py);
      if (d > 0.5 && d < 15 && (!best || d < best[0])) best = [d, px, py];
    }
    if (!best) continue;
    const dx = x - rx, dy = y - ry, ux = best[1] - x, uy = best[2] - y;
    if ((dx * ux + dy * uy) / (Math.hypot(dx, dy) * Math.hypot(ux, uy) || 1) < Math.cos(Math.PI / 4)) continue;   // must point towards the road
    const g = F.g(best[1], best[2]); if (e) L.pts.push(g); else L.pts.unshift(g);
  }
  return lines;
}
export function buildMapSection(sections, lines, F, opt = {}) {
  if (opt.topology !== false) lines = topology(lines, F);
  lines = lines.map(L => ({ ...L, box: L.box || box(L.pts, F) }));
  lines = [...lines].sort((a, b) => RANK[a.kind & 0x7f] - RANK[b.kind & 0x7f]);
  const all = sections.flat();
  const win = (i, j) => { const a = sections[i][0][2] - BEHIND * 100, b = sections[j].at(-1)[2] + AHEAD * 100; return all.filter(p => p[2] >= a && p[2] <= b); };
  // grid of lines (500 m cells) -> each corridor only looks at nearby lines
  const LG = new Map(), C = 500;
  lines.forEach((L, n) => { for (let x = Math.floor(L.box[0] / C); x <= Math.floor(L.box[2] / C); x++) for (let y = Math.floor(L.box[1] / C); y <= Math.floor(L.box[3] / C); y++) { const k = x + ',' + y; (LG.get(k) || LG.set(k, []).get(k)).push(n); } });
  const near = cor => { const m = 450, ids = new Set(), [x0, y0, x1, y1] = cor.box;
    for (let x = Math.floor((x0 - m) / C); x <= Math.floor((x1 + m) / C); x++) for (let y = Math.floor((y0 - m) / C); y <= Math.floor((y1 + m) / C); y++) for (const n of LG.get(x + ',' + y) || []) ids.add(n);
    return [...ids].sort((a, b) => a - b).map(n => lines[n]); };            // keep draw order
  const ent = (i, j, scale = 1) => { const cor = new Corridor(win(i, j), F); return entries(near(cor), cor, scale); };
  // each section once (its own window); the overlap ratio between sum and real union is learned block by block
  const one = sections.map((_, i) => ent(i, i).length), groups = []; let ratio = 0.5;
  for (let i = 0; i < sections.length;) {
    let j = i, sum = one[i];
    while (j + 1 < sections.length && (sum + one[j + 1]) * ratio <= CAP) sum += one[++j];
    let scale = 1, e = ent(i, j);
    while (e.length > CAP && j > i) { sum -= one[j--]; e = ent(i, j); }                        // too big: shrink
    while (e.length > CAP && scale > 0.3) { scale *= 0.85; e = ent(i, j, scale); }              // one dense section: smaller radius
    for (let t = 0; t < 3 && scale === 1 && j + 1 < sections.length && e.length < CAP * 0.85; t++) { // too small: try to grow
      const e2 = ent(i, j + 1); if (e2.length > CAP) break; sum += one[++j]; e = e2;
    }
    ratio = Math.min(1, Math.max(0.15, e.length / sum)); groups.push([i, j, e]); i = j + 1;
  }
  const body = new Bytes(), offs = new Array(sections.length).fill(0);
  for (const [i, j, es] of groups) {
    const m = es.length ? [...fu(1, es.length), ...es.flatMap((e, n) => fb(2, [...fu(1, n), ...e]))] : [8, 0x80, 0x80, 0x80, 0];
    const o = body.n; body.push(u32le(m.length)).push(m);
    for (let t = i; t <= j; t++) offs[t] = o;
  }
  const idx = [...fu(1, sections.length), ...offs.flatMap(o => fb(2, fu(1, o)))];
  const sec = new Bytes().push(u32le(idx.length)).push(idx).push(body.bytes).bytes;
  return { bytes: sec, blocks: groups.length, maxBlock: Math.max(...groups.map(g => g[2].length)) };
}
function box(pts, F) { let b = [1e18, 1e18, -1e18, -1e18]; for (const p of pts) { const [x, y] = F.m(p[0], p[1]); b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]; } return b; }
export { frame };
