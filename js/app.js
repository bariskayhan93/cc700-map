import { loadOSM } from './osm.js';
import { parseGPX, buildRoute } from './route.js';
import { nameImage } from './names.js';
import { readFile, draw } from './preview.js';
import { CC700 } from './ble.js';
const $ = id => document.getElementById(id), say = (id, s) => { $(id).textContent = s; };
const Q = new URLSearchParams(location.search), DEBUG = Q.has('debug');   // ?debug: Bluetooth log + remote DevTools access
const LIMIT = DEBUG && +Q.get('cap') || 1200;                          // ?debug&cap=1500: device limit test
const log = s => { if (DEBUG) say('log', (new Date().toLocaleTimeString() + ' ' + s + '\n' + $('log').textContent).slice(0, 20000)); };
const ARROW = ['↑', '↰', '↖', '↱', '↗', '↶'];
let built, dev, gpxFile, busy;
$('log').hidden = !DEBUG;
if (self.caches) { caches.delete('cc700-roads-v2'); caches.delete('cc700-roads-v3'); caches.delete('cc700-osm-v1'); }   // road pack of earlier versions (90 MB)
const LAYERS = ['ground', 'water', 'rails', 'names', 'signals', 'stops', 'trams', 'rough', 'paths'];   // optional map layers
const ON = new Set(['names', 'signals', 'stops', 'trams', 'rough', 'paths']);    // default on (patch layers)
const fwSet = v => { $('styled').checked = v === 'patch'; $('optPatch').hidden = v !== 'patch'; $('optOrig').hidden = v === 'patch'; };
{ let v = 'patch'; try { v = localStorage.getItem('cc700-fw') || 'patch'; } catch {} $('fw').value = v; fwSet(v); }
$('fw').onchange = () => { try { localStorage.setItem('cc700-fw', $('fw').value); } catch {} fwSet($('fw').value); build(); };
const upd = () => { $('sendBtn').disabled = !built || busy; };
// a GPX, or a changed setting, builds the route
$('gpx').onchange = () => { gpxFile = $('gpx').files[0]; build(); };
$('speed').onchange = build;
for (const k of LAYERS) { try { const v = localStorage.getItem('cc700-' + k); $(k).checked = v === null ? ON.has(k) : v === '1'; } catch { $(k).checked = ON.has(k); }
  $(k).onchange = () => { try { localStorage.setItem('cc700-' + k, $(k).checked ? '1' : '0'); } catch {} build(); }; }
async function build() {
  if (!gpxFile || busy) return;
  busy = true; built = null; $('out').hidden = true; upd();
  try {
    const gpx = parseGPX(await gpxFile.text()); if (gpx.pts.length < 2) throw new Error('GPX ohne Trackpunkte');
    const { lines, areas, water, rails, green, trams, wlines, signals, stops } = await loadOSM(gpx.pts, (i, n) => say('sum', `Kartendaten ${i + 1}/${n} …`));   // OpenStreetMap, only the cells of this route
    say('sum', 'rechne … (lange Routen bis ca. 30 s)'); await new Promise(r => setTimeout(r, 30));
    const d = new Date(), z = n => String(n).padStart(2, '0');
    const id = z(d.getMonth() + 1) + z(d.getDate()) + z(d.getHours()) + z(d.getMinutes());   // MMDDhhmm: the CC700 menu shows only this number
    const r = buildRoute(gpx, lines, { speedKmh: +$('speed').value, id, label: gpx.name, title: gpx.name, nameImage, areas, water, rails, green, wlines, trams: $('trams').checked ? trams : [], signals: $('signals').checked ? signals : [], stops: $('stops').checked ? stops : [], noF9: $('styled').checked,   // patched firmware: field 9 off, as tested on the device
      map: { styled: $('styled').checked, ...Object.fromEntries(LAYERS.map(k => [k, $(k).checked])), ...(LIMIT > 1200 ? { cap: LIMIT, capMax: LIMIT } : {}) } });
    const model = readFile(r.file), check = verify(r, model);
    if (check) throw new Error('Prüfung fehlgeschlagen: ' + check);
    built = { ...r, model, name: `route_${id}.bin` };
    say('sum', `${gpx.name} → CC700 Route ${id} · ${(r.distance / 1000).toFixed(1)} km · ${(r.file.length / 1024).toFixed(0)} KB` + (lines.length ? '' : ' · keine Straßendaten: ohne Karte und Straßennamen'));
    say('turnsN', `Abbiegungen (${r.sections.length})`);
    $('turns').innerHTML = r.sections.map(s => `<li>${s.type === 2 ? '🏁' : ARROW[s.dir]} ${s.text.replace(/</g, '&lt;')}</li>`).join('');
    $('out').hidden = false; $('pos').max = Math.floor(r.distance); $('pos').value = 0; show();
  } catch (e) { say('sum', e.message); log(e.stack || e.message); } finally { busy = false; upd(); }
}
function verify(r, model) {                    // the same limits that were tested on the device
  if (model.secs.length !== r.sections.length) return 'Abschnitte';
  if (r.maxBlock > LIMIT) return 'Kartenblock zu groß';
  if (r.file.length > 4_000_000) return 'Datei zu groß';
  if (model.blocks.length !== r.sections.length) return 'Kartenindex';
  return null;
}
const show = () => { const s = draw($('cv'), built.model, +$('pos').value); $('cv').title = `Abschnitt ${s.section}, ${s.entries} Kartenelemente`; };
$('pos').oninput = show;
$('sendBtn').onclick = async () => {             // one button: connect when necessary, then send
  busy = true; upd();
  try {
    if (!dev?.dev?.gatt.connected) { say('dev', 'verbinde …'); dev = new CC700(log); await dev.connect(); }
    say('dev', 'sende …'); $('sendProg').hidden = false;
    await dev.sendFile(built.name, built.file, new DataView(built.file.buffer).getUint32(0, true), (i, n) => { $('sendProg').max = n; $('sendProg').value = i; });
    const list = await dev.routeList();
    say('dev', (list.includes(built.name) ? 'Gesendet als neue Route ' : 'Gesendet, aber nicht in der Routenliste: ') + built.name + '. Routen auf dem Gerät: ' + list.join(', '));
  } catch (e) { say('dev', 'Fehler: ' + e.message); log(e.stack || e.message); } finally { $('sendProg').hidden = true; busy = false; upd(); }
};
// GPX shared from another app (Web Share Target, see sw.js)
async function sharedGPX() {
  if (!Q.has('shared')) return;
  const c = await caches.open('cc700-share'), r = await c.match('shared.gpx'); if (!r) return;
  gpxFile = new File([await r.blob()], decodeURIComponent(r.headers.get('x-name') || 'shared.gpx')); await c.delete('shared.gpx');
  history.replaceState(null, '', location.pathname + (DEBUG ? '?debug' : ''));
  await build();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
if (DEBUG) window.cc700 = { get built() { return built; }, get dev() { return dev; } };
sharedGPX();
