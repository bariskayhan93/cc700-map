import assert from 'node:assert/strict';
import {test} from 'node:test';
import {frame} from '../js/geo.js';
import {loadOSM} from '../js/osm.js';
import {buildRoute} from '../js/route.js';
import {readFile} from '../js/preview.js';
const F=frame(0),p=(x,y)=>[...F.g(x,y),0];
test('styled route keeps a crossing road whose endpoints are outside the old route grid',()=>{
 const crossing={kind:3,name:'Crossing',pts:[p(-4000,200),p(4000,200)]};
 const r=buildRoute({name:'Sparse crossing',pts:[p(0,0),p(0,500)]},[crossing],
  {id:'test',nameImage:()=>new Uint8Array(42),map:{styled:true,names:false}});
 assert(readFile(r.file).blocks[0].some(e=>(e.style&15)===6));
});
test('styled route keeps a containing polygon even with all vertices outside the old grid',()=>{
 const ring=[p(-4000,-4000),p(4000,-4000),p(4000,4000),p(-4000,4000)];
 const r=buildRoute({name:'Containing area',pts:[p(0,0),p(0,500)]},[],
  {id:'test',nameImage:()=>new Uint8Array(42),green:[[ring]],map:{styled:true,names:false}});
 assert(readFile(r.file).blocks[0].some(e=>(e.style&15)===2));
});
const empty=()=>({v:9,t:Date.now(),lines:[],areas:[],water:[],rails:[],green:[],trams:[],wlines:[]});
async function cached(track,options,missingOuter=false){
 const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),fetch=globalThis.fetch;
 Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true});
 const keys=[];let requests=0;
 globalThis.fetch=async()=>{requests++;throw Error('offline')};
 try{
  const result=await loadOSM(track,null,{get:async key=>{
   if(key.startsWith('n'))return {t:Date.now(),sig:[],stop:[]};
   keys.push(key);return missingOuter&&key!=='0,0'?undefined:empty();
  },put:async()=>{throw Error('unexpected write')}},options);
  return {result,keys,requests};
 }finally{globalThis.fetch=fetch;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;}
}
test('extended source loading includes cells beyond the legacy reach',async()=>{
 const {keys,result}=await cached([[.0412,.02]],{coverageMeters:1000});
 assert(keys.includes('1,0'));assert.equal(result.coverage.missingCells,0);
 assert.equal(result.coverage.requestedMeters,1000);
});
test('missing optional outer cells preserve an offline cached base route without fetches',async()=>{
 const {result,requests}=await cached([[.0412,.02]],{coverageMeters:1000},true);
 assert(result.coverage.missingCells>0);assert.equal(requests,0);
});
test('expanded source loading samples sparse track segments between endpoints',async()=>{
 const {keys}=await cached([[.02,.02],[.22,.02]],{coverageMeters:1000});
 assert(keys.includes('2,0'));
});
