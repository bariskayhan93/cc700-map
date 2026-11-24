// The cc27 route file on the page: the block switches for buildRoute (map.blockFlags) and the sections after the route
// bytes (way-back type 1, grey type 2, elevation type 3; js/wayback_embed.js). Pure code: the page and the tests use it.
import {addWayback, waybackForRoute, REACH_CHAIN} from './wayback.js';
import {elevationSection} from './elevation_section.js';
import {SECTION, embedSections} from './wayback_embed.js';
import {farSection} from './far_map.js';
import {loadFarSource} from './far_source.js';

export const F_OWN = 1, F_TEXT = 2, F_AA = 8, F_CYC = 16, F_PROJ = 64;   // firmware/common/types.h
export const FILE_LIMIT = 4_000_000;                 // page guard of a route file

// The flags of every map block.
export function cc27Flags({ownLines = true, testText = true} = {}) {
  return (ownLines ? F_OWN | F_AA | F_PROJ : 0) | (testText ? F_TEXT : 0);   // cc28b: own lines smooth; 23 Nov: own projection (map.c needs F_OWN)
}

// The route file with its sections. wayback: way-back and grey (the reach steps down 3 -> 2 -> 1 km when the query area
// is over the bound or the data does not fit; report.reach is the reach used). elevation: the type 3 section (version 2) of
// the lens chart; the unit draws it only on the route with trusted progress (firmware/elev/elev.h). Over the file
// limit, the far-map section (type 4) goes first, then the reach steps down; the elevation section stays in every case.
// report.waybackError says why a file has no way-back data, report.farReason why it has way-back data but no far map.
// farRouteFile (WP 6): the same route with the handover detail map (map.handover); it is used only with a far map, so a
// file without a far map keeps the detail fills. report.handover says which one the file carries.
export async function cc27Sections(routeFile, {wayback = true, elevation = true, reach = 'line3k', fetchImpl = globalThis.fetch, fileLimit = FILE_LIMIT, farRouteFile = null} = {}) {
  const report = {}, e = elevation ? elevationSection(routeFile) : null, tail = e ? [{type: SECTION.ELEV, bytes: e}] : [];
  if (elevation) report.elevationBytes = e ? e.length : 0;
  const make = (s, base = routeFile) => s.length ? embedSections(base, s) : base, over = `Datei über ${fileLimit.toLocaleString('de-DE')} B`;
  for (let r = wayback ? reach : null; r;) {
    let w;
    try { w = await addWayback(routeFile, {format: 2, reach: r, fetchImpl, layer: false}); } catch (err) { report.waybackError = err.message; break; }
    let src = null, farReason = null, hoWayback = null;   // far map (23-24 Nov): a failure keeps the way-back data
    try { src = await loadFarSource(w.boxes, fetchImpl); } catch (err) { farReason = err.message; }
    // the far map at the reach of the way back; over the file guard first at 2 km, then without it, then the reach steps down
    const farAt = m => { try { return src ? farSection(w, src, undefined, m) : null; } catch (err) { farReason = err.message; return null; } };
    const reachM = {line1k: 1000, line2k: 2000, line3k: 3000}[w.reach], tries = [reachM, ...(reachM > 2000 ? [2000] : []), 0];
    for (const fm of tries) {
      const far = fm ? farAt(fm) : null;
      if (fm && !far) { farReason ??= 'keine Fernkarten-Zelle'; continue; }
      const base = far && farRouteFile ? farRouteFile : routeFile;
      const wb = base === routeFile ? w.wayback : (hoWayback ??= await waybackForRoute(w, farRouteFile));
      const sections = [{type: SECTION.WAYBACK, bytes: wb}, ...(far ? [{type: SECTION.FAR, bytes: far.bytes}] : []), ...tail];
      const file = make(sections, base);
      if (file.length > fileLimit) continue;
      Object.assign(report, {waybackBytes: wb.length, farBytes: far ? far.bytes.length : 0, farReachM: far ? fm : 0, reach: w.reach, stats: w.stats, handover: !!(far && farRouteFile), ...(far ? {farCells: far.cells, farRemovedLines: far.removedLines} : {})});
      if (!far) report.farReason = src && farReason !== 'keine Fernkarten-Zelle' && !farReason ? over : farReason ?? over;
      delete report.waybackError;
      return {file, sections: sections.map(s => s.type), report};
    }
    report.waybackError = `${over} mit ${w.reach}`;
    const i = REACH_CHAIN.indexOf(w.reach);
    r = i < 0 ? null : REACH_CHAIN[i + 1];
  }
  report.handover = false;
  const file = make(tail);
  if (file.length > fileLimit) throw new Error('Datei mit Rückweg-Daten zu groß');
  return {file, sections: tail.map(s => s.type), report};
}
