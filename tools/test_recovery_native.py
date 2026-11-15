import json,math,subprocess,tempfile,unittest
from pathlib import Path
from recovery_native import Engine,ROOT
IDENT=bytes.fromhex('11'*32+'22'*32+'33'*32)
def pos(x,y=0):return round((51+y/111320)*1e7),round((7+x/(111320*math.cos(math.radians(51))))*1e7)
class NativeRecovery(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp=tempfile.TemporaryDirectory();dest=Path(cls.tmp.name)
        code="""import fs from 'node:fs';import {encodeRecoveryPackage} from './tools/recovery_package.mjs';
const p=(x,y=0)=>[51+y/111320,7+x/(111320*Math.cos(51*Math.PI/180))],meta={routeSha256:'11'.repeat(32),sourceSha256:'22'.repeat(32),policySha256:'33'.repeat(32),entryMin:0,entryMax:25000,center:p(0)},portal={geometry:[p(0),p(100),p(200)],distanceMeters:200,targetVisit:100000,targetBearing:90,segmentGuards:[[],[]]};
fs.writeFileSync(process.argv[1]+'/plain.bin',encodeRecoveryPackage([portal],meta));const many={...portal,geometry:Array.from({length:21},(_,i)=>p(i*10)),segmentGuards:Array.from({length:20},()=>[])};fs.writeFileSync(process.argv[1]+'/many.bin',encodeRecoveryPackage([many],meta));const uturn={...portal,geometry:[p(0,0),p(100,0),p(100,3),p(0,3)],targetBearing:270,segmentGuards:[[],[],[]]};fs.writeFileSync(process.argv[1]+'/uturn.bin',encodeRecoveryPackage([uturn],meta));portal.segmentGuards=[[{a:p(0,3),b:p(100,3)}],[]];fs.writeFileSync(process.argv[1]+'/guard.bin',encodeRecoveryPackage([portal],meta));"""
        subprocess.run(['node','--input-type=module','-e',code,str(dest)],cwd=ROOT,check=True,capture_output=True)
        cls.plain=(dest/'plain.bin').read_bytes();cls.guard=(dest/'guard.bin').read_bytes();cls.many=(dest/'many.bin').read_bytes();cls.uturn=(dest/'uturn.bin').read_bytes()
    @classmethod
    def tearDownClass(cls):cls.tmp.cleanup()
    def engine(self,data=None):
        e=Engine(IDENT,experimental=True);self.assertTrue(e.mount(data or self.plain));self.tick(e,1000,20,flags=1|4|8,progress_cm=10000);return e
    def tick(self,e,now,x,y=0,flags=1|2|8,**kw):
        lat,lon=pos(x,y);d=dict(now_ms=now,fix_ms=now,epoch=7,progress_cm=10000,lat_e7=lat,lon_e7=lon,speed_kmh=60,accuracy_m=5,heading_deg=90,flags=flags,overlay_points=512);d.update(kw);return e.tick(**d)
    def test_default_refusal_binding_and_corrupt_bytes(self):
        self.assertFalse(Engine(IDENT).mount(self.plain));self.assertFalse(Engine(bytes(96),experimental=True).mount(self.plain))
        for at in (0,8,12,120,len(self.plain)-1):
            b=bytearray(self.plain);b[at]^=1;self.assertFalse(Engine(IDENT,experimental=True).mount(bytes(b)))
    def test_active_tracks_full_leg_and_overlay_is_admitted(self):
        e=self.engine();a=self.tick(e,2000,30);self.assertEqual(a['state'],2);self.assertEqual(a['overlay'],1);self.assertEqual(a['suppress_native_cues'],1)
        b=self.tick(e,6000,110);self.assertEqual(b['state'],2);self.assertLess(b['distance_cm'],a['distance_cm']);self.assertAlmostEqual(e.point(0)[1],pos(110)[1],delta=3)
        self.assertEqual(self.tick(e,7000,120,overlay_points=0)['overlay'],0)
    def test_denied_parallel_geometry_and_outside_corridor_are_unavailable(self):
        e=self.engine(self.guard);r=self.tick(e,2000,30,3);self.assertEqual(r['state'],1);self.assertEqual(r['reason'],7);self.assertEqual(r['overlay'],0)
        e=self.engine();self.assertEqual(self.tick(e,2000,30,40)['state'],1)
    def test_pause_stale_gps_epoch_and_clock_gap_clear_actionable_state(self):
        for fields in ({'speed_kmh':0},{'fix_ms':0},{'epoch':8},{'accuracy_m':30}):
            e=self.engine();self.tick(e,2000,30);r=self.tick(e,7000,40,**fields);self.assertEqual(r['overlay'],0);self.assertEqual(r['distance_cm'],0xffffffff)
        e=self.engine();self.tick(e,2000,30);r=self.tick(e,9000,40);self.assertEqual(r['reason'],4)
    def test_wrong_pass_does_not_restore_and_five_fresh_fixes_do(self):
        e=self.engine();self.tick(e,2000,30)
        r=self.tick(e,3000,200,flags=1|4|8,progress_cm=0);self.assertEqual(r['state'],3);self.assertEqual(r['suppress_native_cues'],1)
        for n in range(5):r=self.tick(e,4000+n*1000,200,flags=1|4|8,progress_cm=100000)
        self.assertEqual(r['state'],0);self.assertEqual(r['suppress_native_cues'],0);self.assertIsNone(e.point(0))
    def test_repeated_same_fix_never_counts_as_five_rejoin_observations(self):
        e=self.engine();self.tick(e,2000,30)
        for n in range(5):r=self.tick(e,3000+n*100,200,flags=1|4|8,progress_cm=100000,fix_ms=3000)
        self.assertEqual(r['state'],3)

    def test_late_leg_segment_is_not_mistaken_for_rejoin_sample_count(self):
        e=self.engine(self.many);r=self.tick(e,2000,125);self.assertEqual(r['state'],2)
        r=self.tick(e,3000,200,flags=1|4|8,progress_cm=100000);self.assertEqual(r['state'],3)

    def test_alternating_cached_rejoin_fixes_never_restore(self):
        e=self.engine();self.tick(e,2000,30)
        for now,fix in zip([3100,3200,3300,3400,3500],[3000,3100,3000,3100,3000]):r=self.tick(e,now,200,flags=1|4|8,progress_cm=100000,fix_ms=fix)
        self.assertEqual(r['state'],3);self.assertEqual(r['suppress_native_cues'],1)
    def test_opposite_nonadjacent_leg_is_still_a_source_conflict(self):
        e=self.engine(self.uturn);r=self.tick(e,2000,30,3);self.assertEqual(r['state'],1);self.assertEqual(r['reason'],7);self.assertEqual(r['overlay'],0)
    def test_clock_gap_on_rejoin_requires_new_stability(self):
        e=self.engine();self.tick(e,2000,30);r=self.tick(e,9000,200,flags=1|4|8,progress_cm=100000);self.assertEqual(r['state'],3)
    def test_structural_corruption_with_recomputed_crc_and_read_failure(self):
        import struct,zlib
        for at,kind,value in [(120,'H',65),(128,'I',0),(160+16,'I',65535),(160+52,'I',0),(160+28,'I',1)]:
            b=bytearray(self.plain);struct.pack_into('<'+kind,b,at,value);b[12:16]=bytes(4);struct.pack_into('<I',b,12,zlib.crc32(b));self.assertFalse(Engine(IDENT,experimental=True).mount(bytes(b)))
        e=self.engine();e.mem.size=0;r=self.tick(e,2000,30);self.assertEqual(r['reason'],12);self.assertIsNone(e.point(0))
    def test_verified_alternate_rejoin_restores_without_visiting_old_target(self):
        e=self.engine();self.tick(e,2000,30)
        for n in range(5):r=self.tick(e,3000+n*1000,110,flags=1|4,progress_cm=30000,heading_deg=0,speed_kmh=2)
        self.assertEqual(r['state'],0);self.assertEqual(r['suppress_native_cues'],0)
