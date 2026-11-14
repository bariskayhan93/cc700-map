"""Manually transcribed CC700 extracted behavior contracts, with explicit inputs.

This does not execute firmware instructions, generate geometry, schedule tasks,
operate buffers, or establish equivalence with a device. See
``docs/behavior-contract-harness.md`` for evidence and excluded behavior.
"""
from dataclasses import dataclass, replace
import math
import struct


class UnsupportedInput(ValueError):
    """The extracted model does not define this input; no firmware guess made."""


def _integer(value, low, high, name):
    if not isinstance(value, int) or not low <= value <= high:
        raise UnsupportedInput(f"{name} must be an integer in [{low}, {high}]")
    return value


def _word(value, name):
    return _integer(value, 0, 0xffffffff, name)


def _bit(value, name):
    return _integer(value, 0, 1, name)


def _f32(value, name, *, allow_nan=False):
    if not isinstance(value, (float, int)):
        raise UnsupportedInput(f"{name} must be numeric")
    try:
        result = struct.unpack("<f", struct.pack("<f", value))[0]
    except (OverflowError, struct.error):
        raise UnsupportedInput(f"{name} exceeds binary32 range") from None
    if not math.isfinite(result) and not (allow_nan and math.isnan(result)):
        raise UnsupportedInput(f"{name}: nonfinite arithmetic is unextracted")
    return result


@dataclass(frozen=True)
class CandidateDecision:
    distance: int
    candidate: int
    center_substituted: bool
    output_position: str


def offroute_candidate(center_distance, projected_distance, angle, speed):
    """Post-geometry decision only; distances/angle must already be converted.

    Evidence: 0x4204bd9f..0x4204be06, 0x4204bf49..0x4204bfa3.
    INT32_MIN absolute-value behavior and float-to-int exceptions are excluded.
    """
    p = _word(center_distance, "center_distance")
    q = _word(projected_distance, "projected_distance")
    a = _integer(angle, -0x7fffffff, 0x7fffffff, "angle")
    s = _f32(speed, "speed")
    substitute = ((10 * p) & 0xffffffff) < q
    d = p if substitute else q
    if d > 99:
        candidate = 1
    elif p >= 150:
        candidate = int(abs(a) > 30)
    elif abs(a) <= 150 or ((a + 209) & 0xffffffff) > 418:
        candidate = 0
    else:
        candidate = int(s != 0)
    output = "input" if d > 50 else ("center" if substitute else "projection")
    return CandidateDecision(d, candidate, substitute, output)


@dataclass(frozen=True)
class OffrouteState:
    previous_candidate: int
    committed: int
    count: int


@dataclass(frozen=True)
class PersistenceResult:
    state: OffrouteState
    proximity: bool


def persist_offroute(state, candidate, *, distance, center_distance, search_mode):
    """Normal-completion persistence only, 0x4204bf68..0x4204bff5.

    No initial state is invented. Early matcher failure is a separate path.
    """
    _bit(state.previous_candidate, "previous_candidate")
    _bit(state.committed, "committed")
    _integer(state.count, 0, 65535, "count")
    _bit(candidate, "candidate")
    _word(distance, "distance")
    _word(center_distance, "center_distance")
    _integer(search_mode, 0, 1, "search_mode")
    committed = state.committed
    if candidate != state.previous_candidate:
        count = 0
    else:
        count = (state.count + 1) & 0xffff
        if count >= 10:
            count = 10
            committed = candidate
    proximity = committed == 1 and distance <= 24 and center_distance > 150
    if search_mode == 1 and committed == 1:
        count = 0
    return PersistenceResult(OffrouteState(candidate, committed, count), proximity)


@dataclass(frozen=True)
class HeadingSet:
    output: float
    previous: float
    count: int


def set_heading(heading, *, mode, previous, count):
    """Single subtraction and optional rejection counter, 0x4204a504..55b.

    Only finite binary32 arithmetic and representable signed truncation modeled.
    """
    new = _f32(heading, "heading")
    old = _f32(previous, "previous")
    _integer(mode, 0, 255, "mode")
    _integer(count, 0, 255, "count")
    if new > 360:
        new = _f32(new - 360, "normalized heading")
    if mode != 0:
        return HeadingSet(new, old, count)
    difference = _f32(new - old, "heading difference")
    if not -0x7fffffff <= difference < 0x80000000:
        raise UnsupportedInput("heading difference has unextracted signed truncation/abs")
    if abs(math.trunc(difference)) <= 150:
        return HeadingSet(new, old, 0)
    if count < 6:
        return HeadingSet(old, old, count + 1)
    return HeadingSet(new, new, 6)


@dataclass(frozen=True)
class HeadingSelection:
    cached: float
    context_heading: float
    map_heading: float
    context_enabled: int


def select_heading(cached, speed, course, gps_byte, magnetic_status, magnetic_heading):
    """Local source selector and its mode-1 setter, 0x4204dfe0..e049.

    Course is signed integer +48. NaN speed takes the proven fallback branch.
    Cache initialization and other cache writers are caller responsibilities.
    """
    cache = _f32(cached, "cached")
    velocity = _f32(speed, "speed", allow_nan=True)
    _integer(course, -0x80000000, 0x7fffffff, "course")
    _integer(gps_byte, 0, 255, "gps_byte")
    _integer(magnetic_status, 0, 0xffffffff, "magnetic_status")
    if velocity >= 3000:
        if course != 0:
            cache = _f32(_f32(course, "course") / 1000, "course heading")
    elif gps_byte == 1 and magnetic_status == 3:
        cache = _f32(magnetic_heading, "magnetic_heading")
    context = _f32(450 - cache, "context heading")
    # mode 1 bypasses prior heading/counter; those values are not read by firmware.
    map_heading = context
    if map_heading > 360:
        map_heading = _f32(map_heading - 360, "map heading")
    return HeadingSelection(cache, context, map_heading, 1)


def gui_elapsed(now, baseline):
    """Unsigned subtraction at 0x42021420..29, without a wider clock."""
    return (_word(now, "now") - _word(baseline, "baseline")) & 0xffffffff


def timer_expired(now, baseline, period):
    """Elapsed threshold only (0x42022557..60), not callback dispatch."""
    return gui_elapsed(now, baseline) >= _word(period, "period")


def advance_gui_clock(now, callbacks):
    """Only the identified +2 writer, 0x42037e04 and 0x420213e0."""
    _word(now, "now")
    if not isinstance(callbacks, int) or callbacks < 0:
        raise UnsupportedInput("callbacks must be a nonnegative integer")
    return (now + 2 * callbacks) & 0xffffffff


@dataclass(frozen=True)
class ReplayState:
    active: int
    result: int
    logical_timestamp: int
    previous_timestamp: int
    first_record: int
    preskip: int


@dataclass(frozen=True)
class ReplayTransition:
    state: ReplayState
    outcome: str
    open_required: bool = False
    cleanup_required: bool = False


def replay_transition(state, requested_active, *, core_buffers, config0,
                      preskip_gate, preskip_target, source_open):
    """Selected wrapper fields and external-operation intent, 0x420b5764..5852.

    Does not open/close a source, allocate/zero buffers or run the replay task.
    A cleanup-required result does NOT establish allocation-failure safety.
    ``source_open`` is the caller-supplied outcome, including already-open success.
    """
    _bit(state.active, "active")
    _word(state.result, "result")
    _word(state.logical_timestamp, "logical_timestamp")
    _word(state.previous_timestamp, "previous_timestamp")
    _bit(state.first_record, "first_record")
    _bit(state.preskip, "preskip")
    _bit(requested_active, "requested_active")
    if not isinstance(core_buffers, tuple) or len(core_buffers) != 3:
        raise UnsupportedInput("exactly three core-buffer presence flags required")
    for index, present in enumerate(core_buffers):
        _bit(present, f"core_buffers[{index}]")
    _bit(config0, "config0")
    if not all(core_buffers) or not config0:
        return ReplayTransition(state, "guarded")
    if state.active == requested_active:
        return ReplayTransition(state, "unchanged")
    if not requested_active:
        result = replace(state, active=0, result=2,
                         logical_timestamp=0xffffffff, previous_timestamp=0xffffffff)
        return ReplayTransition(result, "deactivated", cleanup_required=True)
    _bit(preskip_gate, "preskip_gate")
    _word(preskip_target, "preskip_target")
    if source_open is None:
        raise UnsupportedInput("accepted activation requires an explicit source-open outcome")
    _bit(source_open, "source_open")
    armed = bool(preskip_gate and preskip_target != 0)
    result = replace(state, active=int(bool(source_open)), result=0,
                     first_record=int(not armed), preskip=1 if armed else state.preskip)
    return ReplayTransition(result, "activated" if source_open else "open_failed",
                            open_required=True)


def ride_replay_request(ride_state, *, load_result=None):
    """Observed ride-state calls to the wrapper; other states are unmodeled.

    STARTING(1) requests off, successful LOADING(2) requests on, and ENDING(6)
    or ENDWITHOUTFIT(7) requests off. A failed load makes no wrapper request.
    This does not create tasks, enqueue resume events or recover a session.
    Evidence: 0x42042605..0a, 0x420426f1..42705, 0x42043900, 0x42041baf.
    """
    _integer(ride_state, 0, 9, "ride_state")
    if ride_state in (1, 6, 7):
        return 0
    if ride_state == 2:
        _integer(load_result, -0x80000000, 0x7fffffff, "load_result")
        return 1 if load_result == 0 else None
    raise UnsupportedInput("no replay-wrapper call modeled for this ride state")
