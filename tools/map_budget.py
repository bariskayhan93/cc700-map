#!/usr/bin/env python3
"""v18 map allocation payload/work estimates from a well-formed route file.

No device access. Pass counts describe iterator callbacks, never frame time.
Serialized sizes include the four-byte record prefix, giving a conservative
payload bound for its load buffer. Allocator overhead and other subsystems are
excluded. Class-15 route/arrow work is reported separately, not predicted.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys

sys.path.insert(0,str(Path(__file__).resolve().parent))
from route_block_audit import blocks_of

CANVAS_BYTES=240*256*2
CLASSES={0:'stock',1:'buildings',2:'green',3:'water',4:'waterways',5:'major_roads',
         6:'minor_roads',7:'service_roads',8:'paths',9:'rail',10:'cycleways',
         11:'tram',12:'labels',13:'signals',14:'stops',15:'route_overlay'}


def block_budget(entries,serialized_bytes):
    """entries = (style, stored coordinate-pair count), decoded target layout."""
    entries=list(entries)
    if serialized_bytes<0 or any(not isinstance(s,int) or not isinstance(n,int) or s<0 or n<0 for s,n in entries):
        raise ValueError('Nonnegative integer entry data required')
    n=len(entries);points=sum(c for _,c in entries)
    big=max((c for s,c in entries if s),default=0)
    calls=projected=largest_projection=0
    counts=Counter()
    for style,count in entries:
        cls=style&15;counts[CLASSES[cls]]+=1
        if not style:
            calls+=count;projected+=2*count
            if count:largest_projection=max(largest_projection,2)
            continue
        if not big:continue  # actual iterator skips all styled passes without buffer
        passes=0;length=count+1
        if cls in (1,4):passes=1
        elif cls in (2,3):passes=1 if style&0x400 else 2
        elif cls in (5,6,7,8,9,10,11) and ((style>>4)&7)<=4:
            passes=2 if cls in (5,6,7,11) else 1
            if style&0x80 and cls in (8,9,10):passes+=2
        elif cls in (13,14):passes=2
        elif cls==12:passes=1;length=1
        calls+=passes;projected+=passes*length
        if passes:largest_projection=max(largest_projection,length)
    decoded=28*n+8*points
    scratch=8*(big+1) if big else 0
    projection=4*largest_projection
    return {'entries':n,'stored_coordinate_pairs':points,'classes':dict(counts),
            'serialized_record_bytes':serialized_bytes,'decoded_payload_bytes':decoded,
            'largest_entry_table_allocation_bytes':28*n,
            'largest_coordinate_allocation_bytes':8*max((c for _,c in entries),default=0),
            'iterator_scratch_bytes':scratch,'projection_scratch_peak_bytes':projection,
            'projection_calls':calls,'projected_points':projected,
            'render_payload_peak_bytes':decoded+scratch+projection,
            'separate_overlay_entries':counts['route_overlay']}


def transition_budget(old,new):
    peak=max(old['decoded_payload_bytes'],new['decoded_payload_bytes'])+new['serialized_record_bytes']
    return {'block_payload_peak_upper_bytes':peak,'plus_canvas_bytes':peak+CANVAS_BYTES,
            'largest_single_request_upper_bytes':max(new['serialized_record_bytes'],
                new['largest_entry_table_allocation_bytes'],new['largest_coordinate_allocation_bytes'],
                new['iterator_scratch_bytes'],new['projection_scratch_peak_bytes'])}


def audit(path):
    data=Path(path).read_bytes();index,_,blocks=blocks_of(data)
    distinct={b['off']:b for b in blocks}
    costs=[];references=Counter(index)
    for offset,b in distinct.items():
        costs.append({'block_offset':offset,'sections_sharing_block':references[offset],
                      **block_budget(((e[1],len(e[4])) for e in b['ents']),b['bytes'])})
    largest_decoded=max((b['decoded_payload_bytes'] for b in costs),default=0)
    largest_serialized=max((b['serialized_record_bytes'] for b in costs),default=0)
    largest_request=max((max(b[k] for k in ('serialized_record_bytes','largest_entry_table_allocation_bytes',
                         'largest_coordinate_allocation_bytes','iterator_scratch_bytes','projection_scratch_peak_bytes'))
                         for b in costs),default=0)
    return {'file_bytes':len(data),'section_index_entries':len(index),'distinct_blocks':len(costs),
            'canvas_bytes':CANVAS_BYTES,'blocks':costs,
            'any_block_transition_plus_canvas_upper_bytes':largest_decoded+largest_serialized+CANVAS_BYTES,
            'largest_single_request_upper_bytes':largest_request,
            'limits':['Allocation payload only; excludes allocator headers/alignment, route/index/GPS/planner/LVGL allocations',
                      'Iterator projection counts only; excludes stock route, arrow/rough overlays, rasterization area and font work',
                      'Assumes consistent entry count/point fields; not a malformed-route validator',
                      'No frame-time, mutex wait, current free heap or safe capacity is inferred']}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('route',type=Path)
    args=parser.parse_args()
    print(json.dumps(audit(args.route),indent=2))


if __name__=='__main__':main()
