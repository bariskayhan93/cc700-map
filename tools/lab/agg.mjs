import fs from 'node:fs';
const C = {proj: .2e-3, chk: .08e-3, band: .06e-3, cross: .2e-3, store: .025e-3, miss: .45e-3, read: 1.27};
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const V = [
 ['A today', 'A', {}], ['A + fused outline', 'A', {fused: 1}], ['A + no outline (or two greens)', 'A', {noOl: 1}], ['A + band fill', 'A', {band: 1}],
 ['A + far cell cache', 'A', {cache: 1}], ['A + firmware set (band, fused, cache)', 'A', {band: 1, fused: 1, cache: 1}],
 ['B handover', 'B', {}], ['B + merged areas', 'B', {merge: 1}], ['B + merged + firmware set', 'B', {merge: 1, band: 1, fused: 1, cache: 1}]];
const res = {};
for (const area of ['nb', 'mc']) { const D = {A: JSON.parse(fs.readFileSync(`simall_A_${area}.json`)), B: JSON.parse(fs.readFileSync(`simall_B_${area}.json`))};
  res[area] = [];
  for (const [name, base, o] of V) { const d = D[base], F = d.frames, on = F.filter(f => f.d === 0);
    const detMs = f => { const t = f.det; let pts = t.pts - (o.fused || o.noOl ? t.olPts : 0), st = t.st - (o.noOl ? t.olSt : 0);
      return pts * C.proj + (o.band ? t.band * C.band : t.chk * C.chk) + t.cross * C.cross + st * C.store + t.miss * C.miss; };
    const farDraw = (c, f) => (o.band ? c.band * C.band : c.chk * C.chk) + c.cross * C.cross + (c.st - (o.merge && f.far.st ? c.st * f.far.over / f.far.st : 0)) * C.store + c.miss * C.miss;
    const farRun = (f, setup, lim) => { let t = setup + (o.cache ? 0 : 2 + f.far.rows) * C.read, done = 0, all = f.far.px, ms = t;
      for (const c of f.far.cells) { t += (c.body && !o.cache ? C.read : 0) + farDraw(c, f); if (t <= lim) done += c.px; } return {pct: all ? 100 * done / all : 100, ms: t}; };
    const setup = o.cache ? 10 : 35;
    const reads = F.map(f => o.cache ? 0 : 2 + f.far.rows + f.far.bodies);
    const r = {name, file: d.size, detPts50: q(on.map(f => f.det.pts - (o.fused || o.noOl ? f.det.olPts : 0)), .5), detPts90: q(on.map(f => f.det.pts - (o.fused || o.noOl ? f.det.olPts : 0)), .9),
      detMs50: q(on.map(detMs), .5), detMs90: q(on.map(detMs), .9), reads50: q(reads, .5), reads90: q(reads, .9),
      farMs50: q(F.map(f => farRun(f, setup, 1e9).ms), .5), farMs90: q(F.map(f => farRun(f, setup, 1e9).ms), .9),
      drawn50: q(F.map(f => farRun(f, setup, 60).pct), .5), drawn10: q(F.map(f => farRun(f, setup, 60).pct), .1),
      drawnLo10: q(F.map(f => farRun(f, o.cache ? 5 : 20, 60).pct), .1), drawnHi10: q(F.map(f => farRun(f, o.cache ? 20 : 45, 60).pct), .1),
      cover50: q(on.map(f => 100 * f.cover), .5), coverOff50: q(F.filter(f => f.d > 0).map(f => 100 * f.cover), .5),
      sp: {setup, reads: q(F.map(f => (o.cache ? 0 : 2 + f.far.rows + f.far.bodies) * C.read), .5), draw: q(F.map(f => f.far.cells.reduce((t, c) => t + farDraw(c, f), 0)), .5), det: q(on.map(detMs), .5)},
      psram: o.cache ? 48 : 0, stack: o.band ? 560 : 0, code: (o.band ? 600 : 0) + (o.fused ? 40 : 0) + (o.cache ? 1500 : 0)};
    res[area].push(r); } }
fs.writeFileSync('agg.json', JSON.stringify(res));
for (const [a, rows] of Object.entries(res)) { console.log('==', a); for (const r of rows) console.log(r.name.padEnd(40), 'file', r.file, 'detPts', r.detPts50, r.detPts90, 'detMs', r.detMs50.toFixed(1), r.detMs90.toFixed(1), 'reads', r.reads50, r.reads90, 'farMs', r.farMs50.toFixed(0), r.farMs90.toFixed(0), 'drawn', r.drawn50.toFixed(0), r.drawn10.toFixed(0), `(${r.drawnLo10.toFixed(0)}-${r.drawnHi10.toFixed(0)})`, 'cover', r.cover50.toFixed(0), r.coverOff50.toFixed(0)); }
