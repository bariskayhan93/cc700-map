/* View module (cc27): an affine map from way-back units (1/16 m, x east, y north) to the screen, fitted to 4 anchor
 * points that the stock projection gave. Pure integer math: no stock address, no float, no static data. */
#pragma once
#include <stdint.h>
#include "types.h"

#define VW_REF 16384                 /* anchor distance in units: 1,024 m */
#define VW_SHIFT 14
typedef struct { int32_t ux, uy, sx, sy, ex, ey, nx, ny; } vw_t;   /* origin (units, screen); screen offset of +VW_REF east, north */

/* s: screen points of (ux, uy), (ux + REF, uy), (ux, uy + REF), (ux + REF, uy + REF). 1 = ok. 0 when the fourth point
 * is more than 3 px off the affine prediction on an axis, an offset is above 4000 px, or the axes are parallel. */
int vw_fit(vw_t *v, int32_t ux, int32_t uy, const pt_t s[4]);
/* Screen point of (ux, uy), rounded; the offset from the origin is clamped to ±131,072 units, the result to ±4000. */
pt_t vw_map(const vw_t *v, int32_t ux, int32_t uy);
