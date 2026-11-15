"""Synthetic validation fixtures; these are never target calibration evidence."""
import copy
import importlib.util
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

MODULE = pathlib.Path(__file__).with_name('resource_calibration.py')


def fixture():
    identity = {key: 'a' * 64 for key in ('test_image_sha256', 'base_image_sha256', 'route_sha256', 'source_sha256', 'collector_sha256')}
    identity.update(device_id='fixture-only', cpu_hz=240000000)
    sample = dict(block_id='0', section_id='0', layers=['roads'], camera=dict(latitude=0, longitude=0, heading=0, zoom=1),
                  surface=[240, 256], state=dict(recording=False, radio=False, replanning=False),
                  timings_us=dict(frame=100, iterator=30, mutex_wait=1, mutex_hold=29, projection=10, raster=12, text=2, fill=0, canvas=3, flush=20, block_load=10),
                  heap=dict(internal=dict(free_bytes=10000, largest_bytes=8000, minimum_bytes=7000)),
                  work=dict(projection_callbacks=10, projected_points=30, fill_vertices=0, label_bytes=4, decoded_bytes=100, serialized_bytes=150))
    sample['heap'] = {f'internal@{phase}': copy.deepcopy(sample['heap']['internal']) for phase in ('before_load','serialized_allocated','old_decoded_freed','new_decoded_allocated','serialized_freed','frame_end')}
    runs=[]
    for split in ('train', 'held_out'):
        for n in range(3):
            runs.append(dict(run_id=f'{split}-{n}', split=split, workload='city', temperature='warm', samples=[copy.deepcopy(sample) for _ in range(10)]))
    return dict(schema='cc700-resource-capture-v1', provenance=dict(origin='target', frozen=True, clock='monotonic_us', clock_verified=True, identity_verified=True, overhead_us=1, overflow=0, dropped_samples=0, disturbance='none'), identity=identity, runs=runs)


class ResourceCalibrationTests(unittest.TestCase):
    def analyze(self, capture, **kwargs):
        self.assertTrue(MODULE.exists(), 'resource calibration analyzer not implemented')
        spec=importlib.util.spec_from_file_location('resource_calibration', MODULE)
        module=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.analyze_capture(capture, expected_identity=fixture()['identity'], required_strata=[('city','warm')], **kwargs)

    def test_empirical_axes_and_held_out_distributions(self):
        result=self.analyze(fixture())
        group=result['strata']['city/warm']
        self.assertEqual(group['train']['timings_us.frame']['p95'],100)
        self.assertEqual(group['envelope']['upper']['timings_us.frame'],110)
        self.assertEqual(group['envelope']['lower']['heap.internal@frame_end.largest_bytes'],7272)
        self.assertEqual(group['held_out']['covered_samples'],30)
        self.assertTrue(result['accepted'])
        self.assertFalse(result['budget_increase_authorized'])

    def test_rejects_bad_or_stale_evidence(self):
        mutations=[lambda d:d['provenance'].update(origin='host'), lambda d:d['provenance'].update(overflow=1), lambda d:d['provenance'].update(dropped_samples=1), lambda d:d['provenance'].update(identity_verified=False), lambda d:d['identity'].update(route_sha256='b'*64), lambda d:d['runs'][0]['samples'][0]['timings_us'].update(frame=float('nan')), lambda d:d['runs'][0]['samples'][0]['work'].update(decoded_bytes=-1), lambda d:d['runs'][0]['samples'][0]['heap']['internal@frame_end'].update(largest_bytes=2**64), lambda d:d['runs'][0]['samples'][0].pop('camera')]
        for mutate in mutations:
            data=fixture(); mutate(data)
            with self.subTest(mutation=mutate):
                with self.assertRaises(ValueError): self.analyze(data)

    def test_no_extrapolation_or_single_run_acceptance(self):
        data=fixture(); data['runs'][3]['samples'][0]['work']['projection_callbacks']=11
        result=self.analyze(data)
        self.assertFalse(result['accepted'])
        self.assertEqual(result['strata']['city/warm']['held_out']['outside_work_domain'],1)
        data=fixture(); data['runs']=data['runs'][:1]+data['runs'][3:4]
        self.assertFalse(self.analyze(data)['accepted'])

    def test_held_out_regression_and_missing_workload_fail(self):
        data=fixture(); data['runs'][3]['samples'][0]['timings_us']['frame']=200
        self.assertFalse(self.analyze(data)['accepted'])
        spec=importlib.util.spec_from_file_location('resource_calibration', MODULE)
        module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        self.assertFalse(module.analyze_capture(fixture(),expected_identity=fixture()['identity'])['accepted'])

    def test_run_leakage_rejected(self):
        data=fixture(); data['runs'][3]['run_id']=data['runs'][0]['run_id']
        with self.assertRaises(ValueError): self.analyze(data)

    def test_requires_load_phase_heap_and_consistent_timing_boundaries(self):
        data=fixture(); data['runs'][0]['samples'][0]['heap'].pop('internal@serialized_allocated')
        with self.assertRaises(ValueError): self.analyze(data)
        data=fixture(); data['runs'][0]['samples'][0]['timings_us']['mutex_hold']=101
        with self.assertRaises(ValueError): self.analyze(data)

    def test_malformed_objects_and_extreme_integers_are_rejected_cleanly(self):
        for key in ('provenance', 'runs'):
            data=fixture(); data[key]=[]
            with self.subTest(key=key):
                with self.assertRaises(ValueError): self.analyze(data)
        data=fixture(); data['runs'][0]['samples'][0]['work']['label_bytes']=10**1000
        with self.assertRaises(ValueError): self.analyze(data)
        data=fixture(); data['runs'][0]['samples'][0]['camera']=None
        with self.assertRaises(ValueError): self.analyze(data)

    def test_cli_outputs_json_without_nan_and_rejects_invalid_input(self):
        self.assertTrue(MODULE.exists(), 'resource calibration analyzer not implemented')
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'capture.json'; identity=pathlib.Path(tmp)/'identity.json'
            path.write_text(json.dumps(fixture())); identity.write_text(json.dumps(fixture()['identity']))
            run=subprocess.run([sys.executable,str(MODULE),str(path),'--expected-identity',str(identity)],capture_output=True,text=True)
            self.assertEqual(run.returncode,0,run.stderr)
            self.assertFalse(json.loads(run.stdout)['accepted'])
            path.write_text('{"bad": NaN}')
            run=subprocess.run([sys.executable,str(MODULE),str(path),'--expected-identity',str(identity)],capture_output=True,text=True)
            self.assertNotEqual(run.returncode,0)
            self.assertIn('error',json.loads(run.stdout))

class PartialObservationTests(unittest.TestCase):
    def capture(self):
        import hashlib
        words=[0x3c100000,10,240,256,100,0,101,0,130,0,132,0,1,10000,8000,7000,9900,7900,6900]
        body=''.join(f'{word:08x} ' for word in words)
        checksum=2166136261
        for byte in body.encode(): checksum=((checksum^byte)*16777619)&0xffffffff
        raw=f'CC7M1 {body}{checksum:08x} \n'
        receipt=dict(verified=True, root_receipt_sha256='c'*64, raw_log_sha256=hashlib.sha256(raw.encode()).hexdigest(),
                     block_id='0', section_id='0', layers=['roads'], camera=dict(latitude=0,longitude=0,heading=0,zoom=1),
                     state=dict(recording=False,radio=False,replanning=False), clock_verified=True)
        runs=[dict(run_id=f'{split}-{i}',split=split,workload='city',temperature='warm',receipt=copy.deepcopy(receipt),manifest=dict(mode='iterator',image_sha256=fixture()['identity']['test_image_sha256']),raw_serial=raw)
              for split in ('train','held_out') for i in range(3)]
        return dict(schema='cc700-observed-capture-v1',identity=fixture()['identity'],runs=runs)

    def analyze(self,data):
        spec=importlib.util.spec_from_file_location('resource_calibration_partial',MODULE)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module.analyze_observations(data,expected_identity=fixture()['identity'])

    def test_partial_summary_uses_only_checked_observed_channels(self):
        result=self.analyze(self.capture())
        self.assertEqual(result['status'],'incomplete')
        self.assertFalse(result['accepted'])
        self.assertFalse(result['budget_increase_authorized'])
        group=result['strata']['city/warm/iterator']
        self.assertEqual(group['train']['iterator_us']['maximum'],32)
        self.assertEqual(group['train']['heap_after.largest_bytes']['minimum'],7900)
        self.assertNotIn('frame_us',group['train'])
        self.assertEqual(group['held_out']['covered_samples'],3)
        self.assertEqual(group['work_domain']['entry_count'],[10,10])

    def test_guarded_variants_preserve_stack_observations_and_cap(self):
        import hashlib
        for prefix,mode,channel in [('CC7M3','iterator','iterator'),('CC7F2','composition','map_composition'),('CC7B2','block','block_load')]:
            data=self.capture()
            for run in data['runs']:
                words=run['raw_serial'][6:].split()[:-1]
                if mode=='iterator':words+=['00000064','00000004','00000008']
                words+=['00000c80','00000400']  # 3200 remaining; capped 1024-byte A5 scan
                body=''.join(word+' ' for word in words)
                checksum=2166136261
                for byte in body.encode():checksum=((checksum^byte)*16777619)&0xffffffff
                run['raw_serial']=f'{prefix} {body}{checksum:08x} \n'
                run['manifest']['mode']=mode
                run['receipt']['raw_log_sha256']=hashlib.sha256(run['raw_serial'].encode()).hexdigest()
            group=self.analyze(data)['strata']['city/warm/'+channel]
            self.assertEqual(group['train']['stack_remaining_bytes']['minimum'],3200)
            self.assertEqual(group['train']['stack_a5_prefix_bytes']['maximum'],1024)
            self.assertEqual(group['stack_a5_scan_capped_samples'],6)
            self.assertIn('stack_remaining_bytes',group['envelope']['lower'])
            self.assertFalse(group['stack_is_full_high_water'])

    def test_manifest_mode_and_image_binding_reject_prefix_relabeling(self):
        for mutation in ('mode','image','missing'):
            data=self.capture()
            if mutation=='mode':data['runs'][0]['manifest']['mode']='composition'
            elif mutation=='image':data['runs'][0]['manifest']['image_sha256']='d'*64
            else:data['runs'][0].pop('manifest')
            with self.subTest(mutation=mutation):
                with self.assertRaises(ValueError):self.analyze(data)

    def test_partial_composition_and_block_do_not_invent_work_prediction(self):
        import hashlib
        for prefix,channel,duration in [('CC7F1','map_composition','map_composition_us'),('CC7B1','block_load','block_load_us')]:
            data=self.capture()
            for run in data['runs']:
                run['raw_serial']=run['raw_serial'].replace('CC7M1',prefix)
                run['manifest']['mode']='composition' if prefix=='CC7F1' else 'block'
                run['receipt']['raw_log_sha256']=hashlib.sha256(run['raw_serial'].encode()).hexdigest()
            group=self.analyze(data)['strata']['city/warm/'+channel]
            self.assertEqual(group['train'][duration]['maximum'],29)
            self.assertEqual(group['work_domain'],{})
            self.assertIsNone(group['held_out']['covered_samples'])
            self.assertNotIn('iterator_us',group['train'])

    def test_extended_iterator_geometry_counts_bound_held_out_domain(self):
        import hashlib
        data=self.capture()
        for run in data['runs']:
            words=run['raw_serial'][6:].split()[:-1]+['00000064','00000004','00000008']
            body=''.join(word+' ' for word in words)
            checksum=2166136261
            for byte in body.encode():checksum=((checksum^byte)*16777619)&0xffffffff
            run['raw_serial']=f'CC7M2 {body}{checksum:08x} \n'
            run['receipt']['raw_log_sha256']=hashlib.sha256(run['raw_serial'].encode()).hexdigest()
        group=self.analyze(data)['strata']['city/warm/iterator']
        self.assertEqual(group['work_domain']['input_geometry_points'],[100,100])
        self.assertEqual(group['work_domain']['input_fill_vertices'],[4,4])
        self.assertEqual(group['work_domain']['label_storage_bytes'],[8,8])
        self.assertEqual(group['held_out']['covered_samples'],3)

    def test_partial_held_out_work_escape_and_cli_remain_incomplete(self):
        import hashlib
        data=self.capture()
        run=data['runs'][3]
        words=run['raw_serial'][6:].split()
        words[1]='0000000b'  # held-out entry count 11, training domain exactly 10
        words[10]='000000e8'  # post-unlock timestamp 232, observed iterator 132 us
        body=''.join(word+' ' for word in words[:19])
        checksum=2166136261
        for byte in body.encode(): checksum=((checksum^byte)*16777619)&0xffffffff
        run['raw_serial']=f'CC7M1 {body}{checksum:08x} \n'
        run['receipt']['raw_log_sha256']=hashlib.sha256(run['raw_serial'].encode()).hexdigest()
        result=self.analyze(data)
        group=result['strata']['city/warm/iterator']
        self.assertEqual(group['held_out']['outside_work_domain'],1)
        self.assertEqual(group['held_out']['resource_violations'],1)
        self.assertEqual(group['held_out']['covered_samples'],2)
        with tempfile.TemporaryDirectory() as tmp:
            path=pathlib.Path(tmp)/'capture.json'; identity=pathlib.Path(tmp)/'identity.json'
            path.write_text(json.dumps(data)); identity.write_text(json.dumps(fixture()['identity']))
            process=subprocess.run([sys.executable,str(MODULE),str(path),'--partial','--expected-identity',str(identity)],capture_output=True,text=True)
            self.assertEqual(process.returncode,0,process.stderr)
            self.assertEqual(json.loads(process.stdout)['status'],'incomplete')

    def test_partial_rejects_corrupt_or_unverified_manifest(self):
        for mutation in ('checksum','identity','receipt','raw_hash'):
            data=self.capture()
            if mutation=='checksum':
                data['runs'][0]['raw_serial']=data['runs'][0]['raw_serial'].replace('00000064','00000065')
                import hashlib
                data['runs'][0]['receipt']['raw_log_sha256']=hashlib.sha256(data['runs'][0]['raw_serial'].encode()).hexdigest()
            elif mutation=='identity':data['identity']['route_sha256']='b'*64
            elif mutation=='receipt':data['runs'][0]['receipt']['verified']=False
            else:data['runs'][0]['receipt']['raw_log_sha256']='d'*64
            with self.subTest(mutation=mutation):
                with self.assertRaises(ValueError):self.analyze(data)

if __name__=='__main__': unittest.main()
