"""Structural audit is not permission to resume or a firmware validity oracle."""
import struct
import unittest
import zlib
from recovery_session_audit import audit_recovery


def fixture(extra=b""):
    body=zlib.compress(b"known recording prefix")
    packed=struct.pack("<H",len(body))+body
    header=bytes([14,0x10])+struct.pack("<HI",2132,0)+b".FIT\0\0"
    record=bytearray(468)
    struct.pack_into("<I",record,0,631065700)
    struct.pack_into("<I",record,12,100)
    struct.pack_into("<I",record,456,len(packed))
    struct.pack_into("<I",record,464,0xaa555aa5)
    files={"/FITS/FIT/631065700.fit":b".ZIP"+header+packed+extra,
           "/FITS/LAP/631065700.lap":b""}
    return bytes(record),files


class RecoveryAudit(unittest.TestCase):
    def test_consistent_prefix_is_structural_only(self):
        data,files=fixture();result=audit_recovery(data,files)
        self.assertEqual(result["structural_status"],"consistent",result)
        self.assertEqual(result["runtime_ready"],False)
        self.assertEqual(result["would_truncate"],[])

    def test_report_recording_and_lap_truncation_without_mutating(self):
        data,files=fixture(b"newer activity bytes")
        files["/FITS/LAP/631065700.lap"]=b"123456789012"
        before=dict(files);result=audit_recovery(data,files)
        self.assertEqual(len(result["would_truncate"]),2)
        self.assertEqual(files,before)

    def test_invalid_size_and_footer_are_not_consistent(self):
        data,files=fixture()
        for bad in (data[:467],data+b"extra",data[:-4]+b"\0\0\0\0"):
            self.assertNotEqual(audit_recovery(bad,files)["structural_status"],"consistent")

    def test_missing_named_recording_is_a_gap(self):
        data,_=fixture();result=audit_recovery(data,{})
        self.assertEqual(result["structural_status"],"incomplete")
        self.assertIn("named recording absent",result["gaps"])

    def test_saved_offset_must_end_at_complete_chunk(self):
        data,files=fixture();bad=bytearray(data)
        offset=struct.unpack_from("<I",bad,456)[0]
        struct.pack_into("<I",bad,456,offset-1)
        self.assertEqual(audit_recovery(bad,files)["structural_status"],"invalid")

    def test_target_decoder_chunk_limits_are_checked(self):
        data,files=fixture();path="/FITS/FIT/631065700.fit"
        huge=zlib.compress(b"a"*1281);packed=struct.pack("<H",len(huge))+huge
        files[path]=files[path][:18]+packed
        data=bytearray(data);struct.pack_into("<I",data,456,len(packed))
        result=audit_recovery(data,files)
        self.assertEqual(result["structural_status"],"invalid")
        self.assertIn("inflated chunk exceeds 1280 bytes",result["errors"])

    def test_unsigned_offset_wrap_is_not_treated_as_small_file(self):
        data,files=fixture();data=bytearray(data)
        struct.pack_into("<I",data,456,0xffffffff)
        self.assertEqual(audit_recovery(data,files)["structural_status"],"invalid")


if __name__=="__main__":unittest.main()
