// PSRAM canvas cache simulation: pixel store order of fills (row spans) and lines (steps with a span across the minor
// axis, as rs_line / rs_line_aa) for far frames (cells nearest first, DRAW_ORDER) and detail screens (fills, then lines).
// Cache: set-assoc LRU, write-allocate, write-back; reports stores, line misses, dirty evictions per frame.
import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {readFar, FAR, DRAW_ORDER, WIDTHS} = await import(R + 'far_map.js'); const {readNativeRoute} = await import(R + 'native_route.js');
const {readSections} = await import(R + 'wayback_embed.js'); const {greyCells} = await import(R + 'screen_proof.js');
const {decodeBlockD, isBlockD} = await import(R + 'map_codec.js');
const [,, inp, mode, KB = '32', LB = '32'] = process.argv;
const file = new Uint8Array(fs.readFileSync(inp)), secs = readSections(file), v = new DataView(file.buffer);
const route = readNativeRoute(file).map(r => r.point), lat0 = route[0][0], mE = 111320 * Math.cos(lat0 * Math.PI / 180), mN = 111320, K = 180 / 2 ** 31;
const toM = (la, lo) => [lo * mE, la * mN], RM = route.map(p => toM(...p)), W = 240, H = 256;
const LINE = +LB, WAYS = 8, SETS = (+KB * 1024) / LINE / WAYS;
function cache() { const tag = new Int32Array(SETS * WAYS).fill(-1), age = new Uint32Array(SETS * WAYS), dirty = new Uint8Array(SETS * WAYS); let t = 0, st = 0, miss = 0, wb = 0;
  return { store(addr) { st++; const ln = (addr / LINE) | 0, s = ln % SETS, b = s * WAYS; t++; let v2 = -1, old = b;
      for (let k = b; k < b + WAYS; k++) { if (tag[k] === ln) { v2 = k; break; } if (age[k] < age[old]) old = k; }
      if (v2 < 0) { miss++; if (tag[old] >= 0 && dirty[old]) wb++; tag[old] = ln; v2 = old; } age[v2] = t; dirty[v2] = 1; },
    res() { let d = 0; for (const x of dirty) d += x; return {st, miss, wb: wb + d}; } }; }
const BASE = 0;   // canvas start, row-major 16-bit
function fill(C, p) { let y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9; for (const q of p) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); }
  if (x1 < 0 || x0 >= W) return; y0 = Math.max(0, y0); y1 = Math.min(H - 1, y1);
  for (let y = y0; y <= y1; y++) { const xs = []; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const ya = p[j][1], yb = p[i][1]; if ((ya > y) === (yb > y)) continue; xs.push(Math.ceil(p[j][0] + (y + .5 - ya) * (p[i][0] - p[j][0]) / (yb - ya))); }
    xs.sort((a, b) => a - b); for (let m = 0; m + 1 < xs.length; m += 2) for (let x = Math.max(0, xs[m]); x < Math.min(W, xs[m + 1]); x++) C.store(BASE + 2 * (y * W + x)); } }
function line(C, p, w) { for (let i = 1; i < p.length; i++) { const [xa, ya] = p[i - 1], [xb, yb] = p[i], dx = xb - xa, dy = yb - ya, n = Math.max(Math.abs(dx), Math.abs(dy)), xm = Math.abs(dx) >= Math.abs(dy);
    if (Math.max(xa, xb) < -w || Math.min(xa, xb) > W + w || Math.max(ya, yb) < -w || Math.min(ya, yb) > H + w) continue;
    const L = Math.hypot(dx, dy), ww = Math.max(1, Math.ceil(w * L / (n || 1))), h0 = -((ww - 1) >> 1);
    for (let k = 0; k <= n; k++) { const x = Math.round(xa + dx * k / (n || 1)), y = Math.round(ya + dy * k / (n || 1));
      for (let o = h0; o < h0 + ww; o++) { const px = xm ? x : x + o, py = xm ? y + o : y; if (px >= 0 && px < W && py >= 0 && py < H) C.store(BASE + 2 * (py * W + px)); } } } }
const out = []; let acc = 0;
const P0 = (rider, h) => { const c = Math.cos(h), s = Math.sin(h); return ([x, y]) => [Math.round(120 + ((x - rider[0]) * c - (y - rider[1]) * s) / 2.5), Math.round(216 - ((x - rider[0]) * s + (y - rider[1]) * c) / 2.5)]; };
let farCells, uToM, mToU, blocks;
if (mode === 'far') { const s4 = secs.find(s => s.type === 4), far = readFar(file.subarray(s4.offset, s4.offset + s4.size)), fr = far.frame;
  uToM = ([x, y]) => toM((y * 65536 / fr.latU + fr.lat0E7) / 1e7, (x * 65536 / fr.lonU + fr.lon0E7) / 1e7);
  mToU = ([x, y]) => [Math.floor((Math.round(x / mE * 1e7) - fr.lon0E7) * fr.lonU / 65536), Math.floor((Math.round(y / mN * 1e7) - fr.lat0E7) * fr.latU / 65536)];
  farCells = new Map(far.cells.map(c => [c.key, c.items.map(i => ({cls: i.cls, m: i.pts.map(uToM)}))])); }
else { const mapAt = v.getUint32(0x5c, true), map = file.subarray(mapAt, Math.min(...secs.map(s => s.offset))), mv = new DataView(map.buffer, map.byteOffset); blocks = [];
  for (let o = 4 + mv.getUint32(0, true); o + 4 <= map.length;) { const n = mv.getUint32(o, true); if (!n || o + 4 + n > map.length) break; const b = map.subarray(o + 4, o + 4 + n); if (isBlockD(b)) blocks.push(decodeBlockD(b).map(e => ({c: e.style & 15, ol: !(e.style & 0x400), m: [[e.lat, e.lon], ...e.pts].map(([a, o2]) => toM(a * K, o2 * K))}))); o += 4 + n; } }
const DW = {4: [3], 5: [10, 7], 6: [8, 5], 7: [5, 3], 8: [1.5], 9: [2], 10: [1.5], 11: [4, 2]};
for (let i = 1; i < RM.length; i++) { const a = RM[i - 1], b = RM[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += L; if (acc < 600) continue; acc = 0;
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  for (const d of mode === 'far' ? [0, 700, 2200] : [0]) { const rider = [b[0] + uy * d, b[1] - ux * d];
    for (let hh = 0; hh < 8; hh += 2) { const P = P0(rider, hh * Math.PI / 4); const Cf = cache(), Cl = cache(), Ca = cache();
      if (mode === 'far') { const u = mToU(rider), sel = greyCells(u[0], u[1], hh * 45);
        for (const k of sel) { const its = farCells.get(k) || []; for (const cls of DRAW_ORDER) for (const it of its) if (it.cls === cls) { const p = it.m.map(P);
          if (cls >= 8) { fill(Cf, p); fill(Ca, p); } else for (const w of WIDTHS[cls] || [2]) { line(Cl, p, w); line(Ca, p, w); } } } }
      else { let best = null, bw = -1; for (const es of blocks) { let w = 0; for (const e of es) w += e.m.length; if (w > bw) { bw = w; best = es; } }   // the biggest block, as a stress case
        // choose the block nearest the rider instead
        let nb = null, nd = 1e18; for (const es of blocks) { for (const e of es) { const dd = (e.m[0][0] - rider[0]) ** 2 + (e.m[0][1] - rider[1]) ** 2; if (dd < nd) { nd = dd; nb = es; } } }
        const es = nb; for (const c of [1, 2, 3]) for (const e of es) if (e.c === c) { const p = e.m.map(P); fill(Cf, p); fill(Ca, p); if (e.ol && c > 1) { line(Cl, [...p, p[0]], 1); line(Ca, [...p, p[0]], 1); } }
        for (const c of [4, 9, 8, 10, 7, 6, 5, 11]) for (const w of DW[c] || []) for (const e of es) if (e.c === c) { const p = e.m.map(P); line(Cl, p, w); line(Ca, p, w); } }
      out.push({d, f: Cf.res(), l: Cl.res(), a: Ca.res()}); } } }
const q = (f, p) => { const s = out.map(f).sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const rows = []; for (const [nm, f] of [['fills', o => o.f], ['lines', o => o.l], ['frame', o => o.a]]) for (const p of [.5, .9]) rows.push(`${nm} p${p * 100}: stores ${q(o => f(o).st, p)} misses ${q(o => f(o).miss, p)} (${(q(o => f(o).miss, p) / Math.max(1, q(o => f(o).st, p)) * 100).toFixed(1)}%) writebacks ${q(o => f(o).wb, p)} | stores per miss ${(q(o => f(o).st / Math.max(1, f(o).miss), p)).toFixed(1)}`);
console.log(`${inp} ${mode} cache ${KB} KB line ${LB} B frames ${out.length}\n  ` + rows.join('\n  '));
