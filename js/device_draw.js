// Legacy operations reproduce v18. Consistent fill reproduces v19. Canvas
// strokes still use the browser rasterizer.
export function* dashSegments(points, on, off) {
  let phase = 0;
  const period = (on + off) * 65536, onLength = on * 65536;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i - 1], dx = points[i][0] - x, dy = points[i][1] - y;
    const length = Math.floor(Math.sqrt(dx * dx + dy * dy)) * 65536;
    if (!length) continue;
    for (let s = 0; s < length;) {
      const active = phase < onLength;
      const d = Math.min((active ? onLength : period) - phase, length - s);
      if (active) yield [[x + Math.trunc(dx * s / length), y + Math.trunc(dy * s / length)],
        [x + Math.trunc(dx * (s + d) / length), y + Math.trunc(dy * (s + d) / length)]];
      s += d; phase += d;
      if (phase >= period) phase -= period;
    }
  }
}

export function* scanlineSpans(points, width, height, consistent = false) {
  if (points.length < 3) return;
  const y0 = Math.max(0, Math.min(...points.map(p => p[1])));
  const y1 = Math.min(height - 1, Math.max(...points.map(p => p[1])));
  for (let y = y0; y <= y1; y++) {
    let xs = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      let [xa, ya] = points[j], [xb, yb] = points[i];
      if ((ya > y) === (yb > y) || xs.length >= 128) continue;
      if (consistent) {
        // Normalize orientation and sample pixel centres. A doubled bridge into
        // a hole must produce identical intersections in both directions.
        if (ya > yb) { [xa,xb]=[xb,xa]; [ya,yb]=[yb,ya]; }
        const dy=yb-ya, numerator=2*xa*dy+(xb-xa)*(2*(y-ya)+1);
        xs.push(Math.ceil((numerator-dy)/(2*dy)));
        continue;
      }
      xs.push(xa + Math.trunc(((xb - xa) * (2 * (y - ya) + 1) + (yb - ya)) / (2 * (yb - ya))));
    }
    xs.sort((a, b) => a - b);
    if (consistent) {
      const odd=[];
      for (const x of xs) { if (odd.at(-1)===x) odd.pop(); else odd.push(x); }
      xs=odd; // Coincident crossing pairs cancel under the even-odd rule.
    }
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const a = Math.max(0, xs[i]), b = Math.min(width, xs[i + 1]);
      if (b > a) yield [a, y, b - a];
    }
  }
}
