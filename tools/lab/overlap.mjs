// Overlap of way-back street geometry, far-map lines and detail-map lines; bytes by layer and distance band.
import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {readFar, encodeFar, FAR} = await import(R + 'far_map.js'); const {decodeBlockD, isBlockD} = await import(R + 'map_codec.js');
const {readNativeRoute} = await import(R + 'native_route.js'); const {readSections} = await import(R + 'wayback_embed.js');
const {decodeWayback} = await import(R + 'wayback_format.js');
const file = new Uint8Array(fs.readFileSync(process.argv[2]));
const secs = readSections(file), get = t => secs.find(s => s.type === t), sub = s => file.subarray(s.offset, s.offset + s.size);
const wb = decodeWayback(sub(get(1))), far = readFar(sub(get(4))), fr = far.frame;
// everything in way-back units (1/16 m), same frame (header of both)
const H = wb.header; 
const toU = (la, lo) => [(Math.round(lo * 1e7) - fr.lon0E7) * fr.lonU / 65536, (Math.round(la * 1e7) - fr.lat0E7) * fr.latU / 65536];
const route = readNativeRoute(file).map(r => toU(...r.point));
const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t); };
// spatial hash of segments
function index(lines) { const G = new Map(), C = 16 * 40; for (const l of lines) for (let i = 1; i < l.length; i++) { const a = l[i - 1], b = l[i];
  for (let x = Math.floor(Math.min(a[0], b[0]) / C); x <= Math.floor(Math.max(a[0], b[0]) / C); x++) for (let y = Math.floor(Math.min(a[1], b[1]) / C); y <= Math.floor(Math.max(a[1], b[1]) / C); y++) { const k = x * 100000 + y; (G.get(k) || G.set(k, []).get(k)).push([a, b]); } }
  return (p, r) => { const C2 = C, x0 = Math.floor((p[0] - r) / C2), x1 = Math.floor((p[0] + r) / C2), y0 = Math.floor((p[1] - r) / C2), y1 = Math.floor((p[1] + r) / C2);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (const [a, b] of G.get(x * 100000 + y) || []) if (segD(p, a, b) <= r) return true; return false; }; }
const routeNear = index([route]);
const dRoute = p => { for (const r of [100, 200, 300, 500, 700, 1000, 1500, 2000, 3000]) if (routeNear(p, r * 16)) return r; return 9999; };
// samples every 5 m with the band of each sample
function samples(lines) { const out = []; for (const l of lines) for (let i = 1; i < l.length; i++) { const a = l[i - 1], b = l[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.round(L / 80));
  for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * (k + .5) / n, a[1] + (b[1] - a[1]) * (k + .5) / n, L / n]); } return out; }
// way-back pieces: tree (node -> next) and extras
const wbP = n => toU((n.y * 65536 / H.latU + H.lat0E7) / 1e7, (n.x * 65536 / H.lonU + H.lon0E7) / 1e7);
const wbLines = []; wb.nodes.forEach(n => { if (n.next >= 0) wbLines.push([wbP(n), wbP(wb.nodes[n.next])]); });
for (const e of wb.extras) wbLines.push([wbP(wb.nodes[e.a]), wbP(wb.nodes[e.b])]);
const farLines = far.cells.flatMap(c => c.items.filter(i => i.cls < 8).map(i => i.pts));
const farAreas = far.cells.flatMap(c => c.items.filter(i => i.cls >= 8));
// detail lines (roads, paths, cycleways) from the map blocks
const v = new DataView(file.buffer), mapAt = v.getUint32(0x5c, true), mapEnd = Math.min(...secs.map(s => s.offset));
const map = file.subarray(mapAt, mapEnd), mv = new DataView(map.buffer, map.byteOffset), K = 180 / 2 ** 31, det = [];
let detBytes = 0; const detByBand = {};
for (let o = 4 + mv.getUint32(0, true); o + 4 <= map.length;) { const n = mv.getUint32(o, true); if (!n || o + 4 + n > map.length) break; const b = map.subarray(o + 4, o + 4 + n); detBytes += n;
  if (isBlockD(b)) for (const e of decodeBlockD(b)) { const c = e.style & 15; if (![5, 6, 7, 8, 10].includes(c) || !e.style) continue; det.push({c, pts: [[e.lat, e.lon], ...e.pts].map(([a, o2]) => toU(a * K, o2 * K))}); } o += 4 + n; }
const detLines = det.map(d => d.pts);
const iWb = index(wbLines), iFar = index(farLines), iDet = index(detLines), R5 = 5 * 16;
const bands = [100, 200, 300, 500, 700, 1000, 1500, 2000, 3000, 9999];
function cover(name, lines, others) { const t = {}; for (const [x, y, w] of samples(lines)) { const p = [x, y], b = dRoute(p); t[b] ??= {m: 0, ...Object.fromEntries(others.map(([k]) => [k, 0]))}; t[b].m += w / 16;
  for (const [k, f] of others) if (f(p, R5)) t[b][k] += w / 16; } return t; }
const show = (name, t) => { console.log('\n' + name); for (const b of bands) if (t[b]) console.log(String(b).padStart(5), 'm band: km', (t[b].m / 1000).toFixed(1), Object.entries(t[b]).filter(([k]) => k !== 'm').map(([k, v]) => `${k} ${(100 * v / t[b].m).toFixed(0)}%`).join('  ')); };
show('way-back pieces: length, and share also drawn by', cover('wb', wbLines, [['far', iFar], ['detail', iDet], ['far|detail', (p, r) => iFar(p, r) || iDet(p, r)]]));
show('far lines: share that lies on a way-back piece', cover('far', farLines, [['onWayback', iWb]]));
show('detail lines (roads, paths, cycleways): share on a way-back piece / on a far line', cover('det', detLines, [['onWayback', iWb], ['onFar', iFar]]));
// bytes
const linesOnly = far.cells.map(c => ({key: c.key, items: c.items.filter(i => i.cls < 8)})).filter(c => c.items.length), areasOnly = far.cells.map(c => ({key: c.key, items: c.items.filter(i => i.cls >= 8)})).filter(c => c.items.length);
const bl = encodeFar(linesOnly, undefined, fr)?.length ?? 0, ba = encodeFar(areasOnly, undefined, fr)?.length ?? 0;
const wbKm = wbLines.reduce((s, l) => s + Math.hypot(l[1][0] - l[0][0], l[1][1] - l[0][1]), 0) / 16000;
const flKm = samples(farLines).reduce((s, p) => s + p[2], 0) / 16000;
console.log('\nbytes: way-back', get(1).size, `(${wb.nodes.length} nodes, ${wb.extras.length} extras, ${wb.cells.length - 1} cells, ${wbKm.toFixed(1)} km, ${(get(1).size / wbKm).toFixed(0)} B/km)`,
  '| far', get(4).size, `(lines alone ${bl} B for ${flKm.toFixed(1)} km = ${(bl / flKm).toFixed(0)} B/km; areas alone ${ba} B, ${farAreas.length} area items)`, '| detail map blocks', detBytes);
