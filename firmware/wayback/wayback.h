#pragma once
#include <stdint.h>
#include <stddef.h>
typedef int (*wb_reader)(void *ctx, uint32_t offset, void *dst, uint32_t bytes); /* 1 = ok, 0 = failed */
typedef struct wb_engine wb_engine;
enum { WB_NONE = 0, WB_LINE = 1 };                                             /* state */
enum { WB_OK = 0, WB_NO_FILE = 1, WB_GPS = 2, WB_ON_ROUTE = 3, WB_NO_STREET = 4, WB_READ = 5 }; /* reason */
enum { WB_GPS_VALID = 1, WB_OFF_ROUTE = 2, WB_EXIT_TRUSTED = 4 };              /* input flags */
typedef struct { int32_t lat_e7, lon_e7; uint32_t exit_progress_cm, flags; } wb_input;
typedef struct { uint32_t state, reason, distance_dm, forward, changed; } wb_output;
#define WB_DIST_UNKNOWN 0xFFFFFFFFu        /* forward distance not known */
size_t wb_size(void);                       /* bytes that the caller must supply for wb_engine, at most 128 */
int wb_mount(wb_engine *, wb_reader, void *ctx, uint32_t file_bytes, const uint8_t route_id[16]);
void wb_unmount(wb_engine *);
void wb_tick(wb_engine *, const wb_input *, wb_output *);
int wb_read_point(wb_engine *, uint32_t index, int32_t point_e7[2]);
