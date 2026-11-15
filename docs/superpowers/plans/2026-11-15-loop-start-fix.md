# Closed-loop departure correction

Goal: prevent an ordinary forward loop from immediately matching its nearby
finish while still on its initial section, preserving native arrival, recorded
resume, entry away from the origin, and connector behavior.

Explicit ambiguity policy: section zero plus low distance since the navigation
baseline near the shared origin means departure preference, even at the exact
finish coordinate. Fresh departure and fresh nearest-entry there are not
distinguishable from position alone. This deliberately follows the owner's
request to start the 23 km loop at that shared place; it does not promise both
interpretations for identical inputs. Existing accepted progress and recorded
distance release or bypass the preference.

Use a conditional retry at the dispatcher matcher call. Execute the complete
native mode-zero calculation first. Only consider a correction while current
global section is zero, dispatcher state is 2, native route mode is ordinary
slot zero, arrival is zero, previous matching is uninitialized or still on section
zero, and the normal valid on-route result jumps to the final global section.

Reuse the native closed-route departure envelope: endpoints within 200 m,
position distance sum within endpoint separation plus 200 m, route longer than
that allowance, and recorded distance since baseline within separation plus
100 m. Invalid/nonfinite metadata falls through. Verify that the loaded list
begins with the actual start coordinate and section zero before retrying.

Retry native mode one using the original previous result and a ten-point window
starting at max(previous index minus two, zero). Validate returned index against
that window, raw selected payload and output section zero, normal completion,
candidate/committed off-route zero and centre distance at most 100 m. Publish the
complete corrected result only on acceptance; otherwise preserve the original.
This retry is conditional, not a permanent replacement of mode-zero matching.

Use existing native synchronization/lifetime preconditions; do not swap lists,
write a fabricated point, change location, paint grey red, or add capture globals.
Gate extra native allocation with a conservative largest-block check and stack
margin. Record extra work and host/native execution limits.

Alternatives rejected: forcing point zero conflates loaded indices with global
sections; unconditional mode one loses full-list search and its counter behavior;
presentation-only recolouring does not fix instruction/progress association.

- [x] Red regression: fresh near-finish loop selects its outgoing leg; other
  ordinary/return/resume/deviation inputs retain normal results.
- [x] Implement host-tested complete wrapper and actual fixed-address adapter.
- [x] Build a separate cc23 image from exact cc22; guard ABI, call slot, code
  scopes, no writable globals, stack use and complete image roundtrip.
- [x] Review native behavior and run full tests before any installation.
- [ ] Record actual target acceptance and deployment separately from host tests.

## Worker stack correction after target diagnosis

Observed cc23d01 trace: GUI retry accepted point zero with 4,416 B remaining;
the next worker call had 2,944 B, failed the unchanged 3,072 B guard, and
published point 720 / section 112. Ordinary cc23 was restored byte-exact.

Design: retain matcher policy and the 3,072 B guard. Move the temporary 148 B
candidate from the worker stack into a checked, invocation-owned PSRAM allocation
using the existing heap-cap allocator/free ABI. Free on acceptance and every
rejection. Allocation failure preserves all 148 B of the original result.
This trades 148 B plus allocator overhead temporarily for a smaller stack frame;
it avoids weakening the guard or reserving a larger native task stack.

- [x] Reproduce observed worker budget rejection with actual Xtensa frame sizes;
  add allocation-failure and cleanup regressions and observe failures first.
- [x] Implement the bounded candidate allocation, retain every eligibility check,
  and build cc24 with exact image/ABI/delta guards.
- [ ] Run local checks; capture GUI and repeated worker acceptance on the same
  existing route, then remove diagnostics and verify ordinary cc24 installation.
- [ ] Record stationary acceptance separately from moving/arrival/resume gaps.
