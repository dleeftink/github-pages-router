/*! fibo.github.io/github-pages-router • MIT License */
(function GitHubPagesRouter() {
  function defineComponent(elementName, ElementClass) {
    if (customElements.get(elementName)) return
    customElements.define(elementName, ElementClass)
  }

  /**
   * Web component <ghp-router>. All other ghp-* components must be inside a <ghp-router>.
   */
  class GHPRouter extends HTMLElement {
    /** DOM Element that wraps the content, defaults to <main> tag. */
    contentElement = undefined
    navlinks = new Set
    contentMap = new Map
    routes = []

    connectedCallback() {
      addEventListener("popstate", this)
      this.contentElement = document.querySelector(this.getAttribute("outlet") ?? "main")
      if (!this.contentElement) console.error("Cannot find contentElement")
    }

    handleEvent(event) {
      if (event.type == "popstate") {
        const contentUrl = this.contentUrlFromLocation(location.toString())
        if (contentUrl) this.viewTransition(contentUrl)
      }
    }

    contentUrlFromLocation(url) {
      const matchedRoute = this.routes.find(({ href }) => url == new URL(href, document.baseURI))
      if (!matchedRoute) return
      return new URL(matchedRoute.content, document.baseURI).toString()
    }

    /**
     * Handle anchor click event.
     */
    navigate(event) {
      event.preventDefault()
      const { href } = event.target
      if (href == document.location.toString()) return
      const contentUrl = this.contentUrlFromLocation(href)
      if (!contentUrl) return
      history.pushState({}, "", href)
      this.viewTransition(contentUrl)
    }

    viewTransition(contentUrl) {
      if ('startViewTransition' in document) {
        document.startViewTransition(this.updateContent(contentUrl))
      } else {
        this.updateContent(contentUrl)
      }
    }

    async updateContent(url) {
      const { contentElement, contentMap, navlinks } = this
      // If content is cached, simulate an async behaviour.
      const cachedContent = contentMap.get(url)
      if (cachedContent) {
        // await new Promise(resolve => {
          // setTimeout(() => {
            contentElement.innerHTML = cachedContent
            // resolve()
          // }, /* notice, no timeout here */)
        // })
      } else {
        // Content is not cached, try to fetch it.
        try {
          const response = await fetch(url)
          const text = await response.text()
          contentMap.set(url, text)
          contentElement.innerHTML = text
        } catch (error) {
          console.error(error)
          return
        }
      }
      // Finally, update navlinks.
      for (const navlink of navlinks.values()) navlink.setAriaCurrent()
    }
  }

  defineComponent("ghp-router", GHPRouter)

  function findParentRouter(initialElement) {
    let { parentElement: element } = initialElement
    while (element) {
      if (element.localName == "ghp-router") return element
      element = element.parentElement;
    }
    console.error(`No ghp-router found for element ${initialElement}`)
  }

  /**
   * Web component <ghp-route>.
   *
   * It requires the following attributes:
   * - route
   * - content: URL to HTML content file.
   *
   * @example
   * ```html
   * <ghp-route route="./" content="./path/to/file.html"></ghp-route>
   * ```
   */
  class GHPRoute extends HTMLElement {
    router = undefined

    connectedCallback() {
      this.router = findParentRouter(this)
      if (!this.router) return
      const href = this.getAttribute("href")
      const content = this.getAttribute("content")
      if (!href || !content) {
        console.error("Missing href or content attribute")
        return
      }
      this.router.routes.push({ href, content })
      if (new URL(href, document.baseURI).toString() == location.toString()) {
        this.router.viewTransition(new URL(content, document.baseURI).toString())
      }
    }
  }

  defineComponent("ghp-route", GHPRoute)

  /**
   * Web component <ghp-link> handles an anchor that points to a route.
   * It must wrap the anchor, and will override its click event.
   * @example
   * ```html
   * <ghp-link><a href="./some-route">Click me</a></ghp-link>
   * ```
   */
  class GHPLink extends HTMLElement {
    router = undefined

    connectedCallback() {
      this.router = findParentRouter(this)
      if (!this.router) return
      this.anchor?.addEventListener("click", this)
    }

    get anchor() {
      return this.querySelector("a")
    }

    handleEvent(event) {
      if (event.type == "click" && event.target == this.anchor) {
        this.router?.navigate(event)
      }
    }
  }

  defineComponent("ghp-link", GHPLink)

  /**
   * Web component <ghp-navlink> is similar to <ghp-link> but it also adds aria-selected="page" if the anchor points to current location.
   */
  class GHPNavlink extends HTMLElement {
    router = undefined

    connectedCallback() {
      this.router = findParentRouter(this)
      if (!this.router) return
      this.anchor?.addEventListener("click", this)
      this.setAriaCurrent()
      this.router.navlinks.add(this)
    }

    disconnectedCallback() {
      this.router?.navlinks.delete(this)
    }

    get anchor() {
      return this.querySelector("a")
    }

    handleEvent(event) {
      if (event.type == "click" && event.target == this.anchor) {
        this.router?.navigate(event)
      }
    }

    setAriaCurrent() {
      const { anchor } = this;
      if (!anchor) return;
      if (anchor.href == document.location.toString()) {
        anchor.setAttribute("aria-current", "page")
      } else {
        anchor.setAttribute("aria-current", "")
      }
    }
  }

  defineComponent("ghp-navlink", GHPNavlink)
})();
