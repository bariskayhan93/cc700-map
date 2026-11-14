import assert from 'node:assert/strict';
import {test} from 'node:test';
import {fu,fs,fb} from '../js/pb.js';
import {estimateBlock,budgetFailures,transitionPeak,MAP_BUDGET,auditMapSection} from '../js/map_budget.js';
import {buildStyledSection} from '../js/mapsec.js';
import {frame} from '../js/geo.js';
const entry=(style,n)=>[...fu(2,style),...fs(3,0),...fs(4,0),...fu(5,n),...Array.from({length:n},(_,i)=>fb(6,[...fs(1,i),...fs(2,i)])).flat()];
test('serialized bytes include record prefix, entry IDs and protobuf length boundaries',()=>{
 const es=Array.from({length:131},()=>entry(32|6,9));
 const encoded=[...fu(1,es.length),...es.flatMap((e,i)=>fb(2,[...fu(1,i),...e]))];
 const c=estimateBlock(es);
 assert.equal(c.serializedBytes,encoded.length+4);
 assert.equal(c.decodedBytes,28*131+8*9*131);
 assert.equal(estimateBlock([]).serializedBytes,9); // stock-compatible empty block encoding
});
test('cased roads cost two projections while equally numerous waterways cost one',()=>{
 const c=estimateBlock([entry(32|5,4),entry(32|6,9)]);
 assert.equal(c.projectionCalls,4);assert.equal(c.projectedPoints,30);
 assert.equal(c.iteratorScratchBytes,80);assert.equal(c.projectionScratchBytes,40);
 assert.equal(estimateBlock([entry(32|4,4),entry(32|4,9)]).projectionCalls,2);
});
test('areas include fill/outline passes and labels project only their anchor',()=>{
 const c=estimateBlock([entry(32|2,4),entry(32|3|0x400,5),entry(32|12,3)]);
 assert.equal(c.projectionCalls,4);assert.equal(c.projectedPoints,17);
 assert.equal(c.fillVertices,11);assert.equal(c.fillEdgeChecksUpper,11*256);
 assert.equal(c.labelBytes,24);
});
test('bridge bases and route overlays participate before admission',()=>{
 const c=estimateBlock([entry(32|8|0x80,3),entry(32|15,24)]);
 assert.equal(c.overlayEntries,1);assert.equal(c.iteratorScratchBytes,200);
 assert.equal(c.projectionCalls,5);assert.equal(c.projectedPoints,12+50);
});
test('more than 1200 cheap entries can fit without relaxing memory or work ceilings',()=>{
 const c=estimateBlock(Array.from({length:1250},()=>entry(32|4,1)));
 assert.deepEqual(budgetFailures(c),[]);
 assert(c.decodedBytes<MAP_BUDGET.decodedBytes);
});
test('complexity, label and scratch constraints cannot compensate for each other',()=>{
 assert(budgetFailures(estimateBlock([entry(32|2,2500)])).includes('fillVertices'));
 assert(budgetFailures(estimateBlock([entry(32|12,60)])).includes('labelBytes'));
 assert(budgetFailures(estimateBlock([entry(32|4,600)])).includes('iteratorScratchBytes'));
});
test('transition budget covers nonadjacent blocks with asymmetric allocations',()=>{
 const a={decodedBytes:50000,serializedBytes:20000},b={decodedBytes:1000,serializedBytes:64000};
 assert.equal(transitionPeak([a,b]),122880+50000+64000);
 assert.equal(transitionPeak([]),122880);
});
test('invalid costs and invalid limits fail closed',()=>{
 assert.throws(()=>estimateBlock([[...fu(2,36),...fu(5,1)]]));
 assert.throws(()=>budgetFailures(estimateBlock([]),{...MAP_BUDGET,decodedBytes:NaN}));
 assert.throws(()=>budgetFailures({...estimateBlock([]),decodedBytes:NaN}));
});
test('encoded section audit recomputes costs independently of generator reports',()=>{
 const F=frame(0),p=y=>[...F.g(0,y),y*100];
 const r=buildStyledSection([[p(0),p(100)]],{wlines:[[F.g(10,0),F.g(10,100)]],opt:{names:false}},F);
 const costs=auditMapSection(r.bytes);
 assert.deepEqual(costs,r.stat.blocks.map(b=>b.cost));
 const corrupt=r.bytes.slice();new DataView(corrupt.buffer).setUint32(0,corrupt.length+1,true);
 assert.throws(()=>auditMapSection(corrupt),/map section/i);
});
