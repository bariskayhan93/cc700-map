/* Host command for the device adapter (firmware/wayback/wb_device.c, built with -DHOST).
 * Usage: wayback_device_host FILE LAT LON OFF_ROUTE STACK PART PATH_MODE GPS
 * PATH_MODE: 1 = the route file is found, 0 = none, -1 = lock busy. Prints one JSON object. */
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

void wb_rt(uint32_t part);

static const char *g_file;
static float g_pos[2];
static uint32_t g_off, g_stack, g_gps;
static int g_path;
static int n_rt, n_open, n_close, n_lines, n_text, n_reads;
static uint32_t line_op[4], line_n[4];
static float line_first[4][2], line_last[4][2];
static char text[128];

void host_cc_rt(uint32_t part) { (void)part; n_rt++; }
uint32_t host_cc_pos(float *p) { if (!g_gps) return 0; p[0] = g_pos[0]; p[1] = g_pos[1]; return 1; }
uint32_t host_off_route(void) { return g_off; }
uint32_t host_stack(void) { return g_stack; }
int host_path(char *name) { if (g_path == 1) { strncpy(name, g_file, 127); name[127] = 0; } return g_path; }
void *host_fopen(const char *path, const char *mode) { FILE *f = fopen(path, mode); if (f) n_open++; return f; }
int host_fclose(void *f) { n_close++; return fclose((FILE *)f); }
int host_fseek(void *f, int32_t off, int whence) { return fseek((FILE *)f, off, whence); }
uint32_t host_fread(void *dst, uint32_t size, uint32_t n, void *f) { n_reads++; return (uint32_t)fread(dst, size, n, (FILE *)f); }
void host_line(const float *p, uint32_t n, uint32_t op) {
  if (n_lines < 4) {
    line_op[n_lines] = op; line_n[n_lines] = n;
    line_first[n_lines][0] = p[0]; line_first[n_lines][1] = p[1];
    line_last[n_lines][0] = p[2 * (n - 1)]; line_last[n_lines][1] = p[2 * (n - 1) + 1];
  }
  n_lines++;
}
void host_text(const char *s) { n_text++; strncpy(text, s, sizeof text - 1); }

int main(int argc, char **argv) {
  int i;
  if (argc != 9) return 2;
  g_file = argv[1];
  g_pos[0] = strtof(argv[2], 0); g_pos[1] = strtof(argv[3], 0);
  g_off = (uint32_t)atoi(argv[4]); g_stack = (uint32_t)atoi(argv[5]);
  g_path = atoi(argv[7]); g_gps = (uint32_t)atoi(argv[8]);
  wb_rt((uint32_t)atoi(argv[6]));
  printf("{\"rt\":%d,\"opens\":%d,\"closes\":%d,\"reads\":%d,\"texts\":%d,\"text\":\"%s\",\"lines\":[", n_rt, n_open, n_close, n_reads, n_text, text);
  for (i = 0; i < n_lines && i < 4; i++)
    printf("%s{\"op\":%u,\"n\":%u,\"first\":[%.7f,%.7f],\"last\":[%.7f,%.7f]}", i ? "," : "", line_op[i], line_n[i],
           (double)line_first[i][0], (double)line_first[i][1], (double)line_last[i][0], (double)line_last[i][1]);
  printf("]}\n");
  return 0;
}
