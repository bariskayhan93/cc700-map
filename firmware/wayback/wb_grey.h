/* Grey layer reader (cc26, D3c). The grey streets of the mounted file come from the CCGL section (E15), one body per
 * 256 m cell. The reader needs the engine only through wb_read_at, wb_grid_get and wb_grey_section (wayback.h). */
#pragma once
#include <stdint.h>
#include "wayback.h"

/* Called for each line, nearest cell first. pts: lat, lon E7 pairs. Return 0 to stop. */
typedef int (*wb_grey_fn)(void *ctx, const int32_t *pts, uint32_t n);

/* The cell keys ((cy << 16) | cx) of the north-up box round the rider: 600 m wide (300 m each side), 520 m north and
 * 100 m south. Nearest centre first, at most 16. Returns the count, 0 when the rider is outside the grid. */
uint32_t wb_grey_cells(const wb_engine *e, int32_t lat_e7, int32_t lon_e7, uint32_t *cells);

/* Draws the lines of the given cells (keys from wb_grey_cells). Returns 1 when done or stopped by fn, 0 on a read
 * error. No layer in the file: returns 1 and calls nothing. */
int wb_grey_lines(wb_engine *e, const uint32_t *cells, uint32_t ncells, wb_grey_fn fn, void *ctx);
