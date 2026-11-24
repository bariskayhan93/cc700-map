// Far map reads per frame today vs with a body cache across frames (LRU, N cells, PSRAM) and the header kept.
// Riding: 1 frame per second at 25 km/h along the route (heading = route), and off route at 700 m / 2200 m parallel.
// Turning: standing still, heading turning 30 deg per second through 360 deg.
import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {readFar} = await import(R + 'far_map.js'); const {readNativeRoute} = await import(R + 'native_route.js');
const {readSections} = await import(R + 'wayback_embed.js'); const {greyCells} = await import(R + 'screen_proof.js');
const file = new Uint8Array(fs.readFileSync(process.argv[2])), secs = readSections(file), s4 = secs.find(s => s.type === 4), far = readFar(file.subarray(s4.offset, s4.offset + s4.size)), fr = far.frame;
const has = new Set(far.cells.filter(c => c.items.length).map(c => c.key));
const route = readNativeRoute(file).map(r => r.point), lat0 = route[0][0], mE = 111320 * Math.cos(lat0 * Math.PI / 180), mN = 111320;
const toM = (la, lo) => [lo * mE, la * mN], RM = route.map(p => toM(...p));
const mToU = ([x, y]) => [Math.floor((Math.round(x / mE * 1e7) - fr.lon0E7) * fr.lonU / 65536), Math.floor((Math.round(y / mN * 1e7) - fr.lat0E7) * fr.latU / 65536)];
function frames(off) { const out = []; let carry = 0; for (let i = 1; i < RM.length; i++) { const a = RM[i - 1], b = RM[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!L) continue; const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, hd = ((Math.atan2(ux, uy) * 180 / Math.PI) + 360) % 360;
  for (let t = carry; t < L; t += 7) out.push({p: [a[0] + ux * t + uy * off, a[1] + uy * t - ux * off], h: Math.round(hd)}); carry = (carry - L) % 7; if (carry < 0) carry += 7; } return out; }
function run(fs2, N) { const lru = new Map(); let reads = [], bodies = [];
  for (const f of fs2) { const u = mToU(f.p), sel = greyCells(u[0], u[1], f.h); const rows = new Set(sel.map(k => k >>> 16)).size, body = sel.filter(k => has.has(k));
    if (!N) { reads.push(2 + rows + body.length); bodies.push(body.length); continue; }
    const miss = body.filter(k => !lru.has(k)); for (const k of body) { lru.delete(k); lru.set(k, 1); } while (lru.size > N) lru.delete(lru.keys().next().value);
    const missRows = new Set(miss.map(k => k >>> 16)).size; reads.push(missRows + miss.length); bodies.push(miss.length); }
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
  return `reads p50 ${q(reads, .5)} p90 ${q(reads, .9)} max ${q(reads, 1)} mean ${(reads.reduce((s, x) => s + x, 0) / reads.length).toFixed(1)}`; }
for (const off of [0, 700, 2200]) { const f = frames(off); console.log(`riding ${off} m off (${f.length} frames): today ${run(f, 0)} | cache 24: ${run(f, 24)} | cache 40: ${run(f, 40)}`); }
const spin = []; for (let i = 20; i < RM.length; i += 40) for (let h = 0; h < 720; h += 30) spin.push({p: [RM[i][0] + 2200, RM[i][1]], h: h % 360});
console.log(`turning in place, 2200 m off (${spin.length} frames): today ${run(spin, 0)} | cache 24: ${run(spin, 24)} | cache 40: ${run(spin, 40)}`);
