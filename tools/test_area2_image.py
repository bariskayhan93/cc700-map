"""Second code area of the cc26 image (D4, E8): add_area2 keeps the stock segments and adds the code after the DROM
constants, at 0x3c37b134 (executed at the IROM alias 0x4237b134). Real C4 base. Run: python3 -I tools/test_area2_image.py"""
import hashlib
import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import area2_image as a2  # noqa: E402

C4 = ROOT / '.local/cc25/ota_1_cc25.bin'
CODE = bytes((i * 7) & 255 for i in range(19980))   # 19,980 B of code: within the 20,172 B area
C4_SHA = 'ac48ba3dfccd722b97676367f7f7f9b97c0b51871dcc71227b1ae3bd41676f96'
ESP = Path.home() / 'cc700-backup/tools/espimg.py'


def esp():
    spec = importlib.util.spec_from_file_location('espimg', ESP)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@unittest.skipUnless(C4.exists() and ESP.exists(), 'C4 image or espimg absent')
class Area2Tests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.base = C4.read_bytes()
        assert hashlib.sha256(cls.base).hexdigest() == C4_SHA
        cls.out = a2.add_area2(cls.base, CODE)
        _, cls.segs, _ = esp().read(cls.out)
        _, cls.bsegs, _ = esp().read(cls.base)

    def test_output_has_six_segments_in_the_planned_order(self):
        self.assertEqual([len(d) for a, d in self.segs if a == 0], [16])
        self.assertEqual([a for a, _ in self.segs],
                         [0x3c1e0020, 0, 0x42000020, 0x3fc9d0dc, 0x40374000, 0x3fc98200])
        self.assertEqual(self.out[1], 6)

    def test_stock_segments_keep_their_load_addresses_and_data(self):
        bdata = {a: d for a, d in self.bsegs}
        odata = {a: d for a, d in self.segs}
        self.assertEqual(odata[0x42000020], bdata[0x42000020])
        self.assertEqual(odata[0x3fc9d0dc], bdata[0x3fc9d0dc])
        self.assertEqual(odata[0x40374000], bdata[0x40374000])
        self.assertEqual(odata[0x3fc98200], bdata[0x3fc98200])
        self.assertEqual(odata[0x3c1e0020][:len(bdata[0x3c1e0020])], bdata[0x3c1e0020])

    def test_code_is_at_load_address_0x3c37b134_after_the_constants(self):
        bdrom = dict(self.bsegs)[0x3c1e0020]
        self.assertEqual(0x3c1e0020 + len(bdrom), 0x3c37b134)
        odrom = dict(self.segs)[0x3c1e0020]
        self.assertEqual(odrom[len(bdrom):len(bdrom) + len(CODE)], CODE)
        self.assertEqual(odrom[len(bdrom) + len(CODE):], bytes(len(odrom) - len(bdrom) - len(CODE)))

    def test_irom_file_offset_is_0x20_mod_64k_and_unchanged(self):
        def irom_offset(segs):
            off = 24
            for a, d in segs:
                if a == 0x42000020:
                    return off + 8
                off += 8 + len(d)
            raise AssertionError('no IROM')
        self.assertEqual(irom_offset(self.segs) % 65536, 0x20)
        self.assertEqual(irom_offset(self.segs), irom_offset(self.bsegs))

    def test_code_of_20173_bytes_is_refused(self):
        with self.assertRaisesRegex(ValueError, 'code area'):
            a2.add_area2(self.base, bytes(20173))

    def test_code_of_20172_bytes_is_accepted(self):
        out = a2.add_area2(self.base, bytes(20172))
        self.assertEqual(dict(esp().read(out)[1])[0x3c1e0020][-20172:], bytes(20172))

    def test_checksum_and_digest_are_valid(self):
        m = esp()
        hdr, segs, _ = m.read(self.out)
        self.assertEqual(m.build(hdr, segs), self.out)
        self.assertEqual(self.out[-32:], hashlib.sha256(self.out[:-32]).digest())

    def test_a_base_without_the_stock_constant_end_is_refused(self):
        bad = bytearray(self.base)
        m = esp()
        hdr, segs, _ = m.read(bytes(bad))
        segs[0][1] = segs[0][1][:-4]          # the constants end 4 bytes earlier
        with self.assertRaisesRegex(ValueError, 'constants'):
            a2.add_area2(m.build(hdr, segs), bytes(16))


if __name__ == '__main__':
    unittest.main()
