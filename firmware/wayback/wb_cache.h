/* Page cache of the route file (WP 5 and WP 7, 24 Nov): between the file and every reader of a map frame (far map
 * section 4 and way-back section 3). Pages of WC_PAGE bytes at page-aligned file offsets, least recently used out.
 * The cache lives across frames in WC_BYTES of PSRAM; its owner keeps the pointer (the WP 4 RAM word). A new route
 * key (or a new file size) empties it. Integer code, no static memory, no heap. */
#pragma once
#include <stdint.h>
#include "wayback.h"

#define WC_PAGE 1024u
#define WC_PAGES 48u                 /* 48 KB: research 24 Nov, 24 far cells of at most 2,048 B */

typedef struct {
  uint32_t key, size, tick, hits;
  uint32_t page[WC_PAGES];           /* page index + 1; 0 = empty */
  uint32_t used[WC_PAGES];           /* tick of the last use */
  uint8_t data[WC_PAGES][WC_PAGE];
} wc_cache;
#define WC_BYTES ((uint32_t)sizeof(wc_cache))

/* Empties the cache when key or size differ from the cached file. key 0 is never a valid key. */
void wc_reset(wc_cache *c, uint32_t key, uint32_t size);
/* Reads n bytes at off as rd would: from the pages, and a missing page with one rd call of that page. 1 = ok. */
int wc_read(wc_cache *c, wb_reader rd, void *ctx, uint32_t off, void *dst, uint32_t n);
