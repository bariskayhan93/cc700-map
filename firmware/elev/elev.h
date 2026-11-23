/* Elevation lens chart (design docs/superpowers/specs/2026-11-23-elevation-bar-design.md, amendment A1): one chart of
 * the whole route in the bar rows y 237..255 of the map canvas. The next 3 km is a lens of 96 px that starts at the
 * rider; the ridden part and the rest of the route share the other px. Reads the elevation section version 2 (type 3,
 * js/elevation_section.js). Integer code, no stock address, no static data, no state between frames.
 * Distances in m, elevations in dm. */
#pragma once
#include <stdint.h>
#include "raster.h"

#define EL_HEAD 16u                  /* the bytes el_head_parse reads: header and coarse head */
#define EL_HEAD2 1168u               /* the first block: header, coarse head, 576 x {min, max} */
#define EL_COARSE 576u
#define EL_COLS 224u                 /* columns of one block: 1,000 m */
#define EL_BLOCK 450u                /* i16 base m, 224 x {u8 min, u8 max} */
#define EL_LENS_M 3000u
#define EL_LENS_PX 96
#define EL_NONE_V 255u

typedef struct { uint32_t len_cm, blocks, step_dm, cstep_dm; int32_t cbase_m; } el_head;
/* coarse: the 576 x 2 cell bytes (section byte 16). blk: the bytes of blocks k0 .. k0 + nblk - 1. */
typedef struct { const el_head *h; const uint8_t *coarse; const uint8_t *blk; uint32_t k0, nblk, len_m, prog_m; } el_view;
enum { EL_NONE, EL_PAST, EL_CTX, EL_LENS };

/* 1 = "CCEL" version 2, block step 5..20 dm, coarse step 5..200 dm (multiples of 5), blocks > 0, length > 0. */
int el_head_parse(el_head *h, const uint8_t *b);
/* L > 3000: min(144, 144 P / (L - 3000)); L <= 3000: 240 P / L. P is clamped to L. */
int el_lens_x0(uint32_t len_m, uint32_t prog_m);
/* Exclusive end of the lens: lx0 + 96 min(3000, L - P) / 3000; L <= 3000: 240. */
int el_lens_x1(uint32_t len_m, uint32_t prog_m);
/* The distance range [d0, d1) of column x and its zone: x < lx0 ridden, lx0 <= x < lx1 lens, then the rest of the
 * route; EL_NONE past the route end. The ranges join and cover [0, L). */
int el_col_range(uint32_t len_m, uint32_t prog_m, int x, uint32_t *d0, uint32_t *d1);
/* Min and max over [d0, d1): fine = the 4.464 m block columns (only inside the read blocks), else the coarse cells.
 * 0 = no value. */
int el_span(const el_view *v, uint32_t d0, uint32_t d1, int fine, int32_t *lo_dm, int32_t *hi_dm);
/* The rise in dm over [d, d + 100) (mid of min and max); 0 without both values. */
int32_t el_grade(const el_view *v, uint32_t d);
/* The sum of the rises of the 100 m windows in [P, P + 3000), in m (rounded). */
uint32_t el_climb(const el_view *v);
/* The lens scale (design 6.2): bottom = min floored to 50 dm, range = max(200, hi - bottom) up to 100 dm steps.
 * rng 0 = no value in the lens. */
void el_lens_scale(const el_view *v, int32_t *lo_dm, int32_t *rng_dm);
/* The route scale: the coarse min..max, range at least 400 dm (centred). rng 0 = no value. */
void el_route_scale(const el_view *v, int32_t *lo_dm, int32_t *rng_dm);
/* "850" "m", "12.4" "km", "112" "km". Returns strlen(num). */
int el_fmt_dist(char num[8], char unit[3], uint32_t rem_m);
/* "+46 m" (at most "+9999 m"); empty below 5 m. Returns strlen(out). */
int el_fmt_climb(char out[8], uint32_t climb_m);
/* The blocks that hold [P, P + 3100]: their count (at most 5), first block in *k0. 0 when P is past the blocks. */
uint32_t el_blocks_for(const el_head *h, uint32_t prog_m, uint32_t *k0);

/* RGB565 blend: (dst (256 - a) + src a) / 256 per channel, a = 0..256. */
uint16_t el_mix(uint16_t dst, uint16_t src, uint32_t a256);
/* The normal state (design 5, 6.1-6.3): scrim y 237..255, lens background, columns, lens edge, lens end, km ticks,
 * route end, rider mark. Pixels only in the rows y 237..255 of a 240 x 256 canvas. */
void el_draw(const rs_canvas *cv, const el_view *v);
/* The no-elevation state: scrim, 2 px progress line y 246..247 (ridden dark, rest light), rider mark at 240 P / L. */
void el_plain(const rs_canvas *cv, uint32_t len_m, uint32_t prog_m);
