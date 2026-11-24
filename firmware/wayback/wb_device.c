/* Way-back device adapter (test layer on cc23). Hook: the literal of tramp_rt (fw.h), which
 * held cc_rt. Runs in the GUI draw path after the route line, one time for each map frame.
 * No writable globals: each off-route frame opens the route file again, mounts the way-back data
 * from its end, draws and closes. Contract and addresses: firmware/wayback/README.md. */
#include "wayback.h"
#include "wb_grey_draw.h"
#include "wb_far.h"
#include "wb_cache.h"
#include "elev.h"
#include "elev_font.h"

#define WBD_POINTS 32u              /* line points for each frame */
#define WBD_TIME_US 300000u         /* file work for each frame; a later read fails */
#define WBD_STACK 3968u             /* free stack needed before any file call */
#define WBD_REC 132u                /* open-file table record: handle, then the name */
enum { WBD_LOCK = 6, WBD_NODATA = 7, WBD_STACK_LOW = 8, WBD_OPEN = 9, WBD_HEAP = 11 };   /* after the core reasons 1 to 5 (10 retired) */

/* One frame: file reads, the grey section, its PSRAM buffer and its draw result. */
typedef struct { void *fp; uint32_t base, t0, late, reads, io, gat, gsize, glines, gcut, nomem; uint8_t *buf; wc_cache *wc; } wbd_ctx;

#include "fw.h"
#include "text.h"
/* WP 5 and WP 7 (24 Nov): the page cache stays across frames behind one RAM word (WP 4, WBD_KEEP: its address). Without
 * WBD_KEEP there is no cache and every read goes to the file, as before. A failed PSRAM allocation: no cache. */
#ifdef WBD_KEEP
#ifdef HOST
extern void *host_keep;
#endif
static wc_cache *wbd_keep(void) { wc_cache **k = (wc_cache **)WBD_KEEP; if (!*k) *k = (wc_cache *)fw_malloc(WC_BYTES, CAPS_PSRAM); return *k; }
#endif

static uint32_t wbd_pos(float *pos) {                                     /* as cc_rt: never wait for the lock */
  void *sem = FW_NAV_SEM; uint32_t ok;
  if (!sem || fw_take(sem, 0) <= 0) return 0;
  ok = fw_cc_pos(pos);
  fw_nav_give();
  return ok;
}
/* Path of the first open route file, from the open-file table of the firmware. 1 = found, 0 = none, -1 = lock busy. */
static int wbd_path(char *name) {
  void *sem = FW_FILE_SEM; int found = 0; uint32_t t, k; int32_t i, cnt;
  if (!sem || fw_take(sem, 0) <= 0) return -1;
  cnt = FW_FILE_CNT;
  for (t = 0; t < 6u && !found; t++) {
    void *fp = FW_ROUTE_FP[t];
    if (!fp) continue;
    for (i = 0; i < cnt && i < 20 && !found; i++) {
      const uint8_t *r = FW_FILE_TAB + (uint32_t)i * WBD_REC, *q = (const uint8_t *)&fp;
      for (k = 0; k < sizeof fp && r[k] == q[k]; k++) {}
      if (k < sizeof fp) continue;
      r += sizeof fp;
      for (k = 0; k < 127u && r[k]; k++) name[k] = (char)r[k];
      name[k] = 0; found = k > 0u;
    }
  }
  fw_file_give(sem);
  return found;
}
static void wbd_line(const float *p, uint32_t n, int op) { FW_DASH = (int16_t)(OP_PATCH | op); fw_proj(p, n); FW_DASH = 0; }
/* The switches of the current map block (types.h): read under the block lock, the lock of cc_iter. */
static uint32_t wbd_flags(void) { uint32_t f; fw_blk_lock(); f = blk_flags(FW_BLK_ENTS, FW_BLK_CNT); fw_blk_unlock(); return f; }
static void wbd_text_at(const char *s, int32_t y) {
  uint16_t col = FW_LABEL_COL; void *cv = FW_CANVAS;
  if (!cv) return;
  FW_LABEL_OPA = 255;
  FW_LABEL_COL = 0xffff; fw_canvas_text(cv, 7, y + 1, 400, FW_LABEL_DSC, s);
  FW_LABEL_COL = 0; fw_canvas_text(cv, 6, y, 400, FW_LABEL_DSC, s);
  FW_LABEL_COL = col;
}
static void wbd_text(const char *s) { wbd_text_at(s, 6); }

/* All file reads of a frame: one time limit, one read count. wbd_read: offsets in the way-back section (the engine);
 * wbd_file: offsets in the file (the grey layer). */
static int wbd_raw(void *vctx, uint32_t off, void *dst, uint32_t n) {   /* one file read: r and i of the text */
  wbd_ctx *c = (wbd_ctx *)vctx; uint32_t t = fw_clock(); int ok = fw_fseek(c->fp, (int32_t)off, 0) == 0 && fw_fread(dst, 1u, n, c->fp) == n;
  c->reads++; c->io += fw_clock() - t;                         /* WP 1: the file time of the frame */
  return ok;
}
static int wbd_at(wbd_ctx *c, uint32_t off, void *dst, uint32_t n) {
  if (fw_clock() - c->t0 > WBD_TIME_US) { c->late = 1; return 0; }
#ifdef WBD_KEEP
  if (c->wc) return wc_read(c->wc, wbd_raw, c, off, dst, n);
#endif
  return wbd_raw(c, off, dst, n);
}
static int wbd_read(void *vctx, uint32_t off, void *dst, uint32_t n) { wbd_ctx *c = (wbd_ctx *)vctx; return wbd_at(c, c->base + off, dst, n); }
static int wbd_file(void *vctx, uint32_t off, void *dst, uint32_t n) { return wbd_at((wbd_ctx *)vctx, off, dst, n); }

/* Mounts the data at the file end, runs one tick and reads the line. Returns 0 with n points, or a code. */
static uint32_t wbd_core(wbd_ctx *, uint32_t, uint8_t *, const float *, float *, uint32_t *, uint32_t *);   /* *n bit 31: the line is cut */
/* Trailer v2 (cc27), the last 64 bytes: "CCWS", count 1..4, 4 x {type, offset, size}, file length, 0. One read. The
 * sections must lie before the trailer and must not overlap; a type occurs once; types above 4 are ignored. */
typedef struct { uint32_t at[5], size[5], key, total; } wbd_secs;   /* key: FNV-1a of the trailer (WP 5 cache key) */            /* index = type: 1 way-back, 2 grey, 3 elevation (the chart), 4 far map */
static int wbd_secs_read(void *fp, wbd_secs *s) {
  uint8_t t[64]; uint32_t i, j, n, total;
  for (i = 0; i < 5u; i++) { s->at[i] = 0; s->size[i] = 0; }
  if (fw_fseek(fp, -64, 2) != 0 || fw_fread(t, 1u, 64u, fp) != 64u || wb_u32(t) != 0x53574343u) return 0;
  n = wb_u32(t + 4); total = wb_u32(t + 56);
#ifdef WBD_KEEP
  for (s->key = 2166136261u, i = 0; i < 64u; i++) s->key = (s->key ^ t[i]) * 16777619u;
  s->key |= 1u; s->total = total;
#endif
  if (n < 1u || n > 4u || total < 64u) return 0;
  for (i = 0; i < n; i++) {
    uint32_t ty = wb_u32(t + 8 + 12 * i), at = wb_u32(t + 12 + 12 * i), sz = wb_u32(t + 16 + 12 * i);
    if (!sz || at > total - 64u || sz > total - 64u - at) return 0;
    for (j = 0; j < i; j++) { uint32_t a2 = wb_u32(t + 12 + 12 * j), s2 = wb_u32(t + 16 + 12 * j); if (at < a2 + s2 && a2 < at + sz) return 0; }
    if (ty >= 1u && ty <= 4u) { if (s->size[ty]) return 0; s->at[ty] = at; s->size[ty] = sz; }
  }
  return 1;
}
/* Mount the sections. The buffer is shared only by the grey reads and draw. */
static __attribute__((noinline)) uint32_t wbd_run(wbd_ctx *c, const float *pos, float *line, uint32_t *n, uint32_t *dm) {
  uint8_t t[16]; wbd_secs sec; uint32_t code;
  if (wb_size() > 128u + 8u * (sizeof(void *) - 4)) return WBD_NODATA;
  if (!wbd_secs_read(c->fp, &sec) || !sec.size[1]) return WBD_NODATA;
#ifdef WBD_KEEP
  if ((c->wc = wbd_keep()) != 0) wc_reset(c->wc, sec.key, sec.total);
#endif
  c->base = sec.at[1]; c->gat = sec.at[2]; c->gsize = sec.size[2];
  if (sec.size[2] && !sec.size[4]) {                         /* far map (23 Nov): it draws the far streets in cc_iter */
    c->buf = (uint8_t *)fw_malloc(GL_BUF, CAPS_PSRAM);
    c->nomem = !c->buf;
  }
  code = wbd_core(c, sec.size[1], t, pos, line, n, dm);
  if (c->buf) fw_free(c->buf);
  return code;
}
/* Grey streets (cc27, design 8.5). The view comes from 4 anchors: op 23 through the stock projection, cc_line gives the
 * screen point back in color and width and sets dash_gap = 1 (map.c). Then every line of the screen cells is drawn
 * with the raster, under the way-back line. A failed anchor, a bad heading, a bad layer or a read error: no more grey in
 * this frame; the way-back line stays. */
static int wbd_anchor(const wb_grid *g, uint32_t ux, uint32_t uy, pt_t *s) {
  line_dsc_t *d = FW_LINE_DSC; uint16_t col = d->color; int16_t w = d->width; int32_t e[2]; float p[2]; int ok;
  wb_point(g, ux, uy, e);
  p[0] = (float)e[0] * 1e-7f; p[1] = (float)e[1] * 1e-7f;
  d->dash_gap = 0; FW_DASH = (int16_t)(OP_PATCH | OP_ANCHOR);
  fw_proj(p, 1u);
  ok = d->dash_gap == 1; s->x = (int16_t)d->color; s->y = d->width;
  d->color = col; d->width = w; d->dash_gap = 0; FW_DASH = 0;
  return ok;
}
static int wbd_view(const wb_grid *g, uint32_t x, uint32_t y, vw_t *v) {
  pt_t s[4]; uint32_t i;
  for (i = 0; i < 4u; i++) if (!wbd_anchor(g, x + (i & 1u) * (uint32_t)VW_REF, y + (i >> 1) * (uint32_t)VW_REF, &s[i])) return 0;
  return vw_fit(v, (int32_t)x, (int32_t)y, s);
}
static void wbd_grey(wbd_ctx *c, const wb_engine *e, int32_t lat, int32_t lon) {
  wb_grid g; vw_t v; gl_layer l; gd_stat st; rs_canvas cv; uint32_t x, y; float head = FW_MAP_HEAD;
  if (!c->buf || !(head >= -360.0f && head <= 720.0f)) return;   /* no grey section, or NaN or a bad heading */
  wb_grid_get(e, &g);
  cv.buf = FW_CANVAS_BUF; cv.w = (int16_t)FW_CANVAS_W; cv.h = (int16_t)FW_CANVAS_H;
  if (!cv.buf || !wb_units(&g, lat, lon, &x, &y) || !wbd_view(&g, x, y, &v)) return;
  if (!gl_open(&l, wbd_file, c, c->gat, c->gsize, c->buf)) return;
  c->gcut = !grey_draw(&l, &cv, &v, x, y, (uint32_t)(int32_t)(810.5f - head) % 360u, &st);   /* course + 360, rounded */
  c->glines = st.lines;
}
static uint32_t wbd_core(wbd_ctx *cp, uint32_t i, uint8_t *t, const float *pos, float *line, uint32_t *n, uint32_t *dm) {
  uint32_t store[32 + 2 * (sizeof(void *) - 4)]; wb_engine *e = (wb_engine *)store;   /* 128 B on the device */
  wb_input in; wb_output out; int32_t p[2]; uint32_t k;
  if (!wbd_read(cp, 8u, t, 16u)) return WB_READ;              /* identity: the data is inside its route file */
  for (k = 0; k < sizeof store / 4u; k++) store[k] = 0;
  if (!wb_mount(e, wbd_read, cp, i, t)) return cp->late ? WB_READ : WBD_NODATA;
  in.lat_e7 = (int32_t)(pos[0] * 1e7f); in.lon_e7 = (int32_t)(pos[1] * 1e7f);
  in.exit_progress_cm = 0; in.flags = WB_GPS_VALID | WB_OFF_ROUTE;   /* no trusted exit on the device: tree A values */
  wb_tick(e, &in, &out);
  if (out.state != WB_LINE) return out.reason ? out.reason : WB_READ;
  for (i = 0; i < WBD_POINTS && wb_read_point(e, i, p); i++) { line[2 * i] = (float)p[0] * 1e-7f; line[2 * i + 1] = (float)p[1] * 1e-7f; }
  if (i < 2u) return WB_READ;                                  /* a failed read: draw nothing */
  *n = i; *dm = out.distance_dm;
  if (i == WBD_POINTS && wb_read_point(e, WBD_POINTS, p)) *n |= 0x80000000u;   /* more points: the first 32 from the rider, text '+' */
  wbd_grey(cp, e, in.lat_e7, in.lon_e7);                       /* after the line points: a slow grey never costs the line */
  return 0;
}

/* Far map (23 Nov): called at the start of cc_iter, before the block lock, in every map frame. Opens the route file,
 * draws section 4 under the detail map, closes. anchor: the screen point of (lat, lon) E7 through the map projection.
 * Returns -1 = no far map (no section, no position, busy lock, low stack), else the fm_stat stop (0 = all drawn).
 * WP 1 (24 Nov) ms[9]: f total, s setup (open, trailer, header, anchors), r reads, i file ms, d draw ms; then the draw
 * split: F fill ms, L line ms, A areas, N lines. */
#define FAR_US 150000u                 /* 24 Nov: emergency stop only (WP 1 photos: setup 25-49 ms left too few cells) */
typedef int (*wbd_anchor_fn)(void *ctx, const int32_t ll[2], pt_t *s);
static uint32_t wbd_clock(void) { return fw_clock(); }
int wb_far(wbd_anchor_fn anchor, void *actx, uint32_t ms[9]) {
  char name[128]; float pos[2]; wbd_ctx c; wbd_secs sec; fm_layer f; fm_stat st; vw_t v; pt_t s[4]; rs_canvas cv;
  uint32_t x, y, i, mode = 0x00006272u, ts = 0, is = 0; int rc = -1, found; float head = FW_MAP_HEAD;
  c.t0 = fw_clock(); c.late = 0; c.reads = 0; c.io = 0; c.buf = 0; c.wc = 0;
  for (i = 0; i < 9u; i++) ms[i] = 0;
  if (fw_stack() < WBD_STACK || !wbd_pos(pos) || (found = wbd_path(name)) <= 0) return -1;
  if (!(c.fp = fw_fopen(name, (const char *)&mode))) return -1;
  found = wbd_secs_read(c.fp, &sec);                          /* the trailer: 11-17 ms (24 Nov probe: a read at the file start costs the same) */
#ifdef WBD_KEEP
  if (found && (c.wc = wbd_keep()) != 0) wc_reset(c.wc, sec.key, sec.total);
#endif
  if (found && sec.size[4] && head >= -360.0f && head <= 720.0f && (c.buf = (uint8_t *)fw_malloc(GL_BUF, CAPS_PSRAM)) &&
      fm_open(&f, wbd_file, &c, sec.at[4], sec.size[4], c.buf) && fm_units(&f, (int32_t)(pos[0] * 1e7f), (int32_t)(pos[1] * 1e7f), &x, &y)) {
    for (i = 0; i < 4u; i++) {
      int32_t ll[2];
      fm_point(&f, (int32_t)(x + (i & 1u) * (uint32_t)VW_REF), (int32_t)(y + (i >> 1) * (uint32_t)VW_REF), ll);
      if (!anchor(actx, ll, &s[i])) break;
    }
    cv.buf = FW_CANVAS_BUF; cv.w = (int16_t)FW_CANVAS_W; cv.h = (int16_t)FW_CANVAS_H;
    if (i == 4u && cv.buf && vw_fit(&v, (int32_t)x, (int32_t)y, s)) {
      ts = fw_clock(); is = c.io;                              /* s: open, trailer, header, anchors (24 Nov: o3-5 t11-17 h3-6 a0) */
      fm_draw(&f, &cv, &v, x, y, (uint32_t)(int32_t)(810.5f - head) % 360u, wbd_clock, c.t0, FAR_US, &st);
      rc = (int)st.stop;
      ms[4] = (fw_clock() - ts - (c.io - is)) / 1000u;         /* d: draw less its file time */
      ms[5] = st.fill_us / 1000u; ms[6] = st.line_us / 1000u; ms[7] = st.areas; ms[8] = st.lines;
      ms[1] = (ts - c.t0) / 1000u;
    }
  }
  if (c.buf) fw_free(c.buf);
  fw_fclose(c.fp);
  ms[0] = (fw_clock() - c.t0) / 1000u;
  ms[2] = c.reads; ms[3] = c.io / 1000u;
  return rc;
}

/* Off-route frame: check stack, read switches and position, open the file, draw, close and report. */
static __attribute__((noinline)) void wbd_frame(void) {
  union { char s[128]; float line[2 * WBD_POINTS]; } u;       /* the path until the open, the line points, then the text */
  float pos[2]; char *o = u.s; uint32_t n = 0, dm = 0, code, flags = 0; int found;
  uint32_t mode = 0x00006272u;                                 /* "rb" */
  wbd_ctx c;
  c.t0 = fw_clock(); c.late = 0; c.reads = 0; c.io = 0; c.glines = 0; c.gcut = 0; c.nomem = 0; c.buf = 0; c.wc = 0;
  if (fw_stack() < WBD_STACK) code = WBD_STACK_LOW;            /* before the block lock and any file call */
  else {
    flags = wbd_flags();
    if (!wbd_pos(pos)) code = WB_GPS;
    else if ((found = wbd_path(u.s)) <= 0) code = found ? WBD_LOCK : WBD_NODATA;
    else if (!(c.fp = fw_fopen(u.s, (const char *)&mode))) code = WBD_OPEN;
    else { code = wbd_run(&c, pos, u.line, &n, &dm); fw_fclose(c.fp); }
  }
  if (code) { *o++ = 'w'; *o++ = 'b'; o = tx_num(o, code); }
  else {
    int own = flags & F_OWN ? OP_OWN : 0;
    wbd_line(u.line, n & 0xffu, own | 17);                     /* white 7 px, then dark purple 4 px, over the grey */
    wbd_line(u.line, n & 0xffu, own | 14);                     /* the text below overwrites the points after this */
    if (dm == WB_DIST_UNKNOWN) *o++ = '?'; else o = tx_num(o, dm / 10u);   /* metres */
    *o++ = 'm';
    if (n >> 31) *o++ = '+';                                   /* only the first 32 points are drawn */
  }
  if (flags & F_TEXT) {
    *o++ = ' '; *o++ = 'w';
    o = tx_num(o, (fw_clock() - c.t0) / 1000u);               /* file and core time of this frame, ms */
    *o++ = ' '; *o++ = 'r';
    o = tx_num(o, c.reads);                                 /* file reads of this frame */
    *o++ = ' ';
    if (c.nomem) { *o++ = 'w'; *o++ = 'b'; o = tx_num(o, WBD_HEAP); }   /* no heap buffer: no grey */
    else { *o++ = 'g'; o = tx_num(o, c.glines); if (c.gcut) *o++ = '+'; }   /* grey lines; '+': not all lines */
  }
  *o = 0;
  wbd_text(u.s);
}

/* Stock progress admission (design section 7): selector 0, a finite total below 2^24 m, 0 < U <= T + 50 m (U clamped
 * to T: the start-of-ride gap), own map blocks. *u = remaining m, *t = total m. Returns 0 = trusted, else the first
 * failed check (the km reason code): 4 selector, 5 total, 6 U = 0, 7 U > T + 50 m, 8 no F_OWN. *f = the block flags. */
static int wbd_why(uint32_t *u, uint32_t *t, uint32_t *f) {
  float total = FW_ROUTE_TOTAL; uint32_t left = FW_ROUTE_LEFT;
  *f = wbd_flags();
  if (FW_NAV_SELECTOR != 0u) return 4;
  if (!(total >= 0.0f && total < 16777216.0f)) return 5;   /* NaN fails */
  *t = (uint32_t)total;
  if (left == 0u) return 6;
  if (left > *t + 50u) return 7;
  *u = left > *t ? *t : left;
  return (*f & F_OWN) ? 0 : 8;
}

/* F_TEXT test text of the stock fallback (one row below the map time): "k<code> u<U> t<T>", the raw stock values. WBD_KM_WHY only
 * (24 Nov: off for code room; the km reason study of 23 Nov is done). */
#ifdef WBD_KM_WHY
static __attribute__((noinline)) void wbd_km_why(int why, uint32_t t) {
  char s[40], *o = s;
  *o++ = 'k'; o = tx_num(o, (uint32_t)why);
  *o++ = ' '; *o++ = 'u'; o = tx_num(o, FW_ROUTE_LEFT);
  *o++ = ' '; *o++ = 't'; if (why == 4 || why == 5) *o++ = '?'; else o = tx_num(o, t);
  *o = 0;
  wbd_text_at(s, 42);
}
#endif

/* One text in the font f, right-aligned at r, with a 1 px white halo (4 draws) and the dark text on top. Returns
 * the right edge for the next text: its left edge less the gap g. Offsets (dx, dy) + 1 packed 2 bits each. */
static __attribute__((noinline)) int32_t wbd_put(void *cv, void *f, int32_t y, int32_t r, int32_t g, const char *s) {
  uint32_t k, o = 0x59164u;                                               /* (0,1) (2,1) (1,0) (1,2) (1,1) */
  FW_LABEL_FONT = f;
  for (k = 0; k < 5u; k++, o >>= 4) {
    FW_LABEL_COL = k < 4u ? 0xffffu : RS_RGB(0x111316u);
    fw_canvas_text(cv, (int32_t)(o & 3u) - 1, y + (int32_t)((o >> 2) & 3u) - 1, r, FW_LABEL_DSC, s);
  }
  return r - el_text_w(f == FW_FONT_NUM, s) - g;
}

/* Remaining distance and climb ahead (design 5): unit right edge x 232, number 3 px left of it; the climb on its own
 * line above, right edge x 232, top y 197. The label descriptor is restored. */
static void wbd_km_text(void *cv, uint32_t rem, uint32_t climb) {
  char num[8], unit[3], cl[8];
  void *font = FW_LABEL_FONT; uint16_t col = FW_LABEL_COL; uint8_t opa = FW_LABEL_OPA, align = FW_LABEL_ALIGN;
  int32_t r;
  el_fmt_dist(num, unit, rem); el_fmt_climb(cl, climb);
  FW_LABEL_OPA = 255; FW_LABEL_ALIGN = 3;
  r = wbd_put(cv, FW_FONT_UNIT, 217, 232, 3, unit);
  wbd_put(cv, FW_FONT_NUM, 215, r, 0, num);
  if (cl[0]) wbd_put(cv, FW_FONT_UNIT, 197, 232, 0, cl);
  FW_LABEL_FONT = font; FW_LABEL_COL = col; FW_LABEL_OPA = opa; FW_LABEL_ALIGN = align;
}

/* The target of the trampoline km_tramp (firmware/wayback/km_tramp.S): the map frame calls it in place of the
 * stock remaining-distance overlay fw_km_overlay (fw.h), with the same 4 arguments. Normal: the lens chart (firmware/elev) and
 * the text. Trusted progress but no usable elevation section: the plain progress line and the text. Any other state
 * (the stock second mode show_text 0, low stack, untrusted progress, no canvas): the stock overlay, unchanged. */
void wb_km(int32_t left, int32_t total, int32_t bar_w, int32_t show_text) {
  char path[128]; wbd_secs sec; el_head h; el_view v; rs_canvas cv; wbd_ctx c;
  uint32_t u = 0, tm = 0, len, tol, k0 = 0, nb, climb = 0, fl = 0, mode = 0x00006272u;   /* "rb" */
  void *canvas = FW_CANVAS;
  int drawn = 0, why = 0;
  cv.buf = FW_CANVAS_BUF; cv.w = (int16_t)FW_CANVAS_W; cv.h = (int16_t)FW_CANVAS_H;
  if (!show_text || fw_stack() < WBD_STACK || !canvas || !cv.buf || cv.w < 240 || cv.h < 256 || (why = wbd_why(&u, &tm, &fl)) != 0) {
    fw_km_overlay(left, total, bar_w, show_text);
#ifdef WBD_KM_WHY
    if (fl & F_TEXT) wbd_km_why(why, tm);                     /* fl is set only when the admission ran */
#endif
    return;
  }
  c.buf = 0; c.fp = 0; c.wc = 0;
  if (wbd_path(path) > 0 && (c.fp = fw_fopen(path, (const char *)&mode)) != 0) {
    c.t0 = fw_clock(); c.late = 0; c.reads = 0;
    if (wbd_secs_read(c.fp, &sec) && sec.size[3] >= EL_HEAD2 && (c.buf = (uint8_t *)fw_malloc(GL_BUF, CAPS_PSRAM)) != 0 &&
        wbd_file(&c, sec.at[3], c.buf, EL_HEAD2) && el_head_parse(&h, c.buf)) {
      len = h.len_cm / 100u; tol = len / 100u > 50u ? len / 100u : 50u;
      v.h = &h; v.coarse = c.buf + 16; v.blk = c.buf + EL_HEAD2; v.len_m = len; v.prog_m = len > u ? len - u : 0u;
      nb = el_blocks_for(&h, v.prog_m, &k0);
      v.k0 = k0; v.nblk = nb;
      if ((tm > len ? tm - len : len - tm) <= tol && nb && EL_HEAD2 + (k0 + nb) * EL_BLOCK <= sec.size[3] &&
          wbd_file(&c, sec.at[3] + EL_HEAD2 + k0 * EL_BLOCK, c.buf + EL_HEAD2, nb * EL_BLOCK)) {
        el_draw(&cv, &v); climb = el_climb(&v); drawn = 1;
      }
    }
  }
  if (!drawn) el_plain(&cv, tm, tm - u);
  wbd_km_text(canvas, u, climb);
  if (c.buf) fw_free(c.buf);
  if (c.fp) fw_fclose(c.fp);
}

/* Replaces cc_rt in tramp_rt. The map frame (fw.h) makes one hooked route call for each frame. */
void wb_rt(uint32_t part) {
  fw_cc_rt(part);
  if (fw_off_route()) wbd_frame();
}
