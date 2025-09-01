declare global {
  interface Window {
    loadChatApp: (elementId: string) => void;
  }
}

const embedScriptId = 'aiChatEmbedScript';
const defaultDivId = 'ai-chat-embed-div';

class EmbedScript {
  async _getPublicPath(): Promise<string | undefined> {
    const scriptElement = document.getElementById(embedScriptId) as HTMLScriptElement | undefined;
    const src = scriptElement?.src;

    if (!src) {
      return undefined;
    }

    try {
      const parsedUrl = new URL(src);
      return parsedUrl.origin;
    } catch (error) {
      console.error(`Invalid src "${src}" for public path. Error: `, error);
      return undefined;
    }
  }

  // Create iframe to load the chat app
  _createIframe(publicPath: string): HTMLIFrameElement {
    const iframe = document.createElement('iframe');
    iframe.src = publicPath;
    iframe.style.width = '100%';
    iframe.style.height = '500px';
    iframe.style.border = '1px solid #e2e8f0';
    iframe.style.borderRadius = '8px';
    iframe.style.backgroundColor = 'white';
    
    // Allow necessary permissions for WebAssembly
    iframe.allow = 'cross-origin-isolated';
    iframe.sandbox = 'allow-scripts allow-same-origin allow-forms';
    
    return iframe;
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
        }, 1 * 1000);
      });

    const hasDefaultDiv = await _waitForDiv(defaultDivId, 10 * 1000);
    if (hasDefaultDiv) {
      this._loadApp(defaultDivId);
    }
  }

  // main function which runs after this embed script loads
  async run(): Promise<void> {
    window.loadChatApp = this._loadApp.bind(this);

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        this._waitForDefaultDivLoad();
      });
      return;
    }

    if (document.getElementById(defaultDivId)) {
      this._loadApp(defaultDivId);
      return;
    }

    this._waitForDefaultDivLoad();
  }
}

const embedScript = new EmbedScript();
embedScript.run();