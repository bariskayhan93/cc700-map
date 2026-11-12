// Map layer for the CC700, drawn with the firmware's junction layer (one entry = lines centre -> points).
// Style V4: main roads 3 lines, tertiary and streets 2 lines, service 1 line, paths and tracks light dashes.
import { fu, fs, fb, u32le, sc, Bytes } from './pb.js';
import { hav, frame, rdp, sub, offset, lineLen } from './geo.js';
const R = 300;
export const STYLE = {                       // kind: [draw, param, max distance from route (m)]
  // V4 (2026-11-11): same range for all classes (a normal map, not a corridor), width by class: main 3 lines,
  // tertiary 2 wide, street 2, service 1; paths and tracks one light dash (10 m on, 20 m off)
  1: ['triple', 10, R + 75], 2: ['casing', 6, R], 3: ['casing', 3, R], 4: ['single', 0, R],
  5: ['dash', [10, 20], R], 6: ['dash', [10, 20], R],
  7: ['dash', [10, 20], 150], 8: ['triple', 10, R + 75],   // 7 footways / pedestrian areas, 8 motorways (orientation only)
  9: ['dash', [25, 15], R],                                // railways (extra layer): long dash
};
const CAP_STD = 800, CAP_HI = 1200, AHEAD = 300, BEHIND = 400;   // BEHIND: the map follows the position (patch v4), also backwards and at the finish   // CAP_MAX: only for one section that alone is over CAP (dense city)
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
  within(R) {                                 // -> (x, y) => within R m of the route; 10 m raster, made once per R
    if (this.wR && this.wR[0] === R) return this.wR[1];
    const C = 10, x0 = this.box[0] - R - C, y0 = this.box[1] - R - C, w = Math.ceil((this.box[2] - this.box[0] + 2 * R) / C) + 3, h = Math.ceil((this.box[3] - this.box[1] + 2 * R) / C) + 3;
    const g = new Uint8Array(w * h), r = Math.floor(R / C);
    for (const v of this.G.values()) for (const [x, y] of v) { const cx = Math.floor((x - x0) / C), cy = Math.floor((y - y0) / C);
      for (let dy = -r; dy <= r; dy++) { const dx = Math.floor(Math.sqrt(r * r - dy * dy)), row = (cy + dy) * w; g.fill(1, row + cx - dx, row + cx + dx + 1); } }
    const f = (x, y) => { const cx = Math.floor((x - x0) / C), cy = Math.floor((y - y0) / C); return cx >= 0 && cy >= 0 && cx < w && cy < h && g[cy * w + cx] === 1; };
    this.wR = [R, f]; return f;
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
    if (!info.some(i => i[0] <= lim)) continue;
    const keep = info.map(i => i[0] <= lim), street = (L.kind & 0x7f) <= 3 || L.kind === 9; let run = [];
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
// Ground layer (option B): built-up land as grey. Lines 5 m apart merge into one grey area, because every line's
// grey edge (8 px = 20 m) covers the white core of the line before it; streets drawn later show white on it.
// All areas of a block are filled as one shape, with rows parallel to the block's main direction (long rows =
// few entries). Gaps up to 20 m between areas are filled too (usually the street between them).
// Each area also gets one extra row on its last side, so the last white core lies outside the area and shows
// as a thin outline, not as a white stripe in the area. Roads are never dropped for ground: ground only uses the
// entries the roads leave; if it does not fit, the ground radius gets smaller.
let CUT = false, FAN = true; export const setFan = v => { FAN = v; };   // test switch
const GROUND_R = 300, GROUND_PITCH = 4, WATER_PITCH = 20; let BRIDGE = 20; export const setBridge = v => { BRIDGE = v; };   // 4 m, not 5: at 5 m single pixels of the white cores stay visible on angled rows
function groundRows(rings, cor, R, hatch = 0) {                // hatch: plain east-west rows that far apart (water)
  const PITCH = hatch || GROUND_PITCH;
  const all = []; for (const v of cor.G.values()) for (const p of v) all.push(p);
  let mx = 0, my = 0; for (const [x, y] of all) { mx += x; my += y; } mx /= all.length; my /= all.length;
  let sxx = 0, syy = 0, sxy = 0; for (const [x, y] of all) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const th = hatch ? 0 : 0.5 * Math.atan2(2 * sxy, sxx - syy), c = Math.cos(th), s = Math.sin(th);
  const rot = ([x, y]) => [x * c + y * s, -x * s + y * c], back = ([x, y]) => [x * c - y * s, x * s + y * c];
  const RR = rings.map(r => r.map(rot)); let y0 = Infinity, y1 = -Infinity;
  for (const p of all) { const y = rot(p)[1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const rows = [], ys = Math.floor((y0 - R) / PITCH) * PITCH, nrow = Math.floor((y1 + R - ys) / PITCH) + 1, bucket = Array.from({ length: nrow }, () => []);
  for (const r of RR) for (let i = 1; i < r.length; i++) { const a = r[i - 1], b = r[i];   // edges by the rows they cross
    const k0 = Math.max(0, Math.ceil((Math.min(a[1], b[1]) - ys) / PITCH)), k1 = Math.min(nrow - 1, Math.floor((Math.max(a[1], b[1]) - ys) / PITCH));
    for (let k = k0; k <= k1; k++) bucket[k].push([a, b]); }
  const inR = cor.within(R);
  for (let k = 0; k < nrow; k++) {
    const y = ys + k * PITCH, X = [];
    for (const [[ax, ay], [bx, by]] of bucket[k]) if ((ay <= y) !== (by <= y)) X.push([ax + (y - ay) * (bx - ax) / (by - ay), by > ay ? 1 : -1]);
    X.sort((a, b) => a[0] - b[0]); let w = 0; const runs = [];
    for (let i = 0; i < X.length - 1; i++) { w += X[i][1]; if (CUT || hatch ? w >= 0 : !w) continue;   // with water: outer rings count -1, water rings +1 (no grey on water)
      const last = runs.at(-1); if (last && X[i][0] - last[1] <= (hatch ? 0 : BRIDGE)) last[1] = Math.max(last[1], X[i + 1][0]); else runs.push([X[i][0], X[i + 1][0]]); }
    rows.push([y, runs]);
  }
  const merge = (A, B) => { const r = [...A, ...B].map(x => x.slice()).sort((a, b) => a[0] - b[0]), o = [];
    for (const x of r) { const l = o.at(-1); if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else o.push(x); } return o; };
  const segRows = [];
  for (let k = 0; k < rows.length; k++) {
    const [y, runs] = rows[k], drawn = k && !hatch ? merge(runs, rows[k - 1][1]) : runs, sr = [];   // + one extra row past each area's last row
    for (const [xa, xb] of drawn) {
      const m = Math.max(1, Math.ceil((xb - xa) / 10)); let run = null;
      for (let t = 0; t <= m; t++) {           // keep only the parts within R of the route
        const x = xa + (xb - xa) * t / m, ok = inR(...back([x, y]));
        if (ok) { if (run) run[1] = x; else run = [x, x]; }
        if ((!ok || t === m) && run) { if (run[1] - run[0] >= 8) sr.push([run[0], run[1], y]); run = null; }
      }
    }
    segRows.push(sr);
  }
  if (!FAN || hatch) return segRows.flat().map(([a, b, y]) => [back([a, y]), [back([b, y])]]);
  // Fans: rows that continue each other (ends move <= 15 m) make a chain. In a chain, 2 entries of 4 lines fill
  // 5 rows: one fan from the left end of a row to 4 right ends, the next from a right end to 4 left ends.
  // Lines stay <= 4 m apart, so the grey still merges. Right ends lie half a pitch higher.
  const chains = []; let act = [];
  for (const sr of segRows) { const nx = [];
    for (const g of sr) { const i = act.findIndex(c => c && Math.abs(c.at(-1)[0] - g[0]) <= 15 && Math.abs(c.at(-1)[1] - g[1]) <= 15);
      if (i >= 0) { act[i].push(g); nx.push(act[i]); act[i] = null; } else { const c = [g]; chains.push(c); nx.push(c); } }
    act = nx; }
  const out = [];
  for (const ch of chains) {
    const n = ch.length, L = i => { const g = ch[Math.max(0, Math.min(n - 1, i))]; return [g[0], g[2]]; },
      Rt = i => { const g = ch[Math.max(0, Math.min(n - 1, i))]; return [g[1], g[2] + PITCH / 2]; };
    if (n < 4) { for (const [a, b, y] of ch) out.push([back([a, y]), [back([b, y])]]); continue; }
    const flat = i => [ch[i][1], ch[i][2]], star = (c, ps) => { for (let q = 0; q < ps.length; q += STAR) out.push([back(c), ps.slice(q, q + STAR).map(back)]); };
    const idx = (a, b) => { const o = []; for (let j = Math.max(0, a); j <= Math.min(n - 1, b); j++) o.push(j); return o; };
    let mL = 0, mR = -1;                                   // last row whose left / right end has a line
    for (let m = 0; 5 * m <= n - 2; m++) { const i = 5 * m;
      const r = idx(Math.max(i - 2, mR + 1), Math.min(i + 1, n - 2)); if (r.length || !m) star(L(i), [...(m ? [] : [flat(0)]), ...r.map(Rt)]);   // a chain starts with a straight row
      mL = i; if (r.length) mR = r.at(-1);
      if (i + 2 <= n - 2) { const l = idx(i + 1, Math.min(i + 4, n - 2)); star(Rt(i + 2), l.map(L)); mL = l.at(-1); mR = i + 2; } }
    const rr = idx(mR + 1, n - 2); if (rr.length) star(L(n - 1), rr.map(Rt));       // close the chain: the rest of both sides,
    star(flat(n - 1), idx(mL + 1, n - 1).map(L));                                    // then a straight last row (its white core is covered by the next row)
  }
  return out;
}
function ringsNear(areas, cor) {
  const [bx0, by0, bx1, by1] = cor.box, rings = [];
  for (const A of areas) { const [x0, y0, x1, y1] = A.box; if (x1 < bx0 - GROUND_R || x0 > bx1 + GROUND_R || y1 < by0 - GROUND_R || y0 > by1 + GROUND_R) continue; rings.push(...A.m); }
  return rings;
}
const segEntries = (segs, F) => segs.map(([c, ps]) => entry(F.g(...c), ps.map(p => F.g(...p))));
function ground(areas, cor, budget, radii = [GROUND_R], stat) {     // largest radius that fits the budget
  const rings = ringsNear(areas, cor); if (!rings.length) return [];
  for (const R of radii) { const segs = groundRows(rings, cor, R); if (segs.length <= budget) { if (stat) stat.minGround = Math.min(stat.minGround, R); return segEntries(segs, cor.F); } }
  if (stat) stat.minGround = 0;
  return [];
}
// sections: [[ [lat,lon,dist_cm], ... ], ...]; lines: [{kind, pts:[[lat,lon]], box:[x0,y0,x1,y1] (local m)}]
const RANK = { 9: 0, 7: 0, 6: 0, 5: 0, 4: 1, 3: 2, 2: 3, 1: 4, 8: 4 };   // draw order: paths first, main roads last (on top at crossings)
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
  const CAP = opt.cap || CAP_STD, CAP_MAX = Math.max(CAP, opt.capMax || CAP_HI);   // opt.cap / opt.capMax: device limit tests only
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
  const toM = rs => ({ m: rs.map(r => r.map(q => F.m(q[0], q[1]))), box: box(rs[0], F) });
  // extra layers (opt.water, opt.rails): they never change roads, grey range or block grouping; a block takes them only if they fit
  const water = opt.water && opt.water.length ? opt.water.map(toM) : null, pitch = opt.waterPitch || WATER_PITCH;
  const rails = opt.rails && opt.rails.length ? opt.rails.map(pts => ({ kind: 9, pts, box: box(pts, F) })) : null;
  const cut = water ? water.map(w => ({ box: w.box, m: w.m.map(r => r.slice().reverse()) })) : [];   // water is cut out of the grey
  const areas = opt.ground && opt.areas && opt.areas.length ? [...opt.areas.map(toM), ...cut] : null;
  CUT = cut.length > 0;
  // with ground on, a block counts roads + full ground, so dense blocks get fewer sections (smaller window);
  // with a smaller road radius (scale < 1) only roads are counted
  const ent = (i, j, scale = 1) => { const cor = new Corridor(win(i, j), F), r = entries(near(cor), cor, scale);
    const g = areas && scale === 1 ? ground(areas, cor, 1e9) : []; return Object.assign([...g, ...r], { ng: g.length }); };
  // each section once (its own window); the overlap ratio between sum and real union is learned block by block
  const one = sections.map((_, i) => ent(i, i).length), groups = [], stat = { over: 0, ground: 0, scaled: 0, minScale: 1, minGround: GROUND_R, extra: 0, extraDropped: 0 }; let ratio = 0.5;
  for (let i = 0; i < sections.length;) {
    let j = i, sum = one[i];
    while (j + 1 < sections.length && (sum + one[j + 1]) * ratio <= CAP) sum += one[++j];
    let scale = 1, e = ent(i, j);
    while (e.length > CAP && j > i) { sum -= one[j--]; e = ent(i, j); }                        // too big: shrink
    // one dense section: the block can go to CAP_MAX with the full range; only above that the range becomes smaller
    if (areas && e.length > CAP_MAX) {                                                           // smaller ground radius first
      const cor = new Corridor(win(i, j), F), r = entries(near(cor), cor);
      if (r.length <= CAP_MAX) { const g = ground(areas, cor, CAP_MAX - r.length, [250, 200, 150, 100], stat); e = Object.assign([...g, ...r], { ng: g.length }); stat.ground++; }
    }
    while (e.length > CAP_MAX && scale > 0.3) { scale *= 0.85; e = ent(i, j, scale); }          // still too big: smaller road radius
    if (e.length > CAP) stat.over++; if (scale < 1) { stat.scaled++; stat.minScale = Math.min(stat.minScale, scale); }
    for (let t = 0; t < 3 && scale === 1 && j + 1 < sections.length && e.length < CAP * 0.85; t++) { // too small: try to grow
      const e2 = ent(i, j + 1); if (e2.length > CAP) break; sum += one[++j]; e = e2;
    }
    ratio = Math.min(1, Math.max(0.15, e.length / sum));
    if (water || rails) {                                          // drawn on the grey, below the roads
      const cor = new Corridor(win(i, j), F), ng = e.ng, x = [];
      for (const l of [water && segEntries(groundRows(ringsNear(water, cor), cor, R, pitch), F), rails && entries(rails, cor)])
        if (l && l.length) { if (e.length + x.length + l.length <= CAP_MAX) x.push(...l); else stat.extraDropped++; }
      e = [...e.slice(0, ng), ...x, ...e.slice(ng)]; stat.extra += x.length;
    }
    groups.push([i, j, e]); i = j + 1;
  }
  const body = new Bytes(), offs = new Array(sections.length).fill(0);
  for (const [i, j, es] of groups) {
    const m = es.length ? [...fu(1, es.length), ...es.flatMap((e, n) => fb(2, [...fu(1, n), ...e]))] : [8, 0x80, 0x80, 0x80, 0];
    const o = body.n; body.push(u32le(m.length)).push(m);
    for (let t = i; t <= j; t++) offs[t] = o;
  }
  const idx = [...fu(1, sections.length), ...offs.flatMap(o => fb(2, fu(1, o)))];
  const sec = new Bytes().push(u32le(idx.length)).push(idx).push(body.bytes).bytes;
  return { bytes: sec, blocks: groups.length, maxBlock: Math.max(...groups.map(g => g[2].length)), stat };
}
function box(pts, F) { let b = [1e18, 1e18, -1e18, -1e18]; for (const p of pts) { const [x, y] = F.m(p[0], p[1]); b = [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)]; } return b; }
export { frame };

// ---------- styled map for the patched firmware (patch v1) ----------
// Entry field 2 = style: bits 0-3 class, bits 4-6 level + 2, bit 7 bridge, bit 8 tunnel (patch/src/map.c).
// An entry is a polyline (roads, rails, tram, rivers) or an area [outer ring, holes...] as [centre = first point, points...].
// The original firmware would draw these as stars, so this map is only for the patched firmware (opt.styled).
const S = { BUILT: 1, GREEN: 2, WATER: 3, WLINE: 4, MAJ: 5, MIN: 6, SRV: 7, PTH: 8, RAIL: 9, CYC: 10, TRAM: 11, LABEL: 12, SIG: 13, STOP: 14 };
export { S as MAP_CLASS };
const SR = { [S.MAJ]: 1000, [S.MIN]: 400, [S.SRV]: 300, [S.PTH]: 300, [S.CYC]: 350, [S.RAIL]: 450, [S.TRAM]: 450, [S.WLINE]: 450 };   // range from the route (m)
const AREA_R = 450, MAXPTS = 60, BLOCK_PTS = 9000, BLOCK_ENT = 1000, BLOCK_LEN = 1500;
function lineClass(L) {
  const k = L.kind & 0x7f;
  return k === 1 || k === 8 ? S.MAJ : k === 2 || k === 3 ? S.MIN : k === 4 ? S.SRV : k === 5 ? (L.fl & 32 ? S.CYC : S.PTH) : k === 6 || k === 7 ? S.PTH : k === 9 ? S.RAIL : 0;
}
// bit 9: rough surface (tracks). Class 12 label: the points carry the UTF-8 name (4 bytes per int32, 0-terminated). 13 signal, 14 tram stop: one point.
const styleOf = (cls, fl = 0) => cls | ((((fl >> 2) & 7) || 2) << 4) | (fl & 1 ? 0x80 : 0) | (fl & 2 ? 0x100 : 0) | (fl & 64 ? 0x200 : 0);
const LABEL_R = 300, LABEL_GAP = 230, LABEL_SAME = 450, LABEL_MAX = 12, DOT_R = 300, LABEL_BYTES = 23;
const ASCII = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss', é: 'e', è: 'e', á: 'a', à: 'a' };
function lentry(c, name) {                               // the map font has ASCII only
  const t = name.replace(/[^\x20-\x7e]/g, ch => ASCII[ch] ?? '').replace(/([Ss])trasse\b/g, '$1tr.');   // short names: less overlap
  let b = [...new TextEncoder().encode(t)];
  if (b.length > LABEL_BYTES) { b = b.slice(0, LABEL_BYTES); while (b.length && (b.at(-1) & 0xc0) === 0x80) b.pop(); if (b.length && b.at(-1) >= 0xc0) b.pop(); }
  b.push(0); while (b.length % 8) b.push(0);
  const dv = new DataView(new Uint8Array(b).buffer), v = []; for (let i = 0; i < b.length; i += 4) v.push(dv.getInt32(i, true));
  return [...fu(2, S.LABEL | (2 << 4)), ...fs(3, sc(c[0])), ...fs(4, sc(c[1])), ...fu(5, v.length / 2), ...Array.from({ length: v.length / 2 }, (_, i) => fb(6, [...fs(1, v[2 * i]), ...fs(2, v[2 * i + 1])])).flat()];
}
function sentry(style, pts) {
  const [c, ...ps] = pts;
  return [...fu(2, style), ...fs(3, sc(c[0])), ...fs(4, sc(c[1])), ...fu(5, ps.length), ...ps.flatMap(q => fb(6, [...fs(1, sc(q[0])), ...fs(2, sc(q[1]))]))];
}
function clipRing(r, [x0, y0, x1, y1]) {                 // Sutherland-Hodgman, local metres
  let P = r;
  for (const [ax, lim, keep] of [[0, x0, 1], [0, x1, -1], [1, y0, 1], [1, y1, -1]]) {
    const o = [];
    for (let i = 0; i < P.length; i++) { const A = P[i], B = P[(i + 1) % P.length], ia = (A[ax] - lim) * keep >= 0, ib = (B[ax] - lim) * keep >= 0;
      if (ia) o.push(A); if (ia !== ib) { const t = (lim - A[ax]) / (B[ax] - A[ax]); o.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); } }
    P = o; if (P.length < 3) return null;
  }
  return P;
}
function styledEntries(data, cor, o = {}) {
  const F = cor.F, out = [], labels = [], [bx0, by0, bx1, by1] = cor.box;
  const nearBox = (b, m) => !(b[2] < bx0 - m || b[0] > bx1 + m || b[3] < by0 - m || b[1] > by1 + m);
  // areas: built-up, green, water; each [outer, holes...] clipped to the window, holes joined by a doubled edge (even-odd fill)
  const win = [bx0 - AREA_R, by0 - AREA_R, bx1 + AREA_R, by1 + AREA_R];
  for (const [cls, list] of [[S.BUILT, data.areas], [S.GREEN, data.green], [S.WATER, data.water]]) for (const A of list || []) {
    if (!nearBox(A.box, AREA_R)) continue;
    const rings = A.m.map(r => clipRing(r, win)).filter(Boolean); if (!rings.length || !rings[0]) continue;
    const o = rings[0], pts = [...o, o[0]];
    for (const h of rings.slice(1)) pts.push(...h, h[0], o[0]);
    out.push(sentry(styleOf(cls), pts.map(p => F.g(...p))));
  }
  // lines
  const lines = [...(data.lines || []).map(L => ({ L, cls: lineClass(L), fl: (L.fl || 0) | ((L.kind & 0x7f) === 6 && o.rough !== false ? 64 : 0) })).filter(x => o.paths !== false || x.cls !== S.PTH), ...(data.rails || []).map(pts => ({ L: { pts }, cls: S.RAIL, fl: 0 })),
    ...(data.trams || []).map(pts => ({ L: { pts }, cls: S.TRAM, fl: 0 })), ...(data.wlines || []).map(pts => ({ L: { pts }, cls: S.WLINE, fl: 0 }))];
  for (const { L, cls, fl } of lines) {
    if (!cls) continue; const lim = SR[cls], b = L.box || (L.box = box(L.pts, F)); if (!nearBox(b, lim)) continue;
    const nodes = [];
    for (let i = 0; i < L.pts.length; i++) { const a = L.pts[i], c = L.pts[i + 1] || a, n = Math.max(1, Math.floor(hav(a, c) / 15));
      for (let k = 0; k < n; k++) nodes.push([a[0] + (c[0] - a[0]) * k / n, a[1] + (c[1] - a[1]) * k / n]); }
    const keep = nodes.map(q => cor.near(...F.m(q[0], q[1]), lim)[0] <= lim); let run = [];
    const flush = () => { if (run.length >= 2 && lineLen(run) >= 8) { const p = rdp(run, 1.5, F.m);
      if (o.names !== false && L.name && cls >= S.MAJ && cls <= S.SRV) {          // label candidate: the run point nearest to the route
        let best = null; for (const q of run) { const d = cor.near(...F.m(q[0], q[1]), LABEL_R)[0]; if (d >= 30 && d <= LABEL_R && (!best || d < best[0])) best = [d, q]; }   // off the route line, which is drawn over it
        if (best) labels.push({ name: L.name, cls, d: best[0], q: best[1], m: F.m(best[1][0], best[1][1]) }); }
      for (let s = 0; s < p.length - 1; s += MAXPTS - 1) out.push(sentry(styleOf(cls, fl), p.slice(s, s + MAXPTS))); } run = []; };
    for (let i = 0; i < nodes.length - 1; i++) { if (keep[i] || keep[i + 1]) { if (!run.length) run.push(nodes[i]); run.push(nodes[i + 1]); } else flush(); }
    flush();
  }
  // street names: main roads first, then near the route; spaced on the map, one per name nearby
  labels.sort((a, b) => a.cls - b.cls || a.d - b.d); const got = [];
  for (const l of labels) {
    if (got.length >= LABEL_MAX) break;
    if (got.some(g => { const d = Math.hypot(g.m[0] - l.m[0], g.m[1] - l.m[1]); return d < LABEL_GAP || (g.name === l.name && d < LABEL_SAME); })) continue;
    got.push(l); out.push(lentry(l.q, l.name));
  }
  // one dot per junction or stop: OSM has a signal node per approach and a stop node per platform
  for (const [cls, list, gap] of [[S.SIG, data.signals, 30], [S.STOP, data.stops, 60]]) { const got = [];
    for (const p of list || []) { const q = F.m(p[0], p[1]);
      if (cor.near(...q, DOT_R)[0] > DOT_R || got.some(g => Math.hypot(g[0] - q[0], g[1] - q[1]) < gap)) continue;
      got.push(q); out.push(sentry(styleOf(cls), [p, p])); } }
  return out;
}
const entPts = es => es.reduce((n, e) => n + e.length, 0);       // rough size measure (bytes)
export function buildStyledSection(sections, data, F) {
  const toM = rs => ({ m: rs.map(r => r.map(q => F.m(q[0], q[1]))), box: box(rs[0], F) });
  const D = { ...data, areas: (data.areas || []).map(toM), green: (data.green || []).map(toM), water: (data.water || []).map(toM) };
  const all = sections.flat();
  const win = (i, j) => { const a = sections[i][0][2] - BEHIND * 100, b = sections[j].at(-1)[2] + AHEAD * 100; return all.filter(p => p[2] >= a && p[2] <= b); };
  const ent = (i, j) => styledEntries(D, new Corridor(win(i, j), F), data.opt || {});
  const groups = [];
  for (let i = 0; i < sections.length;) {
    let j = i, e = ent(i, i);
    while (j + 1 < sections.length && (sections[j + 1].at(-1)[2] - sections[i][0][2]) / 100 <= BLOCK_LEN) {
      const e2 = ent(i, j + 1); if (e2.length > BLOCK_ENT || entPts(e2) / 10 > BLOCK_PTS) break; e = e2; j++;
    }
    groups.push([i, j, e]); i = j + 1;
  }
  const body = new Bytes(), offs = new Array(sections.length).fill(0);
  for (const [i, j, es] of groups) {
    const m = es.length ? [...fu(1, es.length), ...es.flatMap((e, n) => fb(2, [...fu(1, n), ...e]))] : [8, 0x80, 0x80, 0x80, 0];
    const o = body.n; body.push(u32le(m.length)).push(m);
    for (let t = i; t <= j; t++) offs[t] = o;
  }
  const idx = [...fu(1, sections.length), ...offs.flatMap(o => fb(2, fu(1, o)))];
  const sec = new Bytes().push(u32le(idx.length)).push(idx).push(body.bytes).bytes;
  return { bytes: sec, blocks: groups.length, maxBlock: Math.max(...groups.map(g => g[2].length)), stat: { styled: true } };
}
