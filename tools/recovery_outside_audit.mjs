// Host audit: classifies replay moments that the C core reports as RC_OUTSIDE (reason 6).
// Each moment is compared with the legs of the package mounted for its last ordered progress,
// using the core's own limits: 15 m to a piece and a 45 degree heading match. Read-only.
// usage: node tools/recovery_outside_audit.mjs CONFIG.json BUNDLE_DIR REPLAY_DIR
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hav, brg, adiff} from '../js/geo.js';

const RC_OUTSIDE = 6;

function readLegs(file) {
  const b = fs.readFileSync(file), n = b.readUInt16LE(120), portals = [];
  for (let i = 0; i < n; i++) {
    const at = 160 + 64 * i, count = b.readUInt16LE(at + 20), pointAt = b.readUInt32LE(at + 16), poly = [];
    for (let k = 0; k < count; k++) poly.push([b.readInt32LE(pointAt + 8 * k) / 1e7, b.readInt32LE(pointAt + 8 * k + 4) / 1e7]);
    portals.push({index: i + 1, poly});
  }
  return portals;
}

// Distance in metres from p to segment a-b, and the bearing of a-b.
function project(p, a, b) {
  const k = Math.cos(p[0] * Math.PI / 180), xy = q => [(q[1] - p[1]) * 111320 * k, (q[0] - p[0]) * 111320];
  const [ax, ay] = xy(a), [bx, by] = xy(b), dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return {d: Math.hypot(ax + dx * t, ay + dy * t), bearing: len ? brg(a, b) : 0};
}

export function classifyOutside({track, timeline, events, manifest, legsOf}) {
  const rows = [];
  let lastOrdered = null;
  const heading = i => {
    for (let j = i - 1; j >= 0; j--) {
      if (track[i][0] - track[j][0] > 10) break;
      if (hav(track[j].slice(1), track[i].slice(1)) >= 5) return brg(track[j].slice(1), track[i].slice(1));
    }
    return null;
  };
  events.forEach((ev, i) => {
    const row = timeline[i];
    const ordered = row.off_original_route_m <= 20 && row.ambiguous_with_other_pass === false;
    if (!(row.off_original_route_m > 20)) { if (ordered) lastOrdered = Math.round(row.original_progress_m * 100); return; }
    if (ev.reason !== RC_OUTSIDE) return;
    const pkg = manifest.packages.find(p => lastOrdered !== null && lastOrdered >= p.entryMin && lastOrdered < p.entryMax) ?? null;
    const portals = pkg ? legsOf(pkg.name) : [];
    const h = heading(i), p = track[i].slice(1);
    let any = {d: Infinity}, aligned = {d: Infinity};
    for (const portal of portals) for (let k = 1; k < portal.poly.length; k++) {
      const q = project(p, portal.poly[k - 1], portal.poly[k]);
      if (q.d < any.d) any = {...q};
      if (h !== null && Math.abs(adiff(h, q.bearing)) <= 45 && q.d < aligned.d) aligned = {...q};
    }
    let category;
    if (!portals.length) category = 'package-has-no-legs';
    else if (any.d > 15) category = 'no-leg-within-15m';
    else if (h === null) category = 'within-15m-no-heading';
    else if (aligned.d > 15) category = 'within-15m-heading-against-leg';
    else category = 'within-15m-aligned-other';
    const relative = h === null || any.d === Infinity ? null : Math.abs(adiff(h, any.bearing));
    rows.push({index: i, package: pkg?.name ?? null, category, distanceToNearestLegM: Math.round(any.d * 10) / 10,
      headingVsNearestLegDeg: relative === null ? null : Math.round(relative)});
  });
  const counts = {};
  for (const r of rows) { const k = `${r.package ?? 'no-package'} ${r.category}`; counts[k] = (counts[k] ?? 0) + 1; }
  return {total: rows.length, counts, rows};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [configFile, bundleDir, replayDir] = process.argv.slice(2);
  if (!bundleDir || !replayDir || process.argv.length !== 5) throw Error('Usage: node tools/recovery_outside_audit.mjs CONFIG.json BUNDLE_DIR REPLAY_DIR');
  const config = JSON.parse(fs.readFileSync(configFile));
  const track = JSON.parse(fs.readFileSync(config.track)), timeline = JSON.parse(fs.readFileSync(config.timeline));
  const events = JSON.parse(fs.readFileSync(path.join(replayDir, 'events.json')));
  const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'manifest.json')));
  const cache = new Map();
  const legsOf = name => { if (!cache.has(name)) cache.set(name, readLegs(path.join(bundleDir, name))); return cache.get(name); };
  const out = classifyOutside({track, timeline, events, manifest, legsOf});
  console.log(JSON.stringify({total: out.total, counts: out.counts}, null, 2));
}
