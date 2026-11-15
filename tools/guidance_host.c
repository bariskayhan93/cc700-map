#include <stdint.h>
#include <stddef.h>
static uintptr_t values[9];
static unsigned offroute;
static unsigned hidden[6], caption_mode=1;
void guidance_host_reset(unsigned value) {
    for (unsigned i=0;i<9;i++) values[i]=0;
    offroute=value;
    for (unsigned i=0;i<6;i++) hidden[i]=0;
    hidden[5]=1; /* Independent page owner hid the root. */
}
void guidance_host_offroute(unsigned value) { offroute=value; }
void guidance_host_caption(unsigned value) { caption_mode=value; }
unsigned guidance_host_hidden(unsigned index) { return hidden[index]; }
uintptr_t guidance_host_value(unsigned i) { return values[i]; }
void *guidance_child(void *obj, int index) {
    (void)obj; return (void *)(uintptr_t)(0x3000 + index);
}
unsigned guidance_offroute(void) { values[0]++; return offroute; }
void guidance_add_flag(void *obj, unsigned flag) {
    if ((uintptr_t)obj>=0x3000 && (uintptr_t)obj<0x3005) hidden[(uintptr_t)obj-0x3000]=1;
    else hidden[5]=1;
    values[1]++; values[5]=(uintptr_t)obj; values[6]=flag;
}
void guidance_clear_flag(void *obj, unsigned flag) {
    if ((uintptr_t)obj>=0x3000 && (uintptr_t)obj<0x3005) hidden[(uintptr_t)obj-0x3000]=0;
    else hidden[5]=0;
    values[2]++; values[8]=flag; values[5]=(uintptr_t)obj;
}
static void record(void *obj,const void *callbacks,void *buffer,unsigned index) {
    values[index]++; values[5]=(uintptr_t)obj;
    values[6]=(uintptr_t)callbacks; values[7]=(uintptr_t)buffer;
}
void guidance_native_card(void *o,const void *c,void *b) {
    record(o,c,b,3);
    if (c==(void *)0x3fc98b60 && o && b) {
        /* Native consumer 81e54..81e94 switches these caption children. */
        hidden[1]=caption_mode!=1; hidden[2]=caption_mode==1;
    }
}
void guidance_native_popup(void *o,const void *c,void *b) {
    record(o,c,b,4);
    if (c==(void *)0x3fc989f0 && o && b) {
        /* Native consumer 86fbc..87079 switches these caption children. */
        hidden[3]=caption_mode!=1; hidden[4]=caption_mode==1;
    }
}
