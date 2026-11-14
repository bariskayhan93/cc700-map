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
async function withOfflineStore(run){
 const nav=Object.getOwnPropertyDescriptor(globalThis,'navigator'),fetch=globalThis.fetch;
 Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true});
 globalThis.fetch=async()=>{throw Error('unexpected network')};
 try{return await run();}finally{globalThis.fetch=fetch;if(nav)Object.defineProperty(globalThis,'navigator',nav);else delete globalThis.navigator;}
}
test('optional display roads cannot change native navigation names or records',async()=>withOfflineStore(async()=>{
 const track=[[.0405,.02],[.042,.02]],store={get:async key=>key.startsWith('n')?undefined:
  {...empty(),lines:key==='1,0'?[[1,1,'Optional outer road',[-1000,2000,6000,2000],0]]:[]},put:async()=>{throw Error('no write')}};
 const base=await loadOSM(track,null,store),expanded=await loadOSM(track,null,store,{coverageMeters:1000});
 const build=data=>buildRoute({name:'Boundary',pts:track},data.lines,{...data,id:'boundary',nameImage:()=>new Uint8Array(42),map:{styled:true,names:false}});
 const a=build(base),b=build(expanded),off=r=>new DataView(r.file.buffer).getUint32(0x5c,true);
 assert.deepEqual(b.file.subarray(128,off(b)),a.file.subarray(128,off(a)));
 assert.deepEqual(b.sections,a.sections);assert.equal(expanded.lines.length,1);assert.equal(expanded.navigationLines.length,0);
 assert(readFile(b.file).blocks.some(es=>es.some(e=>(e.style&15)===5)),'outer road remains available to map');
}));
test('sparse offline baseline keeps endpoint-cell dependencies; middle cells are optional display data',async()=>withOfflineStore(async()=>{
 const track=[[.02,.02],[.22,.02]],store={get:async key=>['0,0','4,0'].includes(key)?empty():undefined,put:async()=>{throw Error('no write')}};
 const base=await loadOSM(track,null,store);assert.equal(base.coverage.missingCells,0);
 const expanded=await loadOSM(track,null,store,{coverageMeters:1000});assert(expanded.coverage.missingCells>0);
 assert.deepEqual(expanded.navigationLines,base.navigationLines);
}));
test('optional surface evidence cannot change the baseline navigation roughness',async()=>withOfflineStore(async()=>{
 const track=[[.0405,.02],[.042,.02]],way={id:1,nodes:[1,2],pts:[[.04,.02],[.042,.02]],tags:{highway:'residential',surface:'asphalt'}};
 const store={get:async key=>key.startsWith('n')?undefined:{...empty(),
  lines:key==='0,0'?[[1,3,'Baseline',[4000,2000,4200,2000],64]]:[],
  ...(key==='1,0'?{navigationSource:{version:1,complete:true,ways:[way],issues:[]}}:{})},put:async()=>{throw Error('no write')}};
 const base=await loadOSM(track,null,store),expanded=await loadOSM(track,null,store,{coverageMeters:1000});
 assert.deepEqual(expanded.navigationLines,base.navigationLines);assert.equal(expanded.navigationLines[0].fl&64,64);
 assert.equal(expanded.lines[0].fl&64,0,'optional evidence may improve display styling');
}));
