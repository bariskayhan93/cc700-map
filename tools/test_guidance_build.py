"""Own-device candidate image roundtrip and fail-closed fragment checks."""
import copy
import sys
import importlib.util
import json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import subprocess
import sys
import tempfile
import unittest

if __package__:
    from .guidance_build import build_candidate, assert_native_guards, VERSION
else:
    from guidance_build import build_candidate, assert_native_guards, VERSION

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'.local/patch-v21/ota_1_v21.bin'
ESPIMG=ROOT.parent/'cc700-backup/tools/espimg.py'
PREFIX=Path.home()/'xtensa-esp-elf/bin/xtensa-esp32s3-elf-'

@unittest.skipUnless(BASE.exists() and ESPIMG.exists() and Path(str(PREFIX)+'gcc').exists(),
                     'private firmware/toolchain unavailable')
class GuidanceCandidateBuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory()
        cls.out=Path(cls.tmp.name)
        subprocess.run([sys.executable,str(ROOT/'tools/guidance_build.py'),
                        '--output',str(cls.out)],check=True,capture_output=True,text=True)
        cls.base=BASE.read_bytes()
        cls.manifest=json.loads((cls.out/'manifest.json').read_text())
        cls.sections=cls.manifest['sections']
        spec=importlib.util.spec_from_file_location('guidance_build_espimg',ESPIMG)
        cls.espimg=importlib.util.module_from_spec(spec);spec.loader.exec_module(cls.espimg)

    @classmethod
    def tearDownClass(cls): cls.tmp.cleanup()

    def build(self,sections=None,read=None,base=None):
        return build_candidate(self.base if base is None else base,
            self.sections if sections is None else sections,
            read or (lambda name:(self.out/name).read_bytes()),self.espimg)

    def test_installable_candidate_structural_roundtrip_native_guards_and_delta(self):
        image,receipt=self.build()
        self.assertEqual(image,(self.out/'ota_1_v22.bin').read_bytes())
        header,segments,_=self.espimg.read(image)
        self.assertEqual(self.espimg.build(header,segments),image)
        before=self.espimg.read(self.base)[1]
        irom=next(d for a,d in segments if a==0x42000020)
        assert_native_guards(lambda a,n:bytes(irom[a-0x42000020:a-0x42000020+n]))
        for (oldaddr,old),(addr,data) in zip(before,segments):
            self.assertEqual(addr,oldaddr)
            if addr==0x3c1e0020:
                self.assertEqual(data[16:48],VERSION+bytes(32-len(VERSION)))
                self.assertEqual(data[:16],old[:16]);self.assertEqual(data[48:],old[48:])
            elif addr!=0x42000020: self.assertEqual(data,old)
        self.assertEqual(receipt['version'],'CC700_V1.414-cc22')
        self.assertTrue(receipt['structural_roundtrip'])
        self.assertEqual(len(receipt['segment_delta']),2)

    def test_fragment_hash_drift_rejected(self):
        def corrupt(name):
            data=bytearray((self.out/name).read_bytes())
            if name=='text.bin': data[-1]^=1
            return bytes(data)
        with self.assertRaisesRegex(ValueError,'hash/length mismatch'):
            self.build(read=corrupt)

    def test_fragment_baseline_drift_rejected(self):
        sections=copy.deepcopy(self.sections)
        sections['.tramp_guidance_card']['expected_base_hex']='00'
        with self.assertRaisesRegex(ValueError,'baseline drift'):
            self.build(sections=sections)

    def test_overlapping_fragments_rejected(self):
        sections=copy.deepcopy(self.sections)
        sections['.tramp_guidance_popup']['address']=sections['.tramp_guidance_card']['address']
        with self.assertRaisesRegex(ValueError,'fragment overlap'):
            self.build(sections=sections)

    def test_fragment_moved_outside_pinned_scope_rejected(self):
        sections=copy.deepcopy(self.sections)
        sections['.text']['address']='0x421de054'
        with self.assertRaisesRegex(ValueError,'outside pinned scope'):
            self.build(sections=sections)

    def test_changed_baseline_rejected(self):
        data=bytearray(self.base);data[-1]^=1
        with self.assertRaisesRegex(ValueError,'exact v21 baseline'):
            self.build(base=bytes(data))

    def test_missing_fragment_rejected(self):
        sections=copy.deepcopy(self.sections);sections.pop('.text')
        with self.assertRaisesRegex(ValueError,'section inventory differs'):
            self.build(sections=sections)

if __name__=='__main__': unittest.main()


class TrampolineFrameTests(unittest.TestCase):
    """D0 item 3: the frame of each trampoline is checked against a constant, and a stack argument is refused."""
    GOOD='tramp_guidance_card:\n  entry\ta1, 32\n  mov.n\ta10, a2\n  callx8\ta8\n  retw.n\n'

    def test_frame_32_without_a_stack_store_is_accepted(self):
        import guidance_build as g
        g.check_trampoline(self.GOOD,'card')

    def test_a_frame_other_than_32_is_refused(self):
        import guidance_build as g
        with self.assertRaisesRegex(ValueError,'frame'):
            g.check_trampoline(self.GOOD.replace('a1, 32','a1, 48'),'card')

    def test_a_stack_store_is_refused(self):
        import guidance_build as g
        with self.assertRaisesRegex(ValueError,'stack argument'):
            g.check_trampoline(self.GOOD.replace('callx8','s32i.n\ta9, a1, 0\n  callx8'),'card')
