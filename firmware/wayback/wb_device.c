/* Way-back device adapter (test layer on cc23). Hook: the literal of tramp_rt (0x420496b8), which
 * held cc_rt. Runs in the GUI draw path after the route line. No writable globals: each off-route
 * frame opens the route file again, mounts the way-back data from its end, draws and closes.
 * Contract and addresses: firmware/wayback/README.md. */
#include "wayback.h"

#define WBD_POINTS 32u              /* line points for each frame */
#define WBD_READS 1000u             /* file reads for each frame */
#define WBD_STACK 3072u             /* free stack needed before any file call */
enum { WBD_LOCK = 6, WBD_NOFILE = 7, WBD_STACK_LOW = 8 };   /* codes after the core reasons 1 to 5 */

typedef struct { void *fp; uint32_t base, left; } wbd_ctx;

#ifdef HOST
void host_cc_rt(uint32_t);
uint32_t host_cc_pos(float *);
uint32_t host_off_route(void);
uint32_t host_stack(void);
int host_path(char *name);
void *host_fopen(const char *, const char *);
int host_fclose(void *);
int host_fseek(void *, int32_t, int);
uint32_t host_fread(void *, uint32_t, uint32_t, void *);
void host_line(const float *, uint32_t, uint32_t op);
void host_text(const char *);
#define fw_cc_rt host_cc_rt
#define fw_pos host_cc_pos
#define fw_off_route() host_off_route()
#define fw_stack() host_stack()
#define fw_path host_path
#define fw_fopen host_fopen
#define fw_fclose host_fclose
#define fw_fseek host_fseek
#define fw_fread host_fread
#define fw_line host_line
#define fw_text host_text
#else
#define fw_cc_rt   ((void (*)(uint32_t))0x421dd920)                       /* v21 cc_rt */
#define fw_cc_pos  ((uint32_t (*)(float *))0x421dd218)                    /* v21 cc_pos: {lat, lon} degrees */
#define fw_fopen   ((void *(*)(const char *, const char *))0x421b85b0)
#define fw_fclose  ((int (*)(void *))0x421b7de0)
#define fw_fseek   ((int (*)(void *, int32_t, int))0x421b8848)
#define fw_fread   ((uint32_t (*)(void *, uint32_t, uint32_t, void *))0x421b8818)
#define fw_take    ((int32_t (*)(void *, uint32_t))0x40381868)            /* semaphore take, ticks */
#define fw_give    ((int32_t (*)(void *, const void *, uint32_t, int32_t))0x403813c0)
#define fw_nav_give ((void (*)(void))0x4204c7a8)
#define fw_proj    ((void (*)(const float *, uint32_t))0x4204c1bc)        /* projects {lat, lon}, calls cc_line */
#define fw_canvas_text ((void (*)(void *, int32_t, int32_t, int32_t, void *, const char *))0x420dbcd0)
#define FW_NAV_SEM   (*(void *volatile *)0x3fc9fc3c)
#define FW_FILE_SEM  (*(void *volatile *)0x3fc9f600)                      /* lock of the open-file table */
#define FW_FILE_CNT  (*(volatile int32_t *)0x3fc9f5fc)
#define FW_FILE_TAB  ((const uint8_t *)0x3c380124)                        /* 132 B records: FILE *, name[128] */
#define FW_ROUTE_FP  ((void *volatile *)0x3c388418)                       /* route file handles, 6 types */
#define FW_DASH      (*(volatile int16_t *)(0x3c38a590 + 4))              /* line descriptor: patch operation */
#define FW_CANVAS    (*(void *volatile *)0x3c38a5dc)
#define FW_LABEL_DSC ((void *)0x3c38a570)
#define FW_LABEL_OPA (*(volatile uint8_t *)(0x3c38a570 + 26))
#define FW_LABEL_COL (*(volatile uint16_t *)(0x3c38a570 + 12))
static uint32_t fw_off_route(void) { return *(volatile uint8_t *)(0x3c3894f0 + 145); }
static uint32_t fw_stack(void) {                                          /* as loop_start.c */
  uint32_t sp; __asm__ volatile("mov %0,a1" : "=a"(sp));
  uint32_t task = ((uint32_t (*)(void))0x403832e0)();
  if ((task & 3) || task < 0x3fc88000 || task > 0x3fd00000 - 0x164) return 0;
  uint32_t base = *(volatile uint32_t *)(task + 52), top = *(volatile uint32_t *)(task + 76);
  if ((base & 3) || base < 0x3fc88000 || top >= 0x3fd00000 || top <= base || top - base > 65536 || sp < base || sp > top) return 0;
  return sp - base;
}
static uint32_t fw_pos(float *pos) {                                      /* as cc_rt: never wait for the lock */
  void *sem = FW_NAV_SEM; uint32_t ok;
  if (!sem || fw_take(sem, 0) <= 0) return 0;
  ok = fw_cc_pos(pos);
  fw_nav_give();
  return ok;
}
/* Path of the first open route file, from the open-file table of the firmware. 1 = found, 0 = none, -1 = lock busy. */
static int fw_path(char *name) {
  void *sem = FW_FILE_SEM; int found = 0; uint32_t t; int32_t i, n;
  if (!sem || fw_take(sem, 0) <= 0) return -1;
  n = FW_FILE_CNT;
  for (t = 0; t < 6u && !found; t++) {
    void *fp = FW_ROUTE_FP[t];
    if (!fp) continue;
    for (i = 0; i < n && i < 20; i++) {
      const uint8_t *r = FW_FILE_TAB + (uint32_t)i * 132u;
      if (*(void *const *)r != fp) continue;
      for (n = 0; n < 127 && r[4 + n]; n++) name[n] = (char)r[4 + n];
      name[n] = 0; found = n > 0;
      break;
    }
  }
  fw_give(sem, 0, 0, 0);
  return found;
}
static void fw_line(const float *p, uint32_t n, uint32_t op) { FW_DASH = (int16_t)(0x8000u | op); fw_proj(p, n); FW_DASH = 0; }
static void fw_text(const char *s) {
  uint16_t col = FW_LABEL_COL; void *cv = FW_CANVAS;
  if (!cv) return;
  FW_LABEL_OPA = 255;
  FW_LABEL_COL = 0xffff; fw_canvas_text(cv, 7, 7, 400, FW_LABEL_DSC, s);
  FW_LABEL_COL = 0; fw_canvas_text(cv, 6, 6, 400, FW_LABEL_DSC, s);
  FW_LABEL_COL = col;
}
#endif

static int wbd_read(void *vctx, uint32_t off, void *dst, uint32_t n) {
  wbd_ctx *c = (wbd_ctx *)vctx;
  if (!c->left) return 0;
  c->left--;
  if (fw_fseek(c->fp, (int32_t)(c->base + off), 0) != 0) return 0;
  return fw_fread(dst, 1u, n, c->fp) == n;
}
static uint32_t le32(const uint8_t *p) { return p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24); }

/* Mounts the data at the file end, runs one tick and reads the line. Returns 0 with n points, or a code. */
static __attribute__((noinline)) uint32_t wbd_run(void *fp, const float *pos, float *line, uint32_t *n, uint32_t *dm) {
  uint32_t store[32]; wb_engine *e = (wb_engine *)store;     /* 128 B: wb_size() on the device */
  uint8_t t[16]; wbd_ctx c; wb_input in; wb_output out; int32_t p[2]; uint32_t i;
  if (wb_size() > sizeof store) return WBD_NOFILE;
  /* Trailer, the last 12 bytes: "CCWT", offset of the way-back data, its size. */
  if (fw_fseek(fp, -12, 2) != 0 || fw_fread(t, 1u, 12u, fp) != 12u || le32(t) != 0x54574343u) return WBD_NOFILE;
  c.fp = fp; c.base = le32(t + 4); c.left = WBD_READS;
  i = le32(t + 8);
  if (!wbd_read(&c, 8u, t, 16u)) return WB_READ;              /* identity: the data is inside its route file */
  for (out.state = 0; out.state < 32u; out.state++) store[out.state] = 0;
  if (!wb_mount(e, wbd_read, &c, i, t)) return WBD_NOFILE;
  in.lat_e7 = (int32_t)(pos[0] * 1e7f); in.lon_e7 = (int32_t)(pos[1] * 1e7f);
  in.exit_progress_cm = 0; in.flags = WB_GPS_VALID | WB_OFF_ROUTE;   /* no trusted exit on the device: tree A values */
  wb_tick(e, &in, &out);
  if (out.state != WB_LINE) return out.reason ? out.reason : WB_READ;
  for (i = 0; i < WBD_POINTS && wb_read_point(e, i, p); i++) { line[2 * i] = (float)p[0] * 1e-7f; line[2 * i + 1] = (float)p[1] * 1e-7f; }
  if (i < 2u) return WB_READ;                                  /* a failed read: draw nothing */
  *n = i; *dm = out.distance_dm;
  return 0;
}

static __attribute__((noinline)) void wbd_frame(void) {
  float pos[2], line[2 * WBD_POINTS]; char s[128]; uint32_t n = 0, dm = 0, code, v, k; int found;
  uint32_t mode = 0x00006272u;                                 /* "rb" */
  void *fp;
  if (fw_stack() < WBD_STACK) code = WBD_STACK_LOW;
  else if (!fw_pos(pos)) code = WB_GPS;
  else if ((found = fw_path(s)) <= 0) code = found ? WBD_LOCK : WBD_NOFILE;
  else if (!(fp = fw_fopen(s, (const char *)&mode))) code = WBD_NOFILE;
  else { code = wbd_run(fp, pos, line, &n, &dm); fw_fclose(fp); }
  k = 0;
  if (code) { s[k++] = 'w'; s[k++] = 'b'; s[k++] = ' '; s[k++] = (char)('0' + code); }
  else {
    fw_line(line, n, 17u);                                     /* white 7 px, then dark purple 4 px */
    fw_line(line, n, 14u);
    if (dm == WB_DIST_UNKNOWN) return;
    v = dm / 10u;                                              /* metres */
    for (n = 10000u; n > 1u && v < n; n /= 10u) {}
    if (v > 99999u) v = 99999u;
    for (; n; n /= 10u) { s[k++] = (char)('0' + v / n); v %= n; }
    s[k++] = ' '; s[k++] = 'm';
  }
  s[k] = 0;
  fw_text(s);
}

/* Replaces cc_rt in tramp_rt. Part 0 is the last route call of a frame. */
void wb_rt(uint32_t part) {
  fw_cc_rt(part);
  if (part || !fw_off_route()) return;
  wbd_frame();
}
