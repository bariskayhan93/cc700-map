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

// ---- cc27 Task 11: name positions away from the route and the junctions, and three landmark types ----
import {landmarkName} from '../js/map_labels.js';
const at = (name, pts, cls = 6) => ({name, cls, pts});
test('a route street name comes before a landmark, and a landmark before a side street', () => {
  const roads = [at('Side', [[1600, 200], [2000, 200]], 5), at('Route', [[0, 100], [400, 100]], 7), at('Cross', [[1200, -200], [1200, 250]], 7)];
  const marks = [{q: [600, 150], type: 'church', name: ''}];
  const c = prepareLabelCandidates(roads, F, near, new Set(['Route']), marks);
  assert.deepEqual(c.map(x => x.name), ['Route', 'Cross', 'Kirche', 'Side']);   // Cross crosses the route
  assert.deepEqual(c.find(x => x.name === 'Kirche').q, [600, 150]);
  assert.equal(c.find(x => x.name === 'Kirche').cls, 12);
});
test('a name is 20 m or more from the route line and from each junction', () => {
  // A street crosses the route (y = 0) at x = 100 and meets another street at (100, 150).
  const roads = [at('Long', [[100, -200], [100, 0], [100, 150], [100, 300]]), at('Other', [[100, 150], [-200, 150]])];
  const c = prepareLabelCandidates(roads, F, near);
  const long = c.find(x => x.name === 'Long'), other = c.find(x => x.name === 'Other');
  assert(Math.abs(long.q[1]) >= 20 && Math.hypot(long.q[0] - 100, long.q[1] - 150) >= 20, String(long.q));
  assert.deepEqual(long.q, [100, -110]);                         // the middle of the longest straight stretch, -200..-20
  assert(Math.hypot(other.q[0] - 100, other.q[1] - 150) >= 20);
  // A street that is within 20 m of the route over its whole length gets no position.
  assert.equal(prepareLabelCandidates([at('Close', [[0, 10], [300, 10]])], F, near).length, 0);
});
test('a block with 14 candidates keeps 12 names and at most 384 B', () => {
  const roads = Array.from({length: 14}, (_, i) => at('Strasse Nummer ' + String(i).padStart(8, '0'), [[i * 250, 40], [i * 250, 290]]));
  const all = prepareLabelCandidates(roads, F, near), block = labelsForBlock(all, () => [0, 0]);
  assert.equal(all.length, 14);
  assert.equal(block.length, 12);
  assert(block.reduce((s, l) => s + Math.ceil((labelName(l.name).length + 1) / 8) * 8, 0) <= 384);
});
test('a supermarket without a name gets "Supermarkt"; a 30-byte name is cut on a character boundary', () => {
  assert.equal(landmarkName('supermarket', ''), 'Supermarkt');
  assert.equal(landmarkName('water'), 'Trinkwasser');
  assert.equal(landmarkName('church', undefined), 'Kirche');
  const long = 'Evangelische Kirche Sankt Jürgen';        // 33 B in UTF-8, the ü near the cut
  const cut = landmarkName('church', long), bytes = new TextEncoder().encode(cut);
  assert(bytes.length <= 23 && bytes.length >= 20, cut);
  assert.equal(new TextDecoder('utf-8', {fatal: true}).decode(bytes), cut);
  assert.match(cut, /^[\x20-\x7e]+$/);
  const marks = [{q: [100, 100], type: 'supermarket', name: ''}, {q: [100, 900], type: 'water', name: 'Brunnen'}];
  assert.deepEqual(prepareLabelCandidates([], F, near, new Set(), marks).map(x => x.name), ['Supermarkt']);   // 900 m: not within 300 m
});
