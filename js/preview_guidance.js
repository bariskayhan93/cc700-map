// On-route replay guidance only. Distances are generated cumulative metres;
// this does not model the firmware's GPS association or off-route state machine.
export function previewGuidance(sections, distance, totalDistance) {
  if (!Number.isFinite(distance) || !Number.isFinite(totalDistance) || totalDistance < 0) {
    throw new RangeError('Preview guidance requires finite distances and a nonnegative route length');
  }
  const position = Math.max(0, Math.min(totalDistance, distance));
  const finished = position >= totalDistance;
  let sectionIndex = sections.findIndex(step => step.dist >= position);
  if (sectionIndex < 0) sectionIndex = sections.length - 1;
  let targetIndex = sectionIndex;
  // Record boundaries also serve map/file subdivision. Only nonzero directions
  // or the terminal record end the maneuver countdown. Both scans are finite.
  while (targetIndex >= 0 && targetIndex < sections.length - 1 &&
    sections[targetIndex].type !== 2 && !sections[targetIndex].dir) targetIndex++;
  const target = sections[targetIndex];
  const remaining = finished ? 0 : Math.max(0, (target?.dist ?? totalDistance) - position);
  const terminal = !target || target.type === 2 || !target.dir;
  // 300 m inclusive comes from stock GetDirIcon. Destination flag/arrival are
  // retained preview conventions, not a reconstruction of native arrival state.
  const dir = finished || terminal ? 6 : remaining <= 300 ? target.dir : 0;
  // Stock gets the single caption from the record after the maneuver. Route
  // generation stores its actual field-6 string as .caption (including `then`).
  const outgoing = sections[targetIndex + 1];
  const caption = finished ? 'Arrived' : terminal ? 'Destination' : dir === 0 ? 'Go straight' :
    (outgoing?.caption ?? outgoing?.text ?? target?.caption ?? target?.text ?? '');
  return { sectionIndex, targetIndex, remaining, dir, finished, caption };
}
