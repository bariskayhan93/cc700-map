/* Host driver of the grey reader and grey draw (cc27 Tasks 7 and 8): firmware/wayback/wb_grey.c, wb_grey_draw.c on the
 * raster and view modules. The same C runs on the unit.
 *   grey_host batch: stdin lines, one answer line each:
 *     c X Y COURSE                      -> the gl_cells keys, nearest first
 *     w N UX UY S0X S0Y .. S3X S3Y X0 Y0 .. (N unit points) -> "OK WORK": vw_fit, then rs_work (width 4) of the mapped points
 *   grey_host draw FILE AT SIZE X Y COURSE SCALE FAIL_AT PIX_CAP PT_CAP
 *     Fake projection: rider at screen (120, 216), heading-up, SCALE m/px. FAIL_AT: the k-th read fails (0 = none).
 *     PIX_CAP, PT_CAP: 0 = the header values. Prints JSON. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "wb_grey_draw.h"

static uint16_t canvas_buf[240 * 256];
static int n_reads, fail_at;

static int file_read(void *ctx, uint32_t off, void *dst, uint32_t n) {
  n_reads++;
  if (fail_at && n_reads == fail_at) return 0;
  if (fseek((FILE *)ctx, (long)off, SEEK_SET) != 0) return 0;
  return fread(dst, 1, n, (FILE *)ctx) == n;
}

static pt_t fake(double dx, double dy, double course, double scale) {   /* dx, dy: units east, north of the rider */
  double c = course * M_PI / 180.0, e = dx / 16.0, n = dy / 16.0;
  pt_t p = { (int16_t)lround(120.0 + (e * cos(c) - n * sin(c)) / scale), (int16_t)lround(216.0 - (e * sin(c) + n * cos(c)) / scale) };
  return p;
}

static int batch(void) {
  char line[8192];
  while (fgets(line, sizeof line, stdin)) {
    char *s = line + 1;
    if (line[0] == 'c') {
      uint32_t x = (uint32_t)strtoul(s, &s, 10), y = (uint32_t)strtoul(s, &s, 10), c = (uint32_t)strtoul(s, &s, 10), cells[20], n, i;
      n = gl_cells(x, y, c, cells);
      for (i = 0; i < n; i++) printf("%s%u", i ? " " : "", cells[i]);
      printf("\n");
    } else if (line[0] == 'w') {
      int32_t n = (int32_t)strtol(s, &s, 10), ux = (int32_t)strtol(s, &s, 10), uy = (int32_t)strtol(s, &s, 10), i;
      pt_t a[4], p[64]; vw_t v; int ok;
      for (i = 0; i < 4; i++) { a[i].x = (int16_t)strtol(s, &s, 10); a[i].y = (int16_t)strtol(s, &s, 10); }
      ok = vw_fit(&v, ux, uy, a);
      for (i = 0; i < n && i < 64; i++) { int32_t x = (int32_t)strtol(s, &s, 10), y = (int32_t)strtol(s, &s, 10); p[i] = vw_map(&v, x, y); }
      printf("%d %u\n", ok, rs_work(p, (uint32_t)(n < 64 ? n : 64), 4));
    }
  }
  return 0;
}

int main(int argc, char **argv) {
  FILE *f; gl_layer l; gd_stat st; vw_t v; pt_t a[4]; rs_canvas cv = { canvas_buf, 240, 256 };
  uint8_t *buf; uint32_t at, size, x, y, course, i, hash = 2166136261u, px = 0; double scale; int open, done = 0, ok;
  if (argc == 2 && !strcmp(argv[1], "batch")) return batch();
  if (argc != 12 || strcmp(argv[1], "draw")) return 2;
  at = (uint32_t)strtoul(argv[3], 0, 10); size = (uint32_t)strtoul(argv[4], 0, 10);
  x = (uint32_t)strtoul(argv[5], 0, 10); y = (uint32_t)strtoul(argv[6], 0, 10); course = (uint32_t)strtoul(argv[7], 0, 10);
  scale = strtod(argv[8], 0); fail_at = atoi(argv[9]);
  if (!(f = fopen(argv[2], "rb")) || !(buf = malloc(GL_BUF))) return 3;
  for (i = 0; i < 4; i++) a[i] = fake((i & 1u) * VW_REF, (i >> 1) * VW_REF, course, scale);
  ok = vw_fit(&v, (int32_t)x, (int32_t)y, a);
  memset(&st, 0, sizeof st);
  open = gl_open(&l, file_read, f, at, size, buf);
  if (open) {
    if (atoi(argv[10])) l.pix_cap = (uint32_t)atoi(argv[10]);
    if (atoi(argv[11])) l.pt_cap = (uint32_t)atoi(argv[11]);
    if (ok) done = grey_draw(&l, &cv, &v, x, y, course, &st);
  }
  for (i = 0; i < 240u * 256u; i++) { hash = (hash ^ canvas_buf[i]) * 16777619u; px += canvas_buf[i] != 0; }
  printf("{\"view\":%d,\"open\":%d,\"done\":%d,\"lines\":%u,\"points\":%u,\"work\":%u,\"reads\":%d,\"hash\":%u,\"px\":%u,\"pixCap\":%u,\"ptCap\":%u,\"bits\":\"",
         ok, open, done, st.lines, st.points, st.work, n_reads, hash, px, open ? l.pix_cap : 0, open ? l.pt_cap : 0);
  for (i = 0; i < 240u * 256u; i++) putchar(canvas_buf[i] ? '1' : '0');
  printf("\"}\n");
  free(buf); fclose(f);
  return 0;
}
