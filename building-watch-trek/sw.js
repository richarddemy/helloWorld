const CACHE_NAME = 'bw-trek-shell-v6';
const FILES = ['./', './index.html', './config.js', './core.js', './app.js', './icon.svg', './manifest.webmanifest'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(FILES))); self.skipWaiting(); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))); self.clients.claim(); });
self.addEventListener('fetch', event => { const url = new URL(event.request.url); if (event.request.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.includes('/building-watch-trek/')) return; event.respondWith(fetch(event.request).then(response => { if(response.ok){const clone=response.clone(); caches.open(CACHE_NAME).then(cache=>cache.put(event.request,clone));} return response; }).catch(()=>caches.match(event.request))); });

/* Background Web Push: generic lock-screen text (no location or names).
 * The request details require authenticated Google sign-in in the app.
 */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const expectedPrefix = new URL('./', self.registration.scope).href;
  const target = typeof data.url === 'string' && data.url.startsWith(expectedPrefix) ? data.url : expectedPrefix;
  event.waitUntil(self.registration.showNotification('Building Watch — Assistance requested', {
    body:'Someone is trying to reach you. Open Building Watch to respond.',
    tag:typeof data.tag === 'string' ? data.tag.slice(0,120) : 'building-watch-assistance',
    renotify:true, requireInteraction:true,
    icon:'./icon.svg',badge:'./icon.svg',data:{url:target}
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const dest = event.notification.data && event.notification.data.url || new URL('./',self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients => {
    for (const client of clients) {
      if (client.url.startsWith(new URL('./',self.registration.scope).href)) {await client.focus();return client.navigate(dest);}
    }
    return self.clients.openWindow(dest);
  }));
});
