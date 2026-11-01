// HOW TO READ THIS FILE (for non-programmers)
// This small helper lets the installed app open quickly and still show its
// last screens without a connection. It always tries the network first.
// Changing the number below makes installed copies discard old saved files.
const PREFIX = 'bw-schedule-';
const CACHE_NAME = PREFIX + 'v1';
const FILES = ['./', './index.html', './config.js', './core.js', './app.js', './icon.svg', './manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES))); self.skipWaiting(); });
// Only this app's old saved files are removed. Other apps on the same web
// address keep theirs.
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.includes('/building-watch-schedule/')) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) { const clone = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)); }
    return response;
  }).catch(() => caches.match(event.request)));
});
