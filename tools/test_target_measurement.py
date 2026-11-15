"""Behavioral tests compile/run the real freestanding collector with a host lock."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

class TargetMeasurementTests(unittest.TestCase):
    def test_bounds_identity_failure_and_frozen_publication(self):
        with tempfile.TemporaryDirectory() as tmp:
            binary = Path(tmp) / 'journal-test'
            compiled = subprocess.run(['cc', '-std=c11', '-Wall', '-Wextra', '-Werror',
                '-pthread', '-I', str(ROOT / 'firmware/measurement'),
                str(ROOT / 'tools/target_measurement_test.c'),
                str(ROOT / 'firmware/measurement/journal.c'), '-o', str(binary)],
                capture_output=True, text=True)
            self.assertEqual(compiled.returncode, 0, compiled.stderr)
            result = subprocess.run([str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)



class TargetAbiTests(unittest.TestCase):
    def test_rejects_unpinned_image_before_disassembly(self):
        import target_measurement_abi as abi
        with self.assertRaisesRegex(ValueError, 'pinned stock'):
            abi.verify(b'not firmware')

    def test_exact_local_image_ranges(self):
        import target_measurement_abi as abi
        path = ROOT.parent / 'cc700-backup/parts/ota_0.bin'
        if not path.exists(): self.skipTest('private stock image unavailable')
        result = abi.verify(path.read_bytes())
        self.assertEqual(result['clock']['address'], '0x403779f4')
        self.assertFalse(result['installable'])
        self.assertEqual(result['task_identity']['getter_address'],'0x403832e0')
        self.assertEqual(result['task_identity']['active_tcb_array'],'0x3fc9ef64')
        self.assertEqual(result['task_identity']['rejected_idle_getter'],'0x403829dc')
        self.assertGreater(len(result['ranges']), 8)
        modified=bytearray(path.read_bytes()); modified[100]^=1
        with self.assertRaises(ValueError): abi.verify(modified)

class TargetProbeTests(unittest.TestCase):
    def test_navigation_probe_exports_separate_guarded_scalar_observation(self):
        import target_measurement as tm
        with tempfile.TemporaryDirectory() as tmp:
            binary=Path(tmp)/'navigation'
            result=subprocess.run(['cc','-std=c11','-Wall','-Wextra','-Werror',
                '-DTM_HOST','-DTM_NAVIGATION_STATE','-I',str(ROOT/'firmware/measurement'),
                str(ROOT/'tools/target_navigation_probe_test.c'),
                str(ROOT/'firmware/measurement/probe.c'),'-o',str(binary)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            result=subprocess.run([str(binary)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            parsed=tm.parse_navigation_line(result.stdout.strip())
            self.assertEqual(parsed['ticks_us'],[9000000000,9000000001])
            self.assertEqual(parsed['entry_count'],491)
            self.assertEqual(parsed['ride_state_raw'],4)
            self.assertEqual(parsed['arrival_state'],0)
            self.assertEqual(parsed['matched_point'],559)
            self.assertEqual(parsed['firmware_section'],111)
            self.assertEqual(parsed['snapshot_threshold'],559)
            self.assertEqual(parsed['matcher_flags'],{'offroute':0,'valid':1,'candidate':1})
            self.assertTrue(parsed['repeated_fields_equal'])
            self.assertFalse(parsed['atomic_snapshot'])
            self.assertFalse(parsed['performance_observation'])
            with self.assertRaises(ValueError):tm.parse_navigation_line(result.stdout.replace('000001eb','000001ec'))
            with self.assertRaises(ValueError):tm.parse_navigation_line(result.stdout[:80])
            def reencode(values):
                body=''.join(f'{v:08x} ' for v in values);checksum=2166136261
                for byte in body.encode():checksum=((checksum^byte)*16777619)&0xffffffff
                return 'CC7N1 '+body+f'{checksum:08x}'
            words=[int(w,16) for w in result.stdout[6:].split()[:-1]]
            words[15]=5
            self.assertFalse(tm.parse_navigation_line(reencode(words))['repeated_fields_equal'])
            words[2]=words[0]-1
            with self.assertRaisesRegex(ValueError,'Nonmonotonic'):
                tm.parse_navigation_line(reencode(words))
            log=Path(tmp)/'nav.log';log.write_text(result.stdout)
            cli=subprocess.run(['python3',str(ROOT/'tools/target_measurement.py'),str(log)],capture_output=True,text=True)
            self.assertEqual(cli.returncode,0,cli.stderr)
            import json
            decoded=json.loads(cli.stdout)
            self.assertFalse(decoded['performance_samples_present'])
            self.assertEqual(len(decoded['navigation_observations']),1)
            self.assertEqual(decoded['rejected'],[])

    def test_runtime_window_and_no_export_inside_interval(self):
        with tempfile.TemporaryDirectory() as tmp:
            binary=Path(tmp)/'probe-test'
            result=subprocess.run(['cc','-std=c11','-Wall','-Wextra','-Werror','-DTM_HOST',
                '-I',str(ROOT/'firmware/measurement'),str(ROOT/'tools/target_measurement_probe_test.c'),
                str(ROOT/'firmware/measurement/probe.c'),'-o',str(binary)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            run=subprocess.run([str(binary)],capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr)
            import target_measurement as tm
            parsed=tm.parse_line(run.stdout.strip())
            self.assertEqual(parsed['iterator_us'],3)
            self.assertEqual(parsed['lock_acquisition_us'],1)
            self.assertNotIn('mutex_wait_us',parsed)
            self.assertEqual(parsed['draw_locked_us'],1)
            self.assertEqual(parsed['mutex_hold_lower_bound_us'],1)
            self.assertEqual(parsed['mutex_hold_upper_bound_us'],3)
            self.assertNotIn('mutex_hold_us',parsed)
            self.assertEqual(parsed['decoded_pointer'],4660)
            with self.assertRaises(ValueError): tm.parse_line(run.stdout.strip().replace('00001234','00001235'))
            with self.assertRaises(ValueError): tm.parse_line('CC7M1 00000000')


class TargetBuildTests(unittest.TestCase):
    def test_extended_capture_window_accepts_late_navigation_and_expires(self):
        import target_measurement_build as build
        flags=build.window_defines(600)
        with tempfile.TemporaryDirectory() as tmp:
            source=Path(tmp)/'window.c';binary=Path(tmp)/'window'
            source.write_text('#include "probe.h"\n#include <assert.h>\nstatic uint64_t boot;\nstatic unsigned heaps;\nuint64_t tm_clock(void){return 1;}\nuint64_t tm_boot_clock(void){return boot;}\nint tm_ready(void){return 1;}\nuint32_t tm_stack(uint32_t *low){*low=1024;return 4096;}\nvoid tm_heap(uint32_t *out,uint32_t caps){(void)caps;for(int i=0;i<7;i++)out[i]=0;heaps++;}\nvoid tm_usb_char(uint32_t fd,uint32_t byte){(void)fd;(void)byte;assert(0);}\nvoid tm_usb_flush(void){assert(0);}\nint main(void){tm_probe p;boot=180000000;assert(tm_probe_begin(&p));\nboot=599999999;assert(tm_probe_begin(&p));assert(heaps==2);\nboot=600000000;assert(!tm_probe_begin(&p));assert(heaps==2);return 0;}\n')
            result=subprocess.run(['cc','-std=c11','-Wall','-Wextra','-Werror','-DTM_HOST',*flags,
                '-I',str(ROOT/'firmware/measurement'),str(source),
                str(ROOT/'firmware/measurement/probe.c'),'-o',str(binary)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            result=subprocess.run([str(binary)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
        for invalid in (0,601,-1,1.5,True):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):build.window_defines(invalid)

    def test_instrumentation_refuses_drift_and_brackets_actual_lock(self):
        import target_measurement_build as build
        source='void cc_iter(proj_cb_t cb) {\n  fw_blk_lock();\n      const ent_t *e = &E[i];\n  fw_blk_unlock();\n}'
        changed=build.instrument(source)
        self.assertLess(changed.index('tm_probe_begin(&measurement)'),changed.index('fw_blk_lock();'))
        self.assertLess(changed.index('fw_blk_unlock();'),changed.index('tm_probe_end('))
        self.assertNotIn('tm_probe_navigation(',changed)
        navigation=build.instrument(source,navigation=True)
        self.assertLess(navigation.index('tm_probe_end('),navigation.index('tm_probe_navigation('))
        with self.assertRaises(ValueError): build.instrument('void cc_iter(void) {}')

class TargetModeTests(unittest.TestCase):
    def test_composition_and_block_delegate_without_nested_export(self):
        for mode in ('TM_COMPOSITION','TM_BLOCK'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as tmp:
                binary=Path(tmp)/'modes'
                result=subprocess.run(['cc','-std=c11','-Wall','-Wextra','-Werror','-DTM_HOST','-D'+mode,
                    '-I',str(ROOT/'firmware/measurement'),str(ROOT/'tools/target_measurement_modes_test.c'),
                    str(ROOT/'firmware/measurement/probe.c'),'-o',str(binary)],capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                if result.stdout.startswith('CC7'):
                    import target_measurement as tm
                    sample=tm.parse_line(result.stdout.strip())
                    self.assertNotIn('mutex_hold_us',sample)
                    axis='map_composition_us' if mode=='TM_COMPOSITION' else 'block_load_us'
                    self.assertEqual(sample[axis],11)
                result=subprocess.run([str(binary)],capture_output=True,text=True)
                self.assertEqual(result.returncode,0,result.stderr)
                if result.stdout.startswith('CC7'):
                    import target_measurement as tm
                    sample=tm.parse_line(result.stdout.strip())
                    self.assertNotIn('mutex_hold_us',sample)
                    axis='map_composition_us' if mode=='TM_COMPOSITION' else 'block_load_us'
                    self.assertEqual(sample[axis],11)


class TargetStartupTests(unittest.TestCase):
    def test_startup_selftest_bypasses_window_and_registry_gate_then_preserves_arg(self):
        with tempfile.TemporaryDirectory() as tmp:
            binary=Path(tmp)/'startup'
            result=subprocess.run(['cc','-std=c11','-Wall','-Wextra','-Werror','-DTM_HOST','-DTM_DIAGNOSTIC',
                '-I',str(ROOT/'firmware/measurement'),str(ROOT/'tools/target_measurement_startup_test.c'),
                str(ROOT/'firmware/measurement/probe.c'),'-o',str(binary)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            result=subprocess.run([str(binary)],capture_output=True,text=True)
            self.assertEqual(result.returncode,0,result.stderr)
            import target_measurement as tm
            diag=tm.parse_diagnostic_line(result.stdout.strip())
            self.assertEqual(diag['raw_clock_us'],9000000123)
            self.assertEqual(diag['boot_clock_us'],1234)
            self.assertEqual(diag['usb_registry_callback'],0x42000000)
            self.assertEqual(diag['stack_remaining_bytes'],4096)

if __name__ == '__main__': unittest.main()
