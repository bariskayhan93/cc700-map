/* Page cache of the route file (WP 5 and WP 7). See wb_cache.h. */
#include "wb_cache.h"

void wc_reset(wc_cache *c, uint32_t key, uint32_t size) {
  uint32_t i;
  if (c->key == key && c->size == size && key) return;
  c->key = key; c->size = size; c->tick = 0u; c->hits = 0u; c->keep = 0u;   /* a new route: no last piece */
  for (i = 0u; i < WC_PAGES; i++) { c->page[i] = 0u; c->used[i] = 0u; }
}

/* The slot of page p, read from the file when it is not there (into the least recently used slot). -1 = read failed. */
static int wc_slot(wc_cache *c, wb_reader rd, void *ctx, uint32_t p, int *miss) {
  uint32_t i, old = 0u, at = p * WC_PAGE, n = c->size - at < WC_PAGE ? c->size - at : WC_PAGE;
  for (i = 0u; i < WC_PAGES; i++) {
    if (c->page[i] == p + 1u) return (int)i;
    if (c->used[i] < c->used[old]) old = i;
  }
  *miss = 1;
  c->page[old] = 0u;
  if (!rd(ctx, at, c->data[old], n)) return -1;
  c->page[old] = p + 1u;
  return (int)old;
}

int wc_read(wc_cache *c, wb_reader rd, void *ctx, uint32_t off, void *dst, uint32_t n) {
  uint8_t *o = (uint8_t *)dst; int miss = 0;
  if (off > c->size || n > c->size - off) return 0;
  while (n) {
    uint32_t p = off / WC_PAGE, in = off - p * WC_PAGE, k = WC_PAGE - in < n ? WC_PAGE - in : n, j;
    int s = wc_slot(c, rd, ctx, p, &miss);
    if (s < 0) return 0;
    c->used[s] = ++c->tick;
    for (j = 0u; j < k; j++) o[j] = c->data[s][in + j];
    o += k; off += k; n -= k;
  }
#ifdef WB_DIAG
  if (!miss) c->hits++;                                        /* test image only (test_wb_cache) */
#endif
  return 1;
}
