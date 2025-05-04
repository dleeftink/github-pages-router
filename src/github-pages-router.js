(function GitHubPagesRouter() {
  function defineComponent(elementName, ElementClass) {
    if (customElements.get(elementName)) return;
    customElements.define(elementName, ElementClass);
  }

  /**
   * Web component <ghp-router>. All other ghp-* components must be inside a <ghp-router>.
   */
  class GHPRouter extends HTMLElement {
    /** DOM Element that wraps the content, defaults to <main> tag. */
    contentElement = undefined;
    navlinks = new Set(); // Tracks all <ghp-navlink>
    routes = [];

    allRoutesRegistered = new Promise((resolve) => {
      this.resolveAllRoutesRegistered = resolve; // Resolve when all routes are registered
    });

    mapReady = new Promise((resolve) => {
      this.resolveMapReady = resolve;
    });

    async connectedCallback() {
      addEventListener("popstate", this);
      this.contentElement = document.querySelector(this.getAttribute("outlet") ?? "main");
      this.basePath = document.querySelector("base")?.href || "/";
      if (!this.contentElement) console.error("Cannot find contentElement");

      console.warn("Rendered from", document.referrer || "index.html");
      console.group("Setup");

      // Register the service worker
      this.regs = await navigator.serviceWorker.getRegistrations();
      await this.registerServiceWorker();
    }

    async registerServiceWorker() {
      if ("serviceWorker" in navigator) {
        if (this.regs.length === 0) {
          try {
            console.log("Previous registrations:", this.regs.length);
            // Use document.baseURI to determine the base path
            const basePathName = new URL(this.basePath).pathname;

            const context = this;
            const swPath = `${basePathName}sw.js`;

            // Register the service worker with the correct scope
            let registration = await navigator.serviceWorker.register(swPath, { scope: basePathName });
            console.log("Service Worker registered with scope:", registration.scope);

            this.setupMessageListeners();
            this.setupRoutes();
          } catch (error) {
            console.error("Service worker registration failed:", error);
          }
        } else {
          console.log("Service worker registration skipped");
          console.log("Previous registrations:", this.regs.length);

          this.setupMessageListeners();
          this.setupRoutes({ skip: true });
          // this.resolveAppReady();
        }
      } else {
        console.warn("Service workers are not supported in this browser.");
      }
    }

    setupRoutes({ skip = false, navigate = true } = {}) {
      console.log("Setting up routes");
      navigator.serviceWorker.ready

        .then((registration) => {
          if (skip === true) { 
            throw new Error("Skip indexing");
            // console.warn("Skip indexng");
            // this.resolveMapReady();
            // return registration;
            
          }
          let routes = this.querySelectorAll(":scope > ghp-route");
          console.log("Discovered", routes);

          routes.forEach(({ href, path }) => {
            registration.active.postMessage({
              type: "ADD_ROUTE",
              href: new URL(href, document.baseURI).pathname,
              path: new URL(this.basePath).pathname + path.slice(2), //new URL(content, document.baseURI).toString(),
            });
          });
          registration.active.postMessage({
            type: "STORE_MAP",
          });
          return registration;
        })
        .then(async (registration) => {
          await this.mapReady;
          console.log("Service worker initialised successfully");
          console.groupEnd();
          return registration;
        })
        .catch((err) => {
           this.resolveMapReady(); // => there be dragons
           console.warn(err)
         })
        
        .then((registration) => {
          if (navigate === false) { 
            throw new Error("Skip delegation");
          }
          console.log("Setting up update listener")
          registration = registration ?? this.regs[0];
          const refresh = async (event) => {
            if (event.target.state === "redundant") {
              console.log("Switching from stale ServiceWorker");
              registration.active.removeEventListener("statechange", refresh);
              this.mapReady = new Promise((resolve) => {
                this.resolveMapReady = resolve;
              });
              registration = await navigator.serviceWorker.getRegistration();
              registration.active.addEventListener("statechange", refresh);
              console.log("New registration", registration);
              this.setupRoutes({ navigate: false });
            }
          };
          registration.active.addEventListener("statechange", refresh);
          return registration;
        })

        .finally (async (registration) => {
          
          await this.mapReady;
          if (navigate === false) { 
            throw new Error("Stay on path");
          }
          const atBasepath = location.href === this.basePath;

          // Trigger view transition if the current location matches the route
          if (document.referrer && atBasepath) {
            console.log("Routed from referrer");
            this.navigateTo(document.referrer);
          } else {
            console.log("Routed to index");
            this.navigateTo(new URL(this.basePath).pathname);
          }
        })
        .catch((err) => console.warn(err));
    }

    setupMessageListeners(serviceWorker) {
      navigator.serviceWorker.addEventListener("message", (event) => {
        console.log("Received event:", event.data);

        if (event.data.type === "NAVIGATE_TO") {
          console.log("Responding to NAVIGATE_TO event from service worker using payload:", event.data);
          this.navigateTo(event.data.href);
        }
        if (event.data.type === "MAP_READY") {
          this.resolveMapReady();
        }
      });
      console.log("Client Listeners activated");
    }

    addRoute(route) {
      this.routes.push(route);
      if (this.routes.length === 1) {
        queueMicrotask(() => {
          //const payload = JSON.stringify(this.routes)
          //console.log(payload);
          this.resolveAllRoutesRegistered(this.routes);
        });
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
    href = undefined;
    path = undefined;

    connectedCallback() {
      this.router = findParentRouter(this);
      if (!this.router) return;

      const href = (this.href = this.getAttribute("href"));
      const path = (this.path = this.getAttribute("path"));

      if (!href || !path) {
        console.error("Missing href or path attribute");
        return;
      }

      /*navigator.serviceWorker.controller.postMessage({
              type: "ADD_ROUTE",
              href: new URL(href, document.baseURI).pathname,
              content: new URL(this.router.basePath).pathname + content.slice(2), //new URL(content, document.baseURI).toString(),
            });*/

      /*
      const atBasepath = this.router.basePath + href.slice(2) === this.router.basePath;
            
            // Trigger view transition if the current location matches the route
            if(document.referrer && atBasepath) {
              console.log("Routed from referrer")
              this.router.navigateTo(document.referrer)
	        } else if (new URL(href, document.baseURI).toString() === location.toString()) {
              console.log("Routed from location")
              this.router.navigateTo(href);
            }*/

      // Track this route in the router's registration tracker
      // this.router.addRoute({href,path});
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
