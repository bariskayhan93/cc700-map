# Covered recovery package and native core

Owner authorizes full implementation of the grouped challenges in one turn.
Deliver generation, bounded native C package reading, source-conflict guards,
activation/rejoin lifecycle, real replay and target compilation. This supersedes
the feasibility-only scope, but does not authorize ignoring failed device safety.
No flash, existing native route mutation or fake enabled Pages control. Native
file/task/draw hooks are absent and the cc24 draw crash remains unaccepted; report
that integration gate plainly, never call host/native-core success a release.

## Design choice

Precompute a leg from the beginning of a directed interior original source-edge
interval. Every prepared source segment has its own conflict guards and cumulative road
distance. Runtime tracks the whole leg, subtracts travelled network distance
and draws the untravelled suffix from its projection.
No general Dijkstra, geometric cross-road connectors or portal teleportation.
Endpoints have >=2m exclusion. A leg may end earlier on that source edge, so its
actual first segment limits coverage. Nearby source segments within 35m (including
denied roads) are guards; live association radius<=15m plus5m ambiguity margin
requires this35m envelope. Heading must agree with portal direction; guards use
axial heading. Ambiguity, unknown state and guard-work exhaustion are unavailable.

Each sidecar package binds SHA256 of exact route/source/policy; CRC32 covers all
bytes with checksum field zero. Version1 experimental flag; default reader refuses
experimental data unless explicitly enabled for controlled replay. Package<=65536B,
portals<=64, points/leg<=512, guards/segment<=64, total segments<=1024; overflow rejects or records individual
uncovered portals before encoding. Source/header/leg identities and offsets must
validate. Source/access/cycling legality remains unvalidated, not promoted by CRC.

Native C core streams via read callback, no malloc/full graph/whole-leg stack
arrays. Init binds expected identities and route epoch; mount validates packages
without losing an existing trusted entry. Unmount clears active recovery. Active
point reader returns E7 vertices; no native canvas calls in this module. Caller
provides per-frame overlay point allowance; absent allowance suppresses overlay.

States: NORMAL, UNAVAILABLE, RECOVERING, REJOIN_PENDING, PAUSED. Native on-route
ordered-valid input records entry; off-route never trusts current native progress.
Require valid GPS<=3s old, accuracy<=15m, heading and speed>=3km/h to activate.
Clock gaps>5s/invalid GPS clear active recovery and trusted entry. Episode anchor
expires after30min; route epoch mismatch invalidates session. Stop/unknown heading
hides actionable recovery/distance and suppresses stale native off-route cues.
Five ordered on-route fixes, <=5s apart, near selected target or independently verified alternate ordered rejoin restore
normal guidance. The provider must validate near-route position AND ordered
visit; a raw native flag is insufficient. Counted fixes strictly advance. No
arrival inference from start/end proximity. Changing route/package clears active
geometry. A pause is not a sensor emulator or modification to native rotation.

Generation uses conservative source policy, fixed250m prior-entry windows, targets
beyond the WINDOW END+25m and <=WINDOW START+3km, so all admitted entries have
forward targets. Bounded per-window portal selection is deterministic and labelled
selective coverage. Package/index limits separate from native map budgets. Failed
or overloaded windows/portals have explicit unavailable receipts. Native route
bytes remain byte-exact; files are sidecars, not appended unknown native records.
Default generation covers all requested windows (all windows if unspecified);
real replay may request the historical windows and source-segment seeds to assess
those cases without claiming general3km coverage. Seeds are labelled retrospective
sampling; runtime consumes no future fixes/rejoin oracle.

Tests use exactly the C core through ctypes with real serialized packages and
corruption/state/conflict fixtures; target cross-compile with stack-usage report.
C callbacks/file ownership, task admission, stale stock-cue suppression and canvas
rendering still require a verified native adapter and bounded device acceptance.
Normal result: prepared leg or explicit unavailable; basemap retained. Production
optional recovery remains disabled pending that adapter/release gate.


Implementation refinement: per-segment source guards exclude other source edges
on the same prepared path, which remain axial ambiguity candidates in the native
path scan (even when their travel direction is incompatible). Nonadjacent close
pieces fail closed; adjacent same-path joins within3m along distance may collapse.
Native initial scan<=1024 segments plus<=511 same-path competitor checks; guard
checks<=64 for the selected segment. Point/table reads stream, no whole-leg buffer.
Rejoin episodes persist across stale GPS/unmount until five fresh independently
ordered on-route fixes; alternate rejoin within the retained3km entry window is
accepted. Without a retained entry, the provider's independent ordered proof is
required; this is a native-adapter acceptance gate, not a raw matcher-bit shortcut.
