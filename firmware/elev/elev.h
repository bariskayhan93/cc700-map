/* Elevation strip (cc27, design 8.7): the next 1 km of the route profile from the elevation section (type 3 of the
 * route file, js/elevation_section.js has the layout). Integer code, no stock address, no static data. */
#pragma once
#include <stdint.h>
#include "raster.h"

#define EL_COLS 224u                 /* columns of one block: 1,000 m */
#define EL_BLOCK 450u                /* i16 base m, 224 x {u8 min, u8 max} */
#define EL_HEAD 12u
#define EL_X 4                       /* the strip on the canvas */
#define EL_Y 68
#define EL_W 232
#define EL_H 32
#define EL_RANGE_MIN_DM 400          /* the vertical range is at least 40 m */

typedef struct { uint32_t len_cm, blocks, step_dm; } el_head;

/* 1 = "CCEL", version 1, step 5, 10 or 20 dm, at least one block; 0 otherwise. */
int el_head_parse(el_head *h, const uint8_t b[EL_HEAD]);
/* The bytes of block k0 = col / 224 and k0 + 1 (if present) for the column col of progress_m, from the section start:
 * off, bytes (450 or 900), col0 = col - 224 k0. 0 when progress is at or past the route end. */
int el_window(const el_head *h, uint32_t progress_m, uint32_t *off, uint32_t *bytes, uint32_t *col0);
/* A white rectangle; for each column i < 224 at x = EL_X + 4 + i, from its maximum down to the strip bottom a grey span
 * with the maximum pixel dark. Vertical range max(40 m, the range of the 224 columns). A column of 255 stays white. */
void elev_draw(const rs_canvas *cv, const el_head *h, const uint8_t *blk, uint32_t nblk, uint32_t col0);
