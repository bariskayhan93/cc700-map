// Patch v1: styled map. Replaces the entry iterator 0x42049670 (cc_iter) and the branch line function 0x4205bd90 (cc_line).
// Entry field 2 = style. 0: as the original firmware (star lines centre -> each point, grey 8 px + white core).
// Not 0: the entry is a polyline or area [centre, points...]; bits 0-3 class, bits 4-6 level + 2, bit 7 bridge, bit 8 tunnel.
// Projection stays the firmware's (callback 0x4204c1bc); the draw operation reaches cc_line through the line descriptor's
// dash fields, which the map layer never uses (bit 15 set = patch operation), and is cleared there.
// cc26 (18 Nov 2026, after a crash in this draw): A, a line or dash piece whose box is outside the canvas plus
// CLIP_M px makes no stock draw call (same pixels); B, cc_iter stops drawing after MAP_FRAME_US in one frame.
#include "fw.h"
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
#define OPS ((const op_t *)0x3c1ddf40)
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
#define F_BRIDGE 0x100
#define F_TUNNEL 0x200

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
static void line(const pt_t *p, uint32_t n, uint16_t col, int w, uint8_t opa) {
  line_dsc_t *d = FW_LINE_DSC;
  d->color = col; d->width = w; d->opa = opa; d->flags = w >= 3 ? 0x0c : 0; d->dash_width = 0; d->dash_gap = 0;
  fw_draw_line(FW_CANVAS, p, n, d);
}
static uint32_t isqrt(uint32_t v) { uint32_t r = 0, b = 1u << 30; while (b > v) b >>= 2;
  while (b) { if (v >= r + b) { v -= r + b; r = (r >> 1) + b; } else r >>= 1; b >>= 2; } return r; }
static void dash(const pt_t *p, uint32_t n, uint16_t col, int w, uint8_t opa, int on, int off) {
  // LVGL 8 dashes only horizontal and vertical lines: cut the polyline into pieces here (16.16 fixed point)
  int32_t ph = 0, per = (on + off) << 16;
  for (uint32_t i = 1; i < n; i++) {
    int32_t dx = p[i].x - p[i - 1].x, dy = p[i].y - p[i - 1].y; int32_t len = isqrt(dx * dx + dy * dy) << 16;
    if (!len) continue;
    if (outside(p + i - 1, 2)) { ph = (int32_t)(((uint32_t)ph + (uint32_t)len) % (uint32_t)per); continue; }   // A: same phase, no draw
    for (int32_t s = 0; s < len;) {
      int32_t d;
      if (ph < (on << 16)) {
        d = (on << 16) - ph; if (d > len - s) d = len - s;
        pt_t q[2] = { { p[i - 1].x + (int16_t)(((int64_t)dx * s) / len), p[i - 1].y + (int16_t)(((int64_t)dy * s) / len) },
                      { p[i - 1].x + (int16_t)(((int64_t)dx * (s + d)) / len), p[i - 1].y + (int16_t)(((int64_t)dy * (s + d)) / len) } };
        if (!outside(q, 2)) line(q, 2, col, w, opa);   // A
      } else { d = per - ph; if (d > len - s) d = len - s; }
      s += d; ph += d; if (ph >= per) ph -= per;
    }
  }
}
static void fill(const pt_t *p, uint32_t n, uint16_t col) {   // even-odd scanline fill straight into the canvas buffer
  uint16_t *buf = FW_CANVAS_BUF; int W = FW_CANVAS_W, H = FW_CANVAS_H;
  if (!buf || n < 3) return;
  int y0 = 1 << 30, y1 = -(1 << 30);
  for (uint32_t i = 0; i < n; i++) { if (p[i].y < y0) y0 = p[i].y; if (p[i].y > y1) y1 = p[i].y; }
  if (y0 < 0) y0 = 0;
  if (y1 > H - 1) y1 = H - 1;
  int16_t xs[128];
  for (int y = y0; y <= y1; y++) {
    int k = 0;
    for (uint32_t i = 0, j = n - 1; i < n; j = i++) {
      int ya = p[j].y, yb = p[i].y;
      if ((ya > y) == (yb > y) || k >= 128) continue;
      int xa=p[j].x, xb=p[i].x;
      if(ya>yb) {int t=ya;ya=yb;yb=t;t=xa;xa=xb;xb=t;}
      int dy=yb-ya, den=2*dy;
      int num=2*xa*dy+(xb-xa)*(2*(y-ya)+1)-dy;
      int x=num/den+(num>0 && num%den!=0); // ceil, independent of edge direction
      int m = k++; while (m > 0 && xs[m - 1] > x) { xs[m] = xs[m - 1]; m--; } xs[m] = x;
    }
    // Cancel equal crossings: doubled hole bridges have zero parity.
    int odd=0;
    for(int m=0;m<k;m++) {if(odd && xs[odd-1]==xs[m]) odd--; else xs[odd++]=xs[m];}
    k=odd;
    uint16_t *row = buf + y * W;
    for (int m = 0; m + 1 < k; m += 2) {
      int a = xs[m] < 0 ? 0 : xs[m], b = xs[m + 1] > W ? W : xs[m + 1];
      for (int x = a; x < b; x++) row[x] = col;
    }
  }
}

// Placement and collision rules execute identically in HOST and target builds.
typedef struct { int16_t x0,y0,x1,y1; } label_box_t;
typedef struct { label_box_t boxes[12]; uint8_t count; } label_state_t;
#ifdef HOST
void host_text(int, int, const char *, uint16_t);
#else
#define fw_canvas_text ((void (*)(void *, int32_t, int32_t, int32_t, void *, const char *))0x420dbcd0)
#define FW_LABEL_DSC ((void *)0x3c38a570)
#define FW_LABEL_OPA (*(volatile uint8_t *)(0x3c38a570 + 26))
#define FW_LABEL_COL (*(volatile uint16_t *)(0x3c38a570 + 12))
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

// replaces 0x4205bd90(pts, n, width, mode); called by the projection callback with screen points
void cc_line(const pt_t *pts, uint32_t n, int32_t width, int32_t mode) {
  line_dsc_t *d = FW_LINE_DSC;
  uint16_t sel = d->dash_width;
  d->dash_width = 0; d->dash_gap = 0;
  if (!pts) return;
  n = sane(pts, n);
  if (n && (sel & 0xff) != 23 && outside(pts, n)) { d->opa = 255; d->flags = 0; return; }   // A (23: label anchor)
  if (!(sel & 0x8000)) {                                    // original: grey edge, white core
    line(pts, n, fw_color_hex(mode == 1 ? 0xc86d : mode == 2 ? 0xc8d0de : 0x1f78ff), width, 255);
    line(pts, n, 0xffff, width - 4, 255);
  } else {
    const op_t *o = &OPS[sel & 0xff];
    uint8_t opa = sel & F_TUNNEL ? 115 : 255;
    if (o->kind == K_TEXT) {
      // Stock callback only frees its projected buffer after cc_line returns.
      // Report the anchor to cc_iter; placement state remains on its stack.
      if(n) {d->color=(uint16_t)pts[0].x;d->width=pts[0].y;d->dash_gap=1;}
    }
    else if (o->kind == K_DOT) { if (n) { pt_t q[2] = { pts[0], { (int16_t)(pts[0].x + 1), pts[0].y } }; line(q, 2, fw_color_hex(o->rgb), o->width, 255); } }
    else if (o->kind == K_FILL) fill(pts, n, fw_color_hex(o->rgb));
    else if (o->kind == K_DASH) dash(pts, n, fw_color_hex(o->rgb), o->width, opa, o->on, o->off);
    else if (sel & F_BRIDGE) line(pts, n, 0, o->width + 2, 255);   // bridge edge: black, wider
    else if ((sel & F_TUNNEL) && ((sel & 0xff) == 5 || (sel & 0xff) == 7 || (sel & 0xff) == 9)) dash(pts, n, fw_color_hex(o->rgb), o->width, 255, 3, 2);   // tunnel edge: dashed
    else line(pts, n, fw_color_hex(o->rgb), o->width, opa);
  }
  d->opa = 255; d->flags = 0;                               // as set up by the firmware
}

// ---------- entry iterator ----------
// draw passes: [class, op, op for a bridge edge pass (0 = none)]; done for each level -2..2 except fills and water lines
typedef struct { uint8_t cls, op; } pass_t;
#define N_FILLS 4u
#define N_LEVEL 11u
#ifdef CC26_AREA2
#define FILLS ((const pass_t *)0x3c1ddf36)
#define LEVEL ((const pass_t *)0x3c1ddf20)
#else
static const pass_t FILLS[] = { { C_BUILT, 1 }, { C_GREEN, 2 }, { C_WATER, 3 }, { C_WLINE, 4 } };
static const pass_t LEVEL[] = { { C_RAIL, 12 }, { C_PTH, 11 }, { C_CYC, 13 },
  { C_SRV, 9 }, { C_MIN, 7 }, { C_MAJ, 5 },                 // edges of all roads first, so junctions merge
  { C_SRV, 10 }, { C_MIN, 8 }, { C_MAJ, 6 }, { C_TRAM, 14 }, { C_TRAM, 15 } };
#endif

// Bounds preserve entry order even for arbitrary unsorted legacy blocks.
// 4 fills + 7 road classes * 5 levels + interleaved symbols + labels.
typedef struct { uint32_t first,end; } entry_range_t;
static int bucket(uint32_t s) {
  unsigned c=s&15,lv=(s>>4)&7;
  if(c>=1 && c<=4) return c-1;
  if(c>=5 && c<=11 && lv<=4) return 4+(c-5)*5+lv;
  if(c==C_SIG || c==C_STOP) return 39;
  return c==C_LABEL ? 40 : -1;
}
static void draw_entry(proj_cb_t cb, const ent_t *e, uint16_t sel, float *buf) {
  const float k = 180.0f / 2147483648.0f;
  buf[0] = (float)e->lat * k; buf[1] = (float)e->lon * k;
  for (uint32_t i = 0; i < e->cnt; i++) { buf[2 + 2 * i] = (float)e->pts[2 * i] * k; buf[3 + 2 * i] = (float)e->pts[2 * i + 1] * k; }
  FW_LINE_DSC->dash_width = (int16_t)(0x8000 | sel);
  cb(buf, e->cnt + 1);
}
void cc_iter(proj_cb_t cb) {
  fw_blk_lock();
  uint32_t cnt = FW_BLK_CNT, t0 = fw_clock(); ent_t *E = FW_BLK_ENTS;
#define LATE() (fw_clock() - t0 > MAP_FRAME_US)                  // B: the rest of this frame is not drawn
  label_state_t labels; labels.count=0;
  entry_range_t ranges[41];
  for(unsigned r=0;r<41;r++) {ranges[r].first=cnt;ranges[r].end=0;}
  if (cnt && E) {
    const float k = 180.0f / 2147483648.0f; uint32_t big = 0, late = 0;
    for (uint32_t i = 0; i < cnt; i++, COUNT_ENTRY()) {
      const ent_t *e = &E[i];
      int b=bucket(e->style);
      if(b>=0) {if(ranges[b].first==cnt) ranges[b].first=i;ranges[b].end=i+1;}
      if (e->style) { if (e->cnt > big) big = e->cnt; continue; }
      if (!late && LATE()) late = 1;
      for (uint32_t j = 0; j < e->cnt && !late; j++) {      // original star line: centre -> point j
        float l[4] = { (float)e->lat * k, (float)e->lon * k, (float)e->pts[2 * j] * k, (float)e->pts[2 * j + 1] * k };
        FW_LINE_DSC->dash_width = 0; cb(l, 2);
      }
    }
    float *buf = big && !late ? fw_malloc((big + 1) * 8, CAPS_PSRAM) : 0;
    if (buf) {
      for (uint32_t f = 0; f < N_FILLS; f++)
        for (uint32_t i = ranges[f].first; i < ranges[f].end; i++, COUNT_ENTRY()) if (E[i].style && (E[i].style & 15) == FILLS[f].cls) {
          if (LATE()) goto done;
          draw_entry(cb, &E[i], FILLS[f].op, buf);
          if ((FILLS[f].cls == C_GREEN || FILLS[f].cls == C_WATER) && !(E[i].style & 0x400)) draw_entry(cb, &E[i], FILLS[f].cls == C_GREEN ? 24 : 25, buf);
        }
      for (int lv = 0; lv <= 4; lv++)
        for (uint32_t f = 0; f < N_LEVEL; f++)
          for (uint32_t i = ranges[4+(LEVEL[f].cls-5)*5+lv].first; i < ranges[4+(LEVEL[f].cls-5)*5+lv].end; i++, COUNT_ENTRY()) {
            uint32_t s = E[i].style;
            if (!s || (s & 15) != LEVEL[f].cls || (int)((s >> 4) & 7) != lv) continue;
            uint8_t op = LEVEL[f].op == 11 && (s & 0x200) ? 18 : LEVEL[f].op;
            if (s & 0x800) op = op == 7 ? 28 : op == 8 ? 29 : op == 9 ? 30 : op == 10 ? 31 : op;   // A2: far from the route
            uint16_t sel = op | (s & 0x100 ? F_TUNNEL : 0);
            int edge = LEVEL[f].op == 5 || LEVEL[f].op == 7 || LEVEL[f].op == 9;
            if (edge && (s & 0x80)) sel |= F_BRIDGE;
            if (LATE()) goto done;
            uint8_t c = s & 15;                                // F2: a path, cycleway or rail bridge gets a solid base
            if ((s & 0x80) && (c == C_PTH || c == C_CYC || c == C_RAIL)) { draw_entry(cb, &E[i], 26, buf); draw_entry(cb, &E[i], 27, buf); }
            draw_entry(cb, &E[i], sel, buf);
          }
      for (uint32_t i = ranges[39].first; i < ranges[39].end; i++, COUNT_ENTRY()) {                    // traffic signals and tram stops: edge, core
        uint32_t c = E[i].style & 15;
        if (LATE()) goto done;
        if (c == C_SIG || c == C_STOP) { draw_entry(cb, &E[i], c == C_SIG ? 19 : 21, buf); draw_entry(cb, &E[i], c == C_SIG ? 20 : 22, buf); }
      }
      for (uint32_t i = ranges[40].first; i < ranges[40].end; i++, COUNT_ENTRY()) if ((E[i].style & 15) == C_LABEL) {   // street names: anchor only, text from the entry
        if (LATE()) goto done;
        buf[0] = (float)E[i].lat * k; buf[1] = (float)E[i].lon * k;
        uint16_t old_color=FW_LINE_DSC->color; int16_t old_width=FW_LINE_DSC->width;
        FW_LINE_DSC->dash_width = (int16_t)(0x8000 | 23); FW_LINE_DSC->dash_gap = 0; cb(buf, 1);
        if(FW_LINE_DSC->dash_gap) {
          pt_t p={(int16_t)FW_LINE_DSC->color,FW_LINE_DSC->width};
          FW_LINE_DSC->dash_gap=0;text(p,i,fw_color_hex(OPS[23].rgb),&labels);
        }
        FW_LINE_DSC->color=old_color;FW_LINE_DSC->width=old_width;
      }
    done:
      fw_free(buf);
    }
    FW_LINE_DSC->dash_width = 0;
  }
  fw_blk_unlock();
}
