"""Run the real departure wrapper against explicit native-service fixtures."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]

class LoopStartTests(unittest.TestCase):
    def test_departure_return_and_rejected_retry(self):
        with tempfile.TemporaryDirectory() as tmp:
            binary=Path(tmp)/'loop-start'
            p=subprocess.run(['cc','-std=c11','-Wall','-Wextra','-Werror','-DHOST',
                '-I',str(ROOT/'firmware/loop_start'),str(ROOT/'tools/loop_start_host.c'),
                str(ROOT/'firmware/loop_start/loop_start.c'),'-lm','-o',str(binary)],
                capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stderr)
            p=subprocess.run([str(binary)],capture_output=True,text=True)
            self.assertEqual(p.returncode,0,p.stderr)

if __name__=="__main__":unittest.main()
