const CACHE_NAME = "github-pages-cache-v1";
const ROUTE_MAP_KEY = "route-map-v1";
const DEBUG = false;

// Define the assets to cache
const assets = [
  getRootUrl(),
  getRootUrl() + "style.css", // Local stylesheet
  "https://fonts.googleapis.com/css2?family=Averia+Serif+Libre:ital,wght@0,300;0,400;0,700;1,300;1,400;1,700&display=swap",
  "https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,100..900;1,100..900&display=swap"
];

let routeMap = new Map(); // In-memory route map
let basePath = "/"; // Default base path

if(self.location) {
  basePath = self.location.pathname;
  basePath = basePath.substring(0,basePath.indexOf('/',1)+1);
}

// Helper function to determine the root folder URL
function getRootUrl() {
  let url = self.location.href;
  return url.substring(0, url.lastIndexOf("/") + 1);
}

self.addEventListener("install", (event) => {
  console.log("Service worker installing...", event);

  event.waitUntil(
    self.clients.matchAll().then((clients) => {
      clients.forEach((client) => {
        console.log(`[ServiceWorker] Pre-installed clients: ${client.url}`);
      });
    }),
  );

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(assets);
    }),
  );

  self.skipWaiting();
});

self.serviceWorker.addEventListener("statechange", (event) => {
  console.log("STATE CHANGE", self.serviceWorker.state);
});

self.addEventListener("activate", (event) => {
  console.log("Service worker activating...", self, event);
  console.log("CHECKING BASEPATH",basePath)

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
      .then(() => loadRouteMap()), // Load routeMap from cache
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

async function saveRouteMap(cache) {
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

let queueMap = new Map();
let storeTasks = 0;

self.addEventListener("message", async (event) => {
  const CLIENT = `[${event.source.id.split("-")[0]}]`;

  if (event.data && event.data.type === "ADD_ROUTE") {
    const { href, path } = event.data;
    if (queueMap.has(href)) {
      return;
    }
    queueMap.set(href, path);
    console.log(CLIENT, "Added route to queue", path);
  }

  if (event.data && event.data.type === "STORE_MAP") {
      
    // console.log(await listAllCaches());
    storeTasks++;
    if (storeTasks === 1) {
      queueMicrotask(async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll([...new Set(queueMap.values())]);
        routeMap = new Map([...routeMap.entries(), ...queueMap.entries()]);

        await saveRouteMap(cache);
        queueMap.clear();
        event.source.postMessage({
          type: "MAP_READY",
        });
        storeTasks = 0;
      });
    }

    // Debug route cache
    // const response = await cache.match(ROUTE_MAP_KEY);
    // console.log( await response.json(),routeMap)
  }

  if (event.data && event.data.type === "CHECK_MAP") {
    console.log("CHECKING", self, routeMap);

    if (routeMap.size > 0) {
      event.source.postMessage({
        type: "MAP_READY",
      });
    } else {
      event.source.postMessage({
        type: "MAP_NOT_READY",
      });
    }
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const route = url.pathname.replace(basePath, "");
  const CLIENT = `[${event.clientId.split("-")[0]}]`;

  // Check if the request is a navigation request
  if (event.request.mode === "navigate" || (event.request.destination === "document" && routeMap.size > 0)) {
    event.respondWith(
      self.clients.get(event.clientId).then((client) => {
        const CLIENT = `[${(client?.id ?? event.resultingClientId).split("-")[0]}]`;
        if (!client) {
          console.clear();
          console.warn(CLIENT, "Fresh client", event);
          return caches.match(getRootUrl());
        }
        // const isFromClient = new URL(client.url).origin === url.origin;


        if (routeMap.has(url.pathname)) {
          console.warn(CLIENT, "Navigated to", '"/' + route + '"');
          client.postMessage({
            type: "NAVIGATE_TO",
            href: url.pathname,
          });
        }
        console.warn(CLIENT, "Attempted to navigate to non-valid route:", '"/' + route + '"');
        return new Response(null, {
          status: 204, // No Content
          statusText: "Navigation prevented",
        });
      }),
    );
  } else if (route.startsWith("API")) {
    const subroute = route.replace("API", "");
    let response, data;

    // Extract the specific route path for matching
    const routePath = subroute.split("?")[0]; // Remove query parameters if any

    switch (routePath) {
      case "/hello":
        data = {
          message: "Hello, world!",
          timestamp: new Date().toISOString(),
        };
        response = new Response(JSON.stringify(data), {
          headers: { "Content-Type": "application/json" },
          status: 200,
          statusText: "OK",
        });
        break;

      case "/clients":
        response = (async () => {
          try {
            const clientList = await clients.matchAll();
            const formattedClients = clientList.map((client) => ({
              id: client.id,
              url: client.url,
              type: client.type,
              visibilityState: client.visibilityState,
            }));

            return new Response(JSON.stringify(formattedClients), {
              headers: { "Content-Type": "application/json" },
              status: 200,
              statusText: "OK",
            });
          } catch (error) {
            // Handle errors gracefully
            return new Response(JSON.stringify({ error: "Failed to fetch clients" }), {
              headers: { "Content-Type": "application/json" },
              status: 500,
              statusText: "Internal Server Error",
            });
          }
        })();
        break;

      default:
        // Handle unknown routes
        response = new Response(null, {
          status: 204, // No Content
          statusText: "Non-existing API",
        });

        // Status 200 in case of empty object
        /*response = new Response(JSON.stringify({}), {
          headers: { 'Content-Type': 'application/json' },
            status: 200,
            statusText: 'OK',
          });*/
        break;
    }

    event.respondWith(response);
  } else if (routeMap.has(url.pathname)) {
    const contentPath = routeMap.get(url.pathname);

    event.respondWith(
      caches.match(contentPath).then(async (cachedResponse) => {
        if (cachedResponse) {
          console.warn(
            CLIENT,
            "ROUTE CACHE HIT DIRECTED FROM",
            '"/' + url.pathname.replace(basePath, "") + '"',
            "TO",
            '"/' + contentPath.replace(basePath, "") + '"',
          );
          return cachedResponse; // Serve from cache
        }
        return fetch(contentPath); // Fallback to network
      }),
    );
  } else {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          console.warn(CLIENT, "ASSET CACHE HIT AT", url);
          return cachedResponse;
        }
        console.warn(CLIENT, "FETCHED FROM SOURCE", url);
        return fetch(event.request); /*.then(response=>{
	  		if(!response) {
	  			return new Response(null, {
                status: 204, // No Content
                statusText: "Navigation prevented",
              });
	  		}
	  		return response;
	  	})*/
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
