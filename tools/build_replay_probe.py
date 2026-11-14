#!/usr/bin/env python3
"""Build a test-only native-replay activation probe. Never flashes a device.

Only the preserved v18 image is accepted. This is not the instrumented capture
build and must not be installed as ordinary riding firmware.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT.parent/"cc700-backup/tools"))
from espimg import read, build

BASE_SHA256="ae3539c4a2b174b52f8dce866a93303d7aa2c12476d36cc94844adbb52410bd6"
VERSION="CC700_V1.414-rptest01"
SITE=0x42042605


def build_probe(base):
    digest=hashlib.sha256(base).hexdigest()
    if digest!=BASE_SHA256:raise ValueError("Input is not the pinned v18 image")
    hdr,segs,_=read(base)
    if build(hdr,segs)!=base:raise ValueError("Invalid base checksum, hash or image envelope")
    code=next(data for addr,data in segs if addr==0x42000020)
    at=SITE-0x42000020
    if code[at:at+2]!=bytes.fromhex("ad03"):raise ValueError("Unexpected STARTING argument instruction")
    # mov.n a10,a3 -> movi.n a10,1. The following stock wrapper call is unchanged.
    code[at:at+2]=bytes.fromhex("0c1a")
    drom=next(data for addr,data in segs if addr==0x3c1e0020)
    if drom[:4]!=bytes.fromhex("3254cdab"):raise ValueError("Invalid app descriptor")
    version=VERSION.encode()
    drom[16:48]=version+bytes(32-len(version))
    image=build(hdr,segs)
    manifest={"version":VERSION,"base_sha256":digest,"image_sha256":hashlib.sha256(image).hexdigest(),
              "bytes":len(image),"code_changes":[{"address":hex(SITE),"before":"ad03","after":"0c1a",
               "meaning":"STARTING requests replay activation instead of deactivation"}],
              "device_written":False,"collector_present":False,"target_validated":False,
              "preconditions":["Disposable fresh activity only; never resume a personal recording",
                               "Explicit replay configuration and known selected FIT source",
                               "Proven trace collector and readback/stop/cleanup workflow before any runtime acceptance"],
              "restore":"Use preserved byte-exact v18 after a separately controlled test; no writer is included",
              "limits":"The native config/buffer/source guards remain. This image alone proves no FIT decoding, delivery, timing or navigation behavior."}
    return image,manifest


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base",type=Path,default=ROOT.parent/"cc700-backup/patch/ota_1_v18.bin")
    parser.add_argument("--output",type=Path,required=True,help="New local directory; existing paths are refused")
    args=parser.parse_args()
    image,manifest=build_probe(args.base.read_bytes())
    args.output.mkdir(parents=True,exist_ok=False)
    (args.output/"native-start-probe.bin").write_bytes(image)
    (args.output/"manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
    print(json.dumps(manifest,indent=2))


if __name__=="__main__":main()
