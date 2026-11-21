"""cc27 image builder (Task 13): the cc27 tree in the second code area of the stock C4 image. Host only: no device.
Real C4 base and the device toolchain. Run: python3 -I -m unittest discover -s tools -p test_cc27_build.py"""
import hashlib
import importlib.util
import re
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import cc27_build as cb  # noqa: E402

C4 = ROOT / '.local/cc25/ota_1_cc25.bin'
PREFIX = Path.home() / 'xtensa-esp-elf/bin/xtensa-esp32s3-elf-'


def segments(image):
    spec = importlib.util.spec_from_file_location('espimg', ROOT.parent / 'cc700-backup/tools/espimg.py')
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    _, segs, _ = m.read(image)
    return {a: bytes(d) for a, d in segs}


@unittest.skipUnless(C4.exists() and Path(str(PREFIX) + 'gcc').exists(), 'C4 image or Xtensa toolchain absent')
class Cc27BuildTests(unittest.TestCase):
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

    def test_code_keeps_the_1768_byte_reserve(self):
        self.assertLessEqual(self.receipt['code_bytes'], 18404)
        self.assertEqual(cb.CODE_LIMIT, 20172 - 1768)
        self.assertEqual(self.receipt['undefined_symbols'], '')

    def test_no_function_frame_above_512_bytes(self):
        frames = [int(s.rsplit(' ', 1)[1]) for s in self.receipt['stack_usage']]
        self.assertTrue(frames and max(frames) <= 512, max(frames))
        self.assertEqual(self.receipt['max_frame'], max(frames))

    def test_only_the_planned_bytes_change(self):
        b, o = segments(self.base), segments(self.image)
        self.assertEqual(sorted(o), sorted([0, 0x3c1e0020, 0x42000020, 0x3fc9d0dc, 0x40374000, 0x3fc98200]))
        for seg in (0x3fc9d0dc, 0x40374000, 0x3fc98200):
            self.assertEqual(o[seg], b[seg])
        self.assertEqual(o[0x3c1e0020][:16], b[0x3c1e0020][:16])                      # only the version text in DROM
        self.assertEqual(o[0x3c1e0020][48:len(b[0x3c1e0020])], b[0x3c1e0020][48:])
        irom_b, irom_o = b[0x42000020], o[0x42000020]
        diff = [i for i in range(len(irom_b)) if irom_b[i] != irom_o[i]]
        word = set()
        for lit in (0x420496b8, 0x42049678, 0x4205bd98):   # wb_rt, cc_iter, cc_line: the 3 literals
            word |= set(range(lit - 0x42000020, lit + 4 - 0x42000020))
        self.assertTrue(diff and set(diff) <= word, diff)

    def test_version_is_cc27_with_the_build_mark(self):
        self.assertTrue(re.fullmatch(r'CC700_V1\.414-cc27-[0-9a-f]{7}', self.receipt['version']), self.receipt['version'])
        drom = segments(self.image)[0x3c1e0020]
        self.assertEqual(drom[16:16 + len(self.receipt['version'])], self.receipt['version'].encode())
        self.assertIs(self.receipt['device_written'], False)
        self.assertEqual(self.receipt['base_sha256'], cb.BASE_SHA)
        self.assertEqual(hashlib.sha256(self.image).hexdigest(), self.receipt['image_sha256'])

    def test_the_hook_frame_is_the_pinned_value(self):
        self.assertEqual(self.receipt['hook_frame'], cb.HOOK_FRAME)

    def test_hook_words_point_into_the_second_area_and_have_no_outside_reference(self):
        word = int(self.receipt['hook_target'], 16)
        self.assertTrue(0x4237b134 <= word < 0x42380000, hex(word))
        self.assertEqual(self.receipt['incoming']['hook']['outside'], 0)
        self.assertEqual(sorted(self.receipt['map_hooks']), ['0x42049678', '0x4205bd98'])

    def test_called_firmware_entries_begin_with_entry_also_the_new_calls(self):
        for a in (0x403763e0, 0x40376398, 0x420494a4, 0x420494b8):
            self.assertIn(a, cb.CALLED)
        cb.check_called(self.base)

    def test_the_cc27_tree_is_built_from_the_working_tree(self):
        for n in ('raster.c', 'view.c', 'wb_grey_draw.c', 'map.c', 'wb_device.c'):
            self.assertIn(n, self.receipt['sources'])
        self.assertIn('rs_line', self.receipt['symbols'])
        self.assertNotIn('elev.c', self.receipt['sources'])
        self.assertNotIn('elev_draw', self.receipt['symbols'])


if __name__ == '__main__':
    unittest.main()
