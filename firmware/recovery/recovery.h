#pragma once
#include <stdint.h>
#include <stddef.h>
typedef int (*rc_reader)(void *,uint32_t,void *,uint32_t);
typedef struct rc_engine rc_engine;
enum { RC_NORMAL=0,RC_UNAVAILABLE=1,RC_RECOVERING=2,RC_REJOIN_PENDING=3,RC_PAUSED=4 };
enum { RC_OK=0,RC_DISABLED=1,RC_GPS=2,RC_STALE=3,RC_ENTRY=4,RC_WINDOW=5,RC_OUTSIDE=6,RC_AMBIGUOUS=7,RC_WORK=8,RC_HEADING=9,RC_STOPPED=10,RC_EPOCH=11,RC_BYTES=12 };
/* ORDERED_MATCH requires independent near-route and ordered-visit validation.
 * A raw native on-route bit alone does not satisfy this provider contract. */
enum { RC_GPS_VALID=1,RC_OFF_ROUTE=2,RC_ORDERED_MATCH=4,RC_HEADING_VALID=8 };
typedef struct {uint32_t now_ms,fix_ms,epoch,progress_cm;int32_t lat_e7,lon_e7;float speed_kmh,accuracy_m,heading_x,heading_y;uint32_t flags,overlay_points;} rc_input;
typedef struct {uint32_t state,reason,suppress_native_cues,overlay,distance_cm,points,portal,guard_checks,reads;} rc_output;
size_t rc_size(void);
void rc_init(rc_engine *,const uint8_t identities[96],uint32_t epoch,int allow_experimental);
int rc_mount(rc_engine *,rc_reader,void *,uint32_t);
void rc_unmount(rc_engine *);
void rc_tick(rc_engine *,const rc_input *,rc_output *);
int rc_read_point(rc_engine *,uint32_t,int32_t point_e7[2]);
/* Single-owner API. Caller pins immutable file/context and serializes mount/tick/read.
 * C core has no native IO/UI/allocator hooks and does not certify package access. */
