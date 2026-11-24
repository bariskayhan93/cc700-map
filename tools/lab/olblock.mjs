import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {decodeBlockD, isBlockD} = await import(R + 'map_codec.js'); const {readSections} = await import(R + 'wayback_embed.js');
const PASSES = {4: [3], 5: [10, 7], 6: [8, 5], 7: [5, 3], 8: [2], 9: [2], 10: [2], 11: [4, 2]};
for (const f of process.argv.slice(2)) { const file = new Uint8Array(fs.readFileSync(f)), secs = readSections(file), v = new DataView(file.buffer);
  const mapAt = v.getUint32(0x5c, true), map = file.subarray(mapAt, Math.min(...secs.map(s => s.offset))), mv = new DataView(map.buffer, map.byteOffset);
  const rows = [];
  for (let o = 4 + mv.getUint32(0, true); o + 4 <= map.length;) { const n = mv.getUint32(o, true); if (!n || o + 4 + n > map.length) break; const b = map.subarray(o + 4, o + 4 + n); o += 4 + n; if (!isBlockD(b)) continue;
    let calls = 0, pts = 0, olC = 0, olP = 0, gC = 0, gP = 0, pathC = 0, pathP = 0;
    for (const e of decodeBlockD(b)) { const c = e.style & 15, k = 1 + e.pts.length; if (c < 1 || c > 14) continue;
      const cc = c <= 3 ? 1 : c >= 12 ? 1 : (PASSES[c] || [1]).length + ((e.style & 0x80) ? 2 : 0); calls += cc; pts += k * cc;
      if (c === 2) { gC += 1; gP += k; } if (c === 8) { pathC += cc; pathP += k * cc; }
      if ((c === 2 || c === 3) && !(e.style & 0x400)) { calls++; pts += k; olC++; olP += k; if (c === 2) { gC++; gP += k; } } }
    rows.push({calls, pts, olC, olP, gC, gP, pathC, pathP}); }
  rows.sort((a, b) => b.pts - a.pts); const top = rows.slice(0, 3); const sum = k => rows.reduce((a, r) => a + r[k], 0);
  console.log(f, 'blocks', rows.length, '| all: calls', sum('calls'), 'pts', sum('pts'), '| outline calls', sum('olC'), `(${(100*sum('olC')/sum('calls')).toFixed(0)}%)`, 'pts', sum('olP'), `(${(100*sum('olP')/sum('pts')).toFixed(0)}%)`,
    '| green fill+outline pts', sum('gP'), `(${(100*sum('gP')/sum('pts')).toFixed(0)}%)`, '| path pts', sum('pathP'), `(${(100*sum('pathP')/sum('pts')).toFixed(0)}%)`);
  for (const r of top) console.log('   busiest block: calls', r.calls, 'pts', r.pts, 'outline', r.olC, '/', r.olP, `(${(100*r.olP/r.pts).toFixed(0)}% pts)`, 'green', r.gP, 'paths', r.pathP); }
