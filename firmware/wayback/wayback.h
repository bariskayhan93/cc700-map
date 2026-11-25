#pragma once
#include <stdint.h>
#include <stddef.h>
uint32_t wb_u32(const uint8_t *p);                                          /* little-endian 32-bit word */
typedef int (*wb_reader)(void *ctx, uint32_t offset, void *dst, uint32_t bytes); /* 1 = ok, 0 = failed */
typedef struct wb_engine wb_engine;
enum { WB_NONE = 0, WB_LINE = 1 };                                             /* state */
enum { WB_OK = 0, WB_NO_FILE = 1, WB_GPS = 2, WB_ON_ROUTE = 3, WB_NO_STREET = 4, WB_READ = 5 }; /* reason */
enum { WB_GPS_VALID = 1, WB_OFF_ROUTE = 2, WB_EXIT_TRUSTED = 4 };              /* input flags */
/* keep (WB_BONUS only): bits 0-23 of the last frame's piece + 1; 0 = no last piece (zero init = no memory). */
typedef struct { int32_t lat_e7, lon_e7; uint32_t exit_progress_cm, flags, keep; } wb_input;
typedef struct { uint32_t state, reason, distance_dm, forward, changed, piece; } wb_output;   /* piece: bits 0-23 of the chosen piece id, WB_NIL without a line */
#define WB_DIST_UNKNOWN 0xFFFFFFFFu        /* forward distance not known (never set since cc26: kept for the device text) */
/* Version 2 grid: the frame of the file and the unit scales (24 B). */
typedef struct { int32_t lat0_e7, lon0_e7; uint32_t lat_u, lon_u, lat_e, lon_e; } wb_grid;
/* One street piece. id (E10): bits 0-22 node index (tree piece) or extra index, bit 23 = extra piece.
 * bits: bit 0 = extra toA, bit 1 = extra toB, bit 24 = grey flag (D1b). Positions in way-back units. */
typedef struct { uint32_t id, a, b, da, db, len, bits, vn, xa, ya, xb, yb; } wb_cand;
typedef int (*wb_visit)(void *ctx, const wb_cand *);          /* return 0 to stop */
size_t wb_size(void);                       /* bytes that the caller must supply for wb_engine, at most 128 */
int wb_mount(wb_engine *, wb_reader, void *ctx, uint32_t file_bytes, const uint8_t route_id[16]);
void wb_unmount(wb_engine *);
void wb_tick(wb_engine *, const wb_input *, wb_output *);
int wb_read_point(wb_engine *, uint32_t index, int32_t point_e7[2]);
void wb_grid_get(const wb_engine *, wb_grid *);
int wb_units(const wb_grid *, int32_t lat_e7, int32_t lon_e7, uint32_t *x, uint32_t *y);   /* 0 = outside the grid */
void wb_point(const wb_grid *, uint32_t x, uint32_t y, int32_t point_e7[2]);
/* Visits the street pieces of the cells cx0..cx1 x cy0..cy1 (at most 7 cells across), in the order of wb_tick.
 * A piece is visited when its start node lies in the box x0..x1, y0..y1 (wb_out). Returns 1 when done or stopped,
 * 0 on a read failure. */
int wb_scan(wb_engine *, uint32_t cx0, uint32_t cy0, uint32_t cx1, uint32_t cy1,
            uint32_t x0, uint32_t y0, uint32_t x1, uint32_t y1, wb_visit, void *ctx);
/* The line of one piece by its id (the id of wb_output.piece), for the rider position in input. */
void wb_line_info(const wb_engine *, uint32_t info[3]);   /* end_dm, len, end_first of the current line */
