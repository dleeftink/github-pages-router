(function GitHubPagesRouter() {

  function defineComponent(elementName, ElementClass) {
    if (!customElements.get(elementName))
      customElements.define(elementName, ElementClass);
  }

  let main = document.getElementsByTagName('main');

  window.addEventListener('pageswap', async (event) => {

    sessionStorage.setItem('lastVisit', main[0].innerHTML);

  });

  class GHPRouter extends HTMLElement {
    contentElement = void 0;

    navlinks = new Set();
    contentMap = new Map();
    routes = [];

    debug = window.debug ?? false;

    constructor() {
      super();
      window.GHPRouter = this;
    }

    connectedCallback() {
      addEventListener("popstate", this);
      this.contentElement = document.querySelector(
        this.getAttribute("outlet") ?? "main",
      );
      if (!this.contentElement) console.error("Cannot find contentElement");
    }

    async handleEvent(event) {
      if (event.type == "popstate") {
        const contentUrl = this.contentUrlFromLocation(location.toString());
        if (contentUrl) await this.viewTransition(contentUrl);
      }
    }

    contentUrlFromLocation(url) {
      const matchedRoute = this.routes.find(
        ({ href }) => url == new URL(href, document.baseURI),
      );
      if (matchedRoute) {
        let contentUrl = new URL(matchedRoute.content, document.baseURI).toString();
        return contentUrl
      }
    }

    async navigate(event) {
      event.preventDefault();
      const { href } = event.target;
      if (href == document.location.toString()) return;
      const contentUrl = this.contentUrlFromLocation(href);
      if (!contentUrl) return;
      history.pushState({}, "", href);
      await this.viewTransition(contentUrl);
    }

    async viewTransition(contentUrl) {
      if (!document.startViewTransition) return await this.updateContent(contentUrl);
      let last = sessionStorage.getItem('lastVisit')
      if(this.debug) console.log('Setting', last);
      this.contentElement.innerHTML = last;
      const transition = document.startViewTransition(async () => {
        await this.updateContent(contentUrl);
      });

      await transition.finished;

    }

    async updateContent(url) {
      const { contentElement } = this;
      if (!contentElement) return;

      return new Promise(async (keep, drop) => {
        try {
          if (sessionStorage.getItem(url)) {
            //setTimeout(() => {
              contentElement.innerHTML = //this.contentMap.get(url);
                sessionStorage.getItem(url);
                keep()
             //}, /* notice, no timeout here */)
          } else {
            const response = await fetch(url);
            const text = await response.text();
            //this.contentMap.set(url, text);
            sessionStorage.setItem(url, text);
            contentElement.innerHTML = text;
            //localStorage.setItem('contentMap', JSON.stringify(Array.from(this.contentMap.entries())));
            keep()
          }
          for (const navlink of this.navlinks.values()) navlink.setAriaCurrent();
        } catch (error) {
          console.error(error);
          drop(error);
        }
      })
    }
  }

  defineComponent("ghp-router", GHPRouter);

  /* rewrite as contextRequestPattern */

  function findParentRouter(initialElement) {
    /*let { parentElement: element } = initialElement;
    while (element) {
      if (element.localName == "ghp-router") return element;
      element = element.parentElement;
    }
    throw new Error(`No ghp-router found for element ${initialElement}`);*/
    return window.GHPRouter;
  }

  class GHPRoute extends HTMLElement {
    router = void 0;

    async connectedCallback() {
      try {
        this.router = findParentRouter(this);
      } catch (error) {
        console.error(error);
        return;
      }
      const href = this.getAttribute("href");
      const content = this.getAttribute("content");
      if (!href || !content) {
        console.error("Missing href or content attribute");
        return;
      }

      this.router.routes.push({ href, content });

      if (new URL(href, document.baseURI).toString() == location.toString()) {
        //window.addEventListener("load", async () => {
          if(this.router.debug) console.log('Called viewTransition from route')
          await this.router.viewTransition(
            new URL(content, document.baseURI).toString(),
          );
       // })
      }

      let contentUrl = new URL(content, document.baseURI).toString()
      this.backgroundFetch(contentUrl);

    }

    /* not really background fetch-> needs worker */

    backgroundFetch(contentUrl) {
      // if not cached and not on root
      if(!sessionStorage.getItem(contentUrl) && location.pathname !== '/') {
      fetch(contentUrl)
        .then(response => {
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          return response.text();
        })
        .then(data => {
          // Store the fetched data
          sessionStorage.setItem(contentUrl, data)
          if(this.router.debug) console.log('Prefetched content:', contentUrl, data);
        })
        .catch(error => {
          if(this.router.debug) console.error('Fetch error:', error);
        });
      }
    }
  }

  defineComponent("ghp-route", GHPRoute);

  class GHPLink extends HTMLElement {

    router = void 0;

    connectedCallback() {
      try {
        this.router = findParentRouter(this);
      } catch (error) {
        console.error(error);
      }
      this.anchor?.addEventListener("click", this);
    }

    get anchor() {
      return this.querySelector("a");
    }

    async handleEvent(event) {
      if (event.type == "click" && event.target == this.anchor)
        await this.router?.navigate(event);
    }
  }

  defineComponent("ghp-link", GHPLink);

  class GHPNavlink extends HTMLElement {
    router = void 0;

    connectedCallback() {
      try {
        this.router = findParentRouter(this);
      } catch (error) {
        console.error(error);
      }
      this.anchor?.addEventListener("click", this);
      this.setAriaCurrent();
      this.router?.navlinks.add(this);
      if(new URL(this.anchor?.href, document.baseURI).toString() == location.toString()) {
        this.classList.add('active');
        this.anchor.focus();
      }
    }

    disconnectedCallback() {
      this.router?.navlinks.delete(this);
    }

    get anchor() {
      return this.querySelector("a");
    }

    async handleEvent(event) {
      if (event.type == "click" && event.target == this.anchor)
        await this.router?.navigate(event);
    }

    setAriaCurrent() {
      const { anchor } = this;
      if (!anchor) return;
      if (anchor.href == document.location.toString()) {
        anchor.setAttribute("aria-current", "page");
      } else {
        anchor.setAttribute("aria-current", "");
      }
    }
  }

  defineComponent("ghp-navlink", GHPNavlink);

})();