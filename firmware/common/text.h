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
