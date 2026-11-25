#pragma once
#include <stdint.h>
#define TM_CAPACITY 16
/* A capture is one named stationary workload. Hashes are raw SHA-256 bytes.
 * Timestamps use one verified monotonic clock, never host or unscaled cycles.
 * Channel flags describe only actually observed channels; zero means none. */
typedef struct {
    uint8_t base_sha256[32], image_sha256[32], route_sha256[32];
    uint32_t workload, source, layers, width, height, zoom, heading;
    int32_t latitude, longitude;
    uint32_t cold, recording, radio, replanning, channels, clock_id;
} tm_identity;
typedef struct {
    uint32_t block, section;
    uint64_t ticks[4]; /* iterator entry, acquired, post draw, post unlock */
    uint32_t heap_phase, heap_caps, heap_free, heap_largest, heap_minimum;
    uint32_t disturbance;
} tm_sample;
typedef struct {
    tm_identity identity;
    uint32_t count, dropped, rejected;
    tm_sample samples[TM_CAPACITY];
} tm_capture;
/* Mandatory caller-provided mutual exclusion; enter returns false on failure.
 * Must serialize all callers on every core; no assumed native mutex addresses. */
typedef struct { void *context; int (*enter)(void *); void (*leave)(void *); } tm_sync;
typedef struct { tm_sync sync; uint32_t state; tm_capture capture; } tm_journal;
int tm_init(tm_journal *, const tm_identity *, tm_sync);
int tm_record(tm_journal *, const tm_sample *);
int tm_freeze(tm_journal *);
int tm_snapshot(tm_journal *, tm_capture *);
int tm_close(tm_journal *);
