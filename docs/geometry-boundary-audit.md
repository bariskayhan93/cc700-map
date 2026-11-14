# Geometry boundaries that a replay must preserve

Evidence: stock V1.414 and saved v16, 2026-11-13. This extends the
[matcher extraction](route-state-extraction.md), with five ranges independently
checked against GNU Xtensa objdump in the [manifest](mining/geometry-evidence.json).
No device operations or firmware changes were needed.

## Point lookup has a zero-coordinate fallback

`0x4204a584..0x4204a5c4` returns two zero float words when the list is null,
empty, or the signed index is outside `[0,count)`. For an accepted index it
loads the first two floats of the indexed record. It does not check the returned
record pointer before those loads. Thus an invalid neighbor and a real coordinate
with a zero component are distinct inputs that downstream code can conflate.

## Heading estimation has explicit input and singularity policies

`mg_routes_realtime_heading`, `0x4204a7d8..0x4204aa9c`, rejects more than ten
points or a null projection context. It also returns failure if **either** float
component of any input point is zero (`0x4204a921..930`). This is stronger than
rejecting only the coordinate pair `(0,0)`.

The function projects the input points, converts the projected integer coordinates
to floats and negates the second axis. It computes means, horizontal variance
and cross-products. It divides the cross-product by the variance only when the
variance is nonzero (`0x4204a888..8a0`); otherwise its slope value stays zero.
The direction branches also use the difference between the **first two** projected
points, then apply quadrant/axis cases and normalize around 360 degrees.
An implementation using just the bearing between the first and last input points
would therefore change the contract.

The upper-count check does not reject counts zero or one. The local code still
contains mean divisions and first/second-slot reads for those counts. This is
an exposed caller precondition, not proof of a particular live failure or of
defined results for every exceptional float.

## The matcher's projection is a separate calculation

After index arbitration, the matcher builds a three-slot neighborhood around the
selected point (`0x4204baed..0x4204bbc6`). It skips the missing previous slot at
index zero and the missing next slot at the final index. The following mean
divisions nevertheless use **3.0** (`0x4204bbc9..0x4204bbe4`). The covariance
loop applies the same endpoint omissions.

Unlike the heading helper, this path divides its cross-product by horizontal
variance at `0x4204bc3d..0x4204bc46` without a local zero-denominator branch.
It derives an intercept and projects the current position onto that fitted line
before converting back to route coordinates. There is no local finite-value
check before the later coordinate conversions and distance calls. Vertical,
duplicate and endpoint geometry therefore need the actual floating-point and
integer-conversion behavior; adding a conventional robust projection fallback
would be a behavioral change.

The later `10 * center_distance < projected_distance` substitution is a separate
fallback. It does not establish that every NaN, infinity or conversion result is
handled safely. Ordinary finite geometry and exceptional arithmetic must be
tested separately.

## Distance helper has a nonstandard early exit

Let `P` and `Q` be its two coordinate-pair pointers. At
`0x4204aa9f..0x4204aadb`, the literal condition for an immediate zero result is:

```c
P[0] < 0.000001 && Q[1] < 0.000001
```

These are signed floating-point comparisons, not absolute-value tests, and the
two components come from different arguments. Consequently, negative components
can satisfy this guard too. This finding is a static property of the helper;
it is not a demonstrated failure on a particular route or hemisphere.

The remaining path converts each component by multiplying by pi and dividing
by 180, returning float precision, and finishes with the float constant
**6378137.0**. Its square/trigonometric/square-root/inverse-trigonometric structure
is consistent with spherical great-circle distance in metres. That mathematical
identification is an inference; the exceptional library paths were not executed
on the device. Existing numeric matcher thresholds can be interpreted in that
ordinary geographic context without treating the helper as a clean mathematical
distance function for all inputs.

ROM arithmetic calls were identified using Espressif's
[ESP32-S3 ROM libgcc address map](https://raw.githubusercontent.com/espressif/esp-idf/v5.1/components/esp_rom/esp32s3/ld/esp32s3.rom.libgcc.ld),
including float-to-double, double multiply/divide, comparison and truncation.
This resolves operator identity; it does not make host Python/JavaScript
arithmetic bit-equivalent to the firmware.

## Consequence for simulation coverage

These boundaries replace the previous unspecified local degeneracy policy with
concrete branch requirements. They do not establish bit-exact projection,
libm/ROM exceptional results, scheduler ordering, or malformed-list safety.
A host model may cover ordinary logic while recording those as unverified;
it must not silently substitute its own zero-coordinate, endpoint or singularity
policy and call the result full firmware coverage.
