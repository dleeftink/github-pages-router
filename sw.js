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
  const messages = args.filter(arg=>!(arg instanceof Object));
  console[level]("[ServiceWorker]",  ...messages);
  const payload = args.filter(arg=>(arg instanceof Object));
  if(payload.length) {
    console[level.startsWith("group") ? "log" : level](`[ServiceWorker]`, ...payload);
  }
}

function logClient(level, id, ...args) {
  if (!DEBUG) return;
  const prefix = getClientPrefix(id);
  const messages =  args.filter(arg=>!(arg instanceof Object));
  console[level](`[ServiceWorker] ${prefix}`,...messages);
  const payload = args.filter(arg=>(arg instanceof Object));
  if(payload.length) {
    console[level.startsWith("group") ? "log" : level](`[ServiceWorker]`, ...payload);
  }
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
  
  console.log("HERE",event)

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
      //.then(() => loadRouteMap()),
  );

  event.waitUntil(self.clients.claim());
});

// === Route Map Management ===
let loadTasks = 0;

async function loadRouteMap(event) {
  loadTasks++
  logBase("debug", "Loading route map from cache...");

  if(loadTasks === 1) {    
    queueMicrotask(async () => {
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
          
          // We may still be constructring the map; retry just in case (e.g. not cached while ServiceWorker instantiated);
          setTimeout(async ()=>{
            if(routeMap.size === 0) {
             (await event.source).postMessage({type:"REQUEST_ROUTES"}) 
            }            
          },500)        
  
        }
      } catch (error) {
        logBase("error", "Failed to load route map:", error);
      } finally {
        (await event.source).postMessage({
          type: routeMap.size > 0 ? "MAP_READY" : "MAP_NOT_READY",
          size: routeMap.size,
        });
        loadTasks = 0;
      }
    })
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

  if (event.data?.type === "ADD_ROUTE" || event.data?.type === "ADD_REQUESTED_ROUTE") {

    const { href, path } = event.data;

    if (queueMap.has(href)) {
      logClient("debug", clientId, "Duplicate route skipped:", href);
      return;
    }

    queueMap.set(href, path/*+'?t' + Date.now()*/);
    logClient("log", clientId, event.data?.redo ? "Route queued (worker request)" : "Route queued (from app)", {
      path,
      queueSize: queueMap.size,
    });
  }

  if (event.data?.type === "STORE_MAP") {
    if(queueMap.size === 0) return;
    storeTasks++;

    if (storeTasks === 1) {
      logClient("log", clientId, "Starting route map update", {
        routesQueued: queueMap.size,
      });

      queueMicrotask(async () => {
        try {
          const cache = await caches.open(CACHE_NAME);
          
          // const uniquePaths = [...new Set(queueMap.values())];
          /* await*/ //cache.addAll(uniquePaths); // => add asynchronously
          
          // Fetch and notify client of cached routes asynchronously;
          const uniquePaths = new Set();
          const promises = queueMap.entries()
           .filter(([_,path])=>uniquePaths.has(path)? false : (uniquePaths.add(path),true))
           .map(([href,path]) => {
            return fetch(path)
              .then(response => {
                if (!response.ok) {
                  let error = new Error(`HTTP error! Status: ${response.status} for ${path}`);
                  error.response = response;
                  throw error
                }
                //const clone = response.clone();
                return cache.put(path, response).then(() => {
                  logClient("log", clientId,`Successfully cached: ${path}`); 
                  event.source.postMessage({type:"CONTENT_READY",href,path})
                  return response;
                });
              })
              .catch(error => {
                logClient("warn", clientId, `Failed to fetch or cache: ${path}:`, error); 
                return error
              });
          });
          
          Promise.all(promises).then((responses) => {
            let cached = responses.filter(response=>!(response instanceof Error));
            let failed = responses.filter(response=>(response instanceof Error)).map(d=>d.response);
            if(failed.length) {
              logClient("log", clientId, "Queued routes cached asynchronously with exceptions:",{cached,failed})
            } else {
              logClient("log", clientId, "Queued routes cached asynchronously:",{cached})
            }
          });
          
          routeMap = new Map([...routeMap, ...queueMap]);

          await saveRouteMap();

          logClient("log", clientId, "Route map updated successfully", {
            totalRoutes: routeMap.size,
            newRoutes: queueMap.size,
            routeMap
          });

          event.source.postMessage({ type: "MAP_READY" });
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
    // console.log("ROUTES TASKS",loadTasks,storeTasks);
    loadChecks++
    
    if(loadChecks===1) {
      logClient("debug", clientId, "Route map check requested", {
        routeMapSize: routeMap.size,
      });
      
      queueMicrotask(async()=>{
        try { 
          //if(routeMap.size === 0) { 
            await loadRouteMap(event);
            if(routeMap.size > 0) {
              logClient("log", clientId, "Route map check successful and reloaded", {
                routeMap
              });
            } /*else {
              // Retry after timeout
              setTimeout(()=>{
                if(routeMap.size===0) { 
                  event.source.postMessage({type:"REQUEST_ROUTES"}) 
                  logClient("log", clientId, "No routes in cache, requesting")
                }
              },500)
             
            }*/
          //}
        
          /*event.source.postMessage({
            type: routeMap.size > 0 ? "MAP_READY" : "MAP_NOT_READY",
            size: routeMap.size,
          });*/
        } catch (error) {
          logClient("error", clientId, "Route map check failed:", error); 
        } finally {
          loadChecks = 0;
        }
      })
    }
  }
});

let last; // store last globally => not for individual client use

// === Fetch Handling ===
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const route = url.pathname.replace(basePath.slice(0,-1), "");
  const scope = url.pathname.substring(0, url.pathname.indexOf("/", 1) + 1);
  const name = route.split('/').at(-1);
  const clientId = event.clientId;
  const rootUrl = getRootUrl();  
  const contentPath = (routeMap.get(url.pathname) || routeMap.get(scope +'*/'+ name));
  
  // API routes
  if (route.startsWith("/API") && url.href.startsWith(rootUrl)) {
    const subroute = route.replace("/API", "");
    const routePath = subroute.split("?")[0];
  // console.log("SOME TEST", new URL(event.request.referrer).pathname);

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
       last
    };

    switch (routePath) {
      case "/hello":
        event.respondWith(
          new Response(
            JSON.stringify({
              message: "Hello, world!",
              timestamp: new Date().toISOString(),
              debugInfo//referrer: 'oi',//new URL(event.request.referrer).pathname
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
  
  // Ignore out of scope requests
  else if (event.request.referrer && event.request.referrer.startsWith(rootUrl) === false) { return }
  
  // Navigation requests
  else if (event.request.mode === "navigate" || (event.request.destination === "document" && routeMap.size > 0)) {   
    
    last = url;
    
    logClient("warn", clientId || event.resultingClientId, "Navigation intercepted", {
      path: route || "/",
      hasRoute: routeMap.has(url.pathname),
    });

    event.respondWith(
      self.clients.get(clientId).then(async (client) => {
        const usedClientId = client?.id ?? event.resultingClientId;

        if (!client) {
          //(self.clients.get(usedClientId).then(client=>client.postMessage({type:"CLEAR_CONSOLE"})));
          console.clear();
          logClient("warn", usedClientId, "Fresh client detected - serving root");
          return caches.match(getRootUrl());
        }
        
        if (contentPath) {
          logClient("warn", usedClientId, "Navigating to registered route", {
            path:contentPath.replace(basePath.slice(0,-1), "")
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
  
  // Route map matches
  else if (contentPath) {
    last = url;
   
    logClient("groupCollapsed",clientId,"Route request: " + route);
    logClient("log", clientId, "Route map match found", {
      href:route,
      path: contentPath.replace(basePath, ""),
    });

    event.respondWith(
      caches.match(contentPath).then((cachedResponse) => {
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
      }).then((response)=>{ console.groupEnd(); return response}),
    );
  }
  // General asset caching
  else {
    
    logClient("debug", clientId, "Asset request", {
      path: url.pathname,
    });

    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        logClient("groupCollapsed",clientId,"Asset request: " + route);
        if (cachedResponse) {
          logClient("log", clientId, "Asset cache hit", {
            path: url.pathname,
          });
          return cachedResponse;
        }

        logClient("log", clientId, "Asset fetched from source", {
          path: url.pathname,
        });

        return fetch(event.request).then(async (response)=>{
            
          // If the request is cacheable, store it
          if (response.ok && shouldCacheAsset(event.request)) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(event.request, response.clone());
          }
          
          /*if(!response.ok) {
            return caches.match(routeMap.get(basePath))
          };*/

          return response

        })
      }).then((response)=>{ console.groupEnd(); return response}),
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
