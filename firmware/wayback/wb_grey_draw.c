/* Grey draw (cc27). See wb_grey_draw.h. */
#include "wb_grey_draw.h"

#define GD_W 4

typedef struct { const rs_canvas *cv; const vw_t *v; gd_stat *st; uint32_t pix_cap, pt_cap, stop; } gd_ctx;

static int gd_line(void *vc, const int32_t *xy, uint32_t n) {
  gd_ctx *c = (gd_ctx *)vc;
  pt_t p[GL_POINTS];
  uint32_t k, w;
  for (k = 0u; k < n; k++) p[k] = vw_map(c->v, xy[2u * k], xy[2u * k + 1u]);
  w = rs_work(p, n, GD_W);
  if (c->st->work + w > c->pix_cap || c->st->points + n > c->pt_cap) { c->stop = 1u; return 0; }
  rs_line(c->cv, p, n, GD_W, RS_RGB(0x9a9ea3u), 255u, 1);
  c->st->work += w; c->st->points += n; c->st->lines++;
  return 1;
}

int grey_draw(gl_layer *l, const rs_canvas *cv, const vw_t *v, uint32_t x, uint32_t y, uint32_t course, gd_stat *st) {
  uint32_t cells[GL_CELLS], n = gl_cells(x, y, course, cells);
  gd_ctx c;
  c.cv = cv; c.v = v; c.st = st; c.pix_cap = l->pix_cap; c.pt_cap = l->pt_cap; c.stop = 0u;
  st->lines = 0u; st->points = 0u; st->work = 0u;
  return gl_lines(l, cells, n, gd_line, &c) && !c.stop;
}
