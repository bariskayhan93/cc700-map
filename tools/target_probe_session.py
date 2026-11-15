#!/usr/bin/env python3
"""Bounded temporary ota_1 probe session; always restore the exact ordinary image.

Default is a dry run. --apply performs backup, guarded programming, serial capture
and full-partition restoration. Never writes stock ota_0, OTA selection or storage.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import signal
import sys
import time

OTA1=0x440000
OTA1_SIZE=0x420000
V21_SHA='7deb201d797bdd974bfc0460870288feed2632bb41c81b65338e3307f5d0a139'

def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()

def classify_boot(data,explicit_reset=False):
    text=data.decode('latin1');load='Loaded app from partition at offset 0x440000'
    crash=any(w in text.lower() for w in ('guru meditation','panic','abort()','backtrace:','assert failed','brownout'))
    resets=text.count('rst:')
    return {'boot_confirmed':text.count(load)==1 and resets<=1+int(explicit_reset) and not crash,
            'crash_observed':crash,'bytes':len(data),'reset_count':resets,
            'explicit_reset':explicit_reset,
            'samples':sum(text.count(prefix+' ') for prefix in ('CC7M1','CC7M2','CC7M3','CC7F1','CC7F2','CC7B1','CC7B2')),
            'limits':'raw sample markers are not checksummed/identified measurements; analyze separately'}

def run_probe(ordinary,probe,out,backend,config,seconds):
    if not 1<=seconds<=600:raise ValueError('capture must be 1..600 seconds')
    for path,key in ((ordinary,'ordinary_sha256'),(probe,'probe_sha256')):
        if sha(path)!=config[key] or not 0<len(path.read_bytes())<=OTA1_SIZE:raise ValueError('image identity/size differs')
    out.mkdir(parents=True,exist_ok=False)
    result={'phase':'starting','ordinary_sha256':sha(ordinary),'probe_sha256':sha(probe),
            'write_attempted':False,'ordinary_restored':False,'capture':None}
    def save():(out/'receipt.json').write_text(json.dumps(result,indent=2)+'\n')
    save()
    try:
        backend.read(OTA1,OTA1_SIZE,out/'ota1-before.bin')
        current=(out/'ota1-before.bin').read_bytes();base=ordinary.read_bytes()
        if len(current)!=OTA1_SIZE or current[:len(base)]!=base or set(current[len(base):])-{255}:
            raise ValueError('live ota_1 is not exact ordinary baseline plus erased tail')
        backend.read(0xd000,0x2000,out/'otadata-before.bin')
        if (out/'otadata-before.bin').stat().st_size!=0x2000:raise ValueError('OTA metadata backup incomplete')
        result['backup_sha256']=sha(out/'ota1-before.bin');result['otadata_sha256']=sha(out/'otadata-before.bin')
        result['phase']='backup-verified';save()
        result['write_attempted']=True;result['phase']='programming';save()
        backend.write(OTA1,probe);backend.verify(OTA1,probe)
        result['phase']='capturing';save()
        result['capture']=backend.capture(out/'capture.log',seconds)
        if not result['capture'].get('boot_confirmed'):raise RuntimeError('test app boot unconfirmed')
        result['raw_log_sha256']=sha(out/'capture.log')
    except BaseException as error:
        result['error']=str(error)
    finally:
        if result['write_attempted']:
            result['phase']='restoring';save()
            try:
                backend.write(OTA1,out/'ota1-before.bin')
                backend.verify(OTA1,out/'ota1-before.bin')
                backend.verify(0xd000,out/'otadata-before.bin')
                result['restoration_boot']=backend.boot()
                if not result['restoration_boot'].get('boot_confirmed'):raise RuntimeError('ordinary boot unconfirmed')
                result['ordinary_restored']=True
                result['phase']='restored-after-error' if 'error' in result else 'restored'
            except BaseException as error:
                result['restoration_error']=str(error);result['phase']='recovery-required'
        else:
            result['phase']='stopped-before-write'
            try:result['recovery_boot']=backend.boot()
            except BaseException as error:result['recovery_boot_error']=str(error)
        save()
    return result

class SerialBackend:
    def __init__(self,port,out,pylib):self.port=port;self.out=out;self.pylib=pylib;self.first=True;self.number=0
    def command(self,*args):
        self.number+=1
        boot='default_reset' if self.first else 'no_reset';self.first=False
        code='import sys;sys.path.insert(0,sys.argv.pop(1));import esptool;esptool.main()'
        cmd=[sys.executable,'-I','-c',code,str(self.pylib),'--chip','esp32s3','--port',self.port,'--baud','921600',
             '--before',boot,'--after','no_reset_stub','--connect-attempts','3',*map(str,args)]
        self.out.mkdir(parents=True,exist_ok=True)
        print('esptool:',args[0],flush=True)
        with (self.out/f'{self.number:02}-{args[0]}.log').open('w') as stream:subprocess.run(cmd,stdout=stream,stderr=subprocess.STDOUT,check=True,timeout=600)
    def read(self,address,length,path):self.command('read_flash',hex(address),hex(length),path)
    def write(self,address,path):
        if address!=OTA1:raise ValueError('write outside ota_1 rejected')
        self.command('write_flash',hex(address),path)
    def verify(self,address,path):self.command('verify_flash',hex(address),path)
    def capture(self,path,seconds):
        self.first=True # The app reset leaves the esptool stub; restoration must enter ROM again.
        sys.path.insert(0,str(self.pylib));import serial
        port=serial.Serial(port=None,baudrate=115200,timeout=.2);port.dtr=False;port.rts=False;port.port=self.port;port.open()
        data=bytearray();explicit=False
        try:
            deadline=time.monotonic()+seconds
            # Opening this board's port can itself reset it. Observe that boot
            # before deciding whether an explicit RTS pulse is still needed.
            observe_until=time.monotonic()+.5
            while time.monotonic()<observe_until:data.extend(port.read(4096))
            if not any(marker in data for marker in (b'ESP-ROM',b'rst:',b'Loaded app')):
                explicit=True;port.rts=True;time.sleep(.2);port.rts=False
            with path.open('wb') as stream:
                stream.write(data);stream.flush()
                while time.monotonic()<deadline:
                    chunk=port.read(4096);data.extend(chunk);stream.write(chunk);stream.flush()
        finally:port.close()
        return classify_boot(data,explicit_reset=explicit)
    def boot(self):return self.capture(self.out/'ordinary-boot.log',8)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--ordinary',type=Path,required=True);p.add_argument('--probe',type=Path,required=True)
    p.add_argument('--manifest',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    p.add_argument('--port',default='/dev/cu.usbmodem101');p.add_argument('--seconds',type=int,default=170)
    p.add_argument('--pylib',type=Path,default=Path('/Users/baris/cc700-backup/pylib'));p.add_argument('--apply',action='store_true')
    a=p.parse_args();manifest=json.loads(a.manifest.read_text())
    if sha(a.ordinary)!=V21_SHA or manifest.get('ordinary_v21_sha256')!=V21_SHA or manifest.get('test_only') is not True:
        p.error('expected verified ordinary v21 and test-only manifest')
    config={'ordinary_sha256':V21_SHA,'probe_sha256':manifest['image_sha256']}
    if sha(a.probe)!=config['probe_sha256']:p.error('probe identity differs')
    if not a.apply:
        print(json.dumps({'dry_run':True,'config':config,'writes':['ota_1 only, then exact full restoration'],
            'capture_seconds':a.seconds,'route_workload_identity_required':True},indent=2));return 0
    if not Path(a.port).is_char_device():p.error('device absent')
    def interrupted(signum,frame):raise InterruptedError(f'signal {signum}')
    signal.signal(signal.SIGTERM,interrupted)
    result=run_probe(a.ordinary,a.probe,a.output,SerialBackend(a.port,a.output/'commands',a.pylib),config,a.seconds)
    print(json.dumps(result,indent=2));return 0 if result['phase']=='restored' else 1
if __name__=='__main__':raise SystemExit(main())
