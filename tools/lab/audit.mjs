import fs from 'node:fs';
const R = new URL('../../js/', import.meta.url).pathname;
const {auditMapSection, MAP_BUDGET} = await import(R + 'map_budget.js'); const {readSections} = await import(R + 'wayback_embed.js');
for (const f of process.argv.slice(2)) {
  const b = new Uint8Array(fs.readFileSync(f)), v = new DataView(b.buffer), mapAt = v.getUint32(0x5c, true), secs = readSections(b), end = Math.min(...secs.map(s => s.offset));
  const c = auditMapSection(b.subarray(mapAt, end)), sum = k => c.reduce((s, x) => s + x[k], 0), max = k => Math.max(...c.map(x => x[k]));
  console.log(f.padEnd(10), 'map B', sum('serializedBytes'), '| blocks', c.length, '| max per block: calls', max('projectionCalls'), '/', MAP_BUDGET.projectionCalls, ' points', max('projectedPoints'), '/', MAP_BUDGET.projectedPoints, ' fillV', max('fillVertices'), '/', MAP_BUDGET.fillVertices, ' ser', max('serializedBytes'), '| sum calls', sum('projectionCalls'), 'points', sum('projectedPoints'));
}
