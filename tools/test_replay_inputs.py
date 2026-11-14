"""Regression checks for offline replay input integrity; no device needed."""
import ctypes
import struct
import tempfile
import unittest
import zlib
from unittest.mock import patch
from pathlib import Path

import cc700_replay
from fit_track import FIT_EPOCH, read_track


FIELDS = ((253, 4, 0x86), (0, 4, 0x85), (1, 4, 0x85))


def definition(global_type=20, local=0, developer=False, endian="<"):
    return (bytes([0x40 | local | (0x20 if developer else 0), 0, endian == ">"])
            + struct.pack(endian + "H", global_type) + bytes([3])
            + b"".join(bytes(f) for f in FIELDS)
            + (bytes([1, 0, 2, 0]) if developer else b""))


def fit_file(body):
    return bytes([14, 0x10]) + struct.pack("<HI", 0, len(body)) + b".FIT\0\0" + body


class ReplayInputs(unittest.TestCase):
    def decode(self, body, suffix=b""):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "track.fit"
            path.write_bytes(fit_file(body) + suffix)
            return read_track(path)

    def test_only_global_record_messages_are_positions(self):
        body = definition(999) + b"\0" + struct.pack("<Iii", 100, 10000, 20000)
        self.assertEqual(self.decode(body), [])

    def test_compressed_timestamp_rollover_and_omitted_timestamp(self):
        body = definition() + b"\0" + struct.pack("<Iii", 126, 10000, 20000)
        body += bytes([0x81]) + struct.pack("<ii", 11000, 21000)
        records = self.decode(body)
        self.assertEqual([r[0] for r in records], [FIT_EPOCH + 126, FIT_EPOCH + 129])

    def test_compressed_local_message_bits(self):
        body = definition(local=2) + b"\2" + struct.pack("<Iii", 100, 10000, 20000)
        body += bytes([0xc5]) + struct.pack("<ii", 11000, 21000)
        self.assertEqual([r[0] for r in self.decode(body)], [FIT_EPOCH + 100, FIT_EPOCH + 101])

    def test_developer_payload_does_not_shift_next_record(self):
        body = definition(developer=True)
        body += b"\0" + struct.pack("<Iii", 100, 10000, 20000) + b"\xff\xff"
        body += b"\0" + struct.pack("<Iii", 101, 11000, 21000) + b"\xff\xff"
        self.assertEqual([r[0] for r in self.decode(body)], [FIT_EPOCH + 100, FIT_EPOCH + 101])

    def test_declared_data_length_excludes_trailing_bytes(self):
        body = definition() + b"\0" + struct.pack("<Iii", 100, 10000, 20000)
        suffix = b"\0" + struct.pack("<Iii", 101, 11000, 21000)
        self.assertEqual(len(self.decode(body, suffix)), 1)

    def test_truncated_record_fails_instead_of_returning_partial_track(self):
        body = definition() + b"\0" + struct.pack("<Iii", 100, 10000, 20000)
        body += b"\0\x01"
        with self.assertRaises(ValueError):
            self.decode(body)

    def test_big_endian_and_invalid_coordinate(self):
        body = definition(endian=">")
        body += b"\0" + struct.pack(">Iii", 100, 0x7fffffff, 20000)
        body += b"\0" + struct.pack(">Iii", 101, 11000, 21000)
        self.assertEqual([r[0] for r in self.decode(body)], [FIT_EPOCH + 101])

    def test_cc700_container_has_two_trailing_checksum_bytes(self):
        body = definition() + b"\0" + struct.pack("<Iii", 100, 10000, 20000)
        compressed = zlib.compress(body)
        data = b".ZIP" + fit_file(body)[:14] + struct.pack("<H", len(compressed)) + compressed + b"\x48\xdc"
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "track.fit"
            path.write_bytes(data)
            self.assertEqual([r[0] for r in read_track(path)], [FIT_EPOCH + 100])

    def test_callback_preserves_two_distinct_segment_endpoints(self):
        factory = getattr(cc700_replay, "point_callback", None)
        self.assertIsNotNone(factory, "Replay needs stable addresses per point")
        ft = ctypes.c_float
        arr = (ft * 6)(0, 0, 0, 1, 1, 1)
        cb_type = ctypes.CFUNCTYPE(ctypes.c_void_p, ctypes.c_uint32)
        cb = factory(arr, cb_type)
        a, b = cb(0), cb(1)
        self.assertNotEqual(a, b)
        self.assertEqual(list((ft * 2).from_address(a)), [0, 0])
        self.assertEqual(list((ft * 2).from_address(b)), [0, 1])

    def test_missing_yaw_cannot_be_counted_as_visible(self):
        classify = getattr(cc700_replay, "visibility_proxy", None)
        self.assertIsNotNone(classify, "Missing log evidence must stay unknown")
        self.assertIsNone(classify(10, None, False))
        self.assertIs(classify(0, None, False), False)
        self.assertIs(classify(10, 1, False), False)
        self.assertIs(classify(10, None, True), True)

    def test_section_starts_include_shared_endpoint(self):
        data=bytearray(132)
        struct.pack_into("<I",data,0x5c,128)
        sections=[{"pts":[(1,1),(1,2)]},{"pts":[(1,2),(1,3)]}]
        with patch.object(cc700_replay,"route",return_value=(data,sections)):
            points,starts,_,_=cc700_replay.load_points_sections_blocks("fixture")
        self.assertEqual(starts,[0,1])
        self.assertEqual(points,[(1,1),(1,2),(1,3)])


if __name__ == "__main__":
    unittest.main()
