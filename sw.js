const CACHE = 'ul2755-v15';
const SHELL = ['./', './index.html', './app.js', './srs.js', './manifest.webmanifest', './questions.json', './version.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first for app shell & questions; cache-first for audio MP3s.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isAudio = url.pathname.includes('/audio/') && url.pathname.endsWith('.mp3');

  if (isAudio) {
    e.respondWith(
      caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      }))
    );
  } else {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request))
    );
  }
});
