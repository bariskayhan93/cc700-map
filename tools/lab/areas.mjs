// Area layers (built-up, green, water): points, simplification head-room, tiny areas, and per-screen fill cost:
// pixel writes, rs_fill edge tests (rows x edges, as raster.c), overdraw between fills. Worst of 8 headings per spot.
import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {decodeBlockD, isBlockD} = await import(R + 'map_codec.js'); const {readNativeRoute} = await import(R + 'native_route.js'); const {readSections} = await import(R + 'wayback_embed.js');
const file = new Uint8Array(fs.readFileSync(process.argv[2])), secs = readSections(file), v = new DataView(file.buffer);
const mapAt = v.getUint32(0x5c, true), map = file.subarray(mapAt, Math.min(...secs.map(s => s.offset))), mv = new DataView(map.buffer, map.byteOffset);
const route = readNativeRoute(file).map(r => r.point), lat0 = route[0][0], mE = 111320 * Math.cos(lat0 * Math.PI / 180), K = 180 / 2 ** 31, toM = (a, o) => [o * mE, a * 111320];
const RM = route.map(p => toM(...p));
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
const dR = p => { let b = 1e9; for (let i = 1; i < RM.length; i++) b = Math.min(b, segD(p, RM[i - 1], RM[i])); return b; };
const area = p => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(s / 2); };
const dp = (P, tol) => { if (P.length < 3) return P.length; const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1; const st = [[0, P.length - 1]];
  while (st.length) { const [a, b] = st.pop(); let m = -1, md = tol; for (let i = a + 1; i < b; i++) { const d = segD(P[i], P[a], P[b]); if (d > md) { md = d; m = i; } } if (m >= 0) { keep[m] = 1; st.push([a, m], [m, b]); } } return keep.reduce((s, x) => s + x, 0); };
const blocks = []; for (let o = 4 + mv.getUint32(0, true); o + 4 <= map.length;) { const n = mv.getUint32(o, true); if (!n || o + 4 + n > map.length) break; const b = map.subarray(o + 4, o + 4 + n); if (isBlockD(b)) blocks.push(decodeBlockD(b)); o += 4 + n; }
const B = blocks.map(ents => ents.filter(e => (e.style & 15) >= 1 && (e.style & 15) <= 3).map(e => { const m = [[e.lat, e.lon], ...e.pts].map(([a, o]) => toM(a * K, o * K)); return {c: e.style & 15, m, ol: (e.style & 15) > 1 && !(e.style & 0x400), A: area(m)}; }));
const NM = {1: 'built-up', 2: 'green', 3: 'water'}, S = {};
for (const ents of B) for (const e of ents) { const s = S[e.c] ??= {ent: 0, pts: 0, dp25: 0, dp5: 0, tinyEnt: 0, tinyPts: 0, bigPts: 0};
  s.ent++; s.pts += e.m.length; s.dp25 += dp(e.m, 2.5); s.dp5 += dp(e.m, 5); if (e.A < 2000) { s.tinyEnt++; s.tinyPts += e.m.length; } }
const W = 240, H = 256;
const res = []; let acc = 0;
for (let i = 1; i < RM.length; i++) { const a = RM[i - 1], b = RM[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += L; if (acc < 300) continue; acc = 0;
  let worst = null;
  for (let h = 0; h < 8; h++) { const hd = h * Math.PI / 4, c = Math.cos(hd), s = Math.sin(hd), P = ([x, y]) => [Math.round(120 + ((x - b[0]) * c - (y - b[1]) * s) / 2.5), Math.round(216 - ((x - b[0]) * s + (y - b[1]) * c) / 2.5)];
    for (const ents of B) { const owner = new Int8Array(W * H), r = {px: {1: 0, 2: 0, 3: 0}, tests: {1: 0, 2: 0, 3: 0}, testsAET: 0, over: 0, unique: 0, offx: 0, olpx: 0, n: 0};
      for (const c of [1, 2, 3]) for (const e of ents) if (e.c === c) { const p = e.m.map(P); let y0 = 1e9, y1 = -1e9, x0 = 1e9, x1 = -1e9; for (const q of p) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); }
        if (x1 < -16 || x0 > W + 16 || y1 < -16 || y0 > H + 16) continue; y0 = Math.max(0, y0); y1 = Math.min(H - 1, y1); if (y0 > y1) continue; r.n++;
        const rows = y1 - y0 + 1; r.tests[c] += rows * p.length; if (x1 < 0 || x0 >= W) r.offx += rows * p.length;
        for (let y = y0; y <= y1; y++) { const xs = []; for (let k = 0, j = p.length - 1; k < p.length; j = k++) { const ya = p[j][1], yb = p[k][1]; if ((ya > y) === (yb > y)) continue; const [xa, xb] = [p[j][0], p[k][0]]; xs.push(xa + (y + .5 - ya) * (xb - xa) / (yb - ya)); }
          r.testsAET += xs.length; xs.sort((u, w) => u - w);
          for (let m = 0; m + 1 < xs.length; m += 2) for (let x = Math.max(0, Math.ceil(xs[m])); x < Math.min(W, Math.ceil(xs[m + 1])); x++) { r.px[c]++; const o = y * W + x; if (owner[o]) r.over++; owner[o] = c; } }
        if (e.ol) for (let k = 1; k <= p.length; k++) { const [xa, ya] = p[k - 1], [xb, yb] = p[k % p.length]; const n = Math.max(Math.abs(xb - xa), Math.abs(yb - ya)); for (let t = 0; t <= n; t++) { const x = xa + (xb - xa) * t / (n || 1), y = ya + (yb - ya) * t / (n || 1); if (x >= 0 && x < W && y >= 0 && y < H) r.olpx++; } } }
      for (const o of owner) if (o) r.unique++;
      r.allPx = r.px[1] + r.px[2] + r.px[3]; r.allTests = r.tests[1] + r.tests[2] + r.tests[3];
      if (!worst || r.allPx + r.allTests > worst.allPx + worst.allTests) worst = r; } }
  res.push(worst); }
const q = (f, p) => { const s = res.map(f).sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
console.log(process.argv[2], 'spots', res.length);
for (const [c, s] of Object.entries(S)) console.log(NM[c].padEnd(9), 'entries', s.ent, 'points', s.pts, '| after 2.5 m DP', s.dp25, `(${(100 * s.dp25 / s.pts).toFixed(0)}%)`, '| 5 m', s.dp5, `(${(100 * s.dp5 / s.pts).toFixed(0)}%)`, '| tiny <2000 m2', s.tinyEnt, 'ent', s.tinyPts, 'pts');
for (const p of [.5, .9]) console.log(`p${p * 100}`, 'fill px', q(r => r.allPx, p), '(built', q(r => r.px[1], p), 'green', q(r => r.px[2], p), 'water', q(r => r.px[3], p) + ')', '| unique px', q(r => r.unique, p), '| overdraw px', q(r => r.over, p),
  '| edge tests rs_fill', q(r => r.allTests, p), '| with active-edge table', q(r => r.testsAET, p), '| tests on fills fully off-screen in x', q(r => r.offx, p), '| outline px', q(r => r.olpx, p), '| fills', q(r => r.n, p));
