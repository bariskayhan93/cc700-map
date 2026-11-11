import { RoadPack } from './pack.js';
import { parseGPX, buildRoute, lo_hi } from './route.js';
import { nameImage } from './names.js';
import { readFile, draw } from './preview.js';
import { CC700 } from './ble.js';
const $ = id => document.getElementById(id), DATA = 'data/nrw/';
const DEBUG = new URLSearchParams(location.search).has('debug');     // ?debug: Bluetooth log + remote DevTools access
const log = s => { if (DEBUG) $('log').textContent = (new Date().toLocaleTimeString() + ' ' + s + '\n' + $('log').textContent).slice(0, 20000); };
$('log').hidden = !DEBUG;
let pack, built, dev, gpxFile;
const ARROW = ['↑', '↰', '↖', '↱', '↗', '↶'];
async function dataReady() {
  try {
    const cache = await caches.open('cc700-roads-v2'), idx = await cache.match(DATA + 'index.json');
    if (!idx) throw 0;
    let I = await idx.clone().json();
    try { const N = await (await fetch(DATA + 'index.json', { cache: 'no-store' })).json(); if (RoadPack.files(N).length > RoadPack.files(I).length) I = N; } catch {}   // offline: keep cached
    const missing = []; for (const f of RoadPack.files(I).slice(1)) if (!(await cache.match(DATA + f))) missing.push(f);
    const roadsOk = !missing.some(f => f.startsWith('c'));
    if (roadsOk) pack = await new RoadPack(DATA, await RoadPack.cachedFetcher()).init();
    if (!roadsOk) throw 0;
    if (missing.length) { $('dataState').textContent = 'Update der Kartendaten: graue Bebauungsflächen (≈ 4 MB).'; $('dataBtn').textContent = 'Update laden'; $('dataBtn').hidden = false; return true; }
    $('dataState').textContent = 'Kartendaten offline verfügbar (' + I.source + ').'; $('dataBtn').hidden = true; return true;
  } catch { $('dataState').textContent = 'Kartendaten fehlen (≈ 90 MB, einmalig, WLAN empfohlen).'; $('dataBtn').hidden = false; return false; }
}
$('dataBtn').onclick = async () => {
  $('dataBtn').disabled = true; $('dataProg').hidden = false;
  try { await RoadPack.install(DATA, (i, n) => { $('dataProg').max = n; $('dataProg').value = i; }); await dataReady(); }
  catch (e) { log('Download: ' + e.message); } finally { $('dataBtn').disabled = false; $('dataProg').hidden = true; pack = null; await dataReady(); upd(); }
};
try { $('ground').checked = localStorage.getItem('cc700-ground') === '1'; } catch {}
$('ground').onchange = () => { try { localStorage.setItem('cc700-ground', $('ground').checked ? '1' : '0'); } catch {} if (built && gpxFile) build(); };
const upd = () => { $('buildBtn').disabled = !(pack && gpxFile); $('sendBtn').disabled = !(built && dev); };
$('gpx').onchange = () => { gpxFile = $('gpx').files[0]; upd(); };
async function build() {
  try {
    $('buildBtn').disabled = true; $('sum').textContent = 'rechne … (lange Routen bis ca. 30 s)'; await new Promise(r => setTimeout(r, 30));
    const gpx = parseGPX(await gpxFile.text()); if (gpx.pts.length < 2) throw new Error('GPX ohne Trackpunkte');
    const cov = pack.coverage(gpx.pts);        // share of track points inside the road data region
    if (cov < 0.05) throw new Error('Route liegt außerhalb der Kartendaten (' + pack.idx.source + '): keine Straßen, keine Karte.');
    const [la0, la1] = lo_hi(gpx.pts.map(p => p[0])), [lo0, lo1] = lo_hi(gpx.pts.map(p => p[1])), m = 0.01;
    const lines = await pack.lines([la0 - m, lo0 - m * 1.6, la1 + m, lo1 + m * 1.6]);
    const d = new Date(), z = n => String(n).padStart(2, '0');
    const id = z(d.getMonth() + 1) + z(d.getDate()) + z(d.getHours()) + z(d.getMinutes());   // MMDDhhmm: the CC700 menu shows only this number
    const ground = $('ground').checked && !!pack.idx.areas, box = [la0 - m, lo0 - m * 1.6, la1 + m, lo1 + m * 1.6];
    const areas = ground ? await pack.areas(box) : [];
    const r = buildRoute(gpx, lines, { speedKmh: +$('speed').value, id, label: gpx.name, title: gpx.name, nameImage, areas, map: { ground } });
    const model = readFile(r.file), check = verify(r, model);
    if (check) throw new Error('Prüfung fehlgeschlagen: ' + check);
    built = { ...r, model, name: `route_${id}.bin`, title: gpx.name };
    $('sum').textContent = `${gpx.name} → CC700 Route ${id} · ${(r.distance / 1000).toFixed(1)} km · ${r.sections.length} Abschnitte · ${(r.file.length / 1024).toFixed(0)} KB`
      + (cov < 0.98 ? ` · Achtung: ${Math.round((1 - cov) * 100)} % der Route außerhalb der Kartendaten (dort ohne Karte und Straßennamen)` : '');
    $('turns').innerHTML = r.sections.map(s => `<li>${s.type === 2 ? '🏁' : ARROW[s.dir]} ${s.text.replace(/</g, '&lt;')}</li>`).join('');
    $('cv').hidden = $('pos').hidden = false; $('pos').max = Math.floor(r.distance); $('pos').value = 0; show();
  } catch (e) { $('sum').textContent = e.message; log(e.stack || e.message); } finally { upd(); }
}
$('buildBtn').onclick = build;
function verify(r, model) {                    // the same limits that were tested on the device
  if (model.secs.length !== r.sections.length) return 'Abschnitte';
  if (r.maxBlock > 800) return 'Kartenblock zu groß';
  if (r.file.length > 2_000_000) return 'Datei zu groß';
  if (model.blocks.length !== r.sections.length) return 'Kartenindex';
  return null;
}
const show = () => { const s = draw($('cv'), built.model, +$('pos').value); $('cv').title = `Abschnitt ${s.section}, ${s.entries} Kartenelemente`; };
$('pos').oninput = show;
$('connBtn').onclick = async () => {
  try {
    dev = new CC700(log); await dev.connect();
    const list = await dev.routeList();
    $('dev').textContent = 'Verbunden. Routen auf dem Gerät: ' + (list.length ? list.join(', ') : 'keine');
  } catch (e) { $('dev').textContent = 'Fehler: ' + e.message; dev = null; } finally { upd(); }
};
$('sendBtn').onclick = async () => {
  try {
    $('sendBtn').disabled = true; $('sendProg').hidden = false;
    const ts = new DataView(built.file.buffer).getUint32(0, true);
    await dev.sendFile(built.name, built.file, ts, (i, n) => { $('sendProg').max = n; $('sendProg').value = i; });
    const list = await dev.routeList();
    $('dev').textContent = (list.includes(built.name) ? 'Gesendet als neue Route ' : 'Gesendet, aber nicht in der Routenliste: ') + built.name + '. Routen: ' + list.join(', ');
  } catch (e) { $('dev').textContent = 'Fehler beim Senden: ' + e.message; log(e.stack || e.message); } finally { $('sendProg').hidden = true; upd(); }
};
// GPX shared from another app (Web Share Target, see sw.js)
async function sharedGPX() {
  if (!new URLSearchParams(location.search).has('shared')) return;
  const c = await caches.open('cc700-share'), r = await c.match('shared.gpx'); if (!r) return;
  gpxFile = new File([await r.blob()], decodeURIComponent(r.headers.get('x-name') || 'shared.gpx')); await c.delete('shared.gpx');
  history.replaceState(null, '', location.pathname + (DEBUG ? '?debug' : ''));
  $('sum').textContent = 'GPX empfangen: ' + gpxFile.name; if (pack) await build();
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
if (DEBUG) window.cc700 = { get built() { return built; }, get dev() { return dev; } };
dataReady().then(sharedGPX).then(upd);
