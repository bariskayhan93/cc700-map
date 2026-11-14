// Device drawing rules from map.c / arrow.c. Canvas line rasterization, fonts and
// geographic projection remain desktop approximations of the firmware.
import { parse, unzz, SC } from './pb.js';
import { brg } from './geo.js';
import { MAP_CLASS as C } from './mapsec.js';
import { dashSegments, scanlineSpans } from './device_draw.js';
import { rgb565, mapColor } from './map_style.js';
import { placeLabels } from './map_labels.js';
export { rgb565 } from './map_style.js';

const W = 240, H = 256, MPP = 2.5, POSY = 0.85, PIXEL_RATIO = 1;
const ORIGINAL_ROUTE = '#1f6fe0', PATCH_ROUTE = '#d62828', ROAD_EDGE = '#c8d0de';
const decoder = new TextDecoder();

function fields(bytes) {
  return Object.fromEntries(parse(bytes).map(([field, , value]) => [field, value]));
}

function labelText(words) {
  const bytes = new Uint8Array(words.length * 4), view = new DataView(bytes.buffer);
  words.forEach((word, i) => view.setInt32(i * 4, word, true));
  const end = bytes.indexOf(0);
  return decoder.decode(end < 0 ? bytes : bytes.subarray(0, end));
}

function readEntry(bytes) {
  const values = {}, pairs = [];
  for (const [field, , value] of parse(bytes)) {
    if (field === 6) {
      const pair = fields(value);
      pairs.push([unzz(pair[1] ?? 0), unzz(pair[2] ?? 0)]);
    } else {
      values[field] = value;
    }
  }
  const style = values[2] ?? 0, center = [unzz(values[3] ?? 0) * SC, unzz(values[4] ?? 0) * SC];
  if ((style & 15) === C.LABEL) return { style, center, label: labelText(pairs.flat()) };
  return { style, center, points: pairs.map(([lat, lon]) => [lat * SC, lon * SC]) };
}

export function readFile(f) {
  const view = new DataView(f.buffer, f.byteOffset, f.byteLength), secs = [];
  for (let offset = 0x80; offset + 4 <= f.length;) {
    const length = view.getUint32(offset, true);
    if (!length || length > 16000 || offset + 4 + length > f.length) break;
    const points = [];
    for (const [field, , value] of parse(f.subarray(offset + 4, offset + 4 + length))) {
      if (field !== 3) continue;
      const point = fields(value);
      points.push([unzz(point[1] ?? 0) * SC, unzz(point[2] ?? 0) * SC, point[5] ?? 0]);
    }
    secs.push(points);
    offset += 4 + length;
  }

  const mapOffset = view.getUint32(0x5c, true), blocks = [], byOffset = new Map();
  if (mapOffset) {
    const indexLength = view.getUint32(mapOffset, true), start = mapOffset + 4 + indexLength;
    for (const [field, , value] of parse(f.subarray(mapOffset + 4, start))) {
      if (field !== 2) continue;
      const offset = start + (fields(value)[1] ?? 0);
      if (!byOffset.has(offset)) {
        const length = view.getUint32(offset, true);
        const entries = parse(f.subarray(offset + 4, offset + 4 + length));
        byOffset.set(offset, entries.filter(([key]) => key === 2).map(([, , data]) => readEntry(data)));
      }
      blocks.push(byOffset.get(offset));
    }
  }
  return { secs, blocks, styled: [...byOffset.values()].some(block => block.some(entry => entry.style)) };
}

function path(g, points) {
  g.beginPath();
  g.moveTo(...points[0]);
  for (const point of points.slice(1)) g.lineTo(...point);
}

function stroke(g, points, color, width, dash = []) {
  if (points.length < 2) return;
  g.strokeStyle = g.previewColor(color);
  g.lineWidth = width;
  g.lineCap = width >= 3 ? 'round' : 'butt';
  g.lineJoin = width >= 3 ? 'round' : 'miter';
  g.setLineDash([]);
  if (dash.length) {
    for (const segment of dashSegments(points, ...dash)) { path(g, segment); g.stroke(); }
  } else { path(g, points); g.stroke(); }
}

function fillPolygon(g, points, color, consistent = false) {
  g.fillStyle = g.previewColor(color);
  for (const [x, y, width] of scanlineSpans(points, W, H, consistent)) g.fillRect(x, y, width, 1);
}

function drawOriginal(g, entries, project) {
  g.lineCap = 'butt';
  for (const { center, points } of entries) {
    for (const point of points) {
      const line = [project(center), project(point)];
      stroke(g, line, ROAD_EDGE, 8);
      stroke(g, line, '#ffffff', 4);
    }
  }
}

// Base v18 operations; v19/v20 apply corrected fill and bounded labels.
// v20 additionally separates waterway and cycleway semantics.
const AREAS = [
  [C.BUILT, '#d4d4d4'], [C.GREEN, '#a2d683', '#5f9e45'], [C.WATER, '#72b8f2', '#2f7fcf'],
];
const PASSES = [
  [C.RAIL, '#202326', 2, [10, 5]], [C.PTH, '#5a3b20', 3, [5, 3]], [C.CYC, '#0b4fb3', 3],
  [C.SRV, '#6a6e73', 5, [], true], [C.MIN, '#3d4146', 8, [], true], [C.MAJ, '#202326', 10, [], true],
  [C.SRV, '#ffffff', 3], [C.MIN, '#ffffff', 5], [C.MAJ, '#ffc640', 7],
  [C.TRAM, '#3b1f6e', 4], [C.TRAM, '#ffffff', 2],
];

function drawStyled(g, entries, project, study = false, corrected = false, waterCycle = false) {
  const layers = new Map();
  for (const { style, center, points, label } of entries) {
    const kind = style & 15;
    const layer = layers.get(kind) ?? [];
    layer.push({ style, points: [center, ...(points ?? [])].map(project), label });
    layers.set(kind, layer);
  }

  for (const [kind, fill, outline] of AREAS) {
    for (const { style, points } of layers.get(kind) ?? []) {
      if (points.length < 3) continue;
      fillPolygon(g, points, fill, study || corrected);
      if (outline && !(style & 0x400) && !study) stroke(g, points, outline, 1);   // no outline: holes or cut at the window
    }
  }
  g.lineCap = g.lineJoin = 'round';
  for (const { points } of layers.get(C.WLINE) ?? []) stroke(g, points, waterCycle ? '#72b8f2' : '#2f7fcf', 3);
  for (let level = 0; level <= 4; level++) {
    for (const [kind, color, width, dash, edge] of PASSES) {
      for (const { style, points } of layers.get(kind) ?? []) {
        if (((style >> 4) & 7) !== level) continue;
        const bridge = style & 0x80, tunnel = style & 0x100, rough = kind === C.PTH && (style & 0x200);
        g.globalAlpha = tunnel && !edge ? 115 / 255 : 1;
        if (!edge && bridge && color !== '#ffffff' && (kind === C.PTH || kind === C.CYC || kind === C.RAIL)) {   // bridge base
          const opacity = g.globalAlpha; g.globalAlpha = 1;
          stroke(g, points, '#111111', 7); stroke(g, points, '#ffffff', 5);
          g.globalAlpha = opacity; }
        const far = style & 0x800, fw = { [C.MIN]: edge ? [6, '#7a7e83'] : [3, '#f4f4f4'], [C.SRV]: edge ? [4, '#9a9ea3'] : [2, '#f4f4f4'] }[kind];
        if (far && fw) {
          if (edge && bridge) stroke(g, points, '#000000', fw[0] + 2);
          else {
            g.globalAlpha = tunnel ? 115 / 255 : 1;
            stroke(g, points, fw[1], fw[0]);
          }
          continue;
        }   // far from the route: thinner, lighter
        if (edge && bridge) stroke(g, points, '#000000', width + 2);
        else if (edge && tunnel) stroke(g, points, color, width, [3, 2]);
        else if (rough) stroke(g, points, '#6b4a2b', 2, [2, 3]);
        else stroke(g, points, color, ((study || corrected) && kind === C.PTH) || (waterCycle && kind === C.CYC) ? 2 : width, dash);
      }
    }
  }
  g.globalAlpha = 1;
  for (const [kind, border, core, width] of [[C.SIG, '#111111', '#ffb300', 6], [C.STOP, '#3b1f6e', '#ffffff', 4]]) {
    for (const { points: [[x, y]] } of layers.get(kind) ?? []) {
      stroke(g, [[x, y], [x + 1, y]], border, 10);
      stroke(g, [[x, y], [x + 1, y]], core, width);
    }
  }
  return layers.get(C.LABEL) ?? [];
}

function drawLabels(g, labels, collision = false) {
  // Firmware font is not bundled in the web app; approximate its glyphs while retaining its box and halos.
  g.font = '12px Arial, sans-serif';
  g.textAlign = 'left';
  g.textBaseline = 'top';
  for (const { label, box: [left, top] } of placeLabels(labels, collision)) {
    g.fillStyle = rgb565('#ffffff');
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) g.fillText(label, left + dx, top + dy);
    g.fillStyle = rgb565('#000000');
    g.fillText(label, left, top);
  }
}

function sample(points, distM) {
  let next = points.findIndex(point => point[2] >= distM * 100);
  if (next < 0) next = points.length - 1;
  if (next === 0) return { point: points[0], next };
  const a = points[next - 1], b = points[next];
  const t = Math.min(1, (distM * 100 - a[2]) / Math.max(1, b[2] - a[2]));
  return { point: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t], next };
}

function drawTurns(g, entries, section, project, position) {
  // cc_rt uses encoded shaft points (the centre is only the distance anchor).
  const ky = 111195, radians = position[0] * 0.01745329;
  const kx = ky * (1 - radians * radians / 2 + radians ** 4 / 24);
  const vector = (a, b) => [(b[1] - a[1]) * kx, (b[0] - a[0]) * ky];
  for (const { style, center, points } of entries) {
    if ((style & 15) !== 15 || (style & 0x8000) || !points || points.length < 2 || points.length > 24) continue;
    const index = style >>> 16;
    if (index <= section || index > section + 3 || Math.hypot(...vector(position, center)) > 150) continue;
    const tip = points.at(-1), v = vector(points.at(-2), tip), length = Math.hypot(...v);
    if (length < 0.5) continue;
    const [ux, uy] = v.map(value => value / length);
    const move = (x, y) => [tip[0] + y * 10 / ky, tip[1] + x * 10 / kx];
    const head = [move(-(ux * 0.819 - uy * 0.574), -(ux * 0.574 + uy * 0.819)), tip,
      move(-(ux * 0.819 + uy * 0.574), -(-ux * 0.574 + uy * 0.819))].map(project);
    for (const [width, color] of [[13, '#111111'], [7, '#ffffff']]) {
      stroke(g, points.map(project), color, width);
      stroke(g, head, color, width);
    }
  }
}

export function draw(canvas, model, distM, styled = model.styled, options = {}) {
  const { secs, blocks } = model, all = secs.flat();
  canvas.width = W * PIXEL_RATIO;
  canvas.height = H * PIXEL_RATIO;
  const g = canvas.getContext('2d');
  g.previewColor = color => mapColor(color, options.profile);
  g.scale(PIXEL_RATIO, PIXEL_RATIO);
  g.fillStyle = '#ffffff'; // 0x4205bcac clears the RGB565 canvas to 0xffff at opacity 255.
  g.fillRect(0, 0, W, H);
  if (!all.length) return { section: 0, entries: 0, heading: 0 };

  let section = 0;
  secs.forEach((points, i) => { if (points[0]?.[2] <= distM * 100) section = i; });
  const { point: me, next } = sample(all, distM);
  const heading = Number.isFinite(options.headingDegrees) ? ((options.headingDegrees % 360) + 360) % 360 : brg(sample(all, distM - 30).point, sample(all, distM + 30).point);
  const mpp = Number.isFinite(options.metresPerPixel) && options.metresPerPixel >= 0.25 && options.metresPerPixel <= 20 ? options.metresPerPixel : MPP;
  const radians = heading * Math.PI / 180, k = Math.cos(me[0] * Math.PI / 180);
  const sin = Math.sin(radians), cos = Math.cos(radians);
  const project = p => {
    const e = (p[1] - me[1]) * 111320 * k / mpp, n = (p[0] - me[0]) * 111320 / mpp;
    return [Math.trunc(W / 2 + e * cos - n * sin), Math.trunc(H * POSY - e * sin - n * cos)];
  };

  const entries = blocks[section] ?? [];
  const original = entries.filter(entry => !entry.style);
  drawOriginal(g, original, project);
  const labels = styled ? drawStyled(g, entries.filter(entry => entry.style), project, options.profile === 'cycling', ['v19','v20','v21'].includes(options.profile), ['v20','v21'].includes(options.profile)) : [];
  drawLabels(g, labels, ['v19','v20','v21','cycling'].includes(options.profile)); // Map labels precede the firmware route and turn overlays.
  const routeColor = styled ? PATCH_ROUTE : ORIGINAL_ROUTE;
  g.lineCap = g.lineJoin = 'round';
  stroke(g, [...all.slice(0, next), me].map(project), ROAD_EDGE, 6);
  if (styled) g.globalAlpha = ['cycling','v21'].includes(options.profile) ? 1 : 180 / 255;                // v18–v20: 180/255; v21 is opaque
  stroke(g, [me, ...all.slice(next)].map(project), routeColor, styled ? 4 : 6);
  g.globalAlpha = 1;
  if (styled) {                                   // rough parts of the route: dots over the route line
    for (const { style, points } of entries) if ((style & 15) === 15 && (style & 0x8000) && points?.length >= 2 && points.length <= 24) stroke(g, points.map(project), '#3a2410', 3, [2, 4]);
  }
  if (styled) drawTurns(g, entries, section, project, me);

  // UI reconstruction: reference photos show white route chevrons and a
  // circular rider marker. Spacing/fonts/raster are illustrative, not extracted
  // native draw calls. Bound chevrons even for very long or degenerate routes.
  const ahead = [me, ...all.slice(next)].map(project);
  let walked = 0, nextChevron = 28, chevrons = 0;
  for (let i = 1; i < ahead.length && chevrons < 64; i++) {
    const [ax, ay] = ahead[i - 1], [bx, by] = ahead[i];
    const length = Math.hypot(bx - ax, by - ay);
    if (!length) continue;
    const ux = (bx - ax) / length, uy = (by - ay) / length;
    while (nextChevron <= walked + length && chevrons < 64) {
      const t = nextChevron - walked, x = ax + ux * t, y = ay + uy * t;
      if (x >= 0 && x < W && y >= 0 && y < H) {
        stroke(g, [[x - ux * 2 - uy * 2, y - uy * 2 + ux * 2],
          [x + ux * 2, y + uy * 2], [x - ux * 2 + uy * 2, y - uy * 2 - ux * 2]]
          .map(p => p.map(Math.round)), '#ffffff', 1);
      }
      nextChevron += 28; chevrons++;
    }
    walked += length;
  }
  const [x, y] = project(me);
  g.beginPath(); g.arc(x, y, 17, 0, Math.PI * 2);
  g.fillStyle = rgb565('#fbfdff'); g.fill();
  g.strokeStyle = rgb565('#9ac6f5'); g.lineWidth = 2; g.stroke();
  path(g, [[x, y - 11], [x - 8, y + 8], [x, y + 5], [x + 8, y + 8]]);
  g.fillStyle = rgb565(ORIGINAL_ROUTE);
  g.fill();
  return { section, entries: entries.length, heading };
}
