// Service Worker: PWA-установка и офлайн-оболочка.
// API никогда не кэшируется — баланс и задания всегда свежие с сервера.
const CACHE = 'ab-shell-v8';
const SHELL = ['/', '/index.html', '/css/app.css', '/css/retro.css', '/js/app.js', '/js/ab3d.js', '/js/extras.js', '/icons/logo.svg', '/icons/icon-192.png', '/manifest.webmanifest', '/img/rewards/cat-game_access.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Сначала сеть, при отсутствии сети — кэш
  e.respondWith(
    (e.request.mode === 'navigate' ? fetch(e.request) : fetch(e.request, { cache: 'no-cache' }))
      .then((res) => {
        if (res.status === 200 && !url.pathname.endsWith('.mp4')) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});

// Клик по системному уведомлению: открыть нужный раздел приложения
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const link = e.notification.data?.link || '/#/home';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) {
          c.navigate?.(link);
          return c.focus();
        }
      }
      return self.clients.openWindow(link);
    })
  );
});
