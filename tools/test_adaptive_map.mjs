import assert from 'node:assert/strict';
import {test} from 'node:test';
import {frame} from '../js/geo.js';
import {parse,unzz,SC} from '../js/pb.js';
import {buildStyledSection} from '../js/mapsec.js';
import {estimateBlock,budgetFailures,transitionPeak,TRANSITION_BUDGET} from '../js/map_budget.js';
const F=frame(0),p=(x,y,d=y)=>[...F.g(x,y),d*100];
const sections=n=>Array.from({length:n},(_,i)=>Array.from({length:6},(_,j)=>p(0,i*500+j*100)));
function decode(result){
 const bytes=result.bytes,v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),base=4+v.getUint32(0,true),blocks=[];
 for(let o=base;o<bytes.length;){const len=v.getUint32(o,true),fs=parse(bytes.subarray(o+4,o+4+len));
  blocks.push(fs.filter(f=>f[0]===2).map(f=>Array.from(f[2]).slice(2))); // IDs <128 for small fixtures only
  o+=4+len;
 }return blocks;
}
const options=extra=>({names:false,arrows:false,...extra});
test('cheap styled blocks can exceed the old 1150/1200 entry gates',()=>{
 const wlines=Array.from({length:1250},(_,i)=>[p(10,i*.08),p(30,i*.08)]);
 const r=buildStyledSection(sections(1),{wlines,opt:options()},F);
 assert.equal(r.blocks,1);assert.equal(r.maxBlock,1250);
 assert.equal(r.stat.budgetVersion,'cc700-payload-work-v1');
 assert.deepEqual(budgetFailures(r.stat.blocks[0].cost),[]);
});
test('spare budget expands cycleways and water without changing geometry or styling',()=>{
 const source={kind:5,fl:32,name:'Outer cycleway',pts:[p(750,0),p(750,500)]};
 const r=buildStyledSection(sections(1),{lines:[source],wlines:[[p(850,0),p(850,500)]],opt:options()},F);
 assert.equal(r.stat.blocks[0].coverageFloor,1000);
 const entries=decode(r)[0],styles=entries.map(e=>parse(Uint8Array.from(e)).find(f=>f[0]===2)[2]);
 assert(styles.some(s=>(s&15)===10));assert(styles.some(s=>(s&15)===4));
 assert.equal(r.stat.omittedProtectedEntries,0);
 assert.deepEqual(source.pts,[p(750,0),p(750,500)]);
});
test('dense multi-section blocks split without dropping enabled baseline content',()=>{
 const wlines=Array.from({length:8},(_,i)=>[p(20,i*500+100),p(40,i*500+100)]);
 const r=buildStyledSection(sections(8),{wlines,opt:options({mapBudget:{projectionCalls:5}})},F);
 assert(r.blocks>2);
 for(const b of r.stat.blocks){assert(b.cost.projectionCalls<=5);assert.equal(b.omittedProtectedEntries,0);}
 assert(r.stat.blocks.some(b=>b.stoppedBy.includes('projectionCalls')));
});
test('single protected section exceeding budget fails explicitly instead of shrinking detail',()=>{
 const ring=Array.from({length:2400},(_,i)=>p(200*Math.cos(i*Math.PI/1200),200*Math.sin(i*Math.PI/1200)));
 assert.throws(()=>buildStyledSection(sections(1),{green:[[ring]],opt:options()},F),/section 1.*fillVertices/i);
});
test('arrow and rough-route entries cannot bypass the cost check',()=>{
 assert.throws(()=>buildStyledSection(sections(1),{turns:[0],opt:options({arrows:true,mapBudget:{projectionCalls:1}})},F),/projectionCalls/);
 assert.throws(()=>buildStyledSection(sections(1),{rough:[[0,40000]],opt:options({mapBudget:{projectionCalls:1}})},F),/projectionCalls/);
});
test('all transitions are bounded and output is deterministic for identical source',()=>{
 const lines=[0,100,200,750].map(x=>({kind:5,fl:32,pts:[p(x,0),p(x,4000)]}));
 const a=buildStyledSection(sections(8),{lines,opt:options()},F),b=buildStyledSection(sections(8),{lines:structuredClone(lines),opt:options()},F);
 assert.deepEqual(a.bytes,b.bytes);
 assert.equal(a.stat.transitionPeakBytes,transitionPeak(a.stat.blocks.map(b=>b.cost)));
 assert(a.stat.transitionPeakBytes<=TRANSITION_BUDGET);
});
test('a caller cannot silently increase the engineering resource limits',()=>{
 assert.throws(()=>buildStyledSection(sections(1),{opt:options({mapBudget:{decodedBytes:1e9}})},F),/increase.*budget/i);
});
test('dense single sections reduce distant context while retaining every near road at full resolution',()=>{
 const near=Array.from({length:40},(_,i)=>({kind:1,pts:[p(i,0),p(i+20,100),p(i,200)]}));
 const distant=Array.from({length:20},(_,i)=>({kind:1,pts:[p(650+i,0),p(650+i,200)]}));
 const r=buildStyledSection(sections(1),{lines:[...near,...distant],opt:options({mapBudget:{projectionCalls:100}})},F);
 const b=r.stat.blocks[0];assert.equal(b.contextRadiusCap,600);assert.equal(b.omittedProtectedEntries,0);
 assert.equal(b.cost.entries,40);assert.equal(b.cost.storedPairs,80);
 assert.equal(r.stat.minimumContextMeters,300);assert.equal(r.stat.reducedContextBlocks,1);
 assert(b.contextLimitedBy.includes('projectionCalls'));
});
test('content within the minimum context is protected even when pruning would fit',()=>{
 const near=Array.from({length:60},(_,i)=>({kind:1,pts:[p(i,0),p(i,200)]}));
 assert.throws(()=>buildStyledSection(sections(1),{lines:near,opt:options({mapBudget:{projectionCalls:100}})},F),/protected.*projectionCalls/);
});
test('dense context reduction preserves near polygon outlines and existing fill geometry',()=>{
 const data={green:[[[p(100,0),p(400,0),p(400,200),p(100,200)]]],lines:[{kind:1,pts:[p(340,0),p(340,200)]}],opt:options()};
 const a=buildStyledSection(sections(1),data,F),b=buildStyledSection(sections(1),{...data,opt:options({mapBudget:{projectionCalls:2}})},F);
 const area=r=>decode(r)[0].find(e=>(parse(Uint8Array.from(e)).find(f=>f[0]===2)[2]&15)===2);
 assert.equal(b.stat.blocks[0].contextRadiusCap,300);assert.deepEqual(area(b),area(a));
});
