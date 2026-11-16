// Host reference rule for the recovery core's RC_ORDERED_MATCH input. PC only; no device code.
// Decides from past fixes only whether an on-route fix has exactly one trusted route position.
// A route that uses the same street twice gives one candidate per pass. Order of checks:
//  1. One candidate: ordered ("single-pass"). Not checked against the anchor or heading (gap).
//  2. Several: keep the passes whose direction is within 60 degrees of the rider's heading.
//     If the heading fits no pass, the rider is turning: the heading is ignored for this fix.
//  3. With an anchor, drop every pass behind it. A rider never moves backward along the route.
//  4. Exactly one left: ordered ("heading" when the heading decided, else "continuity").
//  5. Otherwise unordered, so the core reports "no trusted position" instead of guessing.
//     There is deliberately no "not farther ahead than ridden" guess: a rider who cuts a hairpin
//     or skips a loop moves ahead faster than he rides, and that guess locked onto a wrong pass.
//     Same-direction repeats of a street therefore stay unordered (a known gap, not a wrong answer).
// The heading and stop rules were added after this project's first ride showed wrong-pass
// lock-ins and stop gaps. They rest on general arguments, but they need a second ride to confirm.
import {hav, brg, adiff} from '../js/geo.js';

export const PROVIDER = Object.freeze({
  onRouteM: 20,        // same on-route distance as the research timeline
  samePassM: 60,       // candidates closer than this in progress belong to one pass
  behindM: 20,         // a candidate may lie at most this far behind the anchor (GPS noise)
  gapS: 5,            // a longer gap between fixes is a gap (same limit as the core)
  stopKeepM: 30,       // across a gap, the anchor survives only if the rider moved at most this far:
                       // twice the core's 15 m accuracy limit, so a stop with GPS noise passes
  headingDeg: 60,      // pass direction must be within this of the rider's heading (generator uses 60)
  headingMinM: 5,      // heading comes from a past fix at least this far away ...
  headingMaxS: 10,     // ... and at most this many seconds old (same as the replay)
});

function localFrame(origin) {
  const k = Math.cos(origin[0] * Math.PI / 180);
  return q => [(q[1] - origin[1]) * 111320 * k, (q[0] - origin[0]) * 111320];
}

// Route positions within onRouteM of the point, one per pass, sorted by progress (cm).
// The returned array also carries nearestM: the distance to the closest route segment.
export function routeCandidates(route, point, {onRouteM = PROVIDER.onRouteM, samePassM = PROVIDER.samePassM} = {}) {
  if (!Array.isArray(route) || route.length < 2) throw Error('Route needs at least two points');
  const xy = localFrame(point), hits = [];
  let nearest = Infinity;
  for (let i = 1; i < route.length; i++) {
    const a = xy(route[i - 1].point), b = xy(route[i].point), dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / len2)) : 0;
    const d = Math.hypot(a[0] + t * dx, a[1] + t * dy);
    if (d < nearest) nearest = d;
    if (d <= onRouteM) hits.push({progressCm: Math.round(route[i - 1].progress + t * (route[i].progress - route[i - 1].progress)),
      distanceM: d, bearing: len2 ? brg(route[i - 1].point, route[i].point) : null});
  }
  hits.sort((u, v) => u.progressCm - v.progressCm);
  const passes = [];
  let runEnd = -Infinity;
  for (const h of hits) {
    if (passes.length && h.progressCm - runEnd <= samePassM * 100) {
      if (h.distanceM < passes.at(-1).distanceM) passes[passes.length - 1] = h;
    } else passes.push(h);
    runEnd = h.progressCm;
  }
  passes.nearestM = nearest;
  return passes;
}

export function createProvider(route, options = {}) {
  const o = {...PROVIDER, ...options};
  let anchor = null, last = null;
  const history = [];   // recent fixes since the last gap, oldest first
  function heading(t, point) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (t - history[i].t > o.headingMaxS) break;
      if (hav(history[i].point, point) >= o.headingMinM) return brg(history[i].point, point);
    }
    return null;
  }
  return {
    get anchorCm() { return anchor ? anchor.progressCm : null; },
    step({t, point}) {
      if (!Number.isFinite(t) || !Array.isArray(point)) throw Error('Fix needs a time and a point');
      const moved = last ? hav(last.point, point) : 0;
      const clockFault = last && t <= last.t, gap = last && !clockFault && t - last.t > o.gapS;
      if (clockFault || (gap && moved > o.stopKeepM)) anchor = null;  // a stop gap keeps the anchor
      if (clockFault || gap) history.length = 0;                      // a heading never spans a gap
      const riderHeading = heading(t, point);
      last = {t, point};
      history.push({t, point});
      while (t - history[0].t > o.headingMaxS) history.shift();

      const passes = routeCandidates(route, point, o), offRouteM = passes.nearestM;
      if (!passes.length) return {onRoute: false, ordered: false, progressCm: anchor ? anchor.progressCm : null, offRouteM, reason: 'off-route'};
      let pick = null, reason;
      if (passes.length === 1) { pick = passes[0]; reason = 'single-pass'; }
      else {
        const aligned = riderHeading === null ? passes
          : passes.filter(c => c.bearing === null || Math.abs(adiff(riderHeading, c.bearing)) <= o.headingDeg);
        // A heading that fits no pass means the rider is turning (often off the route). Ignore it
        // then, so the anchor alone decides; a turn must not erase a trusted position.
        const usable = aligned.length ? aligned : passes;
        const headingDecided = riderHeading !== null && aligned.length === 1;
        const floor = anchor ? anchor.progressCm - o.behindM * 100 : -Infinity;
        const forward = usable.filter(c => c.progressCm >= floor);
        if (!forward.length) reason = 'ambiguous-no-fit';
        else if (forward.length === 1 && (anchor || headingDecided)) {
          pick = forward[0];
          reason = headingDecided ? 'heading' : 'continuity';
        } else reason = anchor ? 'ambiguous-several-ahead' : 'ambiguous-no-anchor';
      }
      if (pick) {
        anchor = {progressCm: pick.progressCm};
        return {onRoute: true, ordered: true, progressCm: pick.progressCm, offRouteM, reason};
      }
      const nearestPass = passes.reduce((a, b) => (a.distanceM <= b.distanceM ? a : b));
      return {onRoute: true, ordered: false, progressCm: nearestPass.progressCm, offRouteM, reason};
    },
  };
}
