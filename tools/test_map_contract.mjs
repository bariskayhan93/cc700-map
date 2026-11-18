import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildRoute} from '../js/route.js';
import {readFile} from '../js/preview.js';
import {auditMapSection} from '../js/map_budget.js';
import {encodeBlockD} from '../js/map_codec.js';
const origin=[51.2,6.8],at=(x,y)=>[origin[0]+y/111320,origin[1]+x/70000];
const route={name:'Contract',pts:Array.from({length:61},(_,i)=>[...at(0,i*50),0])};
const road=(name,x)=>({kind:3,name,pts:[at(x,-100),at(x,3200)]});
const make=lines=>readFile(buildRoute(route,lines,{id:'11120000',nameImage:()=>new Uint8Array(42),map:{styled:true,names:true},speedKmh:18}).file);
test('street anchor identity and priority are independent of source input ordering',()=>{
 const rows=[road('Zulu',70),road('Alpha',-70),road('Beta',230)];
 const labels=m=>[...new Set(m.blocks)].map(b=>b.filter(e=>(e.style&15)===12).map(e=>[e.label,e.center]));
 assert.deepEqual(labels(make(rows)),labels(make([...rows].reverse())));
});
test('blocks serialize each road class/level as a compact stable range',()=>{
 const rows=[road('A',50),{...road('bridge',70),fl:1},road('B',90)];
 for(const b of new Set(make(rows).blocks)) {
  const ids=b.map((e,i)=>[e,i]).filter(([e])=>(e.style&15)===6 && ((e.style>>>4)&7)===2).map(([,i])=>i);
  assert(ids.length>1);assert.equal(ids.at(-1)-ids[0]+1,ids.length);
 }
});
test('a straight road crossing the route stays near even when its endpoints are far',()=>{
 const crossing={kind:3,name:'Crossing',pts:[at(-300,250),at(300,250)]};
 const short={...route,pts:Array.from({length:11},(_,i)=>[...at(0,i*50),0])};
 const model=readFile(buildRoute(short,[crossing],{id:'11120000',nameImage:()=>new Uint8Array(42),map:{styled:true},speedKmh:18}).file);
 const lines=model.blocks[0].filter(e=>(e.style&15)===6);
 assert(lines.length>0);assert(lines.every(e=>!(e.style&0x800)));
});
test('two minor roads that meet end to end become one entry',()=>{
 // The block window can mark one side "far" (bit 11); a far and a near piece never join. So the contract is:
 // in no block do two class-6 entries of the same style share an end point, and some entry runs through the meeting point.
 const a={kind:3,name:'North',pts:[at(50,-100),at(50,1500)]},b={kind:3,name:'South',pts:[at(50,1500),at(50,3200)]};
 const key=q=>[Math.round((q[0]-origin[0])*111320),Math.round((q[1]-origin[1])*70000)].join(','),meet=key(at(50,1500));   // whole metres: decoded semicircles are not exact floats
 let through=0;
 for(const blk of new Set(make([a,b]).blocks)) {
  const ends=new Map();
  for(const e of blk.filter(e=>(e.style&15)===6)) {
   const pts=[e.center,...e.points];
   for(const k of [key(pts[0]),key(pts.at(-1))].map(k=>e.style+'|'+k)) {assert(!ends.has(k),'two same-style entries share an end point');ends.set(k,1);}
   if(pts.slice(1,-1).some(q=>key(q)===meet)) through++;
  }
 }
 assert(through>0,'no entry runs through the meeting point');
});
test('a bridge never joins the road before it',()=>{
 const a={kind:3,name:'Road',pts:[at(50,-100),at(50,1500)]},b={kind:3,name:'Bridge',fl:1,pts:[at(50,1500),at(50,1600)]};
 const blk=make([a,b]).blocks.find(x=>x.some(e=>(e.style&15)===6 && (e.style&0x80)));
 const ls=blk.filter(e=>(e.style&15)===6);
 assert(ls.some(e=>e.style&0x80) && ls.some(e=>!(e.style&0x80)));
});
// C3: scheme D (patch25 codec) against the protobuf route.
const buildMap=(lines,map={})=>buildRoute(route,lines,{id:'11120000',nameImage:()=>new Uint8Array(42),map:{styled:true,names:true,...map},speedKmh:18}).file;
const mapBytesOf=file=>file.subarray(new DataView(file.buffer,file.byteOffset,file.byteLength).getUint32(0x5c,true));
test('scheme D route reads the same blocks and budget costs as the protobuf route, in a smaller file',()=>{
 const rows=[...Array.from({length:40},(_,i)=>road('R'+i,30+i*12)),{...road('Bridge',90),fl:1}];
 const P=buildMap(rows),D=buildMap(rows,{codec:'d'});
 assert(D.length<P.length,`scheme D ${D.length} B, protobuf ${P.length} B`);
 assert.deepEqual(readFile(D).blocks,readFile(P).blocks);
 assert.deepEqual(auditMapSection(mapBytesOf(D)),auditMapSection(mapBytesOf(P)));
});
test('scheme D: an empty block is the E3 block',()=>{
 const D=mapBytesOf(buildMap([],{codec:'d'})),e3=Uint8Array.from(encodeBlockD([]));
 const at=Buffer.from(D).indexOf(Buffer.from(e3));
 assert(at>=0,'the E3 block (N 1, one style 0 entry) is in the scheme D map section');
 assert.deepEqual(auditMapSection(mapBytesOf(buildMap([],{codec:'d'}))),auditMapSection(mapBytesOf(buildMap([]))));
});
