import assert from 'node:assert/strict';
import {buildRoute} from '../js/route.js';
import {readFile} from '../js/preview.js';
import {loadOSM} from '../js/osm.js';
import {parse} from '../js/pb.js';
let requests=0;
globalThis.fetch=async()=>{requests++;throw Error('network disabled by audit')};
Object.defineProperty(globalThis.navigator,'onLine',{value:false,configurable:true});
const track=[[0.025,0.04],[0.026,0.041]];
const empty=()=>({v:7,t:Date.now(),lines:[],areas:[],water:[],rails:[]});
for(const [label,cell] of [['fresh',empty()],['stale',{...empty(),t:0,v:1}]]){
 requests=0;
 await loadOSM(track,null,{get:async k=>k.startsWith('n')?{t:Date.now(),sig:[],stop:[]}:cell,put:async()=>{throw Error('unexpected write')}});
 assert.equal(requests,0);console.log('PASS offline '+label+' cached cells retained');
}
requests=0;
await assert.rejects(loadOSM(track,null,{get:async()=>undefined,put:async()=>{throw Error('unexpected write')}}),/Kartendaten nicht geladen/);
assert(requests>0);console.log('PASS missing mandatory cell rejects when fetch fails');
requests=0;
await loadOSM(track,null,{get:async k=>k.startsWith('n')?undefined:empty(),put:async()=>{throw Error('unexpected write')}});
assert.equal(requests,0);console.log('PASS missing optional nodes stays offline');
Object.defineProperty(globalThis.navigator,'onLine',{value:true,configurable:true});
requests=0;
await loadOSM(track,null,{get:async k=>k.startsWith('n')?undefined:{...empty(),v:8},put:async()=>{throw Error('unexpected write')}});
assert(requests>0);console.log('PASS online optional nodes tolerates fetch failure');
Object.defineProperty(globalThis.navigator,'onLine',{value:false,configurable:true});
for (const styled of [false,true]) {
 const r=buildRoute({name:'Synthetic 70km',pts:[[0,0,0],[0.63,0,0]]},[],{id:'synthetic',speedKmh:18,nameImage:()=>new Uint8Array(42),map:{styled},noF9:styled});
 const model=readFile(r.file);assert.equal(model.secs.length,r.sections.length);assert.equal(model.blocks.length,r.sections.length);
 assert(model.secs.every(s=>s.length<=50));assert(r.file.length<4_000_000);
 let offset=128,geoRecords=0;
 while(offset+4<r.file.length){const n=new DataView(r.file.buffer).getUint32(offset,true);if(!n||n>16000||offset+4+n>r.file.length)break;
 const fields=parse(r.file.subarray(offset+4,offset+4+n));const info=fields.find(([f])=>f===1)?.[2];assert(info);assert(parse(info).some(([f])=>f===8));geoRecords++;offset+=4+n;}
 assert.equal(geoRecords,r.sections.length);
 console.log('PASS synthetic 70km '+(styled?'styled':'stock')+': '+r.sections.length+' records; '+r.file.length+' bytes; max '+Math.max(...model.secs.map(s=>s.length))+' points; every record geohash-indexed');
}
