/* Host driver of firmware/view (cc27 Task 4). argv: ux uy, the 4 anchor screen points, then unit points to map.
 * Prints JSON: ok and the mapped points. */
#include <stdio.h>
#include <stdlib.h>
#include "view.h"

int main(int argc, char **argv) {
  if (argc < 11) return 2;
  int32_t ux = atoi(argv[1]), uy = atoi(argv[2]);
  pt_t s[4];
  for (int i = 0; i < 4; i++) { s[i].x = (int16_t)atoi(argv[3 + 2 * i]); s[i].y = (int16_t)atoi(argv[4 + 2 * i]); }
  vw_t v;
  int ok = vw_fit(&v, ux, uy, s);
  printf("{\"ok\":%d,\"pts\":[", ok);
  for (int i = 11; i + 1 < argc; i += 2) {
    pt_t p = vw_map(&v, atoi(argv[i]), atoi(argv[i + 1]));
    printf("%s[%d,%d]", i > 11 ? "," : "", p.x, p.y);
  }
  printf("]}\n");
  return 0;
}
