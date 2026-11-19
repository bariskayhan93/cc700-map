/* Host command for the device adapter (firmware/wayback/wb_device.c, built with -DHOST).
 * Usage: wayback_device_host FILE LAT LON OFF_ROUTE STACK PART PATH_MODE GPS CLOCK_STEP_US OPEN_OK FAIL_AT MAP_HEAD SCALE FLAGS MALLOC_OK
 * FLAGS: the flags entry of the map block (-1 = no flags entry: a cc26 block). MALLOC_OK 0: every heap allocation fails.
 * Then U T SEL: the stock route progress (remaining m, total float, route-mode selector).
 * FAIL_AT: the k-th read fails (1-based), 0 = none. MAP_HEAD: the stock map heading, 450 - course (degrees).
 * SCALE: m/px of the fake projection (heading-up, rider at screen (120, 216)); op 23 gives the anchor back as cc_line.
 * PATH_MODE: 1 = the route file is the second open file, 0 = no route handle, -1 = table lock busy,
 * 2 = navigation lock busy. Prints one JSON object. The stubs stand for the firmware calls only. */
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "types.h"
void wb_rt(uint32_t part);

void *host_nav_sem = &host_nav_sem, *host_file_sem = &host_file_sem, *host_fps[6], *host_canvas = &host_canvas;
int32_t host_file_cnt;
uint8_t host_file_tab[20 * 132], host_label_opa;
line_dsc_t host_dsc = { 0x5555, 7, 0, 0, 255, 0 };
uint16_t host_label_col = 0x1234;
float host_map_head;
uint32_t host_route_left, host_nav_selector;
float host_route_total;
uint16_t *host_buf, host_w = 240, host_h = 256;
static double g_scale;
static int n_anchor, anchor_reads = -1, n_malloc, n_free, g_malloc_ok, n_blk, blk_held, file_under_blk;
uint32_t host_cnt;                                           /* the map block: entry 0 a street, entry 1 the flags entry */
ent_t *host_ents;
static ent_t g_ents[2];
void host_nop(void) { n_blk++; blk_held ^= 1; }              /* fw_blk_lock and fw_blk_unlock */

static float g_pos[2];
static uint32_t g_off, g_stack, g_gps, g_clock, g_step, g_open_ok;
static int g_busy_file, g_busy_nav, held;
static int n_rt, n_open, n_close, n_lines, n_text, n_reads, n_take, n_give, bad_dash;
#define MAX_LINES 64             /* projected lines of one frame: the way-back line (two passes) */
static uint32_t line_op[MAX_LINES], line_n[MAX_LINES], line_own[MAX_LINES];
static float line_first[MAX_LINES][2], line_last[MAX_LINES][2];
static uint32_t g_fail_at;                                   /* the g_fail_at-th read fails (1-based); 0 = none */
static char text[128], opened[128];

void host_cc_rt(uint32_t part) { (void)part; n_rt++; }
uint32_t host_cc_pos(float *p) { if (!g_gps || !held) return 0; p[0] = g_pos[0]; p[1] = g_pos[1]; return 1; }
uint32_t host_off_route(void) { return g_off; }
uint32_t host_stack(void) { return g_stack; }
uint32_t host_clock(void) { g_clock += g_step; return g_clock; }
int32_t host_take(void *sem, uint32_t ticks) {
  if (ticks) abort();                                          /* the adapter must never wait */
  if ((sem == host_file_sem && g_busy_file) || (sem == host_nav_sem && g_busy_nav)) return 0;
  n_take++; held++; return 1;
}
void host_give(void *sem) { (void)sem; n_give++; held--; }
void *host_fopen(const char *path, const char *mode) {
  FILE *f;
  if (held) abort();                                           /* no file call while a lock is held */
  if (blk_held) file_under_blk++;
  strncpy(opened, path, sizeof opened - 1);
  if (!g_open_ok || strcmp(mode, "rb")) return 0;
  f = fopen(path, mode); if (f) n_open++; return f;
}
int host_fclose(void *f) { n_close++; return fclose((FILE *)f); }
int host_fseek(void *f, int32_t off, int whence) { file_under_blk += blk_held; return fseek((FILE *)f, off, whence); }
uint32_t host_fread(void *dst, uint32_t size, uint32_t n, void *f) {
  n_reads++; file_under_blk += blk_held;
  if (g_fail_at && (uint32_t)n_reads == g_fail_at) return 0;
  return (uint32_t)fread(dst, size, n, (FILE *)f);
}
void *host_malloc(uint32_t n, uint32_t caps) { if (caps != 0x404u) abort(); n_malloc++; return g_malloc_ok ? malloc(n) : 0; }
void host_free(void *q) { n_free++; free(q); }
/* The stock projection with cc_line behind it: op 23 returns the screen point of p[0] in color and width and sets
 * dash_gap = 1 when the point is within +-4000 px (cc_line: sane); cc_line clears dash_width. */
void host_proj(const float *p, uint32_t n) {
  int16_t dash = host_dsc.dash_width;
  host_dsc.dash_width = 0;
  if ((dash & 0xff) == 23) {
    double c = (450.0 - (double)host_map_head) * M_PI / 180.0, k = 111320.0 * cos((double)g_pos[0] * M_PI / 180.0);
    double e = ((double)p[1] - (double)g_pos[1]) * k, nn = ((double)p[0] - (double)g_pos[0]) * 111320.0;
    double x = 120.0 + (e * cos(c) - nn * sin(c)) / g_scale, y = 216.0 - (e * sin(c) + nn * cos(c)) / g_scale;
    if (anchor_reads < 0) anchor_reads = n_reads;
    n_anchor++;
    host_dsc.dash_gap = 0;
    if (isfinite(x) && isfinite(y) && fabs(x) <= 4000.0 && fabs(y) <= 4000.0) {
      host_dsc.color = (uint16_t)(int16_t)lround(x); host_dsc.width = (int16_t)lround(y); host_dsc.dash_gap = 1;
    }
    return;
  }
  if (!(dash & 0x8000)) bad_dash++;
  if (n_lines < MAX_LINES) {
    line_op[n_lines] = (uint32_t)dash & 0xffu; line_n[n_lines] = n; line_own[n_lines] = (dash & 0x4000) != 0;
    line_first[n_lines][0] = p[0]; line_first[n_lines][1] = p[1];
    line_last[n_lines][0] = p[2 * (n - 1)]; line_last[n_lines][1] = p[2 * (n - 1) + 1];
  }
  n_lines++;
}
void host_canvas_text(void *cv, int32_t x, int32_t y, int32_t w, void *dsc, const char *s) {
  (void)cv; (void)x; (void)y; (void)w; (void)dsc;
  n_text++; strncpy(text, s, sizeof text - 1);
}

int main(int argc, char **argv) {
  int i, mode;
  void *route = &route, *other = &other;
  uint32_t k, hash = 2166136261u, px = 0;
  int flags;
  if (argc != 19) return 2;
  host_route_left = (uint32_t)strtoul(argv[16], 0, 10); host_route_total = strtof(argv[17], 0); host_nav_selector = (uint32_t)strtoul(argv[18], 0, 10);
  g_fail_at = (uint32_t)atoi(argv[11]); host_map_head = strtof(argv[12], 0); g_scale = strtod(argv[13], 0);
  flags = atoi(argv[14]); g_malloc_ok = atoi(argv[15]);
  g_ents[0].style = 3; g_ents[1].style = 15; g_ents[1].lat = BLK_FLAGS_MAGIC; g_ents[1].lon = flags;
  host_ents = g_ents; host_cnt = flags >= 0 ? 2u : 1u;
  if (!(host_buf = calloc(240u * 256u, 2u))) return 3;
  g_pos[0] = strtof(argv[2], 0); g_pos[1] = strtof(argv[3], 0);
  g_off = (uint32_t)atoi(argv[4]); g_stack = (uint32_t)atoi(argv[5]);
  mode = atoi(argv[7]); g_gps = (uint32_t)atoi(argv[8]);
  g_step = (uint32_t)atoi(argv[9]); g_open_ok = (uint32_t)atoi(argv[10]);
  g_clock = 0xfffffff0u;                                       /* the low word wraps during the frame */
  g_busy_file = mode == -1; g_busy_nav = mode == 2;
  /* Open-file table as the firmware keeps it: record 0 is another file, record 1 is the route file. */
  memcpy(host_file_tab, &other, sizeof other); strcpy((char *)host_file_tab + sizeof other, "/littlefs/LOG/x.log");
  memcpy(host_file_tab + 132, &route, sizeof route); strncpy((char *)host_file_tab + 132 + sizeof route, argv[1], 120);
  host_file_cnt = 2;
  if (mode != 0) host_fps[2] = route;                          /* a route handle of type 2 */
  wb_rt((uint32_t)atoi(argv[6]));
  for (k = 0; k < 240u * 256u; k++) { hash = (hash ^ host_buf[k]) * 16777619u; px += host_buf[k] != 0; }
  printf("{\"rt\":%d,\"opens\":%d,\"closes\":%d,\"reads\":%d,\"texts\":%d,\"text\":\"%s\",\"opened\":\"%s\",", n_rt, n_open, n_close, n_reads, n_text, text, opened);
  printf("\"takes\":%d,\"gives\":%d,\"dashAfter\":%d,\"badDash\":%d,\"labelCol\":%u,", n_take, n_give, host_dsc.dash_width, bad_dash, host_label_col);
  printf("\"anchors\":%d,\"anchorReads\":%d,\"mallocs\":%d,\"frees\":%d,\"hash\":%u,\"greyPx\":%u,\"dsc\":[%u,%d,%d],",
         n_anchor, anchor_reads, n_malloc, n_free, hash, px, host_dsc.color, host_dsc.width, host_dsc.dash_gap);
  printf("\"blockLocks\":%d,\"fileUnderBlockLock\":%d,\"lines\":[", n_blk, file_under_blk);
  for (i = 0; i < n_lines && i < MAX_LINES; i++)
    printf("%s{\"op\":%u,\"own\":%u,\"n\":%u,\"first\":[%.7f,%.7f],\"last\":[%.7f,%.7f]}", i ? "," : "", line_op[i], line_own[i], line_n[i],
           (double)line_first[i][0], (double)line_first[i][1], (double)line_last[i][0], (double)line_last[i][1]);
  printf("]}\n");
  free(host_buf);
  return 0;
}
