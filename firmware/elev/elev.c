/* Elevation strip (cc27). See elev.h. */
#include "elev.h"

static uint32_t el_u32(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

int el_head_parse(el_head *h, const uint8_t b[EL_HEAD]) {
  uint32_t s = b[10];
  if (el_u32(b) != 0x4C454343u || b[11] != 1u || (s != 5u && s != 10u && s != 20u)) return 0;   /* "CCEL" */
  h->len_cm = el_u32(b + 4); h->blocks = (uint32_t)b[8] | ((uint32_t)b[9] << 8); h->step_dm = s;
  return h->blocks > 0u && h->len_cm > 0u;
}

int el_window(const el_head *h, uint32_t progress_m, uint32_t *off, uint32_t *bytes, uint32_t *col0) {
  uint32_t col, k0;
  if (progress_m >= h->len_cm / 100u || progress_m > 4000000u) return 0;
  col = progress_m * EL_COLS / 1000u;
  k0 = col / EL_COLS;
  if (k0 >= h->blocks) return 0;
  *off = EL_HEAD + k0 * EL_BLOCK;
  *bytes = k0 + 1u < h->blocks ? 2u * EL_BLOCK : EL_BLOCK;
  *col0 = col - k0 * EL_COLS;
  return 1;
}

/* The column i of the window: 1 with its minimum and maximum in dm, 0 when it has no value. */
static int el_col(const el_head *h, const uint8_t *blk, uint32_t nblk, uint32_t c, int32_t *lo, int32_t *hi) {
  const uint8_t *b = blk + (c / EL_COLS) * EL_BLOCK;
  int32_t base;
  uint32_t i = c % EL_COLS;
  if (c / EL_COLS >= nblk || b[2u + 2u * i] == 255u || b[3u + 2u * i] == 255u) return 0;
  base = (int32_t)(int16_t)((uint16_t)b[0] | ((uint16_t)b[1] << 8)) * 10;
  *lo = base + (int32_t)(b[2u + 2u * i] * h->step_dm);
  *hi = base + (int32_t)(b[3u + 2u * i] * h->step_dm);
  return 1;
}

void elev_draw(const rs_canvas *cv, const el_head *h, const uint8_t *blk, uint32_t nblk, uint32_t col0) {
  int32_t lo = 0x7fffffff, hi = -0x7fffffff, a, b, range;
  uint32_t i;
  rs_rect(cv, EL_X, EL_Y, EL_X + EL_W, EL_Y + EL_H, 0xffffu);
  for (i = 0u; i < EL_COLS; i++) if (el_col(h, blk, nblk, col0 + i, &a, &b)) { if (a < lo) lo = a; if (b > hi) hi = b; }
  if (lo > hi) return;
  range = hi - lo < EL_RANGE_MIN_DM ? EL_RANGE_MIN_DM : hi - lo;
  for (i = 0u; i < EL_COLS; i++) {
    int x = EL_X + 4 + (int)i, top;
    if (!el_col(h, blk, nblk, col0 + i, &a, &b)) continue;
    top = EL_Y + EL_H - 1 - (int)((b - lo) * (EL_H - 1) / range);
    rs_rect(cv, x, top + 1, x + 1, EL_Y + EL_H, RS_RGB(0x9a9ea3u));
    rs_rect(cv, x, top, x + 1, top + 1, RS_RGB(0x202326u));
  }
}
