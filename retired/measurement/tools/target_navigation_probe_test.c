#include "probe.h"
#include <assert.h>
#include <stdio.h>
static unsigned reads, prints;
static uint32_t margin=4096;
static int ready=1;
static uint64_t boot=100;
uint64_t tm_clock(void) {return 9000000000ULL+reads;}
uint64_t tm_boot_clock(void) {return boot;}
int tm_ready(void) {return ready;}
uint32_t tm_stack(uint32_t *low) {*low=1024;return margin;}
void tm_heap(uint32_t *out,uint32_t caps) {(void)out;(void)caps;assert(0);}
void tm_usb_char(uint32_t fd,uint32_t byte) {assert(fd==1);putchar(byte);}
void tm_usb_flush(void) {prints++;}
void tm_navigation_read(uint32_t out[13]) {
    const uint32_t fixture[13]={4,4,0,111,559,0x00010100,559,558,559,4,559,559,111};
    for(unsigned i=0;i<13;i++)out[i]=fixture[i];
    reads++;
}
int main(void) {
    ready=0;tm_probe_navigation(0x1234,491);assert(!reads && !prints);
    ready=1;boot=120000000;tm_probe_navigation(0x1234,491);assert(!reads && !prints);
    boot=100;margin=1024;tm_probe_navigation(0x1234,491);assert(!reads && !prints);
    margin=4096;tm_probe_navigation(0x1234,491);assert(reads==1 && prints==1);
    return 0;
}
