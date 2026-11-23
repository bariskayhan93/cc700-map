/* Raster module (cc27 Task 2). See raster.h. */
#include "raster.h"

uint32_t rs_isqrt(uint32_t v) {
  uint32_t r = 0, b = 1u << 30;
  while (b > v) b >>= 2;
  while (b) { if (v >= r + b) { v -= r + b; r = (r >> 1) + b; } else r >>= 1; b >>= 2; }
  return r;
}
static uint32_t rs_div255(uint32_t x) { return (x + 1u + (x >> 8)) >> 8; }   /* x / 255 for x <= 65025, no divide */
static uint16_t rs_blend(uint16_t s, uint16_t d, uint32_t a) {
  uint32_t r = rs_div255(((uint32_t)(s >> 11) & 31u) * a + ((uint32_t)(d >> 11) & 31u) * (255u - a));
  uint32_t g = rs_div255(((uint32_t)(s >> 5) & 63u) * a + ((uint32_t)(d >> 5) & 63u) * (255u - a));
  uint32_t b = rs_div255(((uint32_t)s & 31u) * a + ((uint32_t)d & 31u) * (255u - a));
  return (uint16_t)((r << 11) | (g << 5) | b);
}
/* pixel (x, y) (or (y, x) when swap) with coverage cov of 256 */
static void rs_cov(const rs_canvas *c, int x, int y, int swap, uint32_t cov, uint16_t col, uint8_t opa) {
  uint16_t *q;
  if (swap) { int t = x; x = y; y = t; }
  if (!cov || x < 0 || y < 0 || x >= c->w || y >= c->h) return;
  q = c->buf + y * c->w + x;
  if (cov >= 256u) *q = opa == 255 ? col : rs_blend(col, *q, opa);
  else *q = rs_blend(col, *q, (cov * opa + 128u) >> 8);
}
static void rs_put(const rs_canvas *c, int x, int y, uint16_t col, uint8_t opa) { rs_cov(c, x, y, 0, 256u, col, opa); }
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

/* ---------- cc28 smooth lines ---------- */
/* One segment as a slab of columns along the major axis u; v is the minor axis. Columns u0 .. u1, less the end
 * column when open. Centre v(u) = v0 + (u - u0) * dv / du, exact floor of the magnitude (Q16), so collinear
 * segments give the same centres. w in half pixels. Half height hv = w / 4 * len / du (Q16). */
static void rs_slab(const rs_canvas *c, int u0, int v0, int u1, int v1, int w, uint16_t col, uint8_t opa, int swap, int open_end) {
  int du = u1 - u0, dv = v1 - v0, sg = dv < 0 ? -1 : 1, adv = dv < 0 ? -dv : dv, ua = u0, ub = u1, umax = swap ? c->h : c->w, vmax = swap ? c->w : c->h;
  uint32_t q, r, ratio, k;
  int32_t hv, vc, rem;
  if (open_end) { if (u1 >= u0) ub--; else ub++; }
  if (du < 0) { int t = ua; ua = ub; ub = t; du = -du; }      /* walk u upwards; the centre stays a function of u */
  if (!du) { if (!open_end) { hv = w * 16384; for (int v = (v0 * 65536 - hv + 32768) >> 16; v <= ((v0 * 65536 + hv + 32767) >> 16); v++)
      rs_cov(c, u0, v, swap, 256u, col, opa); } return; }
  {                                                            /* ratio = sqrt(1 + (dv/du)^2), Q12 */
    uint32_t s16 = ((uint32_t)adv << 16) / (uint32_t)du, s4 = s16 >> 4;
    ratio = rs_isqrt((1u << 24) + s4 * s4);
  }
  hv = (int32_t)((uint32_t)w * ratio * 4u);                    /* w / 4 * ratio, Q16 */
  q = ((uint32_t)adv << 16) / (uint32_t)du; r = ((uint32_t)adv << 16) % (uint32_t)du;
  if (u1 < u0) { u0 = u1; v0 = v1; sg = -sg; }                /* centre from the low-u end */
  if (ua < 0) ua = 0;
  if (ub > umax - 1) ub = umax - 1;
  if (ua > ub) return;
  k = (uint32_t)(ua - u0);
  rem = (int32_t)((r * k) % (uint32_t)du);
  vc = v0 * 65536 + sg * (int32_t)(q * k + (r * k) / (uint32_t)du);
  for (int u = ua; u <= ub; u++) {
    int32_t top = vc - hv, bot = vc + hv;
    int va = (top + 32768) >> 16, vb = (bot + 32767) >> 16;
    if (va < 0) va = 0;
    if (vb > vmax - 1) vb = vmax - 1;
    for (int v = va; v <= vb; v++) {
      int32_t lo = v * 65536 - 32768, hi = lo + 65536;
      if (lo < top) lo = top;
      if (hi > bot) hi = bot;
      if (hi > lo) rs_cov(c, u, v, swap, (uint32_t)(hi - lo) >> 8, col, opa);
    }
    vc += sg * (int32_t)q; rem += (int32_t)r;
    if (rem >= du) { rem -= du; vc += sg; }
  }
}
static void rs_dot_aa(const rs_canvas *c, int x, int y, int w, uint16_t col, uint8_t opa) {   /* w in half pixels */
  int R = (w + 4) / 4;
  int32_t in2 = (w - 2) * (w - 2), out2 = (w + 2) * (w + 2);    /* 16 * d^2 against (w -+ 2)^2 */
  if (x + R < 0 || y + R < 0 || x - R >= c->w || y - R >= c->h) return;
  for (int j = -R; j <= R; j++) for (int i = -R; i <= R; i++) {
    int32_t d4 = 16 * (i * i + j * j);
    if (d4 >= out2) continue;
    if (w >= 2 && d4 <= in2) { rs_cov(c, x + i, y + j, 0, 256u, col, opa); continue; }
    int32_t cv = w * 64 + 128 - (int32_t)rs_isqrt((uint32_t)(i * i + j * j) << 16);   /* r + 1/2 - distance, Q8 */
    if (cv > 0) rs_cov(c, x + i, y + j, 0, cv > 256 ? 256u : (uint32_t)cv, col, opa);
  }
}
static int rs_turn(pt_t a, pt_t b, pt_t d) {                   /* the turn at b is over about 10 degrees (tan 10 = 10 / 57) */
  int ax = b.x - a.x, ay = b.y - a.y, bx = d.x - b.x, by = d.y - b.y;
  while (rs_abs(ax) > 2047 || rs_abs(ay) > 2047 || rs_abs(bx) > 2047 || rs_abs(by) > 2047) { ax /= 2; ay /= 2; bx /= 2; by /= 2; }
  int32_t dot = ax * bx + ay * by, cr = ax * by - ay * bx;
  return dot <= 0 || rs_abs(cr) * 57 > dot * 10;
}
void rs_line_aa(const rs_canvas *c, const pt_t *p, uint32_t n, int w, uint16_t col, uint8_t opa, int round) {
  uint32_t i;
  if (!c->buf || !p || !n || w <= 0) return;
  if (n == 1) { rs_dot_aa(c, p[0].x, p[0].y, w, col, opa); return; }
  for (i = 1; i < n; i++) {
    int dx = p[i].x - p[i - 1].x, dy = p[i].y - p[i - 1].y;
    if (rs_abs(dx) >= rs_abs(dy)) rs_slab(c, p[i - 1].x, p[i - 1].y, p[i].x, p[i].y, w, col, opa, 0, i + 1 < n);
    else rs_slab(c, p[i - 1].y, p[i - 1].x, p[i].y, p[i].x, w, col, opa, 1, i + 1 < n);
  }
  if (round && w >= 6) {
    rs_dot_aa(c, p[0].x, p[0].y, w, col, opa);
    for (i = 1; i + 1 < n; i++) if (rs_turn(p[i - 1], p[i], p[i + 1])) rs_dot_aa(c, p[i].x, p[i].y, w, col, opa);
    rs_dot_aa(c, p[n - 1].x, p[n - 1].y, w, col, opa);
  }
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
