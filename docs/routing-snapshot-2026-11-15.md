# Original routing-source snapshot

Update: the later [regional PBF acquisition and real-detour study](regional-recovery-replay-2026-11-15.md)
resolved the source-download obstacle. The failed Overpass attempts below remain
historical evidence; reference integrity now passes using the independent source.

The next recovery increment is implemented in
[tools/routing_snapshot.mjs](../tools/routing_snapshot.mjs). It is a separate PC
pipeline; it never changes Pages, production OSM caches, route files or firmware.

## What it adds

- Original way node identities and coordinates, all raw string tags, tagged nodes
  including barriers, and restriction relations with their ordered members.
- A bounded Overpass query for highway ways in a requested region, restrictions
  referencing them, member ways, and the referenced nodes. Coordinates outside
  the box remain when needed to complete those ways. Outside member ways are
  preserved as reference evidence; candidate topology admits only highway ways
  with an original node inside the primary query box. This prevents an exempt
  restriction from introducing a road whose other restrictions were not fetched.
- Canonical deterministic snapshots. Exact duplicates merge; conflicts quarantine
  identities. Missing nodes/members, invalid objects, empty results, server remarks
  and missing base timestamps make integrity incomplete.
- Acquisition receipts with query and raw-response hashes. Time and byte limits,
  one request per run, refusal to overwrite, and offline import of saved responses.
  Failure retains its receipt; a normal HTTP response is not treated as proof of
  source integrity.
- Optional `snapshot` input in the existing recovery evaluator. Before accepting
  a passing snapshot, the evaluator checks its derived way geometry against the
  preserved original elements. Incomplete snapshots provide no candidate paths.

The query follows the Overpass manual's
[referenced-object pipeline](https://dev.overpass-api.de/overpass-doc/en/criteria/chaining.html)
and [ways/nodes/relations model](https://dev.overpass-api.de/overpass-doc/en/full_data/osm_types.html).
It retrieves restrictions referencing the selected roads; it does not recursively
expand a region into the entire connected road network or prove mapping completeness.

## Conservative study policy

For now, any barrier node other than `barrier=no` excludes its containing ways,
even if a bicycle permission is present. Non-exempt restriction relations exclude
their member ways and ways touching their via nodes. Via-way and conditional
restrictions remain preserved, with conservative exclusions. An unconditional
`except=bicycle` can exempt a relation only when no conditional or bicycle-specific
restriction is present.

This deliberately removes some usable connections. The report exposes excluded
ways and restrictions; it does not call their absence a property of the real road
network. This is a bounded source/filtering increment, **not a turn-aware planner**.
The next planner can use the retained evidence without refetching it.

Passing snapshot integrity means complete references among returned elements.
It does not validate regional cycling access, unrecorded barriers, mapping
completeness, GPS association, route-visit association or device resource use.
Those gaps remain explicit. No recovery directions or distances are shipped.

## The actual ridden area

Prepared the existing 4,035-point ride's bounding rectangle with a 3,000 m margin
in both axes, approximately 121.01 km². The three configured public endpoint
attempts returned HTTP 406, 403 and 429. **No usable real snapshot was acquired.**
No repeated retry loop was started. The request, region, source-track identity
and failure receipts remain in private `.local/routing-snapshot-ride-20261115*`
directories. The [sanitized acquisition report](mining/routing-snapshot-acquisition.json)
contains endpoints, statuses and query identity, with no ride coordinates.

The saved query can be retried after endpoint access recovers, or a saved Overpass
response can be imported locally. A fresh live snapshot will represent its OSM
base timestamp, not automatically the road data as it existed during the ride.
Real detour connectivity and 3 km recovery acceptance remain open.

## Run it

A region file contains `{"bbox":[south,west,north,east]}` and optionally `endpoint`.
Coordinates must be ordered, valid, span at most one degree in each axis, and
cover no more than 600 km². These are PC request guards, not display/map budgets.

```sh
node --test tools/test_routing_snapshot.mjs tools/test_recovery_study.mjs
node tools/routing_snapshot.mjs --region REGION.json --output NEW_DIRECTORY --fetch
node tools/routing_snapshot.mjs --region REGION.json --output NEW_DIRECTORY --response RESPONSE.json
```

A run writes `query.overpass`, `region.json`, `receipt.json`; received bounded raw
JSON is saved byte-exact as `response.json`, followed by `snapshot.json` when it
can be parsed. Exit 0 means snapshot integrity passed, 2 means incomplete, and
1 means acquisition/parsing failed. Server timeout is 90 seconds, client timeout
105 seconds, and the response cap is 64 MiB. A malformed raw input retains an
error receipt; an existing output directory is never reused.

To evaluate, provide `snapshot` instead of `source`, with the existing explicit
origin node IDs and future target visits. Supplying both is rejected. Original
v1 source inputs retain their existing behavior and gaps.

## Review and verification

Independent review identified an acquisition-closure issue: a bicycle-exempt
restriction could introduce an outside member road whose other restrictions had
not been requested. The regression failed before the fix and passes afterward.
Candidate admission is now restricted to primary-region road selection; outside
members remain reference-only and their exclusion is reported. No unbounded
recursive acquisition was added.

Final verification: 29 capture/recovery tests pass; the complete main Node command
passes 214/214, and Python passes 171/171. Offline app and real-ride map coverage
proxy pass. Historical maneuver checks retain the known noisy-GPS failure (25
turns versus 15) and sparse-export failure (3 versus 15), so the combined validator
still exits 2 / incomplete. Actual recovery/target acceptance is unvalidated.
