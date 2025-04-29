const CACHE_NAME = "github-pages-cache-v1";
const ROUTE_MAP_KEY = "route-map-v1";

let routeMap = new Map(); // In-memory route map
let basePath = "/"; // Default base path

let hist = [];

// Helper function to determine the root folder URL
function getRootUrl() {
  // Doesn't listen for basePath => isn't defined during installation..
  let url = self.location.href;
  return url.substring(0, url.lastIndexOf("/") + 1);
}

self.addEventListener("install", (event) => {
  console.log("Service worker installing...");

  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      const rootUrl = getRootUrl(); // Dynamically determine the root location
      return cache.add(rootUrl); // Cache the root location
    }),
  );

  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("Service worker activating...");

  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName); // Clean up old caches
            }
          }),
        );
      })
      .then(() => loadRouteMap()), // Load routeMap from cache
  );

  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {

  if (event.data && event.data.type === "REQUEST_PREV") {
    const originatingClient = event.source;

    if (originatingClient) {
		
		const data = {
	      type: "PREV_PAGE",
	      page:hist.at(-1) 
	    };
		
		originatingClient.postMessage(data);
		
      /*caches.match(LAST_SERVED_PAGE_KEY).then((lastServedResponse) => {
        if (lastServedResponse) {
          lastServedResponse.text().then((lastServedContent) => {
            try {
              originatingClient.postMessage({
                type: "PREV_PAGE",
                data: {
                  from: event.source.url,
                  lastServedPage: lastServedPage,
                  lastServedContent: lastServedContent,
				  
                },
              });
              console.log(`Sent PREV_PAGE message with last served page to originating client: ${originatingClient.id}`, originatingClient);
            } catch (error) {
              console.error(`Failed to send PREV_PAGE message to originating client:`, error);
            }
          });
        } else {
          console.warn("No last served page found in cache.");
        }
      });*/
    } else {
      console.log("No originating client found to send PREV_PAGE message.");
    }
  }
  
  if (event.data && event.data.type === "INIT_BASE_PATHXXX") {
    basePath = new URL(event.data.basePath).pathname; // Store the base path
    console.log("Updated base path to", basePath, event);

    // Send redirect event
    const clientUrl = new URL(event.source.url).pathname;
    if (!routeMap.has(clientUrl)) {
      console.warn("Accessing non-existing route", event);

      // Ensure we only send the NEEDS_REDIRECT message to the originating client
      const originatingClient = event.source;

      if (originatingClient) {
        try {
          originatingClient.postMessage({
            type: "NEEDS_REDIRECT",
            data: { from: event.source.url },
          });
          console.log(`Sent NEEDS_REDIRECT message to originating client: ${originatingClient.id}`);
        } catch (error) {
          console.error(`Failed to send NEEDS_REDIRECT message to originating client:`, error);
        }
      } else {
        console.log("No originating client found to send NEEDS_REDIRECT message.");
      }
    }
  }
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

  /* FetchEvent Debugging */
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

        /*const data = {
	      type: "PREV_PAGE",
	      page:hist.at(-1)
	    }*/
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
 

   // console.log("PREV",hist.slice(Math.max(0,hist.length-2),hist.length));

  // App shell pattern => getRootUrl() == App shell
  // Check if the request is a navigation request
  /*if (event.request.mode === "navigate" || event.request.destination === "document") {
    event.respondWith(
      caches.match(getRootUrl())/*.then(async (cachedResponse) => {
        if (cachedResponse) {
          // Cache the contents of the last served page
          const responseClone = cachedResponse.clone();
          const cache = await caches.open(CACHE_NAME);
          await cache.put(LAST_SERVED_PAGE_KEY, responseClone);
          return cachedResponse;
        }
        return fetch(event.request);
      }),*/
    /*);
  }
  // Handle other requests based on the routeMap
  else*/ if (routeMap.has(url.pathname)) {
	  
	//    const previousUrl = event.request.referrer;
  
    //if (previousUrl) {
      // Use the previous URL
      hist.push(url.pathname);
	 
    //}
  
  
    const contentPath = routeMap.get(url.pathname);
    event.respondWith(
      caches.match(contentPath).then((cachedResponse) => {
        console.warn("CACHE HIT AT", contentPath);
        if (cachedResponse) {
          return cachedResponse; // Serve from cache
        }
        return fetch(contentPath); // Fallback to network
      }),
    );
  }
  // Default behavior: try cache first, then network
  else {
	
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        // request the non-cached resource
        return fetch(event.request).then(response => {
	    
          // fetch request returned 404, serve custom 404 page
          if (response.status === 404) {
            return caches.match(getRootUrl())/*.then((custom404Response) => {
        
                // Create a new response with custom headers
                const headers = new Headers(custom404Response.headers);
                headers.append('X-Custom-Metadata', JSON.stringify({
                  error: "404",
                  message: "Resource not found",
                  url: event.request.url//,
				  //prev: hist.at(-1)
                }));
		    
                return new Response(custom404Response.body, {
                  status: 404,
                  headers: headers,
                });
              
            });*/
          }
		  return response;
        }).finally(()=>{
			
			self.clients
              .get(event.clientId)
              .then((originatingClient) => {
                if (!originatingClient) {
                  console.log("No originating client found to send NEEDS_REDIRECT.");
                  return;
                }
	          
                 originatingClient.postMessage({
                    type: "NEEDS_REDIRECT",
                    data: { from: event.request.url },
                  });
              })
			
		});
      }),
    );
  }
});
