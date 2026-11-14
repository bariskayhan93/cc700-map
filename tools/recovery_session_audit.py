#!/usr/bin/env python3
"""Read-only structural audit of extracted CC700 recovery dependencies.

Does not validate all restored fields, create a recovery file, access a device,
or establish that resuming a session is safe. Only local regular files are read.
"""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zlib

EPOCH=0x259d4c00


def dependency_names(data):
    if len(data)!=468:return []
    recording=struct.unpack_from("<I",data,0)[0]
    started=struct.unpack_from("<I",data,12)[0]
    return [f"/FITS/FIT/{recording}.fit",f"/FITS/LAP/{(started+EPOCH)&0xffffffff}.lap"]


def audit_recovery(data,files):
    result={"structural_status":"incomplete","runtime_ready":False,"errors":[],"gaps":[],
            "would_truncate":[],"recovery_sha256":hashlib.sha256(data).hexdigest(),
            "limits":"Only known recovery fields and compressed-prefix structure are checked. No CRC/state validity, activation or successful resume is inferred."}
    errors=result["errors"];gaps=result["gaps"]
    if len(data)!=468:
        if len(data)<468:errors.append("recovery shorter than 468 bytes")
        else:gaps.append("noncanonical recovery length; stock permits longer files but its first/trailing footer relationship is not modeled")
    else:
        u=lambda off:struct.unpack_from("<I",data,off)[0]
        if u(464)!=0xaa555aa5:errors.append("recovery footer marker mismatch")
        offset=u(456)
        result["known_fields"]={"recording_id":u(0),"time12":u(12),"lap_count":data[64],
                                "compressed_offset":offset,"unassigned_footer_word460":u(460)}
        recording,lap=dependency_names(data)
        blob=files.get(recording)
        if blob is None:gaps.append("named recording absent")
        elif offset+18>0xffffffff:errors.append("saved recording offset wraps uint32")
        elif len(blob)<offset+18:errors.append("saved recording offset exceeds available bytes")
        elif blob[:4]!=b".ZIP" or len(blob)<18 or blob[4]!=14 or blob[12:16]!=b".FIT":
            errors.append("named recording is not the expected CC700 compressed envelope")
        else:
            end=18+offset;at=18;chunks=inflated=0
            while at<end:
                if at+2>end:errors.append("saved offset splits chunk length");break
                n=struct.unpack_from("<H",blob,at)[0];at+=2
                if n==0 or n>1024:errors.append("compressed chunk length outside 1..1024");break
                if at+n>end:errors.append("saved offset splits compressed chunk");break
                try:
                    decoder=zlib.decompressobj()
                    raw=decoder.decompress(blob[at:at+n],1281)
                except zlib.error:
                    errors.append("invalid compressed chunk");break
                if len(raw)>1280:errors.append("inflated chunk exceeds 1280 bytes");break
                if not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
                    errors.append("compressed chunk is not one complete zlib stream");break
                at+=n;chunks+=1;inflated+=len(raw)
            result["recording_prefix"]={"chunks":chunks,"decoded_bytes":inflated,"saved_bytes":offset+18}
            if len(blob)>end:result["would_truncate"].append({"path":recording,"before":len(blob),"after":end})
        lap_blob=files.get(lap)
        if lap_blob is None:gaps.append("named lap dependency absent; native helper failure is not modeled as an activation failure")
        else:
            needed=data[64]*12
            if len(lap_blob)<needed:errors.append("saved lap count exceeds available bytes")
            if len(lap_blob)>needed:result["would_truncate"].append({"path":lap,"before":len(lap_blob),"after":needed})
    result["structural_status"]="invalid" if errors else "incomplete" if gaps else "consistent"
    return result


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("recovery",type=Path,help="Extracted RealSession.db or .bak")
    parser.add_argument("--fs-root",type=Path,required=True,help="Local extracted filesystem root")
    args=parser.parse_args()
    data=args.recovery.read_bytes();files={}
    for name in dependency_names(data):
        path=args.fs_root/name.lstrip("/")
        if path.is_file():files[name]=path.read_bytes()
    result=audit_recovery(data,files)
    print(json.dumps(result,indent=2))
    return {"consistent":0,"invalid":1,"incomplete":2}[result["structural_status"]]


if __name__=="__main__":raise SystemExit(main())
