// Way-back data for a route file: streets around the route (Overpass, with OSM node ids, way tags and
// turn restrictions) -> street tree -> CCWB bytes -> trailer at the end of the route file.
// The host tool tools/wayback_build.mjs uses waybackFromSnapshot too, so both give the same bytes.
// Test feature: only the way-back test firmware reads the trailer. No trailer is written when any step fails.
import {routingQuery, captureRoutingSnapshot} from './routing_snapshot.js';
import {buildTransitionGraph} from './recovery_transitions.js';
import {conservativeWayPolicy} from './recovery_graph.js';
import {buildWaybackModel, REACH} from './wayback_tree.js';
import {encodeWayback, encodeWaybackV3, decodeWayback, makeFrame} from './wayback_format.js';
import {greyFlags} from './wayback_grey.js';
import {fitGreyLayer} from './screen_proof.js';
import {GREY_CAPS} from './wayback_grey_layer.js';
import {SECTION, readSections, routePart} from './wayback_embed.js';
import {readNativeRoute} from './native_route.js';

export const WAYBACK_MAX_BYTES = 1536 * 1024;   // test limit for the way-back bytes of one route file
const MARGIN_M = 200;                           // margin over the reach: the longest piece (cc27: reach 1, 2 or 3 km)
export const REACH_CHAIN = ['line3k', 'line2k', 'line1k'];   // the page steps down when the data does not fit
const API = ['https://overpass.openstreetmap.fr/api/interpreter', 'https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

// The grey section (type 2, layer version 2) of a version 3 file, fitted to the caps by the screen proof (js/screen_proof.js).
// {bytes: null, report: {reason}} when no piece is grey, a cell body is over 2 KB, the layer has over 16,384 cells or the fit
// needs more than its removal limit: the route file then has no grey section, and the way-back data stays.
function greyOf(bare, caps) {
  try {
    const fit = fitGreyLayer(decodeWayback(bare), caps);   // caps: pixCap, ptCap (header) and maxRemovals
    return {bytes: fit.bytes, report: fit.bytes ? {removedKm: Number(fit.removedKm.toFixed(3)), removedLines: fit.removedLines, screens: fit.proof.screens, over: fit.proof.over.length,
      worstWork: fit.proof.worstWork, worstPoints: fit.proof.worstPoints, pixCap: caps.pixCap, ptCap: caps.ptCap} : {reason: 'no grey piece'}};
  } catch (e) {
    if (/grey cell over 2048 B|grey layer over 16,384 cells|grey fit: more than \d+ removals/.test(e.message)) return {bytes: null, report: {reason: e.message}};
    throw e;
  }
}

const sha256 = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
const hex = bytes => [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
const wayPolicy = t => t.motorroad && t.motorroad !== 'no' ? {reason: 'motorroad-not-admitted'} : conservativeWayPolicy(t);

// Route identity of the way-back file: the first 16 bytes of the SHA-256 of the route file.
export async function routeIdentity(routeBytes) { return (await sha256(routeBytes)).subarray(0, 16); }

// Bounding box [south, west, north, east] of the route plus the reach margin, 4 decimals, outward.
export function waybackBbox(route, reach = 'line2k') {
  let s = 90, w = 180, n = -90, e = -180;
  for (const {point: [la, lo]} of route) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  const dLat = ((REACH[reach] || REACH.line2k).air + MARGIN_M) / 111320, dLon = dLat / Math.cos(Math.max(Math.abs(s), Math.abs(n)) * Math.PI / 180);
  const down = v => Math.floor(v * 1e4) / 1e4, up = v => Math.ceil(v * 1e4) / 1e4;
  return [down(s - dLat), down(w - dLon), up(n + dLat), up(e + dLon)];
}

// Pure step. Returns {bytes, grey, greyReport, reach, model}, or null when the way-back bytes exceed maxBytes in every
// reach (the grey section is not counted: it is a section of its own, under the 4,000,000 B file guard). format 2 (cc27): way-back version 3 with the grey flags of routeBytes (the route file with its map); layer:
// true also gives the fitted grey section (grey: bytes or null). The caller puts the sections with embedSections.
export function waybackFromSnapshot(snapshot, route, routeId, {reach = 'line2k', exceptions = false, maxBytes = 0, format = 1, routeBytes = null, layer = false, caps = GREY_CAPS} = {}) {
  if (format === 2 && !routeBytes) throw new Error('format 2 needs routeBytes: the grey flags come from the map (D0 item 4)');
  const graph = buildTransitionGraph(snapshot, {wayPolicy});
  const encode = model => {
    if (format !== 2) return {bytes: encodeWayback(model, routeId), grey: null, greyReport: null};
    const bytes = encodeWaybackV3(model, routeId, greyFlags(routeBytes, makeFrame(model.nodes.map(n => n.point))));
    if (maxBytes && bytes.length > maxBytes) return {bytes, grey: null, greyReport: null};   // this reach steps down: no fit
    const g = layer ? greyOf(bytes, caps) : {bytes: null, report: null};
    return {bytes, grey: g.bytes, greyReport: g.report};
  };
  const make = rch => {
    const model = buildWaybackModel(graph, route, {reach: rch, exceptions});
    try { return {...encode(model), reach: rch, model}; }
    catch (e) { if (format === 2 && /does not fit version 3/.test(e.message)) return null; throw e; }
  };
  // cc27: the chosen reach first, then the smaller ones (3 -> 2 -> 1 km) when the data does not fit
  const start = REACH_CHAIN.indexOf(reach);
  for (const r of start < 0 ? [reach] : REACH_CHAIN.slice(start)) {
    const made = make(r);
    if (made && !(maxBytes && made.bytes.length > maxBytes)) return made;   // the way-back section only; the file guard is the page's
  }
  return null;
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
// The last answer is kept for the page session: a rebuild of the same route (other speed or layer) asks Overpass once.
let lastAnswer = null;
export async function loadWaybackSnapshot(route, fetchImpl = fetch, reach = 'line2k') {
  const bbox = waybackBbox(route, reach), query = routingQuery(bbox);   // throws when the area exceeds the bounded region
  const querySha256 = hex(await sha256(new TextEncoder().encode(query)));
  const answer = lastAnswer?.query === query && lastAnswer.fetchImpl === fetchImpl ? lastAnswer.json : await overpass(query, fetchImpl);
  lastAnswer = {query, fetchImpl, json: answer};
  const snapshot = captureRoutingSnapshot(answer, {bbox, querySha256});
  if (snapshot.integrity !== 'pass') throw new Error('street data is not complete: ' + (snapshot.issues[0]?.code ?? 'unknown'));
  return snapshot;
}

// The reach of the fetch: the chosen reach, or the next smaller one when its box is over the bounded query area (owner,
// 19 Nov). The last reach of the chain stays as it is: its fetch then refuses the area.
function fetchReach(route, reach) {
  const start = REACH_CHAIN.indexOf(reach), chain = start < 0 ? [reach] : REACH_CHAIN.slice(start);
  return chain.find(r => { try { routingQuery(waybackBbox(route, r)); return true; } catch { return false; } }) ?? chain.at(-1);
}

// Owner ruling (18 Nov, option a): the way-back data stays only when its route identity equals the identity of the route
// bytes in front of it. Otherwise the plain route bytes are returned, with status 'dropped'. Called before a file is sent.
export async function checkWayback(file) {
  const s = readSections(file), t = s && s.find(x => x.type === SECTION.WAYBACK);
  if (!t) return {file, status: 'none'};
  const plain = routePart(file), wb = file.subarray(t.offset, t.offset + t.size);
  return hex(await routeIdentity(plain)) === hex(wb.subarray(8, 24)) ? {file, status: 'ok'} : {file: plain, status: 'dropped'};
}

// Route file bytes -> the way-back section bytes and the grey section bytes (null: no grey section). The caller puts them
// with embedSections. Throws when no data can be made; the caller keeps the plain file. layer (default true): the grey section.
export async function addWayback(routeBytes, {fetchImpl = fetch, maxBytes = WAYBACK_MAX_BYTES, format = 1, layer = true, reach = 'line2k', caps = GREY_CAPS} = {}) {
  const route = readNativeRoute(routeBytes), r = fetchReach(route, reach);
  const snapshot = await loadWaybackSnapshot(route, fetchImpl, r);
  const made = waybackFromSnapshot(snapshot, route, await routeIdentity(routeBytes), {maxBytes, format, routeBytes, layer, reach: r, caps});
  if (!made) throw new Error('way-back data exceeds ' + maxBytes + ' bytes');
  if (!made.model.stats.stored) throw new Error('no stored street');
  return {wayback: made.bytes, grey: made.grey, greyReport: made.greyReport, bytes: made.bytes.length + (made.grey ? made.grey.length : 0), reach: made.reach, stats: made.model.stats};
}

// The sections of addWayback for embedSections: the way-back section, then the grey section when there is one.
export const waybackSections = w => [{type: SECTION.WAYBACK, bytes: w.wayback}, ...(w.grey ? [{type: SECTION.GREY, bytes: w.grey}] : [])];
