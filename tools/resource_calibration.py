#!/usr/bin/env python3
"""Strict target evidence validation and per-workload empirical resource envelopes.

Provenance fields are attestations, not cryptographic proof. Callers must verify
receipts against the actual target; this tool cannot authenticate a physical run.
"""
import argparse
import json
import math
import re
import sys

WORKLOADS = ('city', 'village', 'forest', 'polygon-heavy crossing', 'repeated block loads', 'off-route redraw')
TIMINGS = ('frame', 'iterator', 'mutex_wait', 'mutex_hold', 'projection', 'raster', 'text', 'fill', 'canvas', 'flush', 'block_load')
WORK = ('projection_callbacks', 'projected_points', 'fill_vertices', 'label_bytes', 'decoded_bytes', 'serialized_bytes')
HASHES = ('test_image_sha256', 'base_image_sha256', 'route_sha256', 'source_sha256', 'collector_sha256')
HEAP_PHASES = ('before_load', 'serialized_allocated', 'old_decoded_freed', 'new_decoded_allocated', 'serialized_freed', 'frame_end')
MAX_VALUE = 2**53 - 1  # exact JSON integer interoperability


def require(condition, message):
    if not condition:
        raise ValueError(message)


def number(value, name, integer=True):
    require(type(value) in (int, float) and 0 <= value <= MAX_VALUE and math.isfinite(value),
            f'{name}: expected finite nonnegative exact-range number')
    require(not integer or type(value) is int, f'{name}: expected integer')
    return value


def label(value, name):
    require(isinstance(value, str) and bool(value.strip()), f'{name}: missing identity')


def validate_identity(identity):
    require(isinstance(identity, dict), 'missing identity')
    for key in HASHES:
        require(isinstance(identity.get(key), str) and re.fullmatch('[0-9a-f]{64}', identity[key]), f'invalid {key}')
    label(identity.get('device_id'), 'device_id')
    require(number(identity.get('cpu_hz'), 'cpu_hz') > 0, 'cpu_hz must be positive')


def sample_axes(sample):
    require(isinstance(sample, dict), 'sample must be object')
    for key in ('block_id', 'section_id'):
        label(sample.get(key), key)
    require(isinstance(sample.get('layers'), list) and sample['layers'], 'missing layers')
    for layer in sample['layers']:
        label(layer, 'layer')
    camera = sample.get('camera', {})
    require(isinstance(camera, dict), 'invalid camera object')
    for key, low, high in (('latitude', -90, 90), ('longitude', -180, 180), ('heading', 0, 360), ('zoom', 0, MAX_VALUE)):
        value = camera.get(key)
        require(type(value) in (int, float) and low <= value <= high and math.isfinite(value), f'invalid camera {key}')
    require(camera['zoom'] > 0, 'zoom must be positive')
    require(sample.get('surface') == [240, 256], 'unsupported map surface')
    state = sample.get('state', {})
    require(isinstance(state, dict), 'invalid state object')
    require(all(type(state.get(k)) is bool for k in ('recording', 'radio', 'replanning')), 'missing subsystem state')
    axes = {}
    for section, fields in (('timings_us', TIMINGS), ('work', WORK)):
        require(isinstance(sample.get(section), dict), f'missing {section}')
        for field in fields:
            axes[f'{section}.{field}'] = number(sample[section].get(field), f'{section}.{field}')
    require(axes['timings_us.frame'] > 0, 'zero frame duration')
    require(axes['timings_us.mutex_wait'] + axes['timings_us.mutex_hold'] <= axes['timings_us.iterator'] <= axes['timings_us.frame'], 'inconsistent iterator/frame boundaries')
    for component in ('projection', 'raster', 'text', 'fill'):
        require(axes['timings_us.' + component] <= axes['timings_us.iterator'], 'component exceeds iterator')
    for component in ('canvas', 'flush'):
        require(axes['timings_us.' + component] <= axes['timings_us.frame'], 'component exceeds frame')
    heap = sample.get('heap')
    require(isinstance(heap, dict) and heap, 'missing capability heap observations')
    capabilities = set()
    for key in heap:
        require(isinstance(key, str) and key.count('@') == 1, 'heap key must be capability@phase')
        capability, phase = key.split('@')
        require(bool(capability) and phase in HEAP_PHASES, 'unknown heap phase')
        capabilities.add(capability)
    require(set(heap) == {f'{c}@{p}' for c in capabilities for p in HEAP_PHASES}, 'missing load/frame heap phases')
    for capability, observation in heap.items():
        label(capability, 'heap capability/phase')
        require(isinstance(observation, dict), 'invalid heap observation')
        for field in ('free_bytes', 'largest_bytes', 'minimum_bytes'):
            axes[f'heap.{capability}.{field}'] = number(observation.get(field), f'heap.{capability}.{field}')
        require(observation['largest_bytes'] <= observation['free_bytes'], 'largest block exceeds free heap')
        require(observation['minimum_bytes'] <= observation['free_bytes'], 'minimum exceeds current free heap')
    return axes


def distribution(values):
    values = sorted(values)
    return dict(count=len(values), minimum=values[0], p50=values[math.ceil(len(values)*.5)-1],
                p95=values[math.ceil(len(values)*.95)-1], p99=values[math.ceil(len(values)*.99)-1], maximum=values[-1])


def analyze_capture(capture, *, expected_identity, required_strata=None):
    """Validate receipt, train on separate runs, assess held-out observations.

    Acceptance establishes only internal envelope coverage for specified strata.
    It never establishes a deadline, hardware maximum, WCET or budget increase.
    """
    require(isinstance(capture, dict) and capture.get('schema') == 'cc700-resource-capture-v1', 'unsupported capture schema')
    validate_identity(expected_identity)
    validate_identity(capture.get('identity'))
    require(capture['identity'] == expected_identity, 'stale/mismatched target identity')
    p = capture.get('provenance', {})
    require(isinstance(p, dict), 'invalid provenance object')
    require(p.get('origin') == 'target', 'only actual target observations accepted')
    require(p.get('frozen') is True and p.get('clock_verified') is True and p.get('identity_verified') is True, 'unverified/unfrozen capture')
    require(p.get('clock') == 'monotonic_us', 'unverified target clock units')
    number(p.get('overhead_us'), 'overhead_us')
    require(type(p.get('overflow')) is int and p['overflow'] == 0 and type(p.get('dropped_samples')) is int and p['dropped_samples'] == 0, 'overflow or loss/unaccounted loss')
    require(p.get('disturbance') == 'none', 'disturbed timing capture')
    runs = capture.get('runs')
    require(isinstance(runs, list) and runs, 'missing runs')
    groups, seen, axis_names = {}, set(), None
    for run in runs:
        require(isinstance(run, dict), 'run must be object')
        label(run.get('run_id'), 'run_id')
        require(run['run_id'] not in seen, 'duplicate run identity/train-held-out leakage')
        seen.add(run['run_id'])
        require(run.get('split') in ('train', 'held_out'), 'invalid run split')
        require(run.get('workload') in WORKLOADS and run.get('temperature') in ('cold', 'warm'), 'invalid workload/temperature')
        samples = run.get('samples')
        require(isinstance(samples, list) and samples, 'empty run')
        key = (run['workload'], run['temperature'])
        group = groups.setdefault(key, {'train': [], 'held_out': [], 'train_runs': 0, 'held_out_runs': 0})
        group[run['split']+'_runs'] += 1
        for sample in samples:
            axes = sample_axes(sample)
            if axis_names is None:
                axis_names = set(axes)
            require(set(axes) == axis_names, 'inconsistent capability/phase axes')
            group[run['split']].append(axes)
    required = set(required_strata if required_strata is not None else ((w,t) for w in WORKLOADS for t in ('cold','warm')))
    require(required and all(w in WORKLOADS and t in ('cold','warm') for w,t in required), 'invalid required strata')
    result = dict(schema='cc700-resource-analysis-v1', identity=capture['identity'], accepted=True,
                  budget_increase_authorized=False, method='per-stratum empirical envelope; no extrapolation',
                  missing_strata=['/'.join(k) for k in sorted(required-set(groups))], strata={})
    for key, group in sorted(groups.items()):
        train, held = group['train'], group['held_out']
        upper, lower, domain = {}, {}, {}
        summary = {axis:distribution([row[axis] for row in train]) for axis in sorted(axis_names)} if train else {}
        for axis, stats in summary.items():
            if axis.startswith('work.'):
                domain[axis] = [stats['minimum'], stats['maximum']]
            elif axis.startswith('heap.'):
                lower[axis] = stats['minimum'] * 10 // 11
            else:
                upper[axis] = (stats['maximum'] * 11 + 9) // 10
        covered = outside = violations = 0
        for row in held:
            in_domain = bool(train) and all(low <= row[axis] <= high for axis,(low,high) in domain.items())
            within = bool(train) and all(row[a] <= v for a,v in upper.items()) and all(row[a] >= v for a,v in lower.items())
            outside += not in_domain
            violations += not within
            covered += in_domain and within
        enough = group['train_runs'] >= 3 and group['held_out_runs'] >= 3 and len(train) >= 30 and len(held) >= 30
        accepted = enough and covered == len(held)
        result['strata']['/'.join(key)] = dict(train=summary, train_runs=group['train_runs'], held_out_runs=group['held_out_runs'],
                envelope=dict(upper=upper, lower=lower, work_domain=domain),
                held_out=dict(samples=len(held), covered_samples=covered, outside_work_domain=outside, resource_violations=violations,
                              distributions={a:distribution([r[a] for r in held]) for a in sorted(axis_names)} if held else {}),
                sufficient_samples=enough, accepted=accepted)
        result['accepted'] &= accepted
    result['accepted'] &= not result['missing_strata']
    result['limitations'] = ['Provenance requires external target/receipt verification; JSON cannot authenticate physical origin.',
        'Observed envelope only; no WCET, causal resource model, deadline guarantee or unobserved workload prediction.',
        'At least 3 separate runs and 30 samples per split/stratum; correlated samples do not establish statistical confidence.',
        '10% empirical padding is a review heuristic, not a hardware safety margin; budgets remain unchanged.']
    return result


def analyze_observations(capture, *, expected_identity):
    """Summarize checksum-checked narrow probes with external run receipts.

    Incomplete by construction: no full-calibration acceptance, sample-loss
    guarantee, cross-mode time summation, or invented unmeasured channels.
    """
    import hashlib
    import importlib.util
    from pathlib import Path
    require(isinstance(capture, dict) and capture.get('schema') == 'cc700-observed-capture-v1', 'unsupported observed capture schema')
    validate_identity(expected_identity)
    validate_identity(capture.get('identity'))
    require(capture['identity'] == expected_identity, 'stale/mismatched target identity')
    spec = importlib.util.spec_from_file_location('_cc700_target_parser', Path(__file__).with_name('target_measurement.py'))
    parser = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(parser)
    runs = capture.get('runs')
    require(isinstance(runs, list) and runs, 'missing observed runs')
    groups, seen = {}, set()
    receipts = []
    for run in runs:
        require(isinstance(run, dict), 'run must be object')
        label(run.get('run_id'), 'run_id')
        require(run['run_id'] not in seen, 'duplicate observed run/train-held-out leakage')
        seen.add(run['run_id'])
        require(run.get('split') in ('train', 'held_out'), 'invalid run split')
        require(run.get('workload') in WORKLOADS and run.get('temperature') in ('cold', 'warm'), 'invalid workload/temperature')
        manifest = run.get('manifest')
        modes = {'iterator':'iterator','composition':'map_composition','block':'block_load'}
        require(isinstance(manifest, dict) and manifest.get('mode') in modes, 'missing/invalid probe manifest mode')
        require(manifest.get('image_sha256') == capture['identity']['test_image_sha256'], 'probe manifest image mismatch')
        expected_channel = modes[manifest['mode']]
        receipt = run.get('receipt')
        require(isinstance(receipt, dict) and receipt.get('verified') is True and receipt.get('clock_verified') is True, 'unverified external receipt/clock')
        for field in ('root_receipt_sha256', 'raw_log_sha256'):
            require(isinstance(receipt.get(field), str) and re.fullmatch('[0-9a-f]{64}',receipt[field]), 'missing receipt/log hash')
        for field in ('block_id', 'section_id'):
            label(receipt.get(field), field)
        require(isinstance(receipt.get('layers'), list) and receipt['layers'], 'missing receipt layers')
        for layer in receipt['layers']: label(layer, 'layer')
        camera = receipt.get('camera')
        require(isinstance(camera, dict), 'missing receipt camera')
        for field, low, high in (('latitude',-90,90),('longitude',-180,180),('heading',0,360),('zoom',0,MAX_VALUE)):
            value = camera.get(field)
            require(type(value) in (int,float) and low <= value <= high and math.isfinite(value), 'invalid receipt camera')
        require(camera['zoom'] > 0, 'invalid receipt zoom')
        state = receipt.get('state')
        require(isinstance(state, dict) and all(type(state.get(k)) is bool for k in ('recording','radio','replanning')), 'missing receipt subsystem state')
        raw = run.get('raw_serial')
        require(isinstance(raw,str) and raw, 'missing raw serial capture')
        require(hashlib.sha256(raw.encode()).hexdigest() == receipt['raw_log_sha256'], 'raw capture differs from verified receipt')
        receipts.append(dict(run_id=run['run_id'], root_receipt_sha256=receipt['root_receipt_sha256'], raw_log_sha256=receipt['raw_log_sha256']))
        parsed = []
        for line in raw.splitlines():
            if any(marker in line for marker in ('CC7M1','CC7M2','CC7M3','CC7F1','CC7F2','CC7B1','CC7B2')):
                parsed.append(parser.parse_line(line))  # Never accept caller-supplied decoded values.
        require(parsed, 'no observed telemetry lines')
        run_channels = set()
        for observation in parsed:
            channel = observation['channel']
            require(channel == expected_channel, 'telemetry channel differs from verified probe manifest mode')
            require(channel in ('iterator','map_composition','block_load'), 'unknown observed channel')
            key = '/'.join((run['workload'], run['temperature'], channel))
            group = groups.setdefault(key, dict(train=[],held_out=[],train_runs=0,held_out_runs=0,stack_a5_scan_capped_samples=0))
            if channel not in run_channels:
                group[run['split']+'_runs'] += 1
                run_channels.add(channel)
            axes = {k:number(v,k) for k,v in observation.items() if k.endswith('_us') and type(v) in (int,float)}
            # A count of entries is useful work, but requested road/type/pointers are identities,
            # never a surrogate for work or route/block file identity.
            for work_axis in ('entry_count','input_geometry_points','input_fill_vertices','label_storage_bytes'):
                if work_axis in observation:
                    axes[work_axis] = number(observation[work_axis], work_axis)
                    require(axes[work_axis] < 0xffffffff, 'saturated work count cannot establish observed work')
            for phase in ('heap_before','heap_after'):
                heap = observation[phase]
                for field in ('free_bytes','largest_bytes','minimum_bytes'):
                    axes[phase+'.'+field] = number(heap[field],phase+'.'+field)
                require(heap['largest_bytes'] <= heap['free_bytes'] and heap['minimum_bytes'] <= heap['free_bytes'], 'inconsistent observed heap')
            for stack_axis in ('stack_remaining_bytes','stack_a5_prefix_bytes'):
                if stack_axis in observation:
                    axes[stack_axis] = number(observation[stack_axis], stack_axis)
            if 'stack_a5_prefix_bytes' in axes:
                require(axes['stack_a5_prefix_bytes'] <= 1024, 'invalid bounded A5 prefix')
                group['stack_a5_scan_capped_samples'] += observation.get('stack_a5_scan_capped') is True
            if group['train'] or group['held_out']:
                first = (group['train'] or group['held_out'])[0]
                require(set(axes) == set(first), 'inconsistent observed axes')
            group[run['split']].append(axes)
    report = dict(schema='cc700-observed-analysis-v1',status='incomplete',accepted=False,budget_increase_authorized=False,
                  identity=capture['identity'],receipts=receipts,strata={},
                  sample_loss='unknown: checksum detects damaged lines, not omitted invocations',
                  disturbance='post-interval export perturbs following frames; these are instrumented observations',
                  missing_channels=['full native frame including canvas/flush','projection/raster/text/fill durations','load peak overlap phases','internal heap','full stack high water'],
                  limitations=['External receipt/hash verification required; JSON cannot authenticate physical origin.',
                              'Different probe modes/runs are not simultaneous; do not sum their timings.',
                              'Empirical observed maxima are not hardware maxima or WCET; no resource budget change.'])
    for key, group in sorted(groups.items()):
        train, held = group['train'], group['held_out']
        axes = sorted((train or held)[0])
        summary = {a:distribution([r[a] for r in train]) for a in axes} if train else {}
        upper = {a:(v['maximum']*11+9)//10 for a,v in summary.items() if a.endswith('_us')}
        lower = {a:v['minimum']*10//11 for a,v in summary.items() if a.startswith('heap_') or a.startswith('stack_')}
        domain = {a:[summary[a]['minimum'],summary[a]['maximum']] for a in ('entry_count','input_geometry_points','input_fill_vertices','label_storage_bytes') if a in summary}
        covered = outside = violations = 0
        for row in held:
            in_domain = bool(domain) and all(lo <= row[a] <= hi for a,(lo,hi) in domain.items())
            within = bool(train) and all(row[a] <= bound for a,bound in upper.items()) and all(row[a] >= bound for a,bound in lower.items())
            outside += bool(domain) and not in_domain
            violations += not within
            covered += in_domain and within
        report['strata'][key] = dict(train=summary,train_runs=group['train_runs'],held_out_runs=group['held_out_runs'],
            envelope=dict(upper=upper,lower=lower),work_domain=domain,
            stack_a5_scan_capped_samples=group['stack_a5_scan_capped_samples'],stack_is_full_high_water=False,
            held_out=dict(samples=len(held),covered_samples=covered if domain else None, outside_work_domain=outside if domain else None,
                          resource_violations=violations,distributions={a:distribution([r[a] for r in held]) for a in axes} if held else {}),
            prediction_assessment='observed-work-bounded empirical envelope only' if domain else 'unavailable: no observed work count in this channel',
            sufficient_samples=group['train_runs'] >= 3 and group['held_out_runs'] >= 3 and len(train) >= 30 and len(held) >= 30)
    return report


def load_json(path):
    def reject(value):
        raise ValueError(f'invalid JSON numeric constant: {value}')
    with open(path, encoding='utf-8') as stream:
        return json.load(stream, parse_constant=reject)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('capture')
    parser.add_argument('--partial', action='store_true', help='summarize checksum-checked narrow target telemetry; always incomplete')
    parser.add_argument('--expected-identity', required=True, help='independently verified current identity JSON')
    args=parser.parse_args()
    try:
        analyzer = analyze_observations if args.partial else analyze_capture
        report=analyzer(load_json(args.capture), expected_identity=load_json(args.expected_identity))
    except (ValueError, TypeError, KeyError, OSError) as exc:
        print(json.dumps({'error':str(exc)}, allow_nan=False)); return 2
    print(json.dumps(report, indent=2, allow_nan=False))
    return 0


if __name__ == '__main__':
    sys.exit(main())
