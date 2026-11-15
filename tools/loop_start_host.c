#include "loop_start.h"
#include <assert.h>
#include <math.h>
#include <string.h>
typedef struct {float pos[2];uint8_t gap[32];uint16_t road,pad;uint32_t unused,type,tail[2];} point;
static point points[16];
static ls_context context;
static unsigned calls,retry_bad,margin=4096,heap=1000000;
static int list;
static uint16_t u16(const ls_result *p,unsigned at){uint16_t v;memcpy(&v,(const uint8_t*)p+at,2);return v;}
static void set16(ls_result *p,unsigned at,uint16_t v){memcpy((uint8_t*)p+at,&v,2);}
ls_result *ls_native(ls_result *out,void *l,uint16_t road,int start,int mode,const float *pos,const ls_result *prev) {
    assert(l==&list);assert(road==0 || road==5);assert(prev);calls++;
    unsigned first=mode?(unsigned)start:0,end=mode?first+10:16;if(end>16)end=16;
    float best=1e30f;unsigned selected=first;
    for(unsigned i=first;i<end;i++) {
        float x=(points[i].pos[1]-pos[1])*70000,y=(points[i].pos[0]-pos[0])*111195,d=x*x+y*y;
        if(d<best){best=d;selected=i;}
    }
    memset(out,0,sizeof(*out));memcpy(out,&points[selected],60);
    set16(out,108,(uint16_t)selected);set16(out,134,points[selected].road);
    out->words[28]=(uint32_t)sqrtf(best);((uint8_t*)out)[146]=1;
    if(mode && retry_bad) {
        if(retry_bad==1)set16(out,108,15);
        if(retry_bad==2)((uint8_t*)out)[147]=1;
        if(retry_bad==3)((uint8_t*)out)[146]=0;
        if(retry_bad==4)set16(out,134,112);
        if(retry_bad==5)((uint8_t*)out)[145]=1;
        if(retry_bad==6)((uint8_t*)out)[144]=1;
        if(retry_bad==7)set16(out,40,112);
        if(retry_bad==8)out->words[28]=101;
        if(retry_bad==9 || retry_bad==10){set16(out,108,1);out->words[28]=0;}
    }
    return out;
}
int ls_read_context(void *l,ls_context *out){assert(l==&list);*out=context;return 1;}
const void *ls_point(void *l,unsigned i){assert(l==&list);return i<16?&points[i]:0;}
uint32_t ls_stack_remaining(void){return margin;}
uint32_t ls_largest_heap(void){return heap;}
static void setup(void) {
    memset(points,0,sizeof(points));memset(&context,0,sizeof(context));
    for(unsigned i=0;i<15;i++) {points[i].pos[0]=51;points[i].pos[1]=7+(float)i*10/70000;}
    points[15].pos[0]=51+55.0f/111195;points[15].pos[1]=7;points[15].road=112;
    context.navigation=2;context.route_mode=1;context.max_road=112;context.count=16;
    memcpy(context.start,points[0].pos,8);memcpy(context.end,points[15].pos,8);
    context.total=23000;calls=retry_bad=0;margin=4096;heap=1000000;
}
static void run(unsigned expected,unsigned count,uint16_t road,ls_result *previous) {
    ls_result out;assert(cc_loop_match(&out,&list,road,0,0,points[15].pos,previous)==&out);
    assert(u16(&out,108)==expected);assert(calls==count);
}
int main(void) {
    ls_result previous={0};setup();run(0,2,0,&previous); /* ordinary implementation fails here */
    setup();context.ridden=23000;run(15,1,0,&previous); /* actual return */
    setup();context.ridden=154;run(0,2,0,&previous);
    setup();context.ridden=157;run(15,1,0,&previous);
    setup();run(15,1,5,&previous); /* already advanced/resumed */
    setup();context.navigation=10;run(15,1,0,&previous); /* reverse */
    setup();context.navigation=8;run(15,1,0,&previous); /* connector */
    setup();context.route_mode=0;run(15,1,0,&previous); /* other file slot */
    setup();context.arrival=1;run(15,1,0,&previous);
    setup();context.total=200;run(15,1,0,&previous);
    setup();context.ridden=-1;run(15,1,0,&previous);
    setup();context.total=NAN;run(15,1,0,&previous);
    setup();context.ridden=INFINITY;run(15,1,0,&previous);
    setup();context.start[0]=NAN;run(15,1,0,&previous);
    setup();context.end[0]+=0.01f;run(15,1,0,&previous);
    setup();points[0].road=3;run(15,1,0,&previous); /* loaded window lacks start */
    setup();points[0].type=2;run(15,1,0,&previous);
    setup();points[0].pos[0]+=0.001f;run(15,1,0,&previous);
    setup();margin=1024;run(15,1,0,&previous);
    setup();heap=1000;run(15,1,0,&previous);
    for(unsigned bad=1;bad<=8;bad++){setup();retry_bad=bad;run(15,2,0,&previous);}
    setup();retry_bad=9;points[1].pos[0]=52;run(15,2,0,&previous);
    setup();retry_bad=10;points[1].pos[0]=NAN;run(15,2,0,&previous);
    setup();ls_result out;cc_loop_match(&out,&list,0,0,0,points[13].pos,&previous);
    assert(u16(&out,108)==13 && calls==1); /* ordinary outgoing motion is unrestricted */
    setup();((uint8_t*)&previous)[145]=1;run(15,1,0,&previous);((uint8_t*)&previous)[145]=0;
    setup();((uint8_t*)&previous)[147]=1;run(15,1,0,&previous);((uint8_t*)&previous)[147]=0;
    setup();((uint8_t*)&previous)[146]=1;set16(&previous,108,5);
    run(3,2,0,&previous); /* window advances with prior valid outgoing progress */
    setup();((uint8_t*)&previous)[146]=1;set16(&previous,134,112);run(15,1,0,&previous);
    return 0;
}
