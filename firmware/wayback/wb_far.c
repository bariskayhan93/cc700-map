/* Far map reader and draw (23 Nov). See wb_far.h. */
#include "wb_far.h"

#define FM_HEAD 48u
#define FM_PTS_AT (FM_HEAD + 1024u + 576u + 2048u)   /* after the grey buffer parts: 64 screen points (256 B) */

int fm_open(fm_layer *f, wb_reader rd, void *ctx, uint32_t at, uint32_t size, uint8_t *buf) {
  const uint8_t *h = buf; gl_layer *l = &f->l; uint32_t shift;
  if (!buf || size < FM_HEAD || FM_PTS_AT + 4u * FM_RING > GL_BUF || !rd(ctx, at, buf, size < FM_HEAD + 1024u ? size : FM_HEAD + 1024u)) return 0;
  if (wb_u32(h) != 0x4D464343u || h[4] != 12u || h[5] != 3u || h[6] != 1u || h[7] < 4u || h[7] > 6u) return 0;   /* "CCFM" */
  shift = h[7];
  l->rd = rd; l->ctx = ctx; l->at = at; l->size = size; l->buf = buf; l->head = FM_HEAD; l->stride = 1u << shift;
  l->n = wb_u32(h + 8); l->body = wb_u32(h + 12); l->pix_cap = wb_u32(h + 16); l->pt_cap = wb_u32(h + 20); f->fill_cap = wb_u32(h + 24); l->m = wb_u32(h + 28);
  f->g.lat0_e7 = (int32_t)wb_u32(h + 32); f->g.lon0_e7 = (int32_t)wb_u32(h + 36); f->g.lat_u = wb_u32(h + 40); f->g.lon_u = wb_u32(h + 44);
  f->g.lat_e = 0u; f->g.lon_e = 0u;
  if (!l->n || l->n > (256u << shift) || l->m != (l->n + l->stride - 1u) >> shift || !f->g.lat_u || !f->g.lon_u) return 0;
  return l->body <= size && size - l->body == FM_HEAD + 4u * l->m + 8u * (l->n + 1u);
}
int fm_units(const fm_layer *f, int32_t lat_e7, int32_t lon_e7, uint32_t *x, uint32_t *y) { return wb_units(&f->g, lat_e7, lon_e7, x, y); }
/* floor(v * 65536 / u) in 32-bit integer steps (no libgcc __divsf3); u > 0 (fm_open), (v % u) << 16 < 2^32 for u < 65536 */
static int32_t fm_inv(uint32_t v, uint32_t u) { return (int32_t)(((v / u) << 16) + ((v % u) << 16) / u); }
void fm_point(const fm_layer *f, int32_t x, int32_t y, int32_t ll_e7[2]) {
  ll_e7[0] = f->g.lat0_e7 + fm_inv((uint32_t)y, f->g.lat_u);
  ll_e7[1] = f->g.lon0_e7 + fm_inv((uint32_t)x, f->g.lon_u);
}

typedef struct { fm_layer *f; const rs_canvas *cv; const vw_t *v; fm_clock clk; uint32_t t0, limit; fm_stat *st; } fm_ctx;
/* Style of a class: fill colour (areas) or line colour and width; main roads have an edge (pass 0) and a core (pass 1). */
/* No table: area 2 has no data section, so the compiler must not turn the chain into a lookup table. */
#if defined(__GNUC__) && !defined(__clang__)
__attribute__((optimize("no-tree-switch-conversion", "no-jump-tables")))
#endif
static int fm_style(uint32_t cls, uint32_t pass, uint16_t *col, int *w) {
  uint32_t rgb; int wd = 0;
  if (cls == FM_BUILT) rgb = 0xd4d4d4u;                         /* as the detail map: built-up */
  else if (cls == FM_WATER) rgb = 0x82cbd5u;
  else if (cls == FM_FOREST) rgb = 0xa2d683u;
  else if (cls == FM_GREEN) rgb = 0xc8e6b0u;
  else if (cls == FM_PATH) { rgb = 0x66615au; wd = 1; }
  else if (cls == FM_TRACK) { rgb = 0x6b4a2bu; wd = 2; }
  else if (cls == FM_CYCLE) { rgb = 0x7040b0u; wd = 2; }
  else if (cls == FM_MINOR) { rgb = pass ? 0xffffffu : 0x7a7e83u; wd = pass ? 2 : 4; }   /* style D (owner, 24 Nov): edge 4, white core 2 */
  else if (cls == FM_WATERLINE) { rgb = 0x82cbd5u; wd = 2; }
  else if (cls == FM_MAIN) { rgb = 0xf2c94cu; wd = 4; }            /* one thin line: no motorway in the far map */
  else return 0;
  *col = RS_RGB(rgb); *w = wd; return 1;
}
/* The items of one group from *pp; draw = 0 only parses. 0 = ok, 1 = cap stop, -1 = bad data. */
static int fm_items(fm_ctx *c, uint32_t key, const uint8_t **pp, const uint8_t *end, uint32_t cls, uint32_t cnt, uint32_t pass) {
  pt_t *s = (pt_t *)(void *)(c->f->l.buf + FM_PTS_AT);
  int32_t x0 = (int32_t)((key & 0xFFFFu) << 12), y0 = (int32_t)((key >> 16) << 12);
  uint32_t area = cls >= FM_WATER, lo = area ? 3u : 2u, hi = area ? FM_RING : GL_POINTS, m, k, wk; uint16_t col; int w;
  if (!fm_style(cls, pass, &col, &w)) return -1;
  while (cnt--) {
    int32_t qx, qy; const uint8_t *p = *pp;
    if (!gl_var(&p, end, &m) || m < lo || m > hi || end - p < 4) return -1;
    qx = (int32_t)(p[0] | (p[1] << 8)); qy = (int32_t)(p[2] | (p[3] << 8)); p += 4;
    for (k = 0u; k < m; k++) {
      if (k) {
        uint32_t zx, zy;
        if (!gl_var(&p, end, &zx) || !gl_var(&p, end, &zy) || zx > 1024u || zy > 1024u) return -1;
        qx += gl_unzig(zx); qy += gl_unzig(zy);
      }
      if (qx < 0 || qx > 512 || qy < 0 || qy > 512) return -1;
      s[k] = vw_map(c->v, x0 + qx * 8, y0 + qy * 8);
    }
    *pp = p;
    if (!pass) {                                                   /* count an item one time */
      if (c->st->points + m > c->f->l.pt_cap) return 1;
      if (!area) { wk = rs_work(s, m, w) + (cls == FM_MINOR ? rs_work(s, m, 2) : 0u); if (c->st->work + wk > c->f->l.pix_cap) return 1; c->st->work += wk; c->st->lines++; }
      else c->st->areas++;
      c->st->points += m;
    }
    wk = c->clk();                                                 /* 24 Nov: the draw split (fill or line time) */
    if (area) c->st->fill_px += rs_fill(c->cv, s, m, col); else rs_line(c->cv, s, m, w, col, 255u, w >= 3);
    wk = c->clk() - wk; if (area) c->st->fill_us += wk; else c->st->line_us += wk;
  }
  return 0;
}
/* One cell body: groups of class, count, items. 0 = next cell, 1 = stop, -1 = bad. */
static int fm_body(void *vc, uint32_t key, const uint8_t *p, uint32_t len) {
  fm_ctx *c = (fm_ctx *)vc; const uint8_t *end = p + len; uint32_t groups, cls, cnt; int rc;
  if (!gl_var(&p, end, &groups)) { c->st->stop = 3u; return -1; }
  while (groups--) {
    const uint8_t *g;
    if (c->clk() - c->t0 >= c->limit) { c->st->stop = 2u; return 1; }
    if (p == end) { c->st->stop = 3u; return -1; }
    cls = *p++;
    if (!gl_var(&p, end, &cnt)) { c->st->stop = 3u; return -1; }
    g = p;
    rc = fm_items(c, key, &p, end, cls, cnt, 0u);
    if (!rc && cls == FM_MINOR) { p = g; rc = fm_items(c, key, &p, end, cls, cnt, 1u); }   /* streets: edge, then core */
    if (rc) { c->st->stop = rc > 0 ? 1u : 3u; return rc; }
  }
  return p == end ? 0 : (c->st->stop = 3u, -1);
}
int fm_draw(fm_layer *f, const rs_canvas *cv, const vw_t *v, uint32_t x, uint32_t y, uint32_t course,
            fm_clock clk, uint32_t t0, uint32_t limit_us, fm_stat *st) {
  uint32_t cells[GL_CELLS], n = gl_cells(x, y, course, cells); fm_ctx c;
  c.f = f; c.cv = cv; c.v = v; c.clk = clk; c.t0 = t0; c.limit = limit_us; c.st = st;
  st->lines = st->areas = st->points = st->work = st->stop = st->fill_us = st->line_us = st->fill_px = 0u;
  if (clk() - t0 >= limit_us) { st->stop = 2u; return 0; }
  return gl_bodies(&f->l, cells, n, fm_body, &c) && !st->stop;
}
