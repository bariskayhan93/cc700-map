# Experimental recovery core — native adapter unbound

`recovery.c` is freestanding C, shared by host replay and the Xtensa build. It
streams immutable route/source/policy-bound CCRP sidecars through a read callback;
no heap allocation, broad graph, native filesystem or drawing calls. A caller owns
and aligns `rc_size()` bytes (compile-time ceiling512B), pins the reader/context,
and serializes all mount/tick/point operations. `rc_init` binds96 identity bytes
and route epoch. Experimental package mount is refused by default.

Input `RC_ORDERED_MATCH` requires independently verified near-route position AND
ordered route visit, not a raw native on-route bit. GPS validity/accuracy/time,
course (as a unit vector `heading_x`, `heading_y`) and speed are explicit inputs. Off-route uses the retained prior entry;
current off-route native progress cannot select a finish. Five strictly advancing
ordered fixes restore ordinary guidance at the prepared or a verified alternate
rejoin. GPS/clock faults clear actionable state; epochs require reinitialization.

`rc_output` supplies UI intents: suppress stale stock cues, optional overlay,
road distance to rejoin, suffix point count and unavailable/paused/pending reasons.
No arrival state is inferred. Per-frame point allowance is caller-owned and must
come from actual map admission; zero denies overlay. `rc_read_point` streams E7
suffix vertices, first point replaced by the current projection. Caller must read
and validate the whole suffix before submitting a frame; callback failure can
invalidate recovery. Never draw partial geometry from a failed read.

Format v2: 160B bound header;64B per prepared leg (target vector at +56/+58);
16B per leg-segment table record;2B guard reference per guard;16B per distinct
guard in the package guard table (header +152 = count);8B per E7 vertex. Guards
include denied nearby roads; own prepared source pieces remain axial ambiguity competitors in the path
scan. Only adjacent same-path joins within3m along distance can collapse.
Limits:64KiB/package,64legs,512points/leg,1024total leg segments,64guards/segment.
Initial association<=1024 segment checks; selected-path ambiguity scan<=511 more.
There is no arbitrary-area guarantee or legal cycling validation.

Before release: bind a verified filesystem/index/provider/task adapter, validate
full callback stack/heap/frame timing and atomic overlay ownership, apply cue
suppression through verified UI hooks, and pass a bounded target test with exact
restoration. Earlier cc24 canvas failure remains a separate release gate. No
feature is active on the current device or Pages app through this module.
