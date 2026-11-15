#!/usr/bin/env python3
"""Read-only pinned stock ABI evidence; never builds or writes firmware/device."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import tempfile

STOCK_SHA256='7545ae4d4030b24b1f6198f481ce3a9a183a0e6eb3e5355b86ad2413aead2c31'
# Half-open ranges, beginning at actual function entries to avoid Xtensa desync.
RANGES=(('gui_task_create',0x420094d0,0x42009500),
        ('task_allocate',0x40382920,0x4038298c),
        ('task_initialize',0x40382400,0x4038245c),
        ('current_task_by_core',0x403829dc,0x40382a00),
        ('native_core_and_interrupt_mask',0x4038298c,0x403829b4),
        ('rom_printf_literal',0x4200059c,0x420005a0),
        ('composition_entry',0x4204da24,0x4204da41),
        ('composition_caller',0x420516a4,0x420516aa),
        ('heap_info',0x42003b50,0x42003bc0),
        ('heap_largest_caller',0x42003bc0,0x42003bd4),
        ('heap_info_inner',0x421dc03c,0x421dc07c),
        ('heap_info_locked',0x421dbf84,0x421dbfec),
        ('raw_clock',0x403779f4,0x40377a0c),
        ('counter_read',0x4038531c,0x40385368),
        ('counter_convert',0x4037f5e0,0x4037f608),
        ('clock_init',0x42006208,0x4200625c),
        ('clock_convert_install',0x40385504,0x40385514),
        ('wall_clock_do_not_use',0x42005f38,0x42005f58),
        ('adjusted_clock_do_not_use',0x40377954,0x40377974),
        ('export_shared_buffer',0x42009b84,0x42009c10),
        ('stock_export_caller',0x420b4e60,0x420b4f1c))

def segments(image):
    at=24
    for _ in range(image[1]):
        address,size=struct.unpack_from('<II',image,at); at+=8
        yield address,image[at:at+size]
        at+=size

def verify(image, objdump=None):
    if hashlib.sha256(image).hexdigest()!=STOCK_SHA256:
        raise ValueError('Expected pinned stock ota_0 image')
    segs=list(segments(image)); ranges=[]
    for name,start,end in RANGES:
        address,data=next((a,d) for a,d in segs if a<=start and end<=a+len(d))
        payload=data[start-address:end-address]
        record={'name':name,'start':hex(start),'end_exclusive':hex(end),
                'sha256':hashlib.sha256(payload).hexdigest(),'bytes':len(payload)}
        if objdump:
            with tempfile.TemporaryDirectory() as tmp:
                binary=Path(tmp)/'range.bin'; binary.write_bytes(data)
                proc=subprocess.run([str(objdump),'-D','-b','binary','-m','xtensa',
                    f'--adjust-vma={address}',f'--start-address={start}',f'--stop-address={end}',str(binary)],
                    check=True,capture_output=True,text=True)
                record['gnu_disassembly']=proc.stdout
        ranges.append(record)
    return {'stock_sha256':STOCK_SHA256,'installable':False,'device_written':False,
            'clock':{'address':'0x403779f4','abi':'uint64_t (void), windowed Xtensa',
                     'counter':'coherent 52-bit hardware counter shifted right 4; no wall offset',
                     'wrap_output_bits':48,'runtime_init_verified':False},
            'heap':{'address':'0x42003b50','abi':'void (uint32_t out[7], uint32_t caps)',
                    'free_offset':0,'largest_offset':8,'minimum_offset':12,
                    'coherence':'per-region locked; aggregate is not globally atomic'},
            'export':{'address':'0x42009b84','abi':'void (const char *format, ...)',
                      'gate':'Shared 256-byte scratch; arbitrary-thread export serialization not proved'},
            'gui_stack':{'bytes':8192,'task_name':'AppGUIManage','create':'0x420094d0',
                         'allocate':'0x40382920','tcb_stack_base_offset':52,
                         'tcb_stack_top_offset':76,'observed_margin_bytes':None},
            'ranges':ranges}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('image',type=Path)
    parser.add_argument('--objdump',type=Path,default=Path.home()/'xtensa-esp-elf/bin/xtensa-esp32s3-elf-objdump')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    result=verify(args.image.read_bytes(),args.objdump)
    with args.output.open('x') as out: json.dump(result,out,indent=2);out.write('\n')

if __name__=='__main__': main()
