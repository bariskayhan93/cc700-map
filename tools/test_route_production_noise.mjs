// Hand-labelled metric road fixtures exercise the production policy. No private coordinates.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {buildRoute,TURN} from '../js/route.js';
import {readFile} from '../js/preview.js';
import {frame} from '../js/geo.js';
const point=([x,y])=>[y/111320,x/111320,0];
const road=(name,xy)=>({name,kind:1,pts:xy.map(point)});
const generate=(xy,lines)=>buildRoute({name:'synthetic production',pts:xy.map(point)},lines,{id:'test',nameImage:()=>new Uint8Array(42),map:{}});
function noisy(shape,seed=7){const random=()=> (seed=seed*16807%2147483647)/2147483647;const gaussian=()=>Math.sqrt(-2*Math.log(random()))*Math.cos(2*Math.PI*random());return shape.map(([x,y])=>[x+3*gaussian(),y+3*gaussian()]);}
function labelled(result,labels,tolerance=12){const actual=result.sections.filter(s=>s.dir);assert.deepEqual(actual.map(s=>s.dir),labels.map(l=>l[0]));actual.forEach((s,i)=>assert(Math.abs(s.dist-labels[i][1])<=tolerance,`turn ${i} at ${s.dist}, expected ${labels[i][1]} ±${tolerance}m`));}
test('production noisy straight passage does not manufacture a turn onto side streets',()=>{
 const shape=Array.from({length:81},(_,i)=>[0,i*5]);
 const lines=[road('main',[[0,0],[0,100],[0,200],[0,300],[0,400]]),...[100,200,300].map(y=>road('side',[[0,y],[100,y]]))];
 labelled(generate(noisy(shape),lines),[]);
});
test('production straight-passage guard retains a 25 degree departing fork',()=>{
 const angle=25*Math.PI/180,end=[120*Math.sin(angle),100+120*Math.cos(angle)],shape=[];
 for(let y=0;y<=100;y+=5)shape.push([0,y]);
 for(let d=5;d<=120;d+=5)shape.push([d*Math.sin(angle),100+d*Math.cos(angle)]);
 labelled(generate(shape,[road('main',[[0,0],[0,100],[0,250]]),road('fork',[[0,100],end])]),[[TURN.SLIGHT_RIGHT,100]]);
});
test('production straight-passage guard retains 22 metre right-left decisions',()=>{
 labelled(generate([[0,0],[0,100],[22,100],[22,200]],[road('in',[[0,0],[0,170]]),road('cross',[[-50,100],[70,100]]),road('out',[[22,40],[22,200]])]),[[TURN.RIGHT,100],[TURN.LEFT,122]]);
});

test('production guard preserves true reversals and the opposite 27 metre close pair',()=>{
 labelled(generate([[0,0],[0,100],[0,0]],[road('dead end',[[0,0],[0,100]])]),[[TURN.UTURN,100]]);
 labelled(generate([[0,0],[0,100],[-27,100],[-27,200]],[road('in',[[0,0],[0,170]]),road('cross',[[-70,100],[50,100]]),road('out',[[-27,40],[-27,200]])]),[[TURN.LEFT,100],[TURN.RIGHT,127]]);
});
test('production guard preserves a coarse explicit junction instead of inferring omitted geometry',()=>{
 labelled(generate([[0,0],[0,300],[300,300]],[road('in',[[0,0],[0,300],[0,500]]),road('out',[[0,300],[300,300]])]),[[TURN.RIGHT,300]]);
});
test('production noisy heading analysis preserves the encoded corridor and route distance',()=>{
 const xy=noisy(Array.from({length:81},(_,i)=>[0,i*5]));
 const mapped=generate(xy,[road('main',[[0,0],[0,100],[0,200],[0,300],[0,400]]),road('side',[[0,300],[100,300]])]),reference=generate(xy,[]);
 assert(Math.abs(mapped.distance-reference.distance)<0.01);
 const F=frame(0),planar=r=>readFile(r.file).secs.flat().map(p=>F.m(p[0],p[1]));
 const off=(p,poly)=>Math.min(...poly.slice(1).map((b,i)=>{const a=poly[i],vx=b[0]-a[0],vy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/(vx*vx+vy*vy||1)));return Math.hypot(p[0]-a[0]-t*vx,p[1]-a[1]-t*vy);}));
 const a=planar(mapped),b=planar(reference);for(const p of a)assert(off(p,b)<0.1);for(const p of b)assert(off(p,a)<0.1);
});

for(const seed of [1,3,8,15,22,35,44,47])test(`production hand-labelled straight passage rejects seeded noise ${seed}`,()=>{
 const xy=noisy(Array.from({length:81},(_,i)=>[0,i*5]),seed);
 const lines=[road('main',[[0,0],[0,100],[0,200],[0,300],[0,400]]),...[100,200,300].map(y=>road('side',[[0,y],[100,y]]))];
 labelled(generate(xy,lines),[]);
});
test('production retains a short fork that rejoins the through road by 30 metres',()=>{
 const x=15*Math.sin(25*Math.PI/180),y=100+15*Math.cos(25*Math.PI/180);
 const xy=[[0,0],[0,100],[x,y],[0,127],[0,200]];
 labelled(generate(xy,[road('main',[[0,0],[0,100],[0,127],[0,200]]),road('short fork',[[0,100],[x,y],[0,127]])]),[[TURN.SLIGHT_RIGHT,100]]);
});
test('production retains a real 10 metre mapped dead-end excursion and its reversal',()=>{
 labelled(generate([[0,0],[0,100],[10,100],[0,100],[0,200]],[road('main',[[0,0],[0,100],[0,200]]),road('dead end',[[0,100],[10,100]])]),[[TURN.RIGHT,100],[TURN.UTURN,110],[TURN.RIGHT,120]],3);
});
test('production preserves retracing when the mapped side street continues beyond the reversal',()=>{
 labelled(generate([[0,0],[0,100],[10,100],[0,100],[0,200]],[road('main',[[0,0],[0,100],[0,200]]),road('side',[[0,100],[100,100]])]),[[TURN.RIGHT,100],[TURN.UTURN,110],[TURN.RIGHT,120]],3);
});
test('production retains a real rounded turnaround with separate outbound and return lanes',()=>{
 for(const laneOffset of [2,4]) {
 const xy=[[0,0],[0,100],[8,100],[9.414214,100.585786],[10,102],[9.414214,103.414214],[8,104],[0,100+laneOffset],[0,200]];
 const result=generate(xy,[road('main',[[0,0],[0,100],[0,200]]),road('side',[[0,100],[100,100]])]);
 assert(result.sections.some(s=>s.dir===TURN.UTURN&&Math.abs(s.dist-111)<5),'the rounded reversal must remain visible near the actual apex');
 }
});
test('rounded-turnaround evidence uses sustained legs across dense source samples',()=>{
 const corners=[[0,0],[0,100],[8,100],[9.414214,100.585786],[10,102],[9.414214,103.414214],[8,104],[0,102],[0,200]],xy=[corners[0]];
 for(let i=1;i<corners.length;i++){const a=corners[i-1],b=corners[i],n=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/2);for(let j=1;j<=n;j++)xy.push([a[0]+(b[0]-a[0])*j/n,a[1]+(b[1]-a[1])*j/n]);}
 const result=generate(xy,[road('main',[[0,0],[0,100],[0,200]]),road('side',[[0,100],[100,100]])]);
 assert(result.sections.some(s=>s.dir===TURN.UTURN&&Math.abs(s.dist-111)<5),'dense sampling must retain the same real reversal');
});
