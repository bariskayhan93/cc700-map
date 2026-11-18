// Way-back data for a route file: streets around the route (Overpass, with OSM node ids, way tags and
// turn restrictions) -> street tree -> CCWB bytes -> trailer at the end of the route file.
// The host tool tools/wayback_build.mjs uses waybackFromSnapshot too, so both give the same bytes.
// Test feature: only the way-back test firmware reads the trailer. No trailer is written when any step fails.
import {routingQuery, captureRoutingSnapshot} from './routing_snapshot.js';
import {buildTransitionGraph} from './recovery_transitions.js';
import {conservativeWayPolicy} from './recovery_graph.js';
import {buildWaybackModel} from './wayback_tree.js';
import {encodeWayback, encodeWaybackV2, decodeWayback, makeFrame} from './wayback_format.js';
import {greyFlags} from './wayback_grey.js';
import {greyLayer} from './wayback_grey_layer.js';
import {embedWayback, readTrailer} from './wayback_embed.js';
import {readNativeRoute} from './native_route.js';

export const WAYBACK_MAX_BYTES = 1536 * 1024;   // test limit for the way-back bytes of one route file
const MARGIN_M = 2200;                          // line2k reach (2 km) plus the longest piece
const API = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

// The grey section of a version 2 file, or null: no grey piece, or a cell body over 2 KB (the file then has no section).
function layerOf(bare) {
  try { return greyLayer(decodeWayback(bare)); }
  catch (e) { if (/grey cell over 2048 B/.test(e.message)) return null; throw e; }
}
const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a, 0); out.set(b, a.length); return out; };

const sha256 = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const wayPolicy = t => t.motorroad && t.motorroad !== 'no' ? {reason: 'motorroad-not-admitted'} : conservativeWayPolicy(t);

// Route identity of the way-back file: the first 16 bytes of the SHA-256 of the route file.
export async function routeIdentity(routeBytes) { return (await sha256(routeBytes)).subarray(0, 16); }

// Bounding box [south, west, north, east] of the route plus the reach margin, 4 decimals, outward.
export function waybackBbox(route) {
  let s = 90, w = 180, n = -90, e = -180;
  for (const {point: [la, lo]} of route) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  const dLat = MARGIN_M / 111320, dLon = dLat / Math.cos(Math.max(Math.abs(s), Math.abs(n)) * Math.PI / 180);
  const down = v => Math.floor(v * 1e4) / 1e4, up = v => Math.ceil(v * 1e4) / 1e4;
  return [down(s - dLat), down(w - dLon), up(n + dLat), up(e + dLon)];
}

// Pure step. Returns {bytes, reach, model}, or null when the bytes exceed maxBytes in both reaches.
// format 2 (cc26): version 2 file with the grey flags of routeBytes (the route file with its map). A node that does not
// fit gives no version 2 file at 2 km; the 1.5 km reach is tried. layer: true appends the grey layer section (E15).
export function waybackFromSnapshot(snapshot, route, routeId, {reach = 'line2k', exceptions = false, maxBytes = 0, format = 1, routeBytes = null, layer = false} = {}) {
  if (format === 2 && !routeBytes) throw new Error('format 2 needs routeBytes: the grey flags come from the map (D0 item 4)');
  const graph = buildTransitionGraph(snapshot, {wayPolicy});
  const encode = model => {
    if (format !== 2) return encodeWayback(model, routeId);
    const bare = encodeWaybackV2(model, routeId, greyFlags(routeBytes, makeFrame(model.nodes.map(n => n.point))));
    const section = layer ? layerOf(bare) : null;
    return section ? concat(bare, section) : bare;
  };
  const make = rch => {
    const model = buildWaybackModel(graph, route, {reach: rch, exceptions});
    try { return {bytes: encode(model), reach: rch, model}; }
    catch (e) { if (format === 2 && /does not fit version 2/.test(e.message)) return null; throw e; }
  };
  let made = make(reach);
  if (made && maxBytes && made.bytes.length > maxBytes && reach === 'line2k') made = make('ride1500');
  if (!made && format === 2 && reach === 'line2k') made = make('ride1500');
  if (!made || (maxBytes && made.bytes.length > maxBytes)) return null;
  return made;
}

async function overpass(query, fetchImpl) {
  let err;
  for (let n = 0; n < 2 * API.length; n++) {
    try {
      const res = await fetchImpl(API[n % API.length], {method: 'POST', body: new URLSearchParams({data: query}), signal: AbortSignal.timeout(110000)});
      const j = res.ok ? await res.json() : {};
      if (res.ok && !j.remark) return j;
      err = new Error('Overpass ' + (j.remark || res.status));
    } catch (e) { err = e; }
    if (n === API.length - 1) await new Promise(ok => setTimeout(ok, 5000));
  }
  throw err;
}

// Loads the streets around the route and returns the routing snapshot. Throws when the data is not complete.
export async function loadWaybackSnapshot(route, fetchImpl = fetch) {
  const bbox = waybackBbox(route), query = routingQuery(bbox);   // throws when the area exceeds the bounded region
  const querySha256 = hex(await sha256(new TextEncoder().encode(query)));
  const snapshot = captureRoutingSnapshot(await overpass(query, fetchImpl), {bbox, querySha256});
  if (snapshot.integrity !== 'pass') throw new Error('street data is not complete: ' + (snapshot.issues[0]?.code ?? 'unknown'));
  return snapshot;
}

// Owner ruling (18 Nov, option a): the way-back data stays only when its route identity equals the identity of the route
// bytes in front of it. Otherwise the plain route bytes are returned, with status 'dropped'. Called before a file is sent.
export async function checkWayback(file) {
  const t = readTrailer(file);
  if (!t) return {file, status: 'none'};
  const plain = file.subarray(0, t.offset), wb = file.subarray(t.offset, t.offset + t.size);
  return hex(await routeIdentity(plain)) === hex(wb.subarray(8, 24)) ? {file, status: 'ok'} : {file: plain, status: 'dropped'};
}

// Route file bytes -> route file bytes with way-back data. Throws when no data can be made; the caller keeps the plain file.
// layer (default true): version 2 writes the grey layer section after the extras. layer: false writes no section.
export async function addWayback(routeBytes, {fetchImpl = fetch, maxBytes = WAYBACK_MAX_BYTES, format = 1, layer = true} = {}) {
  const route = readNativeRoute(routeBytes);
  const snapshot = await loadWaybackSnapshot(route, fetchImpl);
  const made = waybackFromSnapshot(snapshot, route, await routeIdentity(routeBytes), {maxBytes, format, routeBytes, layer});
  if (!made) throw new Error('way-back data exceeds ' + maxBytes + ' bytes');
  if (!made.model.stats.stored) throw new Error('no stored street');
  return {file: embedWayback(routeBytes, made.bytes), bytes: made.bytes.length, reach: made.reach, stats: made.model.stats};
}
