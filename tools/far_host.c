/* Host driver of the far-map reader and draw (23 Nov): firmware/wayback/wb_far.c on the raster and view modules.
 *   far_host draw FILE AT SIZE LAT_E7 LON_E7 COURSE SCALE FAIL_AT PIX_CAP PT_CAP LIMIT_US
 *   Fake projection: rider at screen (120, 216), heading-up, SCALE m/px. FAIL_AT: the k-th read fails (0 = none).
 *   PIX_CAP, PT_CAP: 0 = the header values. The clock stays at 0, so LIMIT_US 0 stops at once. Prints JSON. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "wb_far.h"

static uint16_t canvas_buf[240 * 256];
static int n_reads, fail_at;
static int file_read(void *ctx, uint32_t off, void *dst, uint32_t n) {
  n_reads++;
  if (fail_at && n_reads == fail_at) return 0;
  if (fseek((FILE *)ctx, (long)off, SEEK_SET) != 0) return 0;
  return fread(dst, 1, n, (FILE *)ctx) == n;
}
static uint32_t clock0(void) { return 0u; }
static pt_t fake(double dx, double dy, double course, double scale) {
  double c = course * M_PI / 180.0, e = dx / 16.0, n = dy / 16.0;
  pt_t p = { (int16_t)lround(120.0 + (e * cos(c) - n * sin(c)) / scale), (int16_t)lround(216.0 - (e * sin(c) + n * cos(c)) / scale) };
  return p;
}
int main(int argc, char **argv) {
  FILE *f; fm_layer l; fm_stat st; vw_t v; pt_t a[4]; rs_canvas cv = { canvas_buf, 240, 256 };
  uint8_t *buf; uint32_t at, size, x = 0, y = 0, course, i, forest = 0, street = 0; double scale; int open, done = 0, ok = 0, units = 0;
  if (argc != 13 || strcmp(argv[1], "draw")) return 2;
  at = (uint32_t)strtoul(argv[3], 0, 10); size = (uint32_t)strtoul(argv[4], 0, 10);
  course = (uint32_t)strtoul(argv[7], 0, 10); scale = strtod(argv[8], 0); fail_at = atoi(argv[9]);
  if (!(f = fopen(argv[2], "rb")) || !(buf = malloc(GL_BUF))) return 3;
  memset(&st, 0, sizeof st);
  open = fm_open(&l, file_read, f, at, size, buf);
  if (open) {
    units = fm_units(&l, (int32_t)strtol(argv[5], 0, 10), (int32_t)strtol(argv[6], 0, 10), &x, &y);
    if (atoi(argv[10])) l.l.pix_cap = (uint32_t)atoi(argv[10]);
    if (atoi(argv[11])) l.l.pt_cap = (uint32_t)atoi(argv[11]);
    for (i = 0; i < 4; i++) a[i] = fake((i & 1u) * VW_REF, (i >> 1) * VW_REF, course, scale);
    ok = units && vw_fit(&v, (int32_t)x, (int32_t)y, a);
    if (ok) done = fm_draw(&l, &cv, &v, x, y, course, clock0, 0u, (uint32_t)strtoul(argv[12], 0, 10), &st);
  }
  for (i = 0; i < 240u * 256u; i++) { forest += canvas_buf[i] == RS_RGB(0xa2d683u); street += canvas_buf[i] == RS_RGB(0x9a9ea3u); }
  printf("{\"open\":%d,\"view\":%d,\"x\":%u,\"y\":%u,\"done\":%d,\"lines\":%u,\"areas\":%u,\"points\":%u,\"work\":%u,\"stop\":%u,\"reads\":%d,\"forestPx\":%u,\"streetPx\":%u}\n",
         open, ok, x, y, done, st.lines, st.areas, st.points, st.work, st.stop, n_reads, forest, street);
  free(buf); fclose(f);
  return 0;
}
