#!/usr/bin/env python3
"""Build a bounded loop-departure candidate from exact ordinary cc22; never flash."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
from guidance_build import assert_native_guards

ROOT=Path(__file__).resolve().parents[1]
BASE_SHA='cc6613211b2796ae95ef19a6967759a53c6e48af4612906b22adcbddc088d50f'
VERSION=b'CC700_V1.414-cc24'
SCOPES={'.text':(0x421de120,0x421e0000-0x421de120),
        '.tramp_loop_start':(0x420496d8,0x40),'.call_loop_start':(0x420547dd,3)}

def esp_module():
    spec=importlib.util.spec_from_file_location('loop_espimg',ROOT.parent/'cc700-backup/tools/espimg.py')
    m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def run(*args):
    return subprocess.run([str(a) for a in args],capture_output=True,text=True,check=True).stdout

def build_candidate(base,sections,fragment_read):
    if hashlib.sha256(base).hexdigest()!=BASE_SHA:raise ValueError('expected exact cc22 baseline')
    if set(sections)!=set(SCOPES):raise ValueError('fragment inventory differs')
    esp=esp_module();header,segs,_=esp.read(base)
    if esp.build(header,segs)!=base:raise ValueError('baseline roundtrip failed')
    before=[(a,bytes(d)) for a,d in segs]
    irom=next(d for a,d in segs if a==0x42000020)
    drom=next(d for a,d in segs if a==0x3c1e0020)
    def read(a,n):return bytes(irom[a-0x42000020:a-0x42000020+n])
    assert_native_guards(read)
    if read(0x420547dd,3).hex()!='25a0f6':raise ValueError('matcher call drift')
    # The whole trampoline slot belongs to the displaced iterator body.
    # Its existing entry returns through cc_iter, never falling into this tail.
    if read(0x42049670,3).hex()!='364100' or read(0x42049687,5).hex()!='e008001df0':
        raise ValueError('iterator redirection drift')
    spans=[];payloads={}
    for name,item in sections.items():
        address=int(item['address'],16);size=item['bytes'];expected,capacity=SCOPES[name]
        if type(size) is not int or size<=0 or address!=expected or size>capacity:
            raise ValueError('fragment outside scope: '+name)
        if name=='.call_loop_start' and size!=3:raise ValueError('call scope differs')
        data=fragment_read(item['file'])
        if len(data)!=size or hashlib.sha256(data).hexdigest()!=item['sha256']:
            raise ValueError('fragment hash mismatch')
        if read(address,size).hex()!=item['expected_base_hex']:raise ValueError('fragment baseline drift')
        payloads[name]=data;spans.append((address,address+size,name))
    spans.sort()
    if any(a[1]>b[0] for a,b in zip(spans,spans[1:])):raise ValueError('fragment overlap')
    old_size=len(irom)
    if any(irom[old_size:SCOPES['.text'][0]-0x42000020]):raise ValueError('tail gap differs')
    for address,end,name in spans:
        at=address-0x42000020
        if end-0x42000020>len(irom):irom.extend(bytes(end-0x42000020-len(irom)))
        irom[at:at+len(payloads[name])]=payloads[name]
    drom[16:48]=VERSION+bytes(32-len(VERSION))
    assert_native_guards(read)
    deltas=[]
    for (oldaddr,old),(address,data) in zip(before,segs):
        if oldaddr!=address or len(data)<len(old):raise ValueError('segment layout drift')
        allowed=[]
        if address==0x42000020:
            allowed=[(a-address,b-address) for a,b,_ in spans]+[(old_size,SCOPES['.text'][0]-address)]
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
    return image,{'version':VERSION.decode(),'image_sha256':hashlib.sha256(image).hexdigest(),
        'image_bytes':len(image),'page_free_bytes':0x421e0000-0x42000020-len(irom),
        'structural_roundtrip':True,'native_guards_passed':True,'segment_delta':deltas,
        'device_written':False,'native_matching_executed_by_host_tests':False}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base',type=Path,default=ROOT/'.local/navigation-phase/guidance/release-cc22/ota_1_v22.bin')
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--prefix',default=str(Path.home()/'xtensa-esp-elf/bin/xtensa-esp32s3-elf-'))
    a=p.parse_args();base=a.base.read_bytes()
    if hashlib.sha256(base).hexdigest()!=BASE_SHA:raise ValueError('expected exact cc22 baseline')
    esp=esp_module();_,segs,_=esp.read(base);irom=next(d for addr,d in segs if addr==0x42000020)
    def read(addr,n):return bytes(irom[addr-0x42000020:addr-0x42000020+n])
    a.output.mkdir(parents=True,exist_ok=True);src=ROOT/'firmware/loop_start';elf=a.output/'loop-start.elf'
    run(a.prefix+'gcc','-Os','-mlongcalls','-mtext-section-literals','-ffreestanding','-fno-builtin',
        '-nostdlib','-Wall','-Wextra','-Werror','-fstack-usage','-Wl,-T,'+str(src/'loop_start.ld'),
        '-Wl,--gc-sections','-Wl,-e,cc_loop_match','-o',elf,src/'loop_start.c',src/'tramp.S','-lgcc')
    sections={}
    for line in run(a.prefix+'objdump','-h',elf).splitlines():
        f=line.split()
        if len(f)<7 or not f[0].isdigit() or not int(f[2],16) or f[1].startswith('.debug'):continue
        name,size,addr=f[1],int(f[2],16),int(f[3],16)
        if name not in SCOPES:raise ValueError('unexpected section '+name)
        path=a.output/(name[1:]+'.bin');run(a.prefix+'objcopy','-O','binary','-j',name,elf,path)
        data=path.read_bytes()
        sections[name]={'address':hex(addr),'bytes':size,'file':path.name,
            'sha256':hashlib.sha256(data).hexdigest(),'expected_base_hex':read(addr,size).hex()}
    dis=run(a.prefix+'objdump','-d',elf)
    # Inline literal bytes can desynchronize linear Xtensa decoding. Inspect the
    # actual post-literal branch target separately, regardless of linked address.
    tramp_head=dis.split('Disassembly of section .tramp_loop_start:')[1].split('Disassembly of section')[0]
    tramp_body=run(a.prefix+'objdump','-d','--start-address=0x420496e4',
                   '--stop-address=0x42049718',elf)
    if 'j\t420496e4' not in tramp_head:raise ValueError('trampoline branch differs')
    tramp=tramp_head.split('420496db:')[0]+tramp_body
    (a.output/'loop-start.dis').write_text(dis+'\n'+tramp_body)
    for ins in ('entry\ta1, 32','l32i.n\ta9, a1, 32','s32i.n\ta9, a1, 0',
                'mov.n\ta10, a2','mov.n\ta11, a3','mov.n\ta12, a4','mov.n\ta13, a5',
                'mov.n\ta14, a6','mov.n\ta15, a7','callx8\ta8','mov.n\ta2, a10','retw.n'):
        if ins not in tramp:raise ValueError('trampoline ABI differs: '+ins)
    call=dis.split('Disassembly of section .call_loop_start:')[1]
    if 'call8\t420496d8' not in call:raise ValueError('matcher call target differs')
    image,receipt=build_candidate(base,sections,lambda n:(a.output/n).read_bytes())
    (a.output/'ota_1_v24.bin').write_bytes(image)
    m={'base_sha256':BASE_SHA,'sections':sections,**receipt,
       'source_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in src.iterdir() if p.is_file()}}
    (a.output/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))

if __name__=='__main__':main()
