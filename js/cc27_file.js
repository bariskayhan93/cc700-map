// The cc27 route file on the page: the block switches for buildRoute (map.blockFlags) and the sections after the route
// bytes (way-back type 1, grey type 2, elevation type 3; js/wayback_embed.js). Pure code: the page and the tests use it.
import {addWayback, waybackSections, REACH_CHAIN} from './wayback.js';
import {elevationSection} from './elevation_section.js';
import {SECTION, embedSections} from './wayback_embed.js';

export const F_OWN = 1, F_TEXT = 2, F_AA = 8, F_CYC = 16;   // firmware/common/types.h
export const FILE_LIMIT = 4_000_000;                 // page guard of a route file

// The flags of every map block.
export function cc27Flags({ownLines = true, testText = true} = {}) {
  return (ownLines ? F_OWN | F_AA : 0) | (testText ? F_TEXT : 0);   // cc28b: own lines smooth
}

// The route file with its sections. wayback: way-back and grey (the reach steps down 3 -> 2 -> 1 km when the query area
// is over the bound or the data does not fit; report.reach is the reach used). elevation: the type 3 section (version 2) of
// the lens chart; the unit draws it only on the route with trusted progress (firmware/elev/elev.h). Over the file
// limit, the grey section goes first, then the reach steps down; the elevation section stays in every case.
// report.waybackError says why a file has no way-back data, report.greyReason why it has way-back data but no grey section.
export async function cc27Sections(routeFile, {wayback = true, elevation = true, reach = 'line3k', fetchImpl = globalThis.fetch, fileLimit = FILE_LIMIT} = {}) {
  const report = {}, e = elevation ? elevationSection(routeFile) : null, tail = e ? [{type: SECTION.ELEV, bytes: e}] : [];
  if (elevation) report.elevationBytes = e ? e.length : 0;
  const make = s => s.length ? embedSections(routeFile, s) : routeFile, over = `Datei über ${fileLimit.toLocaleString('de-DE')} B`;
  for (let r = wayback ? reach : null; r;) {
    let w;
    try { w = await addWayback(routeFile, {format: 2, reach: r, fetchImpl}); } catch (err) { report.waybackError = err.message; break; }
    for (const grey of w.grey ? [true, false] : [false]) {
      const sections = [...waybackSections(grey ? w : {...w, grey: null}), ...tail], file = make(sections);
      if (file.length > fileLimit) continue;
      Object.assign(report, {waybackBytes: w.wayback.length, greyBytes: grey ? w.grey.length : 0, reach: w.reach, grey: w.greyReport, stats: w.stats});
      if (!grey) report.greyReason = w.grey ? over : w.greyReport?.reason;
      delete report.waybackError;
      return {file, sections: sections.map(s => s.type), report};
    }
    report.waybackError = `${over} mit ${w.reach}`;
    const i = REACH_CHAIN.indexOf(w.reach);
    r = i < 0 ? null : REACH_CHAIN[i + 1];
  }
  const file = make(tail);
  if (file.length > fileLimit) throw new Error('Datei mit Rückweg-Daten zu groß');
  return {file, sections: tail.map(s => s.type), report};
}
