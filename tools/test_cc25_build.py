#!/usr/bin/env python3
"""Tests for tools/cc25_build.py (C4). Needs the cc23 base image in .local/mining and the Xtensa tools.
Run: python3 -I tools/test_cc25_build.py"""
import hashlib
import importlib.util
import struct
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('cc25_build', ROOT / 'tools' / 'cc25_build.py')
cb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cb)

BASE = ROOT / '.local' / 'mining' / 'ota_1_cc23trampfix.bin'
OUT = ROOT / '.local' / 'cc25-test'
PREFIX = str(Path.home() / 'xtensa-esp-elf' / 'bin' / 'xtensa-esp32s3-elf-')
NM = PREFIX + 'nm'

_built = None


def built():
    global _built
    if _built is None:
        _built = cb.build(BASE, OUT, PREFIX)
    return _built


def segment_map(image):
    """Address -> bytes for each segment of an ESP image."""
    hdr, segs, _ = cb.esp_module().read(image)
    return {a: bytes(d) for a, d in segs}


@unittest.skipUnless(BASE.exists(), 'cc23 base image is not in .local/mining')
class Cc25Build(unittest.TestCase):

    def test_base_is_the_cc23_trampoline_fix(self):
        self.assertEqual(hashlib.sha256(BASE.read_bytes()).hexdigest(), cb.BASE_SHA)

    def test_wrong_base_is_refused(self):
        bad = bytearray(BASE.read_bytes())
        bad[len(bad) // 2] ^= 0x01
        OUT.mkdir(parents=True, exist_ok=True)
        path = OUT / 'bad_base.bin'
        path.write_bytes(bytes(bad))
        with self.assertRaises(ValueError):
            cb.build(path, OUT, PREFIX)

    def test_only_the_named_bytes_change(self):
        image, _ = built()
        before, after = segment_map(BASE.read_bytes()), segment_map(image)
        self.assertEqual(sorted(before), sorted(after), 'the same segment addresses')
        for addr, old in before.items():
            new = after[addr]
            self.assertGreaterEqual(len(new), len(old))
            allowed = []
            if addr == cb.IROM:
                allowed = [(cb.HOOK - cb.IROM, cb.HOOK - cb.IROM + 4), (len(old), len(new))]
            if addr == cb.DROM:
                allowed = [(cb.DROM_VERSION_AT, cb.DROM_VERSION_AT + 32)]
            for i in range(min(len(old), len(new))):
                if old[i] != new[i]:
                    self.assertTrue(any(a <= i < b for a, b in allowed), f'segment {addr:#x} byte {i} changed outside its scope')

    def test_hook_word_is_the_address_of_cc_entries(self):
        image, receipt = built()
        elf = Path(receipt['elf'])
        entry = None
        for line in subprocess.run([NM, str(elf)], capture_output=True, text=True, check=True).stdout.splitlines():
            parts = line.split()
            if len(parts) == 3 and parts[2] == 'cc_entries':
                entry = int(parts[0], 16)
        self.assertIsNotNone(entry)
        irom = segment_map(image)[cb.IROM]
        word = struct.unpack_from('<I', irom, cb.HOOK - cb.IROM)[0]
        self.assertEqual(word, entry)
        self.assertEqual(receipt['hook_target'], hex(entry))
        self.assertTrue(cb.TAIL <= entry < cb.TAIL + cb.CODE_MAX, 'cc_entries lies in the new code area')

    def test_called_functions_begin_with_an_entry_instruction(self):
        segs = segment_map(BASE.read_bytes())
        for addr in cb.CALLED:
            base = max(a for a in segs if a <= addr)
            self.assertEqual(segs[base][addr - base], 0x36, f'{addr:#x} must begin with entry')

    def test_no_undefined_symbols(self):
        _, receipt = built()
        out = subprocess.run([NM, '-u', receipt['elf']], capture_output=True, text=True, check=True).stdout
        self.assertEqual(out.strip(), '')

    def test_code_fits_the_limit(self):
        _, receipt = built()
        self.assertGreater(receipt['code_bytes'], 0)
        self.assertLessEqual(receipt['code_bytes'], cb.CODE_MAX)

    def test_free_space_below_the_reserve_is_refused(self):
        # D0 item 8: the cc23 code page keeps the 1,768 B reserve. A build that leaves less is refused.
        from unittest import mock
        _, receipt = built()
        with mock.patch.object(cb, 'PAGE_END', cb.TAIL + receipt['code_bytes'] + cb.RESERVE - 1):
            with self.assertRaisesRegex(ValueError, 'reserve'):
                cb.build_candidate(BASE.read_bytes(), receipt['sections'], lambda n: (OUT / n).read_bytes())

    def test_version_text_and_receipt(self):
        image, receipt = built()
        drom = segment_map(image)[cb.DROM]
        self.assertEqual(drom[cb.DROM_VERSION_AT:cb.DROM_VERSION_AT + len(cb.VERSION)], cb.VERSION)
        self.assertEqual(receipt['version'], 'CC700_V1.414-cc25')
        self.assertIs(receipt['device_written'], False)
        self.assertNotEqual(receipt['image_sha256'], hashlib.sha256(BASE.read_bytes()).hexdigest())


if __name__ == '__main__':
    unittest.main()
