const CACHE_NAME = "github-pages-cache-v3";
const ROUTE_MAP_KEY = "route-map-v1";
const DEBUG = false;

let routeMap = new Map(); // In-memory route map
let basePath = "/"; // Default base path

// Define the assets to cache
const assets = [
  getRootUrl(),
  getRootUrl() + "style.css", // Local stylesheet
  "https://fonts.googleapis.com/css2?family=Averia+Serif+Libre:ital,wght@0,300;0,400;0,700;1,300;1,400;1,700&display=swap",
  "https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,100..900;1,100..900&display=swap",
];

// Helper function to determine the root folder URL
function getRootUrl() {
  // Don't listen for basePath => isn't defined during installation..
  let url = self.location.href;
  return url.substring(0, url.lastIndexOf("/") + 1);
}

self.addEventListener("install", (event) => {
  console.log("Service worker installing... [code update] ", event);

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

self.serviceWorker.addEventListener("statechange", (event) => console.log("STATE CHANGE", self.serviceWorker.state));

self.addEventListener("activate", (event) => {
  console.log("Service worker activating...", self, event);

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

self.addEventListener("message", async (event) => {
  const CLIENT = `[${event.source.id.split("-")[0]}]`;

  if (event.data && event.data.type === "INIT_BASE_PATH") {
    basePath = new URL(event.data.basePath).pathname; // Store the base path
    console.log(CLIENT, "Updated base path to", basePath, event);
  }

  if (event.data && event.data.type === "ADD_ROUTE") {
    const { href, content } = event.data;
    queueMap.set(href, content);
    console.log(CLIENT, "Added route to queue", content);
  }

  if (event.data && event.data.type === "STORE_MAP") {
    // console.log(await listAllCaches());

    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...new Set(queueMap.values())]);
    routeMap = new Map([...routeMap.entries(), ...queueMap.entries()]);

    await saveRouteMap(cache);
    queueMap.clear();

    // Debug route cache 
    // const response = await cache.match(ROUTE_MAP_KEY);
    // console.log( await response.json(),routeMap)

    event.source.postMessage({
      type: "MAP_STORED",
    });
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const route = url.pathname.replace(basePath, "");

  const CLIENT = `[${event.clientId.split("-")[0]}]`;

  /* FetchEvent Debugging */
  if (DEBUG) {
    event.waitUntil(
      self.clients
        .get(event.clientId)
        .then((originatingClient) => {
          if (!originatingClient) {
            console.log("No originating client found to send debug messages.");
            return;
          }

          // Extract serializable fields from the FetchEvent
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
            routeMap: JSON.stringify([...routeMap.entries()]),
          };

          // Send the debug information to the originating client
          try {
            originatingClient.postMessage(debugInfo);
            console.debug(`Debug info sent to originating client: ${originatingClient.id}`, originatingClient);
          } catch (error) {
            console.error(`Failed to send debug info to originating client ${originatingClient.id}:`, error);
          }
        })
        .catch((error) => {
          console.error("Error retrieving originating client:", error);
        }),
    );
  }

  // Check if the request is a navigation request
  if (event.request.mode === "navigate" || event.request.destination === "document") {
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
        console.warn(CLIENT, "Attemped to navigate to non-valid route:", '"/' + route + '"');
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
            "ROUTE CACHE HIT DIRECTED FROM", '"/' + url.pathname.replace(basePath, "") + '"', 
            "TO", '"/' + contentPath.replace(basePath, "") + '"'
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
