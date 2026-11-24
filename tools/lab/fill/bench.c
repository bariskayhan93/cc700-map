#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "raster.h"
void fill_band(const rs_canvas *, const pt_t *, uint32_t, uint16_t);
void fill_band32(const rs_canvas *, const pt_t *, uint32_t, uint16_t);
/* counting copy of rs_fill (tests = rows x edges, crossings, pixels) */
static unsigned long long T, X, PX;
static void count_old(const pt_t *p, uint32_t n, int W, int H) {
  int y0 = 1 << 30, y1 = -(1 << 30); for (uint32_t i = 0; i < n; i++) { if (p[i].y < y0) y0 = p[i].y; if (p[i].y > y1) y1 = p[i].y; }
  if (y0 < 0) y0 = 0; if (y1 > H - 1) y1 = H - 1;
  for (int y = y0; y <= y1; y++) { int16_t xs[128]; int k = 0; for (uint32_t i = 0, j = n - 1; i < n; j = i++) { T++; int ya = p[j].y, yb = p[i].y; if ((ya > y) == (yb > y) || k >= 128) continue; X++;
      int xa = p[j].x, xb = p[i].x; if (ya > yb) { int t = ya; ya = yb; yb = t; t = xa; xa = xb; xb = t; } int dy = yb - ya, den = 2 * dy, num = 2 * xa * dy + (xb - xa) * (2 * (y - ya) + 1) - dy;
      int x = num / den + (num > 0 && num % den != 0); int m = k++; while (m > 0 && xs[m - 1] > x) { xs[m] = xs[m - 1]; m--; } xs[m] = x; }
    int odd = 0; for (int m = 0; m < k; m++) { if (odd && xs[odd - 1] == xs[m]) odd--; else xs[odd++] = xs[m]; } k = odd;
    for (int m = 0; m + 1 < k; m += 2) { int a = xs[m] < 0 ? 0 : xs[m], b = xs[m + 1] > W ? W : xs[m + 1]; if (b > a) PX += b - a; } } }
static unsigned long long BT;   /* band: edge visits = bands x n + rows x band list */
static void count_band(const pt_t *p, uint32_t n, int W, int H) {
  int y0 = 1 << 30, y1 = -(1 << 30), x0 = 1 << 30, x1 = -(1 << 30); for (uint32_t i = 0; i < n; i++) { if (p[i].y < y0) y0 = p[i].y; if (p[i].y > y1) y1 = p[i].y; if (p[i].x < x0) x0 = p[i].x; if (p[i].x > x1) x1 = p[i].x; }
  if (x1 <= 0 || x0 >= W) return; if (y0 < 0) y0 = 0; if (y1 > H - 1) y1 = H - 1;
  for (int by = y0; by <= y1; by += 16) { int be = by + 15 > y1 ? y1 : by + 15, nl = 0; BT += n;
    for (uint32_t i = 0, j = n - 1; i < n; j = i++) { int ya = p[j].y, yb = p[i].y, lo = ya < yb ? ya : yb, hi = ya < yb ? yb : ya; if (lo == hi || lo > be || hi <= by) continue; nl++; }
    BT += (unsigned long long)nl * (be - by + 1); } }
typedef struct { int n; pt_t *p; int c; } ring;
typedef struct { int nr; ring *r; } screen;
static screen *S; static int NS;
static void load(const char *f) { FILE *fp = fopen(f, "rb"); uint32_t ns; fread(&ns, 4, 1, fp); NS = ns; S = calloc(ns, sizeof *S);
  for (int s = 0; s < NS; s++) { uint32_t nr; fread(&nr, 4, 1, fp); S[s].nr = nr; S[s].r = calloc(nr ? nr : 1, sizeof(ring));
    for (uint32_t k = 0; k < nr; k++) { uint16_t h[2]; fread(h, 2, 2, fp); S[s].r[k].n = h[0]; S[s].r[k].c = h[1]; S[s].r[k].p = malloc(4 * h[0]); fread(S[s].r[k].p, 4, h[0], fp); } } fclose(fp); }
static uint16_t A[240 * 256] __attribute__((aligned(4))), B[240 * 256] __attribute__((aligned(4)));
typedef void (*fill_fn)(const rs_canvas *, const pt_t *, uint32_t, uint16_t);
static double run(fill_fn f, uint16_t *buf, int reps, int outline) {
  rs_canvas c = { buf, 240, 256 }; struct timespec t0, t1; clock_gettime(CLOCK_MONOTONIC, &t0);
  for (int r = 0; r < reps; r++) for (int s = 0; s < NS; s++) { memset(buf, 0xff, sizeof A); for (int k = 0; k < S[s].nr; k++) { ring *g = &S[s].r[k]; f(&c, g->p, g->n, (uint16_t)(0x1000 * (g->c & 15) + k));
      if (outline && (g->c & 16)) { pt_t q[g->n + 1]; memcpy(q, g->p, 4 * g->n); q[g->n] = g->p[0]; rs_line(&c, q, g->n + 1, 1, 0x2222, 255, 0); } } }
  clock_gettime(CLOCK_MONOTONIC, &t1); return ((t1.tv_sec - t0.tv_sec) * 1e9 + (t1.tv_nsec - t0.tv_nsec)) / reps / NS; }
int main(int argc, char **argv) {
  load(argv[1]); int reps = argc > 2 ? atoi(argv[2]) : 20;
  /* identity: every screen, old vs band vs band32 */
  int diff = 0; rs_canvas a = { A, 240, 256 }, b = { B, 240, 256 };
  fill_fn fs[2] = { fill_band, fill_band32 };
  for (int v = 0; v < 2; v++) for (int s = 0; s < NS; s++) { memset(A, 0xff, sizeof A); memset(B, 0xff, sizeof B);
    for (int k = 0; k < S[s].nr; k++) { ring *g = &S[s].r[k]; rs_fill(&a, g->p, g->n, (uint16_t)(0x1000 * (g->c & 15) + k)); fs[v](&b, g->p, g->n, (uint16_t)(0x1000 * (g->c & 15) + k)); }
    if (memcmp(A, B, sizeof A)) diff++; }
  /* counts per screen */
  unsigned long long *t = calloc(NS, 8), *x = calloc(NS, 8), *px = calloc(NS, 8), *bt = calloc(NS, 8);
  for (int s = 0; s < NS; s++) { T = X = PX = BT = 0; for (int k = 0; k < S[s].nr; k++) { count_old(S[s].r[k].p, S[s].r[k].n, 240, 256); count_band(S[s].r[k].p, S[s].r[k].n, 240, 256); } t[s] = T; x[s] = X; px[s] = PX; bt[s] = BT; }
  int cmp(const void *u, const void *w) { unsigned long long a1 = *(const unsigned long long *)u, b1 = *(const unsigned long long *)w; return a1 < b1 ? -1 : a1 > b1; }
  #define Q(arr, pp) ({ qsort(arr, NS, 8, cmp); arr[(int)((NS - 1) * pp)]; })
  printf("%s screens %d | identical: band %s, band32 %s (%d diff)\n", argv[1], NS, diff ? "NO" : "yes", diff ? "?" : "yes", diff);
  printf("edge tests old p50 %llu p90 %llu max %llu | band edge visits p50 %llu p90 %llu max %llu | crossings p90 %llu | pixels p50 %llu p90 %llu max %llu\n",
    Q(t, .5), Q(t, .9), Q(t, 1), Q(bt, .5), Q(bt, .9), Q(bt, 1), Q(x, .9), Q(px, .5), Q(px, .9), Q(px, 1));
  double o = run(rs_fill, A, reps, 0), n1 = run(fill_band, A, reps, 0), n2 = run(fill_band32, A, reps, 0), ol = run(rs_fill, A, reps, 1);
  printf("host ns per screen (incl. 123 KB clear): old %.0f | band %.0f | band32 %.0f | old + 1px outline %.0f\n", o, n1, n2, ol);
  return 0; }
