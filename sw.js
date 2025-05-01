const DB_NAME = "RouteMapDB";
const DB_VERSION = 1;
const STORE_NAME = "RouteMapStore";

async function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

const CACHE_NAME = "github-pages-cache-v1";
const ROUTE_MAP_KEY = "route-map-v1";
const DEBUG = false;

let routeMap = new Map(); // In-memory route map
let basePath = "/"; // Default base path

let hist = [
  /*{ url: getRootUrl(), content: "" }*/
];

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
  console.log("Service worker installing...", event);

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache all assets first
      return cache.addAll(assets).then(() => {
        // Retrieve the cached response for the root URL (assets[0])
        const rootUrl = assets[0]; // This is the getRootUrl() entry
        return cache.match(rootUrl).then((response) => {
          if (response) {
            // Extract the content of the cached response
            return response.text().then((content) => {
              // Push the root URL and its content into the hist array
              hist.push({
                url: rootUrl,
                content: content,
              });

              console.log("Root URL content cached and added to hist:", hist);
            });
          } else {
            console.warn("No cached response found for root URL:", rootUrl);
          }
        });
      });
    }),
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("Service worker activating...", event);

  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (CACHE_NAME !== cacheName) {
            return caches.delete(cacheName); // Clean up old caches
          }
        }),
      );
    })
   // .then(() => loadRouteMap()) // Load routeMap from cache
  );

  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "INIT_BASE_PATH") {
    basePath = new URL(event.data.basePath).pathname; // Store the base path
    console.log("Updated base path to", basePath, event);
  }
});

async function loadRouteMap() {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get("routeMap");

      request.onsuccess = () => {
        const data = request.result?.value || [];
        routeMap = new Map(data);
        console.log("Loaded routeMap from IndexedDB:", routeMap);
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("Error loading routeMap from IndexedDB:", error);
  }
}

async function saveRouteMap() {
  try {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const serializedRouteMap = Array.from(routeMap.entries());

      const request = store.put({ key: "routeMap", value: serializedRouteMap });

      request.onsuccess = () => {
        console.log("Saved routeMap to IndexedDB:", routeMap);
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  } catch (error) {
    console.error("Error saving routeMap to IndexedDB:", error);
  }
}

let queueMap = new Map();
self.addEventListener("message", async (event) => {
  const id = event.source.id.split("-")[0];

  if (event.data && event.data.type === "ADD_ROUTE") {
    const { href, content } = event.data;
    queueMap.set(href, content);

    console.log("Added route to queue", content);
  }

  if (event.data && event.data.type === "STORE_MAP") {
	  
    console.log(await listAllCaches());
	  
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll([...new Set(queueMap.values())]);
    routeMap = new Map([...routeMap.entries(), ...queueMap.entries()]);

    await saveRouteMap();
	
    queueMap.clear();

    // const response = await cache.match(ROUTE_MAP_KEY);
    // console.log( await response.json(),routeMap)

    event.source.postMessage({
      type: "MAP_STORED",
    });
  }
});

/*let queueMap = new Map();

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "ADD_ROUTE") {
    const { href, content } = event.data;

    queueMap.set(href, content);
    if (queueMap.size === 1) {
      queueMicrotask(async () => {
        const cache = await caches.open(CACHE_NAME);
        await cache.addAll([...new Set(queueMap.values())]);
        routeMap = new Map([...routeMap.entries(), ...queueMap.entries()]);
        await saveRouteMap(routeMap,cache);
        queueMap.clear();
      });
    }
  }
});*/

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

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
    // event.respondWith(caches.match(routeMap.get(hist.at(-1))?.url));

    // Create a new Response object with the HTML content
    /*const customResponse = new Response(hist.at(0).content, {
        headers: { 'Content-Type': 'text/html' },
        status: 200,
        statusText: 'OK'
    });

    // Respond with the custom response
    event.respondWith(customResponse);*/

    event.respondWith(
      self.clients.get(event.clientId).then(async (client) => {
        if (!client) {
          console.log("Fresh client");
		  await loadRouteMap();
          return caches.match(getRootUrl());
        }
        // const isFromClient = new URL(client.url).origin === url.origin;

        if (routeMap.has(url.pathname)) {
          client.postMessage({
            type: "NAVIGATE_TO",
            href: url.pathname,
          });
        }
        return new Response(null, {
          status: 204, // No Content
          statusText: "Navigation prevented",
        });
      }),
    );
  } else if (routeMap.has(url.pathname)) {
    const contentPath = routeMap.get(url.pathname);

    event.respondWith(
      caches.match(contentPath).then(async (cachedResponse) => {
        if (cachedResponse) {
          // Clone the cached response to avoid locking the body
          const clonedResponse = cachedResponse.clone();

          // Process the content of the cloned response
          clonedResponse.text().then((content) => {
            hist.push({ url: event.request.url, content });
          });
          console.warn("CACHE HIT AT", contentPath);
          return cachedResponse; // Serve from cache
        }
        return fetch(contentPath); // Fallback to network
      }),
    );
  } else {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          console.warn("CACHE HIT AT", url);
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
