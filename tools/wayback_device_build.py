#!/usr/bin/env python3
"""Build the way-back test image from the exact installed cc23 image, or from cc23 with the
2-byte loop-start trampoline fix (frame 48, see firmware/loop_start/tramp.S); never flash."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[1]
BASE_SHA='6146fb25de504e4aa9684fe519a7ce46a6ce332ae109c698259dc8f00d836b43'
FIXED_BASE_SHA='d225e17970940be7b153c524aebcfc60f4ca7ae8cd74696ef2282396e461ce04'  # cc23 + trampoline frame 48
VERSION=b'CC700_V1.414-cc23wb1'
IROM=0x42000020
TAIL=0x421de800
PAGE_END=0x421e0000
USABLE=4376   # 6,144 B free after cc23, less the 1,768 B reserve (docs/current/budget-plan-2026-11-16.md)
SCOPES={'.text':(TAIL,USABLE),'.lit_wb_rt':(0x420496b8,4)}
# Stock and v21 functions that the adapter calls. Each must begin with an Xtensa `entry` instruction.
CALLED=(0x421dd920,0x421dd218,0x421b85b0,0x421b7de0,0x421b8848,0x421b8818,0x4204c7a8,0x4204c1bc,0x420dbcd0)

def esp_module():
    spec=importlib.util.spec_from_file_location('wb_espimg',ROOT.parent/'cc700-backup/tools/espimg.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def run(*args):
    return subprocess.run([str(a) for a in args],capture_output=True,text=True,check=True).stdout

def build_candidate(base,sections,fragment_read):
    base_sha=hashlib.sha256(base).hexdigest()
    if base_sha not in (BASE_SHA,FIXED_BASE_SHA):raise ValueError('expected exact cc23 baseline (or its trampoline fix)')
    if set(sections)!=set(SCOPES):raise ValueError('fragment inventory differs')
    esp=esp_module();header,segs,_=esp.read(base)
    if esp.build(header,segs)!=base:raise ValueError('baseline roundtrip failed')
    before=[(a,bytes(d)) for a,d in segs]
    irom=next(d for a,d in segs if a==IROM)
    drom=next(d for a,d in segs if a==0x3c1e0020)
    def read(a,n):return bytes(irom[a-IROM:a-IROM+n])
    if IROM+len(irom)!=TAIL:raise ValueError('cc23 tail differs')
    if read(0x420496b8,4).hex()!='20d91d42':raise ValueError('tramp_rt literal drift')
    if read(0x420496b0,3).hex()!='364100' or read(0x420496c7,5).hex()!='e008001df0':raise ValueError('tramp_rt drift')
    # The loop-start trampoline: frame 32 in cc23, frame 48 in the fixed base. Nothing else may differ.
    if read(0x420496d8,3).hex()!=('366100' if base_sha==FIXED_BASE_SHA else '364100'):raise ValueError('loop-start trampoline differs from its base')
    for address in CALLED:
        if read(address,1)!=b'\x36':raise ValueError('called function drift: '+hex(address))
    payloads={};spans=[]
    for name,item in sections.items():
        address=int(item['address'],16);size=item['bytes'];expected,capacity=SCOPES[name]
        if type(size) is not int or size<=0 or address!=expected or size>capacity:
            raise ValueError('fragment outside scope: '+name)
        data=fragment_read(item['file'])
        if len(data)!=size or hashlib.sha256(data).hexdigest()!=item['sha256']:
            raise ValueError('fragment hash mismatch')
        payloads[name]=data;spans.append((address,address+size,name))
    literal=int.from_bytes(payloads['.lit_wb_rt'],'little')
    if not TAIL<=literal<TAIL+len(payloads['.text']):raise ValueError('hook target outside the new code')
    old_size=len(irom)
    for address,end,name in sorted(spans):
        at=address-IROM
        if end-IROM>len(irom):irom.extend(bytes(end-IROM-len(irom)))
        irom[at:at+len(payloads[name])]=payloads[name]
    if IROM+len(irom)>PAGE_END:raise ValueError('code page overflow')
    drom[16:48]=VERSION+bytes(32-len(VERSION))
    deltas=[]
    for (oldaddr,old),(address,data) in zip(before,segs):
        if oldaddr!=address or len(data)<len(old):raise ValueError('segment layout drift')
        allowed=[]
        if address==IROM:allowed=[(0x420496b8-IROM,0x420496bc-IROM),(old_size,len(data))]
        if address==0x3c1e0020:allowed=[(16,48)]
        changed=0
        for i,v in enumerate(data):
            if i<len(old) and v==old[i]:continue
            if not any(a<=i<b for a,b in allowed):raise ValueError('unscoped image delta')
            changed+=1
        if changed:deltas.append({'segment':hex(address),'changed_or_added_bytes':changed})
    image=esp.build(header,segs)
    h,s,_=esp.read(image)
    if len(image)>0x420000 or esp.build(h,s)!=image:raise ValueError('candidate roundtrip failed')
    return image,{'version':VERSION.decode(),'base_sha256':base_sha,
        'image_sha256':hashlib.sha256(image).hexdigest(),'image_bytes':len(image),
        'code_bytes':len(payloads['.text']),'usable_bytes':USABLE,
        'page_free_bytes':PAGE_END-IROM-len(irom),'hook_target':hex(literal),
        'structural_roundtrip':True,'segment_delta':deltas,'device_written':False}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base',type=Path,default=ROOT/'.local/navigation-phase/loop-start/build/ota_1_v23.bin')
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--prefix',default=str(Path.home()/'xtensa-esp-elf/bin/xtensa-esp32s3-elf-'))
    a=p.parse_args();base=a.base.read_bytes()
    a.output.mkdir(parents=True,exist_ok=True);src=ROOT/'firmware/wayback';elf=a.output/'wb-device.elf'
    run(a.prefix+'gcc','-Os','-mlongcalls','-mtext-section-literals','-ffreestanding','-fno-builtin',
        '-nostdlib','-DWB_NO_FWD','-Wall','-Wextra','-Werror','-fstack-usage','-Wl,-T,'+str(src/'wb_device.ld'),
        '-Wl,--gc-sections','-Wl,-e,wb_rt','-o',elf,src/'wb_device.c',src/'wayback.c',src/'wb_tramp.S','-lgcc')
    if run(a.prefix+'nm','-u',elf).strip():raise ValueError('undefined symbols')
    sections={}
    for line in run(a.prefix+'objdump','-h',elf).splitlines():
        f=line.split()
        if len(f)<7 or not f[0].isdigit() or not int(f[2],16) or f[1].startswith('.debug'):continue
        name,size,addr=f[1],int(f[2],16),int(f[3],16)
        if name not in SCOPES:raise ValueError('unexpected section '+name)
        path=a.output/(name[1:]+'.bin');run(a.prefix+'objcopy','-O','binary','-j',name,elf,path)
        sections[name]={'address':hex(addr),'bytes':size,'file':path.name,
            'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
    (a.output/'wb-device.dis').write_text(run(a.prefix+'objdump','-d',elf))
    image,receipt=build_candidate(base,sections,lambda n:(a.output/n).read_bytes())
    (a.output/'ota_1_cc23wb1.bin').write_bytes(image)
    receipt['sections']=sections
    receipt['stack_usage']=sorted(l.split('\t')[0].split(':')[-1]+' '+l.split('\t')[1]
        for f in a.output.glob('*.su') for l in f.read_text().splitlines())
    (a.output/'receipt.json').write_text(json.dumps(receipt,indent=1)+'\n')
    print(json.dumps({k:receipt[k] for k in ('version','image_sha256','image_bytes','code_bytes','usable_bytes','page_free_bytes','hook_target')}))

if __name__=='__main__':main()
