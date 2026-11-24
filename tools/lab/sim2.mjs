import fs from 'node:fs';
const data = Object.fromEntries(['V0', 'V6'].map(v => [v, JSON.parse(fs.readFileSync(`cells_${v}.json`))]));
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
function run(f, o, prev) {
  const read = () => o.read * (0.9 + 0.6 * rnd());
  let t = o.setup + 2 * read(), work = 0, covered = 0, stopped = false;
  t += f.rows * read();
  for (const c of f.cells) {
    if (stopped) { if (!c.body) covered += c.area; continue; }
    if (c.body && !(o.cache && prev?.has(c.key))) t += read();
    let done = true;
    for (const [cls, n, px, upx] of c.groups) {
      const p = (o.merge ? upx : px) * o.k;
      if (t >= o.limit || (o.cap && work + p > o.cap)) { done = false; stopped = true; break; }
      t += n * o.k * o.item + p * o.c / 1000; work += p;
    }
    if (done) covered += c.area;
  }
  return {cov: covered / 61440, t};
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
function scen(v, o) { const by = {};
  for (const s of data[v]) { let prev = null; const covs = [];
    for (const f of s.sweep) { const r = run(f, o, prev); prev = new Set(f.cells.filter(c => c.body).map(c => c.key)); covs.push(r.cov); (by[s.d] ??= {f: [], spread: []}).f.push(r); }
    by[s.d].spread.push(Math.max(...covs) - Math.min(...covs)); }
  return by; }
const BASE = {setup: 3, item: 0.03, c: 0.4, k: 3.5, limit: 60, merge: false, cache: false, cap: 0, read: 1.15};
const S = [
  ['S1 today: time 60', 'V0', {}],
  ['S2 today data, time 150', 'V0', {limit: 150}],
  ['S3 V6 + merge, time 100', 'V6', {merge: true, limit: 100}],
  ['S4 V6 + merge, time 150', 'V6', {merge: true, limit: 150}],
  ['S5 V6 + merge + cache, time 100', 'V6', {merge: true, cache: true, limit: 100}],
  ['S6 V6 + merge + cap 190k, stop 150', 'V6', {merge: true, cap: 190000, limit: 150}],
  ['S7 V6 + merge + cap 190k + cache, 150', 'V6', {merge: true, cache: true, cap: 190000, limit: 150}],
];
const bands = [0, 300, 700, 1000, 1500, 2200, 3000];
for (const [label, ex] of [['your density (k 3.5), 0.4 us/px', {}], ['your density, 0.2 us/px', {c: 0.2}], ['slow flash: 5 ms per read, 0.4 us/px', {read: 5}]]) {
  console.log(`\n== ${label}   cell: frames >=70 % / >=90 % covered | p10 coverage | turn spread p90 | far ms p90`);
  console.log(''.padEnd(40), bands.map(b => (b + ' m').padEnd(25)).join('|'));
  for (const [name, v, o] of S) { const by = scen(v, {...BASE, ...ex, ...o});
    console.log(name.padEnd(40), bands.map(d => { const a = by[d].f, cov = a.map(x => x.cov);
      return `${(100 * cov.filter(x => x >= .7).length / cov.length).toFixed(0).padStart(3)}/${(100 * cov.filter(x => x >= .9).length / cov.length).toFixed(0).padStart(3)} p10 ${(100 * q(cov, .1)).toFixed(0).padStart(3)} sp${(100 * q(by[d].spread, .9)).toFixed(0).padStart(3)} ${q(a.map(x => x.t), .9).toFixed(0).padStart(3)}ms`; }).join('|')); }
}
