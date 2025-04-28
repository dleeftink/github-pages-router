/* sw.js */

const CACHE_NAME = "github-pages-cache-v6";
const ROUTE_MAP_KEY = "route-map-v3";

let routeMap = new Map(); // In-memory route map

// Determine the base path dynamically
const basePath = (() => {
  const path = self.location.pathname;
  const lastSlashIndex = path.lastIndexOf("/");
  const directoryPath = lastSlashIndex >= 0 ? path.substring(0, lastSlashIndex + 1) : "/";
  return new URL(directoryPath, self.location.origin).toString(); // Ensure it's a valid absolute URL
})();

self.addEventListener("install", (event) => {
  console.log("Service worker installing...");
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll([
          `${basePath}`, // Root of the Service Worker's directory
          `${basePath}index.html` // Index file in the Service Worker's directory
        ]),
      ),
  );
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
    }).then(() => loadRouteMap()) // Load routeMap from cache
  );

  event.waitUntil(self.clients.claim()); // Activate on first page load
});

async function loadRouteMap() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(ROUTE_MAP_KEY);

    if (response) {
      const data = await response.json();
      routeMap = new Map(data); // Deserialize routeMap
      console.log("Loaded routeMap from cache:", routeMap);
    } else {
      console.log("No routeMap found in cache.");
    }
  } catch (error) {
    console.error("Error loading routeMap:", error);
  }
}

async function saveRouteMap() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const serializedRouteMap = JSON.stringify(Array.from(routeMap.entries()));
    const response = new Response(serializedRouteMap, { headers: { "Content-Type": "application/json" } });
    await cache.put(ROUTE_MAP_KEY, response);
    console.log("Saved routeMap to cache:", routeMap);
  } catch (error) {
    console.error("Error saving routeMap:", error);
  }
}

self.addEventListener("message", async (event) => {
  if (event.data && event.data.type === "ADD_ROUTE") {
    const { href, content } = event.data;

    try {
      // Resolve href and content against the base path
      const resolvedHref = new URL(href, basePath).toString();
      const resolvedContent = new URL(content, basePath).toString();

      const cache = await caches.open(CACHE_NAME);
      const response = await fetch(resolvedContent);

      if (response.ok) {
        await cache.put(resolvedContent, response);
        routeMap.set(resolvedHref, resolvedContent); // Update in-memory routeMap
        await saveRouteMap(); // Persist the updated routeMap
        console.log(`Route "${resolvedHref}" mapped to "${resolvedContent}" and added to cache.`);
      } else {
        console.error(`Failed to cache route "${resolvedContent}".`);
      }
    } catch (error) {
      console.error(`Error caching route "${content}":`, error);
    }
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Check if the request is a navigation request (HTML document)
  if (event.request.mode === "navigate" || event.request.destination === "document") {
    // Serve index.html for all navigation requests
    event.respondWith(
      caches.match(`${basePath}index.html`).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse; // Serve from cache
        }
        return fetch(`${basePath}index.html`); // Fallback to network
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