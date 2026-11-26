// Text helpers of the patch modules. The second code area has no .rodata: text is built one character at a time.
#pragma once
#include <stdint.h>
/* Weak, not static (24 Nov): two modules include it and the link keeps one copy (65 B). */
__attribute__((weak, unused)) char *tx_num(char *s, uint32_t v) {   /* decimal, at most 5 digits */
  uint32_t n;
  if (v > 99999u) v = 99999u;
  for (n = 10000u; n > 1u && v < n; n /= 10u) {}
  for (; n; n /= 10u) { *s++ = (char)('0' + v / n); v %= n; }
  return s;
}
/* Shared helpers of area 2, defined once in wb_device.c (27 Nov, code room): map.c calls them on the device only. */
void tx_halo(void *cv, int32_t x, int32_t y, int32_t w, uint16_t col, const char *s);   /* text with a 1 px white halo */
void tx_row(int32_t y, const char *s);   /* a test or state row at (6, y): white shadow, then black */
uint32_t tx_clock(void);                 /* fw_clock as one call */
