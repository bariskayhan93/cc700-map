"""Invented traces test the evidence checker, not the device."""
import copy
import unittest
from replay_observation import assess


def trace():
    digest = "a" * 64
    result = {
        "origin": "device", "firmware_sha256": digest, "fixture_sha256": digest,
        "records": [{"id": "r0", "sha256": digest}, {"id": "r1", "sha256": "b"*64}],
        "events": [
            {"stage":"activate", "ms":0, "active":True},
            {"stage":"decode", "ms":1, "id":"r0", "sha256":digest},
            {"stage":"submit", "ms":2, "id":"r0", "sha256":digest, "submission":0, "result":1},
            {"stage":"consume", "ms":3, "submission":0, "id":"r0", "sha256":digest},
            {"stage":"snapshot", "ms":4, "submission":0, "generation":0},
            {"stage":"decode", "ms":1001, "id":"r1", "sha256":"b"*64},
            {"stage":"submit", "ms":1002, "id":"r1", "sha256":"b"*64, "submission":1, "result":1},
            {"stage":"consume", "ms":1003, "submission":1, "id":"r1", "sha256":"b"*64},
            {"stage":"snapshot", "ms":1004, "submission":1, "generation":1},
            {"stage":"eof", "ms":2000},
            {"stage":"deactivate", "ms":2001, "active":False, "redirected":False},
            {"stage":"end", "ms":3000, "dropped_trace_events":0, "queue_pending":0},
        ],
        "limits": {"queue_latency_ms":10, "snapshot_latency_ms":20},
    }
    for event in result["events"]:
        if event["stage"] in ("submit","consume"):event["payload_sha256"]="c"*64
    return result


class ReplayObservation(unittest.TestCase):
    def test_complete_stage_identity_chain(self):
        result=assess(trace())
        self.assertEqual(result["status"], "pass", result)
        self.assertEqual(result["metrics"]["max_queue_latency_ms"],1)

    def test_buffer_reuse_is_detected_at_consumption(self):
        t=trace(); t["events"][3]["id"]="r1"; t["events"][3]["sha256"]="b"*64
        self.assertIn("buffer identity changed", " ".join(assess(t)["failures"]))

    def test_missing_consumer_or_snapshot_does_not_pass(self):
        for stage in ("consume","snapshot"):
            t=trace(); t["events"]=[e for e in t["events"] if e["stage"]!=stage]
            self.assertNotEqual(assess(t)["status"],"pass")

    def test_eof_without_deactivation_leaves_explicit_gap(self):
        t=trace(); t["events"]=[e for e in t["events"] if e["stage"]!="deactivate"]
        self.assertIn("deactivation not observed",assess(t)["gaps"])

    def test_reused_record_can_be_submitted_again(self):
        t=trace(); t["events"].insert(5,{"stage":"submit","ms":10,"id":"r0","sha256":"a"*64,"submission":2,"result":1})
        t["events"][5]["payload_sha256"]="c"*64
        t["events"].insert(6,{"stage":"consume","ms":11,"id":"r0","sha256":"a"*64,"payload_sha256":"c"*64,"submission":2})
        self.assertEqual(assess(t)["status"],"pass")

    def test_budget_exceeded_is_a_failure(self):
        t=trace();t["limits"]["queue_latency_ms"]=0
        self.assertIn("queue latency exceeds budget",assess(t)["failures"])

    def test_absent_budgets_and_dropped_trace_are_not_measurement_success(self):
        t=trace(); t["limits"]={}; t["events"][-1]["dropped_trace_events"]=1
        self.assertEqual(assess(t)["status"],"incomplete")

    def test_rejected_enqueue_is_not_a_consumed_record(self):
        t=trace();t["events"][2]["result"]=2
        self.assertIn("consume without accepted submission", " ".join(assess(t)["failures"]))

    def test_synthetic_trace_never_proves_target_acceptance(self):
        t=trace();t["origin"]="synthetic"
        self.assertEqual(assess(t)["status"],"incomplete")

    def test_duplicate_timestamp_does_not_merge_record_identities(self):
        t=trace()
        for r in t["records"]:r["timestamp"]=100
        t["events"]= [e for e in t["events"] if not(e["stage"]=="decode" and e["id"]=="r1")]
        self.assertIn("fixture record not decoded: r1",assess(t)["gaps"])

    def test_out_of_order_and_nonfinite_capture_time_are_rejected(self):
        for time in (-1, float("nan"), float("inf")):
            t=trace();t["events"][3]["ms"]=time
            self.assertEqual(assess(t)["status"],"fail")

    def test_duplicate_submission_and_post_stop_publication_fail(self):
        t=trace();e=copy.copy(t["events"][2]);e["ms"]=2500;t["events"].insert(-1,e)
        result=assess(t)
        self.assertIn("submission after deactivation",result["failures"])

    def test_mutated_payload_even_with_same_record_identity_fails(self):
        t=trace();t["events"][3]["payload_sha256"]="d"*64
        self.assertIn("buffer identity changed", " ".join(assess(t)["failures"]))

    def test_decoded_but_never_delivered_record_is_a_gap(self):
        t=trace();t["events"]=[e for e in t["events"] if e.get("submission")!=1]
        self.assertIn("fixture record not consumed: r1",assess(t)["gaps"])

    def test_missing_enqueue_result_returns_failure_without_exception(self):
        t=trace();del t["events"][2]["result"]
        self.assertEqual(assess(t)["status"],"fail")

    def test_final_consumed_input_needs_calculation_publication(self):
        t=trace();t["events"]=[e for e in t["events"] if not(e["stage"]=="snapshot" and e["submission"]==1)]
        self.assertIn("final consumed input lacks snapshot",assess(t)["gaps"])

    def test_eof_cannot_precede_decoding(self):
        t=trace();t["events"]=[e for e in t["events"] if e["stage"]!="eof"]
        t["events"].insert(1,{"stage":"eof","ms":0})
        self.assertIn("decode after EOF",assess(t)["failures"])

    def test_unrepresentable_numeric_capture_time_fails_without_exception(self):
        t=trace();t["events"][1]["ms"]=10**400
        self.assertEqual(assess(t)["status"],"fail")


if __name__=="__main__":unittest.main()
