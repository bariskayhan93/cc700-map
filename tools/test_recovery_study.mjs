import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCandidateGraph,findRecovery,evaluateRecovery} from './recovery_study.mjs';
const way=(id,nodes,pts,tags={})=>({id,nodes,pts,tags:{highway:'residential',...tags}});
const source=ways=>({version:1,complete:true,ways,issues:[]});
const a=[51,7],b=[51,7.001],c=[51,7.002],d=[51.001,7.001];
const request=(origin,targets=[{node:3,visit:1}],more={})=>({origin,targets,afterVisit:0,throughVisit:5,...more});
const chain=()=>buildCandidateGraph(source([way(10,[1,2,3],[a,b,c])]));

test('original node connections yield road-following geometry and distance without mutating inputs',()=>{
 const input=source([way(10,[1,2,3],[a,b,c]),way(20,[2,4],[b,d])]),before=structuredClone(input);
 const graph=buildCandidateGraph(input),snapshot=structuredClone(graph),r=findRecovery(graph,request(4));
 assert.equal(r.status,'candidate');assert.deepEqual(r.nodes,[4,2,3]);assert.deepEqual(r.ways,[20,10]);
 assert(r.distanceMeters>170&&r.distanceMeters<190);assert.equal(r.cyclingValidity,'unvalidated');
 assert.deepEqual(input,before);assert.deepEqual(graph,snapshot);
});
test('geometric crossing and close parallel endpoints never create a graph junction',()=>{
 const graph=buildCandidateGraph(source([way(1,[1,2],[[51,6.999],[51,7.001]]),way(2,[3,4],[[50.999,7],[51.001,7]])]));
 const r=findRecovery(graph,request(1));assert.equal(r.status,'unavailable');assert.equal(r.reason,'unreachable');
 assert.equal(r.distanceMeters,null);assert.deepEqual(r.nodes,[]);
});
test('conflicting original coordinates quarantine affected ways instead of arbitrary merging',()=>{
 const graph=buildCandidateGraph(source([way(10,[1,2],[a,b]),way(20,[2,3],[d,c])]));
 assert.equal(graph.edges.length,0);assert(graph.issues.some(i=>i.code==='conflicting-node'));
});
test('bicycle direction overrides and reverse one-way are respected',()=>{
 for(const [tags,forward,backward] of [[{oneway:'yes'},true,false],[{oneway:'-1'},false,true],[{oneway:'yes','oneway:bicycle':'no'},true,true],[{junction:'roundabout'},true,false]]){
  const g=buildCandidateGraph(source([way(10,[1,2,3],[a,b,c],tags)]));
  assert.equal(findRecovery(g,request(1)).status==='candidate',forward);
  assert.equal(findRecovery(g,request(3,[{node:1,visit:1}])).status==='candidate',backward);
 }
});
test('denied, conditional, unsupported and unknown access never become candidate legs',()=>{
 for(const tags of [{bicycle:'no'},{access:'private'},{vehicle:'no'},{'bicycle:conditional':'yes @ (Mo-Fr)'},{'bicycle:forward':'yes'},{oneway:'unknown'},{highway:'motorway'},{highway:'steps'},{highway:'footway'},{access:'destination'}]){
  const g=buildCandidateGraph(source([way(10,[1,2,3],[a,b,c],tags)]));
  assert.equal(g.edges.length,0,JSON.stringify(tags));assert.equal(g.excluded.length,1);
 }
 const g=buildCandidateGraph(source([way(10,[1,2,3],[a,b,c],{access:'private',bicycle:'yes'})]));
 assert.equal(findRecovery(g,request(1)).status,'candidate');
});
test('target visit window excludes a nearby finish and chooses an explicit future visit',()=>{
 const g=chain(),targets=[{node:1,visit:0},{node:2,visit:2},{node:1,visit:99}];
 const r=findRecovery(g,request(1,targets));assert.equal(r.target.visit,2);assert.deepEqual(r.nodes,[1,2]);
 assert.equal(findRecovery(g,request(1,targets,{afterVisit:2})).reason,'no-forward-target');
 const repeat=findRecovery(g,request(3,[{node:1,visit:0},{node:1,visit:3}]));assert.equal(repeat.target.visit,3);
});
test('bounded work returns unavailable and never leaks a tentative path',()=>{
 const r=findRecovery(chain(),request(1,undefined,{maxSettled:1}));
 assert.equal(r.reason,'work-limit');assert.equal(r.settledNodes,1);assert.equal(r.distanceMeters,null);assert.deepEqual(r.nodes,[]);
 assert.equal(findRecovery(chain(),request(1,undefined,{maxDistanceMeters:10})).reason,'distance-limit');
 assert.equal(findRecovery(chain(),request(1,undefined,{maxPathNodes:2})).reason,'path-limit');
});
test('Dijkstra chooses the shorter complete path rather than the first discovered target',()=>{
 const g=buildCandidateGraph(source([way(1,[1,4,3],[a,[51.01,7.001],c]),way(2,[1,2,3],[a,b,c])]));
 const r=findRecovery(g,request(1));assert.deepEqual(r.nodes,[1,2,3]);assert.deepEqual(r.ways,[2,2]);
});
test('reports count sampled origins per radius, actual representation bytes and missing evidence',()=>{
 const input={source:source([way(10,[1,2,3],[a,b,c])]),origins:[1,2,999],targets:[{node:3,visit:1}],afterVisit:0,throughVisit:5};
 const r=evaluateRecovery(input);assert.deepEqual(r,evaluateRecovery(structuredClone(input)));
 assert.equal(r.origins.length,3);assert.equal(r.origins[2].reason,'unknown-origin');
 assert.equal(r.rings[0].sampledOrigins,2);assert.equal(r.rings[0].candidatePaths,2);
 assert.equal(r.representations.displayOnly.recoveryPaths,0);
 assert.equal(r.representations.graph.jsonBytes,Buffer.byteLength(JSON.stringify(r.graph)));
 assert.equal(r.representations.legs.jsonBytes,Buffer.byteLength(JSON.stringify(r.origins.filter(x=>x.status==='candidate'))));
 assert.equal(r.targetAcceptance,'unvalidated');assert.equal(r.decodedTargetMemoryBytes,null);
 assert(r.gaps.includes('barrier-node-tags-not-preserved'));assert(r.gaps.includes('turn-restrictions-not-preserved'));
});
test('legacy and incomplete source remain visible without pretending display lines are routable',()=>{
 const r=evaluateRecovery({origins:[1],targets:[{node:3,visit:1}],afterVisit:0,throughVisit:5});
 assert.equal(r.graph.nodes.length,0);assert(r.gaps.includes('missing-cell-source'));assert.equal(r.origins[0].status,'unavailable');
 const s=source([way(10,[1,2,3],[a,b,c])]);s.complete=false;
 assert(buildCandidateGraph(s).issues.some(i=>i.code==='incomplete-cell-source'));
});
test('invalid limits, visits and origin lists fail explicitly',()=>{
 assert.throws(()=>findRecovery(chain(),request(1,undefined,{maxSettled:0})),/maxSettled/);
 assert.throws(()=>findRecovery(chain(),request(1,undefined,{throughVisit:-1})),/visit/i);
 assert.throws(()=>findRecovery(chain(),request(1,[{node:3,visit:NaN}])),/target/i);
 assert.throws(()=>evaluateRecovery({source:source([]),origins:[1,1],targets:[],afterVisit:0,throughVisit:1}),/duplicate/i);
});

test('edge and queue caps bound high-degree search and return no tentative result',()=>{
 const g=buildCandidateGraph(source([way(10,[1,2],[a,b]),way(20,[1,4],[a,d]),way(30,[2,3],[b,c])]));
 assert.equal(findRecovery(g,request(1,undefined,{maxRelaxed:1})).reason,'edge-limit');
 assert.equal(findRecovery(g,request(1,undefined,{maxQueue:1})).reason,'queue-limit');
});
test('permuting source ways and target order produces an identical study',()=>{
 const input={source:source([way(20,[2,4],[b,d]),way(10,[1,2,3],[a,b,c])]),origins:[1,4],targets:[{node:3,visit:3},{node:2,visit:2}],afterVisit:0,throughVisit:5};
 const before=evaluateRecovery(input);input.source.ways.reverse();input.targets.reverse();assert.deepEqual(evaluateRecovery(input),before);
});
test('CLI refuses overwrite and cache audit distinguishes legacy, source and corrupt inputs',async()=>{
 const {mkdtempSync,writeFileSync,readFileSync,mkdirSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {spawnSync}=await import('node:child_process');
 const dir=mkdtempSync(join(tmpdir(),'cc700-recovery-'));
 try{
  const cache=join(dir,'cache');mkdirSync(cache);
  writeFileSync(join(cache,'1,1.json'),JSON.stringify({lines:[]}));
  writeFileSync(join(cache,'1,2.json'),JSON.stringify({navigationSource:source([way(10,[1,2],[a,b])])}));
  writeFileSync(join(cache,'1,3.json'),'{');writeFileSync(join(cache,'n1,1.json'),'{}');
  const args=['tools/recovery_study.mjs','--cache',cache,'--output',join(dir,'audit')];
  const run=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const file=join(dir,'audit','report.json'),before=readFileSync(file,'utf8'),r=JSON.parse(before);
  assert.equal(r.files,3);assert.equal(r.legacyDisplayOnly,1);assert.equal(r.withOriginalSource,1);assert.equal(r.invalid,1);
  assert.match(r.sourceSha256,/^[a-f0-9]{64}$/);
  assert.notEqual(spawnSync(process.execPath,args).status,0);assert.equal(readFileSync(file,'utf8'),before);
  const input=join(dir,'study.json');writeFileSync(input,JSON.stringify({source:source([way(10,[1,2,3],[a,b,c])]),origins:[1],targets:[{node:3,visit:1}],afterVisit:0,throughVisit:5}));
  const study=spawnSync(process.execPath,['tools/recovery_study.mjs','--input',input,'--output',join(dir,'study')],{encoding:'utf8'});
  assert.equal(study.status,0,study.stderr);assert.equal(JSON.parse(readFileSync(join(dir,'study','report.json'))).origins[0].status,'candidate');
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('urban, village and forest examples find all connected samples and reject the nearby island',async()=>{
 const {recoveryCases,recoverySummary}=await import('./recovery_study_cases.mjs');
 for(const c of recoveryCases()){
  const r=recoverySummary(c);assert.equal(r.candidatePaths,12,c.id);assert.equal(r.unavailable.length,1,c.id);
  assert.equal(r.unavailable[0].reason,'unreachable',c.id);assert.equal(r.rings[2].sampledOrigins,13,c.id);
  assert(r.rings.every(b=>b.validatedCyclingPaths===0));assert(r.maxSettledNodes<=4096);assert(r.maxRelaxedEdges<=32768);
 }
});
