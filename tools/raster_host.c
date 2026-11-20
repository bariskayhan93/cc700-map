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
  if (!strcmp(c, "line") || !strcmp(c, "work") || !strcmp(c, "aa")) {   /* w col opa round x y x y ... */
    for (int i = 4; i + 1 < na && n < 290; i += 2) { p[n].x = (int16_t)a[i]; p[n].y = (int16_t)a[i + 1]; n++; }
    if (!strcmp(c, "line")) rs_line(&cv, p, n, a[0], (uint16_t)a[1], (uint8_t)a[2], a[3]);
    if (!strcmp(c, "aa")) rs_line_aa(&cv, p, n, a[0], (uint16_t)a[1], (uint8_t)a[2], a[3]);
    work = rs_work(p, n, a[0]);
  } else if (!strcmp(c, "fill")) {                         /* col x y x y ... */
    for (int i = 1; i + 1 < na && n < 290; i += 2) { p[n].x = (int16_t)a[i]; p[n].y = (int16_t)a[i + 1]; n++; }
    rs_fill(&cv, p, n, (uint16_t)a[0]);
    old_fill(ref, 240, 256, p, n, (uint16_t)a[0]);
    refhash = hash(ref);
  } else if (!strcmp(c, "disk")) rs_disk(&cv, a[0], a[1], a[2], (uint16_t)a[3], (uint8_t)a[4]);
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
