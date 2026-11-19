/* Grey layer reader (cc27): section type 2 of the route file, layer version 2 (js/wayback_grey_layer.js has the
 * layout). Integer code only, no float, no static memory. One heap buffer of GL_BUF bytes for each frame:
 *   [0, 1052)    header (28 B) and the directory (at most 256 keys), one read in gl_open
 *   [1052, 1628) the cell records of one row (72 x 8 B), one read for each row
 *   [1628, 3676) one cell body (at most 2,048 B), one read for each cell
 *   [3676, 3932) the points of one line (32 x 2 x int32)
 * Reads of one frame: 1 + rows + cells with a body. */
#pragma once
#include <stdint.h>
#include "wayback.h"

#define GL_BUF 4096u
#define GL_CELLS 20u                 /* cells of one screen */
#define GL_POINTS 32u                /* points of one line */

typedef struct { wb_reader rd; void *ctx; uint32_t at, size, n, body, pix_cap, pt_cap, stride, m; uint8_t *buf; } gl_layer;

/* Reads the header and the directory of the layer at [at, at + size) of the reader (one read) into buf (GL_BUF bytes).
 * 1 = a version 2 layer; 0 = a read error or a bad layer. */
int gl_open(gl_layer *l, wb_reader rd, void *ctx, uint32_t at, uint32_t size, uint8_t *buf);

/* The cell keys ((cy << 16) | cx) under the heading-up screen of a rider at (x, y) units: 600 m wide, 520 m ahead and
 * 100 m behind, turned to course_deg (clockwise from north). Nearest cell centre first, at most 20. js/screen_proof.js
 * greyCells gives the same keys. */
uint32_t gl_cells(uint32_t x, uint32_t y, uint32_t course_deg, uint32_t cells[GL_CELLS]);

/* Called for each line: n (2..32) points, x and y in way-back units. Return 0 to stop. */
typedef int (*gl_fn)(void *ctx, const int32_t *xy, uint32_t n);

/* The lines of the cells (gl_cells order: nearest first; lines in body order). First one record read for each row,
 * then one body read for each cell. 1 = all lines given or fn stopped; 0 = a read error or a bad record or body. */
int gl_lines(gl_layer *l, const uint32_t *cells, uint32_t n, gl_fn fn, void *ctx);
