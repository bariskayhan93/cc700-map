/* Grey draw (cc27): the lines of the screen cells (gl_lines) through the view (vw_map) into the canvas (rs_line).
 * No stock call, no projection call, no heap. */
#pragma once
#include <stdint.h>
#include "wb_grey.h"
#include "raster.h"
#include "view.h"

typedef struct { uint32_t lines, points, work; } gd_stat;   /* drawn lines, their points and their rs_work */

/* Draws the lines of the cells under the screen of a rider at (x, y) units with course (degrees): colour 0x9a9ea3,
 * width 4, round. Before each line it stops when work + rs_work(line) > pix_cap or points + n > pt_cap (the header caps),
 * so a stop is always at a line boundary. 1 = all lines drawn; 0 = a cap stop or a read error. */
int grey_draw(gl_layer *l, const rs_canvas *cv, const vw_t *v, uint32_t x, uint32_t y, uint32_t course, gd_stat *st);
