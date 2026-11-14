"""Known regressions must remain visible in the combined local report."""
import unittest
from pathlib import Path
import subprocess
import tempfile
from validate_local import classify


class ValidationStatus(unittest.TestCase):
    def test_historical_known_failures_remain_known_and_not_pass(self):
        output="FAIL  GPS recording, 3 m noise          x\n      25 turns, outbound has 15\nFAIL  planner export, every 8th point     x\n      3 turns, outbound has 15\n2 failed\n"
        self.assertEqual(classify("historical",1,output),"known_failures")

    def test_new_historical_failure_is_not_hidden_by_known_failures(self):
        self.assertEqual(classify("historical",1,"FAIL  return                x\n2 failed\n"),"fail")

    def test_new_invariant_failure_in_known_case_is_not_allowlisted(self):
        output="FAIL  GPS recording, 3 m noise          x\n      read back 0 of 100 sections\nFAIL  planner export, every 8th point     x\n      map index 0 for 100 sections\n2 failed\n"
        self.assertEqual(classify("historical",1,output),"fail")

    def test_changed_known_failure_metrics_require_review(self):
        output="FAIL  GPS recording, 3 m noise          x\n      999 turns, outbound has 15\nFAIL  planner export, every 8th point     x\n      3 turns, outbound has 15\n2 failed\n"
        self.assertEqual(classify("historical",1,output),"fail")

    def test_executed_node_todo_is_not_green_acceptance(self):
        self.assertEqual(classify("node",0,"ℹ todo 1\n"),"known_failures")
        self.assertEqual(classify("node",0,"# todo 1\n"),"known_failures")

    def test_skipped_python_prerequisites_are_incomplete(self):
        self.assertEqual(classify("python",0,"Ran 91 tests\nOK (skipped=1)\n"),"incomplete")

    def test_crash_and_missing_inputs_are_not_test_passes(self):
        self.assertEqual(classify("historical",1,"input absent\n"),"fail")

    def test_ride_proxy_requires_real_samples_and_zero_absent(self):
        for output in ("", "full loader C: coverage-proxy absent 0/0", "full loader C: coverage-proxy absent 1/576"):
            self.assertEqual(classify("ride_proxy",0,output),"fail")
        self.assertEqual(classify("ride_proxy",0,"full loader C: coverage-proxy absent 0/576"),"pass")

    def test_historical_points_exception_cannot_fake_success(self):
        root=Path(__file__).resolve().parents[1]
        if not (root/".local/cc700-evidence-20261113/local-validation/edge-input.json").exists():
            self.skipTest("private historical input unavailable")
        source=(root/"tools/test_route_historical.mjs").read_text()
        mutant=source.replace("const r = buildRoute(","const r = ((...args) => {throw Error('need points')})(")
        self.assertNotEqual(source,mutant)
        with tempfile.NamedTemporaryFile(mode="w",suffix=".mjs",prefix=".historical-",dir=root/"tools") as f:
            f.write(mutant);f.flush()
            result=subprocess.run(["node",f.name],capture_output=True,text=True,timeout=60)
        self.assertEqual(result.returncode,1,result.stdout+result.stderr)
        self.assertIn("12 failed",result.stdout)


if __name__=="__main__":unittest.main()
