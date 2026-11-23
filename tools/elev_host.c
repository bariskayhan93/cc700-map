/* Host driver of firmware/elev (the lens chart). The same C runs on the unit.
 *   elev_host geom LEN_M PROG_M      -> {"lx0", "lx1", "ranges": [240 x [zone, d0, d1]]}
 *   elev_host core FILE PROG_M       -> {"ok", "lens": [lo, rng], "route": [lo, rng], "climb", "grade": [30],
 *                                       "spans": [240 x [ok, lo, hi]]}   (dm; lens columns use the fine blocks)
 *   elev_host fmt REM_M CLIMB_M      -> {"num", "unit", "climb"}
 *   elev_host draw FILE PROG_M OUT   -> the test background, then el_draw: OUT.raw (u16 LE) and OUT.ppm; {"ok"}
 *   elev_host plain LEN_M PROG_M OUT -> the test background, then el_plain; OUT.raw and OUT.ppm
 *   elev_host mix D S A              -> {"v": el_mix(D, S, A)}
 * FILE holds the section bytes (header, coarse table, blocks). */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "elev.h"

static uint8_t file[1 << 21];
static uint16_t cbuf[240 * 256];

static void background(void) {
  int x, y;
  for (y = 0; y < 256; y++) for (x = 0; x < 240; x++)
    cbuf[y * 240 + x] = (uint16_t)(((x >> 3) & 31) << 11 | ((y >> 2) & 63) << 5 | (((x + y) >> 4) & 31));
}

static void dump(const char *out) {
  char name[512];
  FILE *f;
  int i;
  snprintf(name, sizeof name, "%s.raw", out);
  if ((f = fopen(name, "wb"))) { for (i = 0; i < 240 * 256; i++) { fputc(cbuf[i] & 255, f); fputc(cbuf[i] >> 8, f); } fclose(f); }
  snprintf(name, sizeof name, "%s.ppm", out);
  if ((f = fopen(name, "wb"))) {
    fprintf(f, "P6\n240 256\n255\n");
    for (i = 0; i < 240 * 256; i++) { fputc((cbuf[i] >> 11) << 3, f); fputc(((cbuf[i] >> 5) & 63) << 2, f); fputc((cbuf[i] & 31) << 3, f); }
    fclose(f);
  }
}

/* Reads FILE and builds the view of progress P as the unit does. 0 = refused. */
static int view_of(const char *name, uint32_t P, el_head *h, el_view *v) {
  FILE *f = fopen(name, "rb");
  size_t n;
  uint32_t k0 = 0, nb;
  if (!f) return 0;
  n = fread(file, 1, sizeof file, f); fclose(f);
  if (n < EL_HEAD2 || !el_head_parse(h, file)) return 0;
  nb = el_blocks_for(h, P, &k0);
  if (EL_HEAD2 + (size_t)(k0 + nb) * EL_BLOCK > n) return 0;
  v->h = h; v->coarse = file + 16; v->blk = file + EL_HEAD2 + k0 * EL_BLOCK; v->k0 = k0; v->nblk = nb;
  v->len_m = h->len_cm / 100u; v->prog_m = P;
  return 1;
}

int main(int argc, char **argv) {
  el_head h;
  el_view v;
  uint32_t d0, d1, P;
  int32_t lo, hi;
  int x, z, ok;
  if (argc == 4 && !strcmp(argv[1], "geom")) {
    uint32_t L = (uint32_t)strtoul(argv[2], 0, 10);
    P = (uint32_t)strtoul(argv[3], 0, 10);
    printf("{\"lx0\":%d,\"lx1\":%d,\"ranges\":[", el_lens_x0(L, P), el_lens_x1(L, P));
    for (x = 0; x < 240; x++) { z = el_col_range(L, P, x, &d0, &d1); printf("%s[%d,%u,%u]", x ? "," : "", z, d0, d1); }
    printf("]}\n");
    return 0;
  }
  if (argc == 4 && !strcmp(argv[1], "core")) {
    P = (uint32_t)strtoul(argv[3], 0, 10);
    ok = view_of(argv[2], P, &h, &v);
    printf("{\"ok\":%d", ok);
    if (ok) {
      el_lens_scale(&v, &lo, &hi); printf(",\"lens\":[%d,%d]", lo, hi);
      el_route_scale(&v, &lo, &hi); printf(",\"route\":[%d,%d],\"climb\":%u,\"grade\":[", lo, hi, el_climb(&v));
      for (x = 0; x < 30; x++) printf("%s%d", x ? "," : "", el_grade(&v, P + 100u * (uint32_t)x));
      printf("],\"spans\":[");
      for (x = 0; x < 240; x++) {
        z = el_col_range(v.len_m, P, x, &d0, &d1);
        lo = hi = 0;
        ok = z != EL_NONE && el_span(&v, d0, d1, z == EL_LENS, &lo, &hi);
        printf("%s[%d,%d,%d]", x ? "," : "", ok, lo, hi);
      }
      printf("]");
    }
    printf("}\n");
    return 0;
  }
  if (argc == 4 && !strcmp(argv[1], "fmt")) {
    char num[8], unit[3], c[8];
    el_fmt_dist(num, unit, (uint32_t)strtoul(argv[2], 0, 10));
    el_fmt_climb(c, (uint32_t)strtoul(argv[3], 0, 10));
    printf("{\"num\":\"%s\",\"unit\":\"%s\",\"climb\":\"%s\"}\n", num, unit, c);
    return 0;
  }
  if (argc == 5 && !strcmp(argv[1], "draw")) {
    rs_canvas cv = { cbuf, 240, 256 };
    P = (uint32_t)strtoul(argv[3], 0, 10);
    ok = view_of(argv[2], P, &h, &v);
    background();
    if (ok) el_draw(&cv, &v);
    dump(argv[4]);
    printf("{\"ok\":%d}\n", ok);
    return 0;
  }
  if (argc == 5 && !strcmp(argv[1], "plain")) {
    rs_canvas cv = { cbuf, 240, 256 };
    background();
    el_plain(&cv, (uint32_t)strtoul(argv[2], 0, 10), (uint32_t)strtoul(argv[3], 0, 10));
    dump(argv[4]);
    printf("{\"ok\":1}\n");
    return 0;
  }
  if (argc == 5 && !strcmp(argv[1], "mix")) {
    printf("{\"v\":%u}\n", el_mix((uint16_t)strtoul(argv[2], 0, 0), (uint16_t)strtoul(argv[3], 0, 0), (uint32_t)strtoul(argv[4], 0, 0)));
    return 0;
  }
  return 2;
}
