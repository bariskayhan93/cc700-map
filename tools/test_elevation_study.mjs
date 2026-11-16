import { test } from 'node:test';
import assert from 'node:assert/strict';
import { elevationStrip, readRouteElevations } from './elevation_study.mjs';
import { fs, fu, fb, u32le } from '../js/pb.js';
const opts = { progress: 0, progressValid: true, onRoute: true };
const points = [[0, 40], [250, 41], [500, 46], [750, 39], [1000, 40]].map(([distance, elevation]) => ({ distance, elevation }));
test('profile has bounded exact packet bytes and minimum vertical scale', () => {
  const r = elevationStrip(points, opts);
  assert.equal(r.status, 'candidate'); assert.equal(r.packet.byteLength, 448);
  assert.equal(r.domainMeters[1] - r.domainMeters[0], 40);
  assert.equal(r.cost.validColumns, 224); assert.equal(r.cost.deviceFrameTimeMs, null);
});
test('off-route, stale progress and finish hide the entire strip', () => {
  for (const o of [{ onRoute: false }, { progressValid: false }, { progress: NaN }, { progress: 1000 }, { progress: -1 }]) {
    const r = elevationStrip(points, { ...opts, ...o }); assert.equal(r.status, 'unavailable'); assert.equal(r.packet, null);
  }
  assert.equal(elevationStrip(points, opts).status, 'candidate');
});
test('zero elevations are ambiguous unless explicitly confirmed; negative elevations work', () => {
  const zero = points.map(p => ({ ...p, elevation: 0 }));
  assert.equal(elevationStrip(zero, opts).status, 'unavailable');
  assert.equal(elevationStrip(zero, { ...opts, zeroElevationConfirmed: true }).status, 'candidate');
  assert.equal(elevationStrip(points.map(p => ({ ...p, elevation: p.elevation - 80 })), opts).status, 'candidate');
});
test('missing elevations, wide gaps and conflicting duplicate endpoints never bridge', () => {
  for (const p of [points.map((p, i) => i === 2 ? { ...p, elevation: null } : p),
    points.filter((p, i) => i !== 2), [...points.slice(0, 3), { distance: 500, elevation: 99 }, ...points.slice(3)]]) {
    const r = elevationStrip(p, opts); assert.equal(r.status, 'candidate');
    assert(r.cost.missingColumns > 0); assert.equal(r.packet[112 * 2], 255);
  }
});
test('matching duplicate endpoints preserve the profile and short finish windows clip', () => {
  const r = elevationStrip([...points.slice(0, 3), points[2], ...points.slice(3)], opts);
  assert.deepEqual(r.packet, elevationStrip(points, opts).packet);
  assert.equal(elevationStrip(points, { ...opts, progress: 900 }).horizonMeters, 100);
});
test('narrow peaks survive column envelopes and invalid parameters reject', () => {
  const r = elevationStrip([{ distance: 0, elevation: 0 }, { distance: 5, elevation: 100 }, { distance: 10, elevation: 0 }], { ...opts, width: 2 });
  assert.deepEqual(r.elevationRangeMeters, [0, 100]); assert(r.columns.every(c => c.top === 0 && c.bottom === 15));
  assert.throws(() => elevationStrip(points, { ...opts, width: 100000 }));
  assert.throws(() => elevationStrip([...points].reverse(), opts));
});
test('native file signed centimetres decode independently of zero defaults', () => {
  const p = e => fb(3, [...fu(5, e === null ? 1000 : 0), ...(e === null ? [] : fs(3, e))]);
  const body = Uint8Array.from([...p(-1250), ...p(null)]), header = new Uint8Array(128);
  new DataView(header.buffer).setUint16(0x46, 1, true);
  const bytes = Uint8Array.from([...header, ...u32le(body.length), ...body]);
  assert.deepEqual(readRouteElevations(bytes), [{ distance: 0, elevation: -12.5 }, { distance: 10, elevation: null }]);
  assert.throws(() => readRouteElevations(bytes.subarray(0, 130)));
});
test('truncated point varints are rejected rather than becoming an elevation', () => {
  const body = Uint8Array.from(fb(3, [...fu(5, 0), 24, 128])), header = new Uint8Array(128);
  new DataView(header.buffer).setUint16(0x46, 1, true);
  assert.throws(() => readRouteElevations(Uint8Array.from([...header, ...u32le(body.length), ...body])));
});
test('the admitted point bound cannot overflow a dense profile column call stack', () => {
  const dense = Array.from({ length: 99996 }, (_, i) => ({ distance: i / 1000, elevation: 40 + i % 2 }));
  dense.push(...[250, 500, 750, 1000].map(distance => ({ distance, elevation: 40 })));
  assert.equal(elevationStrip(dense, { ...opts, width: 2 }).status, 'candidate');
});
