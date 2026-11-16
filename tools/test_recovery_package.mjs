import {test} from 'node:test';
import assert from 'node:assert/strict';
import {encodeRecoveryPackage,decodeRecoveryPackage,portalGuards,buildPortal,generateWindow} from './recovery_package.mjs';
import {SegmentIndex} from './recovery_association.mjs';
import {buildCandidateGraph} from './recovery_study.mjs';
const p=x=>[51,7+x/70000],meta={routeSha256:'11'.repeat(32),sourceSha256:'22'.repeat(32),policySha256:'33'.repeat(32),entryMin:0,entryMax:25000,center:p(0)};
const portal=()=>({geometry:[p(10),p(100),p(200)],distanceMeters:190,targetVisit:100000,targetBearing:90,guards:[]});
test('sidecar serializes exact identity-bound covered first edge, guards and native-independent bytes',()=>{
 const a=portal();a.guards=[{a:[51.0001,7],b:[51.0001,7.002]}];const b=encodeRecoveryPackage([a],meta),r=decodeRecoveryPackage(b,meta);
 assert.equal(b.length,160+64+16+4+32+24);assert.equal(r.guardTable,1);assert.equal(r.portals.length,1);assert.equal(r.experimental,true);
 assert.equal(r.entryMin,0);assert.equal(r.portals[0].points,3);assert.equal(r.portals[0].guardCount,2);
 assert.deepEqual(b,encodeRecoveryPackage([a],meta));assert.throws(()=>decodeRecoveryPackage(b,{...meta,routeSha256:'44'.repeat(32)}),/identity/);
 const bad=Buffer.from(b);bad[bad.length-1]^=1;assert.throws(()=>decodeRecoveryPackage(bad),/CRC/);
 assert.throws(()=>encodeRecoveryPackage([{...portal(),geometry:Array(513).fill(p(0))}],meta),/limit/);
});
test('nearby denied roads are guards while remote roads are not silently admitted',()=>{
 const ways=[{id:10,nodes:[1,2],pts:[p(0),p(200)],tags:{highway:'residential'}},
 {id:20,nodes:[3,4],pts:[[51.0001,7],[51.0001,7.003]],tags:{highway:'steps'}},
 {id:30,nodes:[5,6],pts:[[51.01,7],[51.01,7.003]],tags:{highway:'residential'}}];
 const index=new SegmentIndex(ways),guards=portalGuards(index,index.segments[0]);assert.equal(guards.length,1);assert.equal(guards[0].way,20);
});
test('portal generation follows one directed source edge, preserves turns and bounds the actual first segment',()=>{
 const source={version:1,complete:true,issues:[],ways:[{id:10,nodes:[1,2,3],pts:[p(0),p(100),p(200)],tags:{highway:'residential',oneway:'yes'}}]},index=new SegmentIndex(source.ways),g={...buildCandidateGraph(source),turnRules:[]};
 const visits=[{progress:100000,bearing:90,association:{status:'associated',segment:index.segments[1],t:.5,point:p(150)}}];
 const r=buildPortal(g,index,index.segments[0],1,visits,meta);assert.equal(r.status,'candidate');assert(r.portal.geometry.length>=3);
 assert.equal(buildPortal(g,index,index.segments[0],-1,visits,meta).reason,'direction-not-admitted');
 const out=generateWindow(g,index,visits,meta,[index.segments[0]]);assert(out.bytes.length<65536);assert.equal(out.receipt.portals,1);assert.equal(out.receipt.rejected['direction-not-admitted'],1);
});
test('long edges subdivide guard work without removing source geometry or reducing map detail',()=>{
 const ways=[{id:1,nodes:[1,2],pts:[p(0),p(1000)],tags:{highway:'residential'}}];
 for(let i=0;i<80;i++)ways.push({id:100+i,nodes:[1000+2*i,1001+2*i],pts:[[51+30/111320,p(i*10)[1]],[51+30/111320,p(i*10+5)[1]]],tags:{highway:'footway',bicycle:'no'}});
 const index=new SegmentIndex(ways),g={...buildCandidateGraph({version:1,complete:true,issues:[],ways}),turnRules:[]},s=index.segments[0],visits=[{progress:100000,bearing:90,association:{status:'associated',segment:s,t:.9,point:p(900)}}];
 const r=buildPortal(g,index,s,1,visits,meta);assert.equal(r.status,'candidate');assert(r.portal.geometry.length>2);assert(r.portal.segmentGuards.every(gs=>gs.length<=64));
});
test('the portal row stores the target bearing as a unit vector for the core',()=>{
 const a=portal();a.targetBearing=90;const b=encodeRecoveryPackage([a],meta);
 assert.equal(b.readInt16LE(160+56),10000);assert.equal(b.readInt16LE(160+58),0);
 a.targetBearing=270;const c=encodeRecoveryPackage([a],meta);assert.equal(c.readInt16LE(160+56),-10000);
});
