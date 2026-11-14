import assert from 'node:assert/strict';
import {test} from 'node:test';
import {rgb565,mapColor} from '../js/map_style.js';
test('display colors use RGB565 channel precision',()=>{
 assert.equal(rgb565('#ffffff'),'#ffffff');assert.equal(rgb565('#000000'),'#000000');
 assert.equal(rgb565('#0b4fb3'),'#084db5');assert.equal(rgb565(rgb565('#72b8f2')),rgb565('#72b8f2'));
});
test('cycling study retains green and grey and separates water from cycleways',()=>{
 for(const c of ['#a2d683','#d4d4d4'])assert.equal(mapColor(c,'cycling'),mapColor(c,'v18'));
 assert.notEqual(mapColor('#2f7fcf','cycling'),mapColor('#2f7fcf','v18'));
 assert.equal(mapColor('#0b4fb3','cycling'),mapColor('#0b4fb3','v18'));
 assert.equal(mapColor('#72b8f2','unknown'),mapColor('#72b8f2','v18'));
});
test('v19 promotes water and path semantics while preserving roads and land',()=>{
 for(const c of ['#2f7fcf','#72b8f2','#5a3b20'])assert.equal(mapColor(c,'v19'),mapColor(c,'cycling'));
 for(const c of ['#d4d4d4','#a2d683','#0b4fb3','#3d4146','#ffffff','#6b4a2b'])assert.equal(mapColor(c,'v19'),mapColor(c,'v18'));
});
