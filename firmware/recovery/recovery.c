#include "recovery.h"
#define UNKNOWN 0xffffffffu
#define MAX_SEGMENTS 1024u
#define MAX_GUARDS 256u
#define MAX_TABLE 4096u
struct rc_engine {
    rc_reader reader;void *ctx;uint32_t size,epoch;uint8_t identities[96],row[64];
    uint32_t entry_min,entry_max,entry_cm,entry_at,last_now,last_join_fix,joined,active_row,active_seg,last_along;
    uint32_t reads,guard_checks,state,reason;int32_t center[2],projected[2];
    float scale[2];uint16_t portals;uint8_t experimental,mounted,entry_valid,active,have_time,invalid_session,overlay,episode,have_target;
    uint32_t guard_at,guards;
};
_Static_assert(sizeof(rc_engine)<=512,"bounded caller-owned recovery state");
static uint32_t u32(const void *p){const uint8_t *b=p;return b[0]|((uint32_t)b[1]<<8)|((uint32_t)b[2]<<16)|((uint32_t)b[3]<<24);}
static uint16_t u16(const void *p){const uint8_t *b=p;return b[0]|((uint16_t)b[1]<<8);}
static int32_t i32(const void *p){return (int32_t)u32(p);}
static float f32(const void *p){union {uint32_t u;float f;} v={.u=u32(p)};return v.f;}
static float absf(float x){return x<0?-x:x;}
static int validf(float x){union {float f;uint32_t u;} v={.f=x};return (v.u&0x7f800000u)!=0x7f800000u;}
static float root(float x){if(x<=0)return 0;union {float f;uint32_t u;}v={.f=x};v.u=0x1fbd1df5+(v.u>>1);float r=v.f;for(unsigned i=0;i<5;i++)r=.5f*(r+x/r);return r;}
#ifdef RC_HOST_STATS
#define RC_COUNT_READ(e) ((e)->reads++)
#define RC_RESET_READS(e) ((e)->reads=0)
#define RC_REPORT_READS(e,o) ((o)->reads=(e)->reads)
#else
#define RC_COUNT_READ(e) ((void)0)
#define RC_RESET_READS(e) ((void)0)
#define RC_REPORT_READS(e,o) ((void)0)
#endif
static int16_t i16(const void *p){return (int16_t)u16(p);}
static int read_at(rc_engine *e,uint32_t off,void *dst,uint32_t n){RC_COUNT_READ(e);return e->reader&&off<=e->size&&n<=e->size-off&&e->reader(e->ctx,off,dst,n);}
static int coord(rc_engine *e,const uint8_t *p){int32_t lat=i32(p),lon=i32(p+4);return lat>=-850000000&&lat<=850000000&&lon>=-1800000000&&lon<=1800000000&&absf((float)((int64_t)lat-e->center[0])*e->scale[1])<=5000000&&absf((float)((int64_t)lon-e->center[1])*e->scale[0])<=5000000;}
static void xy(rc_engine *e,const uint8_t *p,float *x,float *y){*x=(float)((int64_t)i32(p+4)-e->center[1])*e->scale[0];*y=(float)((int64_t)i32(p)-e->center[0])*e->scale[1];}
static void clear_active(rc_engine *e){e->active=0;e->overlay=0;e->joined=0;}
size_t rc_size(void){return sizeof(rc_engine);}
void rc_init(rc_engine *e,const uint8_t ids[96],uint32_t epoch,int experimental){uint8_t *b=(uint8_t *)e;for(size_t i=0;i<sizeof(*e);i++)b[i]=0;for(unsigned i=0;i<96;i++)e->identities[i]=ids[i];e->epoch=epoch;e->experimental=experimental!=0;}
void rc_unmount(rc_engine *e){clear_active(e);e->mounted=0;e->reader=0;e->ctx=0;e->size=0;}
int rc_mount(rc_engine *e,rc_reader reader,void *ctx,uint32_t size){
    uint8_t h[160],row[64],s[16],p[16],chunk[32],q[2];clear_active(e);e->mounted=0;e->reader=reader;e->ctx=ctx;e->size=size;e->reason=RC_BYTES;
    if(size<160||size>65536||!read_at(e,0,h,160))return 0;
    if(h[0]!='C'||h[1]!='C'||h[2]!='R'||h[3]!='P'||u16(h+4)!=2||u16(h+6)!=1||u32(h+8)!=size)return 0;
    if(!e->experimental){e->reason=RC_DISABLED;return 0;}
    for(unsigned i=0;i<96;i++)if(h[i+16]!=e->identities[i])return 0;
    uint32_t crc=0xffffffffu;for(uint32_t at=0;at<size;at+=32){uint32_t n=size-at;if(n>32)n=32;if(!read_at(e,at,chunk,n))return 0;for(uint32_t j=0;j<n;j++){uint32_t off=at+j;crc^=off>=12&&off<16?0:chunk[j];for(unsigned k=0;k<8;k++)crc=(crc>>1)^((crc&1)?0xedb88320u:0);}}
    if((crc^0xffffffffu)!=u32(h+12))return 0;
    e->entry_min=u32(h+112);e->entry_max=u32(h+116);e->portals=u16(h+120);e->center[0]=i32(h+136);e->center[1]=i32(h+140);e->scale[0]=f32(h+144);e->scale[1]=f32(h+148);
    if(e->entry_max<=e->entry_min||e->portals>64||u16(h+122)!=512||u32(h+124)!=160||u32(h+156))return 0;
    if(e->center[0]<-850000000||e->center[0]>850000000||e->center[1]<-1800000000||e->center[1]>1800000000||!validf(e->scale[0])||e->scale[0]<.09f||e->scale[0]>1.114f||!validf(e->scale[1])||absf(e->scale[1]-1.1132f)>.0001f)return 0;
    uint32_t guard=u32(h+128),leg=u32(h+132),table=u32(h+152),segments=0;
    if(guard!=160+64u*e->portals||table>MAX_TABLE||leg<guard+16*table||leg>size)return 0;
    e->guard_at=guard;e->guards=table;
    for(uint32_t g=0;g<table;g++){if(!read_at(e,guard+16*g,p,16)||!coord(e,p)||!coord(e,p+8))return 0;}
    uint32_t leg0=leg,r=guard+16*table;
    for(unsigned rw=0;rw<e->portals;rw++){
        if(!read_at(e,160+64*rw,row,64))return 0;
        uint32_t n=u16(row+20),nrefs=u16(row+22),table_at=u32(row+52),point=u32(row+16),g0=r,cum=0;
        if(n<2||n>512||table_at!=leg||point!=table_at+16*(n-1)||point>size||8*n>size-point||u32(row+24)!=r||u16(row+46)!=1||u32(row+48)!=rw+1||i16(row+56)>10000||i16(row+56)<-10000||i16(row+58)>10000||i16(row+58)<-10000||u32(row+60)||u16(row+44)>=36000)return 0;
        if((uint64_t)u32(row+28)<=(uint64_t)e->entry_max+2500||(uint64_t)u32(row+28)>(uint64_t)e->entry_min+300000)return 0;
        segments+=n-1;if(segments>MAX_SEGMENTS)return 0;
        for(uint32_t i=0;i<n-1;i++){
            if(!read_at(e,table_at+16*i,s,16)||u32(s)!=r||u16(s+4)>64||u16(s+6)||u32(s+8)!=cum||!u32(s+12)||u32(s+12)>1500000)return 0;
            cum+=u32(s+12);if(cum>1500000)return 0;
            uint32_t count=u16(s+4);if((uint64_t)2*count>(uint64_t)leg0-r)return 0;
            for(uint32_t j=0;j<count;j++)if(!read_at(e,r+2*j,q,2)||u16(q)>=table)return 0;
            r+=2*count;
        }
        if(r-g0!=2*nrefs||cum!=u32(row+32))return 0;
        for(uint32_t i=0;i<n;i++){if(!read_at(e,point+8*i,p,8)||!coord(e,p))return 0;if(i<2)for(unsigned j=0;j<8;j++)if(p[j]!=row[8*i+j])return 0;if(i==n-1)for(unsigned j=0;j<8;j++)if(p[j]!=row[36+j])return 0;}
        leg=point+8*n;
    }
    if(r!=leg0||leg!=size)return 0;
    e->mounted=1;e->reason=RC_OK;return 1;
}
static float projection(rc_engine *e,const uint8_t p[16],float x,float y,float *t,float *dx,float *dy){float ax,ay,bx,by;xy(e,p,&ax,&ay);xy(e,p+8,&bx,&by);*dx=bx-ax;*dy=by-ay;float l=*dx**dx+*dy**dy;*t=l?((x-ax)**dx+(y-ay)**dy)/l:0;if(*t<0)*t=0;if(*t>1)*t=1;return root((x-ax-*t**dx)*(x-ax-*t**dx)+(y-ay-*t**dy)*(y-ay-*t**dy));}
static void emit(rc_engine *e,rc_output *o){o->state=e->state;o->reason=e->reason;o->suppress_native_cues=e->state!=RC_NORMAL;o->overlay=e->overlay;RC_REPORT_READS(e,o);o->guard_checks=e->guard_checks;}
static void unavailable(rc_engine *e,rc_output *o,uint32_t reason){e->state=RC_UNAVAILABLE;e->reason=reason;e->overlay=0;emit(e,o);}
void rc_tick(rc_engine *e,const rc_input *in,rc_output *o){
    uint8_t *ob=(uint8_t *)o;for(size_t i=0;i<sizeof(*o);i++)ob[i]=0;o->distance_cm=UNKNOWN;RC_RESET_READS(e);e->guard_checks=0;e->overlay=0;
    uint32_t elapsed=e->have_time?in->now_ms-e->last_now:0;
    if(e->have_time&&(in->now_ms<=e->last_now||elapsed>5000)){clear_active(e);e->entry_valid=0;}
    e->last_now=in->now_ms;e->have_time=1;
    if(in->epoch!=e->epoch||e->invalid_session){e->invalid_session=1;clear_active(e);e->entry_valid=0;unavailable(e,o,RC_EPOCH);return;}
    if(!(in->flags&RC_GPS_VALID)||!validf(in->accuracy_m)||in->accuracy_m<=0||in->accuracy_m>15||in->lat_e7<-850000000||in->lat_e7>850000000||in->lon_e7<-1800000000||in->lon_e7>1800000000){clear_active(e);e->entry_valid=0;unavailable(e,o,RC_GPS);return;}
    if(in->fix_ms>in->now_ms||in->now_ms-in->fix_ms>3000){clear_active(e);e->entry_valid=0;unavailable(e,o,RC_STALE);return;}
    int heading=(in->flags&RC_HEADING_VALID)&&validf(in->heading_x)&&validf(in->heading_y);float hx=0,hy=0;
    if(heading){hx=in->heading_x;hy=in->heading_y;}
    float x=(float)((int64_t)in->lon_e7-e->center[1])*e->scale[0],y=(float)((int64_t)in->lat_e7-e->center[0])*e->scale[1];
    if(!(in->flags&RC_OFF_ROUTE)){
        if(e->active||e->episode){
            float tx,ty;xy(e,e->row+36,&tx,&ty);uint32_t target=u32(e->row+28),delta=in->progress_cm>target?in->progress_cm-target:target-in->progress_cm;
            float dot=hx*i16(e->row+56)*1e-4f+hy*i16(e->row+58)*1e-4f;
            int target_ok=e->have_target&&heading&&delta<=2000&&root((x-tx)*(x-tx)+(y-ty)*(y-ty))<=2000&&dot>=.7071f;
            /* ORDERED_MATCH is independent near-route/visit proof, not a raw
             * native off-route flag. Permit a verified alternate rejoin. */
            int alternate_ok=!e->entry_valid||((uint64_t)in->progress_cm+2000>=e->entry_cm&&(uint64_t)in->progress_cm<=(uint64_t)e->entry_cm+300000);
            if((in->flags&RC_ORDERED_MATCH)&&(target_ok||alternate_ok)){if(in->fix_ms>e->last_join_fix){if(e->joined&&in->fix_ms-e->last_join_fix>5000)e->joined=0;e->joined++;e->last_join_fix=in->fix_ms;}else if(in->fix_ms<e->last_join_fix)e->joined=0;}
            else e->joined=0;
            if(e->joined<5){e->state=RC_REJOIN_PENDING;e->reason=RC_OK;emit(e,o);return;}
            clear_active(e);e->episode=0;e->have_target=0;
        }
        e->entry_valid=(in->flags&RC_ORDERED_MATCH)!=0;if(e->entry_valid){e->entry_cm=in->progress_cm;e->entry_at=in->now_ms;}
        e->state=RC_NORMAL;e->reason=RC_OK;emit(e,o);return;
    }
    e->joined=0;e->episode=1;
    if(!e->entry_valid||in->now_ms-e->entry_at>1800000){clear_active(e);unavailable(e,o,RC_ENTRY);return;}
    if(!e->mounted){clear_active(e);unavailable(e,o,RC_BYTES);return;}
    if(e->entry_cm<e->entry_min||e->entry_cm>=e->entry_max){clear_active(e);unavailable(e,o,RC_WINDOW);return;}
    if(!validf(in->speed_kmh)||in->speed_kmh<3){e->state=RC_PAUSED;e->reason=RC_STOPPED;emit(e,o);return;}
    if(!heading){unavailable(e,o,RC_HEADING);return;}
    float best=1e20f,best_t=0;uint32_t best_row=UNKNOWN,best_seg=0,best_along=0;int ambiguous=0;uint8_t row[64],seg[16],pair[16],best_pair[16];
    unsigned begin=e->active?e->active_row:0,end=e->active?begin+1:e->portals;
    for(unsigned r=begin;r<end;r++){
        if(!read_at(e,160+64*r,row,64)){clear_active(e);unavailable(e,o,RC_BYTES);return;}
        for(unsigned j=0;j+1<u16(row+20);j++){
            if(!read_at(e,u32(row+16)+8*j,pair,16)||!read_at(e,u32(row+52)+16*j,seg,16)){clear_active(e);unavailable(e,o,RC_BYTES);return;}
            float t,dx,dy,d=projection(e,pair,x,y,&t,&dx,&dy),len=root(dx*dx+dy*dy);if(len<1||d>1500||(dx*hx+dy*hy)/len<.7071f)continue;
            uint32_t along=u32(seg+8)+(uint32_t)(t*u32(seg+12));
            if((j==0&&t*len<200))continue;
            int adjacent=best_row==r&&((j==best_seg+1)||(best_seg==j+1))&&absf((float)along-(float)best_along)<=300;
            if(d<best-500){ambiguous=0;}
            else if(d<=best+500&&!adjacent&&best_row!=UNKNOWN){ambiguous=1;}
            if(d<best||(adjacent&&along>best_along)){best=d;best_t=t;best_row=r;best_seg=j;best_along=along;for(unsigned k=0;k<16;k++)best_pair[k]=pair[k];}
        }
    }
    if(best_row==UNKNOWN){clear_active(e);unavailable(e,o,RC_OUTSIDE);return;}if(ambiguous){unavailable(e,o,RC_AMBIGUOUS);return;}
    if(e->active){float advance=in->speed_kmh*(float)elapsed/36.0f+in->accuracy_m*200+1000;if(advance<5000)advance=5000;if((float)best_along+2000<e->last_along||(float)best_along>e->last_along+advance){unavailable(e,o,RC_AMBIGUOUS);return;}}
    if(!read_at(e,160+64*best_row,row,64)||!read_at(e,u32(row+52)+16*best_seg,seg,16)){clear_active(e);unavailable(e,o,RC_BYTES);return;}
    /* Same-path reverse/parallel pieces remain source competitors even though
     * their travel direction cannot provide this recovery candidate. */
    for(unsigned j=0;j+1<u16(row+20);j++)if(j!=best_seg){
        uint8_t other[16];
        if(!read_at(e,u32(row+16)+8*j,pair,16)||!read_at(e,u32(row+52)+16*j,other,16)){clear_active(e);unavailable(e,o,RC_BYTES);return;}
        float t,dx,dy,d=projection(e,pair,x,y,&t,&dx,&dy),len=root(dx*dx+dy*dy);
        uint32_t along=u32(other+8)+(uint32_t)(t*u32(other+12));
        int adjacent=(j==best_seg+1||best_seg==j+1)&&absf((float)along-(float)best_along)<=300;
        if(!adjacent&&d<=best+500&&(len<1||absf((dx*hx+dy*hy)/len)>=.7071f)){unavailable(e,o,RC_AMBIGUOUS);return;}
    }
    for(unsigned j=0;j<u16(seg+4);j++){
        if(e->guard_checks>=MAX_GUARDS){unavailable(e,o,RC_WORK);return;}e->guard_checks++;
        uint8_t q[2];if(!read_at(e,u32(seg)+2*j,q,2)||u16(q)>=e->guards||!read_at(e,e->guard_at+16*u16(q),pair,16)){clear_active(e);unavailable(e,o,RC_BYTES);return;}
        float t,dx,dy,d=projection(e,pair,x,y,&t,&dx,&dy),len=root(dx*dx+dy*dy);
        if(d<=best+500&&(len<1||absf((dx*hx+dy*hy)/len)>=.7071f)){unavailable(e,o,RC_AMBIGUOUS);return;}
    }
    e->active=1;e->have_target=1;e->active_row=best_row;e->last_along=best_along;for(unsigned k=0;k<64;k++)e->row[k]=row[k];
    e->projected[0]=i32(best_pair)+(int32_t)(best_t*(float)((int64_t)i32(best_pair+8)-i32(best_pair)));
    e->projected[1]=i32(best_pair+4)+(int32_t)(best_t*(float)((int64_t)i32(best_pair+12)-i32(best_pair+4)));
    /* Expose only the untravelled suffix; first point is the current projection. */
    e->active_seg=best_seg;e->state=RC_RECOVERING;e->reason=RC_OK;o->distance_cm=u32(row+32)>best_along?u32(row+32)-best_along:0;o->points=u16(row+20)-best_seg;o->portal=best_row+1;
    e->overlay=o->points<=in->overlay_points;emit(e,o);
}
int rc_read_point(rc_engine *e,uint32_t index,int32_t point[2]){
    if(!e->active||!e->overlay||e->state!=RC_RECOVERING||index>=u16(e->row+20)-e->active_seg)return 0;
    if(!index){point[0]=e->projected[0];point[1]=e->projected[1];return 1;}
    uint8_t b[8];if(!read_at(e,u32(e->row+16)+8*(e->active_seg+index),b,8)){clear_active(e);e->reason=RC_BYTES;return 0;}point[0]=i32(b);point[1]=i32(b+4);return 1;
}
