import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {bikeWay} = await import(R + 'recovery_graph.js'); const {farClassOf, readFar} = await import(R + 'far_map.js');
const {decodeBlockD, isBlockD} = await import(R + 'map_codec.js'); const {readNativeRoute} = await import(R + 'native_route.js'); const {readSections} = await import(R + 'wayback_embed.js');
const d = JSON.parse(fs.readFileSync(process.argv[2])), file = new Uint8Array(fs.readFileSync(process.argv[3]));
const route = readNativeRoute(file).map(r => r.point), lat0 = route[0][0], mE = 111320 * Math.cos(lat0 * Math.PI / 180), M = (la, lo) => [lo * mE, la * 111320];
const RM = route.map(p => M(...p));
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
const dR = p => { let b = 1e9; for (let i = 1; i < RM.length; i += 3) b = Math.min(b, segD(p, RM[i - 1], RM[Math.min(i + 2, RM.length - 1)])); return b; };
const band = x => x <= 300 ? '0-300' : x <= 1000 ? '300-1000' : x <= 3000 ? '1000-3000' : 'out';
// highway length within 3 km by bike rule
const N = new Map(Object.entries(d.nodes).map(([k, v]) => [+k, v])), t = {};
for (const [, nds, tags] of d.ways) { if (!tags.highway) continue; const r = bikeWay(tags) ?? 'none', f = farClassOf(tags) == null ? 'notFar' : 'far';
  for (let i = 1; i < nds.length; i++) { const a = N.get(nds[i - 1]), b = N.get(nds[i]); if (!a || !b) continue; const pa = M(a[0], a[1]), pb = M(b[0], b[1]), mid = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2], bd = band(dR(mid)); if (bd === 'out') continue;
    const k = `${bd} ${r}/${f}`; t[k] = (t[k] || 0) + Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / 1000; } }
console.log('street km by band, bike rule / far class'); for (const k of Object.keys(t).sort()) console.log(' ', k.padEnd(28), t[k].toFixed(1));
// detail map: points and entries by band and kind
const secs = readSections(file), v = new DataView(file.buffer), mapAt = v.getUint32(0x5c, true), mapEnd = Math.min(...secs.map(s => s.offset)), map = file.subarray(mapAt, mapEnd), mv = new DataView(map.buffer, map.byteOffset), K = 180 / 2 ** 31;
const names = {1: 'built', 2: 'green', 3: 'water', 4: 'wline', 5: 'main', 6: 'minor', 7: 'service', 8: 'path', 9: 'rail', 10: 'cycle', 11: 'tram', 12: 'label'}, dt = {}; let allPts = 0, bytes = 0;
for (let o = 4 + mv.getUint32(0, true); o + 4 <= map.length;) { const n = mv.getUint32(o, true); if (!n || o + 4 + n > map.length) break; const b = map.subarray(o + 4, o + 4 + n); bytes += n;
  if (isBlockD(b)) for (const e of decodeBlockD(b)) { const c = e.style & 15; if (!names[c]) continue; const pts = [[e.lat, e.lon], ...e.pts].map(([a, o2]) => M(a * K, o2 * K));
    // per point band
    for (const p of pts) { const k = `${band(dR(p))} ${names[c]}`; dt[k] = (dt[k] || 0) + 1; allPts++; } } o += 4 + n; }
console.log('detail map points by band and class (all blocks, total', allPts, 'points,', bytes, 'B)');
const bands = ['0-300', '300-1000', '1000-3000']; for (const c of Object.values(names)) { const row = bands.map(b => dt[`${b} ${c}`] || 0); if (row.some(x => x)) console.log(' ', c.padEnd(8), row.map((x, i) => `${bands[i]}: ${x}`).join('  ')); }
