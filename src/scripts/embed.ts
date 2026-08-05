declare global {
  interface Window {
    loadChatApp: (elementId: string) => void;
    // Set by the HOST page before embed.js loads (spec FR-6). embed.ts runs in the
    // host context and CAN read this; the cross-origin iframe cannot, so scalar
    // fields (label, siteIndexUrl) are forwarded onto the iframe URL as query params.
    // getSections runs HOST-side and its result is bridged via postMessage — this is
    // how the widget works on cross-origin sites (the iframe can't scrape a
    // cross-origin parent, but embed.ts can always read its own DOM).
    PRIVATE_CHAT_CONFIG?: {
      label?: string;
      siteIndexUrl?: string;
      getSections?: (rootDoc: Document) => ChatSection[] | Promise<ChatSection[]>;
    };
  }
}

// A chunk of host content for the chat to ground on. anchor/title/url are
// optional (omit → grounded answer with no "Related sections" link).
type ChatSection = { anchor?: string; title?: string; url?: string; text: string };

// Host-side scraper (DOM-pure) — bundled into embed.js. Runs in the HOST context
// where the host DOM is always same-origin to itself, so scraping works on ANY
// site (unlike the iframe, which can't read a cross-origin parent).
import { scrapeCurrentPage } from '../lib/scraper.js';
import { EMBED_SCRIPT_ID, EMBED_DIV_ID, EMBED_FLOATING_ID } from '../lib/constants.js';

const embedScriptId = EMBED_SCRIPT_ID;
const defaultDivId = EMBED_DIV_ID;
const floatingWidgetId = EMBED_FLOATING_ID;

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
          return parsedUrl.origin + '/private-chat/';
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

    // Forward the host's PRIVATE_CHAT_CONFIG (label, siteIndexUrl) as query params.
    // embed.ts is the ONLY host-context code; the iframe reads these from its own URL.
    const config = window.PRIVATE_CHAT_CONFIG;
    if (config?.label) iframeUrl.searchParams.set('label', config.label);

    // siteIndexUrl means "site-index.json next to the HOST page" — but the iframe
    // itself is loaded from private-chat's own path (e.g. /private-chat/), a
    // DIFFERENT path under the same origin when the host is a sibling GitHub
    // Pages project site (e.g. /branchdiff-releases/). A relative or root-relative
    // value forwarded as-is would be resolved by the iframe against ITS OWN
    // location, not the host's — silently fetching the wrong file (a sibling
    // project's index, or whatever happens to live at the shared origin root).
    // Resolve it HERE, against the host's own location, while we still can; the
    // iframe then receives an unambiguous absolute URL either way. Default
    // ("site-index.json" next to the current host page) covers the common case
    // with zero config.
    try {
      const siteIndexPath = config?.siteIndexUrl || 'site-index.json';
      iframeUrl.searchParams.set('siteIndexUrl', new URL(siteIndexPath, window.location.href).toString());
    } catch (error) {
      console.warn('[private-chat] Failed to resolve siteIndexUrl:', error);
    }

    iframe.src = iframeUrl.toString();
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.borderRadius = '0';
    iframe.style.backgroundColor = 'white';
    iframe.style.display = 'block';
    
    // Allow necessary permissions for WebAssembly. allow-popups(-to-escape-sandbox)
    // is required for "Related sections" links to a DIFFERENT page/site to open
    // in a new tab (see navigateToSection in ragEngine.js) — without it the
    // sandbox silently blocks window.open() from inside the iframe.
    iframe.allow = 'cross-origin-isolated';
    iframe.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'
    );

    // Bridge host-side sections to the iframe + handle its scroll requests.
    // targetOrigin restricts postMessage to this iframe's origin only.
    this._attachSectionBridge(iframe, iframeUrl.origin);

    return iframe;
  }

  // Sections the chat should ground on. A custom getSections wins; otherwise the
  // default scraper reads the host page. Either way it runs HOST-side, so it works
  // on any origin. Never throws — a failure degrades to [] (context-less chat).
  private async _computeSections(): Promise<ChatSection[]> {
    const custom = window.PRIVATE_CHAT_CONFIG?.getSections;
    try {
      const result = custom ? await custom(document) : scrapeCurrentPage(document.body);
      return Array.isArray(result) ? (result as ChatSection[]) : [];
    } catch (error) {
      console.debug('[private-chat] section scrape failed:', error);
      return [];
    }
  }

  // Scroll/navigate the HOST page on behalf of a (possibly cross-origin) iframe.
  private _scrollHost(url?: string, anchor?: string): void {
    if (anchor) {
      const el = document.getElementById(anchor);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        el.style.outline = '2px solid var(--accent-9, #2dd4bf)';
        setTimeout(() => (el.style.outline = ''), 1500);
        return;
      }
    }
    // The anchor isn't on the page currently being viewed — it's a different
    // page (or an entirely different domain). Open it in a new tab instead of
    // navigating this one away, which would reload the host (and this iframe,
    // and the chat conversation, with it).
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  // Host→iframe section bridge + iframe→host scroll bridge.
  // postMessage works cross-origin, so this is what makes the widget usable on
  // any site (the iframe itself can't scrape a cross-origin parent).
  private _attachSectionBridge(iframe: HTMLIFrameElement, targetOrigin: string): void {
    const send = async () => {
      const sections = await this._computeSections();
      try {
        iframe.contentWindow?.postMessage({ type: 'private-chat:sections', sections }, targetOrigin);
      } catch (error) {
        console.debug('[private-chat] postMessage sections failed:', error);
      }
    };

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return; // only our iframe
      const data = event.data as { type?: string; url?: string; anchor?: string } | null;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'private-chat:ready') {
        void send(); // React app mounted its listener — deliver sections
      } else if (data.type === 'private-chat:scroll-to') {
        this._scrollHost(data.url, data.anchor); // cross-origin link click
      }
    };
    window.addEventListener('message', onMessage);

    // SPA navigation: re-scrape the host (debounced) and re-post. MutationObserver
    // catches pushState (no popstate) and async content loads; the iframe's
    // contentHash cache skips re-embedding when content is unchanged.
    let timer: ReturnType<typeof setTimeout> | null = null;
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void send(), 500);
    };
    window.addEventListener('popstate', debounced);
    window.addEventListener('hashchange', debounced);
    const observer = new MutationObserver(debounced);
    observer.observe(document.body, { childList: true, subtree: true });

    // Best-effort initial send (idempotent with the ready handshake; covers any
    // race where 'ready' was missed).
    iframe.addEventListener('load', () => void send());
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