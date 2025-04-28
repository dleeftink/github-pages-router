// sw.js

const CACHE_NAME = "github-pages-cache-v2";

self.addEventListener("install", (event) => {
  console.log("Service worker installing...");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("Service worker activating...");
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName); // Clean up old caches
          }
        })
      );
    })
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse; // Serve from cache if available
      }
      return fetch(event.request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response; // Don't cache non-GET or error responses
        }
        const responseToCache = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return response;
      });
    })
  );
});

self.addEventListener("message", async (event) => {
  if (event.data && event.data.type === "ADD_ROUTE") {
    const route = event.data.route;

    try {
      const cache = await caches.open(CACHE_NAME);
      const response = await fetch(route);

      if (response.ok) {
        await cache.put(route, response);
        console.log(`Route "${route}" added to cache.`);
      } else {
        console.error(`Failed to cache route "${route}".`);
      }
    } catch (error) {
      console.error(`Error caching route "${route}":`, error);
    }
  }
});