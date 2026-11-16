#!/usr/bin/env node
// Puts one way-back file at the end of a route file. The device adapter reads it from there.
// Layout: route bytes (already padded to 4,096) | way-back bytes | zero fill | trailer (last 12 bytes).
// Trailer: "CCWT", u32 offset of the way-back bytes, u32 size of the way-back bytes. Little-endian.
// Usage: node tools/wayback_embed.mjs <route.bin> <file.ccwb> <out.bin>
// Host only. The route bytes are not changed. The output stays in .local/ (git ignores it).
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

import {readTrailer, embedWayback} from '../js/wayback_embed.js';
export {readTrailer, embedWayback};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [routePath, wbPath, outPath] = process.argv.slice(2);
  if (!routePath || !wbPath || !outPath) { console.error('usage: node tools/wayback_embed.mjs <route.bin> <file.ccwb> <out.bin>'); process.exit(2); }
  const route = fs.readFileSync(routePath), out = embedWayback(route, fs.readFileSync(wbPath));
  fs.writeFileSync(outPath, out);
  console.log(JSON.stringify({routeBytes: route.length, outBytes: out.length, trailer: readTrailer(out)}));
}
