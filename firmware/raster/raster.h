/* Raster module (cc27): pixels into an RGB565 canvas. No stock address, no float, no static data: the host tests run
 * the same C. Colour values are lv_color_hex values (R5 << 11 | G6 << 5 | B5, no byte swap). */
#pragma once
#include <stdint.h>
#include "types.h"

typedef struct { uint16_t *buf; int16_t w, h; } rs_canvas;   /* row-major, w * h pixels (FW_CANVAS_BUF on the unit) */

#define RS_RGB(rgb) ((uint16_t)((((rgb) >> 8) & 0xf800u) | (((rgb) >> 5) & 0x07e0u) | (((rgb) >> 3) & 0x001fu)))

/* Even-odd scanline fill of the polygon p[0..n) (the v21 fill, moved). Doubled hole bridges cancel. */
void rs_fill(const rs_canvas *c, const pt_t *p, uint32_t n, uint16_t col);
/* Polyline of width w. w <= 0: nothing. w == 1: one pixel per Bresenham step, both ends drawn. w >= 2: at each step a
 * span of w' = ceil(w * len / major) pixels across the minor axis. round and w >= 3 and opa == 255: a disk of diameter
 * w at each point. opa < 255: each pixel is blended. */
void rs_line(const rs_canvas *c, const pt_t *p, uint32_t n, int w, uint16_t col, uint8_t opa, int round);
/* Disk of diameter d at (x, y): the pixels (x + i, y + j) with 4i^2 + 4j^2 <= d^2. */
void rs_disk(const rs_canvas *c, int x, int y, int d, uint16_t col, uint8_t opa);
/* Rectangle [x0, x1) x [y0, y1). */
void rs_rect(const rs_canvas *c, int x0, int y0, int x1, int y1, uint16_t col);
/* Pixel work of rs_line, not clipped: sum over the segments of (major + 1) * w', plus n * w * w when w >= 3. */
uint32_t rs_work(const pt_t *p, uint32_t n, int w);
