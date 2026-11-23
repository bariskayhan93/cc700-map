/* Host command for the way-back core. Usage:
 *   wayback_host FILE ROUTE_ID_HEX32 < lines      (one JSON object per input line)
 *   wayback_host --selftest FILE ROUTE_ID_HEX32   (one JSON object: wb_out and scan checks)
 * Each input line: lat_e7 lon_e7 exit_cm flags max_points fail_read_after
 * Used by tools/wayback_core_host.mjs. */
#include "wayback.c"
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
  FILE *f;
  long reads;
  int in_points;
  long point_reads;
  long fail_after;
  int grey_mode;
  long grey_reads, grey_fail;
} host_ctx;

static int host_reader(void *vctx, uint32_t offset, void *dst, uint32_t bytes) {
  host_ctx *c = (host_ctx *)vctx;
  c->reads++;
  if (c->grey_mode) {
    if (c->grey_fail >= 0 && c->grey_reads >= c->grey_fail) return 0;
    c->grey_reads++;
  }
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

/* The point list of the current line of e, as a JSON array (at most max points). */
static void print_points(wb_engine *e, host_ctx *c, long max_points) {
  long idx;
  int32_t pt[2];
  c->in_points = 1;
  for (idx = 0; idx < max_points && idx < 4096; idx++) {
    if (!wb_read_point(e, (uint32_t)idx, pt)) break;
    printf("%s[%" PRId32 ",%" PRId32 "]", idx ? "," : "", pt[0], pt[1]);
  }
  c->in_points = 0;
}

/* Self test: wb_out against the old far test (100,000 random pairs and the edges), and the order of wb_scan
 * (rows, then cells, then tree pieces and extra pieces in index order). */
static uint32_t old_far(uint32_t v, uint32_t c) {
  return v - c + 1940u > 2u * 1940u;
}

typedef struct { long visited, errors; int have; uint32_t row, col, kind, index; } order_ctx;

static int order_visit(void *vp, const wb_cand *c) {
  order_ctx *o = (order_ctx *)vp;
  uint32_t row = c->ya >> 11, col = c->xa >> 11, kind = (c->id & WB_EXTRA_FLAG) ? 1u : 0u, index = c->id & 0x7FFFFFu;
  o->visited++;
  if (o->have) {
    int less = row < o->row || (row == o->row && (col < o->col || (col == o->col && (kind < o->kind ||
      (kind == o->kind && index < o->index)))));
    if (less) o->errors++;
  }
  o->have = 1; o->row = row; o->col = col; o->kind = kind; o->index = index;
  return 1;
}

typedef struct { uint32_t ids[4096]; long n; } ids_ctx;
static ids_ctx cover_ids;

static int ids_visit(void *vp, const wb_cand *c) {
  ids_ctx *q = (ids_ctx *)vp;
  if (q->n < 4096) q->ids[q->n++] = c->id & 0x00FFFFFFu;
  return 1;
}

/* Coverage: at 300 rider points the piece that wb_tick chooses is visited by wb_scan of the 5 x 6 window around the
 * rider's cell (2 cells behind and 2 ahead across, 2 behind and 3 ahead along), with the rider box. */
static void cover_check(wb_engine *e, long *cases, long *errors) {
  uint32_t t = 777u, k;
  wb_grid g;
  wb_grid_get(e, &g);
  for (k = 0u; k < 300u; k++) {
    wb_input in;
    wb_output out;
    uint32_t X, Y, cx, cy, j;
    int32_t e7[2];
    long found = 0;
    {
      /* A random node of the file and an offset of up to 200 units (12.5 m): most riders are near a street. */
      uint32_t ni;
      wb_node o;
      int32_t dx, dy;
      t = t * 1664525u + 1013904223u;
      ni = e->node_count ? (t >> 8) % e->node_count : 0u;
      if (!load_node(e, ni, &o)) { (*errors)++; continue; }
      t = t * 1664525u + 1013904223u;
      dx = (int32_t)((t >> 8) % 401u) - 200;
      t = t * 1664525u + 1013904223u;
      dy = (int32_t)((t >> 8) % 401u) - 200;
      X = (uint32_t)((int32_t)o.x + dx);
      Y = (uint32_t)((int32_t)o.y + dy);
      if ((int32_t)X < 0) X = 0u;
      if ((int32_t)Y < 0) Y = 0u;
    }
    wb_point(&g, X, Y, e7);
    in.lat_e7 = e7[0];
    in.lon_e7 = e7[1];
    in.exit_progress_cm = 0u;
    in.flags = WB_GPS_VALID | WB_OFF_ROUTE;
    wb_tick(e, &in, &out);
    if (out.state != WB_LINE) continue;
    if (!wb_units(&g, in.lat_e7, in.lon_e7, &X, &Y)) { (*errors)++; continue; }
    cx = X >> 11;
    cy = Y >> 11;
    cover_ids.n = 0;
    if (!wb_scan(e, cx >= 2u ? cx - 2u : 0u, cy >= 2u ? cy - 2u : 0u, cx + 2u, cy + 3u, X, Y, X, Y, ids_visit, &cover_ids)) {
      (*errors)++;
      continue;
    }
    (*cases)++;
    for (j = 0; j < (uint32_t)cover_ids.n; j++) if (cover_ids.ids[j] == out.piece) found = 1;
    if (!found) (*errors)++;
  }
}

static void run_selftest(wb_engine *e) {
  uint32_t s = 12345u, cases = 0, mismatch = 0, k;
  order_ctx o;
  long ncells, cover_cases = 0, cover_errors = 0;
  uint32_t cx0;
  for (k = 0; k < 100000u + 8u; k++) {
    uint32_t v, c;
    if (k < 100000u) {
      s = s * 1664525u + 1013904223u; v = s;
      s = s * 1664525u + 1013904223u; c = s & 0xFFFFFFu;
    } else {
      static const uint32_t edge[8] = {0u, 1940u, 1941u, 3880u, 0xFFFFFFFFu, 0xFFFFFFFEu, 0x1000000u, 0x7FFFFFFFu};
      v = edge[k - 100000u]; c = (k & 1u) ? 0u : 0xFFFFFFu;
    }
    cases++;
    if ((uint32_t)wb_out(v, c, c) != old_far(v, c)) mismatch++;
  }
  memset(&o, 0, sizeof o);
  ncells = e->cell_count;
  for (cx0 = 0u; cx0 < 21u; cx0 += 7u) {
    if (!wb_scan(e, cx0, 0u, cx0 + 6u, 20u, 0u, 0u, 0xFFFFFFu, 0xFFFFFFu, order_visit, &o)) o.errors++;
    o.have = 0;
  }
  cover_check(e, &cover_cases, &cover_errors);
  printf("{\"wbOutCases\":%" PRIu32 ",\"wbOutMismatch\":%" PRIu32 ",\"scanOrderErrors\":%ld,\"scanVisited\":%ld,"
         "\"scanCoverCases\":%ld,\"scanCoverErrors\":%ld,\"cells\":%ld}\n",
         cases, mismatch, o.errors, o.visited, cover_cases, cover_errors, ncells);
}

int main(int argc, char **argv) {
  FILE *f;
  uint8_t route[16];
  host_ctx c;
  wb_engine *eng;
  long size, lat, lon, exit_cm, flags, max_points, fail_after;
  char line[256];
  const char *file, *hex;
  int mounted, selftest;
  wb_input in;
  wb_output out;

  selftest = argc == 4 && strcmp(argv[1], "--selftest") == 0;
  if (!selftest && argc != 3) return 2;
  file = selftest ? argv[2] : argv[1];
  hex = selftest ? argv[3] : argv[2];
  if (!parse_route_id(hex, route)) return 2;
  f = fopen(file, "rb");
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
  c.grey_mode = 0;
  c.grey_reads = 0;
  c.grey_fail = -1;
  mounted = wb_mount(eng, host_reader, &c, (uint32_t)size, route);
  if (selftest) {
    if (mounted) run_selftest(eng);
    else printf("{\"mounted\":0}\n");
    free(eng);
    fclose(f);
    return 0;
  }

  while (fgets(line, sizeof line, stdin)) {
    long reads_tick;
    if (sscanf(line, "%ld %ld %ld %ld %ld %ld", &lat, &lon, &exit_cm, &flags, &max_points, &fail_after) < 6) break;
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
           ",\"forward\":%" PRIu32 ",\"changed\":%" PRIu32 ",\"piece\":%" PRIu32 ",\"points\":[",
           out.state, out.reason, out.distance_dm, out.forward, out.changed, out.piece);
    if (out.state == WB_LINE) print_points(eng, &c, max_points);
    printf("]");
    reads_tick = c.reads;
    printf(",\"reads\":%ld}\n", reads_tick);
  }
  wb_unmount(eng);
  free(eng);
  fclose(f);
  return 0;
}
