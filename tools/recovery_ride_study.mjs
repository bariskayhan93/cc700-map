// Retrospective PC experiment: destinations come from observed later rejoins.
// Geometric node proximity does NOT establish a valid GPS-to-road connector.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { hav } from '../js/geo.js';
import { snapshotCandidateSource } from './routing_snapshot.mjs';
import { buildCandidateGraph, findRecovery } from './recovery_study.mjs';

export function detourEpisodes(rows) {
  let entry = null, active = null, stable = [];
  const result = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Number.isFinite(row.timestamp) || !Number.isFinite(row.off_original_route_m) ||
        !Number.isFinite(row.original_progress_m) || (i && row.timestamp <= rows[i - 1].timestamp)) throw Error('Invalid timeline');
    if (i && row.timestamp - rows[i - 1].timestamp > 10) {
      if (active) result.push({ ...active, status: 'recording-gap', rejoin: null });
      entry = null; active = null; stable = [];
    }
    const on = row.off_original_route_m <= 20 && row.ambiguous_with_other_pass === false;
    if (!active) {
      if (on) entry = row;
      else if (row.off_original_route_m >= 50 && entry && row.timestamp - entry.timestamp <= 60) {
        active = { entry, samples: [row] }; stable = [];
      }
      continue;
    }
    if (row.off_original_route_m >= 50) active.samples.push(row);
    if (on) stable.push(row); else stable = [];
    if (stable.length >= 5) {
      const rejoin = stable[0];
      result.push({ ...active, rejoin, status: rejoin.original_progress_m > active.entry.original_progress_m + 25 ? 'observed-forward-rejoin' : 'nonforward-rejoin' });
      entry = row; active = null; stable = [];
    }
  }
  if (active) result.push({ ...active, status: 'rejoin-unobserved', rejoin: null });
  return result;
}

export function nearestStudyNode(nodes, point, maxMeters = 25) {
  if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || !Number.isFinite(maxMeters) || maxMeters <= 0) throw Error('Invalid association input');
  let best = null;
  for (const n of nodes) {
    const distanceMeters = hav(point, n.point);
    if (distanceMeters <= maxMeters && (!best || distanceMeters < best.distanceMeters || (distanceMeters === best.distanceMeters && n.id < best.node))) best = { node: n.id, distanceMeters };
  }
  return best;
}

export function retrospectiveCases(rows) {
  detourEpisodes(rows); // Validate the same chronological evidence contract.
  const stable = r => r.off_original_route_m <= 20 && r.ambiguous_with_other_pass === false;
  let entry = null, lastSample = -Infinity;
  const result = [], maximum = rows.reduce((a, b) => !a || b.off_original_route_m > a.off_original_route_m ? b : a, null);
  for (let i = 0; i < rows.length; i++) {
    const sample = rows[i];
    if (stable(sample)) entry = sample;
    if (sample.off_original_route_m < 50 || (sample.timestamp - lastSample < 30 && sample !== maximum)) continue;
    lastSample = sample.timestamp;
    if (result.length >= 256) throw Error('Ride trial admission exceeded');
    let rejoin = null;
    if (entry) for (let j = i + 1; j + 4 < rows.length && rows[j].timestamp - sample.timestamp <= 1800; j++) {
      const group = rows.slice(j, j + 5);
      if (group.every(stable) && group.every((r, k) => !k || r.timestamp - group[k - 1].timestamp <= 10) &&
          rows[j].original_progress_m > entry.original_progress_m + 25) { rejoin = rows[j]; break; }
    }
    const through = rejoin?.timestamp ?? sample.timestamp;
    const recordingGap = rows.some((r, j) => j && r.timestamp > (entry?.timestamp ?? sample.timestamp) && r.timestamp <= through && r.timestamp - rows[j - 1].timestamp > 10);
    result.push({ sample, entry, rejoin, recordingGap, reason: !entry ? 'entry-unavailable' : !rejoin ? 'observed-forward-rejoin-unavailable' : null });
  }
  return result;
}

export function studyRide(snapshot, track, timeline) {
  if (!Array.isArray(track) || !Array.isArray(timeline) || track.length !== timeline.length || track.length > 100000) throw Error('Track/timeline mismatch');
  const fixes = new Map();
  track.forEach((p, i) => {
    if (!Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite) || p[0] !== timeline[i].timestamp || Math.abs(p[1]) > 90 || Math.abs(p[2]) > 180) throw Error('Track/timeline mismatch');
    fixes.set(p[0], p.slice(1));
  });
  const adapted = snapshotCandidateSource(snapshot), graph = buildCandidateGraph(adapted.source);
  // Associate before policy quarantine. Otherwise exclusion could silently snap
  // a rider on a blocked road onto a different nearby admitted road.
  const primaryIds = new Set(snapshot.navigationSource.ways.flatMap(w => w.nodes));
  const associationNodes = snapshot.nodes.filter(n => primaryIds.has(n.id));
  const episodes = detourEpisodes(timeline), trials = [];
  for (const scenario of retrospectiveCases(timeline)) {
      const { sample, entry, rejoin, recordingGap } = scenario;
      const shared = { timestamp: sample.timestamp, offRouteMeters: sample.off_original_route_m, recordingGap };
      if (scenario.reason) { trials.push({ ...shared, status: 'unavailable', reason: scenario.reason }); continue; }
      const target = nearestStudyNode(associationNodes, fixes.get(rejoin.timestamp));
      if (!target) { trials.push({ ...shared, status: 'unavailable', reason: 'rejoin-node-unassociated' }); continue; }
      const origin = nearestStudyNode(associationNodes, fixes.get(sample.timestamp));
      const base = { ...shared,
        originAssociation: origin, targetAssociation: target, associationValidity: 'geometric-only-unvalidated',
        targetSelection: 'retrospective observed rejoin; not an online choice or continuity validation' };
      if (!origin) { trials.push({ ...base, status: 'unavailable', reason: 'origin-node-unassociated' }); continue; }
      const result = findRecovery(graph, { origin: origin.node, targets: [{ node: target.node, visit: Math.round(rejoin.original_progress_m * 100) }],
        afterVisit: Math.round(entry.original_progress_m * 100), throughVisit: Math.round(rejoin.original_progress_m * 100) });
      trials.push({ ...base, ...result });
  }
  const counts = rows => rows.reduce((r, row) => { const key = row.status === 'candidate' ? 'candidate' : row.reason; r[key] = (r[key] ?? 0) + 1; return r; }, {});
  const candidates = trials.filter(t => t.status === 'candidate');
  const graphIds = new Set(graph.nodes.map(n => n.id));
  const exclusions = new Map([...adapted.excludedWays, ...graph.excluded].map(w => [w.way, w.reason]));
  const missingNodes = new Map();
  for (const t of trials) for (const role of ['originAssociation', 'targetAssociation']) {
    const node = t[role]?.node;
    if (node && !graphIds.has(node)) {
      const key = role + ':' + node;
      if (!missingNodes.has(key)) missingNodes.set(key, { node, role, reasons: new Set() });
    }
  }
  for (const w of snapshot.navigationSource.ways) for (const association of missingNodes.values()) {
    if (w.nodes.includes(association.node) && exclusions.has(w.id)) association.reasons.add(exclusions.get(w.id));
  }
  const associationExclusions = {};
  for (const a of missingNodes.values()) for (const reason of a.reasons) {
    const key = a.role + ':' + reason; associationExclusions[key] = (associationExclusions[key] ?? 0) + 1;
  }
  const summary = { scope: 'retrospective observed-rejoin structural study', sourceIntegrity: snapshot.integrity,
    sourceEvidence: adapted.evidence, sourceExclusions: adapted.excludedWays.reduce((r, w) => { r[w.reason] = (r[w.reason] ?? 0) + 1; return r; }, {}),
    graph: { nodes: graph.nodes.length, directedEdges: graph.edges.length, policyExcludedWays: graph.excluded.length, issues: graph.issues.length,
      jsonBytes: Buffer.byteLength(JSON.stringify(graph)) },
    episodes: episodes.map((e, i) => ({ index: i, status: e.status, offRouteSamples: e.samples.length,
      maxOffRouteMeters: Math.max(...e.samples.map(s => s.off_original_route_m)) })),
    sampledTrials: trials.length, results: counts(trials), candidateLegsJsonBytes: Buffer.byteLength(JSON.stringify(candidates)),
    sampling: 'off-route >=50 m, one fix per 30 seconds plus maximum deviation; retrospective stable forward rejoin within 30 minutes',
    trialsWithRecordingGap: trials.filter(t => t.recordingGap).length,
    excludedUniqueAssociationsByCause: associationExclusions,
    rings: [1000, 2000, 3000].map(radiusMeters => { const rows = trials.filter(t => t.offRouteMeters <= radiusMeters); return { radiusMeters, sampledTrials: rows.length, results: counts(rows) }; }),
    work: { maxSettledNodes: Math.max(0, ...trials.map(t => t.settledNodes ?? 0)), maxRelaxedEdges: Math.max(0, ...trials.map(t => t.relaxedEdges ?? 0)), maxQueueEntries: Math.max(0, ...trials.map(t => t.queuePeak ?? 0)) },
    gaps: ['GPS-to-road connectors and target-to-route connectors unvalidated', 'retrospective target uses future ride evidence',
      'conservative whole-way restriction/barrier quarantine can remove rideable links', 'regional cycling access profile unvalidated',
      'only sampled actual detours; no continuous 1/2/3 km coverage proof', 'target memory, codec, draw cost and timing unmeasured'],
    validatedCyclingPaths: 0, deviceAcceptance: 'unvalidated' };
  return { summary, trials, graph };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  if (a.length !== 4 || a[0] !== '--input' || a[2] !== '--output') throw Error('Usage: --input STUDY.json --output NEW_DIRECTORY');
  const config = JSON.parse(fs.readFileSync(a[1])), hashes = {}, inputs = {};
  for (const key of ['snapshot', 'track', 'timeline']) {
    const raw = fs.readFileSync(config[key]); hashes[key] = createHash('sha256').update(raw).digest('hex'); inputs[key] = JSON.parse(raw);
  }
  const result = studyRide(inputs.snapshot, inputs.track, inputs.timeline);
  fs.mkdirSync(a[3]);
  fs.writeFileSync(path.join(a[3], 'summary.json'), JSON.stringify({ ...result.summary, inputSha256: hashes }, null, 2) + '\n');
  fs.writeFileSync(path.join(a[3], 'trials.json'), JSON.stringify(result.trials) + '\n');
  fs.writeFileSync(path.join(a[3], 'graph.json'), JSON.stringify(result.graph) + '\n');
  console.log(JSON.stringify(result.summary, null, 2));
}
