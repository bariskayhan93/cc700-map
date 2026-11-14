/* Actual map.c dispatch, fill and label-placement probe; stock projection,
 * line rasterization, and glyph drawing remain explicit host fixtures. */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include "fw.h"

void cc_iter(proj_cb_t);
void cc_line(const pt_t *, uint32_t, int32_t, int32_t);
line_dsc_t host_dsc;
void *host_canvas = (void *)1;
uint16_t *host_buf, host_w = 240, host_h = 256;
uint32_t host_cnt, host_selection_checks;
ent_t *host_ents;
static unsigned locks, unlocks, held, callbacks, draws, allocations, fail_alloc, projected_points;
static unsigned live_bytes, peak_bytes;
static unsigned failed_projection, labels, label_mode;
static pt_t input_anchors[256];
static int32_t input_names[256][64];
static unsigned accepted[12];
static int accepted_boxes[12][4];
static uint64_t trace=1469598103934665603ULL;
void host_text(int x,int y,const char *t,uint16_t col) {
  (void)col;
  unsigned slot=labels%12;
  unsigned nc=0;
  for(const unsigned char *q=(const unsigned char *)t;*q;q++) if((*q&0xc0)!=0x80) nc++;
  for(unsigned i=0;i<host_cnt;i++) if((const char *)host_ents[i].pts==t) {accepted[slot]=i;break;}
  accepted_boxes[slot][0]=x-3;accepted_boxes[slot][1]=y-3;
  accepted_boxes[slot][2]=x+(int)nc*7+7;accepted_boxes[slot][3]=y+19;
  labels++;
}
static void hash(unsigned v) {trace=(trace^v)*1099511628211ULL;}
static int32_t shape[] = {-4000,-4000, -4000,4000, 4000,4000, 4000,-4000};
static int32_t long_shape[120];

static void require(int ok, const char *why) {
  if (!ok) {fprintf(stderr, "%s\n", why); exit(3);}
}
uint16_t host_color_hex(uint32_t c) {
  return ((c >> 8) & 0xf800) | ((c >> 5) & 0x7e0) | ((c >> 3) & 0x1f);
}
void host_nop(void) {
  if (held) {unlocks++; held = 0;} else {locks++; held = 1;}
}
void *host_malloc(uint32_t n, uint32_t caps) {
  require(held && caps == CAPS_PSRAM && !live_bytes, "allocation contract");
  allocations++;
  if (fail_alloc) return 0;
  void *p = malloc(n);
  require(p != 0, "host out of memory");
  live_bytes = n;
  if (n > peak_bytes) peak_bytes = n;
  return p;
}
void host_free(void *p) {require(held && live_bytes, "free contract"); free(p); live_bytes = 0;}
void host_draw_line(void *canvas, const pt_t *p, uint32_t n, const line_dsc_t *d) {
  require(held && canvas == host_canvas && p && d, "draw contract");
  /* Rasterizer is a stub. Actual polygon fills write the canvas in map.c. */
  draws++;
  hash(d->color);hash((uint16_t)d->width);hash(d->opa);hash(d->flags);hash(n);
  for(unsigned i=0;i<n;i++){hash((uint16_t)p[i].x);hash((uint16_t)p[i].y);}
  for (unsigned i=0; i<n; i++) require(p[i].x>=-4000 && p[i].x<=4000, "unclean projection");
}
static void project(const float *ll, uint32_t n) {
  require(held && ll && n <= 61, "projection contract");
  pt_t projected[61];
  for (unsigned i=0; i<n; i++) {
    projected[i].x = (int16_t)(120 + ll[2*i+1] * 100000);
    projected[i].y = (int16_t)(128 - ll[2*i] * 100000);
  }
  if(label_mode && n==1) {
    unsigned i=callbacks%20;
    projected[0]=(pt_t){120,128};
    if(label_mode==2) projected[0]=(pt_t){25+50*(i%4),25+30*(i/4)};
    if(label_mode==3) projected[0]=(pt_t){0,128};
    if(label_mode==4) projected[0]=(pt_t){30,200};
    if(label_mode==5) projected[0]=(pt_t){120+17*(i%2),128};
    if(label_mode==6) projected[0]=input_anchors[callbacks];
  }
  if (failed_projection && n>1) projected[1].x=5000;
  hash((uint16_t)host_dsc.dash_width);hash(n);
  for(unsigned j=0;j<2*n;j++){uint32_t bits;memcpy(&bits,ll+j,4);hash(bits);}
  callbacks++;
  projected_points+=n;
  cc_line(projected, n, 8, 2);
}
int main(int argc, char **argv) {
  require(argc == 2, "case required");
  const char *which = argv[1];
  if(!strcmp(which,"fill_json")) {
    unsigned n,w,h;require(scanf("%u%u%u",&n,&w,&h)==3 && n<=128 && w>0 && w<=240 && h>0 && h<=256,"fill input");
    pt_t points[128];
    for(unsigned i=0;i<n;i++){int x,y;require(scanf("%d%d",&x,&y)==2 && x>=-4000 && x<=4000 && y>=-4000 && y<=4000,"point input");points[i]=(pt_t){x,y};}
    host_w=w;host_h=h;host_buf=calloc(w*h,sizeof(uint16_t));require(host_buf!=0,"canvas");
    host_nop();host_dsc.dash_width=0x8002;cc_line(points,n,0,0);host_nop();
    printf("{\"mask\":\"");
    for(unsigned i=0;i<w*h;i++) putchar(host_buf[i]?'1':'0');
    printf("\"}\n");free(host_buf);return 0;
  }
  unsigned frames = 1, n = 0;
  if(!strcmp(which,"labels_json")) {
    label_mode=6;require(scanf("%u",&n)==1 && n<=256,"labels input");
    for(unsigned i=0;i<n;i++) {
      int x,y;char hex[511];require(scanf("%d%d%510s",&x,&y,hex)==3 && strlen(hex)%2==0,"label input");
      input_anchors[i]=(pt_t){x,y};
      for(unsigned j=0;j<strlen(hex)/2;j++){unsigned b;require(sscanf(hex+2*j,"%2x",&b)==1,"hex input");((char *)input_names[i])[j]=b;}
    }
  }
  else if (!strcmp(which,"styles")) {n = 16*5*4; frames = 3;}
  else if (!strcmp(which,"oom")) {n = 2; fail_alloc = 1;}
  else if (!strcmp(which,"dense1201")) n = 1201;
  else if (!strcmp(which,"dense4000")) n = 4000;
  else if (!strcmp(which,"mixed")) n=1024;
  else if (!strncmp(which,"labels",6)) {
    n=30;label_mode=1;
    if(!strcmp(which,"labels_cap")) {n=20;frames=3;label_mode=2;}
    if(!strcmp(which,"labels_edge")) {n=1;label_mode=3;}
    if(!strcmp(which,"labels_hud")) {n=1;label_mode=4;}
    if(!strcmp(which,"labels_touch")) {n=2;label_mode=5;}
  }
  else if (!strcmp(which,"geometry60")) n=1;
  else if (!strcmp(which,"failed_projection")) {n=1;failed_projection=1;}
  else require(!strcmp(which,"empty") || !strcmp(which,"unloaded") || !strcmp(which,"hole") || !strcmp(which,"hole_reverse"), "unknown case");
  unsigned pixels = host_w * host_h;
  uint16_t *guarded = malloc((pixels+2)*sizeof(uint16_t));
  require(guarded != 0, "canvas allocation");
  guarded[0] = guarded[pixels+1] = 0xbeef;
  host_buf = guarded+1;
  memset(host_buf,0,pixels*2);
  host_ents = calloc(n ? n : 1,sizeof(ent_t));
  require(host_ents != 0, "entry allocation");
  host_cnt = n;
  for (unsigned i=0; i<n; i++) {
    unsigned style = 6 | (2<<4);
    if (!strcmp(which,"styles")) {
      unsigned cls = i%16, level = (i/16)%5, flags = i/(16*5);
      style = cls ? cls | (level<<4) | ((flags&1)?0x80:0) | ((flags&2)?0x100:0) : 0;
    }
    if (fail_alloc && i==0) style=0;
    if (!strcmp(which,"mixed")) {unsigned v=(i*2654435761u)^0xdeadbeef;style=(v>>8)&0xfff; if(i%17==0)style=0;}
    if (!strncmp(which,"labels",6)) style=12;
    host_ents[i] = (ent_t){i,style,4000,-4000,4,shape};
  }
  if (!strncmp(which,"labels",6)) {
    static int32_t names[2]={0x0041,0};
    for(unsigned i=0;i<n;i++){host_ents[i].pts=names;host_ents[i].cnt=1;host_ents[i].lat=0;host_ents[i].lon=0;}
    if(!strcmp(which,"labels_unterminated")) names[0]=names[1]=0x41414141;
    if(label_mode==6) for(unsigned i=0;i<n;i++) {host_ents[i].pts=input_names[i];host_ents[i].cnt=32;}
  }
  if (!strcmp(which,"geometry60")) {
    for (unsigned i=0;i<60;i++) {
      unsigned side=i/15, t=i%15;
      long_shape[2*i]=side==0?-4000:side==1?-4000+533*t:side==2?4000:4000-533*t;
      long_shape[2*i+1]=side==0?-4000+533*t:side==1?4000:side==2?4000-533*t:-4000;
    }
    host_ents[0].style=2|(2<<4);host_ents[0].cnt=60;host_ents[0].pts=long_shape;
  }
  if (!strcmp(which,"unloaded")) {host_cnt=4000; free(host_ents); host_ents=0;}
  if(!strncmp(which,"hole",4)) {
    pt_t ring[]={{10,10},{60,10},{60,60},{10,60},{10,10},{20,23},{20,43},{40,43},{40,23},{20,23},{10,10}};
    if(!strcmp(which,"hole_reverse")) for(unsigned i=0;i<11/2;i++){pt_t t=ring[i];ring[i]=ring[10-i];ring[10-i]=t;}
    host_nop();host_dsc.dash_width=0x8002;cc_line(ring,11,0,0);host_nop();
  }
  for (unsigned frame=0; frame<frames; frame++) cc_iter(project);
  if(!strncmp(which,"hole",4)) for(unsigned y=0;y<host_h;y++) for(unsigned x=0;x<host_w;x++) {
    unsigned expected=x>=10 && x<60 && y>=10 && y<60 && !(x>=20 && x<40 && y>=23 && y<43);
    require((host_buf[y*host_w+x]!=0)==expected,"hole pixel mismatch");
  }
  if(label_mode==6) {
    printf("{\"accepted\":[");for(unsigned i=0;i<labels;i++)printf("%s%u",i?",":"",accepted[i]);
    printf("],\"boxes\":[");for(unsigned i=0;i<labels;i++)printf("%s[%d,%d,%d,%d]",i?",":"",accepted_boxes[i][0],accepted_boxes[i][1],accepted_boxes[i][2],accepted_boxes[i][3]);
    printf("]}\n");free(host_ents);free(guarded);return 0;
  }
  unsigned painted=0;
  for (unsigned i=0;i<pixels;i++) painted += host_buf[i]!=0;
  printf("{\"locks\":%u,\"unlocks\":%u,\"callbacks\":%u,\"draws\":%u,"
         "\"allocations\":%u,\"peak_bytes\":%u,\"live_bytes\":%u,"
         "\"selection_checks\":%u,\"labels\":%u,\"trace\":%llu,\"guard_changed\":%u,\"painted\":%u,\"projected_points\":%u}\n",locks,unlocks,callbacks,draws,
         allocations,peak_bytes,live_bytes,host_selection_checks,labels,(unsigned long long)trace,
         guarded[0]!=0xbeef || guarded[pixels+1]!=0xbeef,painted,projected_points);
  free(host_ents); free(guarded);
  require(!held && !live_bytes,"leaked renderer state");
  return 0;
}
