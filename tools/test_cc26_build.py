"""cc26 candidate builder (D5): the adapter in the second code area of the stock C4 image. Host only: no device.
Real C4 base and the device toolchain. Run: python3 -I tools/test_cc26_build.py"""
import hashlib
import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import cc26_build as cb  # noqa: E402

C4 = ROOT / '.local/cc25/ota_1_cc25.bin'
PREFIX = Path.home() / 'xtensa-esp-elf/bin/xtensa-esp32s3-elf-'


def segments(image):
    spec = importlib.util.spec_from_file_location('espimg', ROOT.parent / 'cc700-backup/tools/espimg.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    _, segs, _ = m.read(image)
    return {a: bytes(d) for a, d in segs}


@unittest.skipUnless(C4.exists() and Path(str(PREFIX) + 'gcc').exists(), 'C4 image or Xtensa toolchain absent')
class Cc26BuildTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = C4.read_bytes()
        cls.tmp = tempfile.TemporaryDirectory()
        cls.image, cls.receipt = cb.build(cls.base, Path(cls.tmp.name))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def test_a_base_that_is_not_the_c4_image_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'expected exact C4 base'):
            cb.build(self.base[:-1], Path(self.tmp.name))

    def test_only_the_planned_bytes_change(self):
        b, o = segments(self.base), segments(self.image)
        self.assertEqual(sorted(o), sorted([0, 0x3c1e0020, 0x42000020, 0x3fc9d0dc, 0x40374000, 0x3fc98200]))
        self.assertEqual(o[0x3fc9d0dc], b[0x3fc9d0dc])
        self.assertEqual(o[0x40374000], b[0x40374000])
        self.assertEqual(o[0x3fc98200], b[0x3fc98200])
        self.assertEqual(o[0x3c1e0020][:16], b[0x3c1e0020][:16])
        self.assertEqual(o[0x3c1e0020][48:len(b[0x3c1e0020])], b[0x3c1e0020][48:])
        irom_b, irom_o = b[0x42000020], o[0x42000020]
        diff = [i for i in range(len(irom_b)) if irom_b[i] != irom_o[i]]
        word = set(range(0x420496b8 - 0x42000020, 0x420496bc - 0x42000020))
        self.assertTrue(diff and set(diff) <= word, diff)   # the hook word; the top byte 0x42 is unchanged

    def test_the_hook_word_points_into_the_second_area(self):
        word = int(self.receipt['hook_target'], 16)
        self.assertTrue(0x4237b134 <= word < 0x42380000, hex(word))
        self.assertEqual(int.from_bytes(self.image_hook(), 'little'), word)

    def image_hook(self):
        return segments(self.image)[0x42000020][0x420496b8 - 0x42000020:0x420496bc - 0x42000020]

    def test_code_fits_the_area_and_nm_is_empty(self):
        self.assertLessEqual(self.receipt['code_bytes'], 20172)
        self.assertEqual(self.receipt['undefined_symbols'], '')

    def test_called_firmware_entries_begin_with_entry(self):
        cb.check_called(self.base)

    def test_the_hook_word_has_no_outside_literal_reference(self):
        self.assertEqual(self.receipt['incoming']['hook']['outside'], 0)
        self.assertTrue(self.receipt['incoming']['hook']['dead'])

    def test_version_and_mark_and_no_device_write(self):
        self.assertTrue(re.fullmatch(r'CC700_V1\.414-cc26-[0-9a-f]{7}', self.receipt['version']), self.receipt['version'])
        self.assertIs(self.receipt['device_written'], False)
        self.assertEqual(self.receipt['base_sha256'], cb.BASE_SHA)
        self.assertEqual(hashlib.sha256(self.image).hexdigest(), self.receipt['image_sha256'])


if __name__ == '__main__':
    unittest.main()
