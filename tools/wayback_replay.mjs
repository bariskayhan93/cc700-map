#!/usr/bin/env node
// Replays the way-back core on the off-route frames of the recorded ride and prints one JSON report.
// Usage: node tools/wayback_replay.mjs <config.json> <file.ccwb> <line2k|ride1500>
// Host only. The report holds counts only: no coordinates, no ride content.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {hav} from '../js/geo.js';
import {readNativeRoute} from './recovery_planner.mjs';
import {routeSamples} from './wayback_tree.mjs';
import {runCore} from './wayback_core_host.mjs';

const WB_GPS_VALID = 1, WB_OFF_ROUTE = 2, WB_EXIT_TRUSTED = 4;
const WB_NO_STREET = 4, WB_DIST_UNKNOWN = 0xFFFFFFFF;
const RADIUS = {line2k: 4000, ride1500: 1500};
const SAMPLE_M = 5, NEAR_M = 10;

// Runs of timeline rows with provider_reason 'off-route'. a and b are row indexes, b inclusive.
export function episodesOf(timeline) {
  const out = [];
  let cur = null;
  timeline.forEach((row, i) => {
    if (row.provider_reason === 'off-route') {
      if (!cur) cur = {a: i, b: i};
      cur.b = i;
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  });
  if (cur) out.push(cur);
  return out;
}

// The exit is the progress of the row before the episode. An episode from row 0 has no exit.
export function exitOf(timeline, ep) {
  return ep.a > 0 ? {exitM: timeline[ep.a - 1].original_progress_m, trusted: true} : {exitM: 0, trusted: false};
}

// True when no route sample with progress in the forward window is within NEAR_M of the last point.
// Window: from c*1000 - 50 - R to c*1000 + 4000 metres, c = floor(exit / 1000).
export function isWrongPart(last, exitM, samples, R) {
  const c = Math.floor(exitM / 1000);
  const lo = c * 1000 - 50 - R, hi = c * 1000 + 4000;
  return !samples.some(s => s.g >= lo && s.g <= hi && hav(last, s.point) <= NEAR_M);
}

// A line that goes to point 1 and then comes back toward point 0, the rider's projection.
export function reversedAtPoint1(points) {
  if (points.length < 3) return false;
  return hav(points[2], points[0]) < hav(points[1], points[0]);
}

function frameInput(track, i, exitM, trusted) {
  return {
    latE7: Math.round(track[i][1] * 1e7),
    lonE7: Math.round(track[i][2] * 1e7),
    exitCm: Math.round(exitM * 100),
    flags: WB_GPS_VALID | WB_OFF_ROUTE | (trusted ? WB_EXIT_TRUSTED : 0),
    maxPoints: 4096,
  };
}

function main() {
  const [configPath, filePath, reach] = process.argv.slice(2);
  if (!configPath || !filePath || !(reach in RADIUS)) {
    console.error('usage: node tools/wayback_replay.mjs <config.json> <file.ccwb> <line2k|ride1500>');
    return 2;
  }
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const routeBytes = fs.readFileSync(cfg.route);
  const route = readNativeRoute(routeBytes);
  const samples = routeSamples(route, SAMPLE_M);
  const routeId = createHash('sha256').update(routeBytes).digest().subarray(0, 16);
  const file = fs.readFileSync(filePath);
  const track = JSON.parse(fs.readFileSync(cfg.track, 'utf8'));
  const timeline = JSON.parse(fs.readFileSync(cfg.timeline, 'utf8'));

  const episodes = episodesOf(timeline);
  const lines = [], owner = [], exits = [];
  episodes.forEach((ep, k) => {
    const {exitM, trusted} = exitOf(timeline, ep);
    exits.push({exitM, trusted});
    for (let i = ep.a; i <= ep.b; i++) { lines.push(frameInput(track, i, exitM, trusted)); owner.push(k); }
  });
  const results = runCore(file, routeId, lines);
  if (results.length && results[0].mounted === 0) throw new Error('the file did not mount (format or route identity)');

  const R = RADIUS[reach];
  const rep = {
    reach, frames: lines.length, lineFrames: 0, forwardFrames: 0, distanceUnknown: 0, wrongPart: 0,
    noStreet: 0, reversedAtPoint1: 0, maxReadsPerFrame: 0, maxPoints: 0,
    episodes: episodes.map((ep, k) => ({exit: exits[k].exitM, frames: ep.b - ep.a + 1, lineFrames: 0, wrongPart: 0})),
  };
  results.forEach((r, i) => {
    const e = rep.episodes[owner[i]];
    rep.maxReadsPerFrame = Math.max(rep.maxReadsPerFrame, r.reads);
    if (r.reason === WB_NO_STREET) rep.noStreet++;
    if (r.state !== 1) return;
    rep.lineFrames++;
    e.lineFrames++;
    rep.maxPoints = Math.max(rep.maxPoints, r.points.length);
    const deg = r.points.map(([la, lo]) => [la / 1e7, lo / 1e7]);
    if (r.forward === 1) {
      rep.forwardFrames++;
      if (r.distanceDm === WB_DIST_UNKNOWN) rep.distanceUnknown++;
    }
    if (reversedAtPoint1(deg)) rep.reversedAtPoint1++;
    if (exits[owner[i]].trusted && isWrongPart(deg.at(-1), exits[owner[i]].exitM, samples, R)) {
      rep.wrongPart++;
      e.wrongPart++;
    }
  });
  console.log(JSON.stringify(rep, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
