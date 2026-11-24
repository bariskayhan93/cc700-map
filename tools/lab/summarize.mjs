import fs from 'node:fs';
const rows = JSON.parse(fs.readFileSync(process.argv[2]));
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const by = new Map(); for (const r of rows) (by.get(r.d) || by.set(r.d, []).get(r.d)).push(r);
console.log('d     n | det line p50/p90 | det fill p50 | far line p50/p90 | far fill p50/p90 | far reads p50/max | far fill hidden by detail p50 (%) | far line hidden p50');
for (const [d, a] of [...by].sort((x, y) => x[0] - y[0])) {
  const f = k => a.map(r => r.far[k]), g = k => a.map(r => r.det[k]);
  const hid = a.filter(r => r.far.fill > 0).map(r => r.far.fillHidden / r.far.fill * 100);
  console.log(String(d).padEnd(5), String(a.length).padStart(4), '|', q(g('lw'), .5), '/', q(g('lw'), .9), '|', q(g('fill'), .5), '|', q(f('lw'), .5), '/', q(f('lw'), .9), '|', q(f('fill'), .5), '/', q(f('fill'), .9), '|', q(f('reads'), .5), '/', Math.max(...f('reads')), '|', hid.length ? q(hid, .5).toFixed(0) : '-', '|', q(a.map(r => r.far.farLinePx ? r.far.lineHidden / r.far.farLinePx * 100 : 0), .5).toFixed(0), '|', q(f('holes'), .5), '/', q(f('holes'), .9));
}
