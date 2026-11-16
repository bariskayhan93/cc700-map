import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeGraphPacket,decodeGraphPacket,encodeLegLookup} from './recovery_graph_packet.mjs';
import {findRecovery} from './recovery_study.mjs';
const graph=()=>({nodes:[{id:50,point:[51,7]},{id:60,point:[51,7.001]},{id:70,point:[51.001,7.001]}],edges:[{from:50,to:60,way:90,meters:70.123},{from:60,to:70,way:100,meters:111.127}],turnRules:[{id:1,via:60,fromWay:90,toWay:100,kind:'no_left_turn'}]});
test('actual CSR packet round-trips connectivity, coordinates, metric lengths and turn denial',()=>{
 const g=graph(),{packet,nodeIndex}=encodeGraphPacket(g),decoded=decodeGraphPacket(packet);
 assert.equal(packet.length,112);assert.equal(decoded.nodes.length,3);assert.equal(decoded.edges.length,2);
 assert.equal(decoded.edges[0].meters,70.12);assert.deepEqual(decoded.nodes[0].point,g.nodes[0].point);
 assert.equal(nodeIndex.get(50),0);
 const request={origin:1,targets:[{node:3,visit:1}],afterVisit:0,throughVisit:1};
 assert.equal(findRecovery(decoded,request).status,'unavailable');
 decoded.turnRules=[];assert.equal(findRecovery(decoded,request).status,'candidate');
});
test('graph packet refuses malformed counts, adjacency, tags and source coordinates',()=>{
 const b=encodeGraphPacket(graph()).packet;
 assert.throws(()=>decodeGraphPacket(b.subarray(0,b.length-1)));
 const bad=Buffer.from(b);bad.writeUInt32LE(99,32+8);assert.throws(()=>decodeGraphPacket(bad),/offset/);
 assert.throws(()=>encodeGraphPacket({...graph(),nodes:[{id:50,point:[91,0]}]}));
 assert.throws(()=>encodeGraphPacket({...graph(),turnRules:[{id:2,via:60,fromWay:90,toWay:100,kind:'unknown'}]}));
});
test('precomputed lookup serializes exact-origin windows and offsets and marks coverage unvalidated',()=>{
 const b=encodeLegLookup([{point:[51,7],afterVisit:100,throughVisit:300100,heading:null,offset:0,length:44}]);
 assert.equal(b.length,48);assert.equal(b.toString('ascii',0,4),'CCRX');assert.equal(b.readUInt32LE(8),1);
 assert.equal(b.readUInt16LE(42),0); // zero spatial tolerance: no claimed area coverage
 assert.throws(()=>encodeLegLookup([{point:[NaN,7]}]));
});
test('visit index accounts ordered progress, source edge fraction and permitted continuation',async()=>{
 const {encodeVisitIndex}=await import('./recovery_graph_packet.mjs');
 const g=graph(),packed=encodeGraphPacket(g),association={status:'associated',t:.5,segment:{way:90,from:50,to:60,bearing:90}};
 const b=encodeVisitIndex([{progress:10000,bearing:90,association},{progress:20000,bearing:270,association}],g,packed);
 assert.equal(b.length,40);assert.equal(b.readUInt32LE(8),1);assert.equal(b.readUInt32LE(16),10000);
 assert.equal(b.readUInt32LE(32),Math.round(.5*0xffffffff));
});
test('association packet keeps denied source geometry and null routing references',async()=>{
 const {encodeAssociationIndex}=await import('./recovery_graph_packet.mjs');const {SegmentIndex}=await import('./recovery_association.mjs');
 const g=graph(),packed=encodeGraphPacket(g),index=new SegmentIndex([
  {id:90,nodes:[50,60],pts:[[51,7],[51,7.001]],tags:{highway:'residential'}},
  {id:200,nodes:[80,90],pts:[[51.00003,7],[51.00003,7.001]],tags:{highway:'footway'}}]);
 const b=encodeAssociationIndex(index,g,packed);assert.equal(b.toString('ascii',0,4),'CCRA');assert.equal(b.readUInt32LE(12),2);
 const rows=32+8*4;assert.equal(b.readUInt32LE(rows+8),0);assert.equal(b.readUInt32LE(rows+20+8),0xffffffff);
 assert(b.length>32+32+40); // cell and segment-reference bytes included
});
test('city village and forest controls preserve all candidate and island outcomes after codec round-trip',async()=>{
 const {recoveryCases}=await import('./recovery_study_cases.mjs'),{buildCandidateGraph}=await import('./recovery_study.mjs');
 for(const fixture of recoveryCases()){
  const g={...buildCandidateGraph(fixture.input.source),turnRules:[]},packed=encodeGraphPacket(g),decoded=decodeGraphPacket(packed.packet);
  let candidate=0,unavailable=0;
  for(const origin of fixture.input.origins){
   const original=findRecovery(g,{...fixture.input,origin}),result=findRecovery(decoded,{...fixture.input,origin:packed.nodeIndex.get(origin)+1,targets:fixture.input.targets.map(t=>({...t,node:packed.nodeIndex.get(t.node)+1}))});
   assert.equal(result.status,original.status,fixture.id);if(result.status==='candidate')candidate++;else unavailable++;
  }
  assert.equal(candidate,12,fixture.id);assert.equal(unavailable,1,fixture.id);
 }
});
