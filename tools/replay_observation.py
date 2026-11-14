#!/usr/bin/env python3
"""Check observed native-replay delivery; never manufacture missing telemetry.

This consumes an instrumentation trace, not the ordinary device log. Pass means
only the bounded identity/latency/stop contract below, not navigation acceptance.
Times must be one monotonic, unwrapped capture clock in milliseconds.
"""
import argparse
import json
import math
from pathlib import Path
import re


def assess(trace):
    failures, gaps = [], []
    metrics = {"decoded":0,"accepted":0,"consumed":0,"snapshots":0,
               "rejected":0,"max_queue_latency_ms":None,"max_snapshot_latency_ms":None}
    def fail(s):
        if s not in failures: failures.append(s)
    def gap(s):
        if s not in gaps: gaps.append(s)
    def finite(v):
        if isinstance(v,bool) or not isinstance(v,(int,float)) or v<0:return False
        try:return math.isfinite(v)
        except OverflowError:return False
    def digest(v):
        return isinstance(v,str) and re.fullmatch(r"[0-9a-f]{64}",v) is not None
    if not isinstance(trace,dict):
        return {"status":"fail","failures":["trace must be an object"],"gaps":[],"metrics":metrics}
    if trace.get("origin")!="device":gap("not a device observation")
    for field in ("firmware_sha256","fixture_sha256"):
        if not digest(trace.get(field)):gap(f"missing valid {field}")
    expected={}
    records=trace.get("records",[])
    if not isinstance(records,list):records=[];fail("records must be a list")
    for r in records:
        if not isinstance(r,dict) or not isinstance(r.get("id"),str) or not digest(r.get("sha256")):
            fail("invalid fixture identity");continue
        if r["id"] in expected:fail("duplicate fixture identity")
        expected[r["id"]]=r["sha256"]
    if not expected:gap("fixture record identities absent")
    decoded, submissions, consumed, snapshotted = {}, {}, set(), set()
    consumed_records=set()
    activated=stopped=eof=ended=False
    previous=-1
    last_generation=-1
    last_consumed=None
    events=trace.get("events",[])
    if not isinstance(events,list):events=[];fail("events must be a list")
    for event in events:
        if not isinstance(event,dict):fail("invalid event");continue
        stage=event.get("stage");ms=event.get("ms")
        if not finite(ms) or ms<previous:
            fail("invalid or out-of-order capture time");continue
        previous=ms
        if ended:fail("event after capture end")
        if stage=="activate":
            if activated:fail("multiple activations require separate traces")
            activated=event.get("active") is True
            if not activated:fail("activation did not set active")
        elif stage=="decode":
            if eof:fail("decode after EOF")
            rid=event.get("id")
            if not isinstance(rid,str):fail("invalid decoded identity");continue
            if rid not in expected or event.get("sha256")!=expected.get(rid):fail("decoded fixture identity mismatch")
            if rid in decoded:fail("fixture record decoded more than once")
            decoded[rid]=ms;metrics["decoded"]+=1
            if not activated or stopped:fail("decode outside active run")
        elif stage=="submit":
            sid=event.get("submission");rid=event.get("id")
            if not isinstance(sid,int) or isinstance(sid,bool) or sid<0:fail("invalid submission identity");continue
            if not isinstance(rid,str):fail("invalid submitted identity");continue
            if sid in submissions:fail("duplicate submission identity")
            if rid not in decoded:gap("submission lacks decoded identity: "+rid)
            if event.get("sha256")!=expected.get(rid):fail("submitted fixture identity mismatch")
            if not digest(event.get("payload_sha256")):gap("submitted payload bytes not fingerprinted")
            if not activated:fail("submission before activation")
            if stopped:fail("submission after deactivation")
            result=event.get("result")
            if result not in (0,1,2) or isinstance(result,bool):fail("unsupported enqueue result")
            submissions[sid]={**event,"consumed":False}
            if result==1:metrics["accepted"]+=1
            else:metrics["rejected"]+=1;fail("enqueue rejected")
        elif stage=="consume":
            sid=event.get("submission")
            if not isinstance(sid,int) or isinstance(sid,bool):fail("invalid consumption identity");continue
            queued=submissions.get(sid)
            if queued is None or queued.get("result")!=1:
                fail("consume without accepted submission");continue
            if sid in consumed:fail("submission consumed more than once")
            if (event.get("id")!=queued["id"] or event.get("sha256")!=queued.get("sha256")
                    or event.get("payload_sha256")!=queued.get("payload_sha256")):
                fail("buffer identity changed at consumption")
            if not digest(event.get("payload_sha256")):gap("consumed payload bytes not fingerprinted")
            if isinstance(event.get("id"),str):consumed_records.add(event["id"])
            consumed.add(sid);metrics["consumed"]+=1
            last_consumed=sid
            latency=ms-queued["ms"]
            metrics["max_queue_latency_ms"]=max(latency,metrics["max_queue_latency_ms"] or 0)
        elif stage=="snapshot":
            if stopped:fail("snapshot publication after deactivation")
            sid=event.get("submission");generation=event.get("generation")
            if not isinstance(sid,int) or isinstance(sid,bool):fail("invalid snapshot submission");continue
            if sid not in consumed:gap("snapshot lacks consumed submission")
            else:
                snapshotted.add(sid)
                latency=ms-submissions[sid]["ms"]
                metrics["max_snapshot_latency_ms"]=max(latency,metrics["max_snapshot_latency_ms"] or 0)
            if not isinstance(generation,int) or isinstance(generation,bool) or generation<=last_generation:
                fail("snapshot generation did not advance")
            else:last_generation=generation
            metrics["snapshots"]+=1
        elif stage=="eof":
            if not activated or stopped or not decoded:fail("EOF outside decoded active run")
            if eof:fail("multiple EOF observations require separate traces")
            eof=True
        elif stage=="deactivate":
            stopped=True
            if event.get("active") is not False or event.get("redirected") is not False:
                fail("replay remains active or GPS redirected after stop")
        elif stage=="end":
            ended=True
            if event.get("dropped_trace_events")!=0:gap("trace loss not excluded")
            if event.get("queue_pending")!=0:gap("queue drain not established")
        else:fail("unsupported event stage")
    if not activated:gap("activation not observed")
    if not eof:gap("EOF not observed")
    if not stopped:gap("deactivation not observed")
    if not ended:gap("capture end not observed")
    for rid in expected:
        if rid not in decoded:gap("fixture record not decoded: "+rid)
        if rid not in consumed_records:gap("fixture record not consumed: "+rid)
    for sid,event in submissions.items():
        if event.get("result")==1 and sid not in consumed:gap(f"accepted submission not consumed: {sid}")
    if not snapshotted:gap("no correlated calculation snapshot")
    if last_consumed is not None and last_consumed not in snapshotted:gap("final consumed input lacks snapshot")
    # The processor drains multiple descriptors before calculation; do not demand
    # one snapshot per accepted submission or infer snapshot coordinates from GPS.
    limits=trace.get("limits",{})
    if not isinstance(limits,dict):limits={};fail("limits must be an object")
    for name,key in (("queue_latency_ms","max_queue_latency_ms"),("snapshot_latency_ms","max_snapshot_latency_ms")):
        budget=limits.get(name)
        if not finite(budget):gap(f"missing {name} budget")
        elif metrics[key] is None:gap(f"no {name} measurement")
        elif metrics[key]>budget:fail(name.replace("_ms","").replace("_"," ")+" exceeds budget")
    return {"status":"fail" if failures else "incomplete" if gaps else "pass",
            "failures":failures,"gaps":gaps,"metrics":metrics,
            "scope":"delivery identity, observed latency and explicit stop only; navigation/renderer/hardware excluded"}


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("trace",type=Path)
    args=parser.parse_args()
    try: result=assess(json.loads(args.trace.read_text()))
    except (OSError,ValueError) as error:
        result={"status":"fail","failures":[str(error)]}
    print(json.dumps(result,indent=2,allow_nan=False))
    return {"pass":0,"fail":1,"incomplete":2}[result["status"]]


if __name__=="__main__":raise SystemExit(main())
