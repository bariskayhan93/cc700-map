#include "probe.h"
#ifndef TM_START_US
#define TM_START_US 120000000ULL
#endif
#ifndef TM_END_US
#define TM_END_US 150000000ULL
#endif
#ifdef TM_HOST
extern uint64_t tm_clock(void);
extern int tm_ready(void);
extern uint32_t tm_stack(uint32_t *);
extern void tm_heap(uint32_t *,uint32_t);
extern void tm_emit(const char *);
#else
static uint64_t tm_clock(void) {return ((uint64_t (*)(void))0x403779f4)();}
static int tm_ready(void) {
    return *(volatile uint32_t *)0x3fc9f158==0x60023000 &&
           *(volatile uint32_t *)0x3fc9f15c==0x4037f5e0;
}
static uint32_t tm_stack(uint32_t *lowwater) {
    uint32_t prid,sp,old_ps;
    __asm__ volatile("mov %0,a1":"=a"(sp));
    /* Keep core selection and current-TCB lookup on the same core. */
    __asm__ volatile("rsil %0,3":"=a"(old_ps)::"memory");
    __asm__ volatile("rsr.prid %0":"=a"(prid));
    uint32_t core=(prid>>13)&1;
    uint32_t task=((uint32_t (*)(uint32_t))0x403829dc)(core);
    __asm__ volatile("wsr %0,ps; rsync"::"a"(old_ps):"memory");
    if ((task&3) || task<0x3fc88000 || task>0x3fce0000-0x164) return 0;
    uint32_t base=*(volatile uint32_t *)(task+52), top=*(volatile uint32_t *)(task+76);
    if ((base&3) || base<0x3fc88000 || top>=0x3fce0000 || top<=base ||
        top-base>65536 || sp<base || sp>top) return 0;
    uint32_t remaining=sp-base;
    if(remaining<2048) return 0;
    /* Only the current task's known allocated stack; scan bounded below own SP. */
    uint32_t prefix=0;
    const volatile uint8_t *bytes=(const volatile uint8_t *)base;
    while(prefix<1024 && bytes[prefix]==165) ++prefix;
    *lowwater=prefix;
    return remaining;
}
static void tm_heap(uint32_t *out,uint32_t caps) {
    ((void (*)(uint32_t *,uint32_t))0x42003b50)(out,caps);
}
static void tm_emit(const char *s) {
    /* Stock ROM printf used by this exact image; no application logger scratch.
     * Output may interleave with native log lines: host must reject checksum loss. */
    ((int (*)(const char *,...))0x400005d0)("%s",s);
}
#endif
int tm_probe_begin(tm_probe *p) {
    if (!tm_ready()) return 0;
    uint64_t now=tm_clock();
    if(now<TM_START_US || now>=TM_END_US) return 0;
    p->stack_remaining=tm_stack(&p->stack_lowwater_prefix);
    if(p->stack_remaining<3072) return 0;
    p->work[0]=p->work[1]=p->work[2]=0;
    tm_heap(p->before,0x404);
    uint64_t a=tm_clock();
    p->clock_overhead=tm_clock()-a;
    p->ticks[0]=tm_clock();
    return 1;
}
void tm_probe_acquired(tm_probe *p) {p->ticks[1]=tm_clock();}
void tm_probe_drawn(tm_probe *p) {p->ticks[2]=tm_clock();}
static char *hex32(char *dst,uint32_t value,uint32_t *checksum) {
    static const char digits[]="0123456789abcdef";
    for(int shift=28;shift>=0;shift-=4) {
        unsigned char c=(unsigned char)digits[(value>>shift)&15];
        *dst++=(char)c; *checksum=(*checksum^c)*16777619U;
    }
    *dst++=' ';*checksum=(*checksum^32U)*16777619U;
    return dst;
}
static void finish(tm_probe *p,uint32_t pointer,uint32_t entries,uint32_t width,uint32_t height,const char *prefix) {
    p->ticks[3]=tm_clock();
    uint32_t lowwater,remaining=tm_stack(&lowwater);
    if(remaining<2048) return;
    if(remaining<p->stack_remaining) p->stack_remaining=remaining;
    if(lowwater<p->stack_lowwater_prefix) p->stack_lowwater_prefix=lowwater;
    uint32_t after[7];
    tm_heap(after,0x404);
    char line[256],*d=line;
    int work=prefix[3]=='M';
    while(*prefix) *d++=*prefix++;
    uint32_t sum=2166136261U;
    d=hex32(d,pointer,&sum); d=hex32(d,entries,&sum);
    d=hex32(d,width,&sum);d=hex32(d,height,&sum);
    for(unsigned i=0;i<4;i++) {
        d=hex32(d,(uint32_t)p->ticks[i],&sum);
        d=hex32(d,(uint32_t)(p->ticks[i]>>32),&sum);
    }
    d=hex32(d,(uint32_t)p->clock_overhead,&sum);
    d=hex32(d,p->before[0],&sum);d=hex32(d,p->before[2],&sum);d=hex32(d,p->before[3],&sum);
    d=hex32(d,after[0],&sum);d=hex32(d,after[2],&sum);d=hex32(d,after[3],&sum);
    if(work) for(unsigned i=0;i<3;i++) d=hex32(d,p->work[i],&sum);
    d=hex32(d,p->stack_remaining,&sum);d=hex32(d,p->stack_lowwater_prefix,&sum);
    uint32_t ignored=0; d=hex32(d,sum,&ignored);
    *d++='\n';*d=0;
    tm_emit(line);
}

void tm_probe_end(tm_probe *p,uint32_t pointer,uint32_t entries,uint32_t width,uint32_t height) {
    finish(p,pointer,entries,width,height,"CC7M3 ");
}
#ifdef TM_COMPOSITION
#ifdef TM_HOST
extern void tm_native_frame(void);
#else
static void tm_native_frame(void) {((void (*)(void))0x4204da24)();}
#endif
void tm_measure_frame(void) {
    tm_probe p; int active=tm_probe_begin(&p);
    if(active) tm_probe_acquired(&p);
    tm_native_frame();
    if(active) {tm_probe_drawn(&p);finish(&p,0,0,240,256,"CC7F2 ");}
}
#endif
#ifdef TM_BLOCK
extern void tm_original_blk(uint32_t,uint32_t);
void cc_blk(uint32_t type,uint32_t road) {
    tm_probe p; int active=tm_probe_begin(&p);
    if(active) tm_probe_acquired(&p);
    tm_original_blk(type,road);
    if(active) {tm_probe_drawn(&p);finish(&p,type,road,240,256,"CC7B2 ");}
}
#endif

static void add_work(uint32_t *dst,uint64_t count) {
    uint64_t n=(uint64_t)*dst+count; *dst=n>UINT32_MAX?UINT32_MAX:(uint32_t)n;
}
void tm_probe_work(tm_probe *p,uint32_t style,uint32_t points) {
    uint32_t cls=style&15;
    if(style && cls==12) add_work(&p->work[2],(uint64_t)points*8);
    else add_work(&p->work[0],(uint64_t)points+1);
    if(style && cls>=1 && cls<=3) add_work(&p->work[1],(uint64_t)points+1);
}
