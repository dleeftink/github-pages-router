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

    _navigationChain = Promise.resolve(); // Queue of pending navigations
    defaultDelay = 0; // ms — configurable
    
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
      
      await this.registerServiceWorker();
      await this.servePage();
      
      // setTimeout(async() => await this.navigateTo(this.basePath + "server"), 2);
    }

    async registerServiceWorker() {
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("controllerchange", (event) => {
          this.setupRoutes();
        });
        
        this.regs = await navigator.serviceWorker.getRegistrations();

        if (this.regs.length === 0) {
          try {
            console.log("Previous registrations:", this.regs.length);
            // Use document.baseURI to determine the base path
            const basePathName = new URL(this.basePath).pathname;

            const context = this;
            const swPath = `${basePathName}sw.js?t=${Date.now()}`;

            // Register the service worker with the correct scope
            let registration = await navigator.serviceWorker.register(swPath, { scope: basePathName });
            console.log("Service Worker registered with scope:", registration.scope);
            this.setupMessageListeners();
            //this.servePage();
          } catch (error) {
            console.error("Service worker registration failed:", error);
          }
        } else {
          console.log("Service worker registration skipped");
          console.log("Previous registrations:", this.regs.length);

          this.setupMessageListeners();

    
        }
      } else {
        console.warn("Service workers are not supported in this browser.");
      }
    }

    async servePage() {
      navigator.serviceWorker.ready.then((registration) => { 
        registration.active.postMessage({
          type: "CHECK_MAP",
        });
      });

      await this.mapReady;      
      console.groupEnd();
      const atBasepath = location.href === this.basePath;

      // Trigger view transition if the current location matches the route
      if (document.referrer && document.referrer.startsWith(this.basePath) && atBasepath) {
        console.log("Routed from referrer",document.referrer);
        this.navigateTo(new URL(document.referrer).pathname);
      } else {
        console.log("Routed to location",location.pathname);
        this.navigateTo(location.pathname);
      }
    }

    setupRoutes({ skip = false, navigate = true } = {}) {
      console.log("Setting up routes");
      navigator.serviceWorker.ready.then((registration) => {
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
        console.log("Service worker initialised successfully");
        return registration;
      });
    }

    setupMessageListeners(serviceWorker) {
      const navQueue = this.navQueue = [];
      navigator.serviceWorker.addEventListener("message", (event) => {
        console.log("Received event:", event.data);

        if (event.data.type === "NAVIGATE_TO") {
          console.log("Responding to NAVIGATE_TO event from service worker using payload:", event.data);
          this.navigateTo(event.data.href);
        }
        if (event.data.type === "MAP_READY") {
          this.resolveMapReady();
        }
        if (event.data.type === "MAP_NOT_READY") {
          console.log("Waiting for routes...");
          /*this.mapReady = new Promise((resolve) => {
            this.resolveMapReady = resolve;
          });*/
        }
        if (event.data.type === "CONTENT_READY") {
          const href = event.data.href.replace("/*/", "/");
          this.navigateTo(href);
         /* // Push a deferred task into the queue
          this.navQueue.push(
            () =>
              new Promise((resolve) => {
                setTimeout(async () => {
                  await this.navigateTo(href).then(resolve);
                }, 750); // Optional delay
              }),
          );
        
          // Start processing the queue if not already doing so
          if (!this.isProcessing) {
            this.processNavQueue();
          }*/
        }
        
      });
      console.log("Client Listeners activated");
    }
    
    /*async processNavQueue() {
      this.isProcessing = true;
    
      while (this.navQueue.length > 0) {
        const task = this.navQueue.shift();
        try {
          await task(); // Execute the task and wait for completion
        } catch (error) {
          console.error("Navigation failed:", error);
        }
      }
    
      this.isProcessing = false;
    }*/

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
      this.appendHistory(href);
      this.viewTransition(href);
      this.updateNavLinks(); // Update aria-current attributes

    }
    
    appendHistory(href) {
      /*const prevContent = [
        ...(window.history?.state?.prevContent ?? []),
        this.contentElement.innerHTML,
      ];*/
      history.pushState(
        {
          href: window.location.href,
          title: this.contentElement.querySelector("h2")?.textContent ?? "",
          content:this.contentElement.innerHTML,
        },
        "",
        href,
      );
    }

    // Original method
    /*async navigateTo(href) {
 
      if(this.transition) { 
        await this.transition.finished;
      }
      this.navigate({
        target: { href },
        preventDefault: () =>
          console.log(
            "Navigated by app to:",
            "/"+href.replace(new URL(document.baseURI).pathname, ""),
            "from:",
            "/" +(location.pathname.replace(new URL(document.baseURI).pathname, "") || "new") + (history.state?.invalid ? ' [INVALID]' : ''),
            
          ),
      });
    }*/
    
    // Queue navigation
    async navigateTo(href, { delay = this.defaultDelay } = {}) {
      // Wrap the navigation logic in a task
      const task = async () => {
        if (this.transition) {
          await this.transition.finished; // Wait for transition
        }
    
        if (delay > 0) {
          await new Promise(resolve => setTimeout(resolve, delay)); // Optional delay
        }
    
        // Execute the real navigation
        this.navigate({
          target: { href },
          preventDefault: () => console.log("Navigated by app"),
        });
      };
    
      // Chain the task to the queue
      this._navigationChain = this._navigationChain
        .catch(() => {}) // Prevent unhandled rejections from breaking the queue
        .then(task); // Append task to the chain
    
      return this._navigationChain; // Optional: allow awaiting from outside
    }

    async viewTransition(url) {
      if (!document.startViewTransition) return await this.updateContent(url);
      
      const transition = this.transition = document.startViewTransition(async () => {
        await this.updateContent(url);
      });
      await transition.finished;
    }

    async updateContent(url) {
      const { contentElement } = this;
      if (!contentElement) return;

      await this.mapReady;

      // No fallback for GHPRoute as this is handled by the ServiceWorker
      try {
        const response = await fetch(url);
        if (!response.ok) { 
          let error = new Error(`Failed to load content from ${url}`);
          error.status = response;
          throw error
        }
        const text = await response.text();
        contentElement.innerHTML = text;
        if (window.history?.state) {
          document.title = `From ${history.state?.title} to ${contentElement.querySelector("h2")?.textContent ?? ""}`;
        } else {
          document.title = contentElement.querySelector("h2")?.textContent ?? "";
        }
      } catch (error) {
        if(error.status.url.startsWith(this.basePath)) {
          console.warn("New visit from non-valid route")
          if(this.transition) {
            this.transition.skipTransition();
          }
          console.log("Mutating history");
          history.replaceState({...history.state,invalid:true}, '', url.href);
          this.navigateTo(new URL(this.basePath).pathname);          
        } else {
          console.error(error);   
        }
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
