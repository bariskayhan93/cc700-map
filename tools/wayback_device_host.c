/* Host command for the device adapter (firmware/wayback/wb_device.c, built with -DHOST).
 * Usage: wayback_device_host FILE LAT LON OFF_ROUTE STACK PART PATH_MODE GPS CLOCK_STEP_US OPEN_OK
 * PATH_MODE: 1 = the route file is the second open file, 0 = no route handle, -1 = table lock busy,
 * 2 = navigation lock busy. Prints one JSON object. The stubs stand for the firmware calls only. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void wb_rt(uint32_t part);

void *host_nav_sem = &host_nav_sem, *host_file_sem = &host_file_sem, *host_fps[6], *host_canvas = &host_canvas;
int32_t host_file_cnt;
uint8_t host_file_tab[20 * 132], host_label_opa;
int16_t host_dash;
uint16_t host_label_col = 0x1234;

static float g_pos[2];
static uint32_t g_off, g_stack, g_gps, g_clock, g_step, g_open_ok;
static int g_busy_file, g_busy_nav, held;
static int n_rt, n_open, n_close, n_lines, n_text, n_reads, n_take, n_give, bad_dash;
static uint32_t line_op[4], line_n[4];
static float line_first[4][2], line_last[4][2];
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
  strncpy(opened, path, sizeof opened - 1);
  if (!g_open_ok || strcmp(mode, "rb")) return 0;
  f = fopen(path, mode); if (f) n_open++; return f;
}
int host_fclose(void *f) { n_close++; return fclose((FILE *)f); }
int host_fseek(void *f, int32_t off, int whence) { return fseek((FILE *)f, off, whence); }
uint32_t host_fread(void *dst, uint32_t size, uint32_t n, void *f) { n_reads++; return (uint32_t)fread(dst, size, n, (FILE *)f); }
void host_proj(const float *p, uint32_t n) {
  if (!(host_dash & 0x8000)) bad_dash++;
  if (n_lines < 4) {
    line_op[n_lines] = (uint32_t)host_dash & 0xffu; line_n[n_lines] = n;
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
  if (argc != 11) return 2;
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
  printf("{\"rt\":%d,\"opens\":%d,\"closes\":%d,\"reads\":%d,\"texts\":%d,\"text\":\"%s\",\"opened\":\"%s\",", n_rt, n_open, n_close, n_reads, n_text, text, opened);
  printf("\"takes\":%d,\"gives\":%d,\"dashAfter\":%d,\"badDash\":%d,\"labelCol\":%u,\"lines\":[", n_take, n_give, host_dash, bad_dash, host_label_col);
  for (i = 0; i < n_lines && i < 4; i++)
    printf("%s{\"op\":%u,\"n\":%u,\"first\":[%.7f,%.7f],\"last\":[%.7f,%.7f]}", i ? "," : "", line_op[i], line_n[i],
           (double)line_first[i][0], (double)line_first[i][1], (double)line_last[i][0], (double)line_last[i][1]);
  printf("]}\n");
  return 0;
}
