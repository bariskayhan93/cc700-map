globalThis.fetch = async () => { throw new Error('network disabled by audit'); };
Object.defineProperty(globalThis.navigator, 'onLine', {value:false, configurable:true});
// Historical aggregate checks, not labelled junction truth. Private input/cache required; no network.
// Edge-case tests for the route builder, offline. usage: node tools/edge_test.mjs gpx.json
// gpx.json: a real track { name, pts } whose map cells are already in <tmp>/cc700-osm (run test_route.mjs once).
// Each case builds a file from a variant of the track and checks the limits that were tested on the device.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadOSM } from '../js/osm.js';
import { buildRoute } from '../js/route.js';
import { readFile } from '../js/preview.js';
import { hav } from '../js/geo.js';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = (process.env.CC700_OSM_CACHE || path.join(root, '.local/cc700-evidence-20261113/local-validation/cache')) + '/';
const store = { get: async k => { try { return JSON.parse(fs.readFileSync(dir + k + '.json')); } catch {} }, put: async () => { throw new Error('offline test: map cell missing'); } };
const base = JSON.parse(fs.readFileSync(process.argv[2] || path.join(root, '.local/cc700-evidence-20261113/local-validation/edge-input.json')));
const { lines, areas } = await loadOSM(base.pts, null, store);
const nameImage = t => { const w = Math.min(400, 7 * [...t].length + 4), st = Math.ceil(w / 4), p = new Uint8Array(40 + st * 16).fill(0xff, 40); p.fill(0, 0, 40); p[4] = 8; new DataView(p.buffer).setUint32(16, w, true); new DataView(p.buffer).setUint32(20, 16, true); const o = new Uint8Array(2 + p.length); new DataView(o.buffer).setUint16(0, p.length, true); o.set(p, 2); return o; };
const rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
const gauss = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
const P = base.pts, rev = P.slice().reverse();
const noisy = m => P.map(([la, lo, e]) => [la + gauss() * m / 111320, lo + gauss() * m / 70000, e]);
const cases = [
  ['outbound', { pts: P }],
  ['return', { pts: rev }],
  ['round trip (start = end)', { pts: [...P, ...rev] }],
  ['out and back with U-turn', { pts: [...P.slice(0, Math.floor(P.length / 2)), ...P.slice(0, Math.floor(P.length / 2)).reverse()] }],
  ['GPS recording, 3 m noise', { pts: noisy(3) }],
  ['planner export, every 8th point', { pts: P.filter((_, i) => i % 8 === 0 || i === P.length - 1) }],
  ['no elevation', { pts: P.map(([a, b]) => [a, b, null]) }],
  ['duplicate points', { pts: P.flatMap(p => [p, p]) }],
  ['very short (60 m)', { pts: P.slice(0, 6) }],
  ['two points', { pts: [P[0], P.at(-1)] }],
  ['waypoints', { pts: P, wpts: [{ lat: P[Math.floor(P.length / 3)][0], lon: P[Math.floor(P.length / 3)][1], name: 'Bäcker' }, { lat: P[Math.floor(P.length * 2 / 3)][0], lon: P[Math.floor(P.length * 2 / 3)][1], name: 'Brücke' }] }],
  ['no map data', { pts: P }, []],
];
let bad = 0;
const turnsOf = r => r.sections.filter(s => s.type === 1 && s.dir);
let ref = null;
for (const [name, g, L] of cases) {
  const err = [], note = [];
  try {
    const gpx = { name, wpts: g.wpts || [], pts: g.pts }, t0 = Date.now();
    const r = buildRoute(gpx, L || lines, { speedKmh: 18, id: 'test', nameImage, areas, map: {} }), ms = Date.now() - t0;
    const m = readFile(r.file), pts = m.secs.flat();
    if (m.secs.length !== r.sections.length) err.push(`read back ${m.secs.length} of ${r.sections.length} sections`);
    if (m.blocks.length !== r.sections.length) err.push(`map index ${m.blocks.length} for ${r.sections.length} sections`);
    if (r.maxBlock > 1200) err.push(`map block ${r.maxBlock} entries`);
    const big = Math.max(...m.secs.map(s => s.length)); if (big > 150) err.push(`section with ${big} points`);
    let gap = 0; for (let i = 1; i < pts.length; i++) gap = Math.max(gap, hav(pts[i - 1], pts[i])); if (gap > 20.5) err.push(`point gap ${gap.toFixed(1)} m`);
    const len = r.distance, exp = g.pts.slice(1).reduce((s, p, i) => s + hav(g.pts[i], p), 0);
    if (exp > 5 && Math.abs(len - exp) > Math.max(5, exp * (name.startsWith('GPS') ? 0.25 : 0.02))) err.push(`length ${len.toFixed(0)} m, track ${exp.toFixed(0)} m`);
    const tn = turnsOf(r);
    for (let k = 1; k < r.sections.length; k++) if (r.sections[k].dist - r.sections[k - 1].dist < 1) err.push(`empty section ${k}`);
    if (name === 'outbound') ref = tn.length;
    if (ref !== null && ['GPS recording, 3 m noise', 'planner export, every 8th point', 'duplicate points', 'no elevation'].includes(name) && Math.abs(tn.length - ref) > 2) err.push(`${tn.length} turns, outbound has ${ref}`);
    if (name === 'waypoints' && r.sections.filter(s => s.text.includes('▶')).length !== 2) err.push('waypoint text missing');
    if (name === 'out and back with U-turn' && !r.sections.some(s => s.dir === 5)) note.push('no U-turn prompt at the turning point');
    const then = r.sections.filter(s => s.text.startsWith("then")).length;
    console.log(`${err.length ? 'FAIL' : 'pass'}  ${name.padEnd(34)} ${(len / 1000).toFixed(2)} km, ${r.sections.length} sections, ${tn.length} turns, ${then} "then", ${pts.length} points, ${(r.file.length / 1024).toFixed(0)} KB, ${ms} ms`);
    for (const e of [...err, ...note.map(n => 'note: ' + n)]) console.log('      ' + e);
    if (err.length) bad++;
  } catch (e) { console.log(`FAIL  ${name.padEnd(34)} error: ${e.message}`); bad++; }
}
console.log(`${bad} failed`); process.exit(bad ? 1 : 0);
