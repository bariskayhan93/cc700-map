// Service worker: receives GPX files shared from other apps (Web Share Target) and keeps the app usable offline.
const APP = 'cc700-app-v9';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'js/app.js', 'js/pb.js', 'js/geo.js', 'js/osm.js', 'js/navsource.js', 'js/map_style.js', 'js/device_draw.js', 'js/map_geometry.js', 'js/map_labels.js', 'js/map_order.js', 'js/mapsec.js', 'js/route.js', 'js/names.js', 'js/preview.js', 'js/ble.js', 'icons/icon-192.png'];
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(APP).then(c => c.addAll(FILES.map(path => new Request(path, { cache: 'reload' }))))); });
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method === 'POST' && u.pathname.endsWith('/share')) {
    e.respondWith((async () => {
      const f = (await e.request.formData()).get('gpx');
      if (f) await (await caches.open('cc700-share')).put('shared.gpx', new Response(f, { headers: { 'x-name': encodeURIComponent(f.name || 'shared.gpx') } }));
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(APP).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.open(APP).then(cache => cache.match(e.request))));    // network first, cache when offline
});
