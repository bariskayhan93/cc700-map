// One frame model for every variant. Frames: route spots every 600 m, rider 0 / 700 / 2200 m off, 8 headings.
// Detail: nearest block, fills (old checks or band visits), outline (own pass / fused / none), lines (stores); projection points.
// Far: cells nearest first; reads (uncached / cached); per cell: body read + drawing; stop at FAR_US; "far drawn" = pixels
// of completed cells / pixels of all cells. Cache: 32 KB 8-way 32 B lines over the canvas.
import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {readFar, DRAW_ORDER, WIDTHS} = await import(R + 'far_map.js'); const {readNativeRoute} = await import(R + 'native_route.js');
const {readSections} = await import(R + 'wayback_embed.js'); const {greyCells} = await import(R + 'screen_proof.js'); const {decodeBlockD, isBlockD} = await import(R + 'map_codec.js');
const [,, inp, tag] = process.argv;
const C = {proj: .2, chk: .08, band: .06, cross: .2, store: .025, miss: .45, read: 1.27, setup: +(process.env.SETUP || 35), farUs: +(process.env.FARMS || 60)};
const file = new Uint8Array(fs.readFileSync(inp)), secs = readSections(file), v = new DataView(file.buffer);
const route = readNativeRoute(file).map(r => r.point), lat0 = route[0][0], mE = 111320 * Math.cos(lat0 * Math.PI / 180), mN = 111320, K = 180 / 2 ** 31;
const toM = (la, lo) => [lo * mE, la * mN], RM = route.map(p => toM(...p)), W = 240, H = 256;
function cache() { const LINE = 32, WAYS = 8, SETS = 32768 / LINE / WAYS, tag = new Int32Array(SETS * WAYS).fill(-1), age = new Uint32Array(SETS * WAYS); let t = 0, miss = 0, st = 0;
  return { s(a) { st++; const ln = (a / LINE) | 0, s = ln % SETS, b = s * WAYS; t++; let h = -1, old = b; for (let k = b; k < b + WAYS; k++) { if (tag[k] === ln) { h = k; break; } if (age[k] < age[old]) old = k; } if (h < 0) { miss++; tag[old] = ln; h = old; } age[h] = t; }, get miss() { return miss; }, get st() { return st; } }; }
function fill(cc, p, cnt, mask) { let y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9; for (const q of p) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); }
  const ya = Math.max(0, y0), yb = Math.min(H - 1, y1); if (ya > yb) return; cnt.chk += (yb - ya + 1) * p.length; if (x1 < 0 || x0 >= W) { cnt.beside += (yb - ya + 1) * p.length; return; }
  const n = p.length, rows = yb - ya + 1; cnt.band += n * rows < 4096 ? n * rows : Math.ceil(rows / 16) * n;
  for (let y = ya; y <= yb; y++) { const xs = []; for (let i = 0, j = n - 1; i < n; j = i++) { const A = p[j][1], B = p[i][1]; if ((A > y) === (B > y)) continue; xs.push(Math.ceil(p[j][0] + (y + .5 - A) * (p[i][0] - p[j][0]) / (B - A))); }
    cnt.cross += xs.length; if (n * rows >= 4096) cnt.band += xs.length * 2; xs.sort((a, b) => a - b);
    for (let m = 0; m + 1 < xs.length; m += 2) for (let x = Math.max(0, xs[m]); x < Math.min(W, xs[m + 1]); x++) { cc.s(2 * (y * W + x)); const o = y * W + x; if (mask) { if (mask[o]) cnt.over++; mask[o] = 1; } } } }
function line(cc, p, w, mask) { for (let i = 1; i < p.length; i++) { const [xa, ya] = p[i - 1], [xb, yb] = p[i], dx = xb - xa, dy = yb - ya, n = Math.max(Math.abs(dx), Math.abs(dy)), xm = Math.abs(dx) >= Math.abs(dy);
    if (Math.max(xa, xb) < -w || Math.min(xa, xb) > W + w || Math.max(ya, yb) < -w || Math.min(ya, yb) > H + w) continue;
    const ww = Math.max(1, Math.ceil(w * Math.hypot(dx, dy) / (n || 1))), h0 = -((ww - 1) >> 1);
    for (let k = 0; k <= n; k++) { const x = Math.round(xa + dx * k / (n || 1)), y = Math.round(ya + dy * k / (n || 1));
      for (let o = h0; o < h0 + ww; o++) { const px = xm ? x : x + o, py = xm ? y + o : y; if (px >= 0 && px < W && py >= 0 && py < H) { cc.s(2 * (py * W + px)); if (mask) mask[py * W + px] = 1; } } } } }
// data
const mapAt = v.getUint32(0x5c, true), map = file.subarray(mapAt, Math.min(...secs.map(s => s.offset))), mv = new DataView(map.buffer, map.byteOffset), blocks = [];
for (let o = 4 + mv.getUint32(0, true); o + 4 <= map.length;) { const n = mv.getUint32(o, true); if (!n || o + 4 + n > map.length) break; const b = map.subarray(o + 4, o + 4 + n); if (isBlockD(b)) blocks.push(decodeBlockD(b).map(e => ({c: e.style & 15, br: e.style & 0x80, ol: (e.style & 15) > 1 && (e.style & 15) < 4 && !(e.style & 0x400), m: [[e.lat, e.lon], ...e.pts].map(([a, o2]) => toM(a * K, o2 * K))}))); o += 4 + n; }
const s4 = secs.find(s => s.type === 4), far = s4 && readFar(file.subarray(s4.offset, s4.offset + s4.size)), fr = far && far.frame;
const uToM = ([x, y]) => toM((y * 65536 / fr.latU + fr.lat0E7) / 1e7, (x * 65536 / fr.lonU + fr.lon0E7) / 1e7);
const mToU = ([x, y]) => [Math.floor((Math.round(x / mE * 1e7) - fr.lon0E7) * fr.lonU / 65536), Math.floor((Math.round(y / mN * 1e7) - fr.lat0E7) * fr.latU / 65536)];
const fcells = new Map(far.cells.map(c => [c.key, c.items.map(i => ({cls: i.cls, m: i.pts.map(uToM)}))]));
const DW = {4: [3], 5: [10, 7], 6: [8, 5], 7: [5, 3], 8: [2], 9: [2], 10: [2], 11: [4, 2]}, PASS = {4: 1, 5: 2, 6: 2, 7: 2, 8: 1, 9: 1, 10: 1, 11: 2};
const P0 = (rider, h) => { const c = Math.cos(h), s = Math.sin(h); return ([x, y]) => [Math.round(120 + ((x - rider[0]) * c - (y - rider[1]) * s) / 2.5), Math.round(216 - ((x - rider[0]) * s + (y - rider[1]) * c) / 2.5)]; };
const out = []; let acc = 0;
for (let i = 1; i < RM.length; i++) { const a = RM[i - 1], b = RM[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += L; if (acc < 600) continue; acc = 0;
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  for (const d of [0, 700, 2200]) { const rider = [b[0] + uy * d, b[1] - ux * d];
    let nb = null, nd = 1e18; for (const es of blocks) for (const e of es) { const dd = (e.m[0][0] - rider[0]) ** 2 + (e.m[0][1] - rider[1]) ** 2; if (dd < nd) { nd = dd; nb = es; } }
    for (let hh = 0; hh < 8; hh++) { const P = P0(rider, hh * Math.PI / 4), f = {d};
      // far
      const cc = cache(), u = mToU(rider), sel = greyCells(u[0], u[1], hh * 45), rows = new Set(sel.map(k => k >>> 16)).size, mask = new Uint8Array(W * H);
      const cells = []; let tot = {chk: 0, beside: 0, band: 0, cross: 0, over: 0};
      for (const k of sel) { const its = fcells.get(k) || [], m0 = cc.miss, s0 = cc.st, c0 = {...tot}, cm = new Uint8Array(W * H);
        for (const cls of DRAW_ORDER) for (const it of its) if (it.cls === cls) { const p = it.m.map(P); if (cls >= 8) fill(cc, p, tot, mask); else for (const w of WIDTHS[cls] || [2]) line(cc, p, w, mask); }
        // pixels this cell adds to the screen (for "drawn" share)
        cells.push({body: its.length > 0, st: cc.st - s0, miss: cc.miss - m0, chk: tot.chk - c0.chk, band: tot.band - c0.band, cross: tot.cross - c0.cross, px: 0}); }
      // drawn share: pixels painted by each cell in order (recount with per-cell masks)
      { const seen = new Uint8Array(W * H); let ci = 0; for (const k of sel) { const its = fcells.get(k) || [], cmask = new Uint8Array(W * H), dummy = cache(), t2 = {chk: 0, beside: 0, band: 0, cross: 0, over: 0};
          for (const cls of DRAW_ORDER) for (const it of its) if (it.cls === cls) { const p = it.m.map(P); if (cls >= 8) fill(dummy, p, t2, cmask); else for (const w of WIDTHS[cls] || [2]) line(dummy, p, w, cmask); }
          let add = 0; for (let o = 0; o < W * H; o++) if (cmask[o] && !seen[o]) { seen[o] = 1; add++; } cells[ci++].px = add; } }
      f.far = {rows, bodies: cells.filter(c => c.body).length, cells, st: cc.st, miss: cc.miss, ...tot, px: cells.reduce((s, c) => s + c.px, 0)};
      // detail (nearest block): fills, outline, lines
      const dc = cache(), dt = {chk: 0, beside: 0, band: 0, cross: 0, over: 0}, dmask = new Uint8Array(W * H); let pts = 0, olPts = 0, olSt = 0, lineSt = 0, fillSt = 0;
      const vis = p => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); } return !(x1 < -16 || x0 > W + 16 || y1 < -16 || y0 > H + 16); };
      for (const e of nb) { if (e.c < 1 || e.c > 11) continue; pts += e.m.length * (e.c <= 3 ? 1 : (PASS[e.c] || 1) + (e.br ? 2 : 0)); if (e.ol) olPts += e.m.length; }
      for (const c of [1, 2, 3]) for (const e of nb) if (e.c === c) { const p = e.m.map(P); if (!vis(p)) continue; const s0 = dc.st; fill(dc, p, dt, dmask); fillSt += dc.st - s0; if (e.ol) { const s1 = dc.st; line(dc, [...p, p[0]], 1, dmask); olSt += dc.st - s1; } }
      for (const c of [4, 9, 8, 10, 7, 6, 5, 11]) for (const w of DW[c] || []) for (const e of nb) if (e.c === c) { const p = e.m.map(P); if (!vis(p)) continue; const s0 = dc.st; line(dc, p, w, dmask); lineSt += dc.st - s0; }
      let dpx = 0; for (const x of dmask) dpx += x; let both = 0; for (let o = 0; o < W * H; o++) if (dmask[o] || mask[o]) both++;
      f.det = {pts, olPts, st: dc.st, miss: dc.miss, olSt, fillSt, lineSt, ...dt, px: dpx}; f.cover = both / (W * H);
      out.push(f); } } }
fs.writeFileSync(`simall_${tag}.json`, JSON.stringify({file: inp, size: file.length, secs: secs.map(s => [s.type, s.size]), frames: out}));
console.log(tag, 'frames', out.length);
