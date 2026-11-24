// tools/test_wb_cache.mjs: firmware/wayback/wb_cache.c on the host (WP 5 and WP 7, 24 Nov). The page cache between
// the file and every reader of a frame (far map and way-back): same bytes, fewer file reads, empty on a new route.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wbcache-'));
process.on('exit', () => { try { fs.rmSync(work, {recursive: true, force: true}); } catch {} });
const exe = path.join(work, 'wc');
const src = path.join(work, 'wc_host.c');
fs.writeFileSync(src, `
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "wb_cache.h"
static uint8_t file[300000]; static uint32_t fsize, raw;
static int rd(void *ctx, uint32_t off, void *dst, uint32_t n) {
  (void)ctx; if (off > fsize || n > fsize - off) return 0; raw++; memcpy(dst, file + off, n); return 1; }
int main(int argc, char **argv) {
  static wc_cache c; uint8_t out[4096]; uint32_t bad = 0, reads = 0, k;
  fsize = (uint32_t)atoi(argv[1]); for (k = 0; k < fsize; k++) file[k] = (uint8_t)(k * 2654435761u >> 13);
  wc_reset(&c, 1u, fsize);
  for (int i = 2; i + 1 < argc; i += 2) {
    uint32_t off = (uint32_t)strtoul(argv[i], 0, 10), n = (uint32_t)strtoul(argv[i + 1], 0, 10);
    if (off == 0xFFFFFFFFu) { wc_reset(&c, n, fsize); continue; }        /* new route key */
    reads++; memset(out, 0xEE, sizeof out);
    int ok = wc_read(&c, rd, 0, off, out, n);
    int want = off <= fsize && n <= fsize - off;
    if (ok != want || (ok && memcmp(out, file + off, n))) bad++;
  }
  printf("{\\"bad\\":%u,\\"reads\\":%u,\\"raw\\":%u,\\"hits\\":%u}\\n", bad, reads, raw, c.hits);
  return 0;
}`);
execFileSync('cc', ['-std=gnu11', '-O1', '-g', '-Wall', '-Wextra', '-Werror', '-DHOST',
  '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-I', path.join(root, 'firmware/wayback'),
  src, path.join(root, 'firmware/wayback/wb_cache.c'), '-o', exe], {stdio: ['ignore', 'pipe', 'pipe']});
const run = (size, ...reqs) => JSON.parse(execFileSync(exe, [size, ...reqs.flat()].map(String), {encoding: 'utf8'}));

test('a second frame with the same reads makes no file read and gives the same bytes', () => {
  const frame = [[0, 48], [48, 1024], [5000, 576], [9000, 2048], [123457, 8], [123465, 8], [200001, 192]];
  const one = run(250000, ...frame), two = run(250000, ...frame, ...frame);
  assert.equal(one.bad, 0); assert.equal(two.bad, 0);
  assert.equal(two.raw, one.raw);
  assert.equal(two.hits, one.hits + frame.length);   // reads on one page in the first frame are hits too
});

test('reads across page ends, at the file end and past it give the file bytes or a failed read', () => {
  const size = 3 * 1024 + 100, r = run(size, [1000, 100], [2040, 2000], [size - 10, 10], [size - 10, 11], [size, 0], [size + 1, 1]);
  assert.equal(r.bad, 0);
});

test('a new route key empties the cache: the same reads go to the file again', () => {
  const frame = [[0, 48], [7000, 300]];
  const r = run(50000, ...frame, [0xFFFFFFFF, 2], ...frame);
  assert.equal(r.bad, 0);
  assert.equal(r.hits, 0);
});

test('more pages than the cache holds: old pages go first, every read stays correct', () => {
  const reqs = Array.from({length: 400}, (_, i) => [(i * 7919 * 13) % 290000, 1 + (i * 37) % 2000]);
  const r = run(295000, ...reqs, ...reqs);
  assert.equal(r.bad, 0);
  assert.ok(r.raw > 400);
});

test('48 pages of 1,024 B: the far frame of 20 cells (bodies of at most 2,048 B) and a way-back frame stay warm', () => {
  const far = [[0, 1072], ...Array.from({length: 20}, (_, i) => [2000 + i * 1500, 600 + (i * 97) % 1400])];
  const wb = Array.from({length: 60}, (_, i) => [150000 + i * 40, 8]);
  const once = run(250000, ...far, ...wb), twice = run(250000, ...far, ...wb, ...far, ...wb);
  assert.equal(twice.bad, 0);
  assert.equal(twice.raw, once.raw);
});
