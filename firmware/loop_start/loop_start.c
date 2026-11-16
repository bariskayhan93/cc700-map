#include "loop_start.h"
#ifdef HOST
extern ls_result *ls_native(ls_result *,void *,uint16_t,int,int,const float *,const ls_result *);
extern int ls_read_context(void *,ls_context *);
extern const void *ls_point(void *,unsigned);
extern uint32_t ls_stack_remaining(void);
extern uint32_t ls_largest_heap(void);
extern void *ls_alloc(uint32_t,uint32_t);
extern void ls_free(void *);
#else
#define ls_native ((ls_result *(*)(ls_result *,void *,uint16_t,int,int,const float *,const ls_result *))0x4204b1e0)
#define ls_point ((const void *(*)(void *,unsigned))0x4204922c)
#define ls_alloc ((void *(*)(uint32_t,uint32_t))0x403763e0)
#define ls_free ((void (*)(void *))0x40376398)
static uint32_t ls_stack_remaining(void) {
    uint32_t sp;__asm__ volatile("mov %0,a1":"=a"(sp));
    uint32_t task=((uint32_t (*)(void))0x403832e0)();
    if((task&3) || task<0x3fc88000 || task>0x3fd00000-0x164) return 0;
    uint32_t base=*(volatile uint32_t *)(task+52),top=*(volatile uint32_t *)(task+76);
    if((base&3) || base<0x3fc88000 || top>=0x3fd00000 || top<=base ||
       top-base>65536 || sp<base || sp>top) return 0;
    return sp-base;
}
static __attribute__((noinline)) uint32_t ls_largest_heap(void) {
    uint32_t h[7];((void (*)(uint32_t *,uint32_t))0x42003b50)(h,0x404);
    return h[2];
}
static int ls_read_context(void *list,ls_context *s) {
    if(list!=*(void **)0x3c388cf8) return 0;
    s->navigation=*(volatile uint32_t *)0x3fc9fc34;
    s->arrival=*(volatile uint32_t *)0x3fc9fcd4;
    s->route_mode=((uint32_t (*)(void))0x42050be4)();
    s->max_road=*(volatile uint16_t *)0x3c389338;
    s->count=((uint32_t (*)(void *))0x42049200)(list);
    s->start[0]=*(volatile float *)0x3c389318;s->start[1]=*(volatile float *)0x3c38931c;
    s->end[0]=*(volatile float *)0x3c389310;s->end[1]=*(volatile float *)0x3c389314;
    s->total=*(volatile float *)0x3c389320;
    uint32_t record[4]={0,0,0,0};
    if(((int32_t (*)(uint32_t,void *))0x421434dc)(2,record)!=0) return 0;
    union {uint32_t u;float f;} d={.u=record[2]};
    s->ridden=d.f-*(volatile float *)0x3c389324;
    return 1;
}
#endif
_Static_assert(sizeof(ls_result)==148,"native matcher result size");
static unsigned word16(const void *p,unsigned at) {
    const uint8_t *b=p;return b[at]|((unsigned)b[at+1]<<8);
}
static uint32_t word32(const void *p,unsigned at) {
    const uint8_t *b=p;
    return b[at]|((uint32_t)b[at+1]<<8)|((uint32_t)b[at+2]<<16)|((uint32_t)b[at+3]<<24);
}
static int finite(float x) {
    union {float f;uint32_t u;} v={.f=x};return (v.u&0x7f800000)!=0x7f800000;
}
static int coordinate(const float *p) {
    return p && finite(p[0]) && finite(p[1]) && p[0]>=-85 && p[0]<=85 &&
           p[1]>=-180 && p[1]<=180 && (p[0]!=0 || p[1]!=0);
}
static float root(float x) {
    if(x<=0) return 0;
    union {float f;uint32_t u;} v={.f=x};v.u=0x1fbd1df5+(v.u>>1);
    float r=v.f;
    for(unsigned i=0;i<4;i++) r=0.5f*(r+x/r);
    return r;
}
/* Local distances only. Latitude bounds avoid polar ill-conditioning; longitude
 * wraps at the date line. No stock helper's negative-coordinate zero shortcut. */
static float distance(const float *a,const float *b) {
    float lat=(a[0]+b[0])*0.00872664626f,c2=lat*lat;
    float kx=111195.0f*(1-c2*(0.5f-c2*(1.0f/24-c2*(1.0f/720-c2/40320))));
    float dl=a[1]-b[1];if(dl>180)dl-=360;if(dl< -180)dl+=360;
    float x=dl*kx,y=(a[0]-b[0])*111195.0f;
    return root(x*x+y*y);
}
static int normal(const ls_result *r) {
    const uint8_t *b=(const uint8_t *)r;return b[146]==1 && b[145]==0 && b[147]==0;
}
static __attribute__((noinline)) void retry_start(ls_result *out,void *list,const float *pos,const ls_result *prev) {
    if(ls_stack_remaining()<3072) return;
    ls_context s;
    if(!ls_read_context(list,&s) || s.navigation!=2 || s.arrival || s.route_mode!=1 ||
       s.max_road<2 || s.count<2 || s.count>65535 ||
       word16(out,134)!=s.max_road || word16(out,40)!=s.max_road || !coordinate(s.start) || !coordinate(s.end) ||
       !finite(s.total) || !finite(s.ridden) || s.ridden<0) return;
    float separation=distance(s.start,s.end);
    if(separation>200 || s.total<=separation+200 || s.ridden>separation+100 ||
       distance(pos,s.start)+distance(pos,s.end)>separation+200) return;
    const void *first=ls_point(list,0);
    if(!first || word16(first,40)!=0 || word32(first,48)>=2 ||
       !coordinate(first) || distance(first,s.start)>1) return;
    unsigned previous=word16(prev,108),begin=0;
    if(((const uint8_t *)prev)[146]) {
        if(!normal(prev) || word16(prev,134)!=0 || previous>=s.count) return;
        const void *p=ls_point(list,previous);
        if(!p || word16(p,40)!=0) return;
        begin=previous>2?previous-2:0;
    }
    /* A retry uses the same total-sized native allocation even in mode one.
     * Conservative admission only: this is not a measured heap-peak bound. */
    if(ls_largest_heap()<144*s.count+65536) return;
    /* Keep the full native result intact. A short-lived PSRAM candidate avoids
     * consuming the smaller worker stack; all rejection paths release it. */
    ls_result *candidate=ls_alloc(sizeof(*candidate),0x404);
    if(!candidate) return;
    if(ls_native(candidate,list,0,(int)begin,1,pos,prev)!=candidate) goto release;
    unsigned selected=word16(candidate,108),end=begin+10;
    if(end>s.count)end=s.count;
    if(!normal(candidate) || ((const uint8_t *)candidate)[144] || selected<begin || selected>=end ||
       word16(candidate,134)!=0 || word16(candidate,40)!=0 || candidate->words[28]>100) goto release;
    const void *point=ls_point(list,selected);
    if(!point || word16(point,40)!=0 || word32(point,48)>=2 ||
       !coordinate(point) || distance(pos,point)>100) goto release;
    for(unsigned i=0;i<37;i++)out->words[i]=candidate->words[i];
release:
    ls_free(candidate);
}
ls_result *cc_loop_match(ls_result *out,void *list,uint16_t road,int start,int mode,const float *pos,const ls_result *prev) {
    ls_result *result=ls_native(out,list,road,start,mode,pos,prev);
    if(out && result==out && prev && out!=prev && list && road==0 && start==0 && mode==0 &&
       ((const uint8_t *)prev)[145]==0 && ((const uint8_t *)prev)[147]==0 &&
       coordinate(pos) && normal(out)) retry_start(out,list,pos,prev);
    return result;
}
