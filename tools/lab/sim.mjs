// Unit far-map draw simulation: reads, groups, the stop, and the screen share whose cells were drawn complete.
import fs from 'node:fs';
const data = Object.fromEntries(['V0', 'V6'].map(v => [v, JSON.parse(fs.readFileSync(`cells_${v}.json`))]));
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
// cost model (ms). READ: measured 1.04-1.69 ms per read on 19 Nov; slow periods ~10 ms
function run(frame, o, prevCells) {
  const read = () => o.jitter ? 1.0 + 0.7 * rnd() : 1.15;
  let t = o.setup + 2 * read(), work = 0, covered = 0, stopped = false, reads = 2;
  const cached = k => o.cache && prevCells && prevCells.has(k);
  t += frame.rows * read(); reads += frame.rows;                          // table records, one read per row
  for (const c of frame.cells) {
    if (stopped) { if (!c.body) covered += c.area; continue; }
    if (c.body && !cached(c.key)) { t += read(); reads++; }
    let done = true;
    for (const [cls, n, px, upx] of c.groups) {
      const p = (o.merge ? upx : px) * o.k, cost = n * o.k * o.item + p * o.c / 1000;
      if (o.mode === 'time' ? t >= o.limit : work + p > o.cap) { done = false; stopped = true; break; }
      t += cost; work += p;
    }
    if (done) covered += c.area;
  }
  return {cov: covered / 61440, t, reads, stopped};
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function scenario(v, o) {
  const by = {};
  for (const s of data[v]) { let prev = null;
    for (const f of s.sweep) { f.cells.forEach((c, i) => c.key ??= i + ':' + c.area); }
    s.sweep.forEach((f, i) => {
      const keys = new Set(f.cells.map(c => c.key)); // keys are synthetic; use sweep neighbours for the cache by group signature
      const r = run(f, o, prev); prev = keys;
      const r2 = o.jitter ? run(f, o, null) : r;   // the same frame again: flicker
      (by[s.d] ??= []).push({...r, flick: Math.abs(r.cov - r2.cov)});
    }); }
  return by;
}
const BASE = {setup: 3, item: 0.03, c: 0.4, k: 3.5, mode: 'time', limit: 60, merge: false, jitter: true, cache: false};
const rowsOut = [];
function line(name, v, o) { const by = scenario(v, {...BASE, ...o}), cells = [];
  for (const d of [0, 300, 700, 1000, 1500, 2200, 3000]) { const a = by[d] || []; const cov = a.map(x => x.cov);
    cells.push(`${(100 * q(cov, .1)).toFixed(0).padStart(3)}/${(100 * q(cov, .5)).toFixed(0).padStart(3)} ${(100 * a.filter(x => x.cov >= .9).length / a.length).toFixed(0).padStart(3)}% fl${(100 * a.reduce((s, x) => s + x.flick, 0) / a.length).toFixed(0).padStart(2)} ${q(a.map(x => x.t), .9).toFixed(0).padStart(3)}ms`); }
  console.log(name.padEnd(34), cells.join(' | ')); }
console.log('cell: coverage p10/p50 %, share of frames >= 90 %, flicker (mean coverage change between two runs of the same frame, %), far time p90');
console.log(''.padEnd(34), ['0 m', '300 m', '700 m', '1000 m', '1500 m', '2200 m', '3000 m'].map(s => s.padEnd(24)).join('| '));
for (const [label, extra] of [['k 1 (Bayreuth), c 0.4', {k: 1}], ['k 3.5 (your density), c 0.4', {}], ['k 3.5, c 0.2', {c: 0.2}]]) {
  console.log('\n== ' + label);
  for (const v of ['V0', 'V6']) {
    line(`${v} time 60`, v, {...extra});
    line(`${v} time 100`, v, {...extra, limit: 100});
    line(`${v} time 150`, v, {...extra, limit: 150});
    line(`${v} merge + time 60`, v, {...extra, merge: true});
    line(`${v} merge + time 100`, v, {...extra, merge: true, limit: 100});
    line(`${v} merge + work cap 120k px`, v, {...extra, merge: true, mode: 'cap', cap: 120000});
    line(`${v} merge + work cap 200k px`, v, {...extra, merge: true, mode: 'cap', cap: 200000});
  }
}
