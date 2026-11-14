// Synthetic surface evidence: missing tags never establish a rough surface.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCell,loadOSM} from '../js/osm.js';
import {buildRoute} from '../js/route.js';
import {readFile} from '../js/preview.js';
import {MAP_CLASS} from '../js/mapsec.js';
const pts=Array.from({length:31},(_,i)=>[.02,.02+i*.00005,0]);
const way=(tags={})=>({type:'way',id:1,nodes:pts.map((_,i)=>i+1),geometry:pts.map(([lat,lon])=>({lat,lon})),tags:{highway:'track',...tags}});
const cell=tags=>({v:9,t:Date.now(),...buildCell([way(tags)],0,0)});
const entries=(lines,rough=true)=>readFile(buildRoute({name:'SYNTHETIC surface',pts},lines,{id:'surface',nameImage:()=>new Uint8Array(42),map:{styled:true,rough}}).file).blocks.flat();
const hasRoadRough=es=>es.some(e=>(e.style&0x200)!==0);
const hasRouteRough=es=>es.some(e=>(e.style&15)===15&&(e.style&0x8000)!==0);
async function cached(cells,online=false){
 const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),fetch=globalThis.fetch;
 Object.defineProperty(globalThis,'navigator',{value:{onLine:online},configurable:true});
 globalThis.fetch=async()=>{throw Error('unexpected network')};
 try{return await loadOSM([[.049,.02]],null,{get:async k=>k.startsWith('n')?{t:Date.now(),sig:[],stop:[]}:typeof cells==='function'?cells(k):cells,put:async()=>{throw Error('unexpected cache write')}})}
 finally{globalThis.fetch=fetch;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;}
}
test('track class survives unknown surface but rough flag requires positive evidence',()=>{
 for(const tags of [{},{surface:'asphalt'},{tracktype:'mystery'},{surface:'paved'},{surface:'concrete'}]){
  const l=cell(tags).lines[0];assert.equal(l[1],6);assert.equal(l[4]&64,0);
 }
 for(const tags of [{surface:'gravel'},{surface:'compacted'},{tracktype:'grade2'},{tracktype:'grade5'},{tracktype:'grade1',surface:'dirt'}]) assert.equal(cell(tags).lines[0][4]&64,64);
 assert.equal(cell({tracktype:'grade1',surface:'asphalt'}).lines[0][1],5);
 assert.equal(cell({highway:'cycleway',surface:'asphalt'}).lines[0][4]&32,32);
});
test('cached original tags restore rough evidence for old cells and clear unsupported flags',async()=>{
 for(const tags of [{},{surface:'asphalt'},{surface:'gravel'},{tracktype:'grade3'}]){
  const c=cell(tags);c.v=8;c.lines[0][4]|=64;
  const result=await cached(c),known=Boolean(tags.surface==='gravel'||tags.tracktype==='grade3');
  assert.equal(Boolean(result.lines[0].fl&64),known);
  const es=entries(result.lines);assert.equal(hasRoadRough(es),known);assert.equal(hasRouteRough(es),known);
 }
 const c=cell({surface:'gravel'});c.v=7;delete c.navigationSource;
 const result=await cached(c);assert.equal(result.lines[0].kind,6);assert.equal(result.lines[0].fl&64,0);
 assert.equal(hasRouteRough(entries(result.lines)),false);
});
test('current cells encode explicit evidence into both overlays and rough option disables both',async()=>{
 for(const tags of [{},{surface:'asphalt'},{surface:'gravel'}]){
  const result=await cached(cell(tags)),known=tags.surface==='gravel';
  const es=entries(result.lines);assert.equal(hasRoadRough(es),known);assert.equal(hasRouteRough(es),known);
  const off=entries(result.lines,false);assert.equal(hasRoadRough(off),false);assert.equal(hasRouteRough(off),false);
 }
});
test('known evidence from another loaded cell restores legacy line flags',async()=>{
 const old=cell({surface:'gravel'});old.v=7;delete old.navigationSource;old.lines[0][4]&=~64;
 const source=cell({surface:'gravel'});
 const result=await cached(k=>k.startsWith('0,')?old:source);
 assert.equal(result.lines.length,1);assert.equal(result.lines[0].fl&64,64);
});
test('contradictory original surface observations cannot create rough overlays',async()=>{
 const a=cell({surface:'gravel'}),b=cell({surface:'asphalt'});a.v=b.v=8;
 const result=await cached(k=>k.startsWith('0,')?a:b);
 assert.equal(result.navigationSource.complete,false);assert.equal(result.lines[0].fl&64,0);
 assert.equal(hasRouteRough(entries(result.lines)),false);
});
test('online legacy cells refresh to version 9 using original tags',async()=>{
 const old=cell({});old.v=8;
 const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),fetch=globalThis.fetch;
 Object.defineProperty(globalThis,'navigator',{value:{onLine:true},configurable:true});
 let requests=0;const writes=[];
 globalThis.fetch=async()=>{requests++;return {ok:true,json:async()=>({elements:[way({surface:'gravel'})]})}};
 try{
  const result=await loadOSM([[.02,.02]],null,{get:async k=>k.startsWith('n')?{t:Date.now(),sig:[],stop:[]}:old,put:async(k,v)=>writes.push([k,v])});
  assert.equal(requests,1);assert.equal(writes.length,1);assert.equal(writes[0][1].v,9);
  assert.equal(result.lines[0].fl&64,64);assert.equal(hasRouteRough(entries(result.lines)),true);
 }finally{globalThis.fetch=fetch;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;}
});
test('offline legacy data without original tags makes no network calls or cache writes',async()=>{
 const old=cell({surface:'gravel'});old.v=6;delete old.navigationSource;
 const result=await cached(old);assert.equal(result.lines[0].fl&64,0);
 assert.equal(hasRoadRough(entries(result.lines)),false);
});
test('explicit rough flag preserves an existing cycleway class and cycleway bit',()=>{
 const line={kind:5,name:'SYNTHETIC cycleway',pts,fl:32|64};
 const es=entries([line]);
 assert(es.some(e=>(e.style&15)===MAP_CLASS.CYC&&(e.style&0x200)!==0));
 assert.equal(hasRouteRough(es),true);
 assert.equal(line.kind,5);assert.equal(line.fl,96);
});
test('tagged unpaved cycleway retains bicycle infrastructure classification',async()=>{
 const {lines}=await cached(cell({highway:'cycleway',surface:'gravel'}));
 const es=entries(lines);
 assert(es.some(e=>(e.style&15)===MAP_CLASS.CYC));
 assert.equal(hasRouteRough(es),true);
});
