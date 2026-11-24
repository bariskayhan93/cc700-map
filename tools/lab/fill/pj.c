#include "proj.h"
#include "types.h"
static inline int16_t rnd(float v) { return (int16_t)(v < 0 ? v - .5f : v + .5f); }
void project_all(const proj_t *p, const int32_t *ll, uint32_t n, pt_t *q) { for (uint32_t i = 0; i < n; i++) { float x, y; proj_xy(p, ll[2 * i], ll[2 * i + 1], &x, &y); q[i].x = rnd(x); q[i].y = rnd(y); } }
