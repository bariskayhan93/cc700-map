#!/usr/bin/env python3
"""Build a guarded cc22 OTA candidate and patch fragments. Never accesses a device."""
import argparse
import re
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import incoming_refs as ir

ROOT = Path(__file__).resolve().parents[1]
V21_SHA = '7deb201d797bdd974bfc0460870288feed2632bb41c81b65338e3307f5d0a139'
CALLS = {
    '.call_guidance_card_timer': (0x42081ee2, 'a5e3ff'),
    '.call_guidance_card_initial': (0x420822cd, 'e5a4ff'),
    '.call_guidance_popup_timer': (0x420870ca, 'e5dfff'),
    '.call_guidance_popup_initial': (0x4208758d, 'a593ff'),
}

# Native evidence guards protect the validity/sentinel and UI consumer contracts.
# Hashes describe own-device bytes; no proprietary instruction payload is stored.
NATIVE_GUARDS = {
    'remaining_getter': (0x4204fd98, 97, '6387b528e3e8a5b5e05d36bd03727a1faeac71ed220760fc7b2ee284c1468c2a'),
    'remaining_formatter': (0x42060540, 65, 'ec07d3fb78ea4cdb08ca8029a54537868f5fc80d511ceac2f65c7965ad84c254'),
    'generic_consumer': (0x42081d1c, 379, '72f62abc9257540c80dd736dfb19f095695c7f9ca67c4e00f6a6acf7818db7cd'),
    'legacy_consumer': (0x42086ec8, 439, 'dad87ac8096b4f3c8f8a9aace3828be1241dcd87da353f4da0a6f6181c870b44'),
}

def check_undefined(nm_output):
    """nm -u output of the linked ELF: any line is an undefined symbol, and the build is refused (D0 item 6)."""
    if nm_output.strip():
        raise ValueError('undefined symbols: '+nm_output.strip().splitlines()[0].strip())

def assert_native_guards(read):
    for name, (address, size, expected) in NATIVE_GUARDS.items():
        if hashlib.sha256(read(address, size)).hexdigest() != expected:
            raise ValueError('native evidence guard failed: '+name)


VERSION = b'CC700_V1.414-cc22'
# Overwritten bytes of this candidate: the two trampoline ranges and the four call sites (D0 item 2, R-D02).
GUIDANCE_RANGES = {'popup': (0x42049690, 0x20), 'card': (0x4205bdb0, 0x20),
                   **{name: (address, 3) for name, (address, _) in CALLS.items()}}
# Frame of the card and popup trampolines. A frame of 32 is safe only while the trampoline stores no stack argument:
# a4..a7 go to registers, and no s32i to a1 may appear (checked below). Any other frame is refused.
TRAMP_FRAME = 32

def check_trampoline(block, name):
    """block: the disassembly of one trampoline. Raises when the frame differs or a stack argument is stored."""
    if f'entry\ta1, {TRAMP_FRAME}' not in block:
        raise ValueError(f'{name} trampoline frame differs from {TRAMP_FRAME}')
    if re.search(r'\bs32i(\.n)?\s+a\d+,\s*a1,', block):
        raise ValueError(f'{name} trampoline stores a stack argument (s32i to a1)')
SCOPES = {
    '.text': (0x421de050, 0x421e0000-0x421de050),
    '.tramp_guidance_card': (0x4205bdb0, 0x20),
    '.tramp_guidance_popup': (0x42049690, 0x20),
    **{name:(address,3) for name,(address,_) in CALLS.items()},
}

def build_candidate(base, sections, fragment_read, espimg):
    """Verify exact baseline/fragments, overlay allowed scopes, rebuild ESP image."""
    if hashlib.sha256(base).hexdigest()!=V21_SHA:
        raise ValueError('expected exact v21 baseline')
    header, segments, _=espimg.read(base)
    if espimg.build(header,segments)!=base:
        raise ValueError('baseline structural/checksum roundtrip failed')
    before=[(address,bytes(data)) for address,data in segments]
    if set(sections)!=set(SCOPES):
        raise ValueError('fragment section inventory differs')
    spans=[]
    for name,item in sections.items():
        address=int(item['address'],16); size=item['bytes']
        if not isinstance(size,int) or size<=0:
            raise ValueError('invalid fragment length: '+name)
        spans.append((address,address+size,name))
    spans.sort()
    for left,right in zip(spans,spans[1:]):
        if left[1]>right[0]: raise ValueError('fragment overlap')
    irom=next(s for s in segments if s[0]==0x42000020)
    drom=next(s for s in segments if s[0]==0x3c1e0020)
    old_irom=bytes(irom[1])
    def read(address,size):
        return bytes(irom[1][address-irom[0]:address-irom[0]+size])
    assert_native_guards(read)
    for name,(address,expected) in CALLS.items():
        if read(address,3).hex()!=expected:
            raise ValueError('original call bytes differ: '+name)
    # Validate every fragment before mutating any segment.
    payloads={}
    for address,end,name in spans:
        item=sections[name]; expected_address,capacity=SCOPES[name]
        if address!=expected_address or end-address>capacity:
            raise ValueError('fragment outside pinned scope: '+name)
        if name in CALLS and end-address!=3:
            raise ValueError('call fragment length differs: '+name)
        data=fragment_read(item['file'])
        if len(data)!=item['bytes'] or hashlib.sha256(data).hexdigest()!=item['sha256']:
            raise ValueError('fragment hash/length mismatch: '+name)
        if read(address,len(data)).hex()!=item['expected_base_hex']:
            raise ValueError('fragment baseline drift: '+name)
        payloads[name]=data
    for address,end,name in spans:
        offset=address-irom[0]
        if end-irom[0]>len(irom[1]):
            irom[1].extend(bytes(end-irom[0]-len(irom[1])))
        irom[1][offset:offset+len(payloads[name])]=payloads[name]
    drom[1][16:48]=VERSION+bytes(32-len(VERSION))
    assert_native_guards(read)
    delta=[]
    for (old_address,old),(address,data) in zip(before,segments):
        if old_address!=address: raise ValueError('segment address drift')
        if address not in (irom[0],drom[0]) and bytes(data)!=old:
            raise ValueError('unrelated segment changed')
        allowed=[(a-address,b-address) for a,b,_ in spans] if address==irom[0] else []
        if address==irom[0]:
            allowed.append((len(old),len(data))) # Only zero alignment gap + new code.
            code_start=SCOPES['.text'][0]-address
            if any(data[len(old):code_start]): raise ValueError('nonzero tail alignment gap')
        if address==drom[0]: allowed=[(16,48)]
        changed=0
        for offset,value in enumerate(data):
            if offset<len(old) and value==old[offset]: continue
            if not any(a<=offset<b for a,b in allowed):
                raise ValueError('unscoped segment delta at '+hex(address+offset))
            changed+=1
        if len(data)<len(old): raise ValueError('segment shrank')
        if changed: delta.append({'segment':hex(address),'changed_or_added_bytes':changed,
                                  'old_bytes':len(old),'new_bytes':len(data)})
    image=espimg.build(header,segments)
    if len(image)>0x420000: raise ValueError('candidate exceeds OTA partition')
    candidate_header,candidate_segments,_=espimg.read(image)
    if candidate_header!=header or espimg.build(candidate_header,candidate_segments)!=image:
        raise ValueError('candidate structural/checksum roundtrip failed')
    if [(a,bytes(d)) for a,d in candidate_segments]!=[(a,bytes(d)) for a,d in segments]:
        raise ValueError('candidate segment roundtrip failed')
    return image, {'version':VERSION.decode(),'image_bytes':len(image),
                   'image_sha256':hashlib.sha256(image).hexdigest(),
                   'page_free_bytes':0x421e0000-irom[0]-len(irom[1]),
                   'segment_delta':delta,'structural_roundtrip':True,
                   'native_guards_passed':True,'no_device_write':True}


def run(*args):
    return subprocess.run([str(x) for x in args], check=True, text=True, capture_output=True).stdout

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--base', type=Path, default=ROOT/'.local/patch-v21/ota_1_v21.bin')
    p.add_argument('--output', type=Path, default=ROOT/'.local/navigation-phase/guidance/build')
    p.add_argument('--prefix', default=str(Path.home()/'xtensa-esp-elf/bin/xtensa-esp32s3-elf-'))
    args=p.parse_args()
    base=args.base.read_bytes()
    if hashlib.sha256(base).hexdigest()!=V21_SHA: raise ValueError('expected exact v21 baseline')
    spec=importlib.util.spec_from_file_location('espimg', ROOT.parent/'cc700-backup/tools/espimg.py')
    espimg=importlib.util.module_from_spec(spec); spec.loader.exec_module(espimg)
    header, segments, _=espimg.read(base)
    assert espimg.build(header,segments)==base
    irom=next(s for s in segments if s[0]==0x42000020)
    def read(address,size): return bytes(irom[1][address-irom[0]:address-irom[0]+size])
    assert_native_guards(read)
    for name,(address,expected) in CALLS.items():
        assert read(address,3).hex()==expected, f'{name}: original call bytes differ'
    # Existing no-fallthrough map trampolines occupy 0x1c bytes and return.
    for address in (0x42049670,0x4205bd90):
        assert read(address,3)==bytes.fromhex('364100')
        assert read(address+0x17,5)==bytes.fromhex('e008001df0')
    incoming=ir.check(irom[1],0x42000020,GUIDANCE_RANGES,ir.DEAD_SPANS)
    args.output.mkdir(parents=True,exist_ok=True)
    elf=args.output/'guidance.elf'
    src=ROOT/'firmware/guidance'
    run(args.prefix+'gcc','-Os','-mlongcalls','-mtext-section-literals','-ffreestanding',
        '-fno-builtin','-nostdlib','-Wall','-Wextra','-Werror','-fstack-usage',
        '-Wl,-T,'+str(src/'guidance.ld'),'-Wl,--gc-sections','-Wl,-e,cc_guidance_card',
        '-o',elf,src/'guidance.c',src/'tramp.S','-lgcc')
    check_undefined(run(args.prefix+'nm','-u',elf))
    allowed={'.text','.tramp_guidance_card','.tramp_guidance_popup',*CALLS}
    sections={}
    for line in run(args.prefix+'objdump','-h',elf).splitlines():
        f=line.split()
        if len(f)<7 or not f[0].isdigit() or not int(f[2],16): continue
        name,size,address=f[1],int(f[2],16),int(f[3],16)
        if name.startswith('.debug'): continue
        assert name in allowed, name
        dest=args.output/(name[1:]+'.bin')
        run(args.prefix+'objcopy','-O','binary','-j',name,elf,dest)
        data=dest.read_bytes(); assert len(data)==size
        sections[name]={'address':hex(address),'bytes':size,'file':dest.name,
                        'sha256':hashlib.sha256(data).hexdigest(),
                        'expected_base_hex':read(address,size).hex()}
    assert set(sections)==allowed
    dis=run(args.prefix+'objdump','-d',elf)
    # Check linked short calls and windowed-ABI argument forwarding in the
    # executable, rather than inferring them from assembly source alone.
    for site in CALLS:
        target='4205bdb0' if 'card' in site else '42049690'
        block=dis.split('Disassembly of section '+site+':')[1].split('Disassembly of section')[0]
        assert 'call8\t'+target in block, site
    for name in ('card','popup'):
        block=dis.split('Disassembly of section .tramp_guidance_'+name+':')[1].split('Disassembly of section')[0]
        check_trampoline(block,name)
        for ins in ('mov.n\ta10, a2','mov.n\ta11, a3','mov.n\ta12, a4','callx8\ta8','retw.n'):
            assert ins in block, (name,ins)
    (args.output/'guidance.dis').write_text(dis)
    (args.output/'size.txt').write_text(run(args.prefix+'size','-A',elf))
    image,receipt=build_candidate(base,sections,lambda name:(args.output/name).read_bytes(),espimg)
    image_path=args.output/'ota_1_v22.bin'
    image_path.write_bytes(image)
    manifest={'base_sha256':V21_SHA,'device_access':False,
              'native_guards':NATIVE_GUARDS,'sections':sections,'incoming_refs':incoming,**receipt}
    (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'image':str(image_path),**receipt},indent=2))

if __name__=='__main__': main()
