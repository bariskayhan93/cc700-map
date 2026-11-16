// Way-back data for a route file: streets around the route (Overpass, with OSM node ids, way tags and
// turn restrictions) -> street tree -> CCWB bytes -> trailer at the end of the route file.
// The host tool tools/wayback_build.mjs uses waybackFromSnapshot too, so both give the same bytes.
// Test feature: only the way-back test firmware reads the trailer. No trailer is written when any step fails.
import {routingQuery, captureRoutingSnapshot} from './routing_snapshot.js';
import {buildTransitionGraph} from './recovery_transitions.js';
import {conservativeWayPolicy} from './recovery_graph.js';
import {buildWaybackModel} from './wayback_tree.js';
import {encodeWayback} from './wayback_format.js';
import {embedWayback} from './wayback_embed.js';
import {readNativeRoute} from './native_route.js';

export const WAYBACK_MAX_BYTES = 1536 * 1024;   // test limit for the way-back bytes of one route file
const MARGIN_M = 2200;                          // line2k reach (2 km) plus the longest piece
const API = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

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
export function waybackFromSnapshot(snapshot, route, routeId, {reach = 'line2k', exceptions = false, maxBytes = 0} = {}) {
  const graph = buildTransitionGraph(snapshot, {wayPolicy});
  let model = buildWaybackModel(graph, route, {reach, exceptions});
  let bytes = encodeWayback(model, routeId);
  if (maxBytes && bytes.length > maxBytes && reach === 'line2k') {
    reach = 'ride1500';
    model = buildWaybackModel(graph, route, {reach, exceptions});
    bytes = encodeWayback(model, routeId);
  }
  if (maxBytes && bytes.length > maxBytes) return null;
  return {bytes, reach, model};
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

// Route file bytes -> route file bytes with way-back data. Throws when no data can be made; the caller keeps the plain file.
export async function addWayback(routeBytes, {fetchImpl = fetch, maxBytes = WAYBACK_MAX_BYTES} = {}) {
  const route = readNativeRoute(routeBytes);
  const snapshot = await loadWaybackSnapshot(route, fetchImpl);
  const made = waybackFromSnapshot(snapshot, route, await routeIdentity(routeBytes), {maxBytes});
  if (!made) throw new Error('way-back data exceeds ' + maxBytes + ' bytes');
  if (!made.model.stats.stored) throw new Error('no stored street');
  return {file: embedWayback(routeBytes, made.bytes), bytes: made.bytes.length, reach: made.reach, stats: made.model.stats};
}
