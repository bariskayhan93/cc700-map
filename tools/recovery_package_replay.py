#!/usr/bin/env python3
"""Replay saved fixes through the actual portable C core; no device access."""
import argparse,collections,hashlib,json,math,time
from pathlib import Path
from recovery_native import Engine
R=6371000

def distance(a,b):
    p,q=map(math.radians,(a[0],b[0]));d=math.radians(b[0]-a[0]);l=math.radians(b[1]-a[1]);return 2*R*math.asin(math.sqrt(math.sin(d/2)**2+math.cos(p)*math.cos(q)*math.sin(l/2)**2))
def bearing(a,b):
    p,q=map(math.radians,(a[0],b[0]));l=math.radians(b[1]-a[1]);return math.degrees(math.atan2(math.sin(l)*math.cos(q),math.cos(p)*math.sin(q)-math.sin(p)*math.cos(q)*math.cos(l)))%360

def replay(config,bundle):
    manifest=json.loads((bundle/'manifest.json').read_text());track=json.loads(Path(config['track']).read_text());timeline=json.loads(Path(config['timeline']).read_text())
    if len(track)!=len(timeline) or any(p[0]!=t['timestamp'] for p,t in zip(track,timeline)):raise ValueError('Track/timeline mismatch')
    for field,file in [('routeSha256',config['route']),('sourceSha256',config['snapshot'])]:
        if hashlib.sha256(Path(file).read_bytes()).hexdigest()!=manifest[field]:raise ValueError('Bundle input identity mismatch')
    identities=bytes.fromhex(''.join(manifest[k] for k in ('routeSha256','sourceSha256','policySha256')));engine=Engine(identities,experimental=True)
    states=collections.Counter();reasons=collections.Counter();off=collections.Counter();mounts=0;max_reads=0;max_guards=0;overlay_frames=0;max_points=0;last_state=0;mounted=None;events=[];start=track[0][0];t0=time.perf_counter()
    for i,(p,row) in enumerate(zip(track,timeline)):
        now=round((p[0]-start)*1000)+1000;ordered=row['off_original_route_m']<=20 and row['ambiguous_with_other_pass'] is False;is_off=row['off_original_route_m']>20
        progress=round(row['original_progress_m']*100)
        if last_state==0 and ordered:
            package=next((r for r in manifest['packages'] if r['entryMin']<=progress<r['entryMax']),None);name=package['name'] if package else None
            if name!=mounted:
                engine.lib.rc_unmount(engine.buffer);mounted=name
                if name:
                    data=(bundle/name).read_bytes()
                    if hashlib.sha256(data).hexdigest()!=package['sha256']:raise ValueError('Package identity mismatch')
                    if not engine.mount(data):raise ValueError('C core refused generated package')
                    mounts+=1
        prev=track[i-1] if i else None;dt=p[0]-prev[0] if prev else 0;meters=distance(prev[1:],p[1:]) if prev else 0;heading_prev=None
        for j in range(i-1,-1,-1):
            if p[0]-track[j][0]>10:break
            if distance(track[j][1:],p[1:])>=5:heading_prev=track[j];break
        heading_ok=heading_prev is not None;heading=bearing(heading_prev[1:],p[1:]) if heading_ok else 0;speed=meters/dt*3.6 if dt>0 else 0
        out=engine.tick(now_ms=now,fix_ms=now,epoch=7,progress_cm=progress,lat_e7=round(p[1]*1e7),lon_e7=round(p[2]*1e7),speed_kmh=speed,accuracy_m=5,heading_deg=heading,flags=1|(2 if is_off else 0)|(4 if ordered else 0)|(8 if heading_ok else 0),overlay_points=512)
        states[out['state']]+=1;reasons[out['reason']]+=1;last_state=out['state'];max_reads=max(max_reads,out['reads']);max_guards=max(max_guards,out['guard_checks']);max_points=max(max_points,out['points'])
        if is_off:off[out['state']]+=1
        if out['overlay']:
            overlay_frames+=1
            if engine.point(0) is None or engine.point(out['points']-1) is None:raise ValueError('Active overlay points unavailable')
        events.append({'fix':i,**out})
    return {'scope':'actual C core, historical reconstructed provider, experimental packages','frames':len(track),'stateCounts':dict(states),'offRouteStateCounts':dict(off),'reasonCounts':dict(reasons),'overlayFrames':overlay_frames,'maxOverlayPoints':max_points,'packageMounts':mounts,'maxReadsPerTick':max_reads,'maxGuardsPerTick':max_guards,'engineHostBytes':engine.lib.rc_size(),'hostElapsedSeconds':time.perf_counter()-t0,'assumptions':['5m GPS accuracy assumed; not present in FIT','on/off-route and ordered progress reconstructed from prior timeline','heading/speed reconstructed from previous fixes; no sensor/device emulation','selective retrospective source seeds; not full coverage'],'deviceAcceptance':False,'nativeAdapterBound':False},events

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--input',type=Path,required=True);p.add_argument('--bundle',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    if a.output.exists():raise ValueError('Output exists')
    report,events=replay(json.loads(a.input.read_text()),a.bundle);a.output.mkdir();(a.output/'report.json').write_text(json.dumps(report,indent=2)+'\n');(a.output/'events.json').write_text(json.dumps(events)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
