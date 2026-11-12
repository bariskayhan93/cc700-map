// Desktop approximation of the map layers encoded in the generated CC700 route file.
import { parse, unzz, SC } from './pb.js';
import { brg } from './geo.js';
import { MAP_CLASS as C } from './mapsec.js';

const W = 240, H = 250, MPP = 2.5, POSY = 0.85, PIXEL_RATIO = 2;
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
  path(g, points);
  g.strokeStyle = color;
  g.lineWidth = width;
  g.setLineDash(dash);
  g.stroke();
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

// The Sunlight palette and drawing order follow map.c in the v12 firmware patch.
const AREAS = [
  [C.BUILT, '#d4d4d4'], [C.GREEN, '#a2d683', '#5f9e45'], [C.WATER, '#72b8f2', '#2f7fcf'],
];
const PASSES = [
  [C.RAIL, '#202326', 2, [10, 5]], [C.PTH, '#5a3b20', 3, [5, 3]], [C.CYC, '#0b4fb3', 3],
  [C.SRV, '#6a6e73', 5, [], true], [C.MIN, '#3d4146', 8, [], true], [C.MAJ, '#202326', 10, [], true],
  [C.SRV, '#ffffff', 3], [C.MIN, '#ffffff', 5], [C.MAJ, '#ffc640', 7],
  [C.TRAM, '#3b1f6e', 4], [C.TRAM, '#ffffff', 2],
];

function drawStyled(g, entries, project) {
  const layers = new Map();
  for (const { style, center, points, label } of entries) {
    const kind = style & 15;
    const layer = layers.get(kind) ?? [];
    layer.push({ style, points: [center, ...(points ?? [])].map(project), label });
    layers.set(kind, layer);
  }

  for (const [kind, fill, outline] of AREAS) {
    for (const { points } of layers.get(kind) ?? []) {
      if (points.length < 3) continue;
      path(g, points);
      g.closePath();
      g.fillStyle = fill;
      g.fill('evenodd');
      if (outline) stroke(g, points, outline, 1);
    }
  }
  g.lineCap = g.lineJoin = 'round';
  for (const { points } of layers.get(C.WLINE) ?? []) stroke(g, points, '#2f7fcf', 3);
  for (let level = 0; level <= 4; level++) {
    for (const [kind, color, width, dash, edge] of PASSES) {
      for (const { style, points } of layers.get(kind) ?? []) {
        if (((style >> 4) & 7) !== level) continue;
        const bridge = style & 0x80, tunnel = style & 0x100, rough = kind === C.PTH && (style & 0x200);
        g.globalAlpha = tunnel && !edge ? 0.45 : 1;
        if (edge && bridge) stroke(g, points, '#000000', width + 2);
        else if (edge && tunnel) stroke(g, points, color, width, [3, 2]);
        else if (rough) stroke(g, points, '#6b4a2b', 2, [2, 3]);
        else stroke(g, points, color, width, dash);
      }
    }
  }
  g.globalAlpha = 1;
  for (const [kind, border, core, radius] of [[C.SIG, '#111111', '#ffb300', 3], [C.STOP, '#3b1f6e', '#ffffff', 2]]) {
    for (const { points: [[x, y]] } of layers.get(kind) ?? []) {
      for (const [size, color] of [[5, border], [radius, core]]) {
        g.beginPath();
        g.arc(x, y, size, 0, Math.PI * 2);
        g.fillStyle = color;
        g.fill();
      }
    }
  }
  return layers.get(C.LABEL) ?? [];
}

function drawLabels(g, labels) {
  g.font = '12px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#000000';
  g.strokeStyle = '#ffffff';
  g.lineWidth = 2;
  const drawn = [];
  for (const { label, points: [[x, y]] } of labels) {
    if (!label || x < 0 || x > W || y < 8 || y > H - 8) continue;
    const half = g.measureText(label).width / 2 + 2;
    if (half * 2 > W) continue;
    const center = Math.max(half, Math.min(W - half, x));
    const left = center - half, right = center + half;
    if (drawn.some(box => Math.abs(box.y - y) < 14 && left < box.right && right > box.left)) continue;
    g.strokeText(label, center, y);
    g.fillText(label, center, y);
    drawn.push({ left, right, y });
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

function drawTurn(g, secs, section, project, position) {
  const ends = [...secs.map(points => points[0]), secs.at(-1).at(-1)].map(project);
  const vector = ([ax, ay], [bx, by]) => [bx - ax, by - ay];
  const length = v => Math.hypot(...v);
  const turn = i => {
    const a = vector(ends[i - 1], ends[i]), b = vector(ends[i], ends[i + 1]);
    return a[0] * b[0] + a[1] * b[1] < 0.819 * length(a) * length(b);
  };
  const toward = (a, b, distance) => {
    const v = vector(a, b), t = Math.min(1, distance / MPP / length(v));
    return [a[0] + v[0] * t, a[1] + v[1] * t];
  };
  for (let i = section + 1; i < ends.length - 1 && i <= section + 3; i++) {
    if (length(vector(position, ends[i])) * MPP > 150) return;
    if (!turn(i)) continue;
    const last = i + 2 < ends.length && length(vector(ends[i], ends[i + 1])) * MPP <= 50 && turn(i + 1) ? i + 1 : i;
    const tip = toward(ends[last], ends[last + 1], 22);
    const heading = Math.atan2(tip[1] - ends[last][1], tip[0] - ends[last][0]);
    const wing = delta => [tip[0] - Math.cos(heading + delta) * 10 / MPP, tip[1] - Math.sin(heading + delta) * 10 / MPP];
    const shaft = [toward(ends[i], ends[i - 1], 22), ...ends.slice(i, last + 1), tip];
    for (const [width, color] of [[13, '#111111'], [7, '#ffffff']]) {
      stroke(g, shaft, color, width);
      stroke(g, [wing(-0.61), tip, wing(0.61)], color, width);
    }
    return;
  }
}

export function draw(canvas, model, distM, styled = model.styled) {
  const { secs, blocks } = model, all = secs.flat();
  canvas.width = W * PIXEL_RATIO;
  canvas.height = H * PIXEL_RATIO;
  const g = canvas.getContext('2d');
  g.scale(PIXEL_RATIO, PIXEL_RATIO);
  g.fillStyle = styled ? '#f2efe9' : '#eef0f2';
  g.fillRect(0, 0, W, H);
  if (!all.length) return { section: 0, entries: 0, heading: 0 };

  let section = 0;
  secs.forEach((points, i) => { if (points[0]?.[2] <= distM * 100) section = i; });
  const { point: me, next } = sample(all, distM);
  const heading = brg(sample(all, distM - 30).point, sample(all, distM + 30).point);
  const radians = heading * Math.PI / 180, k = Math.cos(me[0] * Math.PI / 180);
  const sin = Math.sin(radians), cos = Math.cos(radians);
  const project = p => {
    const e = (p[1] - me[1]) * 111320 * k / MPP, n = (p[0] - me[0]) * 111320 / MPP;
    return [W / 2 + e * cos - n * sin, H * POSY - e * sin - n * cos];
  };

  const entries = blocks[section] ?? [];
  const original = entries.filter(entry => !entry.style);
  drawOriginal(g, original, project);
  const labels = styled ? drawStyled(g, entries.filter(entry => entry.style), project) : [];
  const routeColor = styled ? PATCH_ROUTE : ORIGINAL_ROUTE;
  g.lineCap = g.lineJoin = 'round';
  stroke(g, [...all.slice(0, next), me].map(project), ROAD_EDGE, 6);
  stroke(g, [me, ...all.slice(next)].map(project), routeColor, 6);
  if (styled) drawTurn(g, secs, section, project, project(me));
  drawLabels(g, labels);

  const [x, y] = project(me);
  path(g, [[x, y - 9], [x - 7, y + 7], [x + 7, y + 7]]);
  g.fillStyle = ORIGINAL_ROUTE;
  g.fill();
  return { section, entries: entries.length, heading };
}
