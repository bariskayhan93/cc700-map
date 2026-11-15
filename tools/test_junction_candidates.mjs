import assert from 'node:assert/strict';
import {test} from 'node:test';
import {junctionCandidates} from '../js/junction_candidates.js';
import {frame,hav} from '../js/geo.js';
const p=([x,y])=>[y/111320,x/111320,0], line=(xy,fl=8)=>({kind:1,fl,pts:xy.map(p)});
function candidates(xy,lines){const P=xy.map(p),D=[0];for(let i=1;i<P.length;i++)D.push(D.at(-1)+hav(P[i-1],P[i]));return junctionCandidates(P,D,lines,frame(0));}
test('geometric junction candidates locate a crossing even if collinear source vertices were removed',()=>{
 const r=candidates([[0,0],[0,100],[100,100]],[line([[0,0],[0,200]]),line([[-100,100],[200,100]])]);
 assert.equal(r.length,1);assert(Math.abs(r[0].d-100)<1);assert.deepEqual(r[0].xy,[0,100]);assert.deepEqual([...r[0].ways].sort(),[0,1]);
});
test('parallel roads do not become connected merely by being close',()=>{
 assert.equal(candidates([[0,0],[0,200]],[line([[0,0],[0,200]]),line([[5,0],[5,200]])]).length,0);
});
test('grade-separated interior crossings are not junction candidates',()=>{
 assert.equal(candidates([[0,0],[0,200]],[line([[0,0],[0,200]],13),line([[-100,100],[100,100]],8)]).length,0);
});
test('bridge endpoint connected to an ordinary road remains a candidate',()=>{
 assert.equal(candidates([[0,0],[0,100],[100,100]],[line([[0,0],[0,100]],13),line([[-100,100],[100,100]],8)]).length,1);
});
test('separate visits to a route crossing retain independent distances',()=>{
 const r=candidates([[0,0],[0,200],[0,0]],[line([[0,0],[0,200]]),line([[-100,100],[100,100]])]);
 assert.equal(r.length,2);assert(Math.abs(r[0].d-100)<1);assert(Math.abs(r[1].d-300)<1);
});
test('a shallow endpoint fork has one source location and no invented route bend',()=>{
 const xy=[[0,0],[0,100],[50,200]],r=candidates(xy,[line([[0,0],[0,250]]),line([[0,100],[50,200]])]);
 assert.equal(r.length,1);assert.deepEqual(r[0].xy,[0,100]);
});
test('floating-point negative zero does not split one connected source junction',()=>{
 // Intersection arithmetic lands infinitesimally west of the shared vertex.
 // All three roads meet at (0,100); there is exactly one visit to that node.
 const r=candidates([[0,0],[0,200]],[line([[-1/3,100],[3/7,100]]),line([[0,0],[0,100],[0,200]]),line([[0,100],[100,200]])]);
 assert.equal(r.length,1);
 assert.deepEqual([...r[0].ways].sort(),[0,1,2]);
});
