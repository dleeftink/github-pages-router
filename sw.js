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
  const messages = args.filter((arg) => !(arg instanceof Object));
  console[level]("[ServiceWorker]", ...messages);
  const payload = args.filter((arg) => arg instanceof Object);
  if (payload.length) {
    console[level.startsWith("group") ? "log" : level](`[ServiceWorker]`, ...payload);
  }
  logToClients(args);
}

function logClient(level, id, ...args) {
  if (!DEBUG) return;
  const prefix = getClientPrefix(id);
  const messages = args.filter((arg) => !(arg instanceof Object));
  console[level](`[ServiceWorker] ${prefix}`, ...messages);
  const payload = args.filter((arg) => arg instanceof Object);
  if (payload.length) {
    console[level.startsWith("group") ? "log" : level](`[ServiceWorker]`, ...payload);
  }
  logToClients(args, id);
}

function logToClients(args, id) {
  clients
    .matchAll()
    .then((clients) => {
      if (!clients.length) return;
      clients[0].postMessage({ type: "LOG_EVENT", args, client: id });
    })
    .catch((err) => console.warn(err));
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
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName).then(() => logBase("log", "Deleted old cache:", cacheName));
          }
        }),
      );
    }),
    //.then(() => loadRouteMap()), // => legacy, but test to make sure
  );

  event.waitUntil(self.clients.claim());
});

// === Route Map Management ===
let loadRoutePromise = null;

async function loadRouteMap(client) {
  // If a promise already exists, return it to avoid redundant loads
  if (loadRoutePromise) {
    return loadRoutePromise;
  }

  // Create a new promise for loading the route map
  loadRoutePromise = new Promise(async (resolve, reject) => {
    try {
      logBase("debug", "Loading route map from cache...");

      const cache = await caches.open(CACHE_NAME);
      const response = await cache.match(ROUTE_MAP_KEY);

      if (response) {
        const data = await response.json();
        routeMap = new Map(data);
        logBase("log", "Route map loaded successfully", {
          entries: routeMap.size,
          routeMap,
        });

        resolve(routeMap); // Resolve the promise with the loaded route map
      } else {
        logBase("warn", "No route map found in cache - [T.B.D. requesting from client]");

        // Request routes from the client with a timeout and retry mechanism
        const requestRoutes = async () => {
          return new Promise((resolveRequest, rejectRequest) => {
            let retries = 0;
            const maxRetries = 3;

            const attemptRequest = () => {
              retries++;
              logBase("debug", `Requesting routes from client (attempt ${retries})`);

              const timeout = setTimeout(() => {
                logBase("warn", "Client did not respond in time");
                if (retries < maxRetries) {
                  attemptRequest(); // Retry the request
                } else {
                  rejectRequest(new Error("Failed to load route map after multiple retries"));
                }
              }, 2000); // 2-second timeout

              const handleMessage = (event) => {
                if (event.data?.type === "STORE_MAP") {
                  clearTimeout(timeout);
                  self.removeEventListener("message", handleMessage);

                  logBase("log", "Route map received from client");
                  resolveRequest();
                }
              };

              self.addEventListener("message", handleMessage);

              // Send the REQUEST_ROUTES message to the client
              if (client) {
                client.postMessage({ type: "REQUEST_ROUTES" });
              }
            };

            attemptRequest();
          });
        };

        // await requestRoutes(); // Wait for the client to send the route map
        resolve(routeMap); // Resolve the promise after receiving the route map
      }
    } catch (error) {
      logBase("error", "Failed to load route map:", error);
      reject(error); // Reject the promise if an error occurs
    } finally {
      loadRoutePromise = null; // Reset the promise so it can be recreated on subsequent calls
    }
  });

  return loadRoutePromise;
}

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

  if (event.data?.type === "ADD_ROUTE" || event.data?.type === "ADD_REQUESTED_ROUTE") {
    const { href, path } = event.data;

    if (queueMap.has(href)) {
      logClient("debug", clientId, "Duplicate route skipped:", href);
      return;
    }

    queueMap.set(href, path /*+'?t' + Date.now()*/);
    logClient("log", clientId, event.data?.redo ? "Route queued (worker request)" : "Route queued (from app)", {
      path,
      queueSize: queueMap.size,
    });
  }

  if (event.data?.type === "STORE_MAP") {
    if (queueMap.size === 0) return;
    storeTasks++;

    if (storeTasks === 1) {
      logClient("log", clientId, "Starting route map update", {
        routesQueued: queueMap.size,
      });

      queueMicrotask(async () => {
        try {
          const cache = await caches.open(CACHE_NAME);

          // Old caching mechanism
          // const uniquePaths = [...new Set(queueMap.values())];
          /* await*/ //cache.addAll(uniquePaths); // => add asynchronously

          // Fetch and notify client of cached routes asynchronously;
          const uniquePaths = new Set();
          const promises = queueMap
            .entries()
            .filter(([_, path]) => (uniquePaths.has(path) ? false : (uniquePaths.add(path), true)))
            .map(([href, path]) => {
              return fetch(path)
                .then((response) => {
                  if (!response.ok) {
                    let error = new Error(`HTTP error! Status: ${response.status} for ${path}`);
                    error.response = response;
                    throw error;
                  }
                  //const clone = response.clone();
                  return cache.put(path, response).then(() => {
                    logClient("log", clientId, `Successfully cached: ${path}`);
                    event.source.postMessage({ type: "CONTENT_READY", href, path });
                    return response;
                  });
                })
                .catch((error) => {
                  logClient("warn", clientId, `Failed to fetch or cache: ${path}:`, error);
                  return error;
                });
            });

          Promise.all(promises).then((responses) => {
            let cached = responses.filter((response) => !(response instanceof Error));
            let failed = responses.filter((response) => response instanceof Error).map((d) => d.response);
            if (failed.length) {
              logClient("log", clientId, "Queued routes cached asynchronously with exceptions:", { cached, failed });
            } else {
              logClient("log", clientId, "Queued routes cached asynchronously:", { cached });
            }
          });

          routeMap = new Map([...routeMap, ...queueMap]);

          await saveRouteMap();

          logClient("log", clientId, "Route map updated successfully", {
            totalRoutes: routeMap.size,
            newRoutes: queueMap.size,
            routeMap,
          });

          (await event.source).postMessage({ type: "MAP_READY", routeMap });
        } catch (error) {
          logClient("error", clientId, "Route map update failed:", error);
        } finally {
          queueMap.clear();
          storeTasks = 0;
        }
      });
    }
  }

  if (event.data?.type === "CHECK_MAP") {
    loadChecks++;

    if (loadChecks === 1) {
      logClient("debug", clientId, "Route map check requested", {
        routeMapSize: routeMap.size,
      });

      queueMicrotask(async () => {
        try {
          await loadRouteMap(await event.source);
         (await event.source).postMessage({ type: "MAP_READY", routeMap });
        } catch (error) {
          logClient("error", clientId, "Route map check failed:", error);
        } finally {
          loadChecks = 0;
        }
      });
    }
  }
});

let last; // store last globally => not for individual client use

// === Fetch Handling ===
self.addEventListener("fetch", (event) => {
  const process = async () => {
    if (routeMap.size === 0) {
      //const response = await caches.match(ROUTE_MAP_KEY);
      //routeMap = new Map(await response.json());
      await loadRouteMap();
    }

    const url = new URL(event.request.url);
    const route = url.pathname.replace(basePath.slice(0, -1), "");
    const scope = url.pathname.substring(0, url.pathname.indexOf("/", 1) + 1);
    const name = route.split("/").at(-1);
    const clientId = event.clientId;
    const rootUrl = getRootUrl();
    const contentPath = routeMap.get(url.pathname) || routeMap.get(scope + "*/" + name);

    // API routes

    if (route.toLowerCase().startsWith("/api") && url.href.startsWith(rootUrl)) {
      const subroute = route.toLowerCase().replace("/api", "");
      const routePath = subroute.split("?")[0];

      logClient("debug", clientId, "API request received", {
        path: routePath,
      });

      const debugInfo = {
        type: "TEST_EVENT",
        url: event.request.url,
        method: event.request.method,
        mode: event.request.mode,
        referrer: event.request.referrer,
        destination: event.request.destination,
        credentials: event.request.credentials,
        redirect: event.request.redirect,
        integrity: event.request.integrity,
        isReload: event.isReload,
        headers: Object.fromEntries(event.request.headers.entries()), // Convert headers to a plain object
        // routeMap: JSON.stringify([...routeMap.entries()]),
        last,
      };

      switch (routePath) {
        case "/hello":
          return new Response(
            JSON.stringify({
              message: "Hello, world!",
              timestamp: new Date().toISOString(),
              debugInfo, //referrer: 'oi',//new URL(event.request.referrer).pathname
            }),
            {
              headers: { "Content-Type": "application/json" },
              status: 200,
            },
          );

        case "/clients":
          return clients
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
            });

        default:
          logClient("warn", clientId, "Unknown API route", {
            path: routePath,
          });

          new Response(null, {
            status: 204,
            statusText: "Non-existing API",
          });
      }
    }

    // Ignore out of scope requests
    // else if (event.request.referrer && event.request.referrer.startsWith(rootUrl) === false) { return }

    // Navigation requests
    else if (event.request.mode === "navigate" || (event.request.destination === "document" && routeMap.size > 0)) {
      last = url;

      logClient("warn", clientId || event.resultingClientId, "Navigation intercepted", {
        path: route || "/",
        from: event.request.referrer,
        href: url.href,
        name,
        scope,
      });
      return self.clients.get(clientId).then(async (client) => {
        const usedClientId = client?.id ?? event.resultingClientId;

        if (!client) {
          //(self.clients.get(usedClientId).then(client=>client.postMessage({type:"CLEAR_CONSOLE"})));
          console.clear();
          logClient("warn", usedClientId, "Fresh client detected - serving root");
          return caches.match(getRootUrl());
        }

        const clientUrl = new URL(client.url);
        const clientRoute = clientUrl.pathname.replace(basePath.slice(0, -1), "");

        // Normal fetch when out of scope
        if (client.url.startsWith(rootUrl) === false || clientRoute.toLowerCase().startsWith("/api")) {
          logClient("warn", clientId || event.resultingClientId, "Navigation passed through", {
            path: route || "/",
            from: event.request.referrer,
          });

          return fetch(event.request).then((response) => {
            // fetch request returned 404, serve custom 404 page
            if (response.status === 404) {
              return fetch(getRootUrl()); // => T.B.D. needs postNavigation route as well or not?
            }

            return response;
          });
        }

        if (contentPath) {
          logClient("warn", usedClientId, "Navigating to registered route", {
            path: contentPath.replace(basePath.slice(0, -1), ""),
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
      });
      
    }

    // Route map matches
    else if (contentPath) {
      last = url;

      logClient("groupCollapsed", clientId, "Route request: " + route);
      logClient("log", clientId, "Route map match found", {
        href: route,
        path: contentPath.replace(basePath, ""),
      });

      return caches
        .match(contentPath)
        .then((cachedResponse) => {
          if (cachedResponse) {
            logClient("log", clientId, "Serving from route cache", {
              path: contentPath.replace(basePath, ""),
            });
            return cachedResponse;
          }

          logClient("log", clientId, "Fetching from network", {
            path: contentPath.replace(basePath, ""),
          });

          return fetch(contentPath);
        })
        .then((response) => {
          console.groupEnd();
          return response;
        });
    }
    // General asset caching
    else {
      logClient("debug", clientId, "Asset request", {
        path: url.pathname,
      });

      return caches
        .match(event.request)
        .then((cachedResponse) => {
          logClient("groupCollapsed", clientId, "Asset request: " + route, { routeMap: [...routeMap.entries()] });
          if (cachedResponse) {
            logClient("log", clientId, "Asset cache hit", {
              path: url.pathname,
            });
            return cachedResponse;
          }

          logClient("log", clientId, "Asset fetched from source", {
            path: url.pathname,
          });

          return fetch(event.request).then(async (response) => {
            // If the request is cacheable, store it
            if (response.ok && shouldCacheAsset(event.request)) {
              const cache = await caches.open(CACHE_NAME);
              cache.put(event.request, response.clone());
            }

            /*if(!response.ok) {
            return caches.match(routeMap.get(basePath))
          };*/

            return response;
          });
        })
        .then((response) => {
          console.groupEnd();
          return response;
        });
    }
  };

  event.respondWith(process());
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
