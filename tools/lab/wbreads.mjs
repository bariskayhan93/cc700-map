// Way-back reads per off-route frame, replaying wayback.c: mount, 3x3 scan (binary search per row, row records, node
// blocks, single nodes for links leaving a block), 32 line points. Then WP7: the same with a page cache (192 B pages, LRU)
// and, for option C, street drawing from the same section (all cells of the screen box, node blocks + leaving links).
import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {readSections} = await import(R + 'wayback_embed.js'); const {decodeWayback} = await import(R + 'wayback_format.js');
const file = new Uint8Array(fs.readFileSync(process.argv[2])), sec = readSections(file).find(s => s.type === 1), wb = decodeWayback(file.subarray(sec.offset, sec.offset + sec.size));
const N = wb.nodes, E = wb.extras, cells = wb.cells, nc = wb.header.cellCount, HB = 64, CB = 12, NB = 8, nodesOff = HB + (nc + 1) * CB, extrasOff = nodesOff + N.length * NB;
const key = (X, Y) => ((Y >>> 11) << 16) | (X >>> 11);
const cellIdx = new Map(cells.map((c, i) => [c.key, i]));
const UPM = 16;   // units per metre (1/16 m)
function frameReads(X, Y, opts) { const reads = [];   // each read: [offset, bytes]
  const rd = (o, n) => reads.push([o, n]);
  rd(sec.size - 64, 64); rd(0, HB); rd(HB + nc * CB, CB);              // trailer (file), header, end record
  const scanRows = (cx0, cy0, cx1, cy1, box) => { for (let cy = cy0; cy <= cy1; cy++) { const klo = (cy << 16) | cx0, khi = (cy << 16) | cx1;
      let lo = 0, hi = nc; while (lo < hi) { const mid = (lo + hi) >> 1; rd(HB + mid * CB, 4); if (cells[mid].key < klo) lo = mid + 1; else hi = mid; }
      const cnt = Math.min(8, nc + 1 - lo); rd(HB + lo * CB, cnt * CB);
      for (let c = lo; c < lo + cnt - 1 && cells[c].key <= khi; c++) { const n0 = cells[c].firstNode, n1 = cells[c + 1].firstNode;
        for (let i = n0; i < n1; i += 24) { const m = Math.min(24, n1 - i); rd(nodesOff + i * NB, m * NB);
          for (let k = 0; k < m; k++) { const u = N[i + k]; if (u.next < 0) continue; if (Math.abs(u.x - X) > box || Math.abs(u.y - Y) > box) continue; if (u.next < i || u.next >= i + m) rd(nodesOff + u.next * NB, NB); } }
        const x0c = cells[c].firstExtra, x1c = cells[c + 1].firstExtra; for (let i = x0c; i < x1c; i += 24) { const m = Math.min(24, x1c - i); rd(extrasOff + i * 8, m * 8); for (let k = 0; k < m; k++) { const e = E[i + k]; if (!(e.toA || e.toB)) continue; rd(nodesOff + e.a * NB, NB); rd(nodesOff + e.b * NB, NB); } } } } };
  const cx = X >>> 11, cy = Y >>> 11; scanRows(Math.max(0, cx - 1), Math.max(0, cy - 1), cx + 1, cy + 1, 1700 + 240);
  // line: nearest node, then 32 points along next
  let best = -1, bd = 1e18; const c0 = cellIdx.get(key(X, Y));
  for (let i = 0; i < N.length; i++) { const d = (N[i].x - X) ** 2 + (N[i].y - Y) ** 2; if (d < bd) { bd = d; best = i; } }
  let n = N[best].next; for (let p = 0; p < 33 && n >= 0; p++) { rd(nodesOff + n * NB, NB); n = N[n].next; }
  if (opts.draw) { const r = 400 * UPM, x0 = (Math.max(0, X - r)) >>> 11, x1 = (X + r) >>> 11, y0 = (Math.max(0, Y - r)) >>> 11, y1 = (Y + r) >>> 11;
    for (let a = x0; a <= x1; a += 6) scanRows(a, y0, Math.min(x1, a + 5), y1, 1e9); }   // rows of at most 7 cells, as WB_ROW_CELLS
  return reads; }
function lru(size) { const m = new Map(); return { reads(list) { let n = 0; for (const [o, b] of list) { let miss = false; for (let p = Math.floor(o / 192); p <= Math.floor((o + b - 1) / 192); p++) { if (!m.has(p)) miss = true; m.delete(p); m.set(p, 1); }
      while (m.size > size) m.delete(m.keys().next().value); if (miss) n++; } return n; } }; }
// rider paths: start at nodes 1.5-3 km (dist to route along the tree), ride 7 m per frame toward the route, 60 frames
const starts = []; for (let i = 0; i < N.length; i += 97) if (N[i].distM > 1500 && N[i].distM < 3000 && N[i].next >= 0) starts.push(i);
const pick = starts.filter((_, k) => k % Math.max(1, Math.floor(starts.length / 12)) === 0).slice(0, 12);
const res = {now: [], nowSplit: {fixed: 0, search: 0, rec: 0, blocks: 0, links: 0, line: 0}, cachedLine: [], cachedDraw: [], coldDraw: [], first: []};
for (const s of pick) { let n = s, acc = 0; const cL = lru(256), cD = lru(512); let f = 0;
  while (f < 60 && n >= 0 && N[n].next >= 0) { const X = N[n].x, Y = N[n].y;
    const rl = frameReads(X, Y, {}), rd2 = frameReads(X, Y, {draw: 1});
    res.now.push(rl.length); const a = cL.reads(rl), b = cD.reads(rd2); if (f === 0) res.first.push([rl.length, rd2.length]); else { res.cachedLine.push(a); res.cachedDraw.push(b); }
    res.coldDraw.push(rd2.length);
    // split of today's reads
    if (f === 0) { const sp = res.nowSplit; sp.fixed += 3; for (const [o, bts] of rl.slice(3)) { if (bts === 4) sp.search++; else if (o < nodesOff) sp.rec++; else if (o >= extrasOff) sp.ext = (sp.ext || 0) + 1; else if (bts > 8) sp.blocks++; else sp.links++; } sp.line += 0; }
    let m = 0; while (m < 7 * UPM * 1 && N[n].next >= 0) { const nx = N[n].next; m += Math.hypot(N[nx].x - N[n].x, N[nx].y - N[n].y); n = nx; } f++; } }
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const k = pick.length, sp = res.nowSplit;
console.log(process.argv[2], 'way-back', sec.size, 'B, cells', nc, 'nodes', N.length, 'extras', wb.header.extraCount, '| paths', k, 'frames', res.now.length);
console.log('today reads/frame p50', q(res.now, .5), 'p90', q(res.now, .9), '| split first frames (avg): fixed', (sp.fixed / k).toFixed(0), 'binary search', (sp.search / k).toFixed(0), 'row records', (sp.rec / k).toFixed(0), 'node blocks', (sp.blocks / k).toFixed(0), 'extra blocks', ((sp.ext||0) / k).toFixed(0), 'single nodes (links, extra ends, 33 line points)', (sp.links / k).toFixed(0));
console.log('WP7 line only + 256-page cache (48 KB): cold', q(res.first.map(x => x[0]), .5), '| warm p50', q(res.cachedLine, .5), 'p90', q(res.cachedLine, .9), 'max', q(res.cachedLine, 1));
console.log('WP7 C (line + street drawing from way-back) uncached p50', q(res.coldDraw, .5), 'p90', q(res.coldDraw, .9), '| + 512-page cache (96 KB): cold', q(res.first.map(x => x[1]), .5), 'warm p50', q(res.cachedDraw, .5), 'p90', q(res.cachedDraw, .9), 'max', q(res.cachedDraw, 1));
