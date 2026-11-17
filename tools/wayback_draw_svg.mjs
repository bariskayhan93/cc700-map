#!/usr/bin/env node
// Static picture of a page from tools/wayback_draw.mjs, with the rider held at one place.
// Usage: node tools/wayback_draw_svg.mjs <page.html> <out.svg> <x 0..1 from the left | auto> <y 0..1 from the top>
import fs from 'node:fs';
const [page, out, fx = '0.5', fy = '0.5'] = process.argv.slice(2);
if (!page || !out) { console.error('usage: node tools/wayback_draw_svg.mjs <page.html> <out.svg> [x] [y]'); process.exit(2); }
const D = JSON.parse(fs.readFileSync(page, 'utf8').match(/const D=(\{.*?\});\n/s)[1]);
const Y = y => D.H - y, o = [];
const inWin = n => n[0] > -400 && n[0] < D.W + 400 && n[1] > -400 && n[1] < D.H + 400;
o.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${D.W} ${D.H + 1500}" font-family="Helvetica,Arial,sans-serif"><rect width="${D.W}" height="${D.H + 1500}" fill="#fff"/><clipPath id="c"><rect width="${D.W}" height="${D.H}"/></clipPath><g clip-path="url(#c)">`);
// green area: one rectangle for each run of squares in a row
let g = '';
for (let r = 0; r < D.grid.length / D.cols; r++) for (let c = 0; c < D.cols; c++) {
  if (!D.grid[r * D.cols + c]) continue;
  let e = c; while (e + 1 < D.cols && D.grid[r * D.cols + e + 1]) e++;
  g += `M${c * D.G} ${Y((r + 1) * D.G)}h${(e - c + 1) * D.G}v${D.G}h${-(e - c + 1) * D.G}z`; c = e;
}
o.push(`<path fill="#d9f2d9" d="${g}"/>`);
let s = '', a = '', dots = '';
for (const n of D.nodes) {
  if (n[2] < 0) continue; const b = D.nodes[n[2]]; if (!inWin(n) && !inWin(b)) continue;
  s += `M${n[0]} ${Y(n[1])}L${b[0]} ${Y(b[1])}`;
  const dx = b[0] - n[0], dy = b[1] - n[1], L = Math.hypot(dx, dy); if (L < 260) continue;
  const ux = dx / L, uy = dy / L, cx = n[0] + dx * .55, cy = n[1] + dy * .55, k = 62, r = v => Math.round(v);
  a += `M${r(cx + ux * k)} ${r(Y(cy + uy * k))}L${r(cx - ux * k - uy * k * .7)} ${r(Y(cy - uy * k + ux * k * .7))}L${r(cx - ux * k + uy * k * .7)} ${r(Y(cy - uy * k - ux * k * .7))}Z`;
}
o.push(`<path stroke="#999" stroke-width="22" fill="none" d="${s}"/><path fill="#777" d="${a}"/>`);
s = ''; for (const [p, q] of D.extras) s += `M${D.nodes[p][0]} ${Y(D.nodes[p][1])}L${D.nodes[q][0]} ${Y(D.nodes[q][1])}`;
o.push(`<path stroke="#d08700" stroke-width="22" stroke-dasharray="70 50" fill="none" d="${s}"/>`);
for (const n of D.nodes) if (n[0] > 0 && n[0] < D.W && n[1] > 0 && n[1] < D.H) dots += `M${n[0] - 26} ${Y(n[1])}a26 26 0 1 0 52 0a26 26 0 1 0 -52 0`;
o.push(`<path fill="#666" d="${dots}"/>`);
o.push(`<polyline points="${D.route.map(p => p[0] + ',' + Y(p[1])).join(' ')}" stroke="#1f6feb" stroke-width="80" fill="none" stroke-linejoin="round" stroke-opacity=".85"/>`);
// the rider and the line
const chain = c => { const p = [[c[0], c[1]]]; let k = c[2]; while (k >= 0 && p.length < 32) { p.push([D.nodes[k][0], D.nodes[k][1]]); k = D.nodes[k][2]; } return k < 0 && p.every(q => q[0] > 600 && q[0] < D.W - 600 && q[1] > 900 && q[1] < D.H - 600) ? p : null; };
let x = fx * D.W, y = (1 - fy) * D.H;
if (fx === 'auto') {   // the longest line that reaches the route inside the picture
  let best = -1;
  D.grid.forEach((c, i) => { if (c && c[3] > best && chain(c)) { best = c[3]; x = (i % D.cols + .5) * D.G; y = (Math.floor(i / D.cols) + .5) * D.G; } });
}
const c = D.grid[Math.floor(y / D.G) * D.cols + Math.floor(x / D.G)];
if (!c) { console.error('no line at this place'); process.exit(1); }
const pts = [[c[0], c[1]]]; let k = c[2]; while (k >= 0 && pts.length < 32) { pts.push([D.nodes[k][0], D.nodes[k][1]]); k = D.nodes[k][2]; }
const line = pts.map(p => p[0] + ',' + Y(p[1])).join(' ');
o.push(`<polyline points="${line}" fill="none" stroke="#fff" stroke-width="150" stroke-linejoin="round" stroke-linecap="round"/><polyline points="${line}" fill="none" stroke="#5b1a8c" stroke-width="90" stroke-linejoin="round" stroke-linecap="round"/>`);
o.push(`<circle cx="${x}" cy="${Y(y)}" r="240" fill="none" stroke="#e8590c" stroke-width="18" stroke-dasharray="50 40"/><circle cx="${x}" cy="${Y(y)}" r="110" fill="#e8590c" stroke="#fff" stroke-width="30"/>`);
o.push(`<line x1="300" y1="${D.H - 300}" x2="1900" y2="${D.H - 300}" stroke="#000" stroke-width="30"/><text x="300" y="${D.H - 380}" font-size="260">100 m</text><text x="${D.W - 600}" y="420" font-size="300">N ↑</text></g>`);
// legend
const L = (i, mark, text) => `<g transform="translate(${300 + (i % 3) * 4150},${D.H + 420 + Math.floor(i / 3) * 520})">${mark}<text x="620" y="90" font-size="250" fill="#222">${text}</text></g>`;
o.push(`<rect y="${D.H}" width="${D.W}" height="1500" fill="#f4f4f1"/>`
  + L(0, '<line x2="480" y1="10" y2="10" stroke="#1f6feb" stroke-width="80"/>', 'Route')
  + L(1, '<line x2="480" y1="10" y2="10" stroke="#5b1a8c" stroke-width="90"/>', `Way-back line, ${c[3]} m`)
  + L(2, '<circle cx="240" cy="10" r="110" fill="#e8590c"/>', 'Rider, with the 15 m circle')
  + L(3, '<line x2="480" y1="10" y2="10" stroke="#999" stroke-width="30"/><path d="M300 10l-120 -80v160z" fill="#777"/>', 'Stored street and next point')
  + L(4, '<rect width="480" height="200" y="-90" fill="#d9f2d9"/>', 'A line exists here')
  + L(5, '<rect width="480" height="200" y="-90" fill="#fff" stroke="#bbb" stroke-width="12"/>', 'No street within 15 m: no line')
  + `<text x="${D.W - 300}" y="${D.H + 1400}" font-size="170" fill="#666" text-anchor="end">Street data © OpenStreetMap contributors</text></svg>`);
fs.writeFileSync(out, o.join('\n'));
console.log('wrote', out, fs.statSync(out).size, 'bytes, line', c[3], 'm,', pts.length, 'points');
