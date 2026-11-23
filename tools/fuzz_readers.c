/* Damaged-file test of the way-back and grey readers (host, ASan + UBSan). Usage:
 *   fuzz_readers WAYBACK_FILE ROUTE_ID_HEX32 GREY_LAYER_FILE ROUNDS SEED
 * Each round changes 1-8 places of a copy of each file (bit flips, random bytes, edge values in 32-bit words,
 * a shorter length), then mounts / opens it and runs the reader on 8 rider points of the good file. The grey points
 * lie in the 1.2 km grid of tools/grey_fixture.mjs (corner 40000, 40000 units) that tools/test_fuzz_readers.mjs writes.
 * The copy is an exact-size heap block, so any read past the file or the engine is an ASan error.
 * Output: one JSON line with the counts. Used by tools/test_fuzz_readers.mjs. */
#include "wayback.c"
#include "wb_grey.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct { const uint8_t *b; uint32_t n; } mem;
static int mem_read(void *vp, uint32_t off, void *dst, uint32_t bytes) {
  const mem *m = (const mem *)vp;
  if ((uint64_t)off + bytes > m->n) return 0;
  memcpy(dst, m->b + off, bytes);
  return 1;
}
static uint8_t *load(const char *p, uint32_t *n) {
  FILE *f = fopen(p, "rb"); long s; uint8_t *b;
  if (!f || fseek(f, 0, SEEK_END) || (s = ftell(f)) <= 0 || fseek(f, 0, SEEK_SET)) exit(2);
  b = malloc((size_t)s);
  if (!b || fread(b, 1, (size_t)s, f) != (size_t)s) exit(2);
  fclose(f); *n = (uint32_t)s; return b;
}
static uint32_t rs = 1u;
static uint32_t rnd(void) { rs = rs * 1664525u + 1013904223u; return rs >> 8; }
/* A damaged copy: exact size, so ASan stops a read past its end. Half of the changes hit the first 128 B (headers). */
static uint8_t *damage(const uint8_t *src, uint32_t n, uint32_t *out_n) {
  static const uint32_t edge[] = {0u, 1u, 0x7FFFFFFFu, 0x80000000u, 0xFFFFFFFFu, 0xFFFFu, 0x10000u, 0xFFFFFFu};
  uint32_t m = n, k = 1u + rnd() % 8u, i;
  uint8_t *b;
  if (rnd() % 8u == 0u) m = n - rnd() % (n < 256u ? n : 256u);
  if (m == 0u) m = 1u;
  b = malloc(m); memcpy(b, src, m);
  for (i = 0; i < k; i++) {
    uint32_t at = (rnd() & 1u) && m > 128u ? rnd() % 128u : rnd() % m, w = rnd() % 3u;
    if (w == 0u) b[at] ^= (uint8_t)(1u << (rnd() % 8u));
    else if (w == 1u) b[at] = (uint8_t)rnd();
    else if (at + 4u <= m) { uint32_t v = edge[rnd() % 8u]; at &= ~3u; memcpy(b + at, &v, 4); }
  }
  *out_n = m; return b;
}
static int count_line(void *ctx, const int32_t *xy, uint32_t n) { (void)xy; (*(long *)ctx) += n; return 1; }

int main(int argc, char **argv) {
  uint32_t wn, gn, rounds, r, i, j, xs[8], ys[8];
  uint8_t id[16], *wf, *gf, *gbuf;
  int32_t e7[8][2];
  long mounted = 0, lines = 0, opened = 0, glines = 0, gpts = 0, points = 0;
  wb_engine *e;
  wb_grid g;
  mem m;
  if (argc != 6 || strlen(argv[2]) != 32) return 2;
  for (i = 0; i < 16; i++) { unsigned v; if (sscanf(argv[2] + 2 * i, "%2x", &v) != 1) return 2; id[i] = (uint8_t)v; }
  wf = load(argv[1], &wn); gf = load(argv[3], &gn);
  rounds = (uint32_t)strtoul(argv[4], 0, 10); rs = (uint32_t)strtoul(argv[5], 0, 10);
  e = malloc(wb_size()); gbuf = malloc(GL_BUF);
  m.b = wf; m.n = wn;
  if (!wb_mount(e, mem_read, &m, wn, id)) return 3;           /* the good file mounts */
  wb_grid_get(e, &g);
  for (j = 0; j < 8; j++) {                                    /* rider points: 0-12 m from random nodes */
    wb_node o;
    if (!load_node(e, rnd() % e->node_count, &o)) return 3;
    xs[j] = o.x + rnd() % 200u; ys[j] = o.y + rnd() % 200u;
    wb_point(&g, xs[j], ys[j], e7[j]);
  }
  for (r = 0; r < rounds; r++) {
    uint32_t n, cells[GL_CELLS], nc;
    uint8_t *b = damage(wf, wn, &n);
    gl_layer l;
    m.b = b; m.n = n;
    if (wb_mount(e, mem_read, &m, n, id)) {
      mounted++;
      for (j = 0; j < 8; j++) {
        wb_input in = {e7[j][0], e7[j][1], 0u, WB_GPS_VALID | WB_OFF_ROUTE};
        wb_output out;
        int32_t p[2];
        wb_tick(e, &in, &out);
        if (out.state == WB_LINE) {
          lines++;
          for (i = 0; i < WB_MAX_POINTS && wb_read_point(e, i, p); i++) points++;
        }
      }
    }
    free(b);
    b = damage(gf, gn, &n);
    m.b = b; m.n = n;
    if (gl_open(&l, mem_read, &m, 0u, n, gbuf)) {
      opened++;
      for (j = 0; j < 8; j++) {
        nc = gl_cells(40000u + rnd() % 20160u, 40000u + rnd() % 20160u, rnd() % 360u, cells);
        if (gl_lines(&l, cells, nc, count_line, &gpts)) glines++;
      }
    }
    free(b);
  }
  printf("{\"rounds\":%u,\"mounted\":%ld,\"lines\":%ld,\"points\":%ld,\"grey_opened\":%ld,\"grey_runs\":%ld,\"grey_points\":%ld}\n",
         rounds, mounted, lines, points, opened, glines, gpts);
  free(e); free(gbuf); free(wf); free(gf);
  return 0;
}
