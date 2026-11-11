import { loadOSM } from './osm.js';
import { parseGPX, buildRoute } from './route.js';
import { nameImage } from './names.js';
import { readFile, draw } from './preview.js';
import { CC700 } from './ble.js';
const $ = id => document.getElementById(id), say = (id, s) => { $(id).textContent = s; };
const DEBUG = new URLSearchParams(location.search).has('debug');     // ?debug: Bluetooth log + remote DevTools access
const log = s => { if (DEBUG) say('log', (new Date().toLocaleTimeString() + ' ' + s + '\n' + $('log').textContent).slice(0, 20000)); };
const ARROW = ['↑', '↰', '↖', '↱', '↗', '↶'];
let built, dev, gpxFile, busy;
$('log').hidden = !DEBUG;
if (self.caches) { caches.delete('cc700-roads-v2'); caches.delete('cc700-roads-v3'); }   // road pack of earlier versions (90 MB)
try { $('ground').checked = localStorage.getItem('cc700-ground') === '1'; } catch {}
const upd = () => { $('sendBtn').disabled = !built || busy; };
// a GPX, or a changed setting, builds the route
$('gpx').onchange = () => { gpxFile = $('gpx').files[0]; build(); };
$('speed').onchange = build;
$('ground').onchange = () => { try { localStorage.setItem('cc700-ground', $('ground').checked ? '1' : '0'); } catch {} build(); };
async function build() {
  if (!gpxFile || busy) return;
  busy = true; built = null; $('out').hidden = true; upd();
  try {
    const gpx = parseGPX(await gpxFile.text()); if (gpx.pts.length < 2) throw new Error('GPX ohne Trackpunkte');
    const { lines, areas } = await loadOSM(gpx.pts, (i, n) => say('sum', `Kartendaten ${i + 1}/${n} …`));   // OpenStreetMap, only the cells of this route
    say('sum', 'rechne … (lange Routen bis ca. 30 s)'); await new Promise(r => setTimeout(r, 30));
    const d = new Date(), z = n => String(n).padStart(2, '0');
    const id = z(d.getMonth() + 1) + z(d.getDate()) + z(d.getHours()) + z(d.getMinutes());   // MMDDhhmm: the CC700 menu shows only this number
    const r = buildRoute(gpx, lines, { speedKmh: +$('speed').value, id, label: gpx.name, title: gpx.name, nameImage, areas, map: { ground: $('ground').checked } });
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
  if (r.maxBlock > 1200) return 'Kartenblock zu groß';
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
  if (!new URLSearchParams(location.search).has('shared')) return;
  const c = await caches.open('cc700-share'), r = await c.match('shared.gpx'); if (!r) return;
  gpxFile = new File([await r.blob()], decodeURIComponent(r.headers.get('x-name') || 'shared.gpx')); await c.delete('shared.gpx');
  history.replaceState(null, '', location.pathname + (DEBUG ? '?debug' : ''));
  await build();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
if (DEBUG) window.cc700 = { get built() { return built; }, get dev() { return dev; } };
sharedGPX();
