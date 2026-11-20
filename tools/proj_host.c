/* Host check of firmware/mapdraw/proj.c against a model of the stock projection, as decoded from the stock image
 * (fw_proj 0x4204c1bc -> 0x4204a76c, 0x42055b54, 0x42055c1c, 0x42055bb4 -> 0x4204c158, 0x4204a68c, 0x4204c120).
 * Usage: proj_host z head rot lat_deg lon_deg span_px n -> JSON {max, mean, n}. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include "proj.h"
static const double PI = 3.14159265358979323846;
static int32_t Z, S16, S20, D2 = 7, D3 = -11; static float CX = 120, CY = 190, HEAD; static int ROT;
static float rad(float deg) { return (float)((double)deg * PI / 180.0); }
static void world(float lat_deg, float lon_deg, int32_t *X, int32_t *Y) {
  float lr = rad(lon_deg), pr = rad(lat_deg), t = (float)atanh(sin((double)pr)), p2 = (float)(1u << Z);
  *X = (int32_t)((double)(p2 * (lr * 256.0f)) / (2 * PI)) + (128 << Z);
  *Y = (128 << Z) - (int32_t)((double)(p2 * (t * 256.0f)) / (2 * PI));
}
static void exact(int32_t lat_u, int32_t lon_u, double *ex, double *ey) {   /* no truncation, double */
  double lr = lon_u * PI / 2147483648.0, pr = lat_u * PI / 2147483648.0, w = ldexp(256.0, Z) / (2 * PI);
  double x = w * lr, y = -w * atanh(sin(pr));
  if (!ROT) { *ex = x; *ey = y; return; }
  double h = HEAD, th = (h >= 90 && h < 360) ? h - 90 : h + 270, r = th * PI / 180;
  *ex = x * cos(r) - y * sin(r); *ey = y * cos(r) + x * sin(r);
}
static void stock(int32_t lat_u, int32_t lon_u, int *sx, int *sy) {
  const float k = 180.0f / 2147483648.0f; int32_t X, Y;
  world((float)lat_u * k, (float)lon_u * k, &X, &Y);
  int x = X - S16 + D2, y = Y - S20 + D3;
  if (!ROT) { *sx = x; *sy = y; return; }
  float h = HEAD, th = (h >= 90.0f && h < 360.0f) ? h - 90.0f : h + 270.0f, r = rad(th);
  float n = (float)sin((double)r), c = (float)cos((double)r), dx = (float)x - CX, dy = (float)y - CY;
  *sx = (int)(dx * c - dy * n + CX); *sy = (int)(dy * c + dx * n + CY);
}
int main(int argc, char **argv) {
  if (argc < 8) return 2;
  Z = atoi(argv[1]); HEAD = (float)atof(argv[2]); ROT = atoi(argv[3]);
  double lat = atof(argv[4]), lon = atof(argv[5]); int span = atoi(argv[6]), n = atoi(argv[7]);
  int32_t lat0 = (int32_t)(lat / 180.0 * 2147483648.0), lon0 = (int32_t)(lon / 180.0 * 2147483648.0), X0, Y0;
  world((float)lat0 * (180.0f / 2147483648.0f), (float)lon0 * (180.0f / 2147483648.0f), &X0, &Y0);
  S16 = X0 - 120 + D2; S20 = Y0 - 190 + D3;                      /* the reference near the rider point (120, 190) */
  int K = argc > 8 ? atoi(argv[8]) : 9; int32_t ll[18]; int16_t sx9[9], sy9[9];
  proj_t p; if (!proj_setup(&p, Z, HEAD, ROT, lat0, lon0, 0, 0)) { printf("{\"setup\":0}\n"); return 0; }
  if (K > 9) K = 9;
  for (int i = 0; i < K; i++) {                                   /* 9 points within about 100 px of the reference: on screen */
    double u = 1 / ldexp(1.0, Z - 24);                          /* units per px; steps of 37.3 px and 61.7 px: other fractions */
    ll[2 * i] = lat0 + (int32_t)(((i * 23.3) - 90) * u / 1.6); ll[2 * i + 1] = lon0 + (int32_t)(((i * 21.7) - 90) * u);
    int a, b; stock(ll[2 * i], ll[2 * i + 1], &a, &b); sx9[i] = (int16_t)a; sy9[i] = (int16_t)b;
  }
  proj_fit(&p, K, ll, sx9, sy9);
  double s = ldexp(1.0, Z - 24), mx = 0, sum = 0, dmax = 0, bx = 0, by = 0, e0x, e0y; srand(12345); int m = 0; exact(lat0, lon0, &e0x, &e0y);
  for (int i = 0; i < n; i++) {
    int32_t dlat = (int32_t)(((double)rand() / RAND_MAX * 2 - 1) * span / s / 1.6), dlon = (int32_t)(((double)rand() / RAND_MAX * 2 - 1) * span / s);
    int sx, sy; float ox, oy; stock(lat0 + dlat, lon0 + dlon, &sx, &sy); proj_xy(&p, lat0 + dlat, lon0 + dlon, &ox, &oy);
    int on = sx >= 0 && sx < 240 && sy >= 0 && sy < 256;   /* bias and max: on-screen points (trunc goes to 0) */
    double ex, ey; exact(lat0 + dlat, lon0 + dlon, &ex, &ey);
    dmax = fmax(dmax, fmax(fabs((ox - p.x0) - (ex - e0x)), fabs((oy - p.y0) - (ey - e0y))));
    double e = fmax(fabs(floor(ox + 0.5f) - sx), fabs(floor(oy + 0.5f) - sy)); if (!on) continue; if (e > mx) mx = e; sum += hypot(ox - sx, oy - sy); bx += ox - sx; by += oy - sy; m++;
  }
  printf("{\"setup\":1,\"max\":%g,\"mean\":%.3f,\"bias\":%.3f,\"dmax\":%.4f,\"n\":%d}\n", mx, sum / (m ? m : 1), fmax(fabs(bx / (m ? m : 1)), fabs(by / (m ? m : 1))), dmax, m);
  return 0;
}
