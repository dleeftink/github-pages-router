const CACHE_NAME = "github-pages-cache-v6";
const ROUTE_MAP_KEY = "route-map-v3";

let routeMap = new Map(); // In-memory route map

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
    }).then(() => loadRouteMap()) // Load routeMap from cache
  );

  event.waitUntil(self.clients.claim());
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

let basePath = "/"; // Default base path

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SET_BASE_PATH") {
    basePath = new URL(event.data.basePath).pathname; // Store the base path
    console.log("Updated base path to", basePath)
  }
});

self.addEventListener("message", async (event) => {
  if (event.data && event.data.type === "ADD_ROUTE") {
    const { href, content } = event.data;

    try {
      const cache = await caches.open(CACHE_NAME);
      const response = await fetch(content);

      if (response.ok) {
        console.log("Caching as", content);
        await cache.put(content, response);
        routeMap.set(href, content); // Update in-memory routeMap
        await saveRouteMap(); // Persist the updated routeMap
        console.log(`Route "${href}" mapped to "${content}" and added to cache.`);
      } else {
        console.error(`Failed to cache route "${content}".`);
      }
    } catch (error) {
      console.error(`Error caching route "${content}":`, error);
    }
  }
});


self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Check if the current route matches a key in the routeMap
  if (routeMap.has(url.pathname)) {
    // Get the file path from the routeMap
    const filePath = routeMap.get(url.pathname);

    console.log("Attempting cache", filePath)
    // Construct the full path by combining basePath and filePath
    const fullPath = `${basePath}${filePath}`;

    console.log("Matching as", fullPath)
    // Serve the file from cache or network
    event.respondWith(

      caches.match(fullPath).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse; // Serve from cache
        }
        return fetch(fullPath); // Fallback to network
      })
    );
  } else {
    // Default behavior: try cache first, then network
    console.log("Requesting",event.request);
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

/*xxself.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (routeMap.has(url.pathname)) {
    const indexPath = basePath + "index.html"; // Construct the path to index.html

    event.respondWith(
      caches.match(indexPath).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(indexPath);
      })
    );
  } else {
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

/*self.addEventListener("fetch", (event) => {
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
});*/