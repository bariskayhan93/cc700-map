import assert from 'node:assert/strict';
import{test}from'node:test';
import{buildRoute}from'../js/route.js';
const point=([x,y])=>[y/111320,x/111320,0];
const lines=[{name:'main',kind:1,pts:[[0,0],[0,100],[0,250]].map(point)}, {name:'fork',kind:1,pts:[[0,100],[50,200]].map(point)}];
const gpx={name:'policy',pts:[[0,0],[0,100],[50,200]].map(point)},opt={id:'test',nameImage:()=>new Uint8Array(42),map:{}};
test('unreleased junction policy cannot silently become the production default',()=>{
 assert.equal(buildRoute(gpx,lines,opt).navigationPolicy,'legacy');
 assert.equal(buildRoute(gpx,lines,{...opt,navigationPolicy:'junction-evidence-v1'}).navigationPolicy,'junction-evidence-v1');
});
test('unknown navigation policy fails instead of selecting an unverified fallback',()=>{
 assert.throws(()=>buildRoute(gpx,lines,{...opt,navigationPolicy:'typo'}),/navigation policy/i);
});
