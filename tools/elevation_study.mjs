// PC-only spike. This is neither a device codec nor a native climb decoder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parse, unzz } from '../js/pb.js';

// The production helper is permissive on truncated varints; validate this
// study's section/point boundaries before using it on imported bytes.
function checkedFields(bytes) {
  let offset = 0;
  const varint = () => {
    let value = 0, multiplier = 1;
    for (let n = 0; n < 8; n++) {
      if (offset >= bytes.length) throw Error('Truncated varint');
      const byte = bytes[offset++]; value += (byte & 127) * multiplier;
      if (!Number.isSafeInteger(value)) throw Error('Oversized varint');
      if (!(byte & 128)) return value;
      multiplier *= 128;
    }
    throw Error('Oversized varint');
  };
  while (offset < bytes.length) {
    const key = varint(), type = key % 8;
    if (key < 8) throw Error('Invalid field number');
    if (type === 0) varint();
    else if (type === 2) { const length = varint(); offset += length; }
    else if (type === 5) offset += 4;
    else if (type === 1) offset += 8;
    else throw Error('Invalid wire type');
    if (offset > bytes.length) throw Error('Truncated field');
  }
  return parse(bytes);
}

export function readRouteElevations(bytes) {
  if (bytes.length < 128 || bytes.length > 16 * 1024 * 1024) throw Error('Route size outside study bounds');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sections = view.getUint16(0x46, true), points = [];
  if (!sections) throw Error('No route sections');
  let offset = 128;
  for (let section = 0; section < sections; section++) {
    if (offset + 4 > bytes.length) throw Error('Truncated section header');
    const length = view.getUint32(offset, true);
    if (!length || length > 65536 || offset + 4 + length > bytes.length) throw Error('Invalid section size');
    for (const [field, type, value] of checkedFields(bytes.subarray(offset + 4, offset + 4 + length))) {
      if (field !== 3) continue;
      if (type !== 2) throw Error('Invalid point wire type');
      const fields = Object.fromEntries(checkedFields(value).map(([key, type, value]) => [key, [type, value]]));
      if (fields[5]?.[0] !== 0 || (fields[3] && fields[3][0] !== 0)) throw Error('Invalid point fields');
      points.push({ distance: fields[5][1] / 100, elevation: fields[3] ? unzz(fields[3][1]) / 100 : null });
      if (points.length > 100000) throw Error('Too many study points');
    }
    offset += 4 + length;
  }
  return points;
}

export function elevationStrip(points, options = {}) {
  const { progress, onRoute, progressValid, width = 224, height = 16,
    horizon = 1000, maxGap = 250, minVerticalSpan = 40, zeroElevationConfirmed = false } = options;
  if (!Number.isInteger(width) || width < 2 || width > 240 || !Number.isInteger(height) || height < 2 || height > 128 ||
      ![horizon, maxGap, minVerticalSpan].every(x => Number.isFinite(x) && x > 0)) throw Error('Invalid strip bounds');
  const unavailable = reason => ({ status: 'unavailable', reason, packet: null, columns: [], deviceValidated: false });
  if (onRoute !== true || progressValid !== true || !Number.isFinite(progress)) return unavailable('route-progress-untrusted');
  if (!Array.isArray(points) || points.length > 100000) throw Error('Invalid study points');
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p || !Number.isFinite(p.distance) || p.distance < 0 || (i && p.distance < points[i - 1].distance) ||
        (p.elevation !== null && !Number.isFinite(p.elevation))) throw Error('Invalid ordered elevation points');
  }
  if (points.length < 2 || progress < points[0].distance || progress >= points.at(-1).distance) return unavailable('outside-route');
  const known = points.filter(p => p.elevation !== null);
  if (!known.length || (!zeroElevationConfirmed && known.every(p => p.elevation === 0))) return unavailable('elevation-absent-or-ambiguous-zero');
  // Duplicate section endpoints are common. Conflicting duplicates are gaps.
  const unique = [];
  for (const p of points) {
    const previous = unique.at(-1);
    if (previous?.distance === p.distance) {
      if (previous.elevation !== p.elevation) previous.elevation = null;
    } else unique.push({ ...p });
  }
  const end = Math.min(progress + horizon, unique.at(-1).distance), span = end - progress;
  const bins = Array.from({ length: width }, () => []), blocked = new Set();
  let segments = 0, columnVisits = 0;
  for (let i = 1; i < unique.length; i++) {
    const a = unique[i - 1], b = unique[i];
    if (b.distance <= progress || a.distance >= end) continue;
    const lo = Math.max(progress, a.distance), hi = Math.min(end, b.distance);
    const first = Math.max(0, Math.floor((lo - progress) / span * width));
    const last = Math.min(width - 1, Math.ceil((hi - progress) / span * width) - 1);
    const valid = a.elevation !== null && b.elevation !== null && b.distance - a.distance <= maxGap;
    segments++;
    for (let x = first; x <= last; x++) {
      columnVisits++;
      if (!valid) { blocked.add(x); continue; }
      for (const d of [Math.max(lo, progress + span * x / width), Math.min(hi, progress + span * (x + 1) / width)]) {
        bins[x].push(a.elevation + (b.elevation - a.elevation) * (d - a.distance) / (b.distance - a.distance));
      }
    }
  }
  const samples = bins.flatMap((v, x) => blocked.has(x) ? [] : v);
  if (!samples.length) return unavailable('no-contiguous-elevation');
  const actualMin = samples.reduce((a, b) => Math.min(a, b), Infinity), actualMax = samples.reduce((a, b) => Math.max(a, b), -Infinity);
  const verticalSpan = Math.max(minVerticalSpan, actualMax - actualMin), center = (actualMin + actualMax) / 2;
  const low = center - verticalSpan / 2, high = center + verticalSpan / 2;
  const y = e => Math.max(0, Math.min(height - 1, Math.round((high - e) / verticalSpan * (height - 1))));
  const packet = new Uint8Array(width * 2).fill(255), columns = [];
  for (let x = 0; x < width; x++) {
    if (!bins[x].length || blocked.has(x)) continue;
    const top = y(bins[x].reduce((a, b) => Math.max(a, b), -Infinity));
    const bottom = y(bins[x].reduce((a, b) => Math.min(a, b), Infinity));
    packet[x * 2] = top; packet[x * 2 + 1] = bottom;
    columns.push({ x, top, bottom });
  }
  if (columns.length < 2) return unavailable('insufficient-visible-elevation');
  return { status: 'candidate', start: progress, end, horizonMeters: span, width, height,
    domainMeters: [low, high], elevationRangeMeters: [actualMin, actualMax], packet, columns,
    cost: { packetBytes: packet.byteLength, validColumns: columns.length, missingColumns: width - columns.length,
      sourcePointsScanned: points.length, intersectingSegments: segments, columnVisits,
      verticalRasterPixels: columns.reduce((n, c) => n + c.bottom - c.top + 1, 0),
      deviceStackBytes: null, deviceHeapPeakBytes: null, deviceFrameTimeMs: null },
    elevationAccuracy: 'unvalidated', deviceValidated: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--route' || args[2] !== '--output') throw Error('Usage: --route ROUTE.bin --output NEW_DIRECTORY');
  const raw = fs.readFileSync(args[1]), points = readRouteElevations(raw);
  const end = points.at(-1)?.distance ?? 0;
  const starts = [...new Set([0, end / 4, end / 2, Math.max(0, end - 500)].map(Math.round))];
  fs.mkdirSync(args[3]);
  const rows = starts.map(progress => elevationStrip(points, { progress, onRoute: true, progressValid: true }));
  rows.forEach((row, i) => { if (row.packet) fs.writeFileSync(path.join(args[3], `strip-${i}.bin`), row.packet); });
  const serial = rows.map(({ packet, columns, ...row }) => row);
  fs.writeFileSync(path.join(args[3], 'report.json'), JSON.stringify({ scope: 'PC-only elevation spike',
    routeSha256: createHash('sha256').update(raw).digest('hex'), sourcePoints: points.length,
    routeMeters: end, profiles: serial, fallback: 'hide strip; ordinary map and guidance stay intact',
    restoration: 'rebuild only after route progress and elevation are valid again',
    layout: { screen: [240, 320], map: [240, 256], strip: [4, 68, 232, 32], mapOcclusionPixels: 7424,
      acceptance: 'proposed overlay below turn card; readability and native hook unvalidated' } }, null, 2) + '\n');
  const screens = rows.map((row, i) => `<article><h2>${(starts[i] / 1000).toFixed(1)} km into route</h2><svg viewBox="0 0 240 320" width="240" height="320" aria-label="Layout schematic, not a device screenshot">
    <rect width="240" height="320" fill="#f2f4f5"/><path d="M120 256L120 120L170 80L145 0" fill="none" stroke="#d62828" stroke-width="7"/>
    <rect x="4" y="2" width="232" height="60" fill="white" stroke="#bbc4cc"/><text x="15" y="28" font-size="20">↑ 666 m</text><text x="15" y="49" font-size="12">Go straight · schematic</text>
    ${row.status === 'candidate' ? `<rect x="4" y="68" width="232" height="32" fill="white" stroke="#bbc4cc"/><text x="8" y="81" font-size="14">Next ${(row.horizonMeters / 1000).toFixed(1)} km · ${row.elevationRangeMeters.map(Math.round).join('–')} m</text>${row.columns.map(c => `<path d="M${8 + c.x} ${82 + c.top}v${Math.max(1, c.bottom - c.top)}" stroke="#456f3d"/>`).join('')}` : '<text x="8" y="82" font-size="14">Elevation unavailable</text>'}
    <circle cx="120" cy="217" r="13" fill="white" stroke="#6499d9"/><path d="M120 205L112 224L120 220L128 224Z" fill="#2379d3"/>
    <text x="7" y="234" font-size="10">100 m</text><text x="174" y="235" font-size="10">km left</text><rect y="256" width="240" height="8" fill="#a0c998"/>
    <rect y="264" width="240" height="56" fill="white"/><text x="12" y="283" font-size="11">Speed</text><text x="130" y="283" font-size="11">GPS Heading</text><text x="12" y="311" font-size="24">16.1</text><text x="160" y="311" font-size="24">E</text></svg></article>`).join('');
  fs.writeFileSync(path.join(args[3], 'preview.html'), `<!doctype html><meta charset="utf-8"><title>CC700 elevation spike</title><style>body{font:14px system-ui;background:#e5e9ec;padding:24px}main{display:flex;gap:20px;flex-wrap:wrap}h2{font-size:14px}svg{border:5px solid #20252a;image-rendering:pixelated}</style><h1>Elevation layout study</h1><p>Actual route elevation; schematic map. Native 240 × 320 aspect ratio. Not implemented on device.</p><p>40 m minimum vertical range. Strip hides off-route or when progress is invalid. Desktop font; native readability remains unvalidated.</p><main>${screens}</main>`);
  console.log(JSON.stringify({ sourcePoints: points.length, routeMeters: end, profiles: serial }, null, 2));
}
