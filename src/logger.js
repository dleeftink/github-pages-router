(function Logger() {
  function defineComponent(elementName, ElementClass) {
    if (customElements.get(elementName)) return;
    customElements.define(elementName, ElementClass);
  }

 class LogDisplay extends HTMLElement {
    
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
  
      // Default max logs
      this.maxLogs = parseInt(this.getAttribute('max-logs'), 10) || 50;
  
      // Restore logs from sessionStorage
      this.restoreLogsFromStorage();
  
      // Create UI elements
      this.createButton();
      this.createOverlay();
      this.createLogContainer();
  
      // Assemble UI
      this.shadowRoot.appendChild(this.button);
      this.shadowRoot.appendChild(this.overlay);
      this.overlay.appendChild(this.logContainer);
  
      // Initialize event listeners
      this.button.addEventListener('click', () => this.toggleOverlay());
      this.overlay.addEventListener('click', (e) => {
        // Only close overlay if the click was on the backdrop itself
        if (e.target === e.currentTarget) {
          this.toggleOverlay();
        }
      });
    }
  
    /**
     * Creates the floating toggle button
     */
    createButton() {
      this.button = document.createElement('button');
      this.button.textContent = '📝'; // or '[LOG]' for ASCII
      this.button.setAttribute('aria-label', 'Toggle Log Panel');
    
      this.button.style = `
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 10000;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        background: #007bff;
        color: white;
        border: none;
        font-size: 15px;
        cursor: pointer;
        box-shadow: 0 2px 10px rgba(0,0,0,0.2);
    
        /* Flexbox centering */
        display: flex;
        justify-content: center;
        align-items: center;
        padding-right:4px;
         padding-bottom:3px;
    
        /* Optional: prevent text selection */
        user-select: none;
      `;
    }
  
    /**
     * Creates the overlay panel with a backdrop
     */
    createOverlay() {
      this.overlay = document.createElement('div');
      this.overlay.style = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: rgba(0, 0, 0, 0.6);
        display: none;
        justify-content: center;
        align-items: flex-start;
        padding-top: 60px;
        z-index: 9999;
      `;
    }
  
    /**
     * Creates the scrollable log container inside the overlay
     */
    createLogContainer() {
      this.logContainer = document.createElement('div');
      this.logContainer.style = `
        background: #f8f8f8;
        border-radius: 8px;
        width: 90%;
        max-width: 800px;
        max-height: 80vh;
        overflow: auto; 
        padding: 15px;
        box-sizing: border-box;
        font-family: monospace;
        font-size: 0.8rem;
        box-shadow: 0 4px 20px rgba(0,0,0,0.2);
        color: #333;
        white-space: nowrap;
      `;
    }
  
    /**
     * Toggles the overlay visibility
     */
    toggleOverlay() {
      const isVisible = this.overlay.style.display === 'flex';
      this.overlay.style.display = isVisible ? 'none' : 'flex';
      this.button.setAttribute('aria-expanded', !isVisible);
      if (!isVisible) {
        this.render(); // Ensure latest logs are shown
        this.scrollToBottom();
      }
    }
  
    /**
     * Scrolls to the bottom of the log container
     */
    scrollToBottom() {
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
  
    /**
     * Appends a new log message to the display and persists it.
     * @param {string} message - The log message to append
     */
    appendLog(message) {
      const timestamp = new Date().toISOString();
      const fullMessage = `${timestamp} - ${message}`;
      this.logs.push(fullMessage);
  
      if (this.logs.length > this.maxLogs) {
        this.logs.shift(); // Remove oldest
      }
  
      this.saveLogsToStorage();
      this.render();
    }
  
    /**
     * Saves the current logs array to sessionStorage.
     */
    saveLogsToStorage() {
      localStorage.setItem('app-logs', JSON.stringify(this.logs));
    }
  
    /**
     * Restores logs from sessionStorage if available.
     */
    restoreLogsFromStorage() {
      const storedLogs = localStorage.getItem('app-logs');
      this.logs = storedLogs ? JSON.parse(storedLogs) : [];
  
      if (this.logs.length > this.maxLogs) {
        this.logs = this.logs.slice(-this.maxLogs);
      }
    }
  
    /**
     * Re-renders the log container with current logs.
     */
    render() {
      this.logContainer.innerHTML = '';
      this.logs.forEach(log => {
        const entry = document.createElement('div');
        entry.textContent = log;
        entry.style = `
          white-space: nowrap; /* Force log entry to single line */
          padding: 4px 0;
        `;
        this.logContainer.appendChild(entry);
      });
    }
  }
  
  defineComponent("log-display", LogDisplay);

  
})()