self.addEventListener('install', event => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
    // Cache Storage is shared by every app on the origin. This project does
    // not own a cache namespace, so activation must not clear origin caches.
    event.waitUntil(self.clients.claim());
});
