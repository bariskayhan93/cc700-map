"""Real Xtensa image build and fail-closed fragment validation."""
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
            # Observed worker budget before the wrapper/retry frames: 3280 B.
            # Catch stack growth that makes the unchanged 3072 B gate skip there.
            frames={}
            for line in (out/'loop-start.elf-loop_start.su').read_text().splitlines():
                label,size,_=line.split('\t');frames[label.rsplit(':',1)[1]]=int(size)
            self.assertGreaterEqual(3280-frames['cc_loop_match']-frames['retry_start'],3072,
                                    'observed worker cannot enter departure retry')
            import loop_start_build as b
            m=json.loads((out/'manifest.json').read_text());base=BASE.read_bytes()
            read=lambda name:(out/name).read_bytes()
            image,receipt=b.build_candidate(base,m['sections'],read)
            self.assertEqual(image,(out/'ota_1_v24.bin').read_bytes())
            self.assertEqual(receipt['version'],'CC700_V1.414-cc24')
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


class TrampolineFrameTests(unittest.TestCase):
    """D0 item 3: the loop-start trampoline frame is 48 (the argument 7 copy), checked against a constant."""

    def test_frame_48_is_accepted_and_32_is_refused(self):
        import loop_start_build as l
        l.check_trampoline_frame('tramp_loop_start:\n entry a1,48\n')
        with self.assertRaisesRegex(ValueError,'frame'):
            l.check_trampoline_frame('tramp_loop_start:\n entry a1,32\n')
