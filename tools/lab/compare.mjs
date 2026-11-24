import fs from 'node:fs';
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0; };
const k = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(Math.round(n));
const vs = process.argv.slice(2), bands = [0, 300, 500, 700, 1000, 1500, 2000];
for (const v of vs) {
  const rows = JSON.parse(fs.readFileSync(`rows_${v}.json`)), by = d => rows.filter(r => r.d === d);
  console.log(`\n${v}  band | det line | det fill | far line | far fill raw p50/p90 | far fill hidden | far streets hidden | visible streets px | visible fill px`);
  for (const d of bands) { const a = by(d), F = x => a.map(r => r.far[x]), D = x => a.map(r => r.det[x]);
    const tf = a.reduce((s, r) => s + r.far.fill, 0), th = a.reduce((s, r) => s + r.far.fillHidden, 0), tl = a.reduce((s, r) => s + r.far.farLinePx, 0), tlh = a.reduce((s, r) => s + r.far.lineHidden, 0);
    console.log(String(d).padStart(9), '|', k(q(D('lw'), .5)).padStart(6), '|', k(q(D('fill'), .5)).padStart(6), '|', k(q(F('lw'), .5)).padStart(6), '|', (k(q(F('rawFill'), .5)) + ' / ' + k(q(F('rawFill'), .9))).padStart(13), '|', (tf ? (100 * th / tf).toFixed(0) + '%' : '-').padStart(5), '|', (tl ? (100 * tlh / tl).toFixed(0) + '%' : '-').padStart(5), '|', k(q(F('uLine'), .5)).padStart(6), '|', k(q(F('uFill'), .5)).padStart(6));
  }
}
