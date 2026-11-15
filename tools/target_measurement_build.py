#!/usr/bin/env python3
"""Build a separate bounded iterator probe from exact v21 sources. Never flash."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
from target_measurement_abi import verify,segments,RANGES
ROOT=Path(__file__).resolve().parents[1]
PREFIX=Path.home()/'xtensa-esp-elf/bin/xtensa-esp32s3-elf-'

def run(*args,**kwargs):
    return subprocess.run([str(a) for a in args],check=True,capture_output=True,text=True,**kwargs).stdout

def instrument(source,navigation=False):
    state_export='\n  if(measuring) tm_probe_navigation((uint32_t)E,cnt);' if navigation else ''
    changes=[('void cc_iter(proj_cb_t cb) {\n  fw_blk_lock();',
              'void cc_iter(proj_cb_t cb) {\n  tm_probe measurement;\n  int measuring=tm_probe_begin(&measurement);\n  fw_blk_lock();\n  if(measuring) tm_probe_acquired(&measurement);'),
             ('  fw_blk_unlock();\n}',
              '  if(measuring) tm_probe_drawn(&measurement);\n  fw_blk_unlock();\n  if(measuring) tm_probe_end(&measurement,(uint32_t)E,cnt,FW_CANVAS_W,FW_CANVAS_H);'+state_export+'\n}')]
    for old,new in changes:
        if source.count(old)!=1: raise ValueError('Iterator source boundary drift')
        source=source.replace(old,new)
    old='      const ent_t *e = &E[i];'
    if source.count(old)!=1:raise ValueError('Iterator work boundary drift')
    source=source.replace(old,old+'\n      if(measuring) tm_probe_work(&measurement,e->style,e->cnt);')
    return '#include "probe.h"\n'+source

def window_defines(seconds):
    if type(seconds) is not int or not 1<=seconds<=600:
        raise ValueError('capture window must be an integer in 1..600 seconds')
    return ['-DTM_START_US=0ULL',f'-DTM_END_US={seconds*1000000}ULL']

def build(stock_path,v21,out,mode="iterator",window_seconds=120):
    window_flags=window_defines(window_seconds)
    stock=stock_path.read_bytes();abi=verify(stock)
    receipt=json.loads((v21/'manifest.json').read_text())
    for name,record in receipt['source_and_artifacts'].items():
        if name.startswith('src/'):
            if hashlib.sha256((v21/name).read_bytes()).hexdigest()!=record['sha256']:
                raise ValueError(f'v21 source changed: {name}')
    baseline=(v21/'ota_1_v21.bin').read_bytes()
    pinned=receipt['source_and_artifacts']['ota_1_v21.bin']['sha256']
    if hashlib.sha256(baseline).hexdigest()!=pinned:raise ValueError('v21 image changed')
    stock_segs=list(segments(stock));base_segs=list(segments(baseline))
    for name,start,end in RANGES:
        def region(segs):
            a,d=next((a,d) for a,d in segs if a<=start and end<=a+len(d))
            return d[start-a:end-a]
        if region(stock_segs)!=region(base_segs):raise ValueError(f'Native ABI drift: {name}')
    out.mkdir(parents=True,exist_ok=False);src=out/'src';src.mkdir()
    for name in ('map.c','blk.c','arrow.c','fw.h','tramp.S','patch.ld'):
        shutil.copyfile(v21/'src'/name,src/name)
    extra=[]
    allowed=set(receipt['sections'])
    if mode in ('iterator','navigation'):
        (src/'map.c').write_text(instrument((src/'map.c').read_text(),navigation=mode=='navigation'))
        if mode=='navigation':extra=['-DTM_NAVIGATION_STATE']
    elif mode=='block':
        extra=['-DTM_BLOCK']
        block=(src/'blk.c').read_text()
        old='void cc_blk(uint32_t type, uint32_t road) {'
        if block.count(old)!=1:raise ValueError('Block source drift')
        (src/'blk.c').write_text(block.replace(old,'void tm_original_blk(uint32_t type, uint32_t road) {'))
    elif mode=='composition':
        extra=['-DTM_COMPOSITION']
        # This range belongs to the replaced iterator body, not unused stock RAM/code.
        linker=(src/'patch.ld').read_text()
        linker=linker.replace('MEMORY {','MEMORY { t_measure (rx) : ORIGIN = 0x4204968c, LENGTH = 36\n c_measure (rx) : ORIGIN = 0x420516a7, LENGTH = 3\n')
        linker=linker.replace('SECTIONS {','SECTIONS { .tramp_measure : { KEEP(*(.tramp_measure)) } > t_measure\n .call_measure : { KEEP(*(.call_measure)) } > c_measure\n')
        (src/'patch.ld').write_text(linker)
        with (src/'tramp.S').open('a') as asm:
            asm.write('\n  TRAMP0 measure, tm_measure_frame\n .section .call_measure, "ax"\n .begin no-transform\n call8 tramp_measure\n .end no-transform\n')
        allowed.update(('.tramp_measure','.call_measure'))
    else:raise ValueError('Unknown capture mode')
    # Replace only the creator's existing task-entry literal. The wrapper has
    # the same void(void*) ABI and calls the unchanged original task entry.
    extra.append('-DTM_DIAGNOSTIC')
    linker=(src/'patch.ld').read_text()
    linker=linker.replace('MEMORY {','MEMORY { l_gui_entry (rx) : ORIGIN = 0x420009a4, LENGTH = 4\n')
    linker=linker.replace('SECTIONS {','SECTIONS { .gui_entry_literal : { KEEP(*(.gui_entry_literal)) } > l_gui_entry\n')
    (src/'patch.ld').write_text(linker)
    with (src/'tramp.S').open('a') as asm:
        asm.write('\n .section .gui_entry_literal, "a"\n .word tm_gui_entry\n')
    allowed.add('.gui_entry_literal')
    for name in ('probe.c','probe.h'):shutil.copyfile(ROOT/'firmware/measurement'/name,src/name)
    run(str(PREFIX)+'gcc','-Os','-mlongcalls','-mtext-section-literals','-ffreestanding',
        '-fno-builtin','-nostdlib','-Wall','-Wextra','-fstack-usage','-Wl,-T,patch.ld',
        '-Wl,--gc-sections','-Wl,-e,cc_line','-o','../probe.elf',
        'map.c','blk.c','arrow.c','tramp.S','probe.c',*extra,*window_flags,'-lgcc',cwd=src)
    spec=importlib.util.spec_from_file_location('espimg',ROOT.parent/'cc700-backup/tools/espimg.py')
    esp=importlib.util.module_from_spec(spec);spec.loader.exec_module(esp)
    hdr,segs,_=esp.read(baseline)
    if esp.build(hdr,segs)!=baseline:raise ValueError('Invalid base envelope')
    irom=next(d for a,d in segs if a==0x42000020)
    drom=next(d for a,d in segs if a==0x3c1e0020)
    changed=[]
    for line in run(str(PREFIX)+'objdump','-h',out/'probe.elf').splitlines():
        fields=line.split()
        if len(fields)<7 or not fields[0].isdigit():continue
        name,size,address=fields[1],int(fields[2],16),int(fields[3],16)
        if not size or name.startswith('.debug'):continue
        if name not in allowed:raise ValueError(f'Unexpected section {name}')
        if address<0x40000000:address+=0x6000000
        if not (0x42000020<=address and address+size<=0x421e0000):raise ValueError('Section outside page')
        tmp=out/'section.bin';run(str(PREFIX)+'objcopy','-O','binary','-j',name,out/'probe.elf',tmp)
        data=tmp.read_bytes();tmp.unlink();assert len(data)==size
        at=address-0x42000020
        if at+size>len(irom):irom.extend(bytes(at+size-len(irom)))
        irom[at:at+size]=data
        changed.append({'section':name,'address':hex(address),'bytes':size,'sha256':hashlib.sha256(data).hexdigest()})
    version={'iterator':b'CC700_V1.414-cc21m04','navigation':b'CC700_V1.414-cc21n01','composition':b'CC700_V1.414-cc21f04','block':b'CC700_V1.414-cc21b04'}[mode];drom[16:48]=version+bytes(32-len(version))
    image=esp.build(hdr,segs);assert esp.build(*esp.read(image)[:2])==image
    (out/'iterator-probe.bin').write_bytes(image)
    (out/'probe.dis').write_text(run(str(PREFIX)+'objdump','-d',out/'probe.elf'))
    (out/'size.txt').write_text(run(str(PREFIX)+'size','-A',out/'probe.elf'))
    manifest={'version':version.decode(),'test_only':True,'device_written':False,
        'mode':mode,'stock_sha256':abi['stock_sha256'],'ordinary_v21_sha256':pinned,
        'image_sha256':hashlib.sha256(image).hexdigest(),'image_bytes':len(image),
        'sections':changed,'window_boot_us':[0,window_seconds*1000000],
        'window_compiler_defines':window_flags,
        'channels':{'iterator':['iterator wall, lock acquisition, draw-under-lock, conservative mutex-hold bounds','PSRAM heap before/after'],'navigation':['iterator observations as in iterator mode','CC7N1 fixed scalar state after iterator; non-atomic, not performance'],'composition':['map composition duration; excludes canvas setup and flush','PSRAM heap before/after'],'block':['cc_blk duration; includes no-op/cache hits','PSRAM heap before/after; peak overlap unmeasured']}[mode],
        'unmeasured':['full frame','projection/raster/text component durations','actual projection call/point totals','block load overlap','internal heap'],
        'source_sha256':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in src.iterdir() if f.is_file()},
        'startup_diagnostic':'CC7D1 once at GUI task entry; reports separate clock/USB/stack/window gates, not performance',
        'startup_hook':{'literal_address':'0x420009a4','original_task_entry':'0x42009318','abi':'void(void*), argument preserved'},
        'task_identity':{'current_getter':'0x403832e0','active_tcb_array':'0x3fc9ef64','old_idle_getter_not_used':'0x403829dc'},
        'clock_domains':{'timing':'raw system timer0x403779f4','window':'RTC boot-referenced clock0x40377954; avoids unproved raw boot epoch'},
        'capture_ownership':'stack per invocation; no writable capture globals or allocation',
        'export':'Allocation-free native USB byte callback0x420074ec+newline flush; concurrent output may interleave after timed interval; iterator CC7M3<=233B, other modes CC7F2/CC7B2<=206B including NUL',
        'disturbance':'heap before/after and serial after each invocation disturb subsequent frames; iterator source-work counters add per-entry overhead',
        'runtime_gates':['clock initialized with exact conversion callback',f'boot time window0..{window_seconds}s','own current-task stack bounds and >=3072B before heap; >=2048B before export','USB callback0x420074ec; no mutex initialization or commandeering'],
        'acceptance_gates':['fresh exact rollback backup and guarded install','runtime serial sink and complete output observation',
          'route hash/block/section/camera/workload identity receipt','timer overhead observed; no full-frame calibration',
          'automatic ordinary firmware restore/readback/boot receipt'],
        'target_validated':False}
    if mode=='navigation':
        manifest['navigation_observation']={'prefix':'CC7N1','atomic':False,
            'read_policy':'fixed scalars only, no live object pointers or native state writes',
            'pairing':'post-iterator clock bracket plus decoded-pointer/entry count; no sequence counter',
            'limits':['only runs when iterator runs','producer threshold is not live widget threshold',
                      'repeated fields can miss concurrent or ABA changes','no coordinates, ride baseline or distance recorded'],
            'max_line_bytes_including_nul':188}
    (out/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return manifest

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--stock',type=Path,default=ROOT.parent/'cc700-backup/parts/ota_0.bin')
    p.add_argument('--v21',type=Path,default=ROOT/'.local/patch-v21')
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--mode',choices=('iterator','navigation','composition','block'),default='iterator')
    p.add_argument('--window-seconds',type=int,default=120,help='bounded activation window, 1..600 boot seconds')
    args=p.parse_args();print(json.dumps(build(args.stock.resolve(),args.v21.resolve(),args.output.resolve(),args.mode,args.window_seconds),indent=2))
if __name__=='__main__':main()
