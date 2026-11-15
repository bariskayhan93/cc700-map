#include "probe.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
static uint64_t tick;
static unsigned prints, heap_calls;
static uint32_t margin=4096;
uint32_t tm_stack(uint32_t *lowwater) {*lowwater=1024;return margin;}
static char captured[256];
uint64_t tm_clock(void) { return tick++; }
int tm_ready(void) { return 1; }
void tm_heap(uint32_t *out,uint32_t caps) {assert(caps==0x404);for(unsigned i=0;i<7;i++)out[i]=i+100+heap_calls;heap_calls++;}
void tm_emit(const char *s) {assert(strlen(s)<256);strcpy(captured,s);prints++;}
int main(void) {
    tm_probe p;
    tick=119999999; assert(!tm_probe_begin(&p)); assert(prints==0 && heap_calls==0);
    tick=120000000; margin=2048; assert(!tm_probe_begin(&p)); assert(prints==0 && heap_calls==0);
    tick=120000000; margin=4096; assert(tm_probe_begin(&p));
    assert(heap_calls==1 && prints==0);
    tm_probe_work(&p,5,3);tm_probe_work(&p,2,4);tm_probe_work(&p,12,3);
    tm_probe_acquired(&p);tm_probe_drawn(&p);
    assert(prints==0 && heap_calls==1); /* No heap or serial inside interval. */
    tm_probe_end(&p,0x1234,70,240,256);
    assert(heap_calls==2 && prints==1);
    assert(strncmp(captured,"CC7M3 ",6)==0);
    assert(p.ticks[0]==120000003 && p.ticks[1]==120000004);
    assert(p.ticks[2]==120000005 && p.ticks[3]==120000006);
    assert(p.clock_overhead==1);
    assert(p.work[0]==9 && p.work[1]==5 && p.work[2]==24);
    tick=150000000; assert(!tm_probe_begin(&p));
    assert(prints==1 && heap_calls==2);
    tick=130000000; margin=4096; assert(tm_probe_begin(&p));
    tm_probe_acquired(&p);tm_probe_drawn(&p);margin=1024;
    tm_probe_end(&p,0x1234,70,240,256);
    assert(prints==1 && heap_calls==3);
    tm_probe_work(&p,5,UINT32_MAX);tm_probe_work(&p,12,UINT32_MAX);
    assert(p.work[0]==UINT32_MAX && p.work[2]==UINT32_MAX);
    puts(captured);
    return 0;
}
