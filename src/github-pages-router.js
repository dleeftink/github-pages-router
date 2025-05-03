(function GitHubPagesRouter() {
  function defineComponent(elementName, ElementClass) {
    if (customElements.get(elementName)) return;
    customElements.define(elementName, ElementClass);
  }

  // Global service worker readiness tracker
  const serviceWorkerReady = new Promise((keep, drop) => {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      drop(new Error("Route already defined"));
    } else if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("controllerchange", () => keep());
    }
  });

  /**
   * Web component <ghp-router>. All other ghp-* components must be inside a <ghp-router>.
   */
  class GHPRouter extends HTMLElement {
    /** DOM Element that wraps the content, defaults to <main> tag. */
    contentElement = undefined;
    navlinks = new Set(); // Tracks all <ghp-navlink>

    routeRegistrationTracker = new Set(); // Tracks unregistered <ghp-route> elements
    allRoutesRegistered = new Promise((resolve) => {
      this.resolveAllRoutesRegistered = resolve; // Resolve when all routes are registered
    });

    appReady = new Promise((resolve) => {
      this.resolveAppReady = resolve;
    });

    async connectedCallback() {
      addEventListener("popstate", this);
      this.contentElement = document.querySelector(this.getAttribute("outlet") ?? "main");
      this.basePath = document.querySelector("base")?.href || "/"
      if (!this.contentElement) console.error("Cannot find contentElement");

      console.warn("Rendered from", document.referrer || "index.html");
      console.group("Setup");

      // Register the service worker
      this.regs = await navigator.serviceWorker.getRegistrations();
      await this.registerServiceWorker();
 
    }

    async registerServiceWorker() {
      if ("serviceWorker" in navigator) {
        try {
          const basePathName = new URL(this.basePath).pathname;
          const swPath = `${basePathName}sw.js`;
    
          // Always register the SW to trigger update checks
          const registration = await navigator.serviceWorker.register(swPath, { 
            scope: basePathName 
          });
    
          // Handle SW updates
          this.handleSWUpdates(registration);
    
          console.log("Service Worker registered with scope:", registration.scope);
          this.setupMessageListener(this);
    
          // Existing logic to post messages after routes registered
          this.allRoutesRegistered.then(() => {
            navigator.serviceWorker.ready.then((registration) => {
              registration.active.postMessage({ 
                type: "INIT_BASE_PATH", 
                basePath: this.basePath 
              });
              registration.active.postMessage({ type: "STORE_MAP" });
            });
          });
    
          // Existing ready handling
          await this.appReady;
          console.groupEnd();
        } catch (error) {
          console.error("Service worker registration failed:", error);
        }
      }
    }
    
    handleSWUpdates(registration) {
      registration.onupdatefound = () => {
        const installingWorker = registration.installing;
        if (!installingWorker) return;
    
        installingWorker.onstatechange = () => {
          if (installingWorker.state === 'activated') {
            console.log('New service worker activated. Reloading page...');
            window.location.reload();
          }
        };
      };
    
      // Check for updates immediately
      if (navigator.serviceWorker.controller) {
        registration.update();
      }
    }

    setupMessageListener(context) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        console.log("Received event:", event.data);

        if (event.data.type === "NAVIGATE_TO") {
          console.log("Responding to NAVIGATE_TO event from service worker using payload:", event.data);
          this.navigateTo(event.data.href);
        }
        if (event.data.type === "MAP_STORED") {
          this.resolveAppReady();
        }
      });
      console.log("Client Listeners activated");
    }

    notifyRouteRegistered(route) {
      this.routeRegistrationTracker.delete(route); // Remove route from tracker
      if (this.routeRegistrationTracker.size === 0) {
        this.resolveAllRoutesRegistered(); // Resolve the promise when all routes are registered
        console.warn("All base routes emitted from client");
      }
    }

    handleEvent(event) {
      if (event.type === "popstate") {
        const currentUrl = location.toString();
        this.viewTransition(currentUrl);
        this.updateNavLinks(); // Update aria-current attributes
      }
    }

    /**
     * Handle anchor click event.
     */
    navigate(event) {
      event.preventDefault();
      const { href } = event.target;
      if (href === document.location.toString()) return;
      const prevContent = [...(window.history?.state?.prevContent ?? []), this.contentElement.innerHTML];
      history.pushState({ prevUrl: window.location.href, prevTitle: this.contentElement.querySelector("h2")?.textContent ?? "", prevContent }, "", href);
      this.viewTransition(href);
      this.updateNavLinks(); // Update aria-current attributes
    }

    navigateTo(href) {
      this.navigate({
        target: { href },
        preventDefault: () =>
          console.log(
            "Navigated by app to:",
            href.replace(new URL(document.baseURI).pathname, ""),
            "from:",
            location.pathname.replace(new URL(document.baseURI).pathname, "") || "new tab",
          ),
      });
    }

    async viewTransition(url) {
      if (!document.startViewTransition) return await this.updateContent(url);

      const transition = document.startViewTransition(async () => {
        await this.updateContent(url);
      });
      await transition.finished;
    }

    async updateContent(url) {
      const { contentElement } = this;
      if (!contentElement) return;

      // No fallback for GHPRoute as this is handled by the ServiceWorker
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load content from ${url}`);
        const text = await response.text();
        contentElement.innerHTML = text;
        if (window.history?.state) {
          document.title = `From ${window.history.state.prevTitle} to ${contentElement.querySelector("h2")?.textContent ?? ""}`;
        } else {
          document.title = contentElement.querySelector("h2")?.textContent ?? "";
        }
      } catch (error) {
        console.error(error);
      }
    }

    /**
     * Update aria-current attributes for all <ghp-navlink> components.
     */
    updateNavLinks() {
      for (const navlink of this.navlinks.values()) {
        navlink.setAriaCurrent();
      }
    }
  }

  defineComponent("ghp-router", GHPRouter);

  function findParentRouter(initialElement) {
    let { parentElement: element } = initialElement;
    while (element) {
      if (element.localName === "ghp-router") return element;
      element = element.parentElement;
    }
    console.error(`No ghp-router found for element ${initialElement}`);
  }

  /**
   * Web component <ghp-route>.
   *
   * It requires the following attributes:
   * - href
   * - content: URL to HTML content file.
   *
   * @example
   * ```html
   * <ghp-route href="./" content="./path/to/file.html"></ghp-route>
   * ```
   */
  class GHPRoute extends HTMLElement {
    router = undefined;

    connectedCallback() {
      this.router = findParentRouter(this);
      if (!this.router) return;

      const href = this.getAttribute("href");
      const content = this.getAttribute("content");

      if (!href || !content) {
        console.error("Missing href or content attribute");
        return;
      }

      // Register route with the service worker
      serviceWorkerReady
        .then((err) => {
          // console.log("Registering route", href);
          if (this.router.regs.length === 0) {
            navigator.serviceWorker.controller.postMessage({
              type: "ADD_ROUTE",
              href: new URL(href, document.baseURI).pathname,
              content: new URL(this.router.basePath).pathname + content.slice(2), //new URL(content, document.baseURI).toString(),
            });
          }
        })
        .catch((err) => {
          console.warn(err.message, href, content);
        })
        .finally((err) => {
            
          // Notify the router that this route has been registered
          this.router.notifyRouteRegistered(this);
          
          // 
          this.router.appReady.then(() => {
              
            const atBasepath = this.router.basePath + href.slice(2) === this.router.basePath;
            
            // Trigger view transition if the current location matches the route
            if(document.referrer && atBasepath) {
              this.router.navigateTo(document.referrer)
	        } else if (new URL(href, document.baseURI).toString() === location.toString()) {
              this.router.navigateTo(href);
            }
          });
        });

      // Track this route in the router's registration tracker
      this.router.routeRegistrationTracker.add(this);
    }
  }

  defineComponent("ghp-route", GHPRoute);

  /**
   * Web component <ghp-link> handles an anchor that points to a route.
   * It must wrap the anchor, and will override its click event.
   * @example
   * ```html
   * <ghp-link><a href="./some-route">Click me</a></ghp-link>
   * ```
   */
  class GHPLink extends HTMLElement {
    router = undefined;

    connectedCallback() {
      this.router = findParentRouter(this);
      if (!this.router) return;
      this.anchor?.addEventListener("click", this);
    }

    get anchor() {
      return this.querySelector("a");
    }

    handleEvent(event) {
      if (event.type === "click" && event.target === this.anchor) {
        this.router?.navigate(event);
      }
    }
  }

  defineComponent("ghp-link", GHPLink);

  /**
   * Web component <ghp-navlink> is similar to <ghp-link> but it also adds aria-selected="page" if the anchor points to the current location.
   */
  class GHPNavlink extends HTMLElement {
    router = undefined;

    connectedCallback() {
      this.router = findParentRouter(this);
      if (!this.router) return;
      this.anchor?.addEventListener("click", this);
      this.setAriaCurrent();
      this.router.navlinks.add(this);
    }

    disconnectedCallback() {
      this.router?.navlinks.delete(this);
    }

    get anchor() {
      return this.querySelector("a");
    }

    handleEvent(event) {
      if (event.type === "click" && event.target === this.anchor) {
        this.router?.navigate(event);
      }
    }

    setAriaCurrent() {
      const { anchor } = this;
      if (!anchor) return;
      if (anchor.href === document.location.toString()) {
        anchor.setAttribute("aria-current", "page");
      } else {
        anchor.removeAttribute("aria-current");
      }
    }
  }

  defineComponent("ghp-navlink", GHPNavlink);
})();