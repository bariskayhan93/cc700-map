"""Guarded programming must restore exact ordinary firmware on every test path."""
import hashlib
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
import target_probe_session as session

class Backend:
    def __init__(self,base,fail=None):self.base=base;self.calls=[];self.fail=fail
    def read(self,address,length,path):
        self.calls.append(('read',address,length))
        path.write_bytes(self.base if address==session.OTA1 else (b'bad' if self.fail=='shortmeta' else b'selection'+b'\xff'*(0x2000-9)))
    def write(self,address,path):
        self.calls.append(('write',address,path.name))
        if self.fail=='write' and path.name=='probe.bin':raise RuntimeError('partial programming')
    def verify(self,address,path):
        self.calls.append(('verify',address,path.name))
        if self.fail=='verify' and path.name=='probe.bin':raise RuntimeError('probe verify')
    def capture(self,path,seconds):
        self.calls.append(('capture',seconds));path.write_bytes(b'boot')
        if self.fail=='capture':raise RuntimeError('capture failed')
        return {'boot_confirmed':True,'samples':0}
    def boot(self):self.calls.append(('boot',));return {'boot_confirmed':self.fail!='boot'}

class ProbeSession(unittest.TestCase):
    def run_case(self,fail=None,wrong=False):
        tmp=tempfile.TemporaryDirectory();self.addCleanup(tmp.cleanup);p=Path(tmp.name)
        ordinary=p/'ordinary.bin';ordinary.write_bytes(b'ordinary')
        probe=p/'probe.bin';probe.write_bytes(b'test probe')
        backend=Backend((b'WRONG' if wrong else b'ordinary')+b'\xff'*(session.OTA1_SIZE-(5 if wrong else 8)),fail)
        config={'ordinary_sha256':hashlib.sha256(ordinary.read_bytes()).hexdigest(),'probe_sha256':hashlib.sha256(probe.read_bytes()).hexdigest()}
        return session.run_probe(ordinary,probe,p/'session',backend,config,1),backend
    def test_success_restores_full_backup_and_verifies_boot(self):
        result,b=self.run_case();self.assertEqual(result['phase'],'restored');self.assertTrue(result['ordinary_restored'])
        writes=[c for c in b.calls if c[0]=='write'];self.assertEqual(writes,[('write',session.OTA1,'probe.bin'),('write',session.OTA1,'ota1-before.bin')])
        self.assertEqual(b.calls[-1],('boot',))
        self.assertEqual(result['capture']['samples'],0) # Boot is not a measured frame.
    def test_partial_write_and_failed_capture_always_restore(self):
        for fail in ('write','verify','capture'):
            with self.subTest(fail=fail):
                result,b=self.run_case(fail);self.assertEqual(result['phase'],'restored-after-error');self.assertTrue(result['ordinary_restored']);self.assertIn('error',result)
                self.assertIn(('verify',session.OTA1,'ota1-before.bin'),b.calls)
    def test_unknown_live_image_stops_before_writes_and_boots(self):
        result,b=self.run_case(wrong=True);self.assertEqual(result['phase'],'stopped-before-write');self.assertFalse(any(c[0]=='write' for c in b.calls));self.assertEqual(b.calls[-1],('boot',))
    def test_failed_restoration_boot_is_not_success(self):
        result,b=self.run_case('boot');self.assertEqual(result['phase'],'recovery-required');self.assertFalse(result['ordinary_restored'])

    def test_short_ota_metadata_stops_before_programming(self):
        result,b=self.run_case('shortmeta');self.assertEqual(result['phase'],'stopped-before-write');self.assertFalse(any(c[0]=='write' for c in b.calls))

class BootEvidence(unittest.TestCase):
    def test_partial_connect_reset_then_one_explicit_stable_boot(self):
        data=b'rst:0x15 (USB_UART_CHIP'+b'ESP-ROM\nrst:0x15 (USB_UART_CHIP_RESET)\nLoaded app from partition at offset 0x440000\n'
        self.assertTrue(session.classify_boot(data,explicit_reset=True)['boot_confirmed'])
        self.assertFalse(session.classify_boot(data,explicit_reset=False)['boot_confirmed'])
        self.assertFalse(session.classify_boot(data+b'Guru Meditation',explicit_reset=True)['boot_confirmed'])
    def test_rebooting_or_wrong_partition_is_not_stable(self):
        load=b'Loaded app from partition at offset 0x440000\n'
        self.assertFalse(session.classify_boot(load*2,explicit_reset=True)['boot_confirmed'])
        self.assertFalse(session.classify_boot(b'Loaded app from partition at offset 0x20000\n')['boot_confirmed'])

if __name__=="__main__":unittest.main()
