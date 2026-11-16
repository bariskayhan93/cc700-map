// Apply the host provider (recovery_provider.mjs) to a recorded ride. PC only; private inputs.
// Writes a replay timeline in the research-timeline shape, so the unchanged C-core replay can use it,
// and a comparison with the retrospective research timeline (which may use future fixes).
// usage: node tools/recovery_provider_timeline.mjs --input STUDY.json --output NEW_DIRECTORY
import fs from 'node:fs';
import path from 'node:path';
import {readNativeRoute} from './recovery_planner.mjs';
import {createProvider, PROVIDER} from './recovery_provider.mjs';

export function providerTimeline(route, track) {
  const provider = createProvider(route);
  return track.map(([t, lat, lon]) => ({t, ...provider.step({t, point: [lat, lon]})}));
}

export function compare(rows, research) {
  if (rows.length !== research.length) throw Error('Track/timeline length mismatch');
  const out = {ambiguousRows: 0, agree: 0, disagree: 0, unresolved: 0, unresolvedReasons: {},
    singlePassRows: 0, singlePassOrdered: 0, singlePassProgressOver30m: 0, onRouteMismatch: 0};
  rows.forEach((r, i) => {
    const s = research[i], researchOn = s.off_original_route_m <= 20;
    if (researchOn !== r.onRoute) out.onRouteMismatch++;
    if (!researchOn || !r.onRoute) return;
    const delta = Math.abs(r.progressCm / 100 - s.original_progress_m);
    if (s.ambiguous_with_other_pass === true) {
      out.ambiguousRows++;
      if (!r.ordered) { out.unresolved++; out.unresolvedReasons[r.reason] = (out.unresolvedReasons[r.reason] ?? 0) + 1; }
      else if (delta <= 30) out.agree++;
      else out.disagree++;
    } else {
      out.singlePassRows++;
      if (r.ordered) { out.singlePassOrdered++; if (delta > 30) out.singlePassProgressOver30m++; }
    }
  });
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const a = process.argv.slice(2);
  if (a.length !== 4 || a[0] !== '--input' || a[2] !== '--output') throw Error('Usage --input STUDY.json --output NEW_DIRECTORY');
  if (fs.existsSync(a[3])) throw Error('Output exists');
  const config = JSON.parse(fs.readFileSync(a[1]));
  const route = readNativeRoute(fs.readFileSync(config.route));
  const track = JSON.parse(fs.readFileSync(config.track));
  const research = JSON.parse(fs.readFileSync(config.timeline));
  const rows = providerTimeline(route, track);
  const timeline = rows.map((r, i) => ({...research[i],
    off_original_route_m: r.offRouteM,
    original_progress_m: (r.progressCm ?? 0) / 100,
    ambiguous_with_other_pass: r.onRoute ? !r.ordered : false,
    provider_reason: r.reason}));
  const reasons = {};
  for (const r of rows) reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
  const report = {provider: PROVIDER, fixes: rows.length, reasons, comparison: compare(rows, research),
    scope: 'host reference rule; past fixes only; recorded track as GPS source; not a device provider'};
  fs.mkdirSync(a[3]);
  fs.writeFileSync(path.join(a[3], 'timeline.json'), JSON.stringify(timeline));
  fs.writeFileSync(path.join(a[3], 'config.json'), JSON.stringify({...config, timeline: path.join(a[3], 'timeline.json')}, null, 2) + '\n');
  fs.writeFileSync(path.join(a[3], 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
