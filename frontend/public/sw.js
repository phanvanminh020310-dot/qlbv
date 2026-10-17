/* QLBS PWA shell. No clinical or session data is cached in the service worker. */
const VERSION = 'qlbs-pwa-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// A fetch listener is intentionally present for PWA installability. Requests keep
// their normal network behavior so authenticated hospital data is never cached here.
self.addEventListener('fetch', () => {});
