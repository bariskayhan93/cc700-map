#!/usr/bin/env python3
"""Decode narrow CC7M1 iterator observations; never infer full-frame calibration."""
import argparse
import json
from pathlib import Path
import re


def parse_line(line):
    line=line.rstrip('\r\n')
    extended=line.startswith(('CC7M2 ','CC7M3 '))
    guarded=line.startswith(('CC7M3 ','CC7F2 ','CC7B2 '))
    count=20+(3 if extended else 0)+(2 if guarded else 0)
    pattern=r'CC7(?:M[123]|[FB][12]) (?:[0-9a-f]{8} ){'+str(count)+'}'
    if not re.fullmatch(pattern,line+' ' if not line.endswith(' ') else line):
        raise ValueError('Malformed or incomplete target measurement line')
    words=line[6:].split()
    body=''.join(w+' ' for w in words[:-1])
    checksum=2166136261
    for char in body.encode(): checksum=((checksum^char)*16777619)&0xffffffff
    if checksum!=int(words[-1],16):raise ValueError('CC7M1 checksum mismatch')
    values=[int(word,16) for word in words]
    ticks=[values[4+2*i]|values[5+2*i]<<32 for i in range(4)]
    if ticks!=sorted(ticks):raise ValueError('Nonmonotonic iterator timestamps')
    if values[2:4]!=[240,256]:raise ValueError('Unexpected target canvas')
    result={'channel':'iterator','decoded_pointer':values[0],'entry_count':values[1],
            'canvas':[240,256],'ticks_us':ticks,'clock_pair_overhead_us':values[12],
            'iterator_us':ticks[3]-ticks[0], 'mutex_wait_us':ticks[1]-ticks[0],
            'mutex_hold_us':ticks[2]-ticks[1],
            'unlock_us':ticks[3]-ticks[2],
            'heap_caps':0x404,
            'heap_before':dict(zip(('free_bytes','largest_bytes','minimum_bytes'),values[13:16])),
            'heap_after':dict(zip(('free_bytes','largest_bytes','minimum_bytes'),values[16:19])),
            'export_disturbs_following_frames':True,
            'block_section_route_camera_identity':'requires external verified receipt'}
    if extended:
        result['input_geometry_points']=values[19]
        result['input_fill_vertices']=values[20]
        result['label_storage_bytes']=values[21]
    if guarded:
        offset=22 if extended else 19
        result['stack_remaining_bytes']=values[offset]
        result['stack_a5_prefix_bytes']=values[offset+1]
        result['stack_a5_scan_capped']=values[offset+1]==1024
    if line.startswith(('CC7F1','CC7F2')):
        result['channel']='map_composition'
        result['map_composition_us']=ticks[2]-ticks[1]
    elif line.startswith(('CC7B1','CC7B2')):
        result['channel']='block_load'
        result['block_load_us']=ticks[2]-ticks[1]
        result['file_type']=values[0];result['requested_road']=values[1]
    if result['channel']!='iterator':
        for field in ('iterator_us','mutex_wait_us','mutex_hold_us','unlock_us','decoded_pointer','entry_count','canvas'):
            result.pop(field)
    return result


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('serial_log',type=Path)
    args=p.parse_args();samples=[];rejected=[]
    for number,line in enumerate(args.serial_log.read_text(errors='replace').splitlines(),1):
        if not any(prefix in line for prefix in ('CC7M1','CC7M2','CC7M3','CC7F1','CC7F2','CC7B1','CC7B2')):continue
        try:samples.append(parse_line(line))
        except ValueError as error:rejected.append({'line':number,'error':str(error)})
    print(json.dumps({'samples':samples,'rejected':rejected,'general_calibration':'incomplete',
        'sample_loss':'unknown: no cross-invocation sequence counter',
        'limits':['Iterator duration is not frame duration','Export overhead perturbs subsequent frames',
                  'External build/route/workload/camera and restoration receipt required']},indent=2))
    return 0 if samples and not rejected else 2
if __name__=='__main__':raise SystemExit(main())
