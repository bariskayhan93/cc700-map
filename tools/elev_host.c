/* Host driver of firmware/elev (cc27 Task 10), with the raster module. The same C runs on the unit.
 *   elev_host window LEN_CM BLOCKS STEP_DM PROGRESS_M  -> {"ok", "off", "bytes", "col0"}
 *   elev_host draw FILE PROGRESS_M                     -> {"ok", "col0", "nblk", "top": [224 x y of the dark pixel or -1],
 *                                                          "grey": [224 x grey pixels], "white": white pixels of the strip}
 * FILE holds the section bytes (header and blocks). Canvas 240 x 256, black. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "elev.h"

static uint16_t canvas_buf[240 * 256];

int main(int argc, char **argv) {
  el_head h;
  uint32_t off = 0, bytes = 0, col0 = 0, i;
  int ok;
  if (argc == 6 && !strcmp(argv[1], "window")) {
    h.len_cm = (uint32_t)strtoul(argv[2], 0, 10); h.blocks = (uint32_t)strtoul(argv[3], 0, 10); h.step_dm = (uint32_t)strtoul(argv[4], 0, 10);
    ok = el_window(&h, (uint32_t)strtoul(argv[5], 0, 10), &off, &bytes, &col0);
    printf("{\"ok\":%d,\"off\":%u,\"bytes\":%u,\"col0\":%u}\n", ok, off, bytes, col0);
    return 0;
  }
  if (argc == 4 && !strcmp(argv[1], "draw")) {
    static uint8_t file[1 << 20];
    rs_canvas cv = { canvas_buf, 240, 256 };
    FILE *f = fopen(argv[2], "rb");
    size_t n;
    uint32_t white = 0, x, y;
    if (!f) return 3;
    n = fread(file, 1, sizeof file, f); fclose(f);
    ok = n >= EL_HEAD && el_head_parse(&h, file) && el_window(&h, (uint32_t)strtoul(argv[3], 0, 10), &off, &bytes, &col0) && off + bytes <= n;
    if (ok) elev_draw(&cv, &h, file + off, bytes / EL_BLOCK, col0);
    printf("{\"ok\":%d,\"col0\":%u,\"nblk\":%u,\"top\":[", ok, col0, bytes / EL_BLOCK);
    for (i = 0; i < EL_COLS; i++) {
      int top = -1;
      x = EL_X + 4u + i;
      for (y = EL_Y; y < EL_Y + EL_H; y++) if (canvas_buf[y * 240u + x] == RS_RGB(0x202326u)) { top = (int)y; break; }
      printf("%s%d", i ? "," : "", top);
    }
    printf("],\"grey\":[");
    for (i = 0; i < EL_COLS; i++) {
      uint32_t g = 0;
      x = EL_X + 4u + i;
      for (y = EL_Y; y < EL_Y + EL_H; y++) g += canvas_buf[y * 240u + x] == RS_RGB(0x9a9ea3u);
      printf("%s%u", i ? "," : "", g);
    }
    for (y = 0; y < 256u; y++) for (x = 0; x < 240u; x++) white += canvas_buf[y * 240u + x] == 0xffffu;
    printf("],\"white\":%u}\n", white);
    return 0;
  }
  return 2;
}
