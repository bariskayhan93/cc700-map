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
    this.box = P.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [1e18, 1e18, -1e18, -1e18]);
  }
  add(x, y, h) { const k = Math.floor(x / 100) + ',' + Math.floor(y / 100); (this.G.get(k) || this.G.set(k, []).get(k)).push([x, y, h]); }
  near(x, y) {                                // -> [distance m, route heading rad]
    const gx = Math.floor(x / 100), gy = Math.floor(y / 100); let best = [1e9, 0];
    for (let r = 0; r <= 6; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        for (const [a, b, h] of this.G.get((gx + dx) + ',' + (gy + dy)) || []) { const d = Math.hypot(x - a, y - b); if (d < best[0]) best = [d, h]; }
      }
      if (best[0] < r * 100) break;
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
function encode(poly, out) {                  // polyline -> entries (every 2nd vertex is a centre)
  for (let i = 1; i < poly.length; i += 2) {
    const pts = [poly[i - 1]]; if (i + 1 < poly.length) pts.push(poly[i + 1]);
    out.push([...fu(2, 0), ...fs(3, sc(poly[i][0])), ...fs(4, sc(poly[i][1])), ...fu(5, pts.length),
      ...pts.flatMap(q => fb(6, [...fs(1, sc(q[0])), ...fs(2, sc(q[1]))]))]);
  }
}
function entries(lines, cor) {
  const F = cor.F, out = [], [bx0, by0, bx1, by1] = cor.box;
  for (const L of lines) {
    const st = STYLE[L.kind & 0x7f]; if (!st) continue; const lim = st[2];
    if (L.box[2] < bx0 - lim || L.box[0] > bx1 + lim || L.box[3] < by0 - lim || L.box[1] > by1 + lim) continue;
    const nodes = [];                         // densify to <= 15 m so clipping is exact
    for (let i = 0; i < L.pts.length; i++) {
      const a = L.pts[i], b = L.pts[i + 1] || a; const n = Math.max(1, Math.floor(hav(a, b) / 15));
      for (let k = 0; k < n; k++) nodes.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    const info = nodes.map(q => cor.near(...F.m(q[0], q[1])));
    if (Math.min(...info.map(i => i[0])) > lim) continue;
    const keep = info.map(i => i[0] <= lim), street = (L.kind & 0x7f) <= 3; let run = [];
    const flush = () => { if (run.length >= 2 && lineLen(run) >= 10) for (const p of draw(st, rdp(run, 4, F.m), F)) encode(p, out); run = []; };
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
  return out;
}
// sections: [[ [lat,lon,dist_cm], ... ], ...]; lines: [{kind, pts:[[lat,lon]], box:[x0,y0,x1,y1] (local m)}]
export function buildMapSection(sections, lines, F) {
  const all = sections.flat();
  const win = (i, j) => { const a = sections[i][0][2] - BEHIND * 100, b = sections[j].at(-1)[2] + AHEAD * 100; return all.filter(p => p[2] >= a && p[2] <= b); };
  const groups = [];
  for (let i = 0; i < sections.length;) {
    let e = entries(lines, new Corridor(win(i, i), F)), j = i;
    while (j + 1 < sections.length) { const e2 = entries(lines, new Corridor(win(i, j + 1), F)); if (e2.length > CAP) break; j++; e = e2; }
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
  return { bytes: sec, blocks: groups.length, maxBlock: Math.max(...groups.map(g => g[2].length)) };
}
export { frame };
