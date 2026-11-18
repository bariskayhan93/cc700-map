"""Incoming reference scan (D0 item 2, R-D02). Real Xtensa assembly through the toolchain, and the real guidance and
loop-start bases. Run: python3 -I tools/test_incoming_refs.py"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import incoming_refs as ir  # noqa: E402

PREFIX = os.path.expanduser('~/xtensa-esp-elf/bin/xtensa-esp32s3-elf-')
ROOT = Path(__file__).resolve().parents[1]
GUIDANCE_BASE = ROOT / '.local/patch-v21/ota_1_v21.bin'
LOOP_BASE = ROOT / '.local/navigation-phase/guidance/release-cc22/ota_1_v22.bin'
STOCK = Path.home() / 'cc700-backup/parts/ota_0.bin'
BASE = 0x42000000
REAL = {'popup': (0x42049690, 0x20), 'card': (0x4205bdb0, 0x20), 'loop_l1': (0x420496d8, 0x40),
        'card_call_timer': (0x42081ee2, 3), 'card_call_initial': (0x420822cd, 3),
        'popup_call_timer': (0x420870ca, 3), 'popup_call_initial': (0x4208758d, 3), 'loop_call': (0x420547dd, 3)}


def assemble(source):
    with tempfile.TemporaryDirectory() as tmp:
        s, o, b = (os.path.join(tmp, n) for n in ('a.s', 'a.o', 'a.bin'))
        Path(s).write_text(source)
        subprocess.run([PREFIX + 'as', '-o', o, s], check=True)
        subprocess.run([PREFIX + 'objcopy', '-O', 'binary', o, b], check=True)
        return Path(b).read_bytes()


def pad(n):
    """nop.n padding of n bytes (n even). Zero bytes would desynchronise the decode, as in the stock data."""
    assert n % 2 == 0
    return 'nop.n\n' * (n // 2)


TRAMP = '.byte 0x36, 0x41, 0x00\n' + pad(20) + '.byte 0xe0, 0x08, 0x00, 0x1d, 0xf0\n'   # 0x1c B, tail at 0x17
SPAN = {BASE: BASE + 0x40}
RANGE = {'trampoline': (BASE + 0x20, 0x10)}
REQUIRES_TOOLCHAIN = unittest.skipUnless(Path(PREFIX + 'as').exists(), 'Xtensa toolchain absent')


@REQUIRES_TOOLCHAIN
class SyntheticReferenceTests(unittest.TestCase):
    def test_branch_from_outside_into_the_range_is_found(self):
        code = assemble('.text\n.org 0x0\n  j .Lout\n  .org 0x20\n  nop\n  nop\n  .org 0x80\n.Lout:\n  nop\n')
        code2 = assemble('.text\n.org 0x0\n  j .Linside\n  .org 0x20\n  nop\n.Linside:\n  nop\n  .org 0x80\n  nop\n')
        self.assertEqual(ir.incoming(ir.sweep(code, BASE, PREFIX + 'objdump'), RANGE)['trampoline'], [])
        self.assertEqual(len(ir.incoming(ir.sweep(code2, BASE, PREFIX + 'objdump'), RANGE)['trampoline']), 1)

    def test_a_clean_image_has_no_outside_and_no_dead_references(self):
        code = assemble('.text\n' + TRAMP + pad(4) + '  nop.n\n' + pad(46) + '  nop.n\n')
        receipt = ir.check(code, BASE, RANGE, SPAN, PREFIX + 'objdump')
        self.assertEqual(receipt, {'trampoline': {'outside': 0, 'dead': []}})

    def test_a_reference_from_inside_the_dead_span_is_listed_not_counted(self):
        code = assemble('.text\n' + TRAMP + pad(4) + '.L20:\n  nop.n\n' + pad(14) + '  j .L20\n')
        receipt = ir.check(code, BASE, RANGE, SPAN, PREFIX + 'objdump')
        self.assertEqual(receipt, {'trampoline': {'outside': 0, 'dead': ['0x42000030']}})

    def test_a_reference_from_outside_the_dead_span_fails_with_its_address(self):
        code = assemble('.text\n' + TRAMP + pad(4) + '.L20:\n  nop.n\n' + pad(30) + '  j .L20\n')
        with self.assertRaisesRegex(ValueError, 'incoming reference into trampoline: 0x42000040'):
            ir.check(code, BASE, RANGE, SPAN, PREFIX + 'objdump')

    def test_a_head_that_is_not_the_trampoline_fails(self):
        code = assemble('.text\n.byte 0x36, 0x41, 0x00\n.org 0x17\n.byte 0x00, 0x00, 0x00, 0x00, 0x00\n.org 0x40\n  nop\n')
        with self.assertRaisesRegex(ValueError, 'dead span head 0x42000000 is not the 0x1c B trampoline'):
            ir.check(code, BASE, RANGE, SPAN, PREFIX + 'objdump')


@unittest.skipUnless(GUIDANCE_BASE.exists() and Path(PREFIX + 'objdump').exists(), 'real base or toolchain absent')
class RealBaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.guidance = ir.load_irom(GUIDANCE_BASE)
        cls.loop = ir.load_irom(LOOP_BASE) if LOOP_BASE.exists() else None

    def test_real_guidance_base_passes_and_lists_the_popup_and_card_references_as_dead(self):
        ranges = {k: v for k, v in REAL.items() if k != 'loop_l1' and k != 'loop_call'}
        receipt = ir.check(self.guidance, 0x42000020, ranges, ir.DEAD_SPANS, PREFIX + 'objdump')
        self.assertEqual(receipt['popup']['outside'], 0)
        self.assertEqual(receipt['card']['outside'], 0)
        self.assertIn('0x42049768', receipt['popup']['dead'])
        self.assertIn('0x4205bdeb', receipt['card']['dead'])

    @unittest.skipUnless(LOOP_BASE.exists(), 'loop-start base absent')
    def test_real_loop_start_base_passes_and_lists_the_l1_reference_as_dead(self):
        ranges = {'loop_l1': REAL['loop_l1'], 'loop_call': REAL['loop_call']}
        receipt = ir.check(self.loop, 0x42000020, ranges, ir.DEAD_SPANS, PREFIX + 'objdump')
        self.assertEqual(receipt['loop_l1']['outside'], 0)
        self.assertIn('0x420496d5', receipt['loop_l1']['dead'])

    def test_a_linear_sweep_from_0x42049691_misses_only_dead_span_references(self):
        # Ruling (R-D02 test, 18 Nov): the guide asks for equal lists, but its own reason says a linear sweep can miss a
        # branch. The sweep from 0x42049691 misses bnei a0, 3 at 0x42049695 (into the L1 range, inside the dead span).
        # The per-function decode is the authority: it has every linear reference, plus only dead-span references.
        start = 0x42049691
        lin = ir.references(ir.instructions(ir.sweep(self.guidance[start - 0x42000020:], start, PREFIX + 'objdump')),
                            REAL)
        insts, _ = ir.per_function(self.guidance, 0x42000020, PREFIX + 'objdump')
        per = ir.references([i for i in insts if i[0] >= start], REAL)
        lin_set = {(name, src, t) for name, found in lin.items() for src, _, t in found}
        per_set = {(name, src, t) for name, found in per.items() for src, _, t in found}
        self.assertTrue(lin_set <= per_set)
        for name, src, _ in per_set - lin_set:
            self.assertTrue(0x42049670 <= src < 0x4204976c or 0x4205bd90 <= src < 0x4205bdf0, hex(src))

    @unittest.skipUnless(STOCK.exists(), 'stock backup absent')
    def test_dead_span_ends_are_stock_entries_with_no_stock_entry_inside(self):
        stock = ir.load_irom(STOCK)
        stock_entries = set(ir.entries(stock, 0x42000020))
        for start, end in ir.DEAD_SPANS.items():
            self.assertIn(end, stock_entries, hex(end))
            self.assertFalse([e for e in stock_entries if start < e < end], hex(start))


if __name__ == '__main__':
    unittest.main()
