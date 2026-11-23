// Patch v1: styled map. Replaces the entry iterator (cc_iter) and the branch line function (cc_line); addresses in fw.h.
// Entry field 2 = style. 0: as the original firmware (star lines centre -> each point, grey 8 px + white core).
// Not 0: the entry is a polyline or area [centre, points...]; bits 0-3 class, bits 4-6 level + 2, bit 7 bridge, bit 8 tunnel.
// Projection stays the firmware's (fw_proj in fw.h); the draw operation reaches cc_line through the line descriptor's
// dash fields, which the map layer never uses (bit 15 set = patch operation), and is cleared there.
// cc26 (18 Nov 2026, after a crash in this draw): A, a line or dash piece whose box is outside the canvas plus
// CLIP_M px makes no stock draw call (same pixels); B, cc_iter stops drawing after MAP_FRAME_US in one frame.
#include "fw.h"
#include "raster.h"
#include "text.h"
#include "proj.h"
#define CLIP_M 16                       // > half of the widest line (13 + 2 px) and of a round cap
#define MAP_FRAME_US 400000u             // B: far below the stock watchdog, above any normal frame (not measured)
#ifdef HOST
extern uint32_t host_selection_checks;
#define COUNT_ENTRY() (host_selection_checks++)
#else
#define COUNT_ENTRY() ((void)0)
#endif

enum { C_NONE, C_BUILT, C_GREEN, C_WATER, C_WLINE, C_MAJ, C_MIN, C_SRV, C_PTH, C_RAIL, C_CYC, C_TRAM, C_LABEL, C_SIG, C_STOP };
enum { K_FILL = 1, K_LINE, K_DASH, K_DOT, K_TEXT };
typedef struct { uint8_t kind, width, on, off; uint32_t rgb; } op_t;
#ifdef CC26_AREA2                                          // the second code area has no data: the v21 tables in the base
#define OPS ((const op_t *)FW_V21_OPS)
#else
// "sunlight" palette of the Map Lab (pixel widths)
static const op_t OPS[] = {
  [0] = { 0 },
  [1] = { K_FILL, 0, 0, 0, 0xd4d4d4 },   // built-up
  [2] = { K_FILL, 0, 0, 0, 0xa2d683 },   // green
  [3] = { K_FILL, 0, 0, 0, 0x82cbd5 },   // water area
  [4] = { K_LINE, 3, 0, 0, 0x82cbd5 },   // water line
  [5] = { K_LINE, 10, 0, 0, 0x202326 }, [6] = { K_LINE, 7, 0, 0, 0xffc640 },   // main road edge, core
  [7] = { K_LINE, 8, 0, 0, 0x3d4146 },  [8] = { K_LINE, 5, 0, 0, 0xffffff },   // minor road
  [9] = { K_LINE, 5, 0, 0, 0x6a6e73 },  [10] = { K_LINE, 3, 0, 0, 0xffffff },  // service road
  [11] = { K_DASH, 2, 5, 3, 0x66615a },  // path
  [12] = { K_DASH, 2, 10, 5, 0x202326 }, // rail
  [13] = { K_LINE, 2, 0, 0, 0x7040b0 },  // cycleway
  [14] = { K_LINE, 4, 0, 0, 0x3b1f6e }, [15] = { K_LINE, 2, 0, 0, 0xffffff },  // tram
  [16] = { K_LINE, 13, 0, 0, 0x111111 }, [17] = { K_LINE, 7, 0, 0, 0xffffff },  // turn arrow (arrow.c): edge, core
  [18] = { K_DASH, 2, 2, 3, 0x6b4a2b },  // rough track
  [19] = { K_DOT, 10, 0, 0, 0x111111 }, [20] = { K_DOT, 6, 0, 0, 0xffb300 },   // traffic signal (amber: the route is red)
  [21] = { K_DOT, 10, 0, 0, 0x3b1f6e }, [22] = { K_DOT, 4, 0, 0, 0xffffff },   // tram stop
  [23] = { K_TEXT, 0, 0, 0, 0x000000 },
  [24] = { K_LINE, 1, 0, 0, 0x5f9e45 }, [25] = { K_LINE, 1, 0, 0, 0x378b98 },
  [26] = { K_LINE, 7, 0, 0, 0x111111 }, [27] = { K_LINE, 5, 0, 0, 0xffffff },   // bridge base for paths, cycleways, rail: black, white
  [28] = { K_LINE, 6, 0, 0, 0x7a7e83 }, [29] = { K_LINE, 3, 0, 0, 0xf4f4f4 },   // A2: minor road far from the route: edge, core
  [30] = { K_LINE, 4, 0, 0, 0x9a9ea3 }, [31] = { K_LINE, 2, 0, 0, 0xf4f4f4 },   // A2: service road far from the route
  [32] = { K_DASH, 3, 2, 4, 0x3a2410 },  // A5: rough part of the route, dots over the route line   // green and water outline (Map Lab)  // street name (entry index in dash_gap)
};
#endif
#define F_BRIDGE OP_BRIDGE
#define F_TUNNEL OP_TUNNEL

// ---------- drawing on the canvas ----------
static int sane(const pt_t *p, uint32_t n) {               // the projection leaves garbage after a failed point
  for (uint32_t i = 0; i < n; i++) if (p[i].x < -4000 || p[i].x > 4000 || p[i].y < -4000 || p[i].y > 4000) return i;
  return n;
}
static int outside(const pt_t *p, uint32_t n) {            // A: the box of the points misses the canvas + CLIP_M
  int x0 = p[0].x, x1 = x0, y0 = p[0].y, y1 = y0;
  for (uint32_t i = 1; i < n; i++) { if (p[i].x < x0) x0 = p[i].x; if (p[i].x > x1) x1 = p[i].x; if (p[i].y < y0) y0 = p[i].y; if (p[i].y > y1) y1 = p[i].y; }
  return x1 < -CLIP_M || y1 < -CLIP_M || x0 > FW_CANVAS_W + CLIP_M || y0 > FW_CANVAS_H + CLIP_M;
}
static rs_canvas canvas(void) { rs_canvas c = { FW_CANVAS_BUF, (int16_t)FW_CANVAS_W, (int16_t)FW_CANVAS_H }; return c; }
// w2: width in half pixels (cc28b); only the smooth drawer uses an odd value, the others round it up
static void line(const pt_t *p, uint32_t n, uint16_t col, int w2, uint8_t opa, int own) {   // own: 0 LVGL, 1 raster, 2 smooth
  int w = (w2 + 1) >> 1;
  if (own) { rs_canvas c = canvas(); if (own == 2) rs_line_aa(&c, p, n, w2, col, opa, w2 >= 6); else rs_line(&c, p, n, w, col, opa, w >= 3); return; }
  line_dsc_t *d = FW_LINE_DSC;
  d->color = col; d->width = w; d->opa = opa; d->flags = w >= 3 ? 0x0c : 0; d->dash_width = 0; d->dash_gap = 0;
  fw_draw_line(FW_CANVAS, p, n, d);
}
static void dash(const pt_t *p, uint32_t n, uint16_t col, int w, uint8_t opa, int on, int off, int own) {
  // LVGL 8 dashes only horizontal and vertical lines: cut the polyline into pieces here (whole pixels).
  // 32 bits are exact: cc_line calls sane() first, so |dx|, |dy| <= 8,000, len <= 11,314 and dx * s < 2^27.
  int32_t ph = 0, per = on + off;
  for (uint32_t i = 1; i < n; i++) {
    int32_t dx = p[i].x - p[i - 1].x, dy = p[i].y - p[i - 1].y, len = (int32_t)rs_isqrt((uint32_t)(dx * dx + dy * dy));
    if (!len) continue;
    if (outside(p + i - 1, 2)) { ph = (ph + len) % per; continue; }   // A: same phase, no draw
    for (int32_t s = 0; s < len;) {
      int32_t d;
      if (ph < on) {
        d = on - ph; if (d > len - s) d = len - s;
        pt_t q[2] = { { p[i - 1].x + (int16_t)(dx * s / len), p[i - 1].y + (int16_t)(dy * s / len) },
                      { p[i - 1].x + (int16_t)(dx * (s + d) / len), p[i - 1].y + (int16_t)(dy * (s + d) / len) } };
        if (!outside(q, 2)) line(q, 2, col, w, opa, own);   // A
      } else { d = per - ph; if (d > len - s) d = len - s; }
      s += d; ph += d; if (ph >= per) ph -= per;
    }
  }
}
// Placement and collision rules execute identically in HOST and target builds.
typedef struct { int16_t x0,y0,x1,y1; } label_box_t;
typedef struct { label_box_t boxes[12]; uint8_t count; } label_state_t;
#ifdef HOST
void host_text(int, int, const char *, uint16_t);
#else
static void fw_text(int32_t x,int32_t y,const char *t) { FW_LABEL_OPA=255; fw_canvas_text(FW_CANVAS,x,y,400,FW_LABEL_DSC,t); }
#endif
static void text(pt_t p, uint32_t i, uint16_t col, label_state_t *state) {
  if (state->count >= 12 || (uint32_t)i >= FW_BLK_CNT) return;
  const ent_t *e=&FW_BLK_ENTS[i]; const char *t=(const char *)e->pts;
  uint32_t max=e->cnt*8, nb=0,nc=0;
  if (!t || !max) return;
  while(nb<max && t[nb]) {if((t[nb]&0xc0)!=0x80) nc++;nb++;}
  if(nb>=max || !nc || nc>56) return; // wider than the native canvas
  int w=nc*7+4,x=p.x-w/2,y=p.y-8;
  if(x<1 || x+w>FW_CANVAS_W-1 || y<1 || y+16>FW_CANVAS_H-1) return;
  if(x<90 && y+16>FW_CANVAS_H-100) return;
  label_box_t box={x-3,y-3,x+w+3,y+19};
  for(unsigned j=0;j<state->count;j++) {
    label_box_t b=state->boxes[j];
    if(box.x0<b.x1 && box.x1>b.x0 && box.y0<b.y1 && box.y1>b.y0) return;
  }
  state->boxes[state->count++]=box;
#ifdef HOST
  host_text(x,y,t,col);
#else
  uint16_t old=FW_LABEL_COL; FW_LABEL_COL=0xffff;
  fw_text(x-1,y,t);fw_text(x+1,y,t);fw_text(x,y-1,t);fw_text(x,y+1,t);
  FW_LABEL_COL=col;fw_text(x,y,t);FW_LABEL_COL=old;
#endif
}

// replaces the stock line function (pts, n, width, mode); called by the projection callback with screen points
void cc_line(const pt_t *pts, uint32_t n, int32_t width, int32_t mode) {
  line_dsc_t *d = FW_LINE_DSC;
  uint16_t sel = d->dash_width;
  d->dash_width = 0; d->dash_gap = 0;
  if (!pts) return;
  n = sane(pts, n);
  if (n && (sel & 0xff) != 23 && outside(pts, n)) { d->opa = 255; d->flags = 0; return; }   // A (23: label anchor)
  if (!(sel & OP_PATCH)) {                                    // original: grey edge, white core
    line(pts, n, fw_color_hex(mode == 1 ? 0xc86d : mode == 2 ? 0xc8d0de : 0x1f78ff), width * 2, 255, 0);
    line(pts, n, 0xffff, (width - 4) * 2, 255, 0);
  } else {
    const op_t *o = &OPS[sel & 0xff];
    int own = sel & OP_OWN ? (sel & OP_AA ? 2 : 1) : 0;
    uint8_t opa = sel & F_TUNNEL ? 115 : 255, op = sel & 0xff;
    int w2 = o->width * 2 - (own == 2 && (op == 11 || op == 18));   // cc28b smooth: path, track 1.5 px; cc28d: cycleway 2.0 px
    if (o->kind == K_TEXT) {
      // Stock callback only frees its projected buffer after cc_line returns.
      // Report the anchor to cc_iter; placement state remains on its stack.
      if(n) {d->color=(uint16_t)pts[0].x;d->width=pts[0].y;d->dash_gap=1;}
    }
    else if (o->kind == K_DOT) { if (n) { pt_t q[2] = { pts[0], { (int16_t)(pts[0].x + 1), pts[0].y } }; line(q, 2, fw_color_hex(o->rgb), w2, 255, own); } }
    else if (o->kind == K_FILL) { rs_canvas c = canvas(); rs_fill(&c, pts, n, fw_color_hex(o->rgb)); }
    else if (o->kind == K_DASH) dash(pts, n, fw_color_hex(o->rgb), w2, opa, o->on, o->off, own);
    else if (sel & F_BRIDGE) line(pts, n, 0, w2 + 4, 255, own);   // bridge edge: black, wider
    else if ((sel & F_TUNNEL) && ((sel & 0xff) == 5 || (sel & 0xff) == 7 || (sel & 0xff) == 9)) dash(pts, n, fw_color_hex(o->rgb), w2, 255, 3, 2, own);   // tunnel edge: dashed
    else line(pts, n, fw_color_hex(o->rgb), w2, opa, own);
  }
  d->opa = 255; d->flags = 0;                               // as set up by the firmware
}

// ---------- entry iterator ----------
// draw passes: [class, op, op for a bridge edge pass (0 = none)]; done for each level -2..2 except fills and water lines
typedef struct { uint8_t cls, op; } pass_t;
#define N_FILLS 4u
#define N_LEVEL 11u
#ifdef CC26_AREA2
#define FILLS ((const pass_t *)FW_V21_FILLS)
#define LEVEL ((const pass_t *)FW_V21_LEVEL)
#else
static const pass_t FILLS[] = { { C_BUILT, 1 }, { C_GREEN, 2 }, { C_WATER, 3 }, { C_WLINE, 4 } };
static const pass_t LEVEL[] = { { C_RAIL, 12 }, { C_PTH, 11 }, { C_CYC, 13 },
  { C_SRV, 9 }, { C_MIN, 7 }, { C_MAJ, 5 },                 // edges of all roads first, so junctions merge
  { C_SRV, 10 }, { C_MIN, 8 }, { C_MAJ, 6 }, { C_TRAM, 14 }, { C_TRAM, 15 } };
#endif

// Bounds preserve entry order even for arbitrary unsorted legacy blocks.
// 4 fills + 7 road classes * 5 levels + interleaved symbols + labels.
typedef struct { uint16_t first,end; } entry_range_t;   // cc27: 16 bits keep cc_iter at 352 B (cc28: 368 B; 512 B frame rule)
static int bucket(uint32_t s) {
  unsigned c=s&15,lv=(s>>4)&7;
  if(c>=1 && c<=4) return c-1;
  if(c>=5 && c<=11 && lv<=4) return 4+(c-5)*5+lv;
  if(c==C_SIG || c==C_STOP) return 39;
  return c==C_LABEL ? 40 : -1;
}
static int16_t rnd(float v) { if (v > 32000.0f) v = 32000.0f; if (v < -32000.0f) v = -32000.0f; return (int16_t)(v >= 0 ? (int)(v + 0.5f) : -(int)(0.5f - v)); }
// cc28b F_PROJ: the stock screen point of (lat, lon) through the label anchor path of cc_line; 1 = got it
static int probe(proj_cb_t cb, int32_t lat, int32_t lon, int16_t *x, int16_t *y) {
  const float k = 180.0f / 2147483648.0f; float b[2] = { (float)lat * k, (float)lon * k };
  line_dsc_t *d = FW_LINE_DSC; uint16_t oc = d->color; int16_t ow = d->width; int ok;
  d->dash_width = (int16_t)(OP_PATCH | OP_ANCHOR); d->dash_gap = 0; cb(b, 1);
  ok = d->dash_gap; *x = (int16_t)d->color; *y = d->width;
  d->dash_gap = 0; d->color = oc; d->width = ow;
  return ok;
}
// Reference: an entry the stock projection reaches; then the canvas centre from it; 9 probes around the centre at
// irregular steps (other pixel fractions). 0 = no own projection in this frame (the stock path draws it).
static __attribute__((noinline)) int own_setup(proj_cb_t cb, const ent_t *E, uint32_t cnt, proj_t *p) {
  int z = FW_PROJ_ZOOM, rot = FW_PROJ_ROT; int16_t sx[9], sy[9]; int32_t ll[18], u; uint32_t i, j;
  if (z < 1 || z > 22) return 0;
  u = 1 << (24 - z);                                                     // map units per pixel
  for (i = 0, j = 0; j < 8 && i < cnt; j++, i += cnt / 8 + 1) if (probe(cb, E[i].lat, E[i].lon, sx, sy)) break;
  if (j == 8 || i >= cnt || !proj_setup(p, z, FW_MAP_HEAD, rot, E[i].lat, E[i].lon, sx[0], sy[0])) return 0;
  {                                                                      // the lat, lon of the canvas centre
    float det = p->ax * p->by - p->bx * p->ay, dx = (float)FW_CANVAS_W * 0.5f - p->x0, dy = (float)FW_CANVAS_H * 0.5f - p->y0;
    if (det == 0.0f) return 0;
    det = proj_recip(det);
    float dn = (dx * p->by - dy * p->bx) * det, dl = (dy * p->ax - dx * p->ay) * det;
    if (dn > 1e9f || dn < -1e9f || dl > 1e9f || dl < -1e9f) return 0;
    proj_setup(p, z, FW_MAP_HEAD, rot, E[i].lat + (int32_t)dl, E[i].lon + (int32_t)dn, 0, 0);
  }
  for (i = 0; i < 9; i++) {
    ll[2 * i] = p->lat0 + ((int32_t)i * 23 - 90) * u * 5 / 8; ll[2 * i + 1] = p->lon0 + ((int32_t)i * 22 - 90) * u;
    if (!probe(cb, ll[2 * i], ll[2 * i + 1], sx + i, sy + i)) return 0;
  }
  proj_fit(p, 9, ll, sx, sy);
  return 1;
}
// F_TEXT with F_PROJ: the largest difference (px, at most 9) to the stock projection at 4 entry points
static __attribute__((noinline)) int own_check(proj_cb_t cb, const ent_t *E, uint32_t cnt, const proj_t *p) {
  int m = 0; int16_t x, y; float ox, oy;
  for (uint32_t j = 0; j < 4; j++) {
    const ent_t *e = &E[cnt * j / 4];
    if (!probe(cb, e->lat, e->lon, &x, &y)) continue;
    proj_xy(p, e->lat, e->lon, &ox, &oy);
    int d = rnd(ox) - x, f = rnd(oy) - y; if (d < 0) d = -d; if (f < 0) f = -f; if (f > d) d = f; if (d > m) m = d;
  }
  return m > 9 ? 9 : m;
}
static void draw_entry(proj_cb_t cb, const ent_t *e, uint16_t sel, float *buf, const proj_t *p) {
  const float k = 180.0f / 2147483648.0f;
  if (p) {                                                               // cc28b F_PROJ: own points, then cc_line directly
    pt_t *q = (pt_t *)buf; float x, y;
    proj_xy(p, e->lat, e->lon, &x, &y); q[0].x = rnd(x); q[0].y = rnd(y);
    for (uint32_t i = 0; i < e->cnt; i++) { proj_xy(p, e->pts[2 * i], e->pts[2 * i + 1], &x, &y); q[1 + i].x = rnd(x); q[1 + i].y = rnd(y); }
    FW_LINE_DSC->dash_width = (int16_t)(OP_PATCH | sel);
    cc_line(q, e->cnt + 1, 0, 0);
    return;
  }
  buf[0] = (float)e->lat * k; buf[1] = (float)e->lon * k;
  for (uint32_t i = 0; i < e->cnt; i++) { buf[2 + 2 * i] = (float)e->pts[2 * i] * k; buf[3 + 2 * i] = (float)e->pts[2 * i + 1] * k; }
  FW_LINE_DSC->dash_width = (int16_t)(OP_PATCH | sel);
  cb(buf, e->cnt + 1);
}
// cc27 F_TEXT: the time of cc_iter in ms at (6, 24), white shadow then black (the adapter text is at (6, 6))
// cc28b: " c<k>" when the stop came before pass k (1 fills, 2..6 levels 0..4, 7 signals, 8 names)
static void map_time(uint32_t ms, uint32_t cut, int pd, int far, uint32_t fms) {   // pd: F_PROJ check " p<d>", -1 = none; far: wb_far result
  char s[24], *o = s;
  *o++ = 'm'; o = tx_num(o, ms);
  if (cut) { *o++ = ' '; *o++ = 'c'; *o++ = (char)('0' + cut); }
  if (pd >= 0) { *o++ = ' '; *o++ = 'p'; *o++ = (char)('0' + pd); }
  if (far >= 0) { *o++ = ' '; *o++ = 'f'; o = tx_num(o, fms); if (far) *o++ = '+'; }   // far map ms; '+': it stopped
  *o = 0;
#ifdef HOST
  host_text(6, 24, s, 0);
#else
  uint16_t old = FW_LABEL_COL;
  FW_LABEL_COL = 0xffff; fw_text(7, 25, s);
  FW_LABEL_COL = 0; fw_text(6, 24, s);
  FW_LABEL_COL = old;
#endif
}
// Pass 0: the range of each bucket and the largest point count; the original star lines (style 0) until the stop.
// *late = 1 when the stop came in this pass.
static uint32_t scan(proj_cb_t cb, const ent_t *E, uint32_t cnt, entry_range_t ranges[41], uint32_t t0, uint32_t *late) {
  const float k = 180.0f / 2147483648.0f; uint32_t big = 0;
  for (uint32_t i = 0; i < cnt; i++, COUNT_ENTRY()) {
    const ent_t *e = &E[i];
    int b = bucket(e->style);
    if (b >= 0) { if (ranges[b].first == cnt) ranges[b].first = i; ranges[b].end = i + 1; }
    if (e->style) { if (e->cnt > big) big = e->cnt; continue; }
    if (!*late && fw_clock() - t0 > MAP_FRAME_US) *late = 1;
    for (uint32_t j = 0; j < e->cnt && !*late; j++) {      // original star line: centre -> point j
      float l[4] = { (float)e->lat * k, (float)e->lon * k, (float)e->pts[2 * j] * k, (float)e->pts[2 * j + 1] * k };
      FW_LINE_DSC->dash_width = 0; cb(l, 2);
    }
  }
  return big;
}
// Pass 1: the area fills. An outline stays with its fill entry.
static void draw_fills(proj_cb_t cb, const ent_t *E, const entry_range_t *ranges, uint16_t own, float *buf, const proj_t *P) {
  for (uint32_t f = 0; f < N_FILLS; f++)
    for (uint32_t i = ranges[f].first; i < ranges[f].end; i++, COUNT_ENTRY()) if (E[i].style && (E[i].style & 15) == FILLS[f].cls) {
      draw_entry(cb, &E[i], FILLS[f].op | own, buf, P);
      if ((FILLS[f].cls == C_GREEN || FILLS[f].cls == C_WATER) && !(E[i].style & 0x400)) draw_entry(cb, &E[i], (FILLS[f].cls == C_GREEN ? 24 : 25) | (own & ~OP_AA), buf, P);   // cc28d: plain 1 px outline
    }
}
// Passes 2..6: the roads, rails and paths of level lv (edges of all roads first, so junctions merge).
static void draw_level(proj_cb_t cb, const ent_t *E, const entry_range_t *ranges, uint16_t own, float *buf, const proj_t *P, int lv) {
  for (uint32_t f = 0; f < N_LEVEL; f++)
    for (uint32_t i = ranges[4+(LEVEL[f].cls-5)*5+lv].first; i < ranges[4+(LEVEL[f].cls-5)*5+lv].end; i++, COUNT_ENTRY()) {
      uint32_t s = E[i].style;
      if (!s || (s & 15) != LEVEL[f].cls || (int)((s >> 4) & 7) != lv) continue;
      uint8_t op = LEVEL[f].op == 11 && (s & 0x200) ? 18 : LEVEL[f].op;
      if (s & 0x800) op = op == 7 ? 28 : op == 8 ? 29 : op == 9 ? 30 : op == 10 ? 31 : op;   // A2: far from the route
      uint16_t sel = op | (s & 0x100 ? F_TUNNEL : 0) | own;
      int edge = LEVEL[f].op == 5 || LEVEL[f].op == 7 || LEVEL[f].op == 9;
      if (edge && (s & 0x80)) sel |= F_BRIDGE;
      uint8_t c = s & 15;                                // F2: a path, cycleway or rail bridge gets a solid base
      if ((s & 0x80) && (c == C_PTH || c == C_CYC || c == C_RAIL)) { draw_entry(cb, &E[i], 26 | own, buf, P); draw_entry(cb, &E[i], 27 | own, buf, P); }
      draw_entry(cb, &E[i], sel, buf, P);
    }
}
// Pass 7: traffic signals and tram stops: edge, core.
static void draw_stops(proj_cb_t cb, const ent_t *E, const entry_range_t *r, uint16_t own, float *buf, const proj_t *P) {
  for (uint32_t i = r->first; i < r->end; i++, COUNT_ENTRY()) {
    uint32_t c = E[i].style & 15;
    if (c == C_SIG || c == C_STOP) { draw_entry(cb, &E[i], (c == C_SIG ? 19 : 21) | own, buf, P); draw_entry(cb, &E[i], (c == C_SIG ? 20 : 22) | own, buf, P); }
  }
}
// Pass 8: street names: anchor only, text from the entry.
static void draw_names(proj_cb_t cb, const ent_t *E, const entry_range_t *r, const proj_t *P) {
  label_state_t labels; labels.count = 0;
  for (uint32_t i = r->first; i < r->end; i++, COUNT_ENTRY()) if ((E[i].style & 15) == C_LABEL) {
    if (P) { float x, y; proj_xy(P, E[i].lat, E[i].lon, &x, &y); pt_t q = { rnd(x), rnd(y) }; text(q, i, fw_color_hex(OPS[23].rgb), &labels); continue; }
    pt_t q; if (probe(cb, E[i].lat, E[i].lon, &q.x, &q.y)) text(q, i, fw_color_hex(OPS[23].rgb), &labels);
  }
}
// Far map (23 Nov, firmware/wayback/wb_far.c): drawn first, under the detail map, before the block lock.
#ifdef HOST
static int far_map(proj_cb_t cb, uint32_t *ms) { (void)cb; *ms = 0; return -1; }
#else
int wb_far(int (*anchor)(void *, const int32_t *, pt_t *), void *actx, uint32_t *ms);
// ll: E7; probe takes the map unit (2^31 = 180 degrees): x 2^31 / 1.8e9 = 1.1930465 = 5,004,011 / 2^22.
static int32_t far_mu(int32_t e7) { return (int32_t)(((int64_t)e7 * 5004011) >> 22); }
static int far_anchor(void *ctx, const int32_t *ll, pt_t *s) { return probe((proj_cb_t)ctx, far_mu(ll[0]), far_mu(ll[1]), &s->x, &s->y); }
static int far_map(proj_cb_t cb, uint32_t *ms) { return wb_far(far_anchor, (void *)cb, ms); }
#endif
void cc_iter(proj_cb_t cb) {
  uint32_t fms; int far = far_map(cb, &fms);
  fw_blk_lock();
  uint32_t cnt = FW_BLK_CNT, t0 = fw_clock(); ent_t *E = FW_BLK_ENTS;
  if (cnt > 0xFFFFu) cnt = 0xFFFFu;                            // the ranges hold 16 bits (a 64 KB block has fewer entries)
  uint32_t flags = blk_flags(E, cnt);                         // cc27: the last entry, 0 without it (cc26)
  uint16_t own = (flags & F_OWN ? OP_OWN | (flags & F_AA ? OP_AA : 0) : 0);   // F_CYC 16 (cc28b) and 32 (F_NODRAW, 23 Nov): retired
  // cc27: the stop (B, MAP_FRAME_US: the rest of this frame is not drawn) is checked only between passes, so a road
  // never shows its edge without its core. cut = the pass before which it came.
#define STOP(k) if (fw_clock() - t0 > MAP_FRAME_US) { cut = (k); goto done; }
  uint32_t cut = 0; int pd = -1; proj_t pj; const proj_t *P = 0;
  entry_range_t ranges[41];
  for (unsigned r = 0; r < 41; r++) { ranges[r].first = cnt; ranges[r].end = 0; }
  if (cnt && E) {
    uint32_t late = 0, big = scan(cb, E, cnt, ranges, t0, &late);
    float *buf = big && !late ? fw_malloc((big + 1) * 8, CAPS_PSRAM) : 0;
    if (late) cut = 1;
    if (buf && (flags & F_PROJ) && own && own_setup(cb, E, cnt, &pj)) { P = &pj; if (flags & F_TEXT) pd = own_check(cb, E, cnt, P); }
    if (buf) {
      STOP(1) draw_fills(cb, E, ranges, own, buf, P);
      for (int lv = 0; lv <= 4; lv++) { STOP(2 + lv) draw_level(cb, E, ranges, own, buf, P, lv); }
      STOP(7) draw_stops(cb, E, &ranges[39], own, buf, P);
      STOP(8) draw_names(cb, E, &ranges[40], P);
    done:
      fw_free(buf);
    }
    FW_LINE_DSC->dash_width = 0;
  }
  if (flags & F_TEXT) map_time((fw_clock() - t0) / 1000u, cut, pd, far, fms);
  fw_blk_unlock();
}
