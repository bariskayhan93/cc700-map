import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detourEpisodes, nearestStudyNode, retrospectiveCases } from './recovery_ride_study.mjs';
import { capturePbfSelection } from './routing_pbf_snapshot.mjs';
import { createHash } from 'node:crypto';
const row = (timestamp, off, progress, ambiguous = false) => ({ timestamp, off_original_route_m: off,
  original_progress_m: progress, ambiguous_with_other_pass: ambiguous });
test('requires an unambiguous entry and five stable rejoin samples', () => {
  const rows = [row(0, 0, 100), row(1, 70, 100), row(2, 90, 100), ...[3,4,5,6,7].map(t => row(t, 0, 200))];
  const r = detourEpisodes(rows); assert.equal(r.length, 1); assert.equal(r[0].status, 'observed-forward-rejoin');
  assert.equal(r[0].entry.timestamp, 0); assert.equal(r[0].rejoin.timestamp, 3); assert.deepEqual(r[0].samples.map(s=>s.timestamp), [1,2]);
});
test('shared start/finish ambiguity, reverse progress and missing rejoin stay unavailable', () => {
  assert.deepEqual(detourEpisodes([row(0,0,100,true),row(1,80,100)]), []);
  const r=detourEpisodes([row(0,0,100),row(1,80,100),...[2,3,4,5,6].map(t=>row(t,0,50))]);
  assert.equal(r[0].status,'nonforward-rejoin');
  assert.equal(detourEpisodes([row(0,0,100),row(1,80,100)])[0].status,'rejoin-unobserved');
});
test('a recording gap cannot silently carry the entry or stable rejoin', () => {
  assert.equal(detourEpisodes([row(0,0,100),row(100,80,100)]).length,0);
  const r=detourEpisodes([row(0,0,100),row(1,80,100),row(100,0,200)]);
  assert.equal(r[0].status,'recording-gap');
});
test('node association is bounded geometry only and leaves far samples unavailable', () => {
  const nodes=[{id:1,point:[51,7]},{id:2,point:[51.001,7]}];
  assert.equal(nearestStudyNode(nodes,[51,7]).node,1);
  assert.equal(nearestStudyNode(nodes,[52,7]),null);
  assert.throws(()=>nearestStudyNode(nodes,[NaN,7]));
});
test('retrospective scenarios retain recording gaps and require a later stable forward target', () => {
  const rows=[row(0,0,100),row(1,80,100),row(100,100,100),...[101,102,103,104,105].map(t=>row(t,0,200))];
  const cases=retrospectiveCases(rows); assert.equal(cases.length,2);
  assert.equal(cases[0].recordingGap,true); assert.equal(cases[0].rejoin.timestamp,101);
  assert.equal(retrospectiveCases(rows.slice(0,3))[0].reason,'observed-forward-rejoin-unavailable');
});
test('PBF normalization retains its real origin, rejects altered bytes and leaves missing timestamp incomplete', () => {
  const raw=Buffer.from(JSON.stringify({osm3s:{timestamp_osm_base:null},elements:[]}));
  const receipt={status:'selected',origin:'regional-osm-file',sourceSha256:'a'.repeat(64),sourceBytes:100,
    sourceTimestamp:null,bbox:[51,7,51.01,7.01],responseBytes:raw.length,responseSha256:createHash('sha256').update(raw).digest('hex')};
  const region={bbox:[51,7,51.01,7.01]};
  const s=capturePbfSelection(raw,region,receipt);assert.equal(s.integrity,'incomplete');
  assert.equal(s.provenance.acquisition.queryExecuted,false);assert.equal(s.provenance.acquisition.origin,'regional-osm-file');
  assert.throws(()=>capturePbfSelection(Buffer.from('{}'),region,receipt));
  assert.throws(()=>capturePbfSelection(raw,region,{...receipt,sourceTimestamp:'2026-11-14T21:20:41Z'}));
});
test('a PBF receipt binds the exact original selection bbox', () => {
  const raw=Buffer.from(JSON.stringify({osm3s:{timestamp_osm_base:null},elements:[]}));
  const receipt={status:'selected',origin:'regional-osm-file',sourceSha256:'a'.repeat(64),sourceBytes:100,
    sourceTimestamp:null,bbox:[51,7,51.01,7.01],responseBytes:raw.length,responseSha256:createHash('sha256').update(raw).digest('hex')};
  assert.throws(()=>capturePbfSelection(raw,{bbox:[51,7,51.02,7.02]},receipt));
});

test('integrated replay keeps conservative default and admits only the unaffected barrier segment in transition mode', async()=>{
 const {studyRide}=await import('./recovery_ride_study.mjs');
 const {captureRoutingSnapshot}=await import('./routing_snapshot.mjs');
 const points=[[51,7],[51,7.001],[51,7.002],[51,7.003]];
 const s=captureRoutingSnapshot({osm3s:{timestamp_osm_base:'2026-11-14T00:00:00Z'},elements:[
  ...points.map(([lat,lon],i)=>({type:'node',id:i+1,lat,lon,tags:i===2?{barrier:'gate'}:{}})),
  {type:'way',id:10,nodes:[1,2,3,4],tags:{highway:'residential'}}]},
  {bbox:[50.99,6.99,51.01,7.01],querySha256:'a'.repeat(64)});
 const rows=[row(0,0,100),row(1,80,100),...[2,3,4,5,6].map(t=>row(t,0,200))];
 const track=rows.map(r=>[r.timestamp,...points[r.timestamp===1?0:1]]);
 assert.equal(studyRide(s,track,rows).summary.results['unknown-origin'],1);
 const r=studyRide(s,track,rows,{mode:'transitions'});
 assert.equal(r.summary.results.candidate,1);assert.deepEqual(r.trials[0].nodes,[1,2]);
 assert.equal(r.summary.validatedCyclingPaths,0);assert.equal(r.summary.mode,'transitions');
 assert.equal(r.summary.work.unit,'settled incoming-edge states');
 assert.throws(()=>studyRide(s,track,rows,{mode:'arbitrary'}),/mode/);
});
