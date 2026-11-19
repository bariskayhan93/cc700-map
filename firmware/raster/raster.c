/* Raster module (cc27 Task 2). See raster.h. */
#include "raster.h"

static uint32_t rs_isqrt(uint32_t v) {
  uint32_t r = 0, b = 1u << 30;
  while (b > v) b >>= 2;
  while (b) { if (v >= r + b) { v -= r + b; r = (r >> 1) + b; } else r >>= 1; b >>= 2; }
  return r;
}
static uint16_t rs_blend(uint16_t s, uint16_t d, uint32_t a) {
  uint32_t r = (((uint32_t)(s >> 11) & 31u) * a + ((uint32_t)(d >> 11) & 31u) * (255u - a)) / 255u;
  uint32_t g = (((uint32_t)(s >> 5) & 63u) * a + ((uint32_t)(d >> 5) & 63u) * (255u - a)) / 255u;
  uint32_t b = (((uint32_t)s & 31u) * a + ((uint32_t)d & 31u) * (255u - a)) / 255u;
  return (uint16_t)((r << 11) | (g << 5) | b);
}
static void rs_put(const rs_canvas *c, int x, int y, uint16_t col, uint8_t opa) {
  uint16_t *q;
  if (x < 0 || y < 0 || x >= c->w || y >= c->h) return;
  q = c->buf + y * c->w + x;
  *q = opa == 255 ? col : rs_blend(col, *q, opa);
}
static int rs_abs(int v) { return v < 0 ? -v : v; }
/* span width across the minor axis for a segment of width w (see raster.h) */
static int rs_span(int dx, int dy, int w) {
  uint32_t major, len2, len;
  if (w <= 1) return 1;
  dx = rs_abs(dx); dy = rs_abs(dy);
  major = (uint32_t)(dx > dy ? dx : dy);
  if (!major) return w;
  len2 = (uint32_t)dx * (uint32_t)dx + (uint32_t)dy * (uint32_t)dy;
  len = rs_isqrt(len2);
  if (len * len < len2) len++;
  return (int)(((uint32_t)w * len + major - 1u) / major);
}
static void rs_seg(const rs_canvas *c, int x0, int y0, int x1, int y1, int w, uint16_t col, uint8_t opa) {
  int dx, dy, sx, sy, err, e2, ws, lo, k, xmaj;
  if (x1 < x0 || (x1 == x0 && y1 < y0)) { int t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }   /* same pixels both ways */
  ws = rs_span(x1 - x0, y1 - y0, w);
  {                                                          /* the box with the span misses the canvas: no pixel */
    int bx0 = x0 < x1 ? x0 : x1, bx1 = x0 < x1 ? x1 : x0, by0 = y0 < y1 ? y0 : y1, by1 = y0 < y1 ? y1 : y0;
    if (bx1 + ws < 0 || by1 + ws < 0 || bx0 - ws >= c->w || by0 - ws >= c->h) return;
  }
  dx = rs_abs(x1 - x0); sx = x0 < x1 ? 1 : -1; dy = -rs_abs(y1 - y0); sy = y0 < y1 ? 1 : -1;
  err = dx + dy; xmaj = dx >= -dy; lo = (ws - 1) / 2;
  for (;;) {
    if (ws == 1) rs_put(c, x0, y0, col, opa);
    else for (k = 0; k < ws; k++) { if (xmaj) rs_put(c, x0, y0 - lo + k, col, opa); else rs_put(c, x0 - lo + k, y0, col, opa); }
    if (x0 == x1 && y0 == y1) break;
    e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

void rs_disk(const rs_canvas *c, int x, int y, int d, uint16_t col, uint8_t opa) {
  int r = d / 2, i, j;
  if (d <= 0 || x + r < 0 || y + r < 0 || x - r >= c->w || y - r >= c->h) return;
  for (j = -r; j <= r; j++) for (i = -r; i <= r; i++) if (4 * (i * i + j * j) <= d * d) rs_put(c, x + i, y + j, col, opa);
}

void rs_line(const rs_canvas *c, const pt_t *p, uint32_t n, int w, uint16_t col, uint8_t opa, int round) {
  uint32_t i;
  if (!c->buf || !p || !n || w <= 0) return;
  if (n == 1) rs_seg(c, p[0].x, p[0].y, p[0].x, p[0].y, w, col, opa);
  for (i = 1; i < n; i++) rs_seg(c, p[i - 1].x, p[i - 1].y, p[i].x, p[i].y, w, col, opa);
  if (round && w >= 3 && opa == 255) for (i = 0; i < n; i++) rs_disk(c, p[i].x, p[i].y, w, col, opa);
}

uint32_t rs_work(const pt_t *p, uint32_t n, int w) {
  uint32_t i, s = 0;
  if (!p || !n || w <= 0) return 0;
  if (n == 1) s = (uint32_t)rs_span(0, 0, w);
  for (i = 1; i < n; i++) {
    int dx = rs_abs(p[i].x - p[i - 1].x), dy = rs_abs(p[i].y - p[i - 1].y);
    s += (uint32_t)((dx > dy ? dx : dy) + 1) * (uint32_t)rs_span(dx, dy, w);
  }
  if (w >= 3) s += n * (uint32_t)w * (uint32_t)w;
  return s;
}

void rs_rect(const rs_canvas *c, int x0, int y0, int x1, int y1, uint16_t col) {
  int x, y;
  if (!c->buf) return;
  if (x0 < 0) x0 = 0;
  if (y0 < 0) y0 = 0;
  if (x1 > c->w) x1 = c->w;
  if (y1 > c->h) y1 = c->h;
  for (y = y0; y < y1; y++) for (x = x0; x < x1; x++) c->buf[y * c->w + x] = col;
}

void rs_fill(const rs_canvas *c, const pt_t *p, uint32_t n, uint16_t col) {   /* even-odd scanline fill (v21 fill) */
  uint16_t *buf = c->buf; int W = c->w, H = c->h;
  if (!buf || n < 3) return;
  int y0 = 1 << 30, y1 = -(1 << 30);
  for (uint32_t i = 0; i < n; i++) { if (p[i].y < y0) y0 = p[i].y; if (p[i].y > y1) y1 = p[i].y; }
  if (y0 < 0) y0 = 0;
  if (y1 > H - 1) y1 = H - 1;
  int16_t xs[128];
  for (int y = y0; y <= y1; y++) {
    int k = 0;
    for (uint32_t i = 0, j = n - 1; i < n; j = i++) {
      int ya = p[j].y, yb = p[i].y;
      if ((ya > y) == (yb > y) || k >= 128) continue;
      int xa=p[j].x, xb=p[i].x;
      if(ya>yb) {int t=ya;ya=yb;yb=t;t=xa;xa=xb;xb=t;}
      int dy=yb-ya, den=2*dy;
      int num=2*xa*dy+(xb-xa)*(2*(y-ya)+1)-dy;
      int x=num/den+(num>0 && num%den!=0); // ceil, independent of edge direction
      int m = k++; while (m > 0 && xs[m - 1] > x) { xs[m] = xs[m - 1]; m--; } xs[m] = x;
    }
    // Cancel equal crossings: doubled hole bridges have zero parity.
    int odd=0;
    for(int m=0;m<k;m++) {if(odd && xs[odd-1]==xs[m]) odd--; else xs[odd++]=xs[m];}
    k=odd;
    uint16_t *row = buf + y * W;
    for (int m = 0; m + 1 < k; m += 2) {
      int a = xs[m] < 0 ? 0 : xs[m], b = xs[m + 1] > W ? W : xs[m + 1];
      for (int x = a; x < b; x++) row[x] = col;
    }
  }
}
