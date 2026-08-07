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
      persona?: string;
      // URL to a GGUF file the site owner wants loaded INSTEAD of any built-in
      // model. While set AND downloadable, the iframe HIDES the model picker +
      // GGUF uploader so visitors only ever see this model; if it fails to
      // download (bad URL/CORS/404), the iframe falls back to the built-in
      // default and reveals the standard picker. Forwarded as a query param.
      modelUrl?: string;
      // Stable preset id (e.g. "qwen3-0.6b") to load INSTEAD of the built-in
      // default. Forwarded to the iframe; invalid → iframe falls back to default.
      defaultModel?: string;
      // Seconds to wait, then background-mount the chat iframe so the model
      // downloads BEFORE the visitor opens the chat (instant first open). Only
      // fires on a confirmed good connection (isGoodNetwork); otherwise the
      // widget loads on open as usual. Floating-widget only — inline-div embeds
      // already load on page load. Handled here (iframe mount timing), NOT in
      // the iframe, so this field is intentionally NOT forwarded as a query param.
      preloadModel?: number;
      // When to build the RAG vector index: "on-open" (at iframe mount),
      // "after-model" (once the chat model is ready), or a number = seconds to
      // wait AFTER the model is ready. Omit → first question (current default).
      // True background pre-index only happens when `preloadModel` is also set;
      // otherwise it runs when the chat opens. Forwarded to the iframe, which
      // owns indexing timing.
      preIndex?: "on-open" | "after-model" | number;
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
import { EMBED_SCRIPT_ID, EMBED_DIV_ID, EMBED_FLOATING_ID, STORAGE_KEYS, storageKey, hostSiteKey } from '../lib/constants.js';
import { isGoodNetwork } from '../lib/network.js';

const embedScriptId = EMBED_SCRIPT_ID;
const defaultDivId = EMBED_DIV_ID;
const floatingWidgetId = EMBED_FLOATING_ID;

class EmbedScript {
  private embedQueryParams: URLSearchParams = new URLSearchParams();

  // Floating-button preload badge (fed by the iframe's private-chat:status).
  // Null when there's no floating widget (inline-div embed) → _renderBadge no-ops.
  private chatButton: HTMLButtonElement | null = null;
  private badgeDot: HTMLSpanElement | null = null;
  private badgeTooltip: HTMLDivElement | null = null;
  private badgePhase: "ready" | "loading-model" | "indexing" = "ready";
  private badgeProgress: number | undefined;
  private chatOpen = false;
  
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
    if (config?.persona) iframeUrl.searchParams.set('persona', config.persona);
    if (config?.modelUrl) iframeUrl.searchParams.set('modelUrl', config.modelUrl);
    if (config?.defaultModel) iframeUrl.searchParams.set('defaultModel', config.defaultModel);
    // preIndex is background work too — withhold it when the visitor opted out.
    if (config?.preIndex && !this._userDisabledPreload()) iframeUrl.searchParams.set('preIndex', String(config.preIndex));

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

    // ponytail: no config field is length-capped (persona/modelUrl are free text/URLs a site
    // owner controls) and this URL is a real GET request through GitHub Pages' CDN, which — like
    // most servers/CDNs — caps request-line length (commonly ~8-16KB). 4000 chars is nowhere near
    // that, just an early, loud signal before someone's oversized persona/signed-modelUrl gets
    // anywhere near it. Raise the threshold if it ever fires on a legitimate config.
    const finalUrl = iframeUrl.toString();
    if (finalUrl.length > 4000) {
      console.warn(
        `[private-chat] iframe URL is unusually long (${finalUrl.length} chars) — check persona/modelUrl ` +
          'for an overly long value; very long URLs can be rejected by some hosts/CDNs.'
      );
    }
    iframe.src = finalUrl;
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
        // Reflect the section in the URL, like a real anchor-link click would —
        // pushState (not location.hash) so it doesn't ALSO trigger the browser's
        // own instant hash-jump on top of the smooth scroll just done above.
        history.pushState(null, '', '#' + anchor);
        return;
      }
    }
    // The anchor isn't on the page currently being viewed — it's a different
    // page (or an entirely different domain). Open it in a new tab instead of
    // navigating this one away, which would reload the host (and this iframe,
    // and the chat conversation, with it).
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  }

  // Visitor opt-out of background preloading — their browser, their data/battery.
  // Checked on the HOST page (embed.ts runs here, so window.location is the host).
  // Site-scoped, not per-page and not per-origin: on GitHub Pages several repos
  // share one origin, so per-origin would mute unrelated repos and per-page
  // (origin+pathname) would force a re-opt-out between /repo/guideline and
  // /repo/changelog. hostSiteKey() = origin+repo there (the real site boundary),
  // bare origin elsewhere. The bare `${STORAGE_PREFIX}:no-preload` is a convenient
  // origin-wide blanket override. Either set to "true" in localStorage → skip model
  // preload AND don't forward preIndex (no background indexing either).
  private _userDisabledPreload(): boolean {
    try {
      const optOut = STORAGE_KEYS.PRELOAD_OPT_OUT;
      if (localStorage.getItem(storageKey(optOut, hostSiteKey())) === "true") return true; // site-scoped
      if (localStorage.getItem(storageKey(optOut)) === "true") return true; // origin-wide blanket
    } catch {
      // localStorage unavailable (private mode / disabled) → respect the default.
    }
    return false;
  }

  private _badgeTooltipText(): string {
    if (this.badgePhase === "loading-model") {
      return typeof this.badgeProgress === "number"
        ? `Loading AI model · ${this.badgeProgress}%`
        : "Loading AI model…";
    }
    if (this.badgePhase === "indexing") return "Indexing this page…";
    return "Preparing…";
  }

  // Status from the iframe (App.jsx) → drive the floating-button badge + tooltip.
  private _setStatus(phase: "ready" | "loading-model" | "indexing", progress?: number): void {
    this.badgePhase = phase;
    this.badgeProgress = progress;
    this._renderBadge();
  }

  // Subtle pulsing dot while background prep runs and the chat is closed. Once the
  // chat opens, the in-chat loader takes over — hide the badge so the two never
  // compete for attention.
  private _renderBadge(): void {
    if (!this.chatButton) return; // inline-div embed (no floating button)
    const active = this.badgePhase !== "ready" && !this.chatOpen;
    if (this.badgeDot) this.badgeDot.style.display = active ? "block" : "none";
    if (this.badgeTooltip && active) this.badgeTooltip.textContent = this._badgeTooltipText();
  }

  private _showTooltip(): void {
    if (!this.badgeTooltip || this.badgePhase === "ready") return;
    this.badgeTooltip.textContent = this._badgeTooltipText();
    this.badgeTooltip.style.opacity = "1";
    this.badgeTooltip.style.transform = "translateY(0)";
  }

  private _hideTooltip(): void {
    if (!this.badgeTooltip) return;
    this.badgeTooltip.style.opacity = "0";
    this.badgeTooltip.style.transform = "translateY(4px)";
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
      const data = event.data as {
        type?: string;
        url?: string;
        anchor?: string;
        phase?: "ready" | "loading-model" | "indexing";
        progress?: number;
      } | null;
      if (!data || typeof data !== "object") return;
      if (data.type === "private-chat:ready") {
        void send(); // React app mounted its listener — deliver sections
      } else if (data.type === "private-chat:scroll-to") {
        this._scrollHost(data.url, data.anchor); // cross-origin link click
      } else if (data.type === "private-chat:status") {
        this._setStatus(data.phase ?? "ready", data.progress); // preload badge
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

  // Dark-mode + small-screen overrides for the widget chrome. Inline styles
  // can't respond to @media, so the handful of rules that need to (colors that
  // must follow prefers-color-scheme, fullscreen-on-mobile) live in one
  // injected <style> tag instead of everything being inline.
  _injectWidgetStyles(): void {
    const styleId = 'private-chat-widget-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      @media (prefers-color-scheme: dark) {
        #ai-chat-container-wrapper { background: #1f2937 !important; border-color: #374151 !important; }
        #ai-chat-container-wrapper .pc-chat-header { background: #111827 !important; border-color: #374151 !important; }
        #ai-chat-container-wrapper .pc-chat-title { color: #e5e7eb !important; }
        #ai-chat-container-wrapper .pc-icon-btn { color: #9ca3af !important; }
        #ai-chat-container-wrapper .pc-icon-btn:hover { background: #374151 !important; color: #e5e7eb !important; }
      }
      @media (max-width: 480px) {
        #ai-chat-container-wrapper {
          position: fixed !important;
          inset: 0 !important;
          width: 100vw !important;
          height: 100dvh !important;
          max-width: none !important;
          max-height: none !important;
          border-radius: 0 !important;
          bottom: auto !important;
          right: auto !important;
        }
      }
      #ai-chat-floating-widget .pc-badge-dot {
        animation: pc-badge-pulse 1.4s ease-in-out infinite;
      }
      @keyframes pc-badge-pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(45, 212, 191, 0.55); }
        50% { box-shadow: 0 0 0 6px rgba(45, 212, 191, 0); }
      }
    `;
    document.head.appendChild(style);
  }

  // Create floating chat widget with toggle functionality
  _createFloatingWidget(): HTMLDivElement {
    this._injectWidgetStyles();

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
    chatButton.setAttribute('aria-label', 'Open AI chat assistant');
    chatButton.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
      </svg>
    `;
    chatButton.style.cssText = `
      position: relative;
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

    // Preload badge: a subtle pulsing dot (top-right) shown while the iframe is
    // background-preparing the model/index AND the chat is closed. Hidden once the
    // chat opens (the in-chat loader takes over). Fed by _setStatus.
    const badgeDot = document.createElement('span');
    badgeDot.className = 'pc-badge-dot';
    badgeDot.style.cssText = `
      position: absolute;
      top: 2px;
      right: 2px;
      width: 12px;
      height: 12px;
      background: #2dd4bf;
      border: 2px solid #ffffff;
      border-radius: 50%;
      display: none;
      pointer-events: none;
    `;
    chatButton.appendChild(badgeDot);

    // Hover tooltip explaining what's loading (model %, or indexing). Custom
    // (not a title attr) so it's instant + styled; only shown while prepping.
    const badgeTooltip = document.createElement('div');
    badgeTooltip.style.cssText = `
      position: absolute;
      bottom: 66px;
      right: 0;
      background: #111827;
      color: #f9fafb;
      font: 12px/1.4 ${'system-ui, -apple-system, sans-serif'};
      padding: 6px 10px;
      border-radius: 6px;
      white-space: nowrap;
      opacity: 0;
      transform: translateY(4px);
      pointer-events: none;
      transition: opacity 0.15s ease, transform 0.15s ease;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
    `;
    widget.appendChild(badgeTooltip);

    this.chatButton = chatButton;
    this.badgeDot = badgeDot;
    this.badgeTooltip = badgeTooltip;
    this._renderBadge(); // sync any status that arrived before the button existed

    // Add hover effects
    chatButton.onmouseover = () => {
      chatButton.style.background = '#2563eb';
      chatButton.style.transform = 'scale(1.05)';
      chatButton.style.boxShadow = '0 15px 35px rgba(59, 130, 246, 0.4)';
      this._showTooltip();
    };
    chatButton.onmouseleave = () => {
      chatButton.style.background = '#3b82f6';
      chatButton.style.transform = 'scale(1)';
      chatButton.style.boxShadow = '0 10px 25px rgba(59, 130, 246, 0.3)';
      this._hideTooltip();
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
    chatHeader.className = 'pc-chat-header';
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
    chatTitle.className = 'pc-chat-title';
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
    minimizeBtn.className = 'pc-icon-btn';
    minimizeBtn.setAttribute('aria-label', 'Minimize chat');
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
    closeBtn.className = 'pc-icon-btn';
    closeBtn.setAttribute('aria-label', 'Close chat');
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
    // preloadModel timer (see scheduling block below). Held here so showChat can
    // cancel it when the visitor opens before the delayed background mount fires.
    let preloadTimer: ReturnType<typeof setTimeout> | null = null;

    const showChat = async () => {
      chatContainer.style.visibility = 'visible';
      chatContainer.style.opacity = '1';
      chatContainer.style.transform = 'translateY(0) scale(1)';

      // Visitor opened before/while the preload timer was pending — cancel it and
      // mount now (foreground). If the timer already fired (iframe pre-mounted),
      // children.length > 0 and we just reveal the in-progress load — no restart.
      if (preloadTimer) {
        clearTimeout(preloadTimer);
        preloadTimer = null;
      }

      // Load chat app if not already loaded
      if (chatContent.children.length === 0) {
        await this._loadApp('ai-chat-container');
      }

      isOpen = true;
      isMinimized = false;
      this.chatOpen = true; // in-chat loader takes over → hide the badge
      this._renderBadge();
    };

    const hideChat = () => {
      chatContainer.style.opacity = '0';
      chatContainer.style.transform = 'translateY(20px) scale(0.95)';
      setTimeout(() => {
        chatContainer.style.visibility = 'hidden';
      }, 200);

      isOpen = false;
      isMinimized = false;
      this.chatOpen = false;
      this._renderBadge();
    };

    const minimizeChat = () => {
      chatContainer.style.opacity = '0';
      chatContainer.style.transform = 'translateY(20px) scale(0.95)';
      setTimeout(() => {
        chatContainer.style.visibility = 'hidden';
      }, 200);

      isMinimized = true;
      isOpen = false;
      this.chatOpen = false;
      this._renderBadge();
    };

    // Escape closes the widget and returns focus to the toggle button —
    // otherwise keyboard users get stuck tabbing through host content behind it.
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen) {
        hideChat();
        chatButton.focus();
      }
    });

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

    // Background model preload (PRIVATE_CHAT_CONFIG.preloadModel = seconds). Only
    // the floating widget needs it — inline-div embeds already mount + load on
    // page load. After N seconds, AND only on a confirmed good connection, pre-
    // mount the (hidden) iframe so the model downloads in the background and is
    // ready the instant the visitor opens the chat. Opening earlier cancels the
    // timer and mounts in the foreground; opening later just reveals the already-
    // running load at whatever % it reached — no restart (showChat's
    // children-length guard skips re-mounting a pre-mounted iframe).
    const preloadSeconds = window.PRIVATE_CHAT_CONFIG?.preloadModel;
    if (
      typeof preloadSeconds === "number" &&
      preloadSeconds >= 0 &&
      isGoodNetwork() &&
      !this._userDisabledPreload() // visitor opted out of background preloading
    ) {
      preloadTimer = setTimeout(() => {
        preloadTimer = null;
        if (chatContent.children.length === 0) {
          void this._loadApp("ai-chat-container");
        }
      }, preloadSeconds * 1000);
    }

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