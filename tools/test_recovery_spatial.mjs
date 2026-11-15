import {test} from 'node:test';
import assert from 'node:assert/strict';
import {nearestRoute,sampleSpatial,localGraph,spatialStudy} from './recovery_spatial.mjs';
import {SegmentIndex} from './recovery_association.mjs';
const p=(x,y)=>[51+y/111320,7+x/(111320*Math.cos(51*Math.PI/180))];
const route=[{point:p(-1000,0),progress:0},{point:p(1000,0),progress:200000}];
test('nearest route measures whole polyline and preserves competing ordered visits',()=>{
 const n=nearestRoute(route,p(0,1500));assert(n.distanceMeters>1490&&n.distanceMeters<1510);assert.equal(Math.round(n.progress),100000);
 const repeated=[...route,{point:p(-1000,0),progress:400000}];assert.equal(nearestRoute(repeated,p(0,1500)).ambiguousProgress,true);
});
test('radius sampling is deterministic, disjoint, density-stratified and boundary aware',()=>{
 const nodes=[],ways=[];let id=1;
 for(const y of [500,1500,2500])for(let j=0;j<12;j++){
  const a=id++,b=id++;nodes.push({id:a,point:p(j*5,y),tags:{}},{id:b,point:p(j*5+1,y),tags:{}});ways.push({id:j+100*y,nodes:[a,b],pts:[p(j*5,y),p(j*5+1,y)],tags:{highway:'residential'}});
 }
 const snapshot={nodes,navigationSource:{ways},provenance:{bbox:[50.95,6.95,51.05,7.05]}},i=new SegmentIndex(ways);
 const a=sampleSpatial(snapshot,route,i,{perStratum:2,maxScanned:1000});assert.equal(a.samples.length,18);
 assert.deepEqual(a,sampleSpatial(snapshot,route,i,{perStratum:2,maxScanned:1000}));
 assert.deepEqual([...new Set(a.samples.map(s=>s.band))],[1,2,3]);
 assert.equal(new Set(a.samples.map(s=>s.node)).size,a.samples.length);
 assert(a.samples.every(s=>s.distanceMeters>(s.band-1)*1000&&s.distanceMeters<=s.band*1000));
 const boundary=structuredClone(snapshot);boundary.provenance.bbox=[50.999,6.999,51.003,7.003];assert.equal(sampleSpatial(boundary,route,i).samples.length,0);
});
test('local graph retains only original edges with both nodes in the window, never clipped joins',()=>{
 const g={nodes:[{id:1,point:p(0,0)},{id:2,point:p(500,0)},{id:3,point:p(2000,0)}],edges:[{from:1,to:2,way:10,meters:500},{from:2,to:3,way:10,meters:1500}],turnRules:[]};
 const q=localGraph(g,p(0,0),1000);assert.equal(q.nodes.length,2);assert.equal(q.edges.length,1);assert.equal(q.edges[0],g.edges[0]);
});
