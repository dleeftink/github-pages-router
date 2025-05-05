const CACHE_NAME = "github-pages-cache-v1";
const ROUTE_MAP_KEY = "route-map-v1";
const DEBUG = true;

// Define the assets to cache
const assets = [
  getRootUrl(),
  getRootUrl() + "style.css", // Local stylesheet
  "https://fonts.googleapis.com/css2?family=Averia+Serif+Libre:ital,wght@0,300;0,400;0,700;1,300;1,400;1,700&display=swap",
  "https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,100..900;1,100..900&display=swap",
];

let routeMap = new Map(); // In-memory route map
let basePath = "/"; // Default base path

if (self.location) {
  basePath = self.location.pathname;
  basePath = basePath.substring(0, basePath.indexOf("/", 1) + 1);
}

// Helper function to determine the root folder URL
function getRootUrl() {
  let url = self.location.href;
  return url.substring(0, url.lastIndexOf("/") + 1);
}

// === Logging Utilities ===
function getClientPrefix(id = "") {
  return `[${id.split("-")[0]}]`;
}

function logBase(level, ...args) {
  if (!DEBUG) return;
  console[level]("[ServiceWorker]", ...args);
}

function logClient(level, id, ...args) {
  if (!DEBUG) return;
  const prefix = getClientPrefix(id);
  console[level](`[ServiceWorker] ${prefix}`, ...args);
}

// === Lifecycle Events ===
self.addEventListener("install", (event) => {
  logBase("log", "Installing...", { event });

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assets);
    }),
  );

  event.waitUntil(
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        logClient("log", client.id, "Pre-installed client:", client.url);
      });
    }),
  );

  self.skipWaiting();
});

self.serviceWorker.addEventListener("statechange", (event) => {
  logBase("log", "State changed:", self.serviceWorker.state);
});

self.addEventListener("activate", (event) => {
  logBase("log", "Activating...", { event });
  logBase("log", "Base path:", basePath);

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (CACHE_NAME !== cacheName) {
              return caches.delete(cacheName); // Clean up old caches
            }
          }),
        );
      })
      .then(() => loadRouteMap()),
  );

  event.waitUntil(self.clients.claim());
});

// === Route Map Management ===
async function loadRouteMap() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(ROUTE_MAP_KEY);

    if (response) {
      const data = await response.json();
      routeMap = new Map(data); // Deserialize routeMap
      logBase("log", "Loaded routeMap from cache:", [...routeMap]);
    } else {
      logBase("log", "No routeMap found in cache");
    }
  } catch (error) {
    logBase("error", "Error loading routeMap:", error);
  }
}

async function saveRouteMap() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const serializedRouteMap = JSON.stringify([...routeMap]);
    const response = new Response(serializedRouteMap, {
      headers: { "Content-Type": "application/json" },
    });
    await cache.put(ROUTE_MAP_KEY, response);
    logBase("log", "Saved routeMap to cache:", [...routeMap]);
  } catch (error) {
    logBase("error", "Error saving routeMap:", error);
  }
}

// === Message Handling ===
let queueMap = new Map();
let storeTasks = 0;

self.addEventListener("message", async (event) => {
  const clientId = event.source.id;

  if (event.data?.type === "ADD_ROUTE") {
    const { href, path } = event.data;
    if (queueMap.has(href)) return;

    queueMap.set(href, path);
    logClient("log", clientId, "Added route to queue:", path);
  }

  if (event.data?.type === "STORE_MAP") {
    storeTasks++;

    if (storeTasks === 1) {
      queueMicrotask(async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll([...new Set(queueMap.values())]);
        routeMap = new Map([...routeMap, ...queueMap]);

        await saveRouteMap();
        queueMap.clear();

        event.source.postMessage({ type: "MAP_READY" });
        storeTasks = 0;
      });
    }
  }

  if (event.data?.type === "CHECK_MAP") {
    logClient("log", clientId, "Checking route map - Size:", routeMap.size);

    event.source.postMessage({
      type: routeMap.size > 0 ? "MAP_READY" : "MAP_NOT_READY",
    });
  }
});

// === Fetch Handling ===
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const route = url.pathname.replace(basePath, "");
  const clientId = event.clientId;

  // Navigation requests
  if (event.request.mode === "navigate" || (event.request.destination === "document" && routeMap.size > 0)) {
    event.respondWith(
      self.clients.get(clientId).then(async (client) => {
        const usedClientId = client?.id ?? event.resultingClientId;
        logClient("warn", usedClientId, "Navigating to:", route || "/");

        if (!client) {
          logClient("warn", usedClientId, "Fresh client detected");
          return caches.match(getRootUrl());
        }

        if (routeMap.has(url.pathname)) {
          client.postMessage({
            type: "NAVIGATE_TO",
            href: url.pathname,
          });
          return new Response(null, { status: 204 });
        }

        logClient("warn", usedClientId, "Blocked navigation to invalid route:", route);
        return new Response(null, {
          status: 204,
          statusText: "Navigation prevented",
        });
      }),
    );
  }
  // API routes
  else if (route.startsWith("API")) {
    const subroute = route.replace("API", "");
    const routePath = subroute.split("?")[0];

    switch (routePath) {
      case "/hello":
        event.respondWith(
          new Response(
            JSON.stringify({
              message: "Hello, world!",
              timestamp: new Date().toISOString(),
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          ),
        );
        break;

      case "/clients":
        event.respondWith(
          clients
            .matchAll()
            .then((clientList) => {
              const formattedClients = clientList.map((client) => ({
                id: client.id,
                url: client.url,
                type: client.type,
                visibilityState: client.visibilityState,
              }));

              return new Response(JSON.stringify(formattedClients), {
                headers: { "Content-Type": "application/json" },
                status: 200,
              });
            })
            .catch((error) => {
              logBase("error", "Client list error:", error);
              return new Response(JSON.stringify({ error: "Failed to fetch clients" }), {
                headers: { "Content-Type": "application/json" },
                status: 500,
              });
            }),
        );
        break;

      default:
        event.respondWith(
          new Response(null, {
            status: 204,
            statusText: "Non-existing API",
          }),
        );
    }
  }
  // Route map matches
  else if (routeMap.has(url.pathname)) {
    const contentPath = routeMap.get(url.pathname);

    event.respondWith(
      caches.match(contentPath).then((cachedResponse) => {
        if (cachedResponse) {
          logClient("warn", clientId, "Route cache hit:", {
            from: route,
            to: contentPath.replace(basePath, ""),
          });
          return cachedResponse;
        }
        return fetch(contentPath);
      }),
    );
  }
  // General asset caching
  else {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          logClient("warn", clientId, "Asset cache hit:", url.pathname);
          return cachedResponse;
        }
        logClient("warn", clientId, "Fetching from source:", url.pathname);
        return fetch(event.request);
      }),
    );
  }
});

/*
event.waitUntil(
  caches.open(CACHE_NAME).then((cache) =>
    cache.matchAll("/github-pages-router/articles/overview.html", { ignoreSearch: true, ignoreMethod: true, ignoreVary: true }).then((responses) => {
      console.log(`Found ${responses.length} matching responses`, responses);
    }),
  ),
);
*/

async function listAllCaches() {
  const cacheNames = await caches.keys();
  console.log("Available caches:", cacheNames);

  for (const cacheName of cacheNames) {
    const cache = await caches.open(cacheName);
    const cachedRequests = await cache.keys();
    console.log(`\nCache "${cacheName}" contents:`);
    cachedRequests.forEach((request) => {
      console.log(`- ${request.url}`);
    });
  }
}
