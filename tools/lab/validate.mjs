import fs from 'node:fs'; import {execFileSync} from 'node:child_process';
const R = new URL('../../js/', import.meta.url).pathname;
const {readNativeRoute} = await import(R + 'native_route.js'); const {readSections} = await import(R + 'wayback_embed.js');
const f = process.argv[2], b = new Uint8Array(fs.readFileSync(f)), s = readSections(b).find(x => x.type === 4), route = readNativeRoute(b).map(r => r.point);
const out = [];
for (const [i, d] of [[200, 0], [200, 700], [400, 1000], [600, 2000], [800, 500]]) {
  const a = route[i], c = route[i + 3], K = Math.cos(a[0] * Math.PI / 180), ux = (c[1] - a[1]) * K, uy = c[0] - a[0], L = Math.hypot(ux, uy);
  const la = a[0] - ux / L * d / 111320, lo = a[1] + uy / L * d / 111320 / K, head = Math.round((Math.atan2(ux, uy) * 180 / Math.PI + 360) % 360);
  for (const lim of [1e9, 0]) out.push({i, d, lim: lim ? 'none' : '0', ...JSON.parse(execFileSync('./far_host', ['draw', f, s.offset, s.size, Math.round(la * 1e7), Math.round(lo * 1e7), head, 2.5, 0, 0, 0, lim].map(String), {encoding: 'utf8'}))});
}
for (const o of out.filter(o => o.lim === 'none')) console.log(JSON.stringify({d: o.d, done: o.done, lines: o.lines, areas: o.areas, points: o.points, work: o.work, reads: o.reads, forestPx: o.forestPx, streetPx: o.streetPx}));
