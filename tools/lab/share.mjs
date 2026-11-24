import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {decodeBlockD, isBlockD} = await import(R + 'map_codec.js'); const {readSections} = await import(R + 'wayback_embed.js');
const PASSES = {4: [3], 5: [10, 7], 6: [8, 5], 7: [5, 3], 8: [2], 9: [2], 10: [2], 11: [4, 2]};
const f = process.argv[2], file = new Uint8Array(fs.readFileSync(f)), secs = readSections(file), v = new DataView(file.buffer);
const mapAt = v.getUint32(0x5c, true), map = file.subarray(mapAt, Math.min(...secs.map(s => s.offset))), mv = new DataView(map.buffer, map.byteOffset);
const S = {}; let all = 0; const add = (k, n) => { S[k] = (S[k] || 0) + n; all += n; };
for (let o = 4 + mv.getUint32(0, true); o + 4 <= map.length;) { const n = mv.getUint32(o, true); if (!n || o + 4 + n > map.length) break; const b = map.subarray(o + 4, o + 4 + n); o += 4 + n; if (!isBlockD(b)) continue;
  for (const e of decodeBlockD(b)) { const c = e.style & 15, k = 1 + e.pts.length; if (c < 1 || c > 14) continue;
    const cc = c <= 3 ? 1 : c >= 12 ? 1 : (PASSES[c] || [1]).length + ((e.style & 0x80) ? 2 : 0); add(c, k * cc);
    if ((c === 2 || c === 3) && !(e.style & 0x400)) add('ol' + c, k); } }
for (const [k, n] of Object.entries(S)) console.log(k, n, (100 * n / all).toFixed(1)); console.log('all', all);
