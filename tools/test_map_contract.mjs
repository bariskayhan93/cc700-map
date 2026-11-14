import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildRoute} from '../js/route.js';
import {readFile} from '../js/preview.js';
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
