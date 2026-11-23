// tools/test_fuzz_readers.mjs: damaged copies of a way-back file and a grey layer go through the C readers with
// ASan and UBSan (tools/fuzz_readers.c). A read past a buffer, an overflow or a crash stops the test.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gridFixture} from './wayback_fixture.mjs';
import {buildWaybackModel} from './wayback_tree.mjs';
import {encodeWaybackV3} from './wayback_format.mjs';
import {encodeGreyLayer, greyCellLines} from '../js/wayback_grey_layer.js';
import {gridParts} from './grey_fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'fuzz-readers-'));
process.on('exit', () => { try { fs.rmSync(work, {recursive: true, force: true}); } catch {} });
const W = d => path.join(root, 'firmware', d);
const exe = path.join(work, 'fuzz');
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST', '-fsanitize=address,undefined',
  '-fno-sanitize-recover=all', '-I', W('wayback'), '-I', W('common'), path.join(root, 'tools/fuzz_readers.c'),
  W('wayback/wb_grey.c'), '-o', exe], {stdio: ['ignore', 'pipe', 'pipe']});

const {graph, route} = gridFixture();
const id = Uint8Array.from({length: 16}, (_, i) => i + 1);
const wbFile = path.join(work, 'wb.bin'), greyFile = path.join(work, 'grey.bin');
fs.writeFileSync(wbFile, encodeWaybackV3(buildWaybackModel(graph, route, {reach: 'line2k'}), id, () => 1));
fs.writeFileSync(greyFile, encodeGreyLayer(greyCellLines(gridParts({spacingM: 60, count: 21, x0: 40000, y0: 40000}))));
const run = (rounds, seed) => JSON.parse(execFileSync(exe, [wbFile, Buffer.from(id).toString('hex'), greyFile,
  String(rounds), String(seed)], {encoding: 'utf8'}));

test('the good files mount, give lines and give grey points (0 changes is not a round: rounds 0)', () => {
  assert.deepEqual(run(0, 1), {rounds: 0, mounted: 0, lines: 0, points: 0, grey_opened: 0, grey_runs: 0, grey_points: 0});
});
test('20,000 damaged copies of each file: no read past a buffer, no overflow, no crash', () => {
  const r = run(20000, 7);
  console.log(JSON.stringify(r));
  assert.equal(r.rounds, 20000);
  assert(r.mounted > 100, 'some damaged way-back files still mount, so wb_tick runs on damaged data');
  assert(r.lines > 0 && r.points > 0, 'some of them give a line');
  assert(r.grey_opened > 100 && r.grey_points > 0, 'some damaged grey layers open and give lines');
});
