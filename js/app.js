import { loadOSM } from './osm.js';
import { parseGPX, buildRoute } from './route.js';
import { nameImage } from './names.js';
import { readFile, draw } from './preview.js';
import { CC700 } from './ble.js';
const $ = id => document.getElementById(id);
function say(id, text) {
  const node = $(id);
  if (node.textContent !== text) node.textContent = text;
}
const Q = new URLSearchParams(location.search), DEBUG = Q.has('debug');   // ?debug: Bluetooth log + remote DevTools access
const LIMIT = DEBUG && +Q.get('cap') || 1200;                          // ?debug&cap=1500: device limit test
const log = s => { if (DEBUG) say('log', (new Date().toLocaleTimeString() + ' ' + s + '\n' + $('log').textContent).slice(0, 20000)); };
const ARROW = ['↑', '↰', '↖', '↱', '↗', '↶'];
const TURN_TEXT = ['Geradeaus', 'Links abbiegen', 'Leicht links', 'Rechts abbiegen', 'Leicht rechts', 'Wenden'];
const COURSE = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
let built, dev, gpxFile;
let building = false, sending = false, needsBuild = false;
let playbackFrame = null, playbackTime = null, playbackDistance = 0;
const km = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const decimal = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
$('log').hidden = !DEBUG;
if (self.caches) { caches.delete('cc700-roads-v2'); caches.delete('cc700-roads-v3'); caches.delete('cc700-osm-v1'); }   // road pack of earlier versions (90 MB)
const LAYERS = ['ground', 'water', 'rails', 'names', 'signals', 'stops', 'trams', 'rough', 'paths', 'arrows', 'details', 'lanes'];   // optional map layers
const ON = new Set(['names', 'signals', 'stops', 'trams', 'rough', 'paths', 'details', 'lanes']);    // default on (patch layers)
function updateFirmware() {
  const patched = $('fw').value === 'patch';
  $('optPatch').hidden = !patched;
  $('optOrig').hidden = patched;
  $('fwWarning').hidden = !patched;
  $('fwOriginal').hidden = patched;
  $('fw').setAttribute('aria-describedby', patched ? 'fwWarning' : 'fwOriginal');
}
try {
  if (localStorage.getItem('cc700-fw') === 'patch') $('fw').value = 'patch';
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
  const file = gpxFile, styled = $('fw').value === 'patch';
  const speedKmh = Math.max(8, Math.min(45, +$('speed').value || 18));
  const layers = Object.fromEntries(LAYERS.map(k => [k, $(k).checked]));
  try {
    const gpx = parseGPX(await file.text());
    if (needsBuild) return;
    if (gpx.pts.length < 2) throw new Error('GPX ohne Trackpunkte');
    const { lines, areas, water, rails, green, trams, wlines, signals, stops } =
      await loadOSM(gpx.pts, (i, n) => { if (!needsBuild) say('sum', `Kartendaten ${i + 1}/${n} …`); });
    if (needsBuild) return;
    say('sum', 'Route wird berechnet …');
    await new Promise(resolve => setTimeout(resolve, 30));
    if (needsBuild) return;

    const d = new Date(), z = n => String(n).padStart(2, '0');
    const id = z(d.getMonth() + 1) + z(d.getDate()) + z(d.getHours()) + z(d.getMinutes());
    const r = buildRoute(gpx, lines, {
      speedKmh, id, label: gpx.name, title: gpx.name, nameImage, areas, water, rails, green, wlines,
      trams: layers.trams ? trams : [], signals: layers.signals ? signals : [], stops: layers.stops ? stops : [],
      noF9: styled,   // patched firmware: field 9 off, as tested on the device
      map: { styled, ...layers, ...(LIMIT > 1200 ? { cap: LIMIT, capMax: LIMIT } : {}) },
    });
    const model = readFile(r.file), check = verify(r, model);
    if (check) throw new Error('Prüfung fehlgeschlagen: ' + check);
    built = { ...r, model, styled, speedKmh, name: `route_${id}.bin` };
    say('sum', `${gpx.name} → CC700 Route ${id} · ${(r.distance / 1000).toFixed(1)} km · ${(r.file.length / 1024).toFixed(0)} KB` +
      (lines.length ? '' : ' · keine Straßendaten: ohne Karte und Straßennamen'));
    say('previewTitle', styled ? 'Kartenvorschau · Sunlight (Patch v18)' : 'Kartenvorschau · Original');
    say('turnsN', `Abbiegungen (${r.sections.length})`);
    $('turns').innerHTML = r.sections.map(s => `<li>${s.type === 2 ? '🏁' : ARROW[s.dir]} ${s.text.replace(/</g, '&lt;')}</li>`).join('');
    const position = +$('pos').value;
    $('pos').max = Math.floor(r.distance);
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
function verify(r, model) {                    // the same limits that were tested on the device
  if (model.secs.length !== r.sections.length) return 'Abschnitte';
  if (r.maxBlock > LIMIT) return 'Kartenblock zu groß';
  if (r.file.length > 4_000_000) return 'Datei zu groß';
  if (model.blocks.length !== r.sections.length) return 'Kartenindex';
  return null;
}
function show(distance = +$('pos').value) {
  if (!built) return;
  const { section, entries, heading } = draw($('cv'), built.model, distance, built.styled);
  $('cv').title = `Abschnitt ${section + 1}, ${entries} Kartenelemente`;
  say('playDistance', `${km.format(distance / 1000)} / ${km.format(built.distance / 1000)} km`);
  showRide(section, distance, heading);
}

function showRide(section, distance, heading) {
  const step = built.sections[section], finished = distance >= +$('pos').max;
  const remaining = finished ? 0 : Math.max(0, step.dist - distance);
  const inKm = remaining >= 1000;
  say('turnDistance', inKm ? decimal.format(remaining / 1000) : String(Math.round(remaining)));
  say('turnUnit', inKm ? 'km' : 'm');
  const dir = step.type === 2 ? 6 : step.dir;
  $('turnArrow').setAttribute('data-dir', String(dir));
  say('turnInstruction', finished ? 'Ziel erreicht' : dir === 6 ? 'Zum Ziel' : TURN_TEXT[dir]);

  const follow = step.text.startsWith('then ') && built.sections[section + 1];
  say('turnStreet', follow ? step.text.slice(step.text.indexOf(' · ') + 3) : step.text);
  $('turnNext').hidden = !follow || finished;
  if (follow) say('turnNext', 'Danach ' + TURN_TEXT[follow.dir].toLocaleLowerCase('de-DE'));

  say('rideSpeed', decimal.format(playbackFrame === null ? 0 : built.speedKmh));
  say('rideHeading', COURSE[Math.round(heading / 45) % COURSE.length]);
  say('rideRemaining', km.format((finished ? 0 : Math.max(0, built.distance - distance)) / 1000));
  $('rideCompass').style.transform = `rotate(${-heading}deg)`;
  $('rideProgress').style.transform = `scaleX(${finished ? 1 : distance / built.distance})`;
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
    $('pos').value = Math.floor(playbackDistance);
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
