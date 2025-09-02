declare global {
  interface Window {
    loadChatApp: (elementId: string) => void;
  }
}

const embedScriptId = 'aiChatEmbedScript';
const defaultDivId = 'ai-chat-embed-div';
const floatingWidgetId = 'ai-chat-floating-widget';

class EmbedScript {
  private embedQueryParams: URLSearchParams = new URLSearchParams();
  
  async _getPublicPath(): Promise<string | undefined> {
    const scriptElement = document.getElementById(embedScriptId) as HTMLScriptElement | undefined;
    const src = scriptElement?.src;

    if (!src) {
      return undefined;
    }

    // Extract query parameters from embed script URL
    try {
      const embedUrl = new URL(src);
      this.embedQueryParams = embedUrl.searchParams;
    } catch (error) {
      console.warn('Failed to parse embed script URL for query parameters:', error);
    }

    try {
      const parsedUrl = new URL(src);
      const isDevelopment = parsedUrl.hostname === 'localhost' || parsedUrl.hostname === '127.0.0.1';
      const isGitHubPages = parsedUrl.hostname.endsWith('.github.io');
      
      if (isDevelopment) {
        // Development environment
        return parsedUrl.origin + '/';
      } else if (isGitHubPages) {
        // GitHub Pages deployment - extract repo name from path
        // Expected pattern: https://username.github.io/repo-name/embed.js
        const pathParts = parsedUrl.pathname.split('/').filter(part => part);
        if (pathParts.length >= 1) {
          const repoName = pathParts[0]; // First path segment is repo name
          return `${parsedUrl.origin}/${repoName}/`;
        } else {
          // Fallback for GitHub Pages
          return parsedUrl.origin + '/in-browser-llm-inference/';
        }
      } else {
        // Standalone domain deployment - use origin directly
        // Expected pattern: https://mydomain.com/embed.js
        return parsedUrl.origin + '/';
      }
    } catch (error) {
      console.error(`Invalid src "${src}" for public path. Error: `, error);
      return undefined;
    }
  }

  // Create iframe to load the chat app
  _createIframe(publicPath: string): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    
    // Build iframe URL with query parameters
    const iframeUrl = new URL(publicPath);
    iframeUrl.searchParams.set('embedded', 'true');
    
    // Forward query parameters from embed script to iframe
    for (const [key, value] of this.embedQueryParams.entries()) {
      iframeUrl.searchParams.set(key, value);
    }
    
    iframe.src = iframeUrl.toString();
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '0';
    iframe.style.backgroundColor = 'white';
    iframe.style.display = 'block';
    
    // Allow necessary permissions for WebAssembly
    iframe.allow = 'cross-origin-isolated';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');
    
    return iframe;
  }

  // Create floating chat widget with toggle functionality
  _createFloatingWidget(): HTMLDivElement {
    const widget = document.createElement('div');
    widget.id = floatingWidgetId;
    widget.style.cssText = `
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      font-family: system-ui, -apple-system, sans-serif;
    `;

    // Create chat button
    const chatButton = document.createElement('button');
    chatButton.id = 'ai-chat-toggle-btn';
    chatButton.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
      </svg>
    `;
    chatButton.style.cssText = `
      width: 56px;
      height: 56px;
      background: #3b82f6;
      border: none;
      border-radius: 50%;
      color: white;
      cursor: pointer;
      box-shadow: 0 10px 25px rgba(59, 130, 246, 0.3);
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    `;
    
    // Add hover effects
    chatButton.onmouseover = () => {
      chatButton.style.background = '#2563eb';
      chatButton.style.transform = 'scale(1.05)';
      chatButton.style.boxShadow = '0 15px 35px rgba(59, 130, 246, 0.4)';
    };
    chatButton.onmouseleave = () => {
      chatButton.style.background = '#3b82f6';
      chatButton.style.transform = 'scale(1)';
      chatButton.style.boxShadow = '0 10px 25px rgba(59, 130, 246, 0.3)';
    };

    // Create chat container (initially hidden)
    const chatContainer = document.createElement('div');
    chatContainer.id = 'ai-chat-container-wrapper';
    chatContainer.style.cssText = `
      position: absolute;
      bottom: 70px;
      right: 0;
      width: min(90vw, 1024px);
      height: min(80vh, 700px);
      background: white;
      border-radius: 12px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
      border: 1px solid #e5e7eb;
      overflow: hidden;
      transform: translateY(20px) scale(0.95);
      opacity: 0;
      visibility: hidden;
      transition: all 0.2s ease;
      display: flex;
      flex-direction: column;
    `;

    // Create chat header with controls
    const chatHeader = document.createElement('div');
    chatHeader.style.cssText = `
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 12px 16px;
      background: #f9fafb;
      border-bottom: 1px solid #e5e7eb;
      min-height: 48px;
    `;

    // Chat title
    const chatTitle = document.createElement('div');
    chatTitle.textContent = '🤖 AI Assistant';
    chatTitle.style.cssText = `
      font-weight: 600;
      font-size: 14px;
      color: #374151;
    `;

    // Header controls
    const headerControls = document.createElement('div');
    headerControls.style.cssText = `
      display: flex;
      gap: 8px;
    `;

    // Minimize button
    const minimizeBtn = document.createElement('button');
    minimizeBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 9l6 6 6-6"/>
      </svg>
    `;
    minimizeBtn.style.cssText = `
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      border-radius: 6px;
      color: #6b7280;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.1s ease;
    `;
    minimizeBtn.onmouseover = () => {
      minimizeBtn.style.background = '#e5e7eb';
      minimizeBtn.style.color = '#374151';
    };
    minimizeBtn.onmouseleave = () => {
      minimizeBtn.style.background = 'transparent';
      minimizeBtn.style.color = '#6b7280';
    };

    // Close button  
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M6 18L18 6M6 6l12 12"/>
      </svg>
    `;
    closeBtn.style.cssText = `
      width: 32px;
      height: 32px;
      border: none;
      background: transparent;
      border-radius: 6px;
      color: #6b7280;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.1s ease;
    `;
    closeBtn.onmouseover = () => {
      closeBtn.style.background = '#fee2e2';
      closeBtn.style.color = '#dc2626';
    };
    closeBtn.onmouseleave = () => {
      closeBtn.style.background = 'transparent';
      closeBtn.style.color = '#6b7280';
    };

    // Chat content area
    const chatContent = document.createElement('div');
    chatContent.id = 'ai-chat-container';
    chatContent.style.cssText = `
      flex: 1;
      overflow: hidden;
    `;

    // Assemble header
    headerControls.appendChild(minimizeBtn);
    headerControls.appendChild(closeBtn);
    chatHeader.appendChild(chatTitle);
    chatHeader.appendChild(headerControls);
    
    // Assemble container
    chatContainer.appendChild(chatHeader);
    chatContainer.appendChild(chatContent);

    let isOpen = false;
    let isMinimized = false;
    
    const showChat = async () => {
      chatContainer.style.visibility = 'visible';
      chatContainer.style.opacity = '1';
      chatContainer.style.transform = 'translateY(0) scale(1)';
      
      // Load chat app if not already loaded
      if (chatContent.children.length === 0) {
        await this._loadApp('ai-chat-container');
      }
      
      isOpen = true;
      isMinimized = false;
    };
    
    const hideChat = () => {
      chatContainer.style.opacity = '0';
      chatContainer.style.transform = 'translateY(20px) scale(0.95)';
      setTimeout(() => {
        chatContainer.style.visibility = 'hidden';
      }, 200);
      
      isOpen = false;
      isMinimized = false;
    };
    
    const minimizeChat = () => {
      chatContainer.style.opacity = '0';
      chatContainer.style.transform = 'translateY(20px) scale(0.95)';
      setTimeout(() => {
        chatContainer.style.visibility = 'hidden';
      }, 200);
      
      isMinimized = true;
      isOpen = false;
    };

    // Chat button click handler
    chatButton.onclick = async () => {
      if (!isOpen && !isMinimized) {
        await showChat();
      } else if (isMinimized) {
        await showChat();
      } else {
        hideChat();
      }
    };

    // Minimize button click handler
    minimizeBtn.onclick = (e) => {
      e.stopPropagation();
      minimizeChat();
    };

    // Close button click handler  
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      hideChat();
    };

    widget.appendChild(chatContainer);
    widget.appendChild(chatButton);
    
    return widget;
  }

  // load the app
  async _loadApp(elementId: string): Promise<void> {
    const appElement = document.getElementById(elementId);

    if (!appElement) {
      console.error(`_loadApp -> No element found for id ${elementId}`);
      return;
    }

    const publicPath = await this._getPublicPath();
    if (!publicPath) {
      console.error('No public path found');
      return;
    }

    try {
      // Clear any existing content
      appElement.innerHTML = '';
      
      // Create and append iframe
      const iframe = this._createIframe(publicPath);
      appElement.appendChild(iframe);
    } catch (e) {
      console.error(`Error mounting app in element ${elementId}`, e);
    }
  }

  async _waitForDefaultDivLoad(): Promise<void> {
    const _waitForDiv = (elementId: string, timeoutInMs: number): Promise<boolean> =>
      new Promise((resolve) => {
        const startTime = Date.now();

        const intervalId = setInterval(() => {
          const waitTimeExpired = Date.now() - startTime >= timeoutInMs;

          if (document.getElementById(elementId)) {
            clearInterval(intervalId);
            resolve(true);
          } else if (waitTimeExpired) {
            clearInterval(intervalId);
            resolve(false);
          }
        }, 500);
      });

    const hasDefaultDiv = await _waitForDiv(defaultDivId, 3 * 1000);
    if (hasDefaultDiv) {
      this._loadApp(defaultDivId);
    } else {
      // No default div found, create floating widget
      this._createFloatingChatWidget();
    }
  }

  // Create and append floating chat widget to the page
  _createFloatingChatWidget(): void {
    // Check if floating widget already exists
    if (document.getElementById(floatingWidgetId)) {
      return;
    }

    const widget = this._createFloatingWidget();
    document.body.appendChild(widget);
  }

  // main function which runs after this embed script loads
  async run(): Promise<void> {
    window.loadChatApp = this._loadApp.bind(this);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this._initializeChatWidget();
      });
      return;
    }

    this._initializeChatWidget();
  }

  // Initialize chat widget - either load in default div or create floating widget
  _initializeChatWidget(): void {
    const defaultDiv = document.getElementById(defaultDivId);
    
    if (defaultDiv) {
      // Default div exists, load chat directly
      this._loadApp(defaultDivId);
    } else {
      // No default div, wait a bit then create floating widget
      this._waitForDefaultDivLoad();
    }
  }
}

const embedScript = new EmbedScript();
embedScript.run();