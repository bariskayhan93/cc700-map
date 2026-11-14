// Synthetic OSM source preservation. Navigation source is not a routing graph.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildCell,loadOSM} from '../js/osm.js';
const way=(id,nodes,xy,tags={})=>({type:'way',id,nodes,geometry:xy.map(([lon,lat])=>({lat,lon})),tags:{highway:'residential',...tags}});
const build=els=>buildCell(els,0,0).navigationSource;
const a=()=>way(10,[1,2,3],[[.01,.01],[.011,.01],[.012,.01]]);
test('original node identity preserves split and unsplit junctions',()=>{
 const unsplit=build([a(),way(20,[2,4],[[.011,.01],[.011,.011]])]);
 assert.equal(unsplit?.complete,true);
 assert.deepEqual(unsplit.ways.map(w=>w.nodes),[[1,2,3],[2,4]]);
 const split=build([way(11,[1,2],[[.01,.01],[.011,.01]]),way(12,[2,3],[[.011,.01],[.012,.01]]),way(20,[2,4],[[.011,.01],[.011,.011]])]);
 assert.deepEqual(split.ways.map(w=>w.nodes),[[1,2],[2,3],[2,4]]);
});
test('geometric grade crossing retains distinct nodes and raw direction/access tags',()=>{
 const source=build([way(1,[1,2],[[.01,.011],[.012,.011]],{bridge:'yes',layer:'1',oneway:'-1','oneway:bicycle':'no',bicycle:'designated',access:'private','bicycle:conditional':'yes @ (sunrise-sunset)'}),way(2,[3,4],[[.011,.01],[.011,.012]],{tunnel:'yes',layer:'-1'})]);
 assert.equal(source?.complete,true);
 assert.deepEqual(source.ways[0].nodes,[1,2]); assert.deepEqual(source.ways[1].nodes,[3,4]);
 assert.deepEqual(source.ways[0].tags,{highway:'residential',bridge:'yes',layer:'1',oneway:'-1','oneway:bicycle':'no',bicycle:'designated',access:'private','bicycle:conditional':'yes @ (sunrise-sunset)'});
 assert.equal(source.ways[1].tags.tunnel,'yes'); assert.equal(source.ways[1].tags.layer,'-1');
});
test('roundabout closure and absent oneway remain original facts',()=>{
 const source=build([way(1,[1,2,3,1],[[.01,.01],[.011,.01],[.011,.011],[.01,.01]],{junction:'roundabout'})]);
 assert.equal(source?.version,1);assert.deepEqual(source.ways[0].nodes,[1,2,3,1]);
 assert.equal(source.ways[0].tags.junction,'roundabout');assert.equal('oneway' in source.ways[0].tags,false);
});
test('short connectors hidden by display policy remain unsmoothed source',()=>{
 const original=way(50,[1,2,3],[[.01,.01],[.01001,.01001],[.01002,.01]],{highway:'service',service:'driveway',access:'private'});
 const before=structuredClone(original),cell=buildCell([original],0,0);
 assert.deepEqual(cell.lines,[]); assert.equal(cell.navigationSource?.complete,true);
 assert.deepEqual(cell.navigationSource.ways[0],{id:50,nodes:[1,2,3],pts:[[.01,.01],[.01001,.01001],[.01,.01002]],tags:{highway:'service',service:'driveway',access:'private'}});
 assert.deepEqual(original,before);
 original.nodes[0]=99;original.geometry[0].lat=2;original.tags.access='yes';
 assert.equal(cell.navigationSource.ways[0].nodes[0],1);assert.equal(cell.navigationSource.ways[0].pts[0][0],.01);assert.equal(cell.navigationSource.ways[0].tags.access,'private');
});
test('display smoothing does not replace original source coordinates',()=>{
 const input=way(1,[1,2,3],[[.01,.01],[.011,.011],[.012,.01]]),cell=buildCell([input],0,0);
 assert.deepEqual(cell.navigationSource?.ways[0].pts,[[.01,.01],[.011,.011],[.01,.012]]);
 assert(cell.lines[0][3].length>6);
});
test('misaligned nodes and invalid coordinates expose incomplete source',()=>{
 const malformed=a();malformed.nodes=[1,2]; const bad=a();bad.id=99;bad.geometry[1].lat=NaN;
 const source=build([malformed,bad]);
 assert.equal(source?.complete,false);assert.deepEqual(source.ways,[]);
 assert.equal(source.issues.length,2);
});
async function offline(cells) {
 const oldFetch=globalThis.fetch,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 globalThis.fetch=async()=>{throw Error('unexpected network')};Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true});
 try{return await loadOSM([[.02,.02]],null,{get:async key=>key.startsWith('n')?{t:Date.now(),sig:[],stop:[]}:cells(key),put:async()=>{throw Error('unexpected write')}})}
 finally{globalThis.fetch=oldFetch;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
}
const cache=els=>({t:Date.now(),v:7,...buildCell(els,0,0)});
test('legacy cached cells remain usable offline with explicit missing source capability',async()=>{
 const cell=cache([a()]);delete cell.navigationSource;
 const result=await offline(()=>cell);
 assert.equal(result.lines.length,1);assert.equal(result.navigationSource?.complete,false);
 assert.deepEqual(result.navigationSource.ways,[]);assert(result.navigationSource.issues.some(i=>i.code==='missing-cell-source'));
});
test('same way repeated in loaded cells merges once and preserves source IDs',async()=>{
 const result=await offline(()=>cache([a()]));
 assert.equal(result.navigationSource?.complete,true);assert.deepEqual(result.navigationSource.ways.map(w=>w.id),[10]);
});
test('conflicting duplicate way versions are quarantined and expose incompleteness',async()=>{
 const first=cache([a()]),second=cache([a()]);second.navigationSource ??= {version:1,complete:true,ways:[{id:10,nodes:[1,2,3],pts:[[.01,.01],[.01,.011],[.01,.012]],tags:{highway:'residential'}}],issues:[]};
 second.navigationSource.ways[0].tags.oneway='yes';
 // Track straddles two cells. Differing cache contents must not silently choose first.
 const oldFetch=globalThis.fetch,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 globalThis.fetch=async()=>{throw Error('unexpected network')};Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true});
 try {const result=await loadOSM([[.049,.02]],null,{get:async key=>key.startsWith('n')?{t:Date.now(),sig:[],stop:[]}:key.startsWith('0,')?first:second,put:async()=>{throw Error('unexpected write')}});
 assert.equal(result.navigationSource?.complete,false);assert.deepEqual(result.navigationSource.ways,[]);assert(result.navigationSource.issues.some(i=>i.code==='conflicting-way'));
 } finally {globalThis.fetch=oldFetch;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});

test('offline legacy cells never request missing optional node overlays',async()=>{
 const cell=cache([a()]);delete cell.navigationSource;
 let requests=0;const oldFetch=globalThis.fetch,oldNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 globalThis.fetch=async()=>{requests++;throw Error('offline')};Object.defineProperty(globalThis,'navigator',{value:{onLine:false},configurable:true});
 try{const result=await loadOSM([[.02,.02]],null,{get:async key=>key.startsWith('n')?undefined:cell,put:async()=>{throw Error('unexpected write')}});
 assert.equal(result.lines.length,1);assert.equal(result.navigationSource.complete,false);assert.equal(requests,0);
 }finally{globalThis.fetch=oldFetch;if(oldNavigator)Object.defineProperty(globalThis,'navigator',oldNavigator);else delete globalThis.navigator;}
});
test('one shared node with contradictory original coordinates exposes incomplete source',()=>{
 const source=build([a(),way(20,[2,4],[[.0111,.01],[.011,.011]])]);
 assert.equal(source.complete,false);assert(source.issues.some(i=>i.code==='conflicting-node'));
});
test('missing raw way geometry reports incomplete source without crashing cell ingestion',()=>{
 const input={type:'way',id:1,nodes:[1,2],tags:{highway:'residential'}};
 const cell=buildCell([input],0,0);
 assert.equal(cell.navigationSource.complete,false);assert.deepEqual(cell.navigationSource.ways,[]);assert.deepEqual(cell.lines,[]);
});
test('missing original node IDs exposes incomplete source without display connectivity guesses',()=>{
 const input=a();delete input.nodes;
 const cell=buildCell([input],0,0);
 assert.equal(cell.navigationSource.complete,false);assert.deepEqual(cell.navigationSource.ways,[]);assert.deepEqual(cell.lines,[]);
});
