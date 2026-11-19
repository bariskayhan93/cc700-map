"""cc27 structure (G8): only firmware/common/fw.h has stock addresses; the pure modules do not include fw.h.
Run: python3 -I tools/test_fw_addresses.py"""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WB = ROOT / 'firmware/wayback'
TREE = ['firmware/common', 'firmware/raster', 'firmware/view', 'firmware/elev', 'firmware/mapdraw', 'firmware/wayback']
ADDR = re.compile(r'0x(3c|3f|40|42)[0-9a-f]{6}', re.I)


def files(dirs):
    out = []
    for d in dirs:
        p = ROOT / d
        if p.is_dir():
            out += sorted(f for f in p.iterdir() if f.suffix in ('.c', '.h', '.S'))
    return out


class FwAddressTests(unittest.TestCase):
    def test_only_fw_h_has_stock_addresses(self):
        hits = [f'{p.relative_to(ROOT)}:{n}' for p in files(TREE) if p.name != 'fw.h'
                for n, line in enumerate(p.read_text().splitlines(), 1) if ADDR.search(line)]
        self.assertEqual(hits, [])

    def test_fw_h_is_in_common(self):
        self.assertTrue((ROOT / 'firmware/common/fw.h').exists())
        self.assertFalse((ROOT / 'firmware/mapdraw/fw.h').exists())

    def test_pure_modules_do_not_include_fw_h(self):
        pure = files(['firmware/raster', 'firmware/view', 'firmware/elev']) + [WB / 'wb_grey.c', WB / 'wb_grey_draw.c', WB / 'wayback.c']
        for p in pure:
            if p.exists():
                self.assertNotIn('"fw.h"', p.read_text(), str(p))


if __name__ == '__main__':
    unittest.main()
