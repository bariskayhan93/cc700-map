/* Host command for the way-back core. Usage: wayback_host FILE ROUTE_ID_HEX32 < lines
 * Each input line: lat_e7 lon_e7 exit_cm flags max_points fail_read_after
 * Each output line: one JSON object. Used by tools/wayback_core_host.mjs. */
#include "wayback.h"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>

typedef struct {
  FILE *f;
  long reads;
  int in_points;
  long point_reads;
  long fail_after;
} host_ctx;

static int host_reader(void *vctx, uint32_t offset, void *dst, uint32_t bytes) {
  host_ctx *c = (host_ctx *)vctx;
  c->reads++;
  if (c->in_points) {
    if (c->fail_after >= 0 && c->point_reads >= c->fail_after) return 0;
    c->point_reads++;
  }
  if (fseek(c->f, (long)offset, SEEK_SET) != 0) return 0;
  return fread(dst, 1, bytes, c->f) == bytes ? 1 : 0;
}

static int hex_value(int ch) {
  if (ch >= '0' && ch <= '9') return ch - '0';
  if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
  if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
  return -1;
}

static int parse_route_id(const char *hex, uint8_t out[16]) {
  unsigned i;
  for (i = 0; i < 16u; i++) {
    int hi = hex_value(hex[2 * i]), lo = hex_value(hex[2 * i + 1]);
    if (hi < 0 || lo < 0) return 0;
    out[i] = (uint8_t)(hi * 16 + lo);
  }
  return hex[32] == '\0';
}

int main(int argc, char **argv) {
  FILE *f;
  uint8_t route[16];
  host_ctx c;
  wb_engine *eng;
  long size, lat, lon, exit_cm, flags, max_points, fail_after;
  int mounted;

  if (argc != 3 || !parse_route_id(argv[2], route)) return 2;
  f = fopen(argv[1], "rb");
  if (!f) return 2;
  if (fseek(f, 0, SEEK_END) != 0) return 2;
  size = ftell(f);
  if (size < 0 || fseek(f, 0, SEEK_SET) != 0) return 2;
  eng = malloc(wb_size());
  if (!eng) return 2;
  c.f = f;
  c.reads = 0;
  c.in_points = 0;
  c.point_reads = 0;
  c.fail_after = -1;
  mounted = wb_mount(eng, host_reader, &c, (uint32_t)size, route);

  while (scanf("%ld %ld %ld %ld %ld %ld", &lat, &lon, &exit_cm, &flags, &max_points, &fail_after) == 6) {
    wb_input in;
    wb_output out;
    int32_t pt[2];
    long idx;
    if (!mounted) {
      printf("{\"mounted\":0}\n");
      continue;
    }
    c.reads = 0;
    c.in_points = 0;
    c.point_reads = 0;
    c.fail_after = fail_after;
    in.lat_e7 = (int32_t)lat;
    in.lon_e7 = (int32_t)lon;
    in.exit_progress_cm = (uint32_t)exit_cm;
    in.flags = (uint32_t)flags;
    wb_tick(eng, &in, &out);
    printf("{\"mounted\":1,\"state\":%" PRIu32 ",\"reason\":%" PRIu32 ",\"distanceDm\":%" PRIu32
           ",\"forward\":%" PRIu32 ",\"changed\":%" PRIu32 ",\"points\":[",
           out.state, out.reason, out.distance_dm, out.forward, out.changed);
    if (out.state == WB_LINE) {
      c.in_points = 1;
      for (idx = 0; idx < max_points && idx < 4096; idx++) {
        if (!wb_read_point(eng, (uint32_t)idx, pt)) break;
        printf("%s[%" PRId32 ",%" PRId32 "]", idx ? "," : "", pt[0], pt[1]);
      }
      c.in_points = 0;
    }
    printf("],\"reads\":%ld}\n", c.reads);
  }
  wb_unmount(eng);
  free(eng);
  fclose(f);
  return 0;
}
