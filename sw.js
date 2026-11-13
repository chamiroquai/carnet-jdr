/* Service worker : met en cache le moteur pour un usage hors ligne.
   Aucun contenu de jeu ne transite ici (ils sont dans IndexedDB). */
const CACHE = 'carnet-jdr-v1.1.0';
const FICHIERS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest'];
// Les icônes sont facultatives : leur absence ne doit pas empêcher le mode hors ligne.
const ICONES = ['./icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(FICHIERS);
    await Promise.all(ICONES.map(i => c.add(i).catch(() => {})));
  }));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(cles => Promise.all(cles.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'activer') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});
