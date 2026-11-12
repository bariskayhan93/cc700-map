// Node test: build a route file with the page code. usage: node tools/test_route.mjs gpx.json out.bin [speed] [ground]
// gpx.json: { name, pts: [[lat, lon, ele]] }. Map cells come from the Overpass API and are kept in <tmp>/cc700-osm.
import fs from 'node:fs';
const f0 = globalThis.fetch; globalThis.fetch = (u, o = {}) => f0(u, { ...o, headers: { 'User-Agent': 'cc700-map-test/1.0', ...(o.headers || {}) } });   // Overpass refuses requests without a client name
import os from 'node:os';
import { loadOSM } from '../js/osm.js';
import { buildRoute } from '../js/route.js';
import { readFile } from '../js/preview.js';
// CLASSIC=1: without the junction turns, 5 m points near turns and "dann" text (for A/B tests in the desk simulator)
const [, , inp, out, speed, ground] = process.argv, dir = os.tmpdir() + '/cc700-osm/';
fs.mkdirSync(dir, { recursive: true });
const store = { get: async k => { try { return JSON.parse(fs.readFileSync(dir + k + '.json')); } catch {} }, put: async (k, v) => fs.writeFileSync(dir + k + '.json', JSON.stringify(v)) };
const gpx = JSON.parse(fs.readFileSync(inp));
const { lines, areas, water, rails, green, trams, wlines, signals, stops } = await loadOSM(gpx.pts, (i, n) => process.stderr.write(`cell ${i + 1}/${n}\r`), store);
// stand-in name image (real one is drawn with canvas in the browser): blank 16 px image, width ~7 px per char
const nameImage = t => { const w = Math.min(400, 7 * [...t].length + 4), st = Math.ceil(w / 4), p = new Uint8Array(40 + st * 16).fill(0xff, 40); p.fill(0, 0, 40); p[4] = 8; new DataView(p.buffer).setUint32(16, w, true); new DataView(p.buffer).setUint32(20, 16, true); const o = new Uint8Array(2 + p.length); new DataView(o.buffer).setUint16(0, p.length, true); o.set(p, 2); return o; };
const t0 = Date.now();
const r = buildRoute(gpx, lines, { speedKmh: +(speed || 18), id: gpx.name, nameImage, areas, water, rails, green, trams, wlines, signals, stops, map: { ground: !!ground, styled: !!process.env.STYLED }, classic: !!process.env.CLASSIC, noCells: !!process.env.NOCELLS, noF9: !!process.env.NOF9 });   // NOCELLS / NOF9: device tests
fs.writeFileSync(out, r.file);
const m = readFile(r.file);
console.log(`signals ${signals.length}, stops ${stops.length}, lines ${lines.length}, areas ${areas.length}, ${(r.distance / 1000).toFixed(2)} km, sections ${r.sections.length}, file ${r.file.length} B, map blocks ${r.mapBlocks} max ${r.maxBlock}, readback secs ${m.secs.length} blocks ${m.blocks.length}, ${Date.now() - t0} ms`);
for (const s of r.sections) console.log(s.type, s.dir, '|', s.text);
if (process.env.SECTIONS) fs.writeFileSync(process.env.SECTIONS, JSON.stringify(r.sections.map(s => ({ end: Math.round(s.dist), dir: s.dir, type: s.type, text: s.text }))));   // for the desk simulator
