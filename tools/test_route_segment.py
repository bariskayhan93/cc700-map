"""Compile the actual private arrow.c and observe its line descriptor at draw."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
SOURCE=Path(os.environ.get('CC700_PATCH_SRC',ROOT.parent/'cc700-backup/patch/src/blk.c')).parent
HEADER='''extern void *host_list; extern uint16_t host_road;
void host_project(const float *, uint32_t); void host_route(uint32_t);
int host_nav_try(void); void host_nav_give(void);
#define fw_proj host_project
#define fw_route host_route
#define FW_PT_LIST host_list
#define FW_ROAD host_road
#define fw_nav_try host_nav_try
#define fw_nav_give host_nav_give
'''
HARNESS=r'''
#include <stdio.h>
#include <stdlib.h>
#include "fw.h"
void cc_seg(void *,const pt_t *,uint32_t,line_dsc_t *);
line_dsc_t host_dsc;void *host_canvas,*host_list;uint16_t *host_buf,host_w,host_h,host_road;uint32_t host_cnt;ent_t *host_ents;
static line_dsc_t drawn;static unsigned calls;
uint16_t host_color_hex(uint32_t c){return ((c>>8)&0xf800)|((c>>5)&0x7e0)|((c>>3)&0x1f);}
void host_draw_line(void *cv,const pt_t *p,uint32_t n,const line_dsc_t *d){if(cv!=(void*)1||!p||n!=2)abort();drawn=*d;calls++;}
void host_nop(void){}void *host_malloc(uint32_t n,uint32_t caps){return 0;}void host_free(void*p){}
void host_project(const float*p,uint32_t n){}void host_route(uint32_t p){}int host_nav_try(void){return 0;}void host_nav_give(void){}
uint32_t cc_pos(float*p){return 0;}uint32_t cc_arrow_road(const float*p,uint32_t r){return r;}
int main(int argc,char**argv){if(argc!=3)return 3;unsigned rgb=strtoul(argv[1],0,16);int w=atoi(argv[2]);
pt_t points[2]={{0,0},{10,10}};line_dsc_t d={host_color_hex(rgb),w,2,3,37,0x80};
cc_seg((void*)1,points,2,&d);
printf("{\"calls\":%u,\"drawn\":[%u,%d,%d,%d,%u,%u],\"after\":[%u,%d,%d,%d,%u,%u]}\n",calls,drawn.color,drawn.width,drawn.dash_width,drawn.dash_gap,drawn.opa,drawn.flags,d.color,d.width,d.dash_width,d.dash_gap,d.opa,d.flags);
return 0;}
'''
@unittest.skipUnless((SOURCE/'arrow.c').is_file(),'Private firmware source required')
class RouteSegment(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.tmp=tempfile.TemporaryDirectory(prefix='cc700-segment-');p=Path(cls.tmp.name);(p/'arrow_host.h').write_text(HEADER);(p/'probe.c').write_text(HARNESS);cls.exe=p/'probe'
  subprocess.run(['cc','-std=c11','-O1','-g','-DHOST','-DCC_ARROW_HOST','-fsanitize=address,undefined','-fno-sanitize-recover=all','-I',str(p),'-I',str(SOURCE),str(p/'probe.c'),str(SOURCE/'arrow.c'),'-o',str(cls.exe)],check=True,capture_output=True)
 @classmethod
 def tearDownClass(cls):cls.tmp.cleanup()
 def test_red_route_is_opaque_and_descriptor_is_restored(self):
  for rgb,width,expected in [('d62828',6,4),('d62828',4,4),('c8d0de',6,6)]:
   r=json.loads(subprocess.check_output([str(self.exe),rgb,str(width)],text=True));self.assertEqual(r['calls'],1)
   self.assertEqual(r['drawn'][1],expected);self.assertEqual(r['drawn'][2:4],[2,3]);self.assertEqual(r['after'][1:],[width,2,3,37,128]);self.assertEqual(r['drawn'][0],r['after'][0])
   self.assertEqual(r['drawn'][4],255 if rgb=='d62828' else 37)
   self.assertEqual(r['drawn'][5],140 if rgb=='d62828' else 128)
if __name__=='__main__':unittest.main()
