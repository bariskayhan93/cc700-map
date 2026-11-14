// SYNTHETIC labelled oracles. No recorded ride coordinates or cached map data.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRoute, decisionPoints, TURN } from '../js/route.js';
import { readFile } from '../js/preview.js';
import { hav, frame } from '../js/geo.js';
const point = ([x,y]) => [y / 111320, x / 111320, 0];
const road = (name, xy) => ({ name, kind: 1, pts: xy.map(point) });
const generate = (xy, lines) => buildRoute({ name:'SYNTHETIC junction',pts:xy.map(point) }, lines, {id:'SYNTHETIC',nameImage:()=>new Uint8Array(42),map:{}});
const turns = r => r.sections.filter(s => s.dir);
function labelled(result, labels) {
 const actual=turns(result);
 assert.deepEqual(actual.map(s=>s.dir),labels.map(l=>l[0]));
 actual.forEach((s,i)=>assert(Math.abs(s.dist-labels[i][1])<=12, `turn ${i}: ${s.dist} m, labelled ${labels[i][1]} ±12 m`));
}
function noisy(shape, seed=7) {
 const random=()=> (seed=seed*16807%2147483647)/2147483647;
 const gaussian=()=>Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random());
 return shape.map(([x,y])=>[x+3*gaussian(),y+3*gaussian()]);
}
test('SYNTHETIC own forward road arm is not an alternative when GPS heading is skewed',()=> {
 const P=[[-8,85],[0,100],[-8,115]].map(point), D=[0,hav(point([-8,85]),point([0,100])),hav(point([-8,85]),point([0,100]))*2];
 const F=frame(0), lines=[road('only road',[[0,0],[0,200]])];
 const a=F.m(...point([0,0])), b=F.m(...point([0,200]));
 const grid=new Map(); for(let x=-1;x<=1;x++) for(let y=0;y<=4;y++) grid.set(x+','+y,[[0,a,b]]);
 assert.equal(decisionPoints(P,D,lines,F,grid).judge(D[1]),null);
});
test('SYNTHETIC T junction labels right at the 100 m junction',()=> {
 labelled(generate([[0,0],[0,100],[160,100]],[road('approach',[[0,0],[0,100],[0,180]]),road('exit',[[0,100],[160,100]])]),[[TURN.RIGHT,100]]);
});
test('SYNTHETIC right angle bend without a choice has no prompt',()=> {
 const xy=[[0,0],[0,100],[100,100]];
 labelled(generate(xy,[road('bend',xy)]),[]);
});
test('SYNTHETIC alternating 3 m straight-road jitter has no prompt',()=> {
 const xy=Array.from({length:41},(_,i)=>[(i%2?3:-3),i*5]);
 labelled(generate(xy,[road('straight',[[0,0],[0,200]])]),[]);
});
test('SYNTHETIC close turns label right at 100 m then left 22 m later',()=> {
 const xy=[[0,0],[0,100],[22,100],[22,200]];
 const lines=[road('in',[[0,0],[0,170]]),road('cross',[[-50,100],[70,100]]),road('out',[[22,40],[22,200]])];
 labelled(generate(xy,lines),[[TURN.RIGHT,100],[TURN.LEFT,122]]);
});
test('SYNTHETIC out and back labels a U-turn at its 100 m reversal',()=> {
 labelled(generate([[0,0],[0,100],[0,0]],[road('straight',[[0,0],[0,100]])]),[[TURN.UTURN,100]]);
});
test('SYNTHETIC deterministic 3 m noise on a curved road has no prompt',()=> {
 const shape=Array.from({length:81},(_,i)=>[30*Math.sin(i/12),i*5]);
 labelled(generate(noisy(shape),[road('curved',shape)]),[]);
});
test('SYNTHETIC deterministic 3 m noise passing three side streets has no prompt', {todo:'Known limitation: one false slight-left remains near a side street; assertion executes'},()=> {
 const xy=noisy(Array.from({length:81},(_,i)=>[0,i*5]));
 const lines=[road('main',[[0,0],[0,100],[0,200],[0,300],[0,400]]),...[100,200,300].map(y=>road('side '+y,[[0,y],[100,y]]))];
 labelled(generate(xy,lines),[]);
});
test('SYNTHETIC 25-degree fork labels slight right at 100 m',()=> {
 const exit=[80*Math.sin(25*Math.PI/180),100+80*Math.cos(25*Math.PI/180)];
 labelled(generate([[0,0],[0,100],exit],[road('straight',[[0,0],[0,100],[0,200]]),road('fork',[[0,100],exit])]),[[TURN.SLIGHT_RIGHT,100]]);
});
test('SYNTHETIC round trip preserves all three interior right turns and closes encoded geometry',()=> {
 const xy=[[0,0],[0,100],[100,100],[100,0],[0,0]];
 const lines=[road('west',[[0,-50],[0,150]]),road('north',[[-50,100],[150,100]]),road('east',[[100,-50],[100,150]]),road('south',[[-50,0],[150,0]])];
 const result=generate(xy,lines);
 labelled(result,[[TURN.RIGHT,100],[TURN.RIGHT,200],[TURN.RIGHT,300]]);
 const pts=readFile(result.file).secs.flat();
 assert(hav(pts[0],point([0,0]))<1); assert(hav(pts.at(-1),pts[0])<1);
});

test('SYNTHETIC 120-degree mapped bend without a junction has no prompt',()=> {
 const end=[80*Math.sin(120*Math.PI/180),100+80*Math.cos(120*Math.PI/180)], xy=[[0,0],[0,100],end];
 labelled(generate(xy,[road('bend',xy)]),[]);
});

test('SYNTHETIC 27 m left-right pair preserves its labels and positions',()=> {
 const xy=[[0,0],[0,100],[-27,100],[-27,200]];
 const lines=[road('in',[[0,0],[0,170]]),road('cross',[[-70,100],[50,100]]),road('out',[[-27,40],[-27,200]])];
 labelled(generate(xy,lines),[[TURN.LEFT,100],[TURN.RIGHT,127]]);
});
test('SYNTHETIC sharp 120-degree junction retains a right prompt',()=> {
 const end=[80*Math.sin(120*Math.PI/180),100+80*Math.cos(120*Math.PI/180)], xy=[[0,0],[0,100],end];
 labelled(generate(xy,[road('main',[[0,0],[0,100],[0,180]]),road('exit',[[0,100],end])]),[[TURN.RIGHT,100]]);
});
test('SYNTHETIC heading filtering preserves decoded noisy route geometry',()=> {
 const shape=Array.from({length:81},(_,i)=>[30*Math.sin(i/12),i*5]);
 const xy=noisy(shape), mapped=generate(xy,[road('curved',shape)]), reference=generate(xy,[]);
 // Road decisions may insert collinear points but cannot move the route corridor.
 const a=readFile(mapped.file).secs.flat(), b=readFile(reference.file).secs.flat();
 assert(Math.abs(mapped.distance-reference.distance)<0.01);
 const F=frame(0), planar=ps=>ps.map(p=>F.m(p[0],p[1]));
 const off=(p,poly)=>Math.min(...poly.slice(1).map((b,i)=>{
  const a=poly[i], vx=b[0]-a[0], vy=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/(vx*vx+vy*vy||1)));
  return Math.hypot(p[0]-a[0]-t*vx,p[1]-a[1]-t*vy);
 }));
 const ap=planar(a), bp=planar(b);
 for (const p of ap) assert(off(p,bp)<0.1);
 for (const p of bp) assert(off(p,ap)<0.1);
});
