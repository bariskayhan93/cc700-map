# Connected recovery: first implementation

The implementation rules now live in [AGENTS.md](../../AGENTS.md), so subsequent
work inherits the research priorities. Stationary shared-start/finish ambiguity
is not a reason to extend the matcher without evidence of a riding failure.
The rejected cc24 experiment remains a separate release concern.

## Implemented

[The evaluator](../../tools/recovery_study.mjs) builds a directed candidate graph
from preserved original road nodes, finds shortest candidate paths to explicit
future route visits, and compares full-graph versus prepared-leg JSON storage.
It never joins roads merely because they cross on screen. Conflicting source
coordinates are quarantined. Basic bicycle direction overrides are applied;
denied, conditional, ambiguous-access and unsupported roads are excluded by a
conservative experimental policy. This is not a regional legal cycling profile.

Search has separate settled-node, examined-edge, queue-entry, path-length and
travel-distance bounds. Exceeding a bound yields unavailable, with no partial
path or distance. Unknown origins, disconnected roads and absent future targets
also yield explicit unavailable results. Target visits are supplied, not inferred
from the nearby start/finish. The tool does not alter matching or arrival logic.

Reports retain individual outcomes, cumulative 1/2/3 km sample counts, missing
source evidence, actual UTF-8 JSON bytes and lookup operation counts. No device
RAM, frame time or continuous coverage is inferred. Barrier node tags and turn
restrictions are absent from source v1; all paths remain **structural candidates,
not validated cycling routes**.

## Reproducible comparison

Three deterministic synthetic networks each have twelve connected origins and
one nearby disconnected negative control. They share one explicit future target
visit per case. Distances are measured from sampled nodes to that target; these
are not sampled areas along a whole 23 km route.

| Synthetic network | Nodes / directed edges | Full graph JSON | Twelve prepared legs JSON | Largest settled-node / examined-edge count |
|---|---:|---:|---:|---:|
| Urban grid | 963 / 3,722 | 277,097 B | 6,443 B | 244 / 949 |
| Village grid | 171 / 626 | 45,511 B | 4,495 B | 45 / 167 |
| Forest spokes | 123 / 242 | 19,780 B | 9,361 B | 31 / 59 |

Each finds all twelve connected samples and rejects the disconnected one. None
establishes legal cycling validity. Exact inputs and per-origin reports can be
regenerated; [the committed summary](../mining/recovery-study-summary.json) includes
input fingerprints. Prepared legs are economical for this small fixed query
set, especially in the grid. Their cost grows with origins and route-visit
windows; a shared graph is reusable. This comparison does not yet select a
production representation or codec, much less justify an increased map budget.

```sh
node --test tools/test_recovery_study.mjs
node tools/recovery_study_cases.mjs --output .local/NEW-recovery-examples
node tools/recovery_study.mjs --input .local/NEW-recovery-examples/urban-grid-input.json --output .local/NEW-recovery-query
node tools/recovery_study.mjs --cache .local/cc700-evidence-20261113/local-validation/cache --output .local/NEW-source-audit
```

Output directories must be new. The tools read local inputs only: no device
access, source fetching, firmware/route writes or Pages changes.

The input has `source` (navigation-source v1), unique `origins` (OSM node IDs),
`targets` (`{node, visit}`), and inclusive upper `throughVisit` / exclusive lower
`afterVisit` bounds. Optional positive bounds default to `maxSettled=4096`,
`maxRelaxed=32768`, `maxQueue=8192`, `maxPathNodes=2048`,
`maxDistanceMeters=15000`. These bound an offline experiment, not device limits.
An origin must already be an identified graph node: this tool does not pretend
that nearest-node snapping solves GPS association, accessibility or travel direction.

## Actual ride evidence and next gate

The [private ride-cache audit](../mining/recovery-source-audit.json) found four
legacy display cells and **zero cells with original source**. Their current
geometry cannot reconstruct original junction identities, access, barriers or
turn restrictions. No recovery success rate for the ridden detours is claimed.
The local files and their aggregate fingerprint are preserved; no ride locations
are published in the audit.

The next feature increment is a separate original-source snapshot for the
existing ride and recovery region, including barrier nodes and restrictions,
followed by explicit origin/forward-visit association and replay of those detours.
Keep display generation untouched while collecting that evidence. Then compare
prepared legs across multiple visit windows with a shared compact graph and
measure the chosen target lookup. A successful legal/source audit and lifecycle
contract are needed before showing recovery directions or a remaining rejoin
distance on the device. Until then, ordinary navigation stays unchanged.

## Verification

15 recovery-study tests pass, including CLI overwrite protection and all three
workloads. The final main Node command passes 200/200; Python passes 171/171;
offline app and ride coverage proxy pass. The historical suite retains its two
known failures: 3 m noisy GPS yields 25 turns versus 15, and every eighth planner
point yields 3 versus 15. Overall validation remains incomplete, with target
acceptance unvalidated. No existing maneuver behavior was changed.

Independent review found no correctness blockers. Deferred low-priority test
extensions are a direct reverse bicycle-oneway override and a target queued
immediately before settled-node exhaustion; related direction/cap behaviors are
already covered. These are test coverage improvements, not observed feature bugs.
