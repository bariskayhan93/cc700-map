/* View module (cc27 Task 4). See view.h. */
#include "view.h"

#define VW_TOL 3
#define VW_MAXOFF 4000
#define VW_MAXU 131072

static int32_t vw_abs(int32_t v) { return v < 0 ? -v : v; }
static int32_t vw_clamp(int32_t v, int32_t m) { return v < -m ? -m : v > m ? m : v; }

int vw_fit(vw_t *v, int32_t ux, int32_t uy, const pt_t s[4]) {
  int32_t ex = s[1].x - s[0].x, ey = s[1].y - s[0].y, nx = s[2].x - s[0].x, ny = s[2].y - s[0].y;
  if (vw_abs(s[3].x - (s[1].x + s[2].x - s[0].x)) > VW_TOL || vw_abs(s[3].y - (s[1].y + s[2].y - s[0].y)) > VW_TOL) return 0;
  if (vw_abs(ex) > VW_MAXOFF || vw_abs(ey) > VW_MAXOFF || vw_abs(nx) > VW_MAXOFF || vw_abs(ny) > VW_MAXOFF) return 0;
  if (ex * ny - ey * nx == 0) return 0;
  v->ux = ux; v->uy = uy; v->sx = s[0].x; v->sy = s[0].y; v->ex = ex; v->ey = ey; v->nx = nx; v->ny = ny;
  return 1;
}

pt_t vw_map(const vw_t *v, int32_t ux, int32_t uy) {
  int32_t du = vw_clamp(ux - v->ux, VW_MAXU), dv = vw_clamp(uy - v->uy, VW_MAXU);
  pt_t p;
  p.x = (int16_t)vw_clamp(v->sx + ((du * v->ex + dv * v->nx + (1 << (VW_SHIFT - 1))) >> VW_SHIFT), VW_MAXOFF);
  p.y = (int16_t)vw_clamp(v->sy + ((du * v->ey + dv * v->ny + (1 << (VW_SHIFT - 1))) >> VW_SHIFT), VW_MAXOFF);
  return p;
}
