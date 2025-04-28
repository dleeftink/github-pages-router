/*! fibo.github.io/github-pages-router • MIT License */
(function GitHubPagesRouter() {
  function defineComponent(elementName, ElementClass) {
    if (customElements.get(elementName)) return;
    customElements.define(elementName, ElementClass);
  }

  // Global service worker readiness tracker
  const serviceWorkerReady = new Promise((resolve) => {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      resolve();
    } else if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("controllerchange", () => resolve());
    }
  });

  /**
   * Web component <ghp-router>. All other ghp-* components must be inside a <ghp-router>.
   */
  class GHPRouter extends HTMLElement {
    /** DOM Element that wraps the content, defaults to <main> tag. */
    contentElement = undefined;
    navlinks = new Set(); // Tracks all <ghp-navlink> components

    async connectedCallback() {
      addEventListener("popstate", this);
      this.contentElement = document.querySelector(this.getAttribute("outlet") ?? "main");
      if (!this.contentElement) console.error("Cannot find contentElement");

      // Register the service worker
      await this.registerServiceWorker();

    }

    async registerServiceWorker() {
      if ("serviceWorker" in navigator) {
        try {
          // Use document.baseURI to determine the base path
          const basePath = new URL(document.baseURI).pathname;
          const swPath = `${basePath}sw.js`;

          // Register the service worker with the correct scope
          const registration = await navigator.serviceWorker.register(swPath, { scope: basePath });

          // Await the Service Worker's activation
          //await registration.ready;

          this.registration = registration;

          console.log("Service worker registered successfully at:", swPath);
        } catch (error) {
          console.error("Service worker registration failed:", error);
        }
      } else {
        console.warn("Service workers are not supported in this browser.");
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
      history.pushState({}, "", href);
      this.viewTransition(href);
      this.updateNavLinks(); // Update aria-current attributes
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

      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load content from ${url}`);
        const text = await response.text();
        contentElement.innerHTML = text;
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

    async connectedCallback() {
      this.router = findParentRouter(this);
      if (!this.router) return;

      const href = this.getAttribute("href");
      const content = this.getAttribute("content");

      if (!href || !content) {
        console.error("Missing href or content attribute");
        return;
      }

      if (this.matches(':last-of-type')) {
        console.log('At last route')
        // Send routesReady event or something
      }

      // Notify the service worker about the route
      /*if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
          type: "ADD_ROUTE",
          href: new URL(href, document.baseURI).pathname,
          content: new URL(content, document.baseURI).toString(),
        });
      }*/

      // Wait for the service worker to be ready before sending ADD_ROUTE
      await this.router.registration.ready;
      //await serviceWorkerReady;//.then(() => {
       // if (navigator.serviceWorker.controller) {
          console.log("Inside serviceWorkerReady promise", navigator.serviceWorker)
          navigator.serviceWorker.controller.postMessage({
            type: "ADD_ROUTE",
            href: new URL(href, document.baseURI).pathname,
            content: new URL(content, document.baseURI).toString(),
          });
        //}
      //});

      // If the current location matches the route, trigger a view transition
      if (new URL(href, document.baseURI).toString() === location.toString()) {
        this.router.viewTransition(new URL(content, document.baseURI).toString());
      }
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