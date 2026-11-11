// Node test: build a route file with the page code. usage: node tools/test_route.mjs gpx.json out.bin [speed]
import fs from 'node:fs';
import { RoadPack } from '../js/pack.js';
import { buildRoute } from '../js/route.js';
import { readFile } from '../js/preview.js';
const [, , inp, out, speed] = process.argv;
const base = new URL('../data/nrw/', import.meta.url);
const fetcher = async u => { const b = fs.readFileSync(new URL(u.replace(/^.*data\/nrw\//, ''), base)); return { json: async () => JSON.parse(b), arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; };
const gpx = JSON.parse(fs.readFileSync(inp));
const pack = await new RoadPack('data/nrw/', fetcher).init();
const la = gpx.pts.map(p => p[0]), lo = gpx.pts.map(p => p[1]);
const lines = await pack.lines([Math.min(...la) - 0.01, Math.min(...lo) - 0.016, Math.max(...la) + 0.01, Math.max(...lo) + 0.016]);
// stand-in name image (real one is drawn with canvas in the browser): blank 16 px image, width ~7 px per char
const nameImage = t => { const w = Math.min(400, 7 * [...t].length + 4), st = Math.ceil(w / 4), p = new Uint8Array(40 + st * 16).fill(0xff, 40); p.fill(0, 0, 40); p[4] = 8; new DataView(p.buffer).setUint32(16, w, true); new DataView(p.buffer).setUint32(20, 16, true); const o = new Uint8Array(2 + p.length); new DataView(o.buffer).setUint16(0, p.length, true); o.set(p, 2); return o; };
const t0 = Date.now();
const r = buildRoute(gpx, lines, { speedKmh: +(speed || 18), id: gpx.name, nameImage });
fs.writeFileSync(out, r.file);
const m = readFile(r.file);
console.log(`lines ${lines.length}, ${(r.distance / 1000).toFixed(2)} km, sections ${r.sections.length}, file ${r.file.length} B, map blocks ${r.mapBlocks} max ${r.maxBlock}, readback secs ${m.secs.length} blocks ${m.blocks.length}, ${Date.now() - t0} ms`);
for (const s of r.sections) console.log(s.type, s.dir, '|', s.text);
