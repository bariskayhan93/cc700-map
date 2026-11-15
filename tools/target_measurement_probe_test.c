#include "probe.h"
#include <assert.h>
#include <string.h>
#include <stdio.h>
static uint64_t tick;
static unsigned prints, heap_calls;
static uint32_t margin=4096;
uint32_t tm_stack(uint32_t *lowwater) {*lowwater=1024;return margin;}
static char captured[256];
static int boot_override;
uint64_t tm_clock(void) { return tick++; }
uint64_t tm_boot_clock(void) { return boot_override?60000000ULL:tick++; }
static int ready=1;
int tm_ready(void) { return ready; }
void tm_heap(uint32_t *out,uint32_t caps) {assert(caps==0x404);for(unsigned i=0;i<7;i++)out[i]=i+100+heap_calls;heap_calls++;}
static unsigned cursor;
void tm_usb_char(uint32_t fd,uint32_t byte) {assert(fd==1);assert(cursor<255);captured[cursor++]=(char)byte;}
void tm_usb_flush(void) {captured[cursor]=0;cursor=0;prints++;}
int main(void) {
    assert(tm_usb_state_valid(0x420074ec));
    assert(!tm_usb_state_valid(0));
    assert(!tm_usb_state_valid(0x420074ed));
    /* Actual rejected startup sample: idle TCB stack does not own GUI SP. */
    assert(tm_stack_bounds(0x3fca8998,0x3fca8384,0x3fca8980,0x3fcc2710)==0);
    assert(tm_stack_bounds(0x3fce1000,0x3fce2000,0x3fce3ff0,0x3fce3000)==4096);
    assert(tm_stack_bounds(0x3fc90000,0x3fca0000,0x3fca1ff0,0x3fca1000)==4096);
    assert(tm_stack_bounds(0x3fd00000,0x3fce2000,0x3fce3ff0,0x3fce3000)==0);
    assert(tm_stack_bounds(0x3fce1001,0x3fce2000,0x3fce3ff0,0x3fce3000)==0);
    assert(tm_stack_bounds(0x3fce1000,0x3fce2000,0x3fce3ff0,0x3fce1fff)==0);
    assert(tm_stack_bounds(0x3fce1000,0x3fce2000,0x3fce3ff0,0x3fce4000)==0);
    assert(tm_stack_bounds(0x3fce1000,0x3fce2000,0x3fd00000,0x3fce3000)==0);
    tm_probe p;
    tick=0;assert(tm_probe_begin(&p));heap_calls=0;
    tick=9000000000ULL;boot_override=1;assert(tm_probe_begin(&p));boot_override=0;heap_calls=0;
    tick=60000000;ready=0;assert(!tm_probe_begin(&p));assert(heap_calls==0 && prints==0);ready=1;
    tick=120000000; assert(!tm_probe_begin(&p)); assert(prints==0 && heap_calls==0);
    tick=60000000; margin=2048; assert(!tm_probe_begin(&p)); assert(prints==0 && heap_calls==0);
    tick=60000000; margin=4096; assert(tm_probe_begin(&p));
    assert(heap_calls==1 && prints==0);
    tm_probe_work(&p,5,3);tm_probe_work(&p,2,4);tm_probe_work(&p,12,3);
    tm_probe_acquired(&p);tm_probe_drawn(&p);
    assert(prints==0 && heap_calls==1); /* No heap or serial inside interval. */
    tm_probe_end(&p,0x1234,70,240,256);
    assert(heap_calls==2 && prints==1);
    assert(strncmp(captured,"CC7M3 ",6)==0);
    assert(p.ticks[0]==60000003 && p.ticks[1]==60000004);
    assert(p.ticks[2]==60000005 && p.ticks[3]==60000006);
    assert(p.clock_overhead==1);
    assert(p.work[0]==9 && p.work[1]==5 && p.work[2]==24);
    tick=120000000; assert(!tm_probe_begin(&p));
    assert(prints==1 && heap_calls==2);
    tick=90000000; margin=4096; assert(tm_probe_begin(&p));
    tm_probe_acquired(&p);tm_probe_drawn(&p);margin=1024;
    tm_probe_end(&p,0x1234,70,240,256);
    assert(prints==1 && heap_calls==3);
    tm_probe_work(&p,5,UINT32_MAX);tm_probe_work(&p,12,UINT32_MAX);
    assert(p.work[0]==UINT32_MAX && p.work[2]==UINT32_MAX);
    puts(captured);
    return 0;
}
