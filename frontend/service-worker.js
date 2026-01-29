const CACHE_NAME = "weekendly-v3";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js",
  "./manifest.json",
];

self.addEventListener("install", (event) => {
  // ✅ force l'activation du nouveau SW
  self.skipWaiting();

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)),
  );
});

self.addEventListener("activate", (event) => {
  // ✅ prend le contrôle tout de suite
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.map((k) => (k !== CACHE_NAME ? caches.delete(k) : null)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // ✅ Network-first pour index.html (toujours up-to-date)
  if (url.pathname.endsWith("/") || url.pathname.endsWith("/index.html")) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches
            .open(CACHE_NAME)
            .then((cache) => cache.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request)),
    );
    return;
  }

  // Cache-first pour le reste
  event.respondWith(
    caches
      .match(event.request)
      .then((cached) => cached || fetch(event.request)),
  );
});
