"""Offline test-image construction only. No device is opened or programmed."""
import hashlib
from pathlib import Path
import sys
import unittest

from build_replay_probe import build_probe, BASE_SHA256, VERSION

sys.path.insert(0,str(Path(__file__).resolve().parents[2]/"cc700-backup/tools"))
from espimg import read, build


class ReplayProbe(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path=Path(__file__).resolve().parents[2]/"cc700-backup/patch/ota_1_v18.bin"
        if not path.is_file():raise unittest.SkipTest("preserved private v18 image unavailable")
        cls.base=path.read_bytes()

    def test_pinned_image_with_only_activation_and_version_changed(self):
        image,manifest=build_probe(self.base)
        self.assertEqual(hashlib.sha256(self.base).hexdigest(),BASE_SHA256)
        self.assertEqual(manifest["base_sha256"],BASE_SHA256)
        self.assertEqual(manifest["device_written"],False)
        hdr,segs,_=read(image)
        self.assertEqual(build(hdr,segs),image)
        _,before,_=read(self.base)
        for (addr,data),(original,old) in zip(segs,before):
            self.assertEqual(addr,original)
            diffs={i for i,(a,b) in enumerate(zip(data,old)) if a!=b}
            if addr==0x42000020:
                self.assertEqual(diffs,{0x42042605-addr,0x42042606-addr})
                self.assertEqual(data[0x42042605-addr:0x42042607-addr],bytes.fromhex('0c1a'))
            elif addr==0x3c1e0020:
                self.assertTrue(diffs<=set(range(16,48)))
                self.assertEqual(bytes(data[16:48]).rstrip(b'\0'),VERSION.encode())
            else:self.assertEqual(data,old)
        self.assertEqual(len(image),len(self.base))

    def test_unexpected_base_is_rejected_before_modification(self):
        image=bytearray(self.base);image[-1]^=1
        with self.assertRaisesRegex(ValueError,"pinned v18"):
            build_probe(bytes(image))

    def test_probe_cannot_be_used_as_its_own_base(self):
        image,_=build_probe(self.base)
        with self.assertRaisesRegex(ValueError,"pinned v18"):build_probe(image)


if __name__=="__main__":unittest.main()
