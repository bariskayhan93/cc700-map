#!/usr/bin/env python3
"""Run repeatable local checks. Never accesses or modifies the CC700.

Exit 0: local checks pass; 1: unexpected failure; 2: known failures/missing
inputs remain. Target acceptance is reported separately and is never inferred.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

ROOT=Path(__file__).resolve().parents[1]
EVIDENCE=ROOT/".local/cc700-evidence-20261113/local-validation"
PATCH=Path(os.environ.get("CC700_PATCH_SRC",ROOT.parent/"cc700-backup/patch/src/blk.c")).resolve().parent


def classify(name, code, output):
    if name=="historical" and code==1:
        failed=re.findall(r"^FAIL  (.*?)\s{2,}",output,re.M)
        known={"GPS recording, 3 m noise","planner export, every 8th point"}
        details=re.findall(r"^ {6}(?!note:)(.+)$",output,re.M)
        only_counts=len(details)==2 and dict(zip(failed,details))=={
            "GPS recording, 3 m noise":"25 turns, outbound has 15",
            "planner export, every 8th point":"3 turns, outbound has 15"}
        if set(failed)==known and len(failed)==2 and only_counts and re.search(r"^2 failed$",output,re.M):
            return "known_failures"
    if code!=0:return "fail"
    if name=="python" and re.search(r"\bskipped=[1-9]\d*",output):return "incomplete"
    if name=="ride_proxy":
        result=re.search(r"full loader C: coverage-proxy absent (\d+)/(\d+)",output)
        if not result or int(result[1])!=0 or int(result[2])==0:return "fail"
    if name=="node" and re.search(r"(?:#|ℹ) todo [1-9]",output):return "known_failures"
    return "pass"


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output",type=Path,help="New output directory (default timestamped .local/validation)")
    parser.add_argument("--observation",type=Path,help="Optional real replay telemetry, checked separately")
    args=parser.parse_args()
    stamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    out=(args.output or ROOT/".local/validation"/stamp).resolve()
    out.mkdir(parents=True,exist_ok=False)
    report={"observed_utc":datetime.now(timezone.utc).isoformat(),"steps":[],"source_sha256":{},
            "target_acceptance":"unvalidated",
            "target_gaps":["native replay record delivery/timing/EOF observation",
                           "device frame/lock/heap budgets", "live phone reroute",
                           "physical GNSS/heading and targeted motion acceptance"],
            "limits":"Host C and transcribed contracts are separate; no whole-device or instruction equivalence claim."}
    # Fingerprint the inputs; no automatic source promotion or firmware write.
    paths=list((ROOT/"js").glob("*.js"))+list((ROOT/"tools").glob("*.py"))+list((ROOT/"tools").glob("*.mjs"))+list((ROOT/"tools").glob("*.c"))
    paths += [p for p in (ROOT/"firmware").rglob("*") if p.is_file()]
    paths += [ROOT/n for n in ("sw.js","index.html","manifest.webmanifest")]
    paths += [PATCH/n for n in ("blk.c","arrow.c","map.c","fw.h")]
    for p in paths:
        if p.is_file():report["source_sha256"][str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
    commands=[("python",[sys.executable,"-I","-m","unittest","discover","-s","tools","-p","test_*.py"]),
              ("node",["node","--test","tools/test_wayback_tree.mjs","tools/test_preview.mjs","tools/test_preview_guidance.mjs","tools/test_route_decisions.mjs","tools/test_route_production_noise.mjs","tools/test_junction_candidates.mjs","tools/test_navigation_policy.mjs","tools/test_route_captions.mjs","tools/test_navsource.mjs","tools/test_service_worker.mjs","tools/test_map_style.mjs","tools/test_surface.mjs","tools/test_map_geometry.mjs","tools/test_map_labels.mjs","tools/test_map_order.mjs","tools/test_map_contract.mjs","tools/test_device_parity.mjs","tools/test_adaptive_map.mjs","tools/test_map_budget.mjs","tools/test_map_coverage.mjs","tools/test_map_benchmark.mjs","tools/test_map_policy_study.mjs","tools/test_recovery_study.mjs","tools/test_routing_snapshot.mjs","tools/test_elevation_study.mjs","tools/test_recovery_ride_study.mjs","tools/test_recovery_transitions.mjs","tools/test_recovery_leg_packet.mjs","tools/test_recovery_association.mjs","tools/test_recovery_planner.mjs","tools/test_recovery_feasibility.mjs","tools/test_recovery_spatial.mjs","tools/test_recovery_graph_packet.mjs","tools/test_recovery_package.mjs","tools/test_recovery_provider.mjs","tools/test_recovery_package_audit.mjs","tools/test_recovery_outside_audit.mjs"]),
              ("offline_app",["node","tools/test_app_offline.mjs"]),
              ("historical",["node","tools/test_route_historical.mjs"])]
    ride_root=ROOT/".local/ride-incident-20261113/fs"
    ride_inputs=[ride_root/"NAVIGATION/route_11132137.bin",ride_root/"FITS/FIT/1794602602.fit",ride_root/"LOG/20261113.log"]
    if all(p.is_file() for p in ride_inputs):
        commands.append(("ride_proxy",[sys.executable,"-I","tools/cc700_replay.py",*(str(p) for p in ride_inputs),
                                       "--fix","--loader-source",str(PATCH/"blk.c")]))
        for p in ride_inputs:report["source_sha256"][str(p)]=hashlib.sha256(p.read_bytes()).hexdigest()
    else:
        report["steps"].append({"name":"ride_proxy","status":"incomplete","reason":"private ride inputs absent"})
    for name,cmd in commands:
        if name=="historical" and not (EVIDENCE/"edge-input.json").is_file():
            report["steps"].append({"name":name,"status":"incomplete","reason":"private fixture absent"});continue
        started=time.monotonic()
        print(f"Running {name}...",flush=True)
        try:
            run=subprocess.run(cmd,cwd=ROOT,capture_output=True,text=True,timeout=300)
            output=run.stdout+run.stderr
            code=run.returncode
        except subprocess.TimeoutExpired as e:
            output="timeout after 300 seconds\n"+(e.stdout or b"").decode(errors="replace")+(e.stderr or b"").decode(errors="replace")
            code=124
        except OSError as e:output=str(e);code=127
        (out/f"{name}.log").write_text(output)
        state=classify(name,code,output)
        report["steps"].append({"name":name,"status":state,"returncode":code,
                                "duration_seconds":round(time.monotonic()-started,3),"log":f"{name}.log"})
        print(f"  {state}",flush=True)
    if args.observation:
        sys.path.insert(0,str(ROOT/"tools"))
        from replay_observation import assess
        try: observation=assess(json.loads(args.observation.read_text()))
        except (OSError,ValueError) as e:observation={"status":"fail","failures":[str(e)]}
        report["replay_delivery_observation"]=observation
        # A delivery-only pass cannot close rendering, navigation or hardware.
    states=[s["status"] for s in report["steps"]]
    report["local_status"]="fail" if "fail" in states else "incomplete" if any(s!="pass" for s in states) else "pass"
    report["status"]=report["local_status"]
    if args.observation and report["replay_delivery_observation"]["status"]!="pass":
        observation_state=report["replay_delivery_observation"]["status"]
        if report["status"]!="fail":report["status"]=observation_state
    (out/"report.json").write_text(json.dumps(report,indent=2)+"\n")
    print(f"Local status: {report['local_status']}; target acceptance: {report['target_acceptance']}\nReport: {out/'report.json'}")
    return {"pass":0,"fail":1,"incomplete":2}[report["status"]]


if __name__=="__main__":raise SystemExit(main())
