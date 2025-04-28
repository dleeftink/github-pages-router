const CACHE_NAME = "github-pages-cache-v3";
const routeMap = new Map(); // Maps href to content path

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
  const url = new URL(event.request.url);

  // Check if the request matches a route in the routeMap
  if (routeMap.has(url.pathname)) {
    const contentPath = routeMap.get(url.pathname);
    event.respondWith(
      caches.match(contentPath).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse; // Serve from cache
        }
        return fetch(contentPath); // Fallback to network
      })
    );
  } else {
    // Default behavior: try cache first, then network
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(event.request);
      })
    );
  }
});

self.addEventListener("message", async (event) => {
  if (event.data && event.data.type === "ADD_ROUTE") {
    const { href, content } = event.data;

    try {
      const cache = await caches.open(CACHE_NAME);
      const response = await fetch(content);

      if (response.ok) {
        await cache.put(content, response);
        routeMap.set(href, content); // Add mapping to routeMap
        console.log(`Route "${href}" mapped to "${content}" and added to cache.`);
      } else {
        console.error(`Failed to cache route "${content}".`);
      }
    } catch (error) {
      console.error(`Error caching route "${content}":`, error);
    }
  }
});