import {test} from 'node:test';
import assert from 'node:assert/strict';
import {captureRoutingSnapshot} from './routing_snapshot.mjs';
import {replaySegments} from './recovery_feasibility.mjs';
const pt=x=>[51,7+x/70000];
const snap=()=>captureRoutingSnapshot({osm3s:{timestamp_osm_base:'2026-11-14T00:00:00Z'},elements:[
 {type:'node',id:1,lat:pt(0)[0],lon:pt(0)[1]},{type:'node',id:2,lat:pt(1000)[0],lon:pt(1000)[1]},
 {type:'way',id:10,nodes:[1,2],tags:{highway:'path',surface:'compacted'}}]}, {bbox:[50.99,6.99,51.01,7.03],querySha256:'a'.repeat(64)});
test('segment replay uses past progress and route visits without a future observed rejoin',()=>{
 const s=snap(),route=[{point:pt(0),progress:0},{point:pt(200),progress:20000},{point:pt(400),progress:40000},{point:pt(600),progress:60000},{point:pt(800),progress:80000},{point:pt(1000),progress:100000}];
 const track=[[0,...pt(0)],[1,...pt(120)],[2,...pt(130)]];
 const timeline=track.map((p,i)=>({timestamp:p[0],off_original_route_m:i?80:0,original_progress_m:0,ambiguous_with_other_pass:false}));
 const r=replaySegments(s,route,track,timeline);
 assert.equal(r.profiles.conservative.summary.candidateTrials,0);
 assert.equal(r.profiles.nrwFirm.summary.candidateTrials,1);assert.equal(r.profiles.nrwFirm.summary.inferredAccessCandidates,1);
 assert(r.profiles.nrwFirm.trials.every(t=>t.targetSelection?.includes('no future fix')));
 assert.equal(r.validatedCyclingPaths,0);
 assert.throws(()=>replaySegments(s,route,track.slice(1),timeline),/mismatch/);
});
test('feasibility CLI refuses existing output before touching source or marker',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,rmSync}=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{spawnSync}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'cc700-feasibility-'));
 try{const marker=join(dir,'keep');writeFileSync(marker,'same');const r=spawnSync(process.execPath,['tools/recovery_feasibility.mjs','--input','missing.json','--output',dir],{encoding:'utf8'});assert.notEqual(r.status,0);assert.match(r.stderr,/Output exists/);assert.equal(readFileSync(marker,'utf8'),'same');}finally{rmSync(dir,{recursive:true});}
});
test('replay near finish returns unavailable instead of aborting on an exhausted forward window',()=>{
 const s=snap(),route=[{point:pt(0),progress:0},{point:pt(100),progress:10000}],track=[[0,...pt(90)],[1,...pt(120)]];
 const timeline=track.map((p,i)=>({timestamp:p[0],off_original_route_m:i?80:0,original_progress_m:90,ambiguous_with_other_pass:false}));
 const r=replaySegments(s,route,track,timeline);
 assert.equal(r.profiles.conservative.summary.results['no-forward-window'],1);assert.equal(r.profiles.nrwFirm.summary.results['no-forward-window'],1);
});
