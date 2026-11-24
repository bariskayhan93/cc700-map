// Green/water outline cost: today (own pass, re-projected) vs drop vs fused (same projected points) vs near-only vs big-only.
// Per spot on the route (every 300 m) and 700 m off; 24 headings; worst heading per spot is kept.
import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {decodeBlockD, isBlockD} = await import(R + 'map_codec.js'); const {readNativeRoute} = await import(R + 'native_route.js');
const {readSections} = await import(R + 'wayback_embed.js');
const file = new Uint8Array(fs.readFileSync(process.argv[2])), secs = readSections(file), v = new DataView(file.buffer);
const mapAt = v.getUint32(0x5c, true), map = file.subarray(mapAt, Math.min(...secs.map(s => s.offset))), mv = new DataView(map.buffer, map.byteOffset);
const route = readNativeRoute(file).map(r => r.point), lat0 = route[0][0], mE = 111320 * Math.cos(lat0 * Math.PI / 180), K = 180 / 2 ** 31, toM = (a, o) => [o * mE, a * 111320];
const RM = route.map(p => toM(...p)), segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
const dR = p => { let b = 1e9; for (let i = 1; i < RM.length; i++) b = Math.min(b, segD(p, RM[i - 1], RM[i])); return b; };
const PASSES = {4: [3], 5: [10, 7], 6: [8, 5], 7: [5, 3], 8: [2], 9: [2], 10: [2], 11: [4, 2]};
const blocks = [];
for (let o = 4 + mv.getUint32(0, true); o + 4 <= map.length;) { const n = mv.getUint32(o, true); if (!n || o + 4 + n > map.length) break; const b = map.subarray(o + 4, o + 4 + n); if (isBlockD(b)) blocks.push(decodeBlockD(b)); o += 4 + n; }
const area = p => { let s = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) s += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]); return Math.abs(s / 2); };
// prepare entries in metres
const B = blocks.map(ents => ents.filter(e => (e.style & 15) >= 1 && (e.style & 15) <= 11).map(e => { const m = [[e.lat, e.lon], ...e.pts].map(([a, o]) => toM(a * K, o * K)); const c = e.style & 15;
  return {c, m, n: m.length, ol: (c === 2 || c === 3) && !(e.style & 0x400), A: c <= 3 ? area(m) : 0, d: dR(m[Math.floor(m.length / 2)]), br: e.style & 0x80}; }));
// static counts
let st = {olEnt: 0, olPts: 0, allPts: 0, allCalls: 0, olNear: 0, olBig: 0, olPtsNear: 0, olPtsBig: 0, perim: 0, perimNear: 0};
for (const ents of B) for (const e of ents) { st.allPts += e.n; st.allCalls += e.c <= 3 ? 1 : (PASSES[e.c] || [1]).length + (e.br ? 2 : 0);
  if (e.ol) { st.olEnt++; st.olPts += e.n; st.allCalls++; st.allPts += e.n; if (e.d <= 300) { st.olNear++; st.olPtsNear += e.n; } if (e.A >= 20000) { st.olBig++; st.olPtsBig += e.n; } } }
const SW = 240, SH = 256;
const clipLen = p => { let s = 0; for (let i = 1; i < p.length; i++) { const [x0, y0] = p[i - 1], [x1, y1] = p[i]; // length inside screen (sampled)
    const L = Math.hypot(x1 - x0, y1 - y0); if (!L) continue; const k = Math.ceil(L / 4); let inside = 0; for (let j = 0; j < k; j++) { const t = (j + .5) / k, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; if (x >= 0 && x < SW && y >= 0 && y < SH) inside++; } s += L * inside / k; } return s; };
const lineW = (p, w) => clipLen(p) * w;
function fill(p) { let n = 0; for (let y = 0; y < SH; y++) { const yc = y + .5, xs = []; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xa, ya] = p[i], [xb, yb] = p[j]; if ((ya > yc) !== (yb > yc)) xs.push(xa + (yc - ya) * (xb - xa) / (yb - ya)); } xs.sort((a, b) => a - b); for (let k = 0; k + 1 < xs.length; k += 2) n += Math.max(0, Math.min(SW, xs[k + 1]) - Math.max(0, xs[k])); } return n; }
const onS = p => { let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const [x, y] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } return !(x1 < -16 || y1 < -16 || x0 > SW + 16 || y0 > SH + 16); };
const res = {0: [], 700: []}; let acc = 0;
for (let i = 1; i < RM.length; i++) { const a = RM[i - 1], b = RM[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += L; if (acc < 300) continue; acc = 0;
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  for (const d of [0, 700]) { const rider = [b[0] + uy * d, b[1] - ux * d]; if (Math.abs(dR(rider) - d) > 100) continue;
    let worst = null;
    for (let h = 0; h < 24; h++) { const hd = h * Math.PI / 12, c = Math.cos(hd), s = Math.sin(hd);
      const P = ([x, y]) => { const dx = x - rider[0], dy = y - rider[1]; return [120 + (dx * c - dy * s) / 2.5, 216 - (dx * s + dy * c) / 2.5]; };
      for (const ents of B) { const r = {tot: 0, ol: 0, olNear: 0, olBig: 0, olPts: 0, pts: 0, fillG: 0, olEnt: 0};
        for (const e of ents) { const sp = e.m.map(P); if (!onS(sp)) continue; r.pts += e.n;
          if (e.c <= 3) { const f = fill(sp); r.tot += f; if (e.c === 2) r.fillG += f; if (e.ol) { const w = lineW([...sp, sp[0]], 1); r.ol += w; r.olPts += e.n; r.olEnt++; if (e.d <= 300) r.olNear += w; if (e.A >= 20000) r.olBig += w; } }
          else r.tot += (PASSES[e.c] || [2]).reduce((x, wd) => x + lineW(sp, wd), 0); }
        r.totWithOl = r.tot + r.ol; r.ptsWithOl = r.pts + r.olPts;
        if (!worst || r.totWithOl > worst.totWithOl) worst = r; } }
    res[d].push(worst); } }
const q = (a, f, p) => { const s = a.map(f).sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
const out = {file: process.argv[2], static: st, spots: {}};
for (const d of [0, 700]) { const a = res[d]; if (!a.length) continue;
  out.spots[d] = {n: a.length, workP50: q(a, r => r.totWithOl, .5), workP90: q(a, r => r.totWithOl, .9), olP50: q(a, r => r.ol, .5), olP90: q(a, r => r.ol, .9),
    olShareP50: q(a, r => 1000 * r.ol / r.totWithOl, .5) / 10, ptsP90: q(a, r => r.ptsWithOl, .9), olPtsP90: q(a, r => r.olPts, .9), olPtsShareP50: q(a, r => 1000 * r.olPts / r.ptsWithOl, .5) / 10,
    olEntP90: q(a, r => r.olEnt, .9), olFarShareP50: q(a, r => r.ol ? 1000 * (r.ol - r.olNear) / r.ol : 0, .5) / 10, olSmallShareP50: q(a, r => r.ol ? 1000 * (r.ol - r.olBig) / r.ol : 0, .5) / 10}; }
console.log(JSON.stringify(out, null, 1));
