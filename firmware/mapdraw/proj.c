#include "proj.h"
/* 1 / v without a division (libgcc __divsf3 costs about 1 KB of area 2): bit estimate, 3 Newton steps (rel. error < 1e-7) */
float proj_recip(float v) {
  union { float f; uint32_t u; } w; float r;
  w.f = v; w.u = 0x7EF311C7u - w.u; r = w.f;
  r = r * (2.0f - v * r); r = r * (2.0f - v * r); r = r * (2.0f - v * r);
  return r;
}
/* sin for any angle in radians: reduced to [-pi/2, pi/2], Taylor to x^9 (error under 4e-6). No libm, no table. */
static float fsin(float x) {
  const float PI = 3.14159265f, TP = 6.28318531f;
  x -= TP * (float)(int)(x * (1.0f / TP));
  if (x > PI) x -= TP;
  if (x < -PI) x += TP;
  if (x > PI / 2) x = PI - x;
  else if (x < -PI / 2) x = -PI - x;
  float x2 = x * x;
  return x * (1.0f + x2 * (-1.0f / 6 + x2 * (1.0f / 120 + x2 * (-1.0f / 5040 + x2 * (1.0f / 362880)))));
}
int proj_setup(proj_t *p, int z, float head, int rot, int32_t lat0, int32_t lon0, float x0, float y0) {
  const float PI = 3.14159265f, U = PI / 2147483648.0f;            /* radians per map unit */
  if (z < 1 || z > 22) return 0;
  float s = (float)(1u << z) / 16777216.0f;                       /* 2^(z - 24) */
  float f = (float)lat0 * U, sl = fsin(f), cl = fsin(f + PI / 2), sec = proj_recip(cl);
  float n = 0, c = 1;
  if (rot) {                                                       /* the stock map angle (fw.h, FW_PROJ_ROT) */
    float th = (head >= 90.0f && head < 360.0f) ? head - 90.0f : head + 270.0f;
    n = fsin(th * (PI / 180.0f)); c = fsin(th * (PI / 180.0f) + PI / 2);
  }
  float ey = -s * sec;                                             /* dY per unit of (dlat + q dlat^2) */
  p->ax = c * s;  p->bx = -n * ey;
  p->ay = n * s;  p->by = c * ey;
  p->q = 0.5f * sl * sec * U;
  p->x0 = x0; p->y0 = y0; p->lat0 = lat0; p->lon0 = lon0;
  return 1;
}
void proj_fit(proj_t *p, int k, const int32_t *ll, const int16_t *sx, const int16_t *sy) {
  float mx = 0, my = 0, x, y;
  p->x0 = 0; p->y0 = 0;
  for (int i = 0; i < k; i++) { proj_xy(p, ll[2 * i], ll[2 * i + 1], &x, &y); mx += sx[i] - x; my += sy[i] - y; }
  float r = proj_recip((float)k);
  p->x0 = mx * r; p->y0 = my * r;
}
