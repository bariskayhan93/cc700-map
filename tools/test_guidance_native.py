"""Private native fixture guards. Skip when own-device evidence is unavailable."""
from pathlib import Path
import importlib.util
import unittest

from guidance_build import NATIVE_GUARDS, assert_native_guards

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT/'.local/patch-v21/ota_1_v21.bin'
ESPIMG = ROOT.parent/'cc700-backup/tools/espimg.py'

@unittest.skipUnless(BASE.exists() and ESPIMG.exists(), 'private own-device fixture unavailable')
class NativeGuidanceFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        spec=importlib.util.spec_from_file_location('guidance_espimg',ESPIMG)
        mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
        segments=mod.read(BASE.read_bytes())[1]
        cls.irom=bytes(next(s[1] for s in segments if s[0]==0x42000020))

    def read(self,address,size):
        return self.irom[address-0x42000020:address-0x42000020+size]

    def test_real_native_sentinel_and_consumers_match_mined_hashes(self):
        assert_native_guards(self.read)
        # Native getter's unavailable return is movi.n a2,-1; the offset is
        # pinned by its extracted conditional-flow fixture, not a new C model.
        self.assertEqual(self.read(0x4204fdc9,2),bytes.fromhex('7cf2'))
        self.assertIn('remaining_formatter',NATIVE_GUARDS)

    def test_changed_sentinel_instruction_is_rejected(self):
        def corrupt(address,size):
            data=bytearray(self.read(address,size))
            if address==0x4204fd98: data[0x4204fdc9-address]^=1
            return bytes(data)
        with self.assertRaisesRegex(ValueError,'remaining_getter'):
            assert_native_guards(corrupt)

    def test_changed_formatter_is_rejected(self):
        def corrupt(address,size):
            data=bytearray(self.read(address,size))
            if address==0x42060540: data[-1]^=1
            return bytes(data)
        with self.assertRaisesRegex(ValueError,'remaining_formatter'):
            assert_native_guards(corrupt)

if __name__=='__main__': unittest.main()
