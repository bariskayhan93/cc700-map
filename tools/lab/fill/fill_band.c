/* Candidate fills for raster.c. Same crossings, same order, same 128 cap, same hole-bridge cancel: identical pixels.
 * fill_band: rows in bands of 16; one pass over the edges per band collects the edges that cross the band (stack list,
 * at most 256, else that band falls back to all edges). fill_band32: same, spans written two pixels per store. */
#include "raster.h"
#define BAND 16
#define BLIST 256
#ifndef SMALL
#define SMALL 4096
#endif
static inline void row_spans(uint16_t *row, int W, int16_t *xs, int k, uint16_t col, int wide) {
  int odd = 0;
  for (int m = 0; m < k; m++) { if (odd && xs[odd - 1] == xs[m]) odd--; else xs[odd++] = xs[m]; }
  k = odd;
  for (int m = 0; m + 1 < k; m += 2) {
    int a = xs[m] < 0 ? 0 : xs[m], b = xs[m + 1] > W ? W : xs[m + 1];
    if (!wide) { for (int x = a; x < b; x++) row[x] = col; continue; }
    if (a < b && (a & 1)) row[a++] = col;
    uint32_t c2 = (uint32_t)col | ((uint32_t)col << 16), *r2 = (uint32_t *)(row + a);
    for (; a + 1 < b; a += 2) *r2++ = c2;
    if (a < b) row[a] = col;
  }
}
static inline int cross(const pt_t *p, uint32_t i, uint32_t j, int y) {
  int ya = p[j].y, yb = p[i].y, xa = p[j].x, xb = p[i].x;
  if (ya > yb) { int t = ya; ya = yb; yb = t; t = xa; xa = xb; xb = t; }
  int dy = yb - ya, den = 2 * dy, num = 2 * xa * dy + (xb - xa) * (2 * (y - ya) + 1) - dy;
  return num / den + (num > 0 && num % den != 0);
}
static void fill_b(const rs_canvas *c, const pt_t *p, uint32_t n, uint16_t col, int wide) {
  uint16_t *buf = c->buf; int W = c->w, H = c->h;
  if (!buf || n < 3) return;
  int y0 = 1 << 30, y1 = -(1 << 30), x0 = 1 << 30, x1 = -(1 << 30);
  for (uint32_t i = 0; i < n; i++) { if (p[i].y < y0) y0 = p[i].y; if (p[i].y > y1) y1 = p[i].y; if (p[i].x < x0) x0 = p[i].x; if (p[i].x > x1) x1 = p[i].x; }
  if (x1 <= 0 || x0 >= W) return;                       /* every span would be empty */
  if (y0 < 0) y0 = 0;
  if (y1 > H - 1) y1 = H - 1;
  int small = (int)n * (y1 - y0 + 1) < SMALL;           /* small ring: one band with all edges is the old loop */
  int16_t xs[128]; uint16_t L[BLIST];
  for (int by = y0; by <= y1; by = (small ? y1 : by + BAND - 1) + 1) {
    int be = small ? y1 : (by + BAND - 1 > y1 ? y1 : by + BAND - 1), nl = 0, full = small;
    for (uint32_t i = 0, j = n - 1; i < n; j = i++) {
      int ya = p[j].y, yb = p[i].y, lo = ya < yb ? ya : yb, hi = ya < yb ? yb : ya;
      if (lo == hi || lo > be || hi <= by) continue;
      if (full) break;
      if (nl == BLIST) { full = 1; break; }
      L[nl++] = (uint16_t)i;
    }
    for (int y = by; y <= be; y++) {
      int k = 0;
      if (full) { for (uint32_t i = 0, j = n - 1; i < n; j = i++) { int ya = p[j].y, yb = p[i].y; if ((ya > y) == (yb > y) || k >= 128) continue;
          int x = cross(p, i, j, y), m = k++; while (m > 0 && xs[m - 1] > x) { xs[m] = xs[m - 1]; m--; } xs[m] = x; } }
      else for (int q = 0; q < nl; q++) { uint32_t i = L[q], j = i ? i - 1 : n - 1; int ya = p[j].y, yb = p[i].y; if ((ya > y) == (yb > y) || k >= 128) continue;
          int x = cross(p, i, j, y), m = k++; while (m > 0 && xs[m - 1] > x) { xs[m] = xs[m - 1]; m--; } xs[m] = x; }
      row_spans(buf + y * W, W, xs, k, col, wide);
    }
  }
}
void fill_band(const rs_canvas *c, const pt_t *p, uint32_t n, uint16_t col) { fill_b(c, p, n, col, 0); }
void fill_band32(const rs_canvas *c, const pt_t *p, uint32_t n, uint16_t col) { fill_b(c, p, n, col, 1); }
