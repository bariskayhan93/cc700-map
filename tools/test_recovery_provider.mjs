import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createProvider,routeCandidates,PROVIDER} from './recovery_provider.mjs';
const p=(x,y)=>[51+y/111320,7+x/(111320*Math.cos(51*Math.PI/180))];
function build(pts){const out=[];let prog=0;pts.forEach((q,i)=>{if(i){const a=pts[i-1];prog+=Math.round(Math.hypot(q[0]-a[0],q[1]-a[1])*100);}out.push({point:p(...q),progress:prog});});return out;}
// Lollipop: unique lead-in, stem out east (x 0..1000), unique loop, stem back west on the same street, unique lead-out.
const R=build([[-1000,-200],[0,0],[1000,0],[1000,500],[2000,500],[2000,0],[1000,0],[0,0],[-1000,200]]);
// Lap: the street x 0..1000 is ridden twice in the same direction (east), joined by a block loop.
const L=build([[-1000,-200],[0,0],[1000,0],[1000,500],[0,500],[0,0],[1000,0],[2000,-200]]);
function ride(provider,points,t0=0,dt=1){return points.map((q,i)=>provider.step({t:t0+i*dt,point:p(...q)}));}

test('a fix on a street ridden twice has one candidate per pass',()=>{
 const c=routeCandidates(R,p(500,3));
 assert.equal(c.length,2);
 assert(c.some(v=>Math.abs(v.progressCm-(R[1].progress+50000))<500));
 assert(c.some(v=>Math.abs(v.progressCm-(R[6].progress+50000))<500));
});

test('a single-pass fix is ordered and becomes the anchor',()=>{
 const [r]=ride(createProvider(R),[[-500,-100]]);
 assert.equal(r.onRoute,true);assert.equal(r.ordered,true);assert.equal(r.reason,'single-pass');
});

test('heading picks the outbound pass of an out-and-back street',()=>{
 const steps=[];for(let x=-60;x<=300;x+=10)steps.push([x,x<0?x*0.2:0]);
 const last=ride(createProvider(R),steps).at(-1);
 assert.equal(last.ordered,true);assert.equal(last.reason,'heading');
 assert(Math.abs(last.progressCm-(R[1].progress+30000))<1500);
});

test('heading picks the return pass after the loop',()=>{
 const steps=[[1500,500],[1700,500],[1900,500],[2000,400],[2000,200],[2000,0],[1800,0],[1600,0],[1400,0],[1200,0],[1000,0],[900,0],[800,0]];
 const last=ride(createProvider(R),steps).at(-1);
 assert.equal(last.ordered,true);assert.equal(last.reason,'heading');
 assert(Math.abs(last.progressCm-(R[6].progress+20000))<2000,'return pass expected, got '+last.progressCm);
});

test('heading needs no anchor on an out-and-back street',()=>{
 const last=ride(createProvider(R),[[600,0],[590,0]]).at(-1);   // on the shared street, moving west: return pass
 assert.equal(last.ordered,true);assert.equal(last.reason,'heading');
 assert(last.progressCm>R[5].progress);
});

test('without heading or anchor a two-pass fix stays unordered',()=>{
 const [r]=ride(createProvider(R),[[500,0]]);
 assert.equal(r.onRoute,true);assert.equal(r.ordered,false);assert.equal(r.reason,'ambiguous-no-anchor');
});

test('same-direction passes ahead of the anchor stay unordered instead of guessing',()=>{
 const steps=[];for(let x=-60;x<=300;x+=10)steps.push([x,x<0?x*0.2:0]);
 const pr=createProvider(L);const last=ride(pr,steps).at(-1);
 assert.notEqual(pr.anchorCm,null);
 assert.equal(last.ordered,false);assert.equal(last.reason,'ambiguous-several-ahead');
});

test('same-direction passes without an anchor stay unordered',()=>{
 const last=ride(createProvider(L),[[300,0],[310,0]]).at(-1);
 assert.equal(last.ordered,false);assert.equal(last.reason,'ambiguous-no-anchor');
});

test('a gap with real movement clears the anchor and the heading',()=>{
 const pr=createProvider(L);
 ride(pr,[[-60,-12],[-40,-8],[0,0],[20,0]]);
 const afterGap=pr.step({t:3+PROVIDER.gapS+1,point:p(500,0)});
 assert.equal(pr.anchorCm,null);
 assert.equal(afterGap.ordered,false);assert.equal(afterGap.reason,'ambiguous-no-anchor');
 assert.equal(pr.step({t:3+PROVIDER.gapS+2,point:p(-200,-40)}).ordered,true);
});

test('a stop gap keeps the anchor; the heading returns with the next movement',()=>{
 const pr=createProvider(R);
 ride(pr,[[-60,-12],[-40,-8],[0,0],[20,0]]);
 const before=pr.anchorCm;assert.notEqual(before,null);
 const atStop=pr.step({t:40,point:p(25,0)});      // 37 s gap, moved 5 m: a stop
 assert.notEqual(pr.anchorCm,null);
 assert.equal(atStop.ordered,false);               // no heading right after a gap
 const moving=pr.step({t:41,point:p(35,0)});
 assert.equal(moving.ordered,true);assert.equal(moving.reason,'heading');
 assert(Math.abs(moving.progressCm-(R[1].progress+3500))<1500);
});

test('a clock that runs backward always clears the anchor',()=>{
 const pr=createProvider(L);
 ride(pr,[[-60,-12],[-40,-8],[0,0],[20,0]]);
 const r=pr.step({t:2,point:p(25,0)});
 assert.equal(r.ordered,false);assert.equal(r.reason,'ambiguous-no-anchor');
});

test('turning off the route keeps the trusted pass through the anchor',()=>{
 const pr=createProvider(R);
 const out=ride(pr,[[1500,500],[2000,250],[2000,0],[1500,0],[1000,0],[700,0],[600,0]]);
 assert.equal(out.at(-1).reason,'heading');
 const turning=pr.step({t:out.length,point:p(595,12)});   // heading north: fits neither pass
 assert.equal(turning.ordered,true);assert.equal(turning.reason,'continuity');
 assert(turning.progressCm>R[6].progress,'must stay on the return pass');
});

test('a pass behind the anchor is never chosen, even when the heading fits it',()=>{
 const pr=createProvider(R);
 const out=ride(pr,[[1500,500],[2000,250],[2000,0],[1500,0],[1000,0],[700,0],[500,0]]);
 assert.equal(out.at(-1).ordered,true);
 const r=pr.step({t:out.length,point:p(600,0)});   // turned around: heading east fits only the outbound pass
 assert.equal(r.ordered,false);assert.equal(r.reason,'ambiguous-no-fit');
});

test('a hairpin cut never locks onto the pass the rider skipped',()=>{
 // After a detour the rider rejoins the lap street: both laps lie ahead, so nothing is guessed.
 const pr=createProvider(L);
 ride(pr,[[-500,-100]]);
 const off=[];for(let i=1;i<=60;i++)off.push([-500,-100-i*100]);
 ride(pr,off,1,1);
 pr.step({t:61,point:p(300,0)});
 const r=pr.step({t:62,point:p(310,0)});
 assert.equal(r.ordered,false);assert.equal(r.reason,'ambiguous-several-ahead');
});

test('off-route fixes report distance and keep the anchor',()=>{
 const pr=createProvider(R);ride(pr,[[-500,-100]]);
 const r=pr.step({t:1,point:p(-500,0)});
 assert.equal(r.onRoute,false);assert.equal(r.ordered,false);assert(r.offRouteM>50);
});
