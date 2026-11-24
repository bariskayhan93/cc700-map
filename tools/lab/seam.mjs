// Share of green outline length that lies on another green area's edge (a seam), vs against non-green.
import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {decodeBlockD, isBlockD} = await import(R + 'map_codec.js'); const {readSections} = await import(R + 'wayback_embed.js'); const {readNativeRoute} = await import(R + 'native_route.js');
const file = new Uint8Array(fs.readFileSync(process.argv[2])), secs = readSections(file), v = new DataView(file.buffer);
const mapAt = v.getUint32(0x5c, true), map = file.subarray(mapAt, Math.min(...secs.map(s => s.offset))), mv = new DataView(map.buffer, map.byteOffset);
const lat0 = readNativeRoute(file)[0].point[0], mE = 111320 * Math.cos(lat0 * Math.PI / 180), K = 180 / 2 ** 31;
const G = [];
for (let o = 4 + mv.getUint32(0, true); o + 4 <= map.length;) { const n = mv.getUint32(o, true); if (!n || o + 4 + n > map.length) break; const b = map.subarray(o + 4, o + 4 + n); o += 4 + n; if (!isBlockD(b)) continue;
  for (const e of decodeBlockD(b)) if ((e.style & 15) === 2) G.push({ol: !(e.style & 0x400), m: [[e.lat, e.lon], ...e.pts].map(([a, o]) => [o * K * mE, a * K * 111320])}); }
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
const bb = m => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const [x, y] of m) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); } return [x0, y0, x1, y1]; };
for (const g of G) { g.b = bb(g.m); g.k = new Set(g.m.map(([x, y]) => Math.round(x) + ',' + Math.round(y))); }
const same = (g, h) => { let n = 0; for (const [x, y] of h.m) if (g.k.has(Math.round(x) + ',' + Math.round(y))) n++; return n > 0.5 * h.m.length || n > 0.5 * g.m.length; };
const seen = new Set(); for (const [i, g] of G.entries()) { if (!g.ol) continue; for (const [j, h] of G.entries()) if (j < i && h.ol && seen.has(j) && same(g, h)) { g.dup = true; break; } if (!g.dup) seen.add(i); }
const isSame = new Map();
let tot = 0, seam = 0, segs = 0, seamSegs = 0;
for (const [gi, g] of G.entries()) { if (!g.ol || g.dup) continue; const r = [...g.m, g.m[0]];
  for (let i = 1; i < r.length; i++) { const a = r[i - 1], b = r[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!L) continue; tot += L; segs++;
    let on = 0; for (let k = 1; k <= 3; k++) { const p = [a[0] + (b[0] - a[0]) * k / 4, a[1] + (b[1] - a[1]) * k / 4];
      for (const [hi, h] of G.entries()) { if (hi === gi || same(g, h) || p[0] < h.b[0] - 3 || p[0] > h.b[2] + 3 || p[1] < h.b[1] - 3 || p[1] > h.b[3] + 3) continue; const q = [...h.m, h.m[0]]; let hit = false; for (let j = 1; j < q.length; j++) if (segD(p, q[j - 1], q[j]) < 3) { hit = true; break; } if (hit) { on++; break; } } }
    if (on >= 2) { seam += L; seamSegs++; } } }
console.log(process.argv[2], 'green outline km', (tot / 1000).toFixed(1), '| on a shared green edge', (100 * seam / tot).toFixed(0) + '%', '| segments', segs, 'seam segments', seamSegs);
