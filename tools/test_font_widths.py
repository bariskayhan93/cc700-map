"""Glyph widths of the stock map fonts (plan Task 4). Real C4 base. Run: python3 -I -m unittest discover -s tools -p test_font_widths.py"""
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'tools'))
import font_widths as fw  # noqa: E402


class FontWidths(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.w = fw.widths((ROOT / '.local/cc25/ota_1_cc25.bin').read_bytes())

    def test_every_char_has_a_plausible_width(self):
        for name in ('big', 'small'):
            for c, px in self.w[name].items():
                self.assertTrue(1 <= px <= 20, f'{name} {c!r} {px}')

    def test_the_header_matches_the_base(self):
        self.assertEqual((ROOT / 'firmware/elev/elev_font.h').read_text(), fw.header(self.w))


if __name__ == '__main__':
    unittest.main()
