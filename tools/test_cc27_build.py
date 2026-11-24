"""cc27 image builder (Task 13): the cc27 tree in the second code area of the stock C4 image. Host only: no device.
Real C4 base and the device toolchain. Run: python3 -I -m unittest discover -s tools -p test_cc27_build.py"""
import hashlib
import importlib.util
import re
import subprocess
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
        word |= set(range(0x4204ca2e - 0x42000020, 0x4204ca31 - 0x42000020))   # the call8 of the stock km overlay
        word |= set(range(0x4205bdd0 - 0x42000020, 0x4205bdec - 0x42000020))   # km_tramp, 0x1c B
        word |= set(range(0x4204dad5 - 0x42000020, 0x4204dad8 - 0x42000020))   # the call8 of the stock position handler
        word |= set(range(0x42049718 - 0x42000020, 0x42049718 + cb.GUARD_SIZE - 0x42000020))   # the state guard
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
        for a in (0x403763e0, 0x40376398, 0x420494a4, 0x420494b8, 0x4205bf0c):
            self.assertIn(a, cb.CALLED)
        cb.check_called(self.base)

    def test_the_cc27_tree_is_built_from_the_working_tree(self):
        for n in ('raster.c', 'view.c', 'wb_grey_draw.c', 'map.c', 'wb_device.c', 'elev.c'):
            self.assertIn(n, self.receipt['sources'])
        self.assertIn('rs_line', self.receipt['symbols'])
        for n in ('wb_km', 'el_draw', 'el_plain'):                 # the lens chart
            self.assertIn(n, self.receipt['symbols'])
        self.assertNotIn('elev_chart', self.receipt['symbols'])
        self.assertIn('km_tramp.S', self.receipt['sources'])

    def test_the_km_overlay_call_goes_to_km_tramp_and_km_tramp_to_wb_km(self):
        irom = segments(self.image)[0x42000020]
        at = lambda a, n: irom[a - 0x42000020:a - 0x42000020 + n]
        self.assertEqual(at(0x4204ca2e, 3), bytes.fromhex('253a0f'))            # call8 0x4205bdd0
        tramp = at(0x4205bdd0, 0x1c)
        self.assertEqual(tramp[:3], bytes.fromhex('364100'))                    # entry a1, 32
        self.assertEqual(tramp[0x17:0x1c], bytes.fromhex('e008001df0'))       # callx8 a8; retw.n
        word = int.from_bytes(tramp[8:12], 'little')
        self.assertEqual(hex(word), self.receipt['km_target'])
        self.assertTrue(0x4237b134 <= word < 0x42380000, hex(word))
        self.assertEqual(self.receipt['km_call'], {'at': '0x4204ca2e', 'old': 'e54d0f', 'new': '253a0f'})
        self.assertEqual(self.receipt['incoming']['km']['outside'], 0)

    def test_the_position_handler_call_goes_through_the_state_guard(self):
        # Route-exit crash 24 Nov (docs/research/route-exit-crash-2026-11-24.md): 0x4204dabc reads the navigation
        # state before the lock. The guard reads it again under the lock and skips the handler when it is below 2.
        irom = segments(self.image)[0x42000020]
        at = lambda a, n: irom[a - 0x42000020:a - 0x42000020 + n]
        self.assertEqual(self.receipt['guard_call'], {'at': '0x4204dad5', 'old': 'e5ba06', 'new': at(0x4204dad5, 3).hex()})
        self.assertEqual(cb.call8(0x4204dad5, 0x42049718), at(0x4204dad5, 3))
        g = at(0x42049718, cb.GUARD_SIZE)
        self.assertEqual(g[:3], bytes.fromhex('364100'))                        # entry a1, 32
        self.assertEqual(g[-2:], bytes.fromhex('1df0'))                         # retw.n
        self.assertIn((0x3fc9fc34).to_bytes(4, 'little'), g)                    # the navigation state word
        self.assertIn((0x42054684).to_bytes(4, 'little'), g)                    # the stock position handler
        self.assertLessEqual(0x42049718 + cb.GUARD_SIZE, 0x4204976c)            # inside the dead stock body
        self.assertEqual(self.receipt['incoming']['guard']['outside'], 0)

    def test_the_lens_module_runs_in_the_irom_tail_and_keeps_the_reserve(self):
        b, o = segments(self.base)[0x42000020], segments(self.image)[0x42000020]
        self.assertEqual(0x42000020 + len(b), 0x421debac)
        self.assertEqual(len(o) - len(b), self.receipt['tail_bytes'])
        self.assertGreater(self.receipt['tail_bytes'], 0)
        self.assertGreaterEqual(0x421e0000 - (0x42000020 + len(o)), 1768)
        self.assertEqual(self.receipt['tail_free'], 0x421e0000 - 0x42000020 - len(o))
        f = Path(self.tmp.name) / 'call.bin'
        f.write_bytes(o[0x4204ca2c - 0x42000020:0x4204ca34 - 0x42000020])
        dis = subprocess.run([str(PREFIX) + 'objdump', '-D', '-b', 'binary', '-m', 'xtensa', '--adjust-vma=0x4204ca2c', str(f)],
                             capture_output=True, check=True, text=True).stdout
        self.assertRegex(dis, r'4204ca2e:\s+253a0f\s+call8\s+0x4205bdd0')

    def test_the_cc29_label_patch_is_gone(self):
        self.assertNotIn('0x420949e3', open(ROOT / 'tools/cc27_build.py').read())

    def test_functions_that_the_unit_never_calls_are_not_in_the_image(self):   # -ffunction-sections: gc per function
        for name in ('wb_unmount', 'wb_line_info', 'rs_rect', '__divdi3'):
            self.assertNotIn(name, self.receipt['symbols'])


if __name__ == '__main__':
    unittest.main()
