// The cc27 route file on the page: the block switches for buildRoute (map.blockFlags) and the sections after the route
// bytes (way-back type 1, grey type 2, elevation type 3; js/wayback_embed.js). Pure code: the page and the tests use it.
import {addWayback, waybackSections} from './wayback.js';
import {elevationSection} from './elevation_section.js';
import {SECTION, embedSections} from './wayback_embed.js';

export const F_OWN = 1, F_TEXT = 2, F_ROUTE = 4;     // firmware/common/types.h
export const FILE_LIMIT = 4_000_000;                 // page guard of a route file

// The GPX has an elevation other than 0: the route file then gets an elevation section.
export const gpxHasElevation = gpx => gpx.pts.some(p => p[2] != null && Number.isFinite(p[2]) && p[2] !== 0);

// The flags of every map block. F_ROUTE (the unit opens the route file on the route) only when it has work there: the
// elevation strip, or the test text.
export function cc27Flags({ownLines = true, testText = true, elevation = true} = {}, elevationPresent = false) {
  return (ownLines ? F_OWN : 0) | (testText ? F_TEXT : 0) | ((elevation && elevationPresent) || testText ? F_ROUTE : 0);
}

// The route file with its sections. wayback: way-back and grey (the reach steps down 3 -> 2 -> 1 km when the data does
// not fit; report.reach is the reach used). A way-back failure keeps the elevation section; report.waybackError says why.
export async function cc27Sections(routeFile, {wayback = true, elevation = true, reach = 'line3k', fetchImpl = globalThis.fetch} = {}) {
  const sections = [], report = {};
  if (wayback) {
    try {
      const w = await addWayback(routeFile, {format: 2, reach, fetchImpl});
      sections.push(...waybackSections(w));
      Object.assign(report, {waybackBytes: w.wayback.length, greyBytes: w.grey ? w.grey.length : 0, reach: w.reach, grey: w.greyReport, stats: w.stats});
    } catch (e) { report.waybackError = e.message; }
  }
  if (elevation) {
    const e = elevationSection(routeFile);
    if (e) sections.push({type: SECTION.ELEV, bytes: e});
    report.elevationBytes = e ? e.length : 0;
  }
  const file = sections.length ? embedSections(routeFile, sections) : routeFile;
  if (file.length > FILE_LIMIT) throw new Error('Datei mit Rückweg-Daten zu groß');
  return {file, sections: sections.map(s => s.type), report};
}
