// Street-name image as the CC700 stores it: u16 len | LVGL INDEXED_2BIT (cf 8), 16 px high, 4-colour palette.
const PAL = [[16, 15, 16], [156, 156, 156], [96, 97, 96], [249, 250, 249]];   // 0 black, 2 dark, 1 light, 3 white
const FONT = '14px "Noto Sans", "Source Han Sans", Arial, sans-serif';
export function nameImage(text, maxW = 400) {
  const c = document.createElement('canvas'), g = c.getContext('2d'); g.font = FONT;
  const w = Math.min(maxW, Math.ceil(g.measureText(text).width) + 4), h = 16;
  c.width = w; c.height = h; g.font = FONT; g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#000'; g.textBaseline = 'alphabetic'; g.fillText(text, 2, 12);
  const px = g.getImageData(0, 0, w, h).data, stride = Math.ceil(w / 4), data = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = px[(y * w + x) * 4 + 1], idx = l < 56 ? 0 : l < 126 ? 2 : l < 202 ? 1 : 3;
    data[y * stride + (x >> 2)] |= idx << (6 - 2 * (x & 3));
  }
  const p = new Uint8Array(24 + 16 + data.length), dv = new DataView(p.buffer);
  p[4] = 8; dv.setUint32(16, w, true); dv.setUint32(20, h, true);
  PAL.forEach(([r, gg, b], i) => p.set([b, gg, r, 255], 24 + 4 * i)); p.set(data, 40);
  const out = new Uint8Array(2 + p.length); new DataView(out.buffer).setUint16(0, p.length, true); out.set(p, 2);
  return out;
}
