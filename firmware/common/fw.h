// Firmware CC700_V1.414 addresses (from the own-device dump, see FINDINGS.md). The only file with stock addresses
// (cc27, G8). Called through pointers: the patch lives 1.6 MB away from the firmware code, beyond the call8 range.
#pragma once
#include <stdint.h>
#include "types.h"

// Hooks of the second code area (wb_area2.ld): tramp_iter 0x42049670 (literal 0x42049678) -> cc_iter,
// tramp_line 0x4205bd90 (literal 0x4205bd98) -> cc_line, tramp_rt 0x420496b0 (literal 0x420496b8) -> wb_rt.
// Map frame 0x4204da24: the map iterator 0x4204c9b8 at 0x4204da3e, then tramp_rt at 0x4204da5a (19 Nov).

// Patch operation channel: the line descriptor's dash_width, which the map layer never uses. cc_line clears it.
#define OP_PATCH  0x8000             /* bit 15: patch operation; bits 0-7: op index into the OPS table */
#define OP_BRIDGE 0x0100 
#define OP_TUNNEL 0x0200 
#define OP_OWN    0x4000             /* cc27: draw this op with the raster module (block flag F_OWN) */
#define OP_AA     0x2000             /* cc28: smooth lines (block flag F_AA) */
#define OP_RING   0x1000             /* WP 3 (24 Nov): K_FILL, then the 1 px plain outline on the same points (green 24, water 25) */
#define OP_ANCHOR 23                 /* K_TEXT: cc_line returns pts[0] in color/width and sets dash_gap = 1 */

#ifdef HOST                                                   // PC builds of the same code (tools/*_host.c)
extern line_dsc_t host_dsc; extern void *host_canvas; extern uint16_t *host_buf; extern uint16_t host_w, host_h; extern uint32_t host_cnt; extern ent_t *host_ents;
uint16_t host_color_hex(uint32_t); void host_draw_line(void *, const pt_t *, uint32_t, const line_dsc_t *); void host_nop(void);
void *host_malloc(uint32_t, uint32_t); void host_free(void *); uint32_t host_clock(void);
void host_cc_rt(uint32_t);
uint32_t host_cc_pos(float *);
uint32_t host_off_route(void);
uint32_t host_stack(void);
void *host_fopen(const char *, const char *);
int host_fclose(void *);
int host_fseek(void *, int32_t, int);
uint32_t host_fread(void *, uint32_t, uint32_t, void *);
int32_t host_take(void *, uint32_t);
void host_give(void *);
void host_proj(const float *, uint32_t);
void host_canvas_text(void *, int32_t, int32_t, int32_t, void *, const char *);
extern void *host_nav_sem, *host_file_sem, *host_fps[6];
extern int32_t host_file_cnt;
extern uint8_t host_file_tab[], host_label_opa;
extern uint16_t host_label_col;
extern void *host_label_font; extern uint8_t host_label_align;
void host_km_overlay(int32_t, int32_t, int32_t, int32_t);
extern float host_map_head;
#define FW_LINE_DSC (&host_dsc)
#define FW_CANVAS host_canvas
#define FW_CANVAS_BUF host_buf
#define FW_CANVAS_W host_w
#define FW_CANVAS_H host_h
#define FW_BLK_CNT host_cnt
#define FW_BLK_ENTS host_ents
#define fw_color_hex host_color_hex
#define fw_draw_line host_draw_line
#define fw_blk_lock host_nop
#define fw_blk_unlock host_nop
#define fw_malloc host_malloc
#define fw_free host_free
void *host_getspecific(uint32_t); void *host_tls_get(void *, int32_t); void host_tls_set(void *, int32_t, void *, void *);
#define fw_getspecific host_getspecific
#define fw_tls_get host_tls_get
#define fw_tls_set host_tls_set
#define FW_TLS_DEL ((void *)0)
#define fw_clock() host_clock()
#define fw_cc_rt host_cc_rt
#define fw_cc_pos host_cc_pos
#define fw_off_route() host_off_route()
#define fw_stack() host_stack()
#define fw_fopen host_fopen
#define fw_fclose host_fclose
#define fw_fseek host_fseek
#define fw_fread host_fread
int32_t host_ftell(void *);
#define fw_ftell host_ftell
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
#define FW_DASH (host_dsc.dash_width)                       /* as on the unit: the dash_width of the line descriptor */
#define FW_LABEL_DSC ((void *)0)
#define FW_LABEL_OPA host_label_opa
#define FW_LABEL_COL host_label_col
#define FW_LABEL_FONT host_label_font
#define FW_LABEL_ALIGN host_label_align
#define FW_FONT_NUM ((void *)1)
#define FW_FONT_UNIT ((void *)2)
#define fw_km_overlay host_km_overlay
#define FW_MAP_HEAD host_map_head
extern uint32_t host_route_left, host_nav_selector; extern float host_route_total;
#define FW_ROUTE_LEFT host_route_left
#define FW_ROUTE_TOTAL host_route_total
#define FW_NAV_SELECTOR host_nav_selector
extern int host_proj_zoom, host_proj_rot;
#define FW_PROJ_ZOOM host_proj_zoom
#define FW_PROJ_ROT host_proj_rot
#else
// Map draw (v21 cc_iter and cc_line, firmware/mapdraw)
#define FW_LINE_DSC   ((line_dsc_t *)0x3c38a590)              // map line descriptor (PSRAM), set up in 0x4205bab4
#define FW_CANVAS     (*(void *volatile *)0x3c38a5dc)         // map canvas object (volatile: stock state)
#define FW_CANVAS_BUF (*(uint16_t **)0x3c38a5d8)              // its pixel buffer, w * h lv_color_t (lv_canvas_set_buffer 0x420dbacc)
#define FW_CANVAS_W   (*(volatile uint16_t *)(0x3c38a534 + 4))
#define FW_CANVAS_H   (*(volatile uint16_t *)(0x3c38a534 + 6))
#define FW_BLK_CNT    (*(volatile uint32_t *)(0x3c3887d4 + 20))   // current map block: entry count
#define FW_BLK_ENTS   (*(ent_t * volatile *)(0x3c3887d4 + 24))    // entry array, index = field 1
#define fw_color_hex  ((uint16_t (*)(uint32_t))0x421d0034)    // lv_color_hex: R5<<11 | G6<<5 | B5, no byte swap (19 Nov)
#define fw_draw_line  ((void (*)(void *, const pt_t *, uint32_t, const line_dsc_t *))0x420dbeb0)   // lv_canvas_draw_line
#define fw_blk_lock   ((void (*)(void))0x420494a4)            // xSemaphoreTake(block mutex, forever)
#define fw_blk_unlock ((void (*)(void))0x420494b8)            // xSemaphoreGive
#define fw_malloc     ((void *(*)(uint32_t, uint32_t))0x403763e0)   // heap_caps_malloc(size, caps)
#define fw_free       ((void (*)(void *))0x40376398)
// WP 4 (24 Nov, mined): the pthread key list of the running task, in its one FreeRTOS TLS slot (TCB + 96). The list
// head is a 4 B cell that holds the first node {key, value, next}; pthread_getspecific walks it and does not check
// the key. The patch keeps its cache under the private key WBD_KEY (firmware/wayback/wb_device.c).
#define fw_getspecific ((void *(*)(uint32_t))0x42002890)                 // pthread_getspecific(key)
#define fw_tls_get    ((void *(*)(void *, int32_t))0x403835bc)          // pvTaskGetThreadLocalStoragePointer(0 = this task, 0)
#define fw_tls_set    ((void (*)(void *, int32_t, void *, void *))0x40383590)   // vTaskSetThreadLocalStoragePointerAndDelCallback
#define FW_TLS_DEL    ((void *)0x420027c0)                               // the pthread list destructor (task deletion)
#define fw_clock()    ((uint32_t)((uint64_t (*)(void))0x403779f4)())   // esp_timer_get_time, microseconds, low word
#define fw_canvas_text ((void (*)(void *, int32_t, int32_t, int32_t, void *, const char *))0x420dbcd0)
#define FW_LABEL_DSC ((void *)0x3c38a570)
#define FW_LABEL_OPA (*(volatile uint8_t *)(0x3c38a570 + 26))
#define FW_LABEL_COL (*(volatile uint16_t *)(0x3c38a570 + 12))
#define FW_LABEL_FONT (*(void *volatile *)(0x3c38a570 + 0))     // label descriptor: font
#define FW_LABEL_ALIGN (*(volatile uint8_t *)(0x3c38a570 + 28))   // alignment, 3 = right
#define FW_FONT_NUM   ((void *)0x3c2a54d8)                    // stock map font, line 20 (the remaining-distance number)
#define FW_FONT_UNIT  ((void *)0x3c29188c)                    // stock map font, line 18 ("(km)")
#define fw_km_overlay ((void (*)(int32_t, int32_t, int32_t, int32_t))0x4205bf0c)   // stock remaining-distance overlay (left, total, bar_w, show_text)
// v21 tables that the second code area reads from the base (no data in the second code area)
#define FW_V21_OPS    0x3c1ddf40
#define FW_V21_FILLS  0x3c1ddf36
#define FW_V21_LEVEL  0x3c1ddf20
// Way-back adapter (firmware/wayback/wb_device.c)
#define fw_cc_rt   ((void (*)(uint32_t))0x421dd920)                       /* v21 cc_rt */
#define fw_cc_pos  ((uint32_t (*)(float *))0x421dd218)                    /* v21 cc_pos: {lat, lon} degrees */
#define fw_fopen   ((void *(*)(const char *, const char *))0x421b85b0)
#define fw_fclose  ((int (*)(void *))0x421b7de0)
#define fw_fseek   ((int (*)(void *, int32_t, int))0x421b8848)
#define fw_fread   ((uint32_t (*)(void *, uint32_t, uint32_t, void *))0x421b8818)
#define fw_ftell   ((int32_t (*)(void *))0x421b8c2c)                     // ftell (24 Nov, mined: _ftello_r with SEEK_CUR)
#define fw_take    ((int32_t (*)(void *, uint32_t))0x40381868)            /* semaphore take, ticks */
#define fw_file_give(sem) ((int32_t (*)(void *, const void *, uint32_t, int32_t))0x403813c0)(sem, 0, 0, 0)
#define fw_nav_give ((void (*)(void))0x4204c7a8)
#define fw_proj    ((void (*)(const float *, uint32_t))0x4204c1bc)        /* projects {lat, lon}, calls cc_line */
#define FW_NAV_SEM   (*(void *volatile *)0x3fc9fc3c)
#define FW_FILE_SEM  (*(void *volatile *)0x3fc9f600)                      /* lock of the open-file table */
#define FW_FILE_CNT  (*(volatile int32_t *)0x3fc9f5fc)
#define FW_FILE_TAB  ((const uint8_t *)0x3c380124)
#define FW_ROUTE_FP  ((void *volatile *)0x3c388418)                       /* route file handles, 6 types */
#define FW_DASH      (*(volatile int16_t *)(0x3c38a590 + 4))              /* line descriptor: patch operation */
#define FW_MAP_HEAD  (*(volatile float *)0x3c388d08)                      /* map heading: 450 - course, degrees */
#define FW_ROUTE_LEFT   (*(volatile uint32_t *)0x3c389344)                /* remaining route distance, m (progress words) */
#define FW_ROUTE_TOTAL  (*(volatile float *)0x3c389320)                   /* total route distance, m */
#define FW_NAV_SELECTOR (*(volatile uint32_t *)0x3fc9fcc4)                /* nav source: 0 = the route file */
/* cc28b own projection (firmware/mapdraw/proj.h). Decoded stock chain, 20 Nov: fw_proj 0x4204c1bc, for each point
 * 0x4204a76c (60 B heap block via 0x4204a498; deg -> rad 0x42055b54; x 0x42055c1c: 2^z * 256 * lon / 2pi + 128 * 2^z;
 * y 0x42055bb4: 128 * 2^z - 2^z * 256 * atanh(sin lat) / 2pi, double, truncated), minus the origin S[4], S[5] plus the
 * offset words 2, 3 at 0x3c388d74, then 0x4204c158: if the byte 0x3c388d04, a turn about the centre (0x3c388d44 + 16)
 * by the angle of 0x4204c120 (heading - 90 or + 270) in 0x4204a68c (double sin, cos), truncated to int16.
 * State: ctx = *0x3c388cfc, S = *ctx, zoom = S[0]. 0 when the context is not set. */
static __attribute__((unused)) int fw_proj_zoom(void) { int32_t **ctx = *(int32_t ***)0x3c388cfc; return ctx && *ctx ? (*ctx)[0] : 0; }
#define FW_PROJ_ZOOM fw_proj_zoom()
#define FW_PROJ_ROT  (*(volatile uint8_t *)0x3c388d04)
static __attribute__((unused)) uint32_t fw_off_route(void) { return *(volatile uint8_t *)(0x3c3894f0 + 145); }
static __attribute__((unused)) uint32_t fw_stack(void) {                  /* as loop_start.c */
  uint32_t sp; __asm__ volatile("mov %0,a1" : "=a"(sp));
  uint32_t task = ((uint32_t (*)(void))0x403832e0)();
  if ((task & 3) || task < 0x3fc88000 || task > 0x3fd00000 - 0x164) return 0;
  uint32_t base = *(volatile uint32_t *)(task + 52), top = *(volatile uint32_t *)(task + 76);
  if ((base & 3) || base < 0x3fc88000 || top >= 0x3fd00000 || top <= base || top - base > 65536 || sp < base || sp > top) return 0;
  return sp - base;
}
#endif
#define CAPS_PSRAM    0x404                                   // MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT, as the firmware uses
