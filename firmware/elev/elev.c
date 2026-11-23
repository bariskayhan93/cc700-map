/* Elevation lens chart (core). See elev.h. */
#include "elev.h"

static uint32_t el_u32(const uint8_t *p) { return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }
static int32_t el_i16(const uint8_t *p) { return (int16_t)(uint16_t)((uint32_t)p[0] | ((uint32_t)p[1] << 8)); }
static int32_t el_floor_div(int32_t a, int32_t b) { return a >= 0 ? a / b : -((-a + b - 1) / b); }

int el_head_parse(el_head *h, const uint8_t *b) {
  uint32_t s = b[10], c = b[14];
  if (el_u32(b) != 0x4C454343u || b[11] != 2u || s - 5u > 15u || c - 5u > 195u || s % 5u || c % 5u) return 0;   /* "CCEL" */
  h->len_cm = el_u32(b + 4); h->blocks = (uint32_t)b[8] | ((uint32_t)b[9] << 8); h->step_dm = s;
  h->cbase_m = el_i16(b + 12); h->cstep_dm = c;
  return h->blocks > 0u && h->len_cm >= 100u;
}

int el_lens_x0(uint32_t L, uint32_t P) {
  uint32_t x;
  if (!L) return 0;
  if (P > L) P = L;
  if (L <= EL_LENS_M) return (int)(240u * P / L);
  x = 144u * P / (L - EL_LENS_M);
  return (int)(x > 144u ? 144u : x);
}

int el_lens_x1(uint32_t L, uint32_t P) {
  uint32_t left;
  if (L <= EL_LENS_M) return 240;
  if (P > L) P = L;
  left = L - P;
  return el_lens_x0(L, P) + (int)((uint32_t)EL_LENS_PX * (left < EL_LENS_M ? left : EL_LENS_M) / EL_LENS_M);
}

/* Distance at the left edge of column x (x in 0..240). */
static uint32_t el_edge(uint32_t L, uint32_t P, int lx0, int lx1, int x) {
  uint32_t d, rest;
  if (x <= lx0) return lx0 ? (uint32_t)x * P / (uint32_t)lx0 : 0u;
  if (L <= EL_LENS_M) return P + (uint32_t)(x - lx0) * (L - P) / (uint32_t)(240 - lx0);
  if (x <= lx1) { d = P + (uint32_t)(x - lx0) * EL_LENS_M / (uint32_t)EL_LENS_PX; return d < L ? d : L; }
  if (L - P <= EL_LENS_M || lx1 >= 240) return L;
  rest = L - P - EL_LENS_M;
  return P + EL_LENS_M + (uint32_t)(x - lx1) * rest / (uint32_t)(240 - lx1);
}

int el_col_range(uint32_t L, uint32_t P, int x, uint32_t *d0, uint32_t *d1) {
  int lx0, lx1;
  if (P > L) P = L;
  lx0 = el_lens_x0(L, P); lx1 = el_lens_x1(L, P);
  *d0 = el_edge(L, P, lx0, lx1, x); *d1 = el_edge(L, P, lx0, lx1, x + 1);
  if (!L || *d0 >= L || *d1 <= *d0) return EL_NONE;
  return x < lx0 ? EL_PAST : x < lx1 ? EL_LENS : EL_CTX;
}

/* Min and max over the cells [a, z) of a table: cell i at p + 2 i, base dm and step dm. n = cells in the table. */
static int el_cells(const uint8_t *p, uint32_t a, uint32_t z, uint32_t n, int32_t base, uint32_t step, int32_t *lo, int32_t *hi) {
  int got = 0;
  int32_t l, h;
  for (; a < z && a < n; a++) {
    if (p[2 * a] == EL_NONE_V) continue;
    l = base + (int32_t)(p[2 * a] * step); h = base + (int32_t)(p[2 * a + 1] * step);
    if (!got || l < *lo) *lo = l;
    if (!got || h > *hi) *hi = h;
    got = 1;
  }
  return got;
}

/* One block at a time: the fine columns [a, z) (global) that lie in the read blocks. */
static int el_fine_span(const el_view *v, uint32_t a, uint32_t z, int32_t *lo, int32_t *hi) {
  uint32_t k, b0, e;
  int got = 0;
  int32_t l, h;
  for (k = a / EL_COLS; k * EL_COLS < z; k++) {
    if (k < v->k0 || k >= v->k0 + v->nblk) continue;
    b0 = a > k * EL_COLS ? a - k * EL_COLS : 0u; e = z - k * EL_COLS;
    if (el_cells(v->blk + (k - v->k0) * EL_BLOCK + 2, b0, e, EL_COLS, el_i16(v->blk + (k - v->k0) * EL_BLOCK) * 10, v->h->step_dm, &l, &h)) {
      if (!got || l < *lo) *lo = l;
      if (!got || h > *hi) *hi = h;
      got = 1;
    }
  }
  return got;
}

int el_span(const el_view *v, uint32_t d0, uint32_t d1, int fine, int32_t *lo_dm, int32_t *hi_dm) {
  uint32_t n = fine ? 1000u : v->len_m, c = fine ? EL_COLS : EL_COARSE, a, z;
  if (d1 <= d0 || !n) return 0;
  a = d0 * c / n; z = (d1 * c + n - 1u) / n;
  if (z <= a) z = a + 1u;
  if (fine) return el_fine_span(v, a, z, lo_dm, hi_dm);
  return el_cells(v->coarse, a, z, EL_COARSE, v->h->cbase_m * 10, v->h->cstep_dm, lo_dm, hi_dm);
}

static int el_mid(const el_view *v, uint32_t d, int32_t *m) {
  int32_t lo, hi;
  uint32_t g = d * EL_COLS / 1000u;
  if (d >= v->len_m || !el_fine_span(v, g, g + 1u, &lo, &hi)) return 0;
  *m = (lo + hi) / 2;
  return 1;
}

int32_t el_grade(const el_view *v, uint32_t d) {
  int32_t a, b;
  return el_mid(v, d, &a) && el_mid(v, d + 100u, &b) ? b - a : 0;
}

uint32_t el_climb(const el_view *v) {
  uint32_t d, sum = 0;
  int32_t r;
  for (d = v->prog_m; d < v->prog_m + EL_LENS_M && d + 100u <= v->len_m; d += 100u)
    if ((r = el_grade(v, d)) > 0) sum += (uint32_t)r;
  return (sum + 5u) / 10u;
}

void el_lens_scale(const el_view *v, int32_t *lo_dm, int32_t *rng_dm) {
  uint32_t end = v->prog_m + EL_LENS_M < v->len_m ? v->prog_m + EL_LENS_M : v->len_m;
  int32_t lo, hi, r;
  *lo_dm = 0; *rng_dm = 0;
  if (!el_span(v, v->prog_m, end, 1, &lo, &hi)) return;
  lo = el_floor_div(lo, 50) * 50;
  r = hi - lo < 200 ? 200 : hi - lo;
  *lo_dm = lo; *rng_dm = (r + 99) / 100 * 100;
}

void el_route_scale(const el_view *v, int32_t *lo_dm, int32_t *rng_dm) {
  int32_t lo, hi;
  *lo_dm = 0; *rng_dm = 0;
  if (!el_span(v, 0, v->len_m, 0, &lo, &hi)) return;
  if (hi - lo < 400) { lo = (lo + hi) / 2 - 200; hi = lo + 400; }
  *lo_dm = lo; *rng_dm = hi - lo;
}

/* Decimal digits of u into s (no terminator); returns the count. */
static int el_digits(char *s, uint32_t u) {
  char t[10];
  int n = 0, i;
  do { t[n++] = (char)('0' + u % 10u); u /= 10u; } while (u && n < 10);
  for (i = 0; i < n; i++) s[i] = t[n - 1 - i];
  return n;
}

int el_fmt_dist(char num[8], char unit[3], uint32_t rem) {
  uint32_t t = rem / 10u + (rem % 10u >= 5u);                             /* tens of m */
  int n;
  unit[0] = 'm'; unit[1] = 0; unit[2] = 0;
  if (t < 100u) { n = el_digits(num, t * 10u); num[n] = 0; return n; }
  unit[0] = 'k'; unit[1] = 'm';
  t = rem / 100u + (rem % 100u >= 50u);                                   /* tenths of km */
  if (t < 1000u) { n = el_digits(num, t / 10u); num[n++] = '.'; num[n++] = (char)('0' + t % 10u); }
  else n = el_digits(num, rem / 1000u + (rem % 1000u >= 500u));
  num[n] = 0;
  return n;
}

int el_fmt_climb(char out[8], uint32_t c) {
  int n;
  if (c < 5u) { out[0] = 0; return 0; }
  if (c > 9999u) c = 9999u;
  out[0] = '+'; n = 1 + el_digits(out + 1, c);
  out[n++] = ' '; out[n++] = 'm'; out[n] = 0;
  return n;
}

uint32_t el_blocks_for(const el_head *h, uint32_t P, uint32_t *k0) {
  uint32_t a = P / 1000u, z = (P + EL_LENS_M + 100u) / 1000u;
  if (a >= h->blocks) return 0;
  if (z >= h->blocks) z = h->blocks - 1u;
  *k0 = a;
  return z - a + 1u;
}

#define EL_Y0 237
#define EL_Y1 255

uint16_t el_mix(uint16_t d, uint16_t s, uint32_t a) {
  uint32_t b = 256u - a;
  return (uint16_t)((((d >> 11) * b + (s >> 11) * a) >> 8) << 11 | (((((uint32_t)d >> 5) & 63u) * b + (((uint32_t)s >> 5) & 63u) * a) >> 8) << 5 |
                    (((d & 31u) * b + (s & 31u) * a) >> 8));
}

static void el_px(const rs_canvas *cv, int x, int y, uint16_t c) { if (x >= 0 && x < 240 && y >= EL_Y0 && y <= EL_Y1) cv->buf[y * cv->w + x] = c; }

/* Variant 1 (owner choice, 23 Nov): scrim 72 % white over the whole bar. */
static void el_whiten(const rs_canvas *cv) {
  int x, y;
  for (y = EL_Y0; y <= EL_Y1; y++) for (x = 0; x < 240; x++) cv->buf[y * cv->w + x] = el_mix(cv->buf[y * cv->w + x], 0xffffu, 184u);
}

/* The rider mark: a 2 px blue line (x - 1, x) with a 1 px white edge over the bar, and a blue triangle (rows 9, 7, 5,
 * 3, 1 px) with a 1 px white edge at y 237..241. */
static void el_rider(const rs_canvas *cv, int x) {
  int y, i;
  if (x > 239) x = 239;
  if (x < 1) x = 1;
  for (y = EL_Y0; y <= EL_Y1; y++) for (i = -2; i <= 1; i++) el_px(cv, x + i, y, 0xffffu);
  for (y = 0; y < 5; y++) for (i = -(5 - y); i <= 5 - y; i++) el_px(cv, x + i, EL_Y0 + y, 0xffffu);
  for (y = 0; y < 5; y++) for (i = -(4 - y); i <= 4 - y; i++) el_px(cv, x + i, EL_Y0 + y, RS_RGB(0x1f6fe0u));
  for (y = EL_Y0; y <= EL_Y1; y++) { el_px(cv, x - 1, y, RS_RGB(0x1f6fe0u)); el_px(cv, x, y, RS_RGB(0x1f6fe0u)); }
}

/* Grade colour of a lens column from its highest and lowest rise in dm per 100 m. Climbs first. */
static uint16_t el_gcol(int32_t gx, int32_t gn) {
  if (gx >= 90) return RS_RGB(0xb5122eu);
  if (gx >= 60) return RS_RGB(0xe8541eu);
  if (gx >= 30) return RS_RGB(0xf2a900u);
  if (gn <= -60) return RS_RGB(0x1460b8u);
  if (gn <= -30) return RS_RGB(0x4aa3e8u);
  return RS_RGB(0x3b4049u);
}

static int el_y(int32_t e, int32_t lo, int32_t rng) {
  int32_t y = EL_Y1 - (e - lo) * 17 / rng;
  return y < 238 ? 238 : y > EL_Y1 ? EL_Y1 : (int)y;
}

void el_draw(const rs_canvas *cv, const el_view *v) {
  uint32_t L = v->len_m, P = v->prog_m < v->len_m ? v->prog_m : v->len_m, d0, d1, d;
  int lx0 = el_lens_x0(L, P), lx1 = el_lens_x1(L, P), x, y, z, yt, yb, k;
  int32_t llo, lrng, rlo, rrng, lo, hi, g, gx, gn, s0, sr;
  uint16_t c;
  uint32_t a;
  if (!cv->buf || cv->w < 240 || cv->h < 256) return;
  el_whiten(cv);
  el_lens_scale(v, &llo, &lrng); el_route_scale(v, &rlo, &rrng);
  for (x = 0; x < 240; x++) {
    z = el_col_range(L, P, x, &d0, &d1);
    if (z == EL_NONE || !el_span(v, d0, d1, z == EL_LENS, &lo, &hi)) continue;
    if (z == EL_LENS && lrng) { s0 = llo; sr = lrng; } else { s0 = rlo; sr = rrng; }
    if (!sr) continue;
    if (z == EL_PAST) { c = RS_RGB(0xc9ccd1u); a = 230u; }
    else if (z == EL_CTX) { c = RS_RGB(0x8c9198u); a = 154u; }
    else {
      for (gx = 0, gn = 0, d = d0; d < d1; d += 25u) { g = el_grade(v, d); if (g > gx) gx = g; if (g < gn) gn = g; }
      c = el_gcol(gx, gn); a = 154u;
    }
    yt = el_y(hi, s0, sr); yb = el_y(lo, s0, sr);
    if (yt > yb - 1) yt = yb - 1 < 238 ? 238 : yb - 1;                  /* the top span is at least 2 px */
    for (y = yb + 1; y <= EL_Y1; y++) cv->buf[y * cv->w + x] = el_mix(cv->buf[y * cv->w + x], c, a);
    for (y = yt; y <= yb; y++) cv->buf[y * cv->w + x] = c;
  }
  for (x = 0; x < 240; x++)                                           /* the bar top: dark over the lens, 55 % outside */
    el_px(cv, x, EL_Y0, x >= lx0 && x < lx1 ? RS_RGB(0x202327u) : el_mix(cv->buf[EL_Y0 * cv->w + x], RS_RGB(0x202327u), 141u));
  if (L > EL_LENS_M && lx1 < 240) {
    if (L - P <= EL_LENS_M) for (y = EL_Y0; y <= EL_Y1; y++) el_px(cv, lx1, y, RS_RGB(0x202327u));   /* the route end */
    else for (y = 238; y <= EL_Y1; y += 2) el_px(cv, lx1, y, RS_RGB(0x6d7279u));
  }
  for (k = 1; k <= 2; k++) {                                          /* 1 km and 2 km ahead of the route start or the rider */
    x = L <= EL_LENS_M ? (int)(240u * 1000u * (uint32_t)k / L) : lx0 + 32 * k;
    if (x < lx1) for (y = 238; y <= 240; y++) el_px(cv, x, y, RS_RGB(0x202327u));
  }
  el_rider(cv, lx0);
}

void el_plain(const rs_canvas *cv, uint32_t L, uint32_t P) {
  int px, x, y;
  if (!cv->buf || cv->w < 240 || cv->h < 256) return;
  if (P > L) P = L;
  px = L ? (int)(240u * P / L) : 0;
  el_whiten(cv);
  for (x = 0; x < 240; x++) for (y = 245; y <= 247; y++) el_px(cv, x, y, x < px ? RS_RGB(0x202327u) : RS_RGB(0xb7bac0u));
  el_rider(cv, px);
}
