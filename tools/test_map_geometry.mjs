import assert from 'node:assert/strict';
import { test } from 'node:test';
import { frame } from '../js/geo.js';
import { prepareDisplayLines, clipDisplayLine } from '../js/map_geometry.js';
const F = frame(0), p = (x, y) => F.g(x, y);
const line = (xy, extra = {}) => ({kind: 3, name: 'Road', fl: 8, pts: xy.map(([x,y]) => p(x,y)), ...extra});
const has = (pts, q) => pts.some(v => v[0] === q[0] && v[1] === q[1]);

test('shared middle junction and semantic endpoints survive detail simplification', () => {
  const junction = p(20, .2), boundary = p(40, 0);
  const roads = [line([[0,0],[10,.1],[20,.2],[30,.1],[40,0]]), line([[20,.2],[20,20]], {name:'Side'}), line([[40,0],[60,0]], {fl:72})];
  const out = prepareDisplayLines(roads, F);
  assert.ok(has(out[0].pts, junction));
  assert.deepEqual(out[0].pts.at(-1), boundary);
  assert.deepEqual(out[2].pts[0], boundary);
  assert.equal(out[2].fl, 72);
  assert.equal(out[0].pts.length, 3);
});

test('grade-separated coincident vertices do not create simplification anchors', () => {
  const out = prepareDisplayLines([line([[0,0],[20,.2],[40,0]]), line([[20,.2],[20,20]], {fl:13})], F);
  assert.equal(out[0].pts.length, 2);
  assert.equal(out[1].fl, 13);
});

test('parallel roads, a dangling approach and hairpin never snap or collapse', () => {
  const roads = [line([[0,0],[50,0]]),line([[0,.4],[50,.4]]),line([[25,10],[25,3]]),line([[0,30],[30,30],[30,30.5],[0,30.5]])];
  const out = prepareDisplayLines(roads, F);
  for (let i=0;i<3;i++) assert.deepEqual(out[i].pts, roads[i].pts);
  assert.ok(has(out[3].pts, p(30,30)) || has(out[3].pts, p(30,30.5)));
  assert.deepEqual(out[3].pts.at(-1), p(0,30.5));
});

test('canonical simplification is reversal and input-order independent without mutating raw source', () => {
  const roads = [line([[0,0],[10,2],[20,0],[30,2],[40,0]]), line([[80,0],[100,0]])];
  const raw = structuredClone(roads);
  const a = prepareDisplayLines(roads,F);
  const b = prepareDisplayLines(roads.slice().reverse().map(L=>({...L,pts:L.pts.slice().reverse()})), F);
  assert.deepEqual(a[0].pts, b[1].pts.slice().reverse());
  assert.deepEqual(roads, raw);
  a[0].pts[0][0] = 5;
  assert.deepEqual(roads, raw);
});

test('shared reversed chain keeps exactly coincident geometry', () => {
  const source = line([[0,0],[31,.4],[67,.2],[102,0]]);
  const out = prepareDisplayLines([source, {...source,pts:source.pts.slice().reverse(),name:'Other'}],F);
  assert.deepEqual(out[0].pts, out[1].pts.slice().reverse());
  assert.deepEqual(out[0].displaySamples.map(s=>s.q), out[1].displaySamples.map(s=>s.q).reverse());
});

test('clipping repeated windows preserves global curves and deterministic endpoints without local RDP', () => {
  const [L] = prepareDisplayLines([line([[0,0],[30,0],[60,15],[90,15],[120,0]])],F);
  const before = structuredClone(L);
  const cut = (lo,hi) => clipDisplayLine(L,q=>{const x=F.m(...q)[0];return x>=lo && x<=hi;});
  const a = cut(20,95), b = cut(45,120);
  assert.deepEqual(a, cut(20,95));
  assert.deepEqual(L, before);
  for (const q of [p(60,15),p(90,15)]) { assert.ok(has(a[0],q)); assert.ok(has(b[0],q)); }
  assert.ok(a[0][0][1] < p(30,0)[1]);
  assert.equal(a[0][0][0], 0);
});

test('range clipping does not shortcut between separated retained runs and keeps the existing 8m policy', () => {
  const [L] = prepareDisplayLines([line([[0,0],[150,0]])],F);
  const runs = clipDisplayLine(L,q=>{const x=F.m(...q)[0];return x<20 || x>130;});
  assert.equal(runs.length,2);
  assert.ok(F.m(...runs[0].at(-1))[0] < F.m(...runs[1][0])[0]);
  const [tiny] = prepareDisplayLines([line([[0,0],[4,0]])],F);
  assert.deepEqual(clipDisplayLine(tiny,()=>true),[]);
});

test('invalid and degenerate source geometry is rejected without joining over gaps', () => {
  assert.deepEqual(prepareDisplayLines([],F),[]);
  for (const pts of [[],[p(0,0)],[p(0,0),p(0,0)],[[NaN,0],p(1,0)],[[91,0],p(1,0)], [p(0,0),null,p(2,0)]]) {
    assert.deepEqual(prepareDisplayLines([{pts}],F),[]);
  }
  assert.throws(()=>prepareDisplayLines(null,F),TypeError);
  assert.throws(()=>prepareDisplayLines([],F,{tolerance:-1}),RangeError);
});
