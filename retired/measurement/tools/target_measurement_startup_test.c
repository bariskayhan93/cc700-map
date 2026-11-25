#include "probe.h"
#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
static int timer_initialized=1;
static char line[256];static unsigned cursor,flushed,original_calls;
uint64_t tm_clock(void) {return 9000000123ULL;}
uint64_t tm_boot_clock(void) {return 1234;}
int tm_ready(void) {return 0;} /* Normal capture's USB registry gate fails. */
uint32_t tm_stack(uint32_t *prefix) {*prefix=1024;return 4096;}
void tm_heap(uint32_t *out,uint32_t caps) {(void)out;(void)caps;assert(0);}
void tm_diagnostic_state(uint32_t out[3]) {
    out[0]=timer_initialized?0x60023000:0;out[1]=0x4037f5e0;out[2]=0x42000000; /* registry differs */
}
void tm_diagnostic_stack(uint32_t out[5]) {
    out[0]=1;out[1]=0x3fce1000;out[2]=0x3fce2000;out[3]=0x3fce3ff0;out[4]=0x3fce3000;
}
void tm_usb_char(uint32_t fd,uint32_t byte) {assert(fd==1);assert(cursor<255);line[cursor++]=(char)byte;}
void tm_usb_flush(void) {line[cursor]=0;cursor=0;flushed++;}
void tm_gui_original(void *arg) {assert(arg==(void *)(uintptr_t)0x1234);assert(flushed==1);original_calls++;}
int main(void) {
    tm_gui_entry((void *)(uintptr_t)0x1234);
    assert(original_calls==1 && flushed==1);
    assert(strncmp(line,"CC7D1 ",6)==0);
    timer_initialized=0;tm_gui_entry((void *)(uintptr_t)0x1234);
    assert(original_calls==2 && flushed==1);
    puts(line);
    return 0;
}
