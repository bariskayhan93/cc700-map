/* Way-back device adapter (test layer on cc23). Hook: the literal of tramp_rt (0x420496b8), which
 * held cc_rt. Runs in the GUI draw path after the route line, one time for each map frame.
 * No writable globals: each off-route frame opens the route file again, mounts the way-back data
 * from its end, draws and closes. Contract and addresses: firmware/wayback/README.md. */
#include "wayback.h"
#include "wb_grey.h"

#define WBD_POINTS 32u              /* line points for each frame */
#ifndef WBD_GREY_SEGS
#define WBD_GREY_SEGS 400u         /* grey segments of one frame (R-D3); the host build with 3 tests the cap */
#endif
#define WBD_GREY_US 60000u          /* the grey draw stops this long after the frame start */
#define WBD_TIME_US 300000u         /* file work for each frame; a later read fails */
#define WBD_STACK 3360u             /* free stack needed before any file call */
#define WBD_REC 132u                /* open-file table record: handle, then the name */
enum { WBD_LOCK = 6, WBD_NODATA = 7, WBD_STACK_LOW = 8, WBD_OPEN = 9, WBD_LINE_CAP = 10 };   /* codes after the core reasons 1 to 5 */

typedef struct { void *fp; uint32_t base, t0, late, reads; } wbd_ctx;

#ifdef HOST
void host_cc_rt(uint32_t);
uint32_t host_cc_pos(float *);
uint32_t host_off_route(void);
uint32_t host_stack(void);
uint32_t host_clock(void);
void *host_fopen(const char *, const char *);
int host_fclose(void *);
int host_fseek(void *, int32_t, int);
uint32_t host_fread(void *, uint32_t, uint32_t, void *);
int32_t host_take(void *, uint32_t);
void host_give(void *);
void host_proj(const float *, uint32_t);
void host_canvas_text(void *, int32_t, int32_t, int32_t, void *, const char *);
extern void *host_nav_sem, *host_file_sem, *host_fps[6], *host_canvas;
extern int32_t host_file_cnt;
extern uint8_t host_file_tab[], host_label_opa;
extern int16_t host_dash;
extern uint16_t host_label_col;
extern float host_map_head;
#define fw_cc_rt host_cc_rt
#define fw_cc_pos host_cc_pos
#define fw_off_route() host_off_route()
#define fw_stack() host_stack()
#define fw_clock() host_clock()
#define fw_fopen host_fopen
#define fw_fclose host_fclose
#define fw_fseek host_fseek
#define fw_fread host_fread
#define fw_take host_take
#define fw_file_give(sem) host_give(sem)
#define fw_nav_give() host_give(host_nav_sem)
#define fw_proj host_proj
#define fw_canvas_text host_canvas_text
#define FW_NAV_SEM host_nav_sem
#define FW_FILE_SEM host_file_sem
#define FW_FILE_CNT host_file_cnt
#define FW_FILE_TAB host_file_tab
#define FW_ROUTE_FP host_fps
#define FW_DASH host_dash
#define FW_CANVAS host_canvas
#define FW_LABEL_DSC ((void *)0)
#define FW_LABEL_OPA host_label_opa
#define FW_LABEL_COL host_label_col
#define FW_MAP_HEAD host_map_head
#else
#define fw_cc_rt   ((void (*)(uint32_t))0x421dd920)                       /* v21 cc_rt */
#define fw_cc_pos  ((uint32_t (*)(float *))0x421dd218)                    /* v21 cc_pos: {lat, lon} degrees */
#define fw_fopen   ((void *(*)(const char *, const char *))0x421b85b0)
#define fw_fclose  ((int (*)(void *))0x421b7de0)
#define fw_fseek   ((int (*)(void *, int32_t, int))0x421b8848)
#define fw_fread   ((uint32_t (*)(void *, uint32_t, uint32_t, void *))0x421b8818)
#define fw_take    ((int32_t (*)(void *, uint32_t))0x40381868)            /* semaphore take, ticks */
#define fw_file_give(sem) ((int32_t (*)(void *, const void *, uint32_t, int32_t))0x403813c0)(sem, 0, 0, 0)
#define fw_nav_give ((void (*)(void))0x4204c7a8)
#define fw_proj    ((void (*)(const float *, uint32_t))0x4204c1bc)        /* projects {lat, lon}, calls cc_line */
#define fw_canvas_text ((void (*)(void *, int32_t, int32_t, int32_t, void *, const char *))0x420dbcd0)
#define fw_clock() ((uint32_t)((uint64_t (*)(void))0x403779f4)())         /* raw timer, microseconds, low word */
#define FW_NAV_SEM   (*(void *volatile *)0x3fc9fc3c)
#define FW_FILE_SEM  (*(void *volatile *)0x3fc9f600)                      /* lock of the open-file table */
#define FW_FILE_CNT  (*(volatile int32_t *)0x3fc9f5fc)
#define FW_FILE_TAB  ((const uint8_t *)0x3c380124)
#define FW_ROUTE_FP  ((void *volatile *)0x3c388418)                       /* route file handles, 6 types */
#define FW_DASH      (*(volatile int16_t *)(0x3c38a590 + 4))              /* line descriptor: patch operation */
#define FW_CANVAS    (*(void *volatile *)0x3c38a5dc)
#define FW_LABEL_DSC ((void *)0x3c38a570)
#define FW_LABEL_OPA (*(volatile uint8_t *)(0x3c38a570 + 26))
#define FW_LABEL_COL (*(volatile uint16_t *)(0x3c38a570 + 12))
#define FW_MAP_HEAD  (*(volatile float *)0x3c388d08)                      /* map heading: 450 - course, degrees */
static uint32_t fw_off_route(void) { return *(volatile uint8_t *)(0x3c3894f0 + 145); }
static uint32_t fw_stack(void) {                                          /* as loop_start.c */
  uint32_t sp; __asm__ volatile("mov %0,a1" : "=a"(sp));
  uint32_t task = ((uint32_t (*)(void))0x403832e0)();
  if ((task & 3) || task < 0x3fc88000 || task > 0x3fd00000 - 0x164) return 0;
  uint32_t base = *(volatile uint32_t *)(task + 52), top = *(volatile uint32_t *)(task + 76);
  if ((base & 3) || base < 0x3fc88000 || top >= 0x3fd00000 || top <= base || top - base > 65536 || sp < base || sp > top) return 0;
  return sp - base;
}
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
static void wbd_line(const float *p, uint32_t n, uint32_t op) { FW_DASH = (int16_t)(0x8000u | op); fw_proj(p, n); FW_DASH = 0; }
static void wbd_text(const char *s) {
  uint16_t col = FW_LABEL_COL; void *cv = FW_CANVAS;
  if (!cv) return;
  FW_LABEL_OPA = 255;
  FW_LABEL_COL = 0xffff; fw_canvas_text(cv, 7, 7, 400, FW_LABEL_DSC, s);
  FW_LABEL_COL = 0; fw_canvas_text(cv, 6, 6, 400, FW_LABEL_DSC, s);
  FW_LABEL_COL = col;
}
static char *wbd_num(char *s, uint32_t v) {                               /* decimal, at most 5 digits */
  uint32_t n;
  if (v > 99999u) v = 99999u;
  for (n = 10000u; n > 1u && v < n; n /= 10u) {}
  for (; n; n /= 10u) { *s++ = (char)('0' + v / n); v %= n; }
  return s;
}

static int wbd_read(void *vctx, uint32_t off, void *dst, uint32_t n) {
  wbd_ctx *c = (wbd_ctx *)vctx;
  if (fw_clock() - c->t0 > WBD_TIME_US) { c->late = 1; return 0; }
  if (fw_fseek(c->fp, (int32_t)(c->base + off), 0) != 0) return 0;
  c->reads++;
  return fw_fread(dst, 1u, n, c->fp) == n;
}
static uint32_t le32(const uint8_t *p) { return p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

/* Mounts the data at the file end, runs one tick and reads the line. Returns 0 with n points, or a code. */
static uint32_t wbd_core(wbd_ctx *, uint32_t, uint8_t *, const float *, float *, uint32_t *, uint32_t *);
static __attribute__((noinline)) uint32_t wbd_run(void *fp, uint32_t t0, const float *pos, float *line, uint32_t *n, uint32_t *dm, uint32_t *reads) {
  uint8_t t[16]; wbd_ctx c; uint32_t i;
  if (wb_size() > 128u + 8u * (sizeof(void *) - 4)) return WBD_NODATA;
  /* Trailer, the last 12 bytes: "CCWT", offset of the way-back data, its size. */
  if (fw_fseek(fp, -12, 2) != 0 || fw_fread(t, 1u, 12u, fp) != 12u || le32(t) != 0x54574343u) return WBD_NODATA;
  c.fp = fp; c.base = le32(t + 4); c.t0 = t0; c.late = 0; c.reads = 0;
  i = le32(t + 8);
  i = wbd_core(&c, i, t, pos, line, n, dm);
  *reads = c.reads;
  return i;
}
/* Grey streets of one frame (D3c, E15): the layer cells under the heading-up screen, nearest first, drawn
 * as operation 30 before the line. The buffer is the line buffer of the frame: the line points are read after this
 * draw. A read error or the cap ends the grey for this frame only. */
typedef struct { uint32_t segs; wbd_ctx *c; float *buf; } wbd_grey;
static int wbd_grey_visit(void *vctx, const int32_t *p, uint32_t n) {
  wbd_grey *g = (wbd_grey *)vctx;
  uint32_t k;
  if (g->segs >= WBD_GREY_SEGS || fw_clock() - g->c->t0 > WBD_GREY_US) return 0;
  if (g->segs + (n - 1u) > WBD_GREY_SEGS) n = WBD_GREY_SEGS - g->segs + 1u;   /* the last line is cut at the cap */
  for (k = 0; k < n; k++) { g->buf[2 * k] = (float)p[2 * k] * 1e-7f; g->buf[2 * k + 1] = (float)p[2 * k + 1] * 1e-7f; }
  wbd_line(g->buf, n, 30u);
  g->segs += n - 1u;
  return g->segs < WBD_GREY_SEGS;
}
static void wbd_grey_draw(wbd_ctx *c, wb_engine *e, int32_t lat, int32_t lon, float *buf) {
  uint32_t cells[20], n;
  float head = FW_MAP_HEAD;
  wbd_grey g;
  if (!(head >= -360.0f && head <= 720.0f)) return;            /* NaN or a bad heading: no grey in this frame */
  g.segs = 0; g.c = c; g.buf = buf;
  n = wb_grey_cells(e, lat, lon, (uint32_t)(int32_t)(810.5f - head) % 360u, cells);   /* course + 360, rounded */
  (void)wb_grey_lines(e, cells, n, wbd_grey_visit, &g);
}
static uint32_t wbd_core(wbd_ctx *cp, uint32_t i, uint8_t *t, const float *pos, float *line, uint32_t *n, uint32_t *dm) {
  uint32_t store[32 + 2 * (sizeof(void *) - 4)]; wb_engine *e = (wb_engine *)store;   /* 128 B on the device */
  wb_input in; wb_output out; int32_t p[2];
  if (!wbd_read(cp, 8u, t, 16u)) return WB_READ;              /* identity: the data is inside its route file */
  for (out.state = 0; out.state < sizeof store / 4u; out.state++) store[out.state] = 0;
  if (!wb_mount(e, wbd_read, cp, i, t)) return cp->late ? WB_READ : WBD_NODATA;
  in.lat_e7 = (int32_t)(pos[0] * 1e7f); in.lon_e7 = (int32_t)(pos[1] * 1e7f);
  in.exit_progress_cm = 0; in.flags = WB_GPS_VALID | WB_OFF_ROUTE;   /* no trusted exit on the device: tree A values */
  wb_tick(e, &in, &out);
  if (out.state != WB_LINE) return out.reason ? out.reason : WB_READ;
  wbd_grey_draw(cp, e, in.lat_e7, in.lon_e7, line);           /* grey first: the line points are read after it */
  for (i = 0; i < WBD_POINTS && wb_read_point(e, i, p); i++) { line[2 * i] = (float)p[0] * 1e-7f; line[2 * i + 1] = (float)p[1] * 1e-7f; }
  if (i < 2u) return WB_READ;                                  /* a failed read: draw nothing */
  if (i == WBD_POINTS && wb_read_point(e, WBD_POINTS, p)) return WBD_LINE_CAP;   /* more points: never cut silently */
  *n = i; *dm = out.distance_dm;
  return 0;
}

static __attribute__((noinline)) void wbd_frame(void) {
  float pos[2], line[2 * WBD_POINTS]; char s[128], *o = s; uint32_t n = 0, dm = 0, rd = 0, code, t0 = fw_clock(); int found;
  uint32_t mode = 0x00006272u;                                 /* "rb" */
  void *fp;
  if (fw_stack() < WBD_STACK) code = WBD_STACK_LOW;
  else if (!wbd_pos(pos)) code = WB_GPS;
  else if ((found = wbd_path(s)) <= 0) code = found ? WBD_LOCK : WBD_NODATA;
  else if (!(fp = fw_fopen(s, (const char *)&mode))) code = WBD_OPEN;
  else { code = wbd_run(fp, t0, pos, line, &n, &dm, &rd); fw_fclose(fp); }
  if (code) { *o++ = 'w'; *o++ = 'b'; o = wbd_num(o, code); }
  else {
    wbd_line(line, n, 17u);                                    /* white 7 px, then dark purple 4 px */
    wbd_line(line, n, 14u);
    if (dm == WB_DIST_UNKNOWN) *o++ = '?'; else o = wbd_num(o, dm / 10u);   /* metres */
    *o++ = 'm';
  }
  *o++ = ' ';
  o = wbd_num(o, (fw_clock() - t0) / 1000u);                   /* file and core time of this frame, ms */
  *o++ = ' ';
  o = wbd_num(o, rd);                                          /* file reads of this frame */
  *o = 0;
  wbd_text(s);
}

/* Replaces cc_rt in tramp_rt. The map frame (0x4204da24) makes one hooked route call for each frame. */
void wb_rt(uint32_t part) {
  fw_cc_rt(part);
  if (fw_off_route()) wbd_frame();                             /* on the route: no text, no file call (D5: wb3 removed) */
}
