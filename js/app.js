import { RoadPack } from './pack.js';
import { parseGPX, buildRoute } from './route.js';
import { nameImage } from './names.js';
import { readFile, draw } from './preview.js';
import { CC700 } from './ble.js';
const $ = id => document.getElementById(id), DATA = 'data/nrw/';
const log = s => { $('log').textContent = (new Date().toLocaleTimeString() + ' ' + s + '\n' + $('log').textContent).slice(0, 20000); };
let pack, built, dev, devRoute;
const ARROW = ['↑', '↰', '↖', '↱', '↗', '↶'];
async function dataReady() {
  try {
    const cache = await caches.open('cc700-roads-v2'), idx = await cache.match(DATA + 'index.json');
    if (!idx) throw 0;
    const n = (await idx.clone().json()).chunks;
    for (let i = 0; i < n; i++) if (!(await cache.match(DATA + `c${i}.bin`))) throw 0;
    pack = await new RoadPack(DATA, await RoadPack.cachedFetcher()).init();
    $('dataState').textContent = 'Kartendaten offline verfügbar (' + (await idx.clone().json()).source + ').'; $('dataBtn').hidden = true; return true;
  } catch { $('dataState').textContent = 'Kartendaten fehlen (≈ 70 MB, einmalig).'; $('dataBtn').hidden = false; return false; }
}
$('dataBtn').onclick = async () => {
  $('dataBtn').disabled = true; $('dataProg').hidden = false;
  try { await RoadPack.install(DATA, (i, n) => { $('dataProg').max = n; $('dataProg').value = i; }); await dataReady(); }
  catch (e) { log('Download: ' + e.message); } finally { $('dataBtn').disabled = false; $('dataProg').hidden = true; upd(); }
};
const upd = () => { $('buildBtn').disabled = !(pack && $('gpx').files[0]); $('sendBtn').disabled = !(built && dev && devRoute); };
$('gpx').onchange = upd;
$('buildBtn').onclick = async () => {
  try {
    $('buildBtn').disabled = true; $('sum').textContent = 'rechne …';
    const gpx = parseGPX(await $('gpx').files[0].text()); if (gpx.pts.length < 2) throw new Error('GPX ohne Trackpunkte');
    const la = gpx.pts.map(p => p[0]), lo = gpx.pts.map(p => p[1]), m = 0.01;
    const lines = await pack.lines([Math.min(...la) - m, Math.min(...lo) - m * 1.6, Math.max(...la) + m, Math.max(...lo) + m * 1.6]);
    const id = devRoute ? devRoute.match(/route_(\w+)\.bin/)?.[1] : '1';
    const r = buildRoute(gpx, lines, { speedKmh: +$('speed').value, id: id || '1', nameImage });
    const model = readFile(r.file), check = verify(r, model);
    if (check) throw new Error('Prüfung fehlgeschlagen: ' + check);
    built = { ...r, model };
    $('sum').textContent = `${(r.distance / 1000).toFixed(1)} km · ${r.sections.length} Abschnitte · ${(r.file.length / 1024).toFixed(0)} KB · Karte ${r.mapBlocks} Blöcke (max ${r.maxBlock})`;
    $('turns').innerHTML = r.sections.map(s => `<li>${s.type === 2 ? '🏁' : ARROW[s.dir]} ${s.text.replace(/</g, '&lt;')}</li>`).join('');
    $('cv').hidden = $('pos').hidden = false; $('pos').max = Math.floor(r.distance); $('pos').value = 0; show();
  } catch (e) { $('sum').textContent = e.message; log(e.stack || e.message); } finally { upd(); }
};
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
    devRoute = await dev.routeName();
    $('dev').textContent = devRoute ? 'Verbunden. Route auf dem Gerät: ' + devRoute : 'Verbunden, aber keine Route auf dem Gerät gefunden. Erst eine Route aus OnelapFit senden.';
    if (built && devRoute) $('sum').textContent += ' · bitte Route neu erstellen (Name: ' + devRoute + ')';
  } catch (e) { $('dev').textContent = 'Fehler: ' + e.message; dev = null; } finally { upd(); }
};
$('sendBtn').onclick = async () => {
  if (!confirm(`Route auf dem CC700 (${devRoute}) ersetzen?`)) return;
  try {
    $('sendBtn').disabled = true; $('sendProg').hidden = false;
    const ts = new DataView(built.file.buffer).getUint32(0, true);
    await dev.sendFile(devRoute, built.file, ts, (i, n) => { $('sendProg').max = n; $('sendProg').value = i; });
    $('dev').textContent = 'Gesendet. Navigation auf dem CC700 starten.';
  } catch (e) { $('dev').textContent = 'Fehler beim Senden: ' + e.message; log(e.stack || e.message); } finally { $('sendProg').hidden = true; upd(); }
};
dataReady().then(upd);
