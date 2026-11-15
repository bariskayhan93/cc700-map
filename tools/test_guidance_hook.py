"""Exercise actual candidate hook C, not a translated policy model."""
import ctypes
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class GuidanceHookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        lib = Path(cls.tmp.name) / 'guidance.so'
        subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror', '-shared',
                        '-fPIC', '-DHOST', str(ROOT/'firmware/guidance/guidance.c'),
                        str(ROOT/'tools/guidance_host.c'), '-o', str(lib)], check=True)
        cls.lib = ctypes.CDLL(str(lib))
        for name in ('cc_guidance_card', 'cc_guidance_popup'):
            getattr(cls.lib, name).argtypes = [ctypes.c_void_p]*3
        cls.lib.guidance_host_reset.argtypes = [ctypes.c_uint]
        cls.lib.guidance_host_value.argtypes = [ctypes.c_uint]
        cls.lib.guidance_host_value.restype = ctypes.c_size_t

    @classmethod
    def tearDownClass(cls): cls.tmp.cleanup()

    def run_hook(self, name, table, offroute, obj=0x1000, buffer=0x2000):
        self.lib.guidance_host_reset(offroute)
        getattr(self.lib,name)(obj,table,buffer)
        return [self.lib.guidance_host_value(i) for i in range(9)]

    def test_committed_offroute_hides_all_cue_children_without_stale_update(self):
        for name,table in [('cc_guidance_card',0x3fc98b60),('cc_guidance_popup',0x3fc989f0)]:
            children = 3 if name == 'cc_guidance_card' else 5
            for flag in (1,2,255):
                with self.subTest(name=name,flag=flag):
                    v=self.run_hook(name,table,flag)
                    self.assertEqual(v[:5],[1,children,0,0,0])
                    self.assertEqual(v[5:7],[0x3000+children-1,1])

    def test_onroute_restores_and_updates_native_consumers_with_exact_arguments(self):
        for name,table,index in [('cc_guidance_card',0x3fc98b60,3),('cc_guidance_popup',0x3fc989f0,4)]:
            v=self.run_hook(name,table,0)
            self.assertEqual(v[:3],[1,0,1 if name == 'cc_guidance_card' else 3])
            self.assertEqual(v[index],1)
            self.assertEqual(v[5:],[0x1000,table,0x2000,1])

    def test_rejoin_restores_children_without_touching_independently_hidden_root(self):
        for name,table,count,stable in [('cc_guidance_card',0x3fc98b60,3,1),('cc_guidance_popup',0x3fc989f0,5,3)]:
            for caption_mode in (1,2):
                self.lib.guidance_host_reset(0)
                self.lib.guidance_host_caption(caption_mode)
                hook=getattr(self.lib,name)
                hook(0x1000,table,0x2000)
                self.lib.guidance_host_offroute(1)
                hook(0x1000,table,0x2000)
                self.assertEqual([self.lib.guidance_host_hidden(i) for i in range(count)],[1]*count)
                self.lib.guidance_host_offroute(0)
                hook(0x1000,table,0x2000)
                expected=[0]*stable + ([0,1] if caption_mode==1 else [1,0])
                self.assertEqual([self.lib.guidance_host_hidden(i) for i in range(count)],expected)
                self.assertEqual(self.lib.guidance_host_hidden(5),1)

    def test_other_widget_tables_keep_native_behavior_even_offroute(self):
        for name in ('cc_guidance_card','cc_guidance_popup'):
            v=self.run_hook(name,0x1234,1)
            self.assertEqual(v[:3],[0,0,0])
            self.assertEqual(v[3]+v[4],1)
            self.assertEqual(v[5:8],[0x1000,0x1234,0x2000])

    def test_native_null_guards_remain_in_native_consumer(self):
        for name,table in [('cc_guidance_card',0x3fc98b60),('cc_guidance_popup',0x3fc989f0)]:
            for obj,cb,buf in [(0,table,0x2000),(0x1000,0,0x2000),(0x1000,table,0)]:
                v=self.run_hook(name,cb,1,obj,buf)
                self.assertEqual(v[:3],[0,0,0])
                self.assertEqual(v[3]+v[4],1)

if __name__ == '__main__': unittest.main()
