"""Host address adapters for the complete patch loader C, never target code.

The navigation list, payload road offset and linked nodes use the same field
layout, with native host pointer width. Stock services are explicit fixtures;
this does not emulate the stock resolver, allocator, scheduler or display.
"""
import ctypes as C
import hashlib
import os
from pathlib import Path
import subprocess
import tempfile


DEFAULT_SOURCE = Path(__file__).resolve().parents[2] / "cc700-patch/src/blk.c"

HEADER = r"""
extern void *host_list;
unsigned host_count(void *);
const float *host_at(void *, unsigned);
void host_gps(float *);
unsigned host_junction(unsigned);
blkidx_t *host_header(void);
void host_load(unsigned, unsigned, unsigned);
void host_iter(proj_cb_t);
unsigned host_resolve(unsigned, unsigned short *);
#define fw_junction_off host_junction
#define fw_blk_load host_load
#define fw_blk_hdr host_header
#define fw_gps_pos host_gps
#define fw_list_cnt host_count
#define fw_list_at host_at
#define FW_PT_LIST host_list
#define fw_blk_iter host_iter
#define fw_resolve_road host_resolve
"""

ARROW_HEADER = r"""
extern uint16_t host_road;
void host_project(const float *, uint32_t);
void host_route(uint32_t);
int host_nav_try(void);
void host_nav_give(void);
#define fw_proj host_project
#define fw_route host_route
#define FW_PT_LIST host_list
#define FW_ROAD host_road
#define fw_nav_try host_nav_try
#define fw_nav_give host_nav_give
"""

SHIM = r"""
#include <stddef.h>
#include <string.h>
#include <stdint.h>
#define HOST
#define CC_BLOCK_HOST
#include "blk-adapted.c"
#define CC_ARROW_HOST
#include "arrow-adapted.c"
line_dsc_t host_dsc;
void *host_canvas;
uint16_t *host_buf, host_w, host_h;
uint32_t host_cnt;
ent_t *host_ents;
uint16_t host_road;
static unsigned projected, nav_available, nav_held, nav_takes, nav_gives, lock_inversions, invalid_counts;
void host_nop(void) { if(nav_held) lock_inversions++; }
int host_nav_try(void) {nav_takes++;nav_held=nav_available;return nav_available;}
void host_nav_give(void) {nav_gives++;nav_held=0;}
void host_nav_available(unsigned value) {nav_available=value;}
uint16_t host_color_hex(uint32_t c) {return (uint16_t)c;}
void host_draw_line(void *c,const pt_t *p,uint32_t n,const line_dsc_t *d) {}
void host_project(const float *p,uint32_t n) {projected++;}
void host_route(uint32_t p) {}
#ifdef CC_ROUTE_LAYOUT
typedef route_point_t testpoint;
typedef route_node_t testnode;
#else
typedef struct { float pos[2]; unsigned char gap[32]; uint16_t road; unsigned char tail[18]; } testpoint;
typedef struct testnode { testpoint *value; struct testnode *next; } testnode;
#endif
_Static_assert(offsetof(testpoint,road)==40,"fixture payload");
static testpoint points[8192];
static testnode nodes[8192];
static testnode *head;
static void *inner;
void *host_list;
static unsigned count, slots[8192], locals[8192], offsets[8192], map_count;
static unsigned selected, selected_type, load_index, load_block, indexed, resolved, draws;
static float gps[2];
static blkidx_t header;
unsigned host_count(void *p) {
 if(p && !*(void**)p) {invalid_counts++;return 0;}
 return p?count:0;
}
const float *host_at(void *p,unsigned i) { indexed++;return i<count?points[i].pos:0; }
void host_gps(float *p) { p[0]=gps[0];p[1]=gps[1]; }
unsigned host_junction(unsigned t) { return 123; }
blkidx_t *host_header(void) { return &header; }
void host_load(unsigned t,unsigned off,unsigned mode) {
 if(mode) { load_block++;selected=off;selected_type=t; }
 else load_index++;
}
void host_iter(proj_cb_t cb) { draws++; }
unsigned host_resolve(unsigned global,uint16_t *local) {
 resolved++; if(global>=map_count) return 255;
 *local=locals[global];return slots[global];
}
void host_setup(unsigned n,const float *coords,const uint16_t *roads,const unsigned *s,
 const unsigned *l,unsigned mappings,const float *pos,unsigned sections,unsigned has) {
 count=n;map_count=mappings;gps[0]=pos[0];gps[1]=pos[1];
 for(unsigned i=0;i<n;i++) { memcpy(points[i].pos,coords+2*i,8);points[i].road=roads[i];nodes[i].value=&points[i];nodes[i].next=i+1<n?&nodes[i+1]:0; }
 for(unsigned i=0;i<mappings;i++) {slots[i]=s[i];locals[i]=l[i];}
 for(unsigned i=0;i<sections;i++) offsets[i]=7+100*i;
 head=n?nodes:0;inner=&head;host_list=&inner;
 header.cnt=sections;header.off=offsets;header.has=has;
 selected=selected_type=~0u;load_index=load_block=indexed=resolved=draws=0;
 nav_available=1;nav_held=nav_takes=nav_gives=lock_inversions=invalid_counts=0;
}
void host_clear_list(void) {host_list=0;}
void host_clear_inner(void) {inner=0;}
void host_null_point(unsigned i) {if(i<count) nodes[i].value=0;}
unsigned host_metric(unsigned i) {
 switch(i) {case 0:return selected;case 1:return selected_type;case 2:return load_index;
 case 3:return load_block;case 4:return indexed;case 5:return resolved;case 6:return draws;
 case 7:return nav_takes;case 8:return nav_gives;case 9:return lock_inversions;case 10:return invalid_counts;}
 return ~0u;
}
unsigned host_arrow(unsigned road,unsigned turn,float x,float y) {
 static int32_t ps[4]; static ent_t entry;
 host_road=road;projected=0;
 const float scale=2147483648.0f/180.0f;
 entry.n=0;entry.style=15|(turn<<16);entry.lat=(int32_t)(y/111195*scale);entry.lon=(int32_t)(x/111195*scale);
 ps[0]=entry.lat;ps[1]=entry.lon-10000;ps[2]=entry.lat;ps[3]=entry.lon;
 entry.cnt=2;entry.pts=ps;host_cnt=1;host_ents=&entry;
 cc_rt(0);return projected;
}
"""


class LoaderHost:
    def __init__(self, source=None):
        source = Path(source or os.environ.get("CC700_PATCH_SRC", DEFAULT_SOURCE)).resolve()
        self.source = source
        self.source_sha256 = hashlib.sha256(source.read_bytes()).hexdigest()
        self.tmp = tempfile.TemporaryDirectory(prefix="cc700-loader-")
        root = Path(self.tmp.name)
        text = source.read_text()
        native_layout = "CC_BLOCK_HOST" in text
        # Compatibility adapter allows a red test against preserved v17. The
        # production v18 seam needs no rewriting of algorithm bodies.
        if "CC_BLOCK_HOST" not in text:
            names = {line.split()[1] for line in HEADER.splitlines() if line.startswith("#define ")}
            text = "\n".join(line for line in text.splitlines()
                             if not (line.startswith("#define ") and line.split()[1] in names))
            text = text.replace("#ifndef HOST", "#if 1")
            text = text.replace("static const float *pt_at", HEADER + "\nstatic const float *pt_at")
        (root / "blk-adapted.c").write_text(text)
        arrow = (source.parent / "arrow.c").read_text()
        if "CC_ARROW_HOST" not in arrow:
            arrow = arrow.replace("#ifndef HOST", "#if 1")
            names = {"fw_proj", "fw_route", "FW_PT_LIST", "FW_ROAD", "fw_gps_pos", "fw_list_cnt", "fw_list_at"}
            arrow = "\n".join(line for line in arrow.splitlines()
                              if not (line.startswith("#define ") and line.split()[1] in names))
            # Indexed legacy arrow seam calls the fixture accessors.
            arrow = arrow.replace("#define fw_marker", ARROW_HEADER + "\n#define fw_marker", 1)
        (root / "arrow-adapted.c").write_text(arrow)
        (root / "blk_host.h").write_text(HEADER)
        (root / "arrow_host.h").write_text(ARROW_HEADER)
        (root / "shim.c").write_text(("#define CC_ROUTE_LAYOUT\n" if native_layout else "") + SHIM)
        path = root / "loader.so"
        subprocess.run(["cc", "-shared", "-fPIC", "-O2", "-Wall", "-Wextra",
                        "-Wno-unused-parameter", "-I", str(root), "-I", str(source.parent),
                        str(root / "shim.c"), "-o", str(path)], check=True, capture_output=True)
        self.lib = C.CDLL(str(path))
        f, u, h = C.c_float, C.c_uint32, C.c_uint16
        self.lib.host_setup.argtypes = [u, C.POINTER(f), C.POINTER(h), C.POINTER(u),
                                       C.POINTER(u), u, C.POINTER(f), u, u]
        self.lib.host_metric.argtypes = [u]
        self.lib.host_metric.restype = u
        self.lib.cc_blk.argtypes = [u, u]
        self.lib.host_null_point.argtypes = [u]
        self.lib.host_arrow.argtypes = [u,u,f,f]
        self.lib.host_arrow.restype = u
        self.lib.host_nav_available.argtypes = [u]

    def setup(self, xy, roads, pos, sections, mappings=None, has=True, degrees=False):
        if len(xy) != len(roads) or len(xy) > 8192 or sections > 8192:
            raise ValueError("Invalid fixture size")
        mappings = mappings if mappings is not None else [(0, i) for i in range(sections + 1)]
        if len(mappings) > 8192:
            raise ValueError("Too many mappings")
        f, u, h = C.c_float, C.c_uint32, C.c_uint16
        # Synthetic x/y metres map to lat/lon close to the equator. Real input
        # uses already decoded latitude/longitude and bypasses this conversion.
        convert = (lambda p: p) if degrees else (lambda p: (p[1] / 111195, p[0] / 111195))
        coords = (f * (2 * len(xy)))(*(v for p in xy for v in convert(p)))
        self.lib.host_setup(len(xy), coords, (h * len(roads))(*roads),
                            (u * len(mappings))(*(p[0] for p in mappings)),
                            (u * len(mappings))(*(p[1] for p in mappings)), len(mappings),
                            (f * 2)(*convert(pos)), sections, has)

    def run(self, road, file_type=0):
        self.lib.cc_blk(file_type, road)
        keys = ("offset", "file_type", "index_loads", "block_loads", "indexed_lookups", "resolutions", "draw_calls")
        result = dict(zip(keys, (self.lib.host_metric(i) for i in range(len(keys)))))
        result["section"] = ((result["offset"] - 7) // 100
                             if result["block_loads"] else None)
        return result

    def close(self):
        self.tmp.cleanup()
