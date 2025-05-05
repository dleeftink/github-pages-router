const CACHE_NAME = "github-pages-cache-v1";
const ROUTE_MAP_KEY = "route-map-v1";
const DEBUG = true; // Explicitly enabled for development

// Define the assets to cache
const assets = [
  getRootUrl(),
  getRootUrl() + "style.css",
  "https://fonts.googleapis.com/css2?family=Averia+Serif+Libre:ital,wght@0,300;0,400;0,700;1,300;1,400;1,700&display=swap",
  "https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,100..900;1,100..900&display=swap",
];

let routeMap = new Map();
let basePath = "/";

if (self.location) {
  basePath = self.location.pathname.substring(0, self.location.pathname.indexOf("/", 1) + 1);
}

// === Helper functions ===
function getRootUrl() {
  return self.location.href.substring(0, self.location.href.lastIndexOf("/") + 1);
}

// === Logging Utilities ===
function getClientPrefix(id = "") {
  return `[${id.split("-")[0]}]`;
}

function logBase(level, ...args) {
  if (!DEBUG) return;
  console[level]("[ServiceWorker]",  ...args.filter(arg=>!(arg instanceof Object)));
  if([...args].filter(arg=>(arg instanceof Object)).length) 
  console[level](`[ServiceWorker]`, ...args.filter(arg=>(arg instanceof Object)));
}

function logClient(level, id, ...args) {
  if (!DEBUG) return;
  const prefix = getClientPrefix(id);
  console[level](`[ServiceWorker] ${prefix}`, ...args.filter(arg=>!(arg instanceof Object)));
  if([...args].filter(arg=>(arg instanceof Object)).length) 
  console[level](`[+]`, ...args.filter(arg=>(arg instanceof Object)));
}


// === Lifecycle Events ===
self.addEventListener("install", (event) => {
  logBase("log", "Installing...", {
    timestamp: Date.now(),
    assetsCount: assets.length,
  });

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        await cache.addAll(assets);
        logBase("log", "Assets cached successfully", {
          cacheName: CACHE_NAME,
          assetsCached: assets.length,
        });
      } catch (error) {
        logBase("error", "Asset caching failed:", error);
      }
    }),
  );

  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  logBase("log", "Activating...", {
    timestamp: Date.now(),
    basePath,
    routeMapSize: routeMap.size,
  });

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName).then(() => logBase("log", "Deleted old cache:", cacheName));
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
  logBase("debug", "Loading route map from cache...");

  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(ROUTE_MAP_KEY);

    if (response) {
      const data = await response.json();
      routeMap = new Map(data);
      logBase("log", "Route map loaded successfully", {
        entries: routeMap.size,
        sampleEntry: routeMap.entries().next().value,
      });
    } else {
      logBase("warn", "No route map found in cache - using empty map");
    }
  } catch (error) {
    logBase("error", "Failed to load route map:", error);
  }
}

/*let loadTasks = 0;
// === Route Map Management (Batch) ===
async function loadRouteMap() {
  loadTasks++;

  if (loadTasks === 1) {
    logBase("debug", "Loading route map from cache...");

    queueMicrotask(async () => {
      try {
        if (routeMap.size > 0) {
          logBase("log", "Route map already in memory", {
            routeMap,
          });
          return;
        }
        const cache = await caches.open(CACHE_NAME);
        const response = await cache.match(ROUTE_MAP_KEY);

        if (response) {
          const data = await response.json();
          routeMap = new Map(data);
          logBase("log", "Route map loaded successfully", {
            routes: routeMap.size,
            sample: routeMap.entries().next().value,
          });
        } else {
          logBase("warn", "No route map found in cache");
        }
      } catch (error) {
        logBase("error", "Failed to load route map:", error);
      } finally {
        loadTasks = 0;
      }
    });
  }
}*/

async function saveRouteMap() {
  logBase("debug", "Saving route map to cache...");

  try {
    const cache = await caches.open(CACHE_NAME);
    const serializedRouteMap = JSON.stringify([...routeMap]);
    const response = new Response(serializedRouteMap, {
      headers: { "Content-Type": "application/json" },
    });

    await cache.put(ROUTE_MAP_KEY, response);
    logBase("log", "Route map saved successfully", {
      routes: routeMap.size,
      cacheName: CACHE_NAME,
    });
  } catch (error) {
    logBase("error", "Failed to save route map:", error);
  }
}

// === Message Handling ===
let queueMap = new Map();
let storeTasks = 0;
let loadChecks = 0;

self.addEventListener("message", async (event) => {
  const clientId = event.source.id;

  if (event.data?.type === "ADD_ROUTE") {
    const { href, path } = event.data;

    if (queueMap.has(href)) {
      logClient("debug", clientId, "Duplicate route skipped:", href);
      return;
    }

    queueMap.set(href, path/*+'?t' + Date.now()*/);
    logClient("log", clientId, "Route queued", {
      path,
      queueSize: queueMap.size,
    });
  }

  if (event.data?.type === "STORE_MAP") {
    storeTasks++;

    if (storeTasks === 1) {
      logClient("log", clientId, "Starting route map update", {
        routesQueued: queueMap.size,
      });

      queueMicrotask(async () => {
        try {
          const cache = await caches.open(CACHE_NAME);
          const uniquePaths = [...new Set(queueMap.values())];

          /*await*/ cache.addAll(uniquePaths); // => add asynchronously
          routeMap = new Map([...routeMap, ...queueMap]);

          await saveRouteMap();

          logClient("log", clientId, "Route map updated successfully", {
            totalRoutes: routeMap.size,
            newRoutes: queueMap.size,
          });

          queueMap.clear();
          event.source.postMessage({ type: "MAP_READY" });
        } catch (error) {
          logClient("error", clientId, "Route map update failed:", error);
        } finally {
          storeTasks = 0;
        }
      });
    }
  }

  if (event.data?.type === "CHECK_MAP") {

    loadChecks++
    if(loadChecks===1) {
      logClient("debug", clientId, "Route map check requested", {
        routeMapSize: routeMap.size,
      });
      
      queueMicrotask(async()=>{
        try { 
          /*if(routeMap.size === 0) { 
            await loadRouteMap();
            if(routeMap.size > 0) {
              logClient("log", clientId, "Route map check successful and reloaded", {
                routeMap
              });
            }
          }*/
        
          event.source.postMessage({
            type: routeMap.size > 0 ? "MAP_READY" : "MAP_NOT_READY",
            size: routeMap.size,
          });
        } catch (error) {
          logClient("error", clientId, "Route map check failed:", error); 
        } finally {
          loadChecks = 0;
        }
      })
    }
  }
});

// === Fetch Handling ===
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const route = url.pathname.replace(basePath, "");
  const clientId = event.clientId;
  
  // Navigation requests
  if (event.request.mode === "navigate" || (event.request.destination === "document" && routeMap.size > 0)) {
      
    logClient("warn", clientId || event.resultingClientId, "Navigation intercepted", {
      path: route || "/",
      hasRoute: routeMap.has(url.pathname),
    });

    event.respondWith(
      self.clients.get(clientId).then(async (client) => {
        const usedClientId = client?.id ?? event.resultingClientId;

        if (!client) {
          console.clear();
          logClient("warn", usedClientId, "Fresh client detected - serving root");
          return caches.match(getRootUrl());
        }

        if (routeMap.has(url.pathname)) {
          logClient("warn", usedClientId, "Navigating to registered route", {
            path: route,
          });

          client.postMessage({
            type: "NAVIGATE_TO",
            href: url.pathname,
          });

          return new Response(null, { status: 204 });
        }

        logClient("warn", usedClientId, "Blocked invalid navigation", {
          attemptedPath: route,
        });

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

    logClient("debug", clientId, "API request received", {
      path: routePath,
    });

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

              logClient("debug", clientId, "Client list retrieved", {
                count: formattedClients.length,
              });

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
        logClient("warn", clientId, "Unknown API route", {
          path: routePath,
        });

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

    logClient("warn", clientId, "Route map match found", {
      original: route,
      mappedTo: contentPath.replace(basePath, ""),
    });

    event.respondWith(
      caches.match(contentPath).then((cachedResponse) => {
        if (cachedResponse) {
          logClient("warn", clientId, "Serving from route cache", {
            path: contentPath.replace(basePath, ""),
          });
          return cachedResponse;
        }

        logClient("warn", clientId, "Fetching from network", {
          path: contentPath.replace(basePath, ""),
        });

        return fetch(contentPath);
      }),
    );
  }
  // General asset caching
  else {
    logClient("debug", clientId, "Asset request", {
      path: url.pathname,
    });

    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          logClient("warn", clientId, "Asset cache hit", {
            path: url.pathname,
          });
          return cachedResponse;
        }

        logClient("warn", clientId, "Asset fetched from source", {
          path: url.pathname,
        });

        return fetch(event.request).then(async (response)=>{
            
          // If the request is cacheable, store it
          if (response.ok && shouldCacheAsset(event.request)) {
            const cache = await caches.open(CACHE_NAME);
            await cache.put(event.request, response.clone());
          }
          return response

        })
      }),
    );
  }
});

function shouldCacheAsset(request) {
  const url = new URL(request.url);
  const ext = url.pathname.split(".").pop().toLowerCase();
  return ["jpg", "jpeg", "png", "gif", "webp", "woff", "woff2", "ttf", "eot"].includes(ext);
}


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
