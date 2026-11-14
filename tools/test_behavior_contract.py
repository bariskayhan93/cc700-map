"""Hand-derived fixtures for the manually transcribed extracted behavior model."""
import unittest

import behavior_contract as bc


class Contracts(unittest.TestCase):
    def test_distance_boundaries_and_order(self):
        decide = bc.offroute_candidate
        # P, Q, A, S, D, candidate, output: literal branch-boundary fixtures.
        for p, q, a, s, d, c, output in [
            (0, 0, 0, 0, 0, 0, "projection"),
            (10, 50, 180, 1, 50, 1, "projection"),
            (10, 51, 0, 1, 51, 0, "input"),
            (10, 99, 0, 1, 99, 0, "input"),
            (10, 100, 0, 0, 100, 1, "input"),
            (9, 100, 0, 0, 9, 0, "center"),
            (149, 20, 31, 1, 20, 0, "projection"),
            (150, 20, 30, 1, 20, 0, "projection"),
            (150, 20, 31, 1, 20, 1, "projection"),
            (150, 20, -31, 1, 20, 1, "projection"),
        ]:
            with self.subTest(p=p, q=q, a=a):
                result = decide(p, q, a, s)
                self.assertEqual((result.distance, result.candidate, result.output_position),
                                 (d, c, output))

    def test_distance_substitution_strict_tie_and_uint32_multiply(self):
        decide = bc.offroute_candidate
        # 429496730 * 10 wraps to 4; 429496729 * 10 does not wrap.
        for p, q, d, substitute in [(5, 50, 50, False), (5, 51, 5, True),
                                   (429496730, 4, 4, False),
                                   (429496730, 5, 429496730, True),
                                   (429496729, 5, 5, False),
                                   (0xffffffff, 0xffffffff, 0xffffffff, True)]:
            with self.subTest(p=p, q=q):
                result = decide(p, q, 0, 0)
                self.assertEqual((result.distance, result.center_substituted), (d, substitute))

    def test_angle_band_is_signed_unwrapped_and_speed_sensitive(self):
        decide = bc.offroute_candidate
        for a, s, expected in [(150, 1, 0), (-150, 1, 0), (151, 1, 1),
                               (-151, 1, 1), (209, 1, 1), (-209, 1, 1),
                               (210, 1, 0), (-210, 1, 0), (359, 1, 0),
                               (180, 0, 0), (180, -1, 1), (180, -0.0, 0),
                               (0x7fffffff, 1, 0), (-0x7fffffff, 1, 0)]:
            with self.subTest(a=a, s=s):
                self.assertEqual(decide(100, 20, a, s).candidate, expected)

    def test_offroute_rejects_unextracted_conversion_inputs(self):
        decide = bc.offroute_candidate
        unsupported = bc.UnsupportedInput
        for args in [(-1, 20, 0, 0), (0x100000000, 20, 0, 0),
                     (1.2, 20, 0, 0), (1, float("nan"), 0, 0),
                     (1, 20, 0.5, 0), (1, 20, -0x80000000, 0),
                     (1, 20, 0x80000000, 0), (1, 20, 0, float("nan")),
                     (1, 20, 0, float("inf"))]:
            with self.subTest(args=args), self.assertRaises(unsupported):
                decide(*args)

    def test_both_state_directions_require_change_plus_ten_repeats(self):
        state_type = bc.OffrouteState
        step = bc.persist_offroute
        for initial, candidate in [(0, 1), (1, 0)]:
            state = state_type(initial, initial, 8)
            expected_counts = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10]
            expected_committed = [initial] * 10 + [candidate, candidate]
            for count, committed in zip(expected_counts, expected_committed):
                state = step(state, candidate, distance=100, center_distance=100, search_mode=0).state
                self.assertEqual((state.previous_candidate, state.count, state.committed),
                                 (candidate, count, committed))

    def test_interruption_restarts_repeat_count(self):
        state = bc.OffrouteState(0, 0, 0)
        step = bc.persist_offroute
        for candidate, count, committed in [(1, 0, 0), (1, 1, 0), (0, 0, 0),
                                             (1, 0, 0), (1, 1, 0)]:
            state = step(state, candidate, distance=20, center_distance=20, search_mode=0).state
            self.assertEqual((state.count, state.committed), (count, committed))

    def test_counter_wrap_precedes_saturation(self):
        state_type = bc.OffrouteState
        step = bc.persist_offroute
        for count, want_count, want_committed in [(9, 10, 1), (10, 10, 1),
                                                  (65534, 10, 1), (65535, 0, 0)]:
            result = step(state_type(1, 0, count), 1, distance=20,
                          center_distance=20, search_mode=0)
            self.assertEqual((result.state.count, result.state.committed),
                             (want_count, want_committed))

    def test_proximity_and_mode_one_use_committed_state(self):
        state_type = bc.OffrouteState
        step = bc.persist_offroute
        for committed, d, p, mode, expected_flag, expected_count in [
            (1, 24, 151, 0, True, 1), (1, 25, 151, 0, False, 1),
            (1, 24, 150, 0, False, 1), (0, 24, 151, 0, False, 1),
            (1, 24, 151, 1, True, 0), (1, 25, 151, 1, False, 0),
            (0, 24, 151, 1, False, 1)]:
            result = step(state_type(0, committed, 0), 0, distance=d,
                          center_distance=p, search_mode=mode)
            self.assertEqual((result.proximity, result.state.count),
                             (expected_flag, expected_count))

    def test_persistence_rejects_unsupported_state_and_mode(self):
        state_type = bc.OffrouteState
        step = bc.persist_offroute
        unsupported = bc.UnsupportedInput
        for state, candidate, mode in [(state_type(2, 0, 0), 1, 0),
                                        (state_type(0, 2, 0), 1, 0),
                                        (state_type(0, 0, 65536), 1, 0),
                                        (state_type(0, 0, 0), 2, 0),
                                        (state_type(0, 0, 0), 1, 2)]:
            with self.assertRaises(unsupported):
                step(state, candidate, distance=20, center_distance=20, search_mode=mode)

    def test_heading_fast_path_threshold_zero_course_and_validity(self):
        select = bc.select_heading
        for speed, course, valid, status, cache, context, output in [
            (3000, 90000, 0, 0, 90, 360, 360),
            (3000, 0, 1, 3, 12, 438, 78),
            (2999, 90000, 1, 3, 123, 327, 327),
            (2999, 90000, 0, 3, 12, 438, 78),
            (2999, 90000, 1, 2, 12, 438, 78),
            (float("nan"), 90000, 1, 3, 123, 327, 327),
            (3000, -1000, 0, 0, -1, 451, 91),
        ]:
            result = select(12, speed, course, valid, status, 123)
            self.assertEqual((result.cached, result.context_heading, result.map_heading,
                              result.context_enabled), (cache, context, output, 1))

    def test_heading_uses_binary32_course_conversion(self):
        result = bc.select_heading(0, 3000, 16777217, 0, 0, 0)
        self.assertEqual(result.cached, 16777.216796875)
        self.assertEqual(result.context_heading, -16327.216796875)

    def test_heading_normalizes_once_and_nonzero_mode_bypasses_counter(self):
        setter = bc.set_heading
        for heading, expected in [(360, 360), (361, 1), (1080, 720), (-10, -10)]:
            result = setter(heading, mode=1, previous=77, count=5)
            self.assertEqual((result.output, result.previous, result.count), (expected, 77, 5))

    def test_heading_mode_zero_truncation_keeps_previous_on_small_difference(self):
        result = bc.set_heading(150.9, mode=0, previous=0, count=5)
        self.assertEqual((result.output, result.previous, result.count), (150.89999389648438, 0, 0))

    def test_heading_seventh_large_difference_commits(self):
        setter = bc.set_heading
        previous, count = 0, 0
        for expected in [(0, 0, 1), (0, 0, 2), (0, 0, 3), (0, 0, 4),
                         (0, 0, 5), (0, 0, 6), (200, 200, 6), (200, 200, 0)]:
            result = setter(200, mode=0, previous=previous, count=count)
            self.assertEqual((result.output, result.previous, result.count), expected)
            previous, count = result.previous, result.count

    def test_heading_rejects_unextracted_nonfinite_truncation(self):
        setter = bc.set_heading
        unsupported = bc.UnsupportedInput
        for new in [float("nan"), float("inf"), 1e20]:
            with self.assertRaises(unsupported):
                setter(new, mode=0, previous=0, count=0)
        select = bc.select_heading
        with self.assertRaises(unsupported):
            select(0, 3000, 0x80000000, 1, 3, 0)

    def test_timer_unsigned_threshold_and_wrap(self):
        expired = bc.timer_expired
        for now, base, period, expected in [(99, 0, 100, False), (100, 0, 100, True),
                                           (0, 0, 0, True), (2, 0xfffffffc, 6, True),
                                           (1, 0xfffffffc, 6, False),
                                           (0xffffffff, 0, 0xffffffff, True),
                                           (0, 0, 0xffffffff, False)]:
            self.assertEqual(expired(now, base, period), expected)

    def test_plus_two_clock_cannot_reach_odd_elapsed_sentinel(self):
        advance = bc.advance_gui_clock
        expired = bc.timer_expired
        for baseline in [0, 1, 0xfffffffe, 0xffffffff]:
            for steps, elapsed in [(0, 0), (1, 2), (0x7fffffff, 0xfffffffe),
                                   (0x80000000, 0), (0x80000001, 2)]:
                now = advance(baseline, steps)
                self.assertEqual(bc.gui_elapsed(now, baseline), elapsed)
                self.assertFalse(expired(now, baseline, 0xffffffff))
        self.assertEqual(advance(0xfffffffe, 1), 0)
        self.assertEqual(advance(0xffffffff, 1), 1)

    def test_timer_does_not_accumulate_missed_wraps(self):
        advance = bc.advance_gui_clock
        expired = bc.timer_expired
        self.assertTrue(expired(advance(0, 50), 0, 100))
        self.assertFalse(expired(advance(0, 0x80000001), 0, 100))

    def test_timer_rejects_non_word_inputs_and_negative_ticks(self):
        unsupported = bc.UnsupportedInput
        with self.assertRaises(unsupported):
            bc.timer_expired(-1, 0, 100)
        with self.assertRaises(unsupported):
            bc.advance_gui_clock(0, -1)

    def test_candidate_and_persistence_sequence_requires_eleven_calls_each_way(self):
        decide = bc.offroute_candidate
        step = bc.persist_offroute
        state = bc.OffrouteState(0, 0, 0)
        # Leave via >99; return via angle=30 at P=151 and projected D=24.
        for p, q, angle, committed, count, proximity in (
            [(10, 100, 0, 0, 0, False)]
            + [(10, 100, 0, 0, n, False) for n in range(1, 10)]
            + [(10, 100, 0, 1, 10, False), (151, 24, 30, 1, 0, True)]
            + [(151, 24, 30, 1, n, True) for n in range(1, 10)]
            + [(151, 24, 30, 0, 10, False)]
        ):
            decision = decide(p, q, angle, 1)
            result = step(state, decision.candidate, distance=decision.distance,
                          center_distance=p, search_mode=0)
            state = result.state
            self.assertEqual((state.committed, state.count, result.proximity),
                             (committed, count, proximity))

    def test_ride_state_start_load_and_end_call_gates(self):
        request = bc.ride_replay_request
        for state, load_result, expected in [(1, None, 0), (2, 0, 1),
                                              (2, 1, None), (2, -1, None),
                                              (6, None, 0), (7, None, 0)]:
            self.assertEqual(request(state, load_result=load_result), expected)
        unsupported = bc.UnsupportedInput
        for state, load_result in [(2, None), (3, None), (0, None)]:
            with self.assertRaises(unsupported):
                request(state, load_result=load_result)

    def test_replay_guards_also_block_deactivation(self):
        state = bc.ReplayState(1, 7, 11, 12, 1, 1)
        transition = bc.replay_transition
        for buffers, gate in [((False, True, True), True), ((True, False, True), True),
                               ((True, True, False), True), ((True, True, True), False)]:
            result = transition(state, 0, core_buffers=buffers, config0=gate,
                                preskip_gate=False, preskip_target=0, source_open=None)
            self.assertEqual(result.state, state)
            self.assertEqual(result.outcome, "guarded")
            self.assertFalse(result.cleanup_required)

    def test_replay_unchanged_request_does_not_reset_result(self):
        state = bc.ReplayState(1, 2, 11, 12, 0, 0)
        result = bc.replay_transition(
            state, 1, core_buffers=(True, True, True), config0=True,
            preskip_gate=False, preskip_target=0, source_open=None)
        self.assertEqual(result.state, state)
        self.assertEqual(result.outcome, "unchanged")
        self.assertFalse(result.open_required)

    def test_replay_activation_open_success_failure_and_preskip(self):
        state_type = bc.ReplayState
        transition = bc.replay_transition
        for gate, target, opened, active, first, preskip in [
            (False, 9, True, 1, 1, 0), (True, 0, True, 1, 1, 0),
            (True, 9, True, 1, 0, 1), (False, 0, False, 0, 1, 0)]:
            result = transition(state_type(0, 7, 11, 12, 0, 0), 1,
                                core_buffers=(True, True, True), config0=True,
                                preskip_gate=gate, preskip_target=target, source_open=opened)
            self.assertEqual(result.state, state_type(active, 0, 11, 12, first, preskip))
            self.assertTrue(result.open_required)
            self.assertFalse(result.cleanup_required)

    def test_replay_activation_does_not_invent_preskip_clear(self):
        result = bc.replay_transition(
            bc.ReplayState(0, 2, 11, 12, 0, 1), 1,
            core_buffers=(True, True, True), config0=True,
            preskip_gate=False, preskip_target=0, source_open=True)
        self.assertEqual(result.state.preskip, 1)

    def test_replay_deactivation_invalidates_timestamps_and_requires_cleanup(self):
        state_type = bc.ReplayState
        result = bc.replay_transition(
            state_type(1, 7, 11, 12, 1, 1), 0,
            core_buffers=(True, True, True), config0=True,
            preskip_gate=False, preskip_target=0, source_open=None)
        self.assertEqual(result.state, state_type(0, 2, 0xffffffff, 0xffffffff, 1, 1))
        self.assertTrue(result.cleanup_required)
        self.assertFalse(result.open_required)

    def test_replay_requires_explicit_open_result_and_boolean_request(self):
        state = bc.ReplayState(0, 2, 11, 12, 0, 0)
        transition = bc.replay_transition
        unsupported = bc.UnsupportedInput
        for request in [1, 2]:
            with self.assertRaises(unsupported):
                transition(state, request, core_buffers=(True, True, True), config0=True,
                           preskip_gate=False, preskip_target=0, source_open=None)


if __name__ == "__main__":
    unittest.main()
