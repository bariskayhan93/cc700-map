/* Far map reader and draw (23 Nov): route-file section type 4 "CCFM" version 1 (js/far_map.js has the layout). The
 * grey table reader (wb_grey.c) with a 48 B header and classed bodies: green and water areas, then lines by class.
 * Integer and float code, no static memory, no heap: the caller gives one GL_BUF buffer. */
#pragma once
#include <stdint.h>
#include "wb_grey.h"
#include "raster.h"
#include "view.h"

enum { FM_MAIN = 0, FM_MINOR = 1, FM_CYCLE = 2, FM_TRACK = 3, FM_PATH = 4, FM_WATERLINE = 5, FM_WATER = 8, FM_FOREST = 9, FM_GREEN = 10, FM_BUILT = 11 };
#define FM_RING 64u                  /* points of one area ring */

typedef struct { gl_layer l; wb_grid g; uint32_t fill_cap; } fm_layer;
typedef struct { uint32_t lines, areas, points, work, stop; } fm_stat;   /* stop: 0 none, 1 cap, 2 time, 3 bad data */
typedef uint32_t (*fm_clock)(void);                                       /* microseconds */

/* Header and directory of the section at [at, at + size) (one read). 1 = a version 1 far map. */
int fm_open(fm_layer *f, wb_reader rd, void *ctx, uint32_t at, uint32_t size, uint8_t *buf);
/* Rider units of (lat, lon) E7 in the frame of the section. 0 = outside. */
int fm_units(const fm_layer *f, int32_t lat_e7, int32_t lon_e7, uint32_t *x, uint32_t *y);
/* (lat, lon) E7 of the unit point (x, y). */
void fm_point(const fm_layer *f, int32_t x, int32_t y, int32_t ll_e7[2]);
/* Draws the items of the cells under the screen (gl_cells) through the view: areas filled, lines by class. Stops at an
 * item boundary when the header caps are reached, and between groups when clk() - t0 >= limit_us. 1 = all drawn. */
int fm_draw(fm_layer *f, const rs_canvas *cv, const vw_t *v, uint32_t x, uint32_t y, uint32_t course,
            fm_clock clk, uint32_t t0, uint32_t limit_us, fm_stat *st);
