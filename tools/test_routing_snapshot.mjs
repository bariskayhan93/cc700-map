import assert from 'node:assert/strict';
import {test} from 'node:test';
import {captureRoutingSnapshot,routingQuery,snapshotCandidateSource} from './routing_snapshot.mjs';
import {evaluateRecovery} from './recovery_study.mjs';
const n=(id,lat,lon,tags={})=>({type:'node',id,lat,lon,tags});
const w=(id,nodes,tags={})=>({type:'way',id,nodes,tags:{highway:'residential',...tags}});
const rel=(id,members,tags={})=>({type:'relation',id,members,tags:{type:'restriction',restriction:'no_left_turn',...tags}});
const member=(type,ref,role)=>({type,ref,role});
const base=()=>[n(1,51,7),n(2,51,7.001),n(3,51,7.002),w(10,[1,2]),w(20,[2,3])];
const response=elements=>({version:0.6,osm3s:{timestamp_osm_base:'2026-11-15T00:00:00Z'},elements});
const meta={bbox:[51,7,51.01,7.01],querySha256:'a'.repeat(64)};
const snap=elements=>captureRoutingSnapshot(response(elements),meta);

test('snapshot preserves node tags, original coordinates, relation member order and raw tags',()=>{
 const els=[...base(),rel(100,[member('way',10,'from'),member('node',2,'via'),member('way',20,'to')],{'restriction:conditional':'no_left_turn @ (Mo-Fr)'})];
 els[1].tags={barrier:'bollard',bicycle:'yes'};const before=structuredClone(els),s=snap(els);
 assert.equal(s.integrity,'pass');assert.deepEqual(s.nodes[1].tags,{barrier:'bollard',bicycle:'yes'});
 assert.deepEqual(s.restrictions[0].members,els.at(-1).members);assert.equal(s.restrictions[0].tags['restriction:conditional'],'no_left_turn @ (Mo-Fr)');
 assert.deepEqual(s.navigationSource.ways[0].pts,[[51,7],[51,7.001]]);assert.deepEqual(els,before);
 els[1].tags.barrier='gate';assert.equal(s.nodes[1].tags.barrier,'bollard');
});
test('exact duplicates deduplicate but conflicting identities quarantine regardless of order',()=>{
 const a=base();a.push(structuredClone(a[0]));assert.equal(snap(a).nodes.length,3);
 const conflict=n(2,51.1,7.001),s=snap([...base(),conflict]),rev=snap([...base(),conflict].reverse());
 assert.equal(s.integrity,'incomplete');assert(!s.nodes.some(n=>n.id===2));assert.equal(s.navigationSource.ways.length,0);
 assert.deepEqual(s,rev);assert(s.issues.some(i=>i.code==='conflicting-node'));
});
test('dangling way nodes and restriction members expose incomplete integrity',()=>{
 const s=snap([n(1,51,7),w(10,[1,999]),rel(100,[member('way',10,'from'),member('node',999,'via'),member('way',20,'to')])]);
 assert.equal(s.integrity,'incomplete');assert.equal(s.navigationSource.ways.length,0);
 assert(s.issues.some(i=>i.code==='missing-way-node'));assert(s.issues.some(i=>i.code==='missing-restriction-member'));
});
test('query fetches road nodes, backreferencing restrictions and member closure within bounded inputs',()=>{
 const q=routingQuery([51,7,51.1,7.2]);
 assert.match(q,/rel\(bw\.roads\)/);assert.match(q,/way\(r\.restrictions\)/);assert.match(q,/node\(w\.allways\)/);assert.match(q,/node\(r\.restrictions\)/);assert.match(q,/out body/);
 for(const box of [[51,7,50,8],[NaN,7,52,8],[-91,0,0,1],[0,0,20,20]])assert.throws(()=>routingQuery(box),/bbox|region/i);
});
test('truncated/error or unidentifiable responses never become snapshots with passing integrity',()=>{
 for(const r of [{elements:[]},response([]),{...response(base()),remark:'runtime error: timed out'}]){
  const s=captureRoutingSnapshot(r,meta);assert.equal(s.integrity,'incomplete');assert(s.issues.length);
 }
 const s=snap([...base(),{type:'node',id:9,lat:NaN,lon:7},{type:'way',id:99,nodes:[1,'2'],tags:{highway:'service'}}]);
 assert.equal(s.integrity,'incomplete');assert(s.issues.some(i=>i.code==='invalid-node'));assert(s.issues.some(i=>i.code==='invalid-way'));
});
test('barriers and non-exempt restriction member ways are conservatively excluded from study topology',()=>{
 const s=snap([...base(),rel(100,[member('way',10,'from'),member('node',2,'via'),member('way',20,'to')])]);
 const adapted=snapshotCandidateSource(s);assert.equal(adapted.source.ways.length,0);assert.equal(adapted.excludedRestrictions.length,1);
 const gated=base();gated[1].tags={barrier:'gate',bicycle:'yes'};
 assert.equal(snapshotCandidateSource(snap(gated)).source.ways.length,0);
 const exempt=snap([...base(),rel(100,[member('way',10,'from'),member('node',2,'via'),member('way',20,'to')],{except:'bus;bicycle'})]);
 assert.equal(snapshotCandidateSource(exempt).source.ways.length,2);
});
test('via-way restriction and conditional bicycle exception are retained and quarantined',()=>{
 const els=[...base(),n(4,51,7.003),w(30,[3,4]),rel(100,[member('way',10,'from'),member('way',20,'via'),member('way',30,'to')],{'except:conditional':'bicycle @ (Su)'})];
 const s=snap(els);assert.equal(s.integrity,'pass');assert.equal(s.restrictions[0].members[1].role,'via');
 assert.equal(snapshotCandidateSource(s).source.ways.length,0);
});
test('snapshot evaluator retains conservative exclusions and remaining gaps, without changing v1 behavior',()=>{
 const s=snap(base()),r=evaluateRecovery({snapshot:s,origins:[1],targets:[{node:3,visit:1}],afterVisit:0,throughVisit:1});
 assert.equal(r.origins[0].status,'candidate');assert.equal(r.sourceEvidence.integrity,'pass');
 assert(!r.gaps.includes('barrier-node-tags-not-preserved'));assert(!r.gaps.includes('turn-restrictions-not-preserved'));
 assert(r.gaps.includes('turn-restrictions-conservatively-quarantined'));assert.equal(r.origins[0].cyclingValidity,'unvalidated');
 assert.throws(()=>evaluateRecovery({source:s.navigationSource,snapshot:s,origins:[],targets:[],afterVisit:0,throughVisit:1}),/source.*snapshot|snapshot.*source/i);
});

test('a bicycle-specific restriction cannot be erased by a general bicycle exception',()=>{
 const s=snap([...base(),rel(100,[member('way',10,'from'),member('node',2,'via'),member('way',20,'to')],{except:'bicycle','restriction:bicycle':'no_right_turn'})]);
 assert.equal(snapshotCandidateSource(s).source.ways.length,0);
});
test('incomplete snapshots fail closed and retain unpreserved-evidence gaps',()=>{
 const s=snap([...base(),w(30,[3,999])]);
 const r=evaluateRecovery({snapshot:s,origins:[1],targets:[{node:3,visit:1}],afterVisit:0,throughVisit:1});
 assert.equal(r.origins[0].status,'unavailable');assert(r.gaps.includes('barrier-node-tags-not-preserved'));
});

test('offline CLI produces reproducible snapshots, refuses overwrite and records malformed input failure',async()=>{
 const fs=await import('node:fs'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{spawnSync}=await import('node:child_process');
 const dir=fs.mkdtempSync(join(tmpdir(),'cc700-snapshot-'));
 try{
  const region=join(dir,'region.json'),raw=join(dir,'raw.json');fs.writeFileSync(region,JSON.stringify({bbox:meta.bbox}));fs.writeFileSync(raw,JSON.stringify(response(base())));
  const args=out=>['tools/routing_snapshot.mjs','--region',region,'--output',join(dir,out),'--response',raw];
  for(const out of ['a','b']){const r=spawnSync(process.execPath,args(out),{encoding:'utf8'});assert.equal(r.status,0,r.stderr);}
  assert.equal(fs.readFileSync(join(dir,'a','snapshot.json'),'utf8'),fs.readFileSync(join(dir,'b','snapshot.json'),'utf8'));
  const receipt=JSON.parse(fs.readFileSync(join(dir,'a','receipt.json')));assert.equal(receipt.network,false);assert.equal(receipt.status,'pass');assert.match(receipt.responseSha256,/^[a-f0-9]{64}$/);
  const stored=JSON.parse(fs.readFileSync(join(dir,'a','response.json')));assert.deepEqual(stored.coverBbox,meta.bbox);assert.deepEqual(stored.elements,response(base()).elements);
  assert.notEqual(spawnSync(process.execPath,args('a')).status,0);
  fs.writeFileSync(raw,'{');assert.equal(spawnSync(process.execPath,args('bad')).status,1);
  assert.equal(JSON.parse(fs.readFileSync(join(dir,'bad','receipt.json'))).status,'failed');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('response reader enforces HTTP and streaming byte limits',async()=>{
 const {boundedResponse}=await import('./routing_snapshot.mjs');
 assert.equal((await boundedResponse(new Response('abc'),3)).toString(),'abc');
 await assert.rejects(boundedResponse(new Response('abcd'),3),/byte limit/);
 await assert.rejects(boundedResponse(new Response('',{status:429})),/HTTP 429/);
});
test('editing a snapshot derived source cannot bypass the preserved node and way evidence',()=>{
 const s=snap(base());s.navigationSource.ways[0].nodes=[100,200];
 assert.throws(()=>snapshotCandidateSource(s),/snapshot.*consisten|snapshot.*mismatch/i);
});

test('an exempt restriction cannot pull an outside reference-only road into the candidate graph',()=>{
 const els=[n(1,51.001,7.001),n(2,51.02,7.02),n(3,51.03,7.03),n(4,51.04,7.04),
  w(10,[1,2]),w(20,[2,3,4]),rel(100,[member('way',10,'from'),member('node',2,'via'),member('way',20,'to')],{except:'bicycle'})];
 const s=snap(els);assert.equal(s.integrity,'pass');assert.equal(s.ways.length,2);
 // Other restrictions on way 20 were not requested: retain it as evidence only.
 assert.deepEqual(s.navigationSource.ways.map(w=>w.id),[10]);
 const r=evaluateRecovery({snapshot:s,origins:[1],targets:[{node:4,visit:1}],afterVisit:0,throughVisit:1});
 assert.equal(r.origins[0].status,'unavailable');
 assert(r.sourceExclusions.ways.some(w=>w.way===20&&w.reason==='reference-only-way'));
});

test('snapshot keeps the covered box: the saved one of a replayed answer, else the query box',()=>{
 assert.deepEqual(snap(base()).coverBbox,meta.bbox);
 const cover=[50.9,6.9,51.1,7.1];
 assert.deepEqual(captureRoutingSnapshot({...response(base()),coverBbox:cover},meta).coverBbox,cover);
 assert.deepEqual(captureRoutingSnapshot({...response(base()),coverBbox:[1,2]},meta).coverBbox,meta.bbox);
});
