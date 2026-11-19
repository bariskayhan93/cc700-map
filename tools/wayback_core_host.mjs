// Builds the way-back host command once per process and runs it on a file and tick lines.
// Used by the tests and by tools/wayback_replay.mjs. Host only; no device, no network.
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'wayback-core-'));
process.on('exit', () => { try { fs.rmSync(work, {recursive: true, force: true}); } catch {} });
let exe = null;

function binary() {
  if (exe) return exe;
  const out = path.join(work, 'wayback_host');
  execFileSync('cc', ['-std=c11', '-O1', '-g', '-Wall', '-Wextra', '-Werror',
    '-fsanitize=address,undefined', '-fno-sanitize-recover=all',
    '-I', path.join(root, 'firmware/wayback'),
    path.join(root, 'tools/wayback_host.c'), '-o', out], {stdio: ['ignore', 'pipe', 'pipe']});
  exe = out;
  return exe;
}

// lines: [{latE7, lonE7, exitCm = 0, flags, maxPoints = 64, failReadAfter = -1}]
// Returns one object per line: {mounted, state, reason, distanceDm, forward, changed, reads, points, piece, pieceAt}.
export function runCore(fileBytes, routeId, lines) {
  const dir = fs.mkdtempSync(path.join(work, 'run-'));
  const file = path.join(dir, 'file.ccwb');
  fs.writeFileSync(file, Buffer.from(fileBytes));
  const hex = Buffer.from(routeId).toString('hex');
  const input = lines.map(l => [l.latE7, l.lonE7, l.exitCm ?? 0, l.flags, l.maxPoints ?? 64, l.failReadAfter ?? -1, l.pieceId ?? -1].join(' ')).join('\n') + '\n';
  let text;
  try {
    text = execFileSync(binary(), [file, hex], {input, maxBuffer: 1 << 30, encoding: 'utf8'});
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
  return text.split('\n').filter(Boolean).map(line => {
    const r = JSON.parse(line);
    return {
      mounted: r.mounted, state: r.state ?? 0, reason: r.reason ?? 0, distanceDm: r.distanceDm ?? 0,
      forward: r.forward ?? 0, changed: r.changed ?? 0, reads: r.reads ?? 0, points: r.points ?? [],
      piece: r.piece ?? 0xFFFFFFFF, pieceAt: r.pieceAt,
    };
  });
}

// Self tests of the core (C, static helpers included) on one file: wb_out against the old far test, and the scan order.
export function runSelfTest(fileBytes, routeId) {
  const dir = fs.mkdtempSync(path.join(work, 'self-'));
  const file = path.join(dir, 'file.ccwb');
  fs.writeFileSync(file, Buffer.from(fileBytes));
  try {
    const out = execFileSync(binary(), ['--selftest', file, Buffer.from(routeId).toString('hex')], {maxBuffer: 1 << 20, encoding: 'utf8'});
    return JSON.parse(out.trim());
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
  }
}
