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
RANGES=(('current_task_getter',0x403832e0,0x40383300),
        ('ride_state_getter',0x4203c020,0x4203c030),
        ('navigation_dispatch_loop',0x4204dabc,0x4204dadb),
        ('display_index_updater',0x4204b048,0x4204b08e),
        ('display_index_getters',0x4204b10c,0x4204b122),
        ('matcher_result_publication',0x420547e0,0x420547ef),
        ('paused_display_hold',0x42050404,0x4205047e),
        ('active_tcb_sp_save',0x40380be8,0x40380c2c),
        ('active_tcb_sp_restore',0x40380c2c,0x40380c6c),
        ('active_tcb_creation_publish',0x4038271c,0x40382788),
        ('idle_tcb_creation_publish',0x40383dbf,0x40383de2),
        ('gui_entry_literal',0x420009a4,0x420009a8),
        ('gui_original_entry',0x42009318,0x42009330),
        ('boot_reference_capture',0x40375199,0x403751a6),
        ('boot_clock_offset_sync',0x420061c0,0x42006208),
        ('clock_initialize_sequence',0x42006150,0x42006160),
        ('counter_enable_no_reset',0x40385534,0x40385558),
        ('usb_write',0x420073b8,0x420073dc),
        ('usb_write_body',0x420073dc,0x4200741c),
        ('usb_tx_char',0x420074ec,0x42007548),
        ('usb_native_lock',0x403773d8,0x403773e8),
        ('usb_native_unlock',0x40377418,0x40377428),
        ('usb_lock_lazy_failure',0x40377278,0x403772a0),
        ('usb_lock_acquire',0x403772b4,0x40377340),
        ('gui_task_create',0x420094d0,0x42009500),
        ('task_allocate',0x40382920,0x4038298c),
        ('task_initialize',0x40382400,0x4038245c),
        ('idle_task_getter_do_not_use',0x403829dc,0x40382a00),
        ('native_core_and_interrupt_mask',0x4038298c,0x403829b4),
        ('rom_printf_literal',0x4200059c,0x420005a0),
        ('usb_vfs_write_slot',0x3c1e35c0,0x3c1e35c4),
        ('usb_static_state',0x3fc98468,0x3fc98490),
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
            'navigation_scalars':{'navigation_state':'0x3fc9fc34:u32',
                'ride_state_raw':'0x3fc9fb44:u32 (getter maps 8 to 0)',
                'arrival_state':'0x3fc9fcd4:u32','section':'0x3c38930c:u16',
                'matcher':'0x3c3894f0:148 bytes; reads +108:u16, +134:u16, +145..147:u8',
                'display_point':'0x3fc9fc24:u16','retained_display_point':'0x3fc9fc26:u16',
                'snapshot_threshold':'0x3c38939c+68:u32',
                'evidence':'docs/reports/grey-route-state-notes-2026-11-15.md; companion extraction reports',
                'coherence':'unsynchronized scalar reads; never treat equal repeats as atomic'},
            'clock':{'address':'0x403779f4','abi':'uint64_t (void), windowed Xtensa',
                     'counter':'coherent 52-bit hardware counter shifted right 4; no wall offset',
                     'wrap_output_bits':48,'runtime_init_verified':False,
                     'boot_epoch':'Raw counter reset not established by native initialization; do not gate on raw boot age',
                     'window_clock':'0x40377954 raw plus RTC-derived boot-reference offset, computed at0x420061c0'},
            'heap':{'address':'0x42003b50','abi':'void (uint32_t out[7], uint32_t caps)',
                    'free_offset':0,'largest_offset':8,'minimum_offset':12,
                    'coherence':'per-region locked; aggregate is not globally atomic'},
            'export':{'address':'0x420074ec','abi':'void (uint32_t fd, uint32_t byte)',
                      'gate':'Exact initialized USB TX callback; synchronous hardware byte writes, no allocation/retained pointer; concurrent output may interleave',
                      'flush':'OR bit0 at0x60038004, exactly as native USB write after newline'},
            'task_identity':{'getter_address':'0x403832e0','abi':'uint32_t(void)',
                             'active_tcb_array':'0x3fc9ef64','rejected_idle_getter':'0x403829dc',
                             'idle_tcb_array':'0x3fc9ecbc',
                             'proof':'Native interrupt entry saves current a1 at activeTCB+0; return restores a1 from same activeTCB+0; creation publishes selected TCB into the same per-core array'},
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
