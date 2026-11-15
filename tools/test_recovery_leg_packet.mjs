import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeStudyLeg} from './recovery_leg_packet.mjs';
const leg=()=>({status:'candidate',target:{visit:12345},distanceMeters:42.56,geometry:[[51,7],[51.001,7.002]]});
test('proposed leg packet contains actual E7 geometry and explicit unvalidated flag',()=>{
 const b=encodeStudyLeg(leg());assert.equal(b.length,36);assert.equal(b.toString('ascii',0,4),'CCRL');
 assert.equal(b.readUInt16LE(4),1);assert.equal(b.readUInt16LE(6),2);assert.equal(b.readUInt32LE(8),12345);
 assert.equal(b.readUInt32LE(12),4256);assert.equal(b.readUInt32LE(16),1);
 assert.equal(b.readInt32LE(20),510000000);assert.equal(b.readInt32LE(24),70000000);
 assert.equal(b.readInt32LE(28),510010000);assert.equal(b.readInt32LE(32),70020000);
});
test('packet refuses unavailable, invalid and over-limit legs without truncation',()=>{
 for(const patch of [{status:'unavailable'},{geometry:[]},{geometry:[[NaN,7]]},{geometry:[[91,0]]},{geometry:Array(2049).fill([51,7])},
  {target:{visit:2**32}},{distanceMeters:Infinity},{distanceMeters:2**32}])assert.throws(()=>encodeStudyLeg({...leg(),...patch}));
 assert.equal(encodeStudyLeg({...leg(),geometry:Array(2048).fill([51,7])}).length,16404);
});
