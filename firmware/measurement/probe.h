#pragma once
#include <stdint.h>
/* Test-only per-invocation storage. No writable static/global capture state. */
typedef struct {
    uint64_t ticks[4], clock_overhead;
    uint32_t before[7], work[3], stack_remaining, stack_lowwater_prefix;
} tm_probe;
int tm_probe_begin(tm_probe *);
void tm_probe_acquired(tm_probe *);
void tm_probe_drawn(tm_probe *);
void tm_probe_end(tm_probe *,uint32_t decoded_pointer,uint32_t entries,uint32_t width,uint32_t height);
#ifdef TM_COMPOSITION
void tm_measure_frame(void);
#endif
#ifdef TM_BLOCK
void cc_blk(uint32_t,uint32_t);
#endif

void tm_probe_work(tm_probe *,uint32_t style,uint32_t points);
