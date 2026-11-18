// Firmware CC700_V1.414 addresses (from the own-device dump, see FINDINGS.md). Called through pointers: the patch
// lives 1.6 MB away from the firmware code, beyond the call8 range.
#pragma once
#include <stdint.h>
typedef struct { int16_t x, y; } pt_t;                       // lv_point_t
typedef struct {                                             // lv_draw_line_dsc_t (LVGL 8, 16-bit colour)
  uint16_t color; int16_t width, dash_width, dash_gap; uint8_t opa; uint8_t flags;   // flags: bit 2 round start, bit 3 round end
} line_dsc_t;
typedef struct { uint32_t n, style; int32_t lat, lon; uint32_t cnt; int32_t *pts; } ent_t;   // decoded map entry (24 B)

#ifdef HOST                                                   // PC build of the same drawing code (host.c)
extern line_dsc_t host_dsc; extern void *host_canvas; extern uint16_t *host_buf; extern uint16_t host_w, host_h; extern uint32_t host_cnt; extern ent_t *host_ents;
uint16_t host_color_hex(uint32_t); void host_draw_line(void *, const pt_t *, uint32_t, const line_dsc_t *); void host_nop(void);
void *host_malloc(uint32_t, uint32_t); void host_free(void *);
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
#else
#define FW_LINE_DSC   ((line_dsc_t *)0x3c38a590)              // map line descriptor (PSRAM), set up in 0x4205bab4
#define FW_CANVAS     (*(void **)0x3c38a5dc)                  // map canvas object
#define FW_CANVAS_BUF (*(uint16_t **)0x3c38a5d8)              // its pixel buffer, w * h lv_color_t (lv_canvas_set_buffer 0x420dbacc)
#define FW_CANVAS_W   (*(volatile uint16_t *)(0x3c38a534 + 4))
#define FW_CANVAS_H   (*(volatile uint16_t *)(0x3c38a534 + 6))
#define FW_BLK_CNT    (*(volatile uint32_t *)(0x3c3887d4 + 20))   // current map block: entry count
#define FW_BLK_ENTS   (*(ent_t * volatile *)(0x3c3887d4 + 24))    // entry array, index = field 1
#define fw_color_hex  ((uint16_t (*)(uint32_t))0x421d0034)    // lv_color_hex
#define fw_draw_line  ((void (*)(void *, const pt_t *, uint32_t, const line_dsc_t *))0x420dbeb0)   // lv_canvas_draw_line
#define fw_blk_lock   ((void (*)(void))0x420494a4)            // xSemaphoreTake(block mutex, forever)
#define fw_blk_unlock ((void (*)(void))0x420494b8)            // xSemaphoreGive
#define fw_malloc     ((void *(*)(uint32_t, uint32_t))0x403763e0)   // heap_caps_malloc(size, caps)
#define fw_free       ((void (*)(void *))0x40376398)
#endif
#define CAPS_PSRAM    0x404                                   // MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT, as the firmware uses
typedef void (*proj_cb_t)(const float *latlon, uint32_t n);  // 0x4204c1bc: projects n points, then calls 0x4205bd90 (cc_line)
