// Cost of each detail-map class: entries, points, bytes share, projection calls, on-screen line/fill work per screen.
import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {decodeBlockD, isBlockD} = await import(R + 'map_codec.js'); const {readNativeRoute} = await import(R + 'native_route.js');
const {readSections} = await import(R + 'wayback_embed.js');
const file = new Uint8Array(fs.readFileSync(process.argv[2])), secs = readSections(file), v = new DataView(file.buffer);
const mapAt = v.getUint32(0x5c, true), map = file.subarray(mapAt, Math.min(...secs.map(s => s.offset))), mv = new DataView(map.buffer, map.byteOffset);
const route = readNativeRoute(file).map(r => r.point), lat0 = route[0][0], mE = 111320 * Math.cos(lat0 * Math.PI / 180), K = 180 / 2 ** 31, toM = (a, o) => [o * mE, a * 111320];
const RM = route.map(p => toM(...p)), segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
const dR = p => { let b = 1e9; for (let i = 1; i < RM.length; i++) b = Math.min(b, segD(p, RM[i - 1], RM[i])); return b; };
const NAME = {1: 'built-up fill', 2: 'green fill (+1px outline)', 3: 'water fill (+outline)', 4: 'river line', 5: 'main road', 6: 'minor street', 7: 'service road', 8: 'path/footway (dashed)', 9: 'rail (dashed)', 10: 'cycleway', 11: 'tram', 12: 'name label', 13: 'signal dot', 14: 'tram stop'};
// draw passes per class as map.c: widths of each pass (line work), fills: area + outline for green/water
const PASSES = {4: [3], 5: [10, 7], 6: [8, 5], 7: [5, 3], 8: [2], 9: [2], 10: [2], 11: [4, 2]};
const blocks = [];
for (let o = 4 + mv.getUint32(0, true); o + 4 <= map.length;) { const n = mv.getUint32(o, true); if (!n || o + 4 + n > map.length) break; const b = map.subarray(o + 4, o + 4 + n); if (isBlockD(b)) blocks.push(decodeBlockD(b)); o += 4 + n; }
const T = {}; let allPts = 0;
for (const ents of blocks) for (const e of ents) { const c = e.style & 15; if (!NAME[c]) continue; const t = T[c] ??= {entries: 0, pts: 0, calls: 0, far300: 0};
  const n = 1 + e.pts.length; t.entries++; t.pts += n; allPts += n; t.calls += c <= 3 ? (c === 1 ? 1 : 2) : c >= 12 ? 1 : (PASSES[c] || [1]).length + ((e.style & 0x80) ? 2 : 0);
  const pts = [[e.lat, e.lon], ...e.pts].map(([a, o]) => toM(a * K, o * K)); if (dR(pts[Math.floor(pts.length / 2)]) > 300) t.far300++; }
// on-screen work by class at rider spots on the route and 700 m off, heading along the route
const SW = 240, SH = 256, onS = p => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return !(x1 < -16 || y1 < -16 || x0 > SW + 16 || y0 > SH + 16); };
const work = (p, w) => { let s = 0; for (let i = 1; i < p.length; i++) { const dx = Math.abs(p[i][0] - p[i - 1][0]), dy = Math.abs(p[i][1] - p[i - 1][1]); const lx = Math.max(0, Math.min(SW, Math.max(p[i][0], p[i - 1][0])) - Math.max(0, Math.min(p[i][0], p[i - 1][0]))); s += (Math.max(dx, dy) + 1) * w; } return s; };
function fill(p) { let n = 0; for (let y = 0; y < SH; y++) { const yc = y + .5, xs = []; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xa, ya] = p[i], [xb, yb] = p[j]; if ((ya > yc) !== (yb > yc)) xs.push(xa + (yc - ya) * (xb - xa) / (yb - ya)); } xs.sort((a, b) => a - b); for (let k = 0; k + 1 < xs.length; k += 2) n += Math.max(0, Math.min(SW, xs[k + 1]) - Math.max(0, xs[k])); } return n; }
const per = {0: {}, 700: {}}; let frames = {0: 0, 700: 0}, acc = 0;
for (let i = 1; i < RM.length; i++) { const a = RM[i - 1], b = RM[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += L; if (acc < 300) continue; acc = 0;
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, head = Math.atan2(ux, uy), c = Math.cos(head), s = Math.sin(head);
  for (const d of [0, 700]) { const rider = [b[0] + uy * d, b[1] - ux * d]; if (Math.abs(dR(rider) - d) > 100) continue; frames[d]++;
    const P = ([x, y]) => { const dx = x - rider[0], dy = y - rider[1]; return [120 + (dx * c - dy * s) / 2.5, 216 - (dx * s + dy * c) / 2.5]; };
    let best = null; for (const ents of blocks) { const acc2 = {}; let tot = 0; for (const e of ents) { const cl = e.style & 15; if (!NAME[cl] || cl >= 12) continue; const sp = [[e.lat, e.lon], ...e.pts].map(([a2, o]) => toM(a2 * K, o * K)).map(P); if (!onS(sp)) continue;
        const w = cl <= 3 ? fill(sp) + (cl > 1 ? work([...sp, sp[0]], 1) : 0) : (PASSES[cl] || [2]).reduce((x, wd) => x + work(sp, wd), 0); acc2[cl] = (acc2[cl] || 0) + w; tot += w; }
      if (!best || tot > best.tot) best = {tot, acc2}; }
    for (const [cl, w] of Object.entries(best.acc2)) per[d][cl] = (per[d][cl] || 0) + w; } }
console.log(process.argv[2], '| blocks', blocks.length, '| all points', allPts);
console.log('class'.padEnd(28), 'entries  points  pts%  est.calls  beyond300m  | work/screen on route  | at 700 m');
const tot0 = Object.values(per[0]).reduce((a, b) => a + b, 0), tot7 = Object.values(per[700]).reduce((a, b) => a + b, 0);
for (const c of Object.keys(NAME)) { const t = T[c]; if (!t) continue;
  const w0 = (per[0][c] || 0) / frames[0], w7 = (per[700][c] || 0) / Math.max(1, frames[700]);
  console.log(NAME[c].padEnd(28), String(t.entries).padStart(7), String(t.pts).padStart(7), (100 * t.pts / allPts).toFixed(0).padStart(5) + '%', String(t.calls).padStart(9), (100 * t.far300 / t.entries).toFixed(0).padStart(9) + '%', '  |', String(Math.round(w0)).padStart(7), `(${(100 * (per[0][c] || 0) / tot0).toFixed(0)}%)`.padStart(6), '  |', String(Math.round(w7)).padStart(7), `(${(100 * (per[700][c] || 0) / Math.max(1, tot7)).toFixed(0)}%)`.padStart(6)); }
