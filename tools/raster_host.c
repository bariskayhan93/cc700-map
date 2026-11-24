/* Host driver of firmware/raster (cc27 Task 2). argv: case and numbers. Prints JSON: hash, changed pixels, box,
 * first changed pixel value, work. Canvas 240 x 256, black. ASan and UBSan catch writes outside the canvas. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "raster.h"

static uint16_t buf[240 * 256], ref[240 * 256];
static const rs_canvas cv = { buf, 240, 256 };

/* the v21 fill of firmware/mapdraw/map.c:89-119 (cc26), kept here as the reference of rs_fill */
static void old_fill(uint16_t *b, int W, int H, const pt_t *p, uint32_t n, uint16_t col) {
  if (!b || n < 3) return;
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
      int x=num/den+(num>0 && num%den!=0);
      int m = k++; while (m > 0 && xs[m - 1] > x) { xs[m] = xs[m - 1]; m--; } xs[m] = x;
    }
    int odd=0;
    for(int m=0;m<k;m++) {if(odd && xs[odd-1]==xs[m]) odd--; else xs[odd++]=xs[m];}
    k=odd;
    uint16_t *row = b + y * W;
    for (int m = 0; m + 1 < k; m += 2) {
      int a = xs[m] < 0 ? 0 : xs[m], e = xs[m + 1] > W ? W : xs[m + 1];
      for (int x = a; x < e; x++) row[x] = col;
    }
  }
}


/* 24 Nov: the line and disk of raster.c before the span writes, kept as the reference of rs_line and rs_disk */
static void o_put(uint16_t *b, int x, int y, uint16_t col) { if (x >= 0 && y >= 0 && x < 240 && y < 256) b[y * 240 + x] = col; }
static int o_abs(int v) { return v < 0 ? -v : v; }
static int o_span(int dx, int dy, int w) {
  uint32_t major, len2, len;
  if (w <= 1) return 1;
  dx = o_abs(dx); dy = o_abs(dy); major = (uint32_t)(dx > dy ? dx : dy);
  if (!major) return w;
  len2 = (uint32_t)dx * (uint32_t)dx + (uint32_t)dy * (uint32_t)dy; len = rs_isqrt(len2);
  if (len * len < len2) len++;
  return (int)(((uint32_t)w * len + major - 1u) / major);
}
static void o_seg(uint16_t *b, int x0, int y0, int x1, int y1, int w, uint16_t col) {
  int dx, dy, sx, sy, err, e2, ws, lo, k, xmaj;
  if (x1 < x0 || (x1 == x0 && y1 < y0)) { int t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }
  ws = o_span(x1 - x0, y1 - y0, w);
  dx = o_abs(x1 - x0); sx = x0 < x1 ? 1 : -1; dy = -o_abs(y1 - y0); sy = y0 < y1 ? 1 : -1;
  err = dx + dy; xmaj = dx >= -dy; lo = (ws - 1) / 2;
  for (;;) {
    for (k = 0; k < ws; k++) { if (xmaj) o_put(b, x0, y0 - lo + k, col); else o_put(b, x0 - lo + k, y0, col); }
    if (x0 == x1 && y0 == y1) break;
    e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
static void o_disk(uint16_t *b, int x, int y, int d, uint16_t col) {
  int r = d / 2;
  if (d <= 0) return;
  for (int j = -r; j <= r; j++) for (int i = -r; i <= r; i++) if (4 * (i * i + j * j) <= d * d) o_put(b, x + i, y + j, col);
}
static void old_line(uint16_t *b, const pt_t *p, uint32_t n, int w, uint16_t col, int round) {   /* opa 255 */
  if (!n || w <= 0) return;
  if (n == 1) o_seg(b, p[0].x, p[0].y, p[0].x, p[0].y, w, col);
  for (uint32_t i = 1; i < n; i++) o_seg(b, p[i - 1].x, p[i - 1].y, p[i].x, p[i].y, w, col);
  if (round && w >= 3) for (uint32_t i = 0; i < n; i++) o_disk(b, p[i].x, p[i].y, w, col);
}

static uint64_t hash(const uint16_t *b) {
  uint64_t h = 1469598103934665603ULL;
  for (int i = 0; i < 240 * 256; i++) { h ^= b[i]; h *= 1099511628211ULL; }
  return h;
}

int main(int argc, char **argv) {
  if (argc < 2) return 2;
  const char *c = argv[1];
  int a[600], na = 0;
  for (int i = 2; i < argc && na < 600; i++) a[na++] = atoi(argv[i]);
  pt_t p[290]; uint32_t n = 0, work = 0;
  uint64_t refhash = 0;
  if (!strcmp(c, "line") || !strcmp(c, "work") || !strcmp(c, "aa") || !strcmp(c, "aa2")) {   /* w col opa round x y x y ... */
    for (int i = 4; i + 1 < na && n < 290; i += 2) { p[n].x = (int16_t)a[i]; p[n].y = (int16_t)a[i + 1]; n++; }
    if (!strcmp(c, "line")) { rs_line(&cv, p, n, a[0], (uint16_t)a[1], (uint8_t)a[2], a[3]);
      if (a[2] == 255) { old_line(ref, p, n, a[0], (uint16_t)a[1], a[3]); refhash = hash(ref); } }
    if (!strcmp(c, "aa")) rs_line_aa(&cv, p, n, a[0] * 2, (uint16_t)a[1], (uint8_t)a[2], a[3]);   /* w in px */
    if (!strcmp(c, "aa2")) rs_line_aa(&cv, p, n, a[0], (uint16_t)a[1], (uint8_t)a[2], a[3]);      /* w in half px */
    work = rs_work(p, n, a[0]);
  } else if (!strcmp(c, "fill")) {                         /* col x y x y ... */
    for (int i = 1; i + 1 < na && n < 290; i += 2) { p[n].x = (int16_t)a[i]; p[n].y = (int16_t)a[i + 1]; n++; }
    work = rs_fill(&cv, p, n, (uint16_t)a[0]);              /* the painted pixels */
    old_fill(ref, 240, 256, p, n, (uint16_t)a[0]);
    refhash = hash(ref);
  } else if (!strcmp(c, "disk")) { rs_disk(&cv, a[0], a[1], a[2], (uint16_t)a[3], (uint8_t)a[4]);
    if (a[4] == 255) { o_disk(ref, a[0], a[1], a[2], (uint16_t)a[3]); refhash = hash(ref); } }
  else if (!strcmp(c, "rect")) rs_rect(&cv, a[0], a[1], a[2], a[3], (uint16_t)a[4]);
  else return 2;
  const char *pr = getenv("PROBE"); int probe = -1;                   /* PROBE="x,y": that pixel's value */
  if (pr) { int px = atoi(pr), py = atoi(strchr(pr, ',') + 1); probe = buf[py * 240 + px]; }
  unsigned sum = 0;                                                    /* sum of the green channel (0..63) of all pixels */
  for (int i = 0; i < 240 * 256; i++) sum += (buf[i] >> 5) & 63;
  int changed = 0, x0 = 9999, y0 = 9999, x1 = -1, y1 = -1, first = -1;
  for (int y = 0; y < 256; y++) for (int x = 0; x < 240; x++) if (buf[y * 240 + x]) {
    changed++; if (first < 0) first = buf[y * 240 + x];
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  printf("{\"hash\":\"%016llx\",\"ref\":\"%016llx\",\"changed\":%d,\"box\":[%d,%d,%d,%d],\"first\":%d,\"work\":%u,\"probe\":%d,\"sum\":%u}\n",
         (unsigned long long)hash(buf), (unsigned long long)refhash, changed, x0, y0, x1, y1, first, work, probe, sum);
  return 0;
}
