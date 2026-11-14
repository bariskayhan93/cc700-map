#!/usr/bin/env python3
"""Build named v19 from pinned v18, without serial/device operations."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BACKUP = ROOT.parent / 'cc700-backup'
OUT = ROOT / '.local/patch-v19'
PREFIX = Path.home() / 'xtensa-esp-elf/bin/xtensa-esp32s3-elf-'
BASE_SHA = 'ae3539c4a2b174b52f8dce866a93303d7aa2c12476d36cc94844adbb52410bd6'


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, capture_output=True,
                          text=True, **kwargs).stdout


def main():
    base = (ROOT / '.local/patch-v18/ota_1_v18.bin').read_bytes()
    assert hashlib.sha256(base).hexdigest() == BASE_SHA, 'unexpected v18 baseline'
    OUT.mkdir(exist_ok=True)
    src = OUT / 'src'
    src.mkdir(exist_ok=True)
    for name in ('map.c', 'blk.c', 'arrow.c', 'fw.h', 'tramp.S', 'patch.ld'):
        shutil.copyfile(BACKUP / 'patch/src' / name, src / name)
    run(str(PREFIX)+'gcc', '-Os', '-mlongcalls', '-mtext-section-literals',
        '-ffreestanding', '-fno-builtin', '-nostdlib', '-Wall', '-fstack-usage',
        '-Wl,-T,patch.ld', '-Wl,--gc-sections', '-Wl,-e,cc_line',
        '-o', '../patch19.elf',
        'map.c', 'blk.c', 'arrow.c', 'tramp.S', '-lgcc', cwd=src)
    elf = OUT / 'patch19.elf'
    spec = importlib.util.spec_from_file_location('espimg', BACKUP/'tools/espimg.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    header, segments, _ = module.read(base)
    assert module.build(header, segments) == base, 'baseline checksum/hash mismatch'
    irom = next(s for s in segments if s[0] == 0x42000020)
    drom = next(s for s in segments if s[0] == 0x3c1e0020)
    allowed = {'.text', '.rodata', '.tramp_line', '.tramp_iter', '.tramp_blk',
               '.tramp_gate', '.tramp_rt', '.lit_route', '.lit_seg', '.call_seg',
               '.col_route', '.call_rt1', '.call_rt2'}
    sections = {}
    for line in run(str(PREFIX)+'objdump', '-h', elf).splitlines():
        fields = line.split()
        if len(fields)<7 or not fields[0].isdigit():
            continue
        name, length, address = fields[1], int(fields[2],16), int(fields[3],16)
        if not length or name.startswith('.debug'):
            continue
        assert name in allowed, f'unexpected loadable section {name}'
        if 0x3c000000 <= address < 0x3d000000:
            address += 0x6000000
        assert 0x42000020 <= address and address+length <= 0x421e0000
        data_path = OUT / 'section.tmp'
        run(str(PREFIX)+'objcopy', '-O', 'binary', '-j', name, elf, data_path)
        data = data_path.read_bytes()
        data_path.unlink()
        assert len(data)==length
        offset=address-irom[0]
        if offset+length>len(irom[1]):
            irom[1].extend(bytes(offset+length-len(irom[1])))
        irom[1][offset:offset+length]=data
        sections[name]={'bytes':length,'address':hex(address)}
    version=b'CC700_V1.414-cc19'
    drom[1][16:48]=version+bytes(32-len(version))
    image=module.build(header,segments)
    assert len(image)<=0x420000
    rebuilt=module.build(*module.read(image)[:2])
    assert rebuilt==image
    image_path=OUT/'ota_1_v19.bin'
    image_path.write_bytes(image)
    files=[elf,image_path,*src.glob('*')]
    manifest={'version':version.decode(),'base_sha256':BASE_SHA,
              'image_bytes':len(image),'page_free_bytes':0x421e0000-irom[0]-len(irom[1]),
              'sections':sections,'no_device_write':True,
              'source_and_artifacts':{str(f.relative_to(OUT)):{'bytes':f.stat().st_size,
                  'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in files if f.is_file()}}
    (OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    (OUT/'size.txt').write_text(run(str(PREFIX)+'size','-A',elf))
    print(json.dumps({'image':str(image_path),'sha256':hashlib.sha256(image).hexdigest(),
                      'image_bytes':len(image),'page_free_bytes':manifest['page_free_bytes'],
                      'text_bytes':sections['.text']['bytes'],'rodata_bytes':sections['.rodata']['bytes']},indent=2))


if __name__=='__main__':
    main()
