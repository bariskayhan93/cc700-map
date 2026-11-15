"""Real Xtensa image build and fail-closed fragment validation."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'.local/navigation-phase/guidance/release-cc22/ota_1_v22.bin'
PREFIX=Path.home()/'xtensa-esp-elf/bin/xtensa-esp32s3-elf-'

@unittest.skipUnless(BASE.exists() and Path(str(PREFIX)+'gcc').exists(),'private image/toolchain absent')
class LoopBuildTests(unittest.TestCase):
    def test_real_build_roundtrip_and_rejected_drift(self):
        with tempfile.TemporaryDirectory() as tmp:
            out=Path(tmp)
            p=subprocess.run([sys.executable,str(ROOT/'tools/loop_start_build.py'),
                              '--output',str(out)],capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stderr)
            import loop_start_build as b
            m=json.loads((out/'manifest.json').read_text());base=BASE.read_bytes()
            read=lambda name:(out/name).read_bytes()
            image,receipt=b.build_candidate(base,m['sections'],read)
            self.assertEqual(image,(out/'ota_1_v23.bin').read_bytes())
            self.assertEqual(receipt['version'],'CC700_V1.414-cc23')
            self.assertTrue(receipt['structural_roundtrip'])
            self.assertGreater(receipt['page_free_bytes'],4000)
            with self.assertRaisesRegex(ValueError,'exact cc22'):
                b.build_candidate(base[:-1]+bytes([base[-1]^1]),m['sections'],read)
            sections=copy.deepcopy(m['sections'])
            sections['.call_loop_start']['address']='0x420547e0'
            with self.assertRaisesRegex(ValueError,'scope'):
                b.build_candidate(base,sections,read)
            def corrupt(name):
                data=bytearray(read(name));data[-1]^=1;return bytes(data)
            with self.assertRaisesRegex(ValueError,'hash'):
                b.build_candidate(base,m['sections'],corrupt)
            sections=copy.deepcopy(m['sections'])
            sections.pop('.tramp_loop_start')
            with self.assertRaisesRegex(ValueError,'inventory'):
                b.build_candidate(base,sections,read)
