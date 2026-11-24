// Far map rs_fill cost per frame: the unit fills every area item of the selected cells without a box check.
// Items beside the screen (x out, y in) still run rows x edges. Compare with a box check and an active-edge fill.
import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {readFar} = await import(R + 'far_map.js'); const {readNativeRoute} = await import(R + 'native_route.js');
const {readSections} = await import(R + 'wayback_embed.js'); const {greyCells} = await import(R + 'screen_proof.js');
const file = new Uint8Array(fs.readFileSync(process.argv[2]));
const secs = readSections(file), s4 = secs.find(s => s.type === 4), far = readFar(file.subarray(s4.offset, s4.offset + s4.size)), fr = far.frame;
const route = readNativeRoute(file).map(r => r.point), lat0 = route[0][0], mE = 111320 * Math.cos(lat0 * Math.PI / 180), mN = 111320;
const toM = (la, lo) => [lo * mE, la * mN], RM = route.map(p => toM(...p));
const uToM = ([x, y]) => toM((y * 65536 / fr.latU + fr.lat0E7) / 1e7, (x * 65536 / fr.lonU + fr.lon0E7) / 1e7);
const mToU = ([x, y]) => [Math.floor((Math.round(x / mE * 1e7) - fr.lon0E7) * fr.lonU / 65536), Math.floor((Math.round(y / mN * 1e7) - fr.lat0E7) * fr.latU / 65536)];
const cells = new Map(far.cells.map(c => [c.key, c.items.filter(i => i.cls >= 8).map(i => i.pts.map(uToM))]));
const W = 240, H = 256;
const res = []; let acc = 0;
for (let i = 1; i < RM.length; i++) { const a = RM[i - 1], b = RM[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); acc += L; if (acc < 600) continue; acc = 0;
  const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
  for (const d of [0, 700, 2200]) for (const side of [1, -1]) { if (!d && side < 0) continue; const rider = [b[0] + uy * d * side, b[1] - ux * d * side];
    for (let h = 0; h < 360; h += 45) { const c = Math.cos(h * Math.PI / 180), s = Math.sin(h * Math.PI / 180), P = ([x, y]) => [Math.round(120 + ((x - rider[0]) * c - (y - rider[1]) * s) / 2.5), Math.round(216 - ((x - rider[0]) * s + (y - rider[1]) * c) / 2.5)];
      const u = mToU(rider), sel = greyCells(u[0], u[1], h); const r = {d, items: 0, pts: 0, testsAll: 0, testsBeside: 0, testsOn: 0, px: 0, aet: 0, itemsBeside: 0, itemsOn: 0};
      for (const k of sel) for (const ring of cells.get(k) || []) { const p = ring.map(P); r.items++; r.pts += p.length; let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const q of p) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
        const ya = Math.max(0, y0), yb = Math.min(H - 1, y1); if (ya > yb) continue; const t = (yb - ya + 1) * p.length; r.testsAll += t;
        if (x1 < 0 || x0 >= W) { r.testsBeside += t; r.itemsBeside++; continue; } r.testsOn += t; r.itemsOn++;
        for (let y = ya; y <= yb; y++) { const xs = []; for (let k2 = 0, j = p.length - 1; k2 < p.length; j = k2++) { const yA = p[j][1], yB = p[k2][1]; if ((yA > y) === (yB > y)) continue; xs.push(p[j][0] + (y + .5 - yA) * (p[k2][0] - p[j][0]) / (yB - yA)); }
          r.aet += xs.length; xs.sort((u2, w) => u2 - w); for (let m = 0; m + 1 < xs.length; m += 2) r.px += Math.max(0, Math.min(W, Math.ceil(xs[m + 1])) - Math.max(0, Math.ceil(xs[m]))); } }
      res.push(r); } } }
const q = (a, f, p) => { const s = a.map(f).sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
console.log(process.argv[2], 'frames', res.length);
for (const d of [0, 700, 2200]) { const a = res.filter(r => r.d === d); for (const p of [.5, .9]) console.log(`${d} m p${p * 100}:`, 'area items', q(a, r => r.items, p), 'pts', q(a, r => r.pts, p), '| rs_fill edge tests', q(a, r => r.testsAll, p), '— beside screen', q(a, r => r.testsBeside, p), `(items ${q(a, r => r.itemsBeside, p)})`, '| on screen', q(a, r => r.testsOn, p), '| with box check + active edges', q(a, r => r.aet, p), '| fill px', q(a, r => r.px, p)); }
