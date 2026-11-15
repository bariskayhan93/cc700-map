import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SegmentIndex,associateSegment} from './recovery_association.mjs';
import {planRecovery,buildRouteVisits,readNativeRoute} from './recovery_planner.mjs';
import {buildCandidateGraph,findRecovery} from './recovery_study.mjs';
const p=x=>[51,7+x/70000];
const source=tags=>({version:1,complete:true,issues:[],ways:[{id:10,nodes:[1,2,3],pts:[p(0),p(100),p(200)],tags:{highway:'residential',...tags}}]});
const setup=(tags={})=>{const s=source(tags),g={...buildCandidateGraph(s),turnRules:[]},i=new SegmentIndex(s.ways);return {g,i};};
const visit=(i,x,progress,bearing=90)=>({progress,association:associateSegment(i,p(x),{heading:bearing}),bearing});
test('projected endpoint splits preserve original road, directed arrival and exact network distance',()=>{
 const {g,i}=setup(),before=structuredClone(g),a=associateSegment(i,p(20),{heading:90});
 const r=planRecovery(g,a,[visit(i,150,1000)],{afterVisit:0,throughVisit:2000,heading:90});
 assert.equal(r.status,'candidate');assert(r.distanceMeters>129&&r.distanceMeters<131);
 assert.deepEqual(r.geometry[0],a.point);assert.equal(r.target.visit,1000);assert.deepEqual(g,before);
 assert.equal(r.associationValidity,'geometric-only-unvalidated');
});
test('one-way and denied origin edges cannot be replaced by nearby admitted roads',()=>{
 const {g,i}=setup({oneway:'yes'}),a=associateSegment(i,p(150),{heading:270});
 assert.equal(planRecovery(g,a,[visit(i,20,1000,270)],{afterVisit:0,throughVisit:2000,heading:270}).status,'unavailable');
 assert.equal(planRecovery({...g,edges:[]},a,[visit(i,180,1000)],{afterVisit:0,throughVisit:2000}).reason,'origin-edge-not-admitted');
});
test('forward route visits and route continuation direction remain distinct at repeated positions',()=>{
 const {g,i}=setup({oneway:'yes'}),a=associateSegment(i,p(20),{heading:90});
 const visits=[visit(i,150,100,270),visit(i,150,9000,90),visit(i,180,1500,90)];
 const r=planRecovery(g,a,visits,{afterVisit:100,throughVisit:2000,heading:90});assert.equal(r.target.visit,1500);
 assert.equal(planRecovery(g,a,[visit(i,150,1500,270)],{afterVisit:100,throughVisit:2000,heading:90}).status,'unavailable');
});
test('same-segment cuts do not manufacture junctions or immediate reversal loopholes',()=>{
 const {g,i}=setup(),a=associateSegment(i,p(20),{heading:90});
 const r=planRecovery(g,a,[visit(i,60,1000)],{afterVisit:0,throughVisit:2000,heading:90});assert.equal(r.status,'candidate');assert(r.distanceMeters<41);
 assert.equal(planRecovery(g,a,[visit(i,10,1000)],{afterVisit:0,throughVisit:2000,heading:90}).status,'unavailable');
 const fail=planRecovery(g,{status:'ambiguous',reason:'competing-source-segments'},[],{afterVisit:0,throughVisit:2});assert.equal(fail.status,'unavailable');assert.deepEqual(fail.geometry,[]);
});
test('route visits are ordered, bounded and preserve native progress instead of nearest finish',()=>{
 const {i}=setup();const route=[{point:p(0),progress:0},{point:p(200),progress:20000}];
 const visits=buildRouteVisits(route,i,{spacing:50});assert.deepEqual(visits.map(v=>v.progress),[0,5000,10000,15000,20000]);
 assert.equal(visits[1].association.status,'associated');
 assert.throws(()=>buildRouteVisits([...route].reverse(),i),/ordered/);
 assert.throws(()=>readNativeRoute(new Uint8Array(12)),/size/);
});
test('target direction matching examines all visits at a shared node, not merely first visit',()=>{
 const {g}=setup();const r=findRecovery(g,{origin:1,targets:[{node:2,visit:1,arrivalFrom:[3]},{node:2,visit:2,arrivalFrom:[1]}],afterVisit:0,throughVisit:3});
 assert.equal(r.target.visit,2);assert.deepEqual(r.nodes,[1,2]);
});
test('an exact original network-node origin preserves junction restrictions instead of virtual bypass',()=>{
 const {g,i}=setup();assert.equal(planRecovery(g,{status:'network-node',node:1},[visit(i,150,1000)],{afterVisit:0,throughVisit:2000}).status,'candidate');
 const restricted={...g,turnRules:[{id:1,via:1,fromWay:10,toWay:10,kind:'no_u_turn'}]};
 assert.equal(planRecovery(restricted,{status:'network-node',node:1},[visit(i,150,1000)],{afterVisit:0,throughVisit:2000}).reason,'origin-incoming-edge-required');
});
test('native route decoder reads real field identities and rejects duplicates and nonmonotonic progress',async()=>{
 const {fs,fu,fb,sc,u32le}=await import('../js/pb.js');
 const fixture=(rows)=>{const section=rows.flatMap(r=>fb(3,[...fs(1,sc(51)),...fs(2,sc(7+r.x/70000)),...fu(5,r.progress),...(r.duplicate?fu(1,0):[])]));
  const b=new Uint8Array(132+section.length);new DataView(b.buffer).setUint16(0x46,1,true);b.set(u32le(section.length),128);b.set(section,132);return b;};
 const b=fixture([{x:0,progress:0},{x:100,progress:10000}]);assert.equal(readNativeRoute(b).length,2);
 assert.throws(()=>readNativeRoute(fixture([{x:0,progress:10000},{x:100,progress:0}])));
 assert.throws(()=>readNativeRoute(fixture([{x:0,progress:0,duplicate:true},{x:100,progress:10000}])));
 assert.throws(()=>readNativeRoute(b.subarray(0,b.length-1)));
});
