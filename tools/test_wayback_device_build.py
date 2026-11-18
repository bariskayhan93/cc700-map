"""Shared callee checks of the way-back device builds (tools/wayback_device_build.py)."""
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'tools'))

class CalleeCheckTests(unittest.TestCase):
    """D0 item 6: the stock callees are checked on their 3-byte entry instruction, and wb_device.c's callees are listed."""

    def test_entry_check_reads_the_register_and_the_opcode_fields(self):
        import wayback_device_build as b
        self.assertTrue(b.is_entry_a1(bytes.fromhex('368100')))
        self.assertTrue(b.is_entry_a1(bytes.fromhex('36a102')))
        self.assertFalse(b.is_entry_a1(bytes.fromhex('368300')))   # entry a3, not a1
        self.assertFalse(b.is_entry_a1(bytes.fromhex('370100')))   # another opcode
        self.assertFalse(b.is_entry_a1(bytes.fromhex('368110')))   # op2 is not 0

    def test_the_four_firmware_callees_of_the_adapter_are_listed(self):
        import wayback_device_build as b
        for address in (0x40381868, 0x403813c0, 0x403779f4, 0x403832e0):   # wb_device.c lines 65, 66, 70, 84
            self.assertIn(address, b.CALLED)


if __name__=='__main__':unittest.main()
