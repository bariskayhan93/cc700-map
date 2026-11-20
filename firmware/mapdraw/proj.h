/* cc28b own projection (block flag F_PROJ). The stock projection (fw_proj, fw.h has the decoded chain) makes for each
 * point a 60 B heap block, a double Web Mercator (atanh(sin lat)) and a double sin and cos of the map angle.
 * Here: stock probes give the screen points of a few references; every other point is
 *   dX = s * dlon,  dY = -s * sec(lat0) * (dlat + q * dlat^2),  s = 2^(z - 24) px per map unit (2^31 units = 180 deg),
 *   q = tan(lat0) / 2 * pi / 2^31, then turned as the stock code: x = c dX - n dY, y = n dX + c dY (n, c: sin, cos of
 * the stock map angle). Against the stock points: its own truncation noise, at most 2 px, mean offset under 0.35 px. */
#pragma once
#include <stdint.h>
typedef struct { float ax, bx, ay, by, q, x0, y0; int32_t lat0, lon0; } proj_t;
/* z: stock zoom (1..22); head: FW_MAP_HEAD in degrees; rot: the stock turn flag; 0 = no projection (z out of range). */
int proj_setup(proj_t *p, int z, float head, int rot, int32_t lat0, int32_t lon0, float x0, float y0);
/* x0, y0 from k stock probes (lat, lon pairs in ll, screen points sx, sy): the mean of probe - offset, so the truncation
 * of one stock point does not move the whole map. */
float proj_recip(float v);
void proj_fit(proj_t *p, int k, const int32_t *ll, const int16_t *sx, const int16_t *sy);
static inline void proj_xy(const proj_t *p, int32_t lat, int32_t lon, float *x, float *y) {
  float dl = (float)(lat - p->lat0), dn = (float)(lon - p->lon0);
  dl += p->q * dl * dl;
  *x = p->x0 + p->ax * dn + p->bx * dl;
  *y = p->y0 + p->ay * dn + p->by * dl;
}
