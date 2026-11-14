import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRoute } from '../js/route.js';
import { draw, readFile, rgb565 } from '../js/preview.js';
import { dashSegments, scanlineSpans } from '../js/device_draw.js';

const start = [51.22, 6.78];
const at = (east, north) => [start[0] + north / 111320, start[1] + east / 70000];
const route = { name: 'Preview test', pts: [0, 50, 100, 150, 200].map(n => [...at(0, n), 0]) };
const road = { kind: 1, name: 'Teststrasse', pts: [at(70, -30), at(70, 240)] };
const pond = [[at(-150, 20), at(-60, 20), at(-60, 160), at(-150, 160), at(-150, 20)]];
const features = {
  water: [pond], green: [pond.map(ring => ring.map(([lat, lon]) => [lat, lon + 0.003]))],
  signals: [at(28, 60)], trams: [[at(-90, 30), at(90, 30)]],
};
const nameImage = () => new Uint8Array(42);
function generate(styled, map = {}, data = features) {
  return buildRoute(route, [road], { id: '11120000', speedKmh: 18, nameImage,
    ...data, map: { styled, ...map } });
}
function render(model, distance = 40, styled, options = {}) {
  const calls = { stroke: [], fill: [], labels: [], positions: [], paths: [], rectangles: [], text: [], alphas: [], events: [] };
  let current = [];
  const context = {
    beginPath() { current = []; }, closePath() {},
    fillRect(...rect) { calls.rectangles.push([this.fillStyle, ...rect]); },
    setLineDash(dash) { assert.deepEqual(dash, []); }, arc() {},
    scale(x, y) { assert.equal(x, 1); assert.equal(y, 1); },
    moveTo(...point) { calls.positions.push(point); current.push(point); },
    lineTo(...point) { calls.positions.push(point); current.push(point); },
    stroke() { calls.events.push(['stroke',this.strokeStyle]); calls.stroke.push(this.strokeStyle); calls.paths.push({ color: this.strokeStyle, points: current, width: this.lineWidth }); calls.alphas.push(this.globalAlpha); },
    fill(rule) { calls.fill.push([this.fillStyle, rule]); },
    strokeText() { assert.fail("firmware uses four offset fills for halos"); }, fillText(label, x, y) { calls.events.push(['text',this.fillStyle]); calls.labels.push(label); calls.text.push([this.fillStyle, label, x, y]); },
    measureText(label) { return { width: label.length * 6 }; },
  };
  Object.defineProperty(context, 'lineJoin', { set(value) { assert(['round', 'bevel', 'miter'].includes(value), 'invalid Canvas lineJoin'); } });
  const canvas = { getContext: () => context };
  draw(canvas, model, distance, styled, options);
  assert.equal(canvas.width, 240);
  assert.equal(canvas.height, 256);
  assert(calls.positions.every(point => point.every(Number.isInteger)));
  return calls;
}
test('stock route draws white and grey junction segments and a blue route', () => {
  const model = readFile(generate(false).file);
  const calls = render(model);
  assert(calls.stroke.includes(rgb565('#c8d0de')));
  assert(calls.stroke.includes(rgb565('#ffffff')));
  assert(calls.stroke.includes(rgb565('#1f6fe0')));
  assert(!calls.stroke.includes(rgb565('#d62828')));
  assert(calls.fill.every(([, rule]) => rule !== 'evenodd'));
  assert.deepEqual(calls.labels, []);
});
test('patched route reads encoded areas, lines, street names and signals', () => {
  const built = generate(true);
  const model = readFile(built.file);
  assert.equal(model.blocks.length, built.sections.length);
  const calls = render(model);
  assert(calls.rectangles.some(([colour]) => colour === rgb565('#72b8f2')));
  assert(calls.rectangles.some(([colour]) => colour === rgb565('#a2d683')));
  assert(calls.stroke.includes(rgb565('#ffc640')));
  assert(calls.stroke.includes(rgb565('#3b1f6e')));
  assert(calls.stroke.includes(rgb565('#ffb300')));
  assert(calls.stroke.includes(rgb565('#d62828')));
  assert(calls.labels.includes('Teststr.'));
});
test('disabled patched layers are absent from the generated preview', () => {
  const model = readFile(generate(true, { names: false }, { water: [pond] }).file);
  const calls = render(model);
  assert.deepEqual(calls.labels, []);
  assert(!calls.stroke.includes(rgb565('#3b1f6e')));
  assert(!calls.stroke.includes(rgb565('#ffb300')));
  assert(calls.stroke.includes(rgb565('#d62828')));
});
test('the selected patch palette also works without map entries', () => {
  const built = buildRoute(route, [], { id: '11120000', speedKmh: 18, nameImage, map: { styled: true } });
  const calls = render(readFile(built.file), 40, true);
  assert(calls.stroke.includes(rgb565('#d62828')));
});

test('the patched preview draws the turn arrow at a nearby corner', () => {
  const corner = {
    secs: [
      [[...at(0, 0), 0], [...at(0, 100), 10000]],
      [[...at(0, 100), 10000], [...at(100, 100), 20000]],
    ],
    blocks: [[], []],
    styled: true,
  };
  assert(!render(corner, 50).stroke.includes(rgb565('#111111')));             // arrow option off: the file has no arrow entries
  const arrow = { style: 15 | (2 << 4) | (1 << 16), center: at(0, 100), points: [at(0, 80), at(0, 100), at(20, 100)] };
  corner.blocks = [[arrow], [arrow]];                                   // arrow option on: class 15 entries in the file
  assert(render(corner, 50).stroke.includes(rgb565('#111111')));
  assert(!render(corner, 150).stroke.includes(rgb565('#111111')));
  assert(!render(corner, 50, false).stroke.includes(rgb565('#111111')));
});

test('fixed-point dash phase carries through bends and zero-length vertices', () => {
  assert.deepEqual([...dashSegments([[0, 0], [3, 0], [3, 0], [3, 6]], 5, 3)], [
    [[0, 0], [3, 0]], [[3, 0], [3, 2]], [[3, 5], [3, 6]],
  ]);
  // Integer square root, then signed truncation, as in map.c (not Canvas dash spacing).
  assert.deepEqual([...dashSegments([[2, 2], [-4, -4]], 3, 2)], [
    [[2, 2], [0, 0]], [[-1, -1], [-4, -4]],
  ]);
});

test('scanline fill clips to native canvas and uses C signed division', () => {
  assert.deepEqual([...scanlineSpans([[-2, -1], [4, -1], [4, 3], [-2, 3]], 3, 2)],
    [[0, 0, 3], [0, 1, 3]]);
  assert.deepEqual([...scanlineSpans([[0, 0], [4, 4], [0, 4]], 240, 256)],
    [[0, 0, 1], [0, 1, 2], [0, 2, 3], [0, 3, 4]]);
  const joinedRings = [[0, 0], [6, 0], [6, 6], [0, 6], [0, 0],
    [2, 2], [2, 4], [4, 4], [4, 2], [2, 2], [0, 0]];
  assert.deepEqual([...scanlineSpans(joinedRings, 240, 256)].filter(([, y]) => y === 2),
    [[0, 2, 2], [4, 2, 2]]);
});

test('encoded area outlines retain the closing segment without browser polygon fill', () => {
  const calls = render(readFile(generate(true).file));
  const outline = calls.paths.find(p => p.color === rgb565('#2f7fcf') && p.width === 1);
  assert(outline);
  assert.deepEqual(outline.points[0], outline.points.at(-1));
  assert(calls.rectangles.filter(([, , , , height]) => height === 1).length > 10);
  assert(calls.fill.every(([, rule]) => rule !== 'evenodd'));
});

test('all eligible encoded curved shafts render; index and distance bounds exclude others', () => {
  const shaft = [at(-10, 55), at(-10, 65), at(10, 70), at(20, 70)];
  const entry = (index, center = at(0, 65)) => ({ style: 15 | (2 << 4) | (index << 16), center, points: shaft });
  const model = { secs: [[[...at(0, 0), 0], [...at(0, 300), 30000]]],
    blocks: [[entry(0), entry(1), entry(2), entry(3), entry(4), entry(1, at(0, 250))]], styled: true };
  const calls = render(model, 50);
  const edges = calls.paths.filter(p => p.color === rgb565('#111111') && p.width === 13);
  assert.equal(edges.length, 6); // three arrows: encoded shaft plus calculated head
  assert.equal(edges[0].points.length, shaft.length);
  assert.notEqual(edges[0].points[0][0], edges[0].points.at(-1)[0]);
  assert.deepEqual(edges[0].points.at(-1), edges[1].points[1]);
  assert.equal(edges[1].points.length, 3);
});

test('labels use Unicode character estimate and four offset white halos', () => {
  const entry = { style: 12, center: at(50, 100), label: 'Straße 🛞' };
  const model = { secs: [[[...at(0, 0), 0], [...at(0, 300), 30000]]], blocks: [[entry]], styled: true };
  const calls = render(model, 50);
  assert.equal(calls.text.length, 5);
  const [color, , x, y] = calls.text.at(-1);
  assert.equal(color, rgb565('#000000'));
  assert.deepEqual(calls.text.slice(0, 4).map(([c, , tx, ty]) => [c, tx - x, ty - y]),
    [[rgb565('#ffffff'), -1, 0], [rgb565('#ffffff'), 1, 0], [rgb565('#ffffff'), 0, -1], [rgb565('#ffffff'), 0, 1]]);
  const tooWide = { ...model, blocks: [[{ ...entry, label: '🛞'.repeat(35) }]] };
  assert.equal(render(tooWide, 50).text.length, 0);
});

test('installed route retains exact firmware opacity and RGB565 colors', () => {
  const calls = render(readFile(generate(true).file));
  const routeIndex = calls.paths.findIndex(p => p.color === rgb565('#d62828'));
  assert.equal(calls.alphas[routeIndex], 180 / 255);
  assert.equal(rgb565('#72b8f2'), '#73baf7');
  assert.equal(rgb565('#ffffff'), '#ffffff');
});

test('far tunnel road edges are solid and translucent after firmware operation remapping', () => {
  const entry = { style: 6 | (2 << 4) | 0x800 | 0x100,
    center: at(40, 0), points: [at(40, 200)] };
  const model = { secs: [[[...at(0, 0), 0], [...at(0, 300), 30000]]],
    blocks: [[entry]], styled: true };
  const calls = render(model, 50);
  const edges = calls.paths.map((p,i)=>[p,calls.alphas[i]])
    .filter(([p])=>p.color===rgb565('#7a7e83'));
  assert.equal(edges.length,1);
  assert.equal(edges[0][0].width,6);
  assert.equal(edges[0][1],115/255);
});

test('cycling study changes water/path styling and route opacity without changing file geometry', () => {
  const model = readFile(generate(true).file), before=structuredClone(model);
  const installed=render(model,40,true), study=render(model,40,true,{profile:'cycling'});
  assert(study.rectangles.some(([color])=>color===rgb565('#82cbd5')));
  assert(installed.rectangles.some(([color])=>color===rgb565('#72b8f2')));
  assert(study.rectangles.some(([color])=>color===rgb565('#a2d683')));
  const i=study.paths.findIndex(p=>p.color===rgb565('#d62828'));
  assert.equal(study.alphas[i],1);
  assert.deepEqual(model,before);
  assert.deepEqual(study.paths.find(p=>p.color===rgb565('#d62828')).points, installed.paths.find(p=>p.color===rgb565('#d62828')).points);
});

test('map canvas starts opaque white as the firmware clear operation requests',()=>{
 for(const styled of [false,true]) {
  const calls=render(readFile(generate(styled).file),40,styled);
  assert.deepEqual(calls.rectangles[0],['#ffffff',0,0,240,256]);
 }
});

test('route and turn overlays remain above map labels as on the device',()=>{
 const calls=render(readFile(generate(true).file));
 const route=calls.events.findIndex(([kind,color])=>kind==='stroke'&&color===rgb565('#d62828'));
 const lastLabel=calls.events.findLastIndex(([kind])=>kind==='text');
 assert(lastLabel>=0 && lastLabel<route);
});

test('cycling study preserves street borders and interiors at junctions and in the distance',()=>{
 const line=(flags,x,kind=6)=>({style:kind|(2<<4)|flags,center:at(x,0),points:[at(x,200)]});
 const area={style:3|(2<<4),center:at(-180,0),points:[at(-100,0),at(-100,180),at(-180,180),at(-180,0)]};
 const model={secs:[[[...at(0,0),0],[...at(0,300),30000]]],
  blocks:[[area,line(0,20),line(0x800,40),line(0x800|0x80,60),line(0x800|0x100,80),line(0x800,100,7)]],styled:true};
 const a=render(model,40,true),b=render(model,40,true,{profile:'cycling'});
 assert(a.paths.some(p=>p.width===1&&p.color===rgb565('#2f7fcf')));
 assert(!b.paths.some(p=>p.width===1&&p.color===rgb565('#378b98')));
 for(const color of ['#3d4146','#000000']) assert.equal(b.paths.filter(p=>p.color===rgb565(color)).length,a.paths.filter(p=>p.color===rgb565(color)).length);
 const roadColors=new Set(['#3d4146','#7a7e83','#f4f4f4','#9a9ea3','#000000','#ffffff'].map(rgb565));
 const roads=calls=>calls.paths.filter(p=>roadColors.has(p.color));
 assert.deepEqual(roads(b),roads(a));
});

test('cycling study keeps ordinary paths distinct from rough marks at native pixel widths',()=>{
 const entry={style:8|(2<<4),center:at(40,0),points:[at(40,200)]};
 const model={secs:[[[...at(0,0),0],[...at(0,300),30000]]],blocks:[[entry]],styled:true};
 const calls=render(model,40,true,{profile:'cycling'});
 const path=calls.paths.filter(p=>p.color===rgb565('#66615a'));
 assert(path.length>1);assert(path.every(p=>p.width===2));
});

test('study fill cancels doubled diagonal hole joins without false background seams',()=>{
 const polygon=[[0,0],[20,0],[20,20],[0,20],[0,0],
  [5,7],[12,7],[12,14],[5,14],[5,7],[0,0]];
 const spans=[...scanlineSpans(polygon,240,256,true)];
 for(let y=0;y<20;y++) {
  const pixels=new Set(spans.filter(s=>s[1]===y).flatMap(([x,,w])=>Array.from({length:w},(_,i)=>x+i)));
  const expected=Array.from({length:20},(_,i)=>i).filter(x=>!(y>=7&&y<14&&x>=5&&x<12));
  assert.deepEqual([...pixels].sort((a,b)=>a-b),expected);
 }
 assert(spans.filter(s=>s[1]===3).length===1,'cancelled join should not fragment spans');
});
