// Builds a cc27 route file (route, detail map, way-back, far map, elevation) from a GPX and a local OSM JSON.
import fs from 'node:fs';
import {emulator} from './emu.mjs';
const R = process.env.JSDIR || new URL('../../js/', import.meta.url).pathname;
const [osmFile, gpxFile, outFile, reach = 'line3k'] = process.argv.slice(2);
const emu = emulator(osmFile);
globalThis.fetch = emu.fetch; globalThis.navigator ??= {onLine: true};
const {loadOSM} = await import(R + 'osm.js'), {buildRoute} = await import(R + 'route.js'), {cc27Flags, cc27Sections} = await import(R + 'cc27_file.js');
const t = fs.readFileSync(gpxFile, 'utf8');
const gpx = {name: 'lab', wpts: [], pts: [...t.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map(m => [+m[1], +m[2], 300])};
const mem = new Map(), store = {get: async k => mem.get(k), put: async (k, v) => mem.set(k, v)};
const osm = await loadOSM(gpx.pts, null, store, {coverageMeters: 1000});
const nameImage = s => new Uint8Array(2 + 40 + Math.ceil(Math.min(400, 7 * s.length + 4) / 4) * 16);
const r = buildRoute(gpx, osm.lines, {speedKmh: 18, id: '11241200', label: 'lab', title: 'lab', nameImage, areas: osm.areas, water: osm.water,
  rails: osm.rails, green: osm.green, wlines: osm.wlines, navigationLines: osm.navigationLines, trams: osm.trams, signals: osm.signals, stops: osm.stops,
  landmarks: osm.landmarks, noF9: true, map: {styled: true, codec: 'd', blockFlags: cc27Flags()}});
const c = await cc27Sections(r.file, {wayback: true, elevation: false, reach, fetchImpl: emu.fetch});
fs.writeFileSync(outFile, c.file);
const {stats, ...rep} = c.report;
console.log(JSON.stringify({routeAndMap: r.file.length, file: c.file.length, sections: c.sections, ...rep, farCells: rep.farCells?.length ?? rep.farCells, emu: emu.counts, osmLines: osm.lines.length}));
