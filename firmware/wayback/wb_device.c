/* Way-back device adapter (test layer on cc23). Hook: the literal of tramp_rt (fw.h), which
 * held cc_rt. Runs in the GUI draw path after the route line, one time for each map frame.
 * No writable globals: each off-route frame opens the route file again, mounts the way-back data
 * from its end, draws and closes. Contract and addresses: firmware/wayback/README.md. */
#include "wayback.h"
#include "wb_grey_draw.h"

#define WBD_POINTS 32u              /* line points for each frame */
#define WBD_TIME_US 300000u         /* file work for each frame; a later read fails */
#define WBD_STACK 3968u             /* free stack needed before any file call */
#define WBD_REC 132u                /* open-file table record: handle, then the name */
enum { WBD_LOCK = 6, WBD_NODATA = 7, WBD_STACK_LOW = 8, WBD_OPEN = 9, WBD_HEAP = 11 };   /* after the core reasons 1 to 5 (10 retired) */

/* One frame: file reads, the grey section, its PSRAM buffer and its draw result. */
typedef struct { void *fp; uint32_t base, t0, late, reads, gat, gsize, glines, gcut, nomem; uint8_t *buf; } wbd_ctx;

#include "fw.h"
#include "text.h"

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
static void wbd_text(const char *s) {
  uint16_t col = FW_LABEL_COL; void *cv = FW_CANVAS;
  if (!cv) return;
  FW_LABEL_OPA = 255;
  FW_LABEL_COL = 0xffff; fw_canvas_text(cv, 7, 7, 400, FW_LABEL_DSC, s);
  FW_LABEL_COL = 0; fw_canvas_text(cv, 6, 6, 400, FW_LABEL_DSC, s);
  FW_LABEL_COL = col;
}

/* All file reads of a frame: one time limit, one read count. wbd_read: offsets in the way-back section (the engine);
 * wbd_file: offsets in the file (the grey layer). */
static int wbd_at(wbd_ctx *c, uint32_t off, void *dst, uint32_t n) {
  if (fw_clock() - c->t0 > WBD_TIME_US) { c->late = 1; return 0; }
  if (fw_fseek(c->fp, (int32_t)off, 0) != 0) return 0;
  c->reads++;
  return fw_fread(dst, 1u, n, c->fp) == n;
}
static int wbd_read(void *vctx, uint32_t off, void *dst, uint32_t n) { wbd_ctx *c = (wbd_ctx *)vctx; return wbd_at(c, c->base + off, dst, n); }
static int wbd_file(void *vctx, uint32_t off, void *dst, uint32_t n) { return wbd_at((wbd_ctx *)vctx, off, dst, n); }
static uint32_t le32(const uint8_t *p) { return p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

/* Mounts the data at the file end, runs one tick and reads the line. Returns 0 with n points, or a code. */
static uint32_t wbd_core(wbd_ctx *, uint32_t, uint8_t *, const float *, float *, uint32_t *, uint32_t *);   /* *n bit 31: the line is cut */
/* Trailer v2 (cc27), the last 64 bytes: "CCWS", count 1..4, 4 x {type, offset, size}, file length, 0. One read. The
 * sections must lie before the trailer and must not overlap; a type occurs once; types above 3 are ignored. */
typedef struct { uint32_t at[4], size[4]; } wbd_secs;            /* index = type: 1 way-back, 2 grey, 3 legacy (validated only) */
static int wbd_secs_read(void *fp, wbd_secs *s) {
  uint8_t t[64]; uint32_t i, j, n, total;
  for (i = 0; i < 4u; i++) { s->at[i] = 0; s->size[i] = 0; }
  if (fw_fseek(fp, -64, 2) != 0 || fw_fread(t, 1u, 64u, fp) != 64u || le32(t) != 0x53574343u) return 0;
  n = le32(t + 4); total = le32(t + 56);
  if (n < 1u || n > 4u || total < 64u) return 0;
  for (i = 0; i < n; i++) {
    uint32_t ty = le32(t + 8 + 12 * i), at = le32(t + 12 + 12 * i), sz = le32(t + 16 + 12 * i);
    if (!sz || at > total - 64u || sz > total - 64u - at) return 0;
    for (j = 0; j < i; j++) { uint32_t a2 = le32(t + 12 + 12 * j), s2 = le32(t + 16 + 12 * j); if (at < a2 + s2 && a2 < at + sz) return 0; }
    if (ty >= 1u && ty <= 3u) { if (s->size[ty]) return 0; s->at[ty] = at; s->size[ty] = sz; }
  }
  return 1;
}
/* Mount the sections. The buffer is shared only by the grey reads and draw. */
static __attribute__((noinline)) uint32_t wbd_run(wbd_ctx *c, const float *pos, float *line, uint32_t *n, uint32_t *dm) {
  uint8_t t[16]; wbd_secs sec; uint32_t code;
  if (wb_size() > 128u + 8u * (sizeof(void *) - 4)) return WBD_NODATA;
  if (!wbd_secs_read(c->fp, &sec) || !sec.size[1]) return WBD_NODATA;
  c->base = sec.at[1]; c->gat = sec.at[2]; c->gsize = sec.size[2];
  if (sec.size[2]) {
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

/* Off-route frame: check stack, read switches and position, open the file, draw, close and report. */
static __attribute__((noinline)) void wbd_frame(void) {
  union { char s[128]; float line[2 * WBD_POINTS]; } u;       /* the path until the open, the line points, then the text */
  float pos[2]; char *o = u.s; uint32_t n = 0, dm = 0, code, flags = 0; int found;
  uint32_t mode = 0x00006272u;                                 /* "rb" */
  wbd_ctx c;
  c.t0 = fw_clock(); c.late = 0; c.reads = 0; c.glines = 0; c.gcut = 0; c.nomem = 0; c.buf = 0;
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

/* Replaces cc_rt in tramp_rt. The map frame (fw.h) makes one hooked route call for each frame. */
void wb_rt(uint32_t part) {
  fw_cc_rt(part);
  if (fw_off_route()) wbd_frame();
}
