// HOW TO READ THIS FILE (for non-programmers)
// Lines starting with two slashes are notes for people; the browser ignores them.
// This is the "service worker": a small helper the browser runs in the
// background so the installed app opens quickly and still shows its last
// screens without a connection. It always tries the network first, so
// people get the newest version whenever they are online.
// The name of the saved copy. Changing the number (v7 to v8) makes every
// installed copy throw away its old saved files.
const CACHE_NAME = 'bw-trek-shell-v7';
// The files to keep a copy of.
const FILES = ['./', './index.html', './config.js', './core.js', './app.js', './icon.svg', './manifest.webmanifest'];
// When installed: save copies of the files, then take over straight away.
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES))); self.skipWaiting(); });
// When a new version takes over: delete saved copies from older versions.
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))); self.clients.claim(); });
// For each file the app asks for: fetch it fresh from the network and save
// a copy; if offline, use the saved copy. Only this app's own files are
// handled; everything else (Google sign-in, the backend) goes straight out.
self.addEventListener('fetch', event => { const url = new URL(event.request.url); if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.includes('/building-watch-trek/')) return; event.respondWith(fetch(event.request).then(response => { if(response.ok){const clone=response.clone(); caches.open(CACHE_NAME).then(cache=>cache.put(event.request,clone));} return response; }).catch(()=>caches.match(event.request))); });