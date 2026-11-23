// Shared types of the patch modules. No stock address here (only fw.h has them).
#pragma once
#include <stdint.h>
typedef struct { int16_t x, y; } pt_t;                       // lv_point_t
typedef struct {                                             // lv_draw_line_dsc_t (LVGL 8, 16-bit colour)
  uint16_t color; int16_t width, dash_width, dash_gap; uint8_t opa; uint8_t flags;   // flags: bit 2 round start, bit 3 round end
} line_dsc_t;
typedef struct { uint32_t n, style; int32_t lat, lon; uint32_t cnt; int32_t *pts; } ent_t;   // decoded map entry (24 B)
typedef void (*proj_cb_t)(const float *latlon, uint32_t n);  // the stock projection callback: projects n points, then calls cc_line

// Block switches (cc27): the page adds a flags entry as the last entry of each map block: style 15 (class 15, not
// drawn), no points, lat = BLK_FLAGS_MAGIC (above 2^30: never a latitude), lon = the flags. No entry: flags 0 = cc26.
#define BLK_FLAGS_MAGIC 0x7F434346
#define F_OWN   1u                   /* map and way-back lines with the raster module, not LVGL */
#define F_TEXT  2u                   /* test text: map time (cc_iter), adapter time and reads */
#define F_ROUTE 4u                   /* legacy strip flag in old files */
#define F_AA     8u                  /* cc28: with F_OWN, map lines smooth (rs_line_aa) */
#define F_CYC   16u                  /* cc28: cycleway casing; cc28b: ignored (the casing broke the line at entry ends) */
                                     /* 32: F_NODRAW, a cc28 test switch, retired (23 Nov): ignored */
#define F_PROJ  64u                  /* cc28b: own projection (firmware/mapdraw/proj.c); stock probes only */
static __attribute__((unused)) uint32_t blk_flags(const ent_t *E, uint32_t cnt) {
  const ent_t *e;
  if (!E || !cnt) return 0;
  e = &E[cnt - 1];
  return e->style == 15u && e->cnt == 0u && e->lat == BLK_FLAGS_MAGIC ? (uint32_t)e->lon : 0u;
}
