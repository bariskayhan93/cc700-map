#include "probe.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
static uint64_t tick=120000000;
static unsigned calls,outputs,heaps;
static uint32_t margin=4096;
uint32_t tm_stack(uint32_t *lowwater) {*lowwater=1000;return margin;}
uint64_t tm_clock(void) {return tick++;}
int tm_ready(void) {return 1;}
void tm_heap(uint32_t *out,uint32_t caps) {(void)caps;for(unsigned i=0;i<7;i++)out[i]=1;heaps++;}
void tm_emit(const char *s) {assert(calls==1);assert(heaps==2);assert(strncmp(s,"CC7F2 ",6)==0 || strncmp(s,"CC7B2 ",6)==0);outputs++;puts(s);}
void tm_native_frame(void) {assert((outputs==0 && heaps==1) || (outputs==1 && heaps==2));calls++;tick+=10;}
void tm_original_blk(uint32_t type,uint32_t road) {assert(type==2 && road==3);tm_native_frame();}
int main(void) {
#ifdef TM_COMPOSITION
    tm_measure_frame();
#else
    cc_blk(2,3);
#endif
    assert(calls==1 && outputs==1);
    tick=160000000;
    /* Outside the window original work must still run, with no heap/serial. */
#ifdef TM_COMPOSITION
    tm_measure_frame();
#else
    cc_blk(2,3);
#endif
    assert(calls==2 && outputs==1 && heaps==2);
    tick=130000000;margin=2048;
#ifdef TM_COMPOSITION
    tm_measure_frame();
#else
    cc_blk(2,3);
#endif
    assert(calls==3 && outputs==1 && heaps==2);
    return 0;
}
