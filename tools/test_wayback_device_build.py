"""Real Xtensa build of the way-back test image and fail-closed fragment validation."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'.local/navigation-phase/loop-start/build/ota_1_v23.bin'
PREFIX=Path.home()/'xtensa-esp-elf/bin/xtensa-esp32s3-elf-'
sys.path.insert(0,str(ROOT/'tools'))

class CalleeCheckTests(unittest.TestCase):
    """D0 item 6: the stock callees are checked on their 3-byte entry instruction, and wb_device.c's callees are listed."""

    def test_entry_check_reads_the_register_and_the_opcode_fields(self):
        import wayback_device_build as b
        self.assertTrue(b.is_entry_a1(bytes.fromhex('368100')))
        self.assertTrue(b.is_entry_a1(bytes.fromhex('36a102')))
        self.assertFalse(b.is_entry_a1(bytes.fromhex('368300')))   # entry a3, not a1
        self.assertFalse(b.is_entry_a1(bytes.fromhex('370100')))   # another opcode
        self.assertFalse(b.is_entry_a1(bytes.fromhex('368110')))   # op2 is not 0

    def test_the_four_firmware_callees_of_the_adapter_are_listed(self):
        import wayback_device_build as b
        for address in (0x40381868, 0x403813c0, 0x403779f4, 0x403832e0):   # wb_device.c lines 65, 66, 70, 84
            self.assertIn(address, b.CALLED)

class WaybackDeviceBuildArgumentTests(unittest.TestCase):
    def test_base_is_required(self):
        # D0 item 1: no default base. A run without --base fails before any build, with a message.
        with tempfile.TemporaryDirectory() as tmp:
            p=subprocess.run([sys.executable,str(ROOT/'tools/wayback_device_build.py'),'--output',tmp],
                             capture_output=True,text=True)
            self.assertNotEqual(p.returncode,0)
            self.assertIn('--base',p.stderr)
            self.assertIn('required',p.stderr)

@unittest.skipUnless(BASE.exists() and Path(str(PREFIX)+'gcc').exists(),'private image/toolchain absent')
class WaybackDeviceBuildTests(unittest.TestCase):
    def test_free_space_below_the_reserve_is_refused(self):
        # D0 item 8: the cc23 code page keeps the 1,768 B reserve. A build that leaves less is refused.
        from unittest import mock
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)
            p=subprocess.run([sys.executable,str(ROOT/'tools/wayback_device_build.py'),'--base',str(BASE),'--output',str(out)],
                             capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stderr)
            import wayback_device_build as b
            r=json.loads((out/'receipt.json').read_text())
            with mock.patch.object(b,'PAGE_END',b.TAIL+r['code_bytes']+b.RESERVE-1):
                with self.assertRaisesRegex(ValueError,'reserve'):
                    b.build_candidate(BASE.read_bytes(),r['sections'],lambda n:(out/n).read_bytes())

    def test_real_build_scope_and_rejected_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)
            p=subprocess.run([sys.executable,str(ROOT/'tools/wayback_device_build.py'),
                              '--base',str(BASE),'--output',str(out)],capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stderr)
            import wayback_device_build as b
            r=json.loads((out/'receipt.json').read_text());base=BASE.read_bytes()
            read=lambda name:(out/name).read_bytes()
            image,receipt=b.build_candidate(base,r['sections'],read)
            self.assertEqual(image,(out/'ota_1_cc23wb1.bin').read_bytes())
            self.assertEqual(receipt['version'],'CC700_V1.414-cc23wb1')
            self.assertLessEqual(receipt['code_bytes'],4376)
            self.assertGreaterEqual(receipt['page_free_bytes'],1768)   # the reserve for one stability fix
            # Only the hook literal, the new tail and the version text differ from cc23.
            delta={d['segment']:d['changed_or_added_bytes'] for d in receipt['segment_delta']}
            self.assertEqual(sorted(delta),['0x3c1e0020','0x42000020'])
            self.assertEqual(delta['0x3c1e0020'],3)
            self.assertIn(delta['0x42000020']-receipt['code_bytes'],(1,2,3,4))
            # Own stack below the 3,360 B gate, before any firmware file call.
            frames=dict((l.rsplit(' ',1)[0].split('.')[0],int(l.rsplit(' ',1)[1])) for l in r['stack_usage'])
            own=frames['wb_rt']+frames['wbd_frame']+frames['wbd_run']+frames['wb_tick']+frames['load_node']+frames['rd']+frames['wbd_read']
            self.assertLessEqual(own,1488)
            with self.assertRaisesRegex(ValueError,'exact cc23'):
                b.build_candidate(base[:-1]+bytes([base[-1]^1]),r['sections'],read)
            sections=copy.deepcopy(r['sections']);sections['.text']['address']=hex(0x421de804)
            with self.assertRaisesRegex(ValueError,'outside scope'):
                b.build_candidate(base,sections,read)
            sections=copy.deepcopy(r['sections']);sections['.extra']=sections['.text']
            with self.assertRaisesRegex(ValueError,'inventory'):
                b.build_candidate(base,sections,read)
            with self.assertRaisesRegex(ValueError,'hash mismatch'):
                b.build_candidate(base,r['sections'],lambda n:bytes([read(n)[0]^1])+read(n)[1:] if n=='text.bin' else read(n))


class HookFrameTests(unittest.TestCase):
    """D0 item 3: the frame of wb_rt (the hook target) is 48 as the compiler built it, and any other frame is refused."""

    def test_frame_48_is_accepted_and_32_is_refused(self):
        import wayback_device_build as b
        b.check_hook_frame('0000 <wb_rt>:\n 421dedc8:\t006136\tentry\ta1, 48\n')
        with self.assertRaisesRegex(ValueError,'frame'):
            b.check_hook_frame('0000 <wb_rt>:\n 421dedc8:\t006136\tentry\ta1, 32\n')

if __name__=='__main__':unittest.main()
