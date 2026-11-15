#include <stdint.h>
#include <string.h>
#include "../firmware/recovery/recovery.h"
typedef struct {const uint8_t *bytes;uint32_t size;} rc_memory;
int rc_host_read(void *ctx,uint32_t off,void *dst,uint32_t n){rc_memory *m=ctx;if(off>m->size||n>m->size-off)return 0;memcpy(dst,m->bytes+off,n);return 1;}
