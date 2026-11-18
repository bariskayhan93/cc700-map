import { loadOSM } from './osm.js';
import { parseGPX, buildRoute } from './route.js';
import { nameImage } from './names.js';
import { readFile, draw } from './preview.js';
import { CC700 } from './ble.js';
import { previewGuidance } from './preview_guidance.js';
import {auditMapSection,budgetFailures,transitionPeak,TRANSITION_BUDGET} from './map_budget.js';
import { addWayback } from './wayback.js';
const $ = id => document.getElementById(id);
function say(id, text) {
  const node = $(id);
  if (node.textContent !== text) node.textContent = text;
}
const Q = new URLSearchParams(location.search), DEBUG = Q.has('debug');   // ?debug: Bluetooth log + remote DevTools access
const LIMIT = DEBUG && +Q.get('cap') || 1200;                          // ?debug&cap=1500: device limit test
const log = s => { if (DEBUG) say('log', (new Date().toLocaleTimeString() + ' ' + s + '\n' + $('log').textContent).slice(0, 20000)); };
const ARROW = ['↑', '↰', '↖', '↱', '↗', '↶'];
const COURSE = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
let built, dev, gpxFile;
let building = false, sending = false, needsBuild = false;
let playbackFrame = null, playbackTime = null, playbackDistance = 0;
const km = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const deviceKm = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const decimal = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
$('log').hidden = !DEBUG;
if (self.caches) { caches.delete('cc700-roads-v2'); caches.delete('cc700-roads-v3'); caches.delete('cc700-osm-v1'); }   // road pack of earlier versions (90 MB)
const LAYERS = ['ground', 'water', 'rails', 'names', 'signals', 'stops', 'trams', 'rough', 'paths', 'arrows', 'details', 'lanes'];   // optional map layers
const ON = new Set(['names', 'signals', 'stops', 'trams', 'rough', 'paths', 'details', 'lanes']);    // default on (patch layers)
function updateFirmware() {
  const patched = $('fw').value !== 'orig';
  $('optPatch').hidden = !patched;
  $('optOrig').hidden = patched;
  $('fwWarning').hidden = !patched;
  $('fwOriginal').hidden = patched;
  $('fw').setAttribute('aria-describedby', patched ? 'fwWarning' : 'fwOriginal');
}
try {
  const savedFw = localStorage.getItem('cc700-fw');
  if (savedFw === 'patch' || savedFw === 'patch25') $('fw').value = savedFw;
} catch {}
updateFirmware();
$('fw').onchange = () => {
  try { localStorage.setItem('cc700-fw', $('fw').value); } catch {}
  updateFirmware();
  requestBuild();
};

const upd = () => { $('sendBtn').disabled = !built || building || sending; };
$('gpx').onchange = () => {
  gpxFile = $('gpx').files[0];
  $('pos').value = 0;
  requestBuild();
};
$('speed').onchange = requestBuild;
try { $('wayback').checked = localStorage.getItem('cc700-wayback') === '1'; } catch {}   // default off
$('wayback').onchange = () => {
  try { localStorage.setItem('cc700-wayback', $('wayback').checked ? '1' : '0'); } catch {}
  requestBuild();
};
for (const k of LAYERS) {
  try {
    const v = localStorage.getItem('cc700-' + k);
    $(k).checked = v === null ? ON.has(k) : v === '1';
  } catch { $(k).checked = ON.has(k); }
  $(k).onchange = () => {
    try { localStorage.setItem('cc700-' + k, $(k).checked ? '1' : '0'); } catch {}
    requestBuild();
  };
}
function requestBuild() {
  stopPlayback();
  needsBuild = true;
  built = null;
  $('out').hidden = true;
  upd();
  if (!building && !sending) void build();
}
async function build() {
  needsBuild = false;
  if (!gpxFile) return;
  building = true;
  const file = gpxFile, fwChoice = $('fw').value, styled = fwChoice !== 'orig', codec = fwChoice === 'patch25' ? 'd' : undefined;
  const speedKmh = Math.max(8, Math.min(45, +$('speed').value || 18));
  const layers = Object.fromEntries(LAYERS.map(k => [k, $(k).checked]));
  try {
    const gpx = parseGPX(await file.text());
    if (needsBuild) return;
    if (gpx.pts.length < 2) throw new Error('GPX ohne Trackpunkte');
    const { lines, areas, water, rails, green, trams, wlines, signals, stops, coverage, navigationLines } =
      await loadOSM(gpx.pts, (i, n) => { if (!needsBuild) say('sum', `Kartendaten ${i + 1}/${n} …`); }, undefined, {coverageMeters:styled?1000:0});
    if (needsBuild) return;
    say('sum', 'Route wird berechnet …');
    await new Promise(resolve => setTimeout(resolve, 30));
    if (needsBuild) return;

    const d = new Date(), z = n => String(n).padStart(2, '0');
    const id = z(d.getMonth() + 1) + z(d.getDate()) + z(d.getHours()) + z(d.getMinutes());
    const r = buildRoute(gpx, lines, {
      speedKmh, id, label: gpx.name, title: gpx.name, nameImage, areas, water, rails, green, wlines, navigationLines,
      trams: layers.trams ? trams : [], signals: layers.signals ? signals : [], stops: layers.stops ? stops : [],
      noF9: styled,   // patched firmware: field 9 off, as tested on the device
      map: { styled, ...layers, ...(codec ? { codec } : {}), ...(LIMIT > 1200 ? { cap: LIMIT, capMax: LIMIT } : {}) },
    });
    const model = readFile(r.file), check = verify(r, model, styled);
    if (check) throw new Error('Prüfung fehlgeschlagen: ' + check);
    // Way-back data (test): appended after the check, so the route part of the file is the verified one.
    // Any failure keeps the plain route file.
    let wayback = '';
    if (styled && $('wayback').checked) {
      say('sum', 'Rückweg-Daten werden geladen …');
      try {
        const w = await addWayback(r.file, {format: $('fw').value === 'patch25' ? 2 : 1});
        if (needsBuild) return;
        if (w.file.length > 4_000_000) throw new Error('Datei mit Rückweg-Daten zu groß');
        r.file = w.file;
        wayback = ` · Rückweg-Daten ${(w.bytes / 1024).toFixed(0)} KB (${w.reach === 'line2k' ? '2 km' : '1,5 km'})`;
        log(JSON.stringify({wayback: {bytes: w.bytes, reach: w.reach, stats: w.stats}}));
      } catch (e) {
        if (needsBuild) return;
        wayback = ' · ohne Rückweg-Daten: ' + e.message;
        log(e.stack || e.message);
      }
    }
    built = { ...r, model, styled, speedKmh, name: `route_${id}.bin` };
    say('sum', `${gpx.name} → CC700 Route ${id} · ${(r.distance / 1000).toFixed(1)} km · ${(r.file.length / 1024).toFixed(0)} KB` +
      wayback +
      (lines.length ? '' : ' · keine Straßendaten: ohne Karte und Straßennamen') +
      (styled ? ` · erweitertes Kartenumfeld in ${r.mapStat.blocks.filter(b=>b.coverageFloor>0).length}/${r.mapBlocks} Blöcken` +
        (r.mapStat.reducedContextBlocks ? ` · dichter Bereich: fernes Umfeld in ${r.mapStat.reducedContextBlocks} Blöcken begrenzt (mind. 300 m)` : '') : '') +
      (coverage.missingCells ? ' · äußere Kartendaten teilweise nicht verfügbar' : '') +
      (r.navigationEvidence.warnings.includes('sparse-unmatched-route') ? ' · Warnung: grober GPX-Verlauf weicht von Straßendaten ab; Abbiegehinweise können fehlen. GPX mit mehr Originalpunkten verwenden.' : ''));
    log(JSON.stringify({navigationEvidence:r.navigationEvidence}));
    if(styled)log(JSON.stringify(r.mapStat));
    say('previewTitle', styled ? 'Kartenvorschau · Sunlight' : 'Kartenvorschau · Original');
    say('turnsN', `Abbiegungen (${r.sections.length})`);
    $('turns').innerHTML = r.sections.map(s => `<li>${s.type === 2 ? '🏁' : ARROW[s.dir]} ${s.text.replace(/</g, '&lt;')}</li>`).join('');
    const position = +$('pos').value;
    $('pos').max = r.distance;
    $('pos').value = Math.min(position, +$('pos').max);
    show();
    $('out').hidden = false;
  } catch (e) {
    built = null;
    if (!needsBuild) say('sum', e.message);
    log(e.stack || e.message);
  } finally {
    building = false;
    if (needsBuild) void build();
    upd();
  }
}
function verify(r, model, styled) {
  if (model.secs.length !== r.sections.length) return 'Abschnitte';
  if (styled) {
    const base=new DataView(r.file.buffer,r.file.byteOffset,r.file.byteLength).getUint32(0x5c,true);
    const costs=auditMapSection(r.file.subarray(base));
    if(costs.some(c=>budgetFailures(c).length)||transitionPeak(costs)>TRANSITION_BUDGET) return 'Kartenblock zu komplex';
  } else if (r.maxBlock > LIMIT) return 'Kartenblock zu groß';
  if (r.file.length > 4_000_000) return 'Datei zu groß';
  if (model.blocks.length !== r.sections.length) return 'Kartenindex';
  return null;
}
$('previewStyle').onchange = () => {
  say('previewNote', $('previewStyle').value === 'cycling' ? 'Türkises Wasser, blaue Radwege, unveränderte Straßenkonturen, deckende Route. Nur Vorschau; der CC700 bleibt unverändert.' : ($('previewStyle').value === 'v21' ? 'Patch v21: deckende rote Route, helles Wasser, violette Radwege mit 2 Pixeln. ' : $('previewStyle').value === 'v20' ? 'Patch v20: helles Wasser, violette Radwege mit 2 Pixeln. ' : $('previewStyle').value === 'v19' ? 'Patch v19: türkises Wasser, klare Pfade, korrigierte Flächen und abgestimmte Straßennamen. ' : 'Patch v18. ') + '240 × 256 Pixel, Gerätefarben. Schrift, Linienrasterung und GPS-Verhalten sind angenähert.');
  if (built) show();
};

function show(distance = +$('pos').value) {
  if (!built) return;
  $('previewStyleControl').hidden = !built.styled;
  const { section, entries, heading } = draw($('cv'), built.model, distance, built.styled, { profile: $('previewStyle').value });
  $('cv').title = `Abschnitt ${section + 1}, ${entries} Kartenelemente`;
  say('playDistance', `${km.format(distance / 1000)} / ${km.format(built.distance / 1000)} km`);
  showRide(distance, heading);
}

function showRide(distance, heading) {
  const { remaining, dir, finished, caption } = previewGuidance(built.sections, distance, built.distance);
  const inKm = remaining >= 1000;
  say('turnDistance', inKm ? decimal.format(remaining / 1000) : String(Math.round(remaining)));
  say('turnUnit', inKm ? 'km' : 'm');
  $('turnArrow').setAttribute('data-dir', String(dir));
  say('turnCaption', caption);

  say('rideSpeed', decimal.format(playbackFrame === null ? 0 : built.speedKmh));
  say('rideHeading', COURSE[Math.round(heading / 45) % COURSE.length]);
  say('rideRemaining', deviceKm.format((finished ? 0 : Math.max(0, built.distance - distance)) / 1000));
  $('rideCompass').style.transform = `rotate(${-heading}deg)`;
  const progress = finished ? 1 : Math.max(0, Math.min(1, distance / built.distance));
  $('rideProgress').style.transform = `scaleX(${progress})`;
  $('rideProgress').parentElement.style.setProperty('--ride-progress', `${progress * 100}%`);
}

function stopPlayback() {
  if (playbackFrame === null) return;
  cancelAnimationFrame(playbackFrame);
  playbackFrame = playbackTime = null;
  say('play', 'Abspielen');
  say('rideSpeed', '0,0');
}

function playbackTick(time) {
  playbackTime ??= time;
  const elapsed = time - playbackTime;
  if (elapsed >= 1000 / 15) {
    playbackTime = time;
    const end = +$('pos').max;
    const metersPerSecond = built.speedKmh / 3.6 * +$('playRate').value;
    playbackDistance = Math.min(end, playbackDistance + metersPerSecond * elapsed / 1000);
    $('pos').value = playbackDistance;
    show(playbackDistance);
    if (playbackDistance >= end) {
      stopPlayback();
      return;
    }
  }
  playbackFrame = requestAnimationFrame(playbackTick);
}

$('play').onclick = () => {
  if (playbackFrame !== null) {
    stopPlayback();
    return;
  }
  if (!built || +$('pos').max <= 0) return;
  if (+$('pos').value >= +$('pos').max) $('pos').value = 0;
  playbackDistance = +$('pos').value;
  playbackFrame = requestAnimationFrame(playbackTick);
  say('play', 'Pause');
  show(playbackDistance);
};
$('pos').oninput = () => {
  playbackTime = null;
  playbackDistance = +$('pos').value;
  show(playbackDistance);
};
$('playRate').onchange = () => { playbackTime = null; };
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPlayback();
});
$('sendBtn').onclick = async () => {             // one button: connect when necessary, then send
  if (!built || building || sending) return;
  const { name, file } = built;
  sending = true; upd();
  try {
    if (!dev?.dev?.gatt.connected) { say('dev', 'verbinde …'); dev = new CC700(log); await dev.connect(); }
    say('dev', 'sende …'); $('sendProg').hidden = false;
    await dev.sendFile(name, file, new DataView(file.buffer).getUint32(0, true), (i, n) => { $('sendProg').max = n; $('sendProg').value = i; });
    const list = await dev.routeList();
    say('dev', (list.includes(name) ? 'Gesendet als neue Route ' : 'Gesendet, aber nicht in der Routenliste: ') + name + '. Routen auf dem Gerät: ' + list.join(', '));
  } catch (e) { say('dev', 'Fehler: ' + e.message); log(e.stack || e.message); } finally {
    $('sendProg').hidden = true;
    sending = false;
    if (needsBuild) void build();
    upd();
  }
};
// GPX shared from another app (Web Share Target, see sw.js)
async function sharedGPX() {
  if (!Q.has('shared')) return;
  const c = await caches.open('cc700-share'), r = await c.match('shared.gpx'); if (!r) return;
  gpxFile = new File([await r.blob()], decodeURIComponent(r.headers.get('x-name') || 'shared.gpx')); await c.delete('shared.gpx');
  history.replaceState(null, '', location.pathname + (DEBUG ? '?debug' : ''));
  requestBuild();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
if (DEBUG) window.cc700 = { get built() { return built; }, get dev() { return dev; } };
sharedGPX();
