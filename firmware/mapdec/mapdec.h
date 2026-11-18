/* cc25 map block decoder (scheme D, version 1). Hook: the entries callback literal 0x4203e3ec -> cc_entries. */
#ifndef MAPDEC_H
#define MAPDEC_H
#include <stdint.h>

/* Entry record (device view: ent_t in ../cc700-patch/src/fw.h, 24 B). The code writes the fields by offset:
   n 0, style 4, lat 8, lon 12, cnt 16, pts 20 (a pointer). The host build uses an 8-byte pointer, so its stride is 32. */
#ifdef HOST
#define MD_STRIDE 32u
#define MD_ARR_BYTES(n) (32u * (n))
#else
#define MD_STRIDE 24u
#define MD_ARR_BYTES(n) (28u * (n))     /* the stock allocation: 28 B per entry, caps 0x404 */
#endif

typedef struct pb_istream_s {
  int (*callback)(struct pb_istream_s *, uint8_t *, uint32_t);
  const uint8_t *state;
  uint32_t bytes_left;
  const char *errmsg;
} pb_istream_t;

static inline void md_put32(uint8_t *p, uint32_t v) {
  p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); p[2] = (uint8_t)(v >> 16); p[3] = (uint8_t)(v >> 24);
}
static inline uint32_t md_get32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static inline void md_putp(uint8_t *p, const void *v) {
  uintptr_t x = (uintptr_t)v; unsigned i;
  for (i = 0; i < sizeof(void *); i++) p[i] = (uint8_t)(x >> (8 * i));
}
static inline void *md_getp(const uint8_t *p) {
  uintptr_t x = 0; unsigned i;
  for (i = 0; i < sizeof(void *); i++) x |= (uintptr_t)p[i] << (8 * i);
  return (void *)x;
}

int cc_entries(pb_istream_t *s, const void *field, void **arg);   /* E4 */
#endif
