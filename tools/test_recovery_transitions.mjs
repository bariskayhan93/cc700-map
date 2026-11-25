import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureRoutingSnapshot } from './routing_snapshot.mjs';
import { findRecovery } from './recovery_study.mjs';
import { buildTransitionGraph } from './recovery_transitions.mjs';
const node=(id,tags={})=>({type:'node',id,lat:51+(id%2)*.001,lon:7+id*.001,tags});
const way=(id,nodes,tags={})=>({type:'way',id,nodes,tags:{highway:'residential',...tags}});
const rel=(id,from,via,to,tags={})=>({type:'relation',id,tags:{type:'restriction',restriction:'no_left_turn',...tags},members:[{type:'way',ref:from,role:'from'},{type:'node',ref:via,role:'via'},{type:'way',ref:to,role:'to'}]});
const snapshot=elements=>captureRoutingSnapshot({elements,osm3s:{timestamp_osm_base:'2026-11-14T00:00:00Z'}},{bbox:[50.99,6.99,51.03,7.03],querySha256:'a'.repeat(64)});
const graph=els=>buildTransitionGraph(snapshot(els));
const req=(origin,target,more={})=>({origin,targets:[{node:target,visit:2}],afterVisit:0,throughVisit:2,...more});
const junction=()=>[...[1,2,3,4].map(n=>node(n)),way(10,[1,2]),way(20,[2,3]),way(30,[2,4])];

test('barrier cuts preserve distant segments of the same way and do not mutate source',()=>{
 const s=snapshot([node(1),node(2),node(3,{barrier:'gate'}),node(4),node(5),way(10,[1,2,3,4,5])]),before=structuredClone(s),g=buildTransitionGraph(s);
 assert.equal(findRecovery(g,req(1,2)).status,'candidate');
 assert.equal(findRecovery(g,req(1,5)).reason,'unreachable');
 assert.equal(findRecovery(g,req(4,5)).status,'candidate');
 assert(!g.edges.some(e=>e.from===3||e.to===3));assert.deepEqual(s,before);
});
test('node access is enforced even without a barrier, conditional and uncertain barriers remain blocked',()=>{
 for(const tags of [{bicycle:'no'},{access:'private'},{barrier:'gate','bicycle:conditional':'yes @ (Mo-Fr)'},{barrier:'unfamiliar',bicycle:'yes'},{barrier:'gate',bicycle:'dismount'}]) {
  const g=graph([node(1),node(2,tags),node(3),way(10,[1,2,3])]);
  assert.equal(findRecovery(g,req(1,3)).status,'unavailable',JSON.stringify(tags));
 }
 const g=graph([node(1),node(2,{barrier:'bollard',access:'no',bicycle:'yes'}),node(3),way(10,[1,2,3])]);
 assert.equal(findRecovery(g,req(1,3)).status,'candidate');
});
test('no turn forbids only the specified incoming-way transition, not unrelated road segments',()=>{
 const g=graph([...junction(),rel(100,10,2,20)]);
 assert.equal(findRecovery(g,req(1,3)).status,'unavailable');
 assert.equal(findRecovery(g,req(4,3)).status,'candidate');
 assert.equal(findRecovery(g,req(1,4)).status,'candidate');
 assert.equal(findRecovery(g,req(2,3)).reason,'origin-incoming-edge-required');
});
test('only turn forbids other exits, including reversal, while allowing its destination',()=>{
 const g=graph([...junction(),rel(100,10,2,20,{restriction:'only_right_turn'})]);
 assert.equal(findRecovery(g,req(1,3)).status,'candidate');
 // Dead end on 20 cannot launder the restriction by turning around mid-road.
 assert.equal(findRecovery(g,req(1,4)).status,'unavailable');
});
test('same-way no U-turn permits continuation but blocks immediate reversal',()=>{
 const g=graph([node(1),node(2),node(3),node(4),way(10,[1,2,3]),way(20,[2,4]),rel(100,10,2,10,{restriction:'no_u_turn'})]);
 assert.equal(findRecovery(g,req(1,3)).status,'candidate');
 assert(g.turnRules.some(r=>r.kind==='no_u_turn'));
});
test('bicycle exception and explicit bicycle restriction have correct precedence',()=>{
 const exempt=graph([...junction(),rel(100,10,2,20,{except:'bus;bicycle'})]);
 assert.equal(findRecovery(exempt,req(1,3)).status,'candidate');
 const specific=graph([...junction(),rel(100,10,2,20,{except:'bicycle','restriction:bicycle':'no_right_turn'})]);
 assert.equal(findRecovery(specific,req(1,3)).status,'unavailable');
});
test('conditional, via-way and malformed restrictions preserve quarantine, incomplete input fails closed',()=>{
 for(const tags of [{'restriction:conditional':'no_left_turn @ (Mo-Fr)'},{restriction:'unrecognized'},{day_on:'Monday'}]) {
  const g=graph([...junction(),rel(100,10,2,20,tags)]);
  assert(g.excluded.some(e=>e.way===10&&e.reason==='unsupported-restriction-member'));
  assert.equal(findRecovery(g,req(1,3)).status,'unavailable');
 }
 const els=[...junction(),rel(100,10,2,20)];els.at(-1).members[1]={type:'way',ref:30,role:'via'};
 assert.equal(graph(els).turnRules.length,0);assert(graph(els).excluded.some(e=>e.way===30));
 const s=snapshot(junction());s.integrity='incomplete';s.issues=[{code:'missing-way-node'}];
 assert.equal(buildTransitionGraph(s).edges.length,0);
});
test('incoming-edge search retains a longer legal arrival and rejects artificial same-edge reversals',()=>{
 const g=graph([...[1,2,3,4,5].map(n=>node(n)),way(10,[1,2],{oneway:'yes'}),way(20,[2,3],{oneway:'yes'}),way(30,[1,4,5,2],{oneway:'yes'}),rel(100,10,2,20)]);
 const r=findRecovery(g,req(1,3));assert.equal(r.status,'candidate');assert.deepEqual(r.nodes,[1,4,5,2,3]);
});
test('transition search remains bounded, deterministic, and never returns tentative geometry',()=>{
 const els=[...junction(),rel(100,10,2,20)],g=graph(els);
 const r=findRecovery(g,req(1,4,{maxSettled:1}));assert.equal(r.reason,'work-limit');assert.deepEqual(r.geometry,[]);assert.equal(r.distanceMeters,null);
 assert.equal(findRecovery(g,req(1,4,{maxRelaxed:1})).reason,'edge-limit');
 assert.deepEqual(graph([...els].reverse()),g);
 assert.equal(g.cyclingValidity,'unvalidated');
});

test('same-way U-turn transitions distinguish reversal from continuing on the same road',async()=>{
 const {transitionAllowed}=await import('./recovery_study.mjs');
 const incoming={from:1,to:2,way:10},reverse={from:2,to:1,way:10},straight={from:2,to:3,way:10};
 const no=[{fromWay:10,via:2,toWay:10,kind:'no_u_turn'}];
 assert.equal(transitionAllowed(no,incoming,straight),true);assert.equal(transitionAllowed(no,incoming,reverse),false);
 const only=[{...no[0],kind:'only_u_turn'}];
 assert.equal(transitionAllowed(only,incoming,straight),false);assert.equal(transitionAllowed(only,incoming,reverse),true);
});
test('ambiguous same-way turns, interior via and missing restriction value stay quarantined',()=>{
 for(const tags of [{restriction:'no_straight_on'},{restriction:undefined}]){
  const els=[node(1),node(2),node(3),way(10,[1,2,3]),rel(100,10,2,10,tags)];
  if(tags.restriction===undefined)delete els.at(-1).tags.restriction;
  assert(graph(els).excluded.some(e=>e.reason==='unsupported-restriction-member'));
 }
 const g=graph([node(1),node(2),node(3),node(4),way(10,[1,2,3]),way(20,[2,4]),rel(100,10,2,20)]);
 assert(g.excluded.some(e=>e.way===10));
});

test('an unsupported scoped restriction cannot hide behind a generic rule or bicycle exception',()=>{
 for(const tags of [
  {'restriction:vehicle':'only_straight_on'},
  {'restriction:vehicle':'only_straight_on',except:'bicycle'},
  {'restriction:vehicle':'only_straight_on','restriction:bicycle':'no_right_turn'}]){
  const g=graph([...junction(),rel(100,10,2,20,tags)]);
  assert(g.excluded.some(e=>e.way===10&&e.reason==='unsupported-restriction-member'));
  assert.equal(findRecovery(g,req(1,4)).status,'unavailable');
 }
 const g=graph([...junction(),rel(100,10,2,20,{'restriction:hgv':'only_straight_on'})]);
 assert(g.turnRules.length===1); // hgv-only scope does not override the generic bicycle rule
});

test('way-back keep option: an unsupported restriction leaves its ways in the graph and stays in the audit as a gap',()=>{
 // 25 Nov: a no_entry with two from-ways removed both Burscheider Straße pieces from the N3 way-back data (detour line).
 const els=[...junction(),node(5),way(40,[5,2]),{...rel(100,10,2,20,{restriction:'no_entry'}),members:[{type:'way',ref:10,role:'from'},{type:'way',ref:40,role:'from'},{type:'node',ref:2,role:'via'},{type:'way',ref:20,role:'to'}]}];
 const strict=graph(els);
 assert(strict.excluded.some(e=>e.way===10&&e.reason==='unsupported-restriction-member'));
 const kept=buildTransitionGraph(snapshot(els),{unsupportedRestrictions:'keep'});
 assert(!kept.excluded.some(e=>e.reason==='unsupported-restriction-member'));
 for(const w of [10,20,40])assert(kept.edges.some(e=>e.way===w),`way ${w} has edges`);
 assert(kept.restrictionAudit.some(a=>a.id===100&&a.status==='unsupported-ignored'));
 assert.equal(kept.turnRules.length,0);
});
