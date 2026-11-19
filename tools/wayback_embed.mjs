#!/usr/bin/env node
// Puts the way-back file (section type 1) and the grey file (type 2, optional) at the end of a route file. The device
// adapter reads them from there. Layout: js/wayback_embed.js (cc27 trailer v2, section table in the last 64 bytes).
// Usage: node tools/wayback_embed.mjs <route.bin> <file.ccwb> <out.bin> [file.ccwb.grey]
// Host only. The route bytes are not changed. The output stays in .local/ (git ignores it).
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';

import {SECTION, readSections, embedSections} from '../js/wayback_embed.js';
export {SECTION, readSections, embedSections};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [routePath, wbPath, outPath, greyPath] = process.argv.slice(2);
  if (!routePath || !wbPath || !outPath) { console.error('usage: node tools/wayback_embed.mjs <route.bin> <file.ccwb> <out.bin> [file.ccwb.grey]'); process.exit(2); }
  const sections = [{type: SECTION.WAYBACK, bytes: fs.readFileSync(wbPath)}, ...(greyPath ? [{type: SECTION.GREY, bytes: fs.readFileSync(greyPath)}] : [])];
  const route = fs.readFileSync(routePath), out = embedSections(route, sections);
  fs.writeFileSync(outPath, out);
  console.log(JSON.stringify({routeBytes: route.length, outBytes: out.length, sections: readSections(out)}));
}
