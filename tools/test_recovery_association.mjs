import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SegmentIndex,projectSegment,associateSegment} from './recovery_association.mjs';
import {nrwFirmPathPolicy} from './recovery_access.mjs';
const pt=(x,y)=>[51+y/111320,7+x/(111320*Math.cos(51*Math.PI/180))];
const way=(id,nodes,points,tags={})=>({id,nodes,pts:points.map(p=>pt(...p)),tags:{highway:'residential',...tags}});
test('projection finds the middle of sparse original road without hopping to nearby steps nodes',()=>{
 const ways=[way(10,[1,2],[[-100,0],[100,0]]),way(20,[3,4],[[0,8],[0,20]],{highway:'steps'})];
 const index=new SegmentIndex(ways),r=associateSegment(index,pt(0,1));assert.equal(r.status,'associated');assert.equal(r.segment.way,10);assert(Math.abs(r.t-.5)<.001);
 assert(projectSegment(pt(0,10),pt(-100,0),pt(100,0)).distanceMeters>9);
});
test('nearby disconnected parallel roads stay ambiguous even if one would be denied',()=>{
 const i=new SegmentIndex([way(10,[1,2],[[-100,0],[100,0]],{bicycle:'no'}),way(20,[3,4],[[-100,4],[100,4]])]);
 assert.equal(associateSegment(i,pt(0,1),{heading:90}).reason,'competing-source-segments');
});
test('crossings use reliable bearing but retain unknown-heading and endpoint uncertainty',()=>{
 const i=new SegmentIndex([way(10,[1,2],[[-100,0],[100,0]]),way(20,[3,4],[[0,-100],[0,100]],{bridge:'yes',layer:'1'})]);
 assert.equal(associateSegment(i,pt(0,0)).status,'ambiguous');
 assert.equal(associateSegment(i,pt(0,0),{heading:90}).segment.way,10);
 assert.equal(associateSegment(i,pt(100,0),{heading:90}).reason,'near-source-endpoint');
 assert.equal(associateSegment(i,pt(500,500)).reason,'outside-association-radius');
});
test('association indexes exact original segments deterministically and bounds work',()=>{
 const ways=[way(20,[3,4],[[0,-100],[0,100]]),way(10,[1,2],[[-100,0],[100,0]])],i=new SegmentIndex(ways);
 assert.deepEqual(associateSegment(i,pt(0,0)),associateSegment(new SegmentIndex([...ways].reverse()),pt(0,0)));
 assert.throws(()=>new SegmentIndex(ways,{maxSegments:1}),/limit/);
 assert.throws(()=>associateSegment(i,[NaN,0]),/point/);
 assert.throws(()=>associateSegment(i,pt(0,0),{heading:NaN}),/heading/);
 assert.throws(()=>i.near(pt(0,0),100000),/radius/);
});
test('NRW firm-path inference is explicit, conservative and cannot override denial',()=>{
 const p=nrwFirmPathPolicy({highway:'path',surface:'compacted'});assert.equal(p.inferredAccess,true);assert(p.forward&&p.backward);
 for(const tags of [{highway:'path',surface:'ground'},{highway:'footway',surface:'asphalt'},{highway:'steps',bicycle:'yes'},
  {highway:'track',surface:'asphalt',access:'private'},{highway:'path',surface:'gravel',bicycle:'no'},
  {highway:'path',surface:'gravel',foot:'designated'},{highway:'path',surface:'gravel','bicycle:conditional':'yes @ (Mo-Fr)'},
  {highway:'residential',motorroad:'yes'}])assert(nrwFirmPathPolicy(tags).reason,JSON.stringify(tags));
 assert.equal(nrwFirmPathPolicy({highway:'path',surface:'ground',bicycle:'yes'}).reason,undefined);
});
