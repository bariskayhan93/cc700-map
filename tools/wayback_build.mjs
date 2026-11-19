#!/usr/bin/env node
// Builds one way-back file from private ride inputs and prints one JSON size report.
// Usage: node tools/wayback_build.mjs <config.json> <out.ccwb> [--reach line1k|line2k|line3k|ride1500] [--exceptions] [--max-bytes N] [--format 1|2] [--layer]
// --layer (format 2): also the fitted grey section, written to <out.ccwb>.grey (section type 2). Host only. The file and the report stay in .local/ (git ignores it). Exit 3: file too large.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readNativeRoute} from './recovery_planner.mjs';
import {forwardChainsOpen} from './wayback_tree.mjs';
import {decodeWayback} from './wayback_format.mjs';
import {waybackFromSnapshot} from '../js/wayback.js';
import {REACH} from '../js/wayback_tree.js';

const MB = 1048576, FREE_MB = 5.58;

function parseArgs(argv) {
  const out = {reach: 'line2k', exceptions: false, maxBytes: 0};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--reach') out.reach = argv[++i];
    else if (argv[i] === '--exceptions') out.exceptions = true;
    else if (argv[i] === '--max-bytes') out.maxBytes = Number(argv[++i]);
    else if (argv[i] === '--format') out.format = Number(argv[++i]);
    else if (argv[i] === '--layer') out.layer = true;
    else throw new Error(`unknown argument ${argv[i]}`);
  }
  if (!REACH[out.reach] && out.reach !== 'ride1500') throw new Error(`unknown reach ${out.reach}`);
  return out;
}

function main() {
  const [configPath, outPath, ...rest] = process.argv.slice(2);
  if (!configPath || !outPath) {
    console.error('usage: node tools/wayback_build.mjs <config.json> <out.ccwb> [--reach line1k|line2k|line3k|ride1500] [--exceptions] [--max-bytes N] [--format 1|2] [--layer]');
    return 2;
  }
  const args = parseArgs(rest);
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const snapshot = JSON.parse(fs.readFileSync(cfg.snapshot, 'utf8'));
  const routeBytes = fs.readFileSync(cfg.route);
  const route = readNativeRoute(routeBytes);
  const routeId = createHash('sha256').update(routeBytes).digest().subarray(0, 16);
  const made = waybackFromSnapshot(snapshot, route, routeId, {...args, routeBytes});
  if (!made) {
    console.error(`file is above --max-bytes ${args.maxBytes}; no file written`);
    return 3;
  }
  const {bytes, reach, model} = made;
  fs.mkdirSync(path.dirname(outPath), {recursive: true});
  fs.writeFileSync(outPath, bytes);
  if (made.grey) fs.writeFileSync(outPath + '.grey', made.grey);

  const d = decodeWayback(bytes);
  const excCount = d.chunks.reduce((s, c) => s + c.length, 0);
  const routeKm = route.at(-1).progress / 1e5;
  const mbAt70km = bytes.length / routeKm * 70 / MB;
  const report = {
    reach,
    exceptions: args.exceptions,
    routeKm,
    bytes: bytes.length,
    sections: {
      header: 64,
      cells: (d.header.cellCount + 1) * 12,
      nodes: d.header.nodeCount * 12,
      extras: d.header.extraCount * 8,
      chunkTable: d.header.chunkCount ? (d.header.chunkCount + 1) * 4 : 0,
      exceptions: excCount * 8,
    },
    kbPerKm: bytes.length / 1024 / routeKm,
    mbAt70km,
    totalAt70km: {routeFile2_5: mbAt70km + 2.5, routeFile4_0: mbAt70km + 4.0},
    freeMb: FREE_MB,
    stats: model.stats,
    forwardChains: args.exceptions ? forwardChainsOpen(model) : null,
    grey: made.grey ? {bytes: made.grey.length, ...made.greyReport} : made.greyReport,
  };
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
