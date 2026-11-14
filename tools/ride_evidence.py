#!/usr/bin/env python3
"""Recover complete dated text-log fragments from a LOCAL storage snapshot.

No device access. Retains physical offsets, excludes binary/truncated tails and
normalizes the firmware's literal backslash escapes. Flash order is not time
order; same-second messages have no guaranteed ordering. Deleted bytes may have
been overwritten. This is not LittleFS undelete or a complete-event guarantee.
Output contains private device text and should stay outside version control.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re


def carve_logs(raw, date):
    if not re.fullmatch(r'\d{8}', date):
        raise ValueError('date must be YYYYMMDD')
    prefix = rb'\[[A-Za-z]\]:' + date.encode() + rb' [0-9:]{8}'
    # Both real CRLF and the OEM logger's literal escaped CRLF are accepted.
    # Stop before another record prefix: threaded writes can interleave.
    pattern = prefix + rb'(?:(?!\\r\\n|\[[A-Za-z]\]:)[\x09\x20-\x7e]){1,1800}(?=\\r\\n|\r?\n)'
    return [{'offset':m.start(), 'time':m.group()[13:21].decode('ascii'),
             'line':m.group().decode('ascii').replace('\\t','\t')}
            for m in re.finditer(pattern, raw)]


def unique_lines(fragments):
    """Deduplicate copies; alphabetical ties are NOT execution ordering."""
    return sorted({r['line'] for r in fragments}, key=lambda line:(line[4:21],line))


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('storage', type=Path)
    parser.add_argument('--date',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    raw=args.storage.read_bytes();fragments=carve_logs(raw,args.date)
    args.output.mkdir(parents=True,exist_ok=True)
    (args.output/'fragments.json').write_text(json.dumps(fragments,indent=2)+'\n')
    lines=unique_lines(fragments)
    (args.output/'recovered.log').write_text('\n'.join(lines)+'\n')
    summary={'source_sha256':hashlib.sha256(raw).hexdigest(),'source_bytes':len(raw),
             'date':args.date,'complete_fragments':len(fragments),'distinct_lines':len(lines),
             'same_second_order_known':False,'completeness_guaranteed':False,'device_access':False}
    (args.output/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))


if __name__=='__main__':main()
