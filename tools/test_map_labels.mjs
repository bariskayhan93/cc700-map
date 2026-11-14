import assert from 'node:assert/strict';
import {test} from 'node:test';
import {labelName, labelBox, placeLabels, prepareLabelCandidates, labelsForBlock} from '../js/map_labels.js';
const F={m:(a,b)=>[a,b]};
const line=(name,x,y,cls=6)=>({name,cls,pts:[[x,y],[x+300,y]]});
const near=(x,y)=>[Math.abs(y),0];
test('ASCII payload and rendered name are the same bounded text',()=>{
 assert.equal(labelName('Äußere Straße'),'Aeussere Str.');
 assert.equal(labelName('🛞'), '');
 assert.equal(labelName('x'.repeat(40)).length,23);
});
test('native box preserves edge and HUD exclusions',()=>{
 assert.deepEqual(labelBox('Road',120,80),[104,72,136,88]);
 assert.equal(labelBox('Road',10,80),null);
 assert.equal(labelBox('Road',40,180),null);
 assert(labelBox('Road',180,180));
});
test('collision includes halo margin and is bounded to twelve accepted labels',()=>{
 const make=(label,x,y)=>({label,points:[[x,y]]});
 const a=make('Road',120,80),b=make('Other',135,80),c=make('Above',120,50);
 assert.deepEqual(placeLabels([a,b,c]).map(x=>x.label),['Road','Above']);
 const many=[];for(let y=20;y<230;y+=25)for(let x=120;x<230;x+=30)many.push(make('x',x,y));
 assert.equal(placeLabels(many).length,12);
 assert.equal(placeLabels([make('🛞'.repeat(35),120,80)]).length,0);
});
test('label priorities and anchors are independent of input ordering and block clipping',()=>{
 const roads=[line('Zulu',0,100),line('Alpha',0,400),line('Route',500,100)];
 const a=prepareLabelCandidates(roads,F,near,new Set(['Route']));
 const b=prepareLabelCandidates([...roads].reverse(),F,near,new Set(['Route']));
 assert.deepEqual(a,b);
 assert.equal(a[0].name,'Route');
 const left=labelsForBlock(a,(x,y)=>[Math.hypot(x-100,y-100),0]);
 const right=labelsForBlock(a,(x,y)=>[Math.hypot(x-200,y-100),0]);
 for(const l of left.filter(l=>right.some(r=>r.id===l.id)))assert.deepEqual(l,right.find(r=>r.id===l.id));
});
test('names without printable glyphs and malformed geometry do not consume label slots',()=>{
 const rows=prepareLabelCandidates([line('🛞',0,100),{name:'bad',cls:6,pts:[[NaN,0],[3,4]]},line('Valid',0,100)],F,near);
 assert(rows.length>0);assert(rows.every(r=>r.name==='Valid'));
 assert(rows.length<=12);
});
test('closed road anchors remain identical when source direction reverses',()=>{
 const ring={name:'Ring',cls:6,pts:[[0,100],[100,100],[100,200],[0,200],[0,100]]};
 assert.deepEqual(prepareLabelCandidates([ring],F,near),prepareLabelCandidates([{...ring,pts:[...ring.pts].reverse()}],F,near));
});
