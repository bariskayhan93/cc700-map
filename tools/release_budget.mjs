#!/usr/bin/env node
// cc27 release budget (Task 14): the numbers of one route file for each reach, and the gate. Public code; the private
// inputs come by path and stay in .local/. Prints JSON with numbers only (no coordinates).
// Usage: node tools/release_budget.mjs --route <route.gpx|route.bin> --cells <dir> [--snapshot <snapshot.json>]
//        [--ride <track.json>] [--reach line3k|line2k|line1k|all] [--receipt <manifest.json>]
// --cells: map cells as .local/study/m90/cells (<r,c>.json Overpass elements; n<r,c>.json the point features).
// --ride: [[lat, lon, ...], ...] rider positions for the grey reads. Exit 1 when a gate fails.
// Gate: file <= 4,000,000 B; way-back section <= 1,536 KB; every map block within its limits; no grey screen over a cap.
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {readNativeRoute} from '../js/native_route.js';
import {auditMapSection, budgetFailures, MAP_BUDGET} from '../js/map_budget.js';
import {elevationSection} from '../js/elevation_section.js';
import {routeIdentity, waybackFromSnapshot, WAYBACK_MAX_BYTES} from '../js/wayback.js';
import {SECTION, embedSections} from '../js/wayback_embed.js';
import {readGreyLayer, GREY_CAPS} from '../js/wayback_grey_layer.js';
import {greyCells} from '../js/screen_proof.js';
import {decodeBlockD, isBlockD} from '../js/map_codec.js';
import {hav} from '../js/geo.js';

export const FILE_LIMIT = 4_000_000;
const pct = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// The last entry of each scheme D block: the cc27 flags (lon), or -1 without the flags entry.
function blockFlags(map) {
  const v = new DataView(map.buffer, map.byteOffset, map.byteLength), idx = v.getUint32(0, true), body = 4 + idx, out = [];
  for (let o = body; o + 4 <= map.length;) {
    const n = v.getUint32(o, true), b = map.subarray(o + 4, o + 4 + n);
    if (!n || o + 4 + n > map.length) break;
    const e = isBlockD(b) ? decodeBlockD(b).at(-1) : null;
    out.push(e && e.style === 15 && !e.pts.length && e.lat === 0x7F434346 ? e.lon : -1);
    o += 4 + n;
  }
  return out;
}

// Grey reads of the unit for each rider position (1 + rows + cells with a body, wb_grey.c) and the lines it draws.
function greyFrames(greyBytes, wbBytes, ride) {
  const layer = readGreyLayer(greyBytes), byKey = new Map(layer.cells.map(c => [c.key, c.lines.length]));
  const v = new DataView(wbBytes.buffer, wbBytes.byteOffset), lat0 = v.getInt32(24, true), lon0 = v.getInt32(28, true), latU = v.getUint32(32, true), lonU = v.getUint32(36, true);
  const reads = [], lines = [];
  for (let i = 1; i < ride.length; i++) {
    const [la, lo] = ride[i], [pa, po] = ride[i - 1];
    if (hav([pa, po], [la, lo]) < 1) continue;
    const course = Math.round((Math.atan2((lo - po) * Math.cos(la * Math.PI / 180), la - pa) * 180 / Math.PI + 360) % 360) % 360;
    const x = Math.floor((Math.round(lo * 1e7) - lon0) * lonU / 65536), y = Math.floor((Math.round(la * 1e7) - lat0) * latU / 65536);
    if (x < 0 || y < 0) continue;
    const sel = greyCells(x, y, course), body = sel.filter(k => byKey.has(k));
    reads.push(1 + new Set(sel.map(k => k >>> 16)).size + body.length);
    lines.push(body.reduce((s, k) => s + byKey.get(k), 0));
  }
  return {frames: reads.length, p50: pct(reads, 0.5), p90: pct(reads, 0.9), max: reads.length ? Math.max(...reads) : null,
    linesP50: pct(lines, 0.5), linesP90: pct(lines, 0.9), linesMax: lines.length ? Math.max(...lines) : null};
}

// routeFile: the plain route file (route and map). snapshot: the routing snapshot of the reach (null: no way-back).
export async function budgetOf(routeFile, {snapshot = null, reaches = ['line3k', 'line2k', 'line1k'], ride = null, receipt = null, caps = GREY_CAPS} = {}) {
  const route = readNativeRoute(routeFile), id = await routeIdentity(routeFile);
  const mapAt = new DataView(routeFile.buffer, routeFile.byteOffset).getUint32(0x5c, true), map = routeFile.subarray(mapAt);
  const costs = auditMapSection(map), keys = ['serializedBytes', 'decodedBytes', 'projectionCalls', 'projectedPoints', 'fillVertices', 'labelBytes'];
  const blockMax = Object.fromEntries(keys.map(k => [k, [Math.max(0, ...costs.map(c => c[k])), MAP_BUDGET[k]]]));
  const blockFailures = [...new Set(costs.flatMap(c => budgetFailures(c)))];
  const elevation = elevationSection(routeFile), files = {};
  for (const reach of reaches) {
    const made = snapshot ? waybackFromSnapshot(snapshot, route, id, {reach, format: 2, routeBytes: routeFile, layer: true, caps}) : null;
    const sections = [...(made ? [{type: SECTION.WAYBACK, bytes: made.bytes}] : []), ...(made?.grey ? [{type: SECTION.GREY, bytes: made.grey}] : []),
      ...(elevation ? [{type: SECTION.ELEV, bytes: elevation}] : [])];
    const file = sections.length ? embedSections(routeFile, sections) : routeFile;
    files[reach] = {reachUsed: made ? made.reach : null, fileBytes: file.length, routeAndMapBytes: routeFile.length, mapBytes: routeFile.length - mapAt,
      waybackBytes: made ? made.bytes.length : 0, greyBytes: made?.grey ? made.grey.length : 0, elevationBytes: elevation ? elevation.length : 0,
      grey: made ? made.greyReport : null, greyReads: made?.grey && ride ? greyFrames(made.grey, made.bytes, ride) : null};
  }
  return {routeKm: Number((route.at(-1).progress / 1e5).toFixed(2)), blocks: costs.length, blockMax, blockFailures, flags: blockFlags(map),
    files, codeBytes: receipt ? receipt.code_bytes : null, maxFrame: receipt ? receipt.max_frame : null};
}

// The failures of the gate (empty: pass).
export function gate(report) {
  const out = [];
  if (report.blockFailures.length) out.push('block limits: ' + report.blockFailures.join(', '));
  for (const [reach, f] of Object.entries(report.files)) {
    if (f.fileBytes > FILE_LIMIT) out.push(`${reach}: file ${f.fileBytes} B over 4,000,000 B`);
    if (f.waybackBytes > WAYBACK_MAX_BYTES) out.push(`${reach}: way-back section ${f.waybackBytes} B over ${WAYBACK_MAX_BYTES.toLocaleString('en')} B`);
    if (f.grey && f.grey.over) out.push(`${reach}: ${f.grey.over} grey screens over a cap`);
  }
  return out;
}

// A route file from local map cells, with the cc27 page options (scheme D, flags 7, names). No network.
async function buildFromCells(src, dir) {
  const {buildCell, loadOSM} = await import('../js/osm.js');
  const {buildRoute} = await import('../js/route.js');
  const cache = new Map();
  const store = {
    get: async k => {
      if (cache.has(k)) return cache.get(k);
      const f = `${dir}/${k}.json`;
      if (!fs.existsSync(f)) return undefined;
      const els = JSON.parse(fs.readFileSync(f, 'utf8')), [r, c] = k.replace(/^n/, '').split(',').map(Number);
      const v = k.startsWith('n') ? {t: Date.now(), v: 2, sig: els.filter(e => e.tags?.highway === 'traffic_signals').map(e => [e.id, e.lat, e.lon]),
        stop: els.filter(e => e.tags?.railway === 'tram_stop' || e.tags?.tram === 'yes').map(e => [e.id, e.lat, e.lon]), lm: []} : {t: Date.now(), v: 9, ...buildCell(els, r, c)};
      cache.set(k, v); return v;
    },
    put: async () => {},
  };
  let gpx;
  if (src.endsWith('.gpx')) {
    const t = fs.readFileSync(src, 'utf8');
    gpx = {name: 'tour', wpts: [], pts: [...t.matchAll(/<trkpt[^>]*lat="([-\d.]+)"\s+lon="([-\d.]+)"[^>]*>(?:\s*<ele>([-\d.]+)<\/ele>)?/g)].map(m => [+m[1], +m[2], m[3] ? +m[3] : null])};
  } else gpx = {name: 'route', wpts: [], pts: readNativeRoute(new Uint8Array(fs.readFileSync(src))).map(r => [r.point[0], r.point[1], null])};
  globalThis.navigator ??= {onLine: false};
  const osm = await loadOSM(gpx.pts, null, store, {coverageMeters: 1000});
  const nameImage = s => new Uint8Array(2 + 40 + Math.ceil(Math.min(400, 7 * s.length + 4) / 4) * 16);   // size model of names.js
  const r = buildRoute(gpx, osm.lines, {speedKmh: 18, id: 'budget', label: gpx.name, title: gpx.name, nameImage, areas: osm.areas, water: osm.water,
    rails: osm.rails, green: osm.green, wlines: osm.wlines, navigationLines: osm.navigationLines, trams: osm.trams, signals: osm.signals, stops: osm.stops,
    landmarks: osm.landmarks, noF9: true, map: {styled: true, codec: 'd', blockFlags: 7, ground: false, water: false, rails: false, names: true, signals: true,
      stops: true, trams: true, rough: true, paths: true, details: true, lanes: true}});
  return {file: r.file, missingCells: osm.coverage.missingCells, lines: osm.lines.length, landmarks: osm.landmarks.length};
}

async function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!a.route || (!a.cells && a.route.endsWith('.gpx'))) { console.error('usage: node tools/release_budget.mjs --route <gpx|bin> --cells <dir> [--snapshot f] [--ride f] [--reach r|all] [--receipt f]'); return 2; }
  const built = a.cells ? await buildFromCells(a.route, a.cells) : {file: new Uint8Array(fs.readFileSync(a.route))};
  const reaches = !a.reach || a.reach === 'all' ? ['line3k', 'line2k', 'line1k'] : [a.reach];
  const report = await budgetOf(built.file, {snapshot: a.snapshot ? JSON.parse(fs.readFileSync(a.snapshot, 'utf8')) : null, reaches,
    ride: a.ride ? JSON.parse(fs.readFileSync(a.ride, 'utf8')).map(p => [p[0], p[1]]) : null, receipt: a.receipt ? JSON.parse(fs.readFileSync(a.receipt, 'utf8')) : null});
  const failures = gate(report);
  console.log(JSON.stringify({...report, flags: {blocks: report.flags.length, all7: report.flags.every(f => f === 7)}, build: {missingCells: built.missingCells, lines: built.lines, landmarks: built.landmarks},
    gate: failures.length ? failures : 'pass'}, null, 1));
  return failures.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main(process.argv.slice(2));
