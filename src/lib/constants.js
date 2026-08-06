// URL Constants for deployment - supports both GitHub Pages and standalone domains
export const DEPLOYMENT_CONFIG = {
  // Deployment type configuration
  // Set to 'github-pages' for GitHub Pages deployment or 'standalone' for custom domain
  DEPLOYMENT_TYPE: "github-pages", // Change this to 'standalone' for custom domain

  // GitHub Pages specific settings (only used when DEPLOYMENT_TYPE is 'github-pages')
  REPO_NAME: "private-chat",
  GITHUB_USERNAME: "encryptioner",

  // Standalone domain settings (only used when DEPLOYMENT_TYPE is 'standalone')
  STANDALONE_DOMAIN: "https://example.com", // Change this to your custom domain

  // Helper method to detect environment
  _isLocalDevelopment() {
    if (typeof window !== "undefined") {
      return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    }
    return import.meta.env.DEV;
  },

  // Helper method to detect if running on GitHub Pages
  _isGitHubPages() {
    if (typeof window !== "undefined") {
      return window.location.hostname.endsWith(".github.io");
    }
    return false;
  },

  // Get the base URL dynamically
  get BASE_URL() {
    if (this._isLocalDevelopment()) {
      return "/";
    }

    // Auto-detect GitHub Pages vs standalone domain
    if (this._isGitHubPages() || this.DEPLOYMENT_TYPE === "github-pages") {
      return `/${this.REPO_NAME}/`;
    } else {
      // Standalone domain - use root path
      return "/";
    }
  },

  get CHAT_APP_URL() {
    if (this._isLocalDevelopment()) {
      return typeof window !== "undefined" ? `${window.location.origin}/` : "http://localhost:5173/";
    }

    // Auto-detect GitHub Pages vs standalone domain
    if (this._isGitHubPages() || this.DEPLOYMENT_TYPE === "github-pages") {
      return `https://${this.GITHUB_USERNAME}.github.io/${this.REPO_NAME}/`;
    } else {
      // Standalone domain
      if (typeof window !== "undefined") {
        return `${window.location.origin}/`;
      } else {
        return this.STANDALONE_DOMAIN.endsWith("/") ? this.STANDALONE_DOMAIN : `${this.STANDALONE_DOMAIN}/`;
      }
    }
  },

  get EMBED_SCRIPT_URL() {
    if (this._isLocalDevelopment()) {
      return typeof window !== "undefined" ? `${window.location.origin}/embed.js` : "http://localhost:5173/embed.js";
    }

    // Auto-detect GitHub Pages vs standalone domain
    if (this._isGitHubPages() || this.DEPLOYMENT_TYPE === "github-pages") {
      return `https://${this.GITHUB_USERNAME}.github.io/${this.REPO_NAME}/embed.js`;
    } else {
      // Standalone domain
      if (typeof window !== "undefined") {
        return `${window.location.origin}/embed.js`;
      } else {
        const domain = this.STANDALONE_DOMAIN.endsWith("/")
          ? this.STANDALONE_DOMAIN.slice(0, -1)
          : this.STANDALONE_DOMAIN;
        return `${domain}/embed.js`;
      }
    }
  },
};

// Export individual constants for convenience
export const BASE_URL = DEPLOYMENT_CONFIG.BASE_URL;
export const CHAT_APP_URL = DEPLOYMENT_CONFIG.CHAT_APP_URL;
export const EMBED_SCRIPT_URL = DEPLOYMENT_CONFIG.EMBED_SCRIPT_URL;

// DOM IDs used by embed.ts — shared so callers (portfolio-template useAIChat)
// can reference the same IDs without magic strings.
export const EMBED_SCRIPT_ID = "aiChatEmbedScript";
export const EMBED_DIV_ID = "ai-chat-embed-div";
export const EMBED_FLOATING_ID = "ai-chat-floating-widget";

// Placeholder shown in an assistant message while its first token is pending,
// AND the blank-reply sentinel checked in the generation path. Shared so the
// render (MessageItem) and the logic (App stream/guard) can't drift apart.
export const ELLIPSIS = "...";

// localStorage namespace for embed.ts (host context). One prefix → every key is
// derived, no scattered "private-chat:" storage literals. (postMessage `type`
// fields like "private-chat:sections" are a separate cross-frame protocol, not
// storage — they stay inline.)
export const STORAGE_PREFIX = "private-chat";

// Key-name suffixes appended to STORAGE_PREFIX (":"-joined). Add a new key here,
// build it via storageKey() — never hand-write a "private-chat:..." literal.
export const STORAGE_KEYS = {
  PRELOAD_OPT_OUT: "no-preload", // site-scoped (origin+repo) OR bare-origin blanket
};

/**
 * Builds a scoped localStorage key: `${STORAGE_PREFIX}:${name}`, with an optional
 * trailing scope segment (e.g. hostSiteKey()) → `${PREFIX}:${name}:${scope}`.
 * Use for every read/write so the prefix + shape live in one place.
 */
export function storageKey(name, scope) {
  return scope ? `${STORAGE_PREFIX}:${name}:${scope}` : `${STORAGE_PREFIX}:${name}`;
}

/**
 * The "site" the widget is embedded on — the right granularity for per-site
 * localStorage (e.g. the preload opt-out). GitHub Pages hosts MANY independent
 * repos under ONE origin (encryptioner.github.io), so origin alone is too coarse
 * (an opt-out muting unrelated repos) and origin + full pathname is too fine
 * (/repo/guideline ≠ /repo/changelog). The repo = the first path segment = the
 * real site boundary there; custom domains and localhost have nothing below the
 * origin, so origin alone is the site. embed.ts runs HOST-side, so window.location
 * is always the host page (never the iframe) — no referrer/scraper heuristics
 * needed.
 */
export function hostSiteKey() {
  const { origin, hostname, pathname } = window.location;
  const firstSeg = pathname.split("/").filter(Boolean)[0];
  if (hostname.endsWith(".github.io") && firstSeg) return `${origin}/${firstSeg}`;
  return origin;
}

// --- RAG (site-aware retrieval) tunables ---
// Local dev serves the embedder GGUF same-origin (COEP-safe); prod streams it
// from the HF CDN (CORS *, no COEP on GitHub Pages). Mirrors the LFM2 host
// switch in wllama.js.
const isLocalHost = () =>
  typeof window !== "undefined" && ["localhost", "0.0.0.0", "127.0.0.1"].includes(window.location.hostname);

export const RAG = {
  get EMBEDDER_URL() {
    return isLocalHost()
      ? `${window.location.origin}/models/bge-small-en-v1.5-q8_0.gguf`
      : "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf";
  },
  // wllama 3.x: pooling_type is the llama.cpp enum STRING (not 'mean').
  EMBEDDER_OPTIONS: {
    embeddings: true,
    pooling_type: "LLAMA_POOLING_TYPE_MEAN",
    n_ctx: 512,
    n_batch: 512,
    n_ubatch: 512,
    n_threads: 1, // matches prod (GitHub Pages = single-thread)
  },
  MIN_SCORE: 0.25, // bge-small cosine floor; tune after real-model smoke
  TOP_K: 4,
  CHUNK_MAX_WORDS: 220,
  IDB_NAME: "private-chat-rag",
  IDB_STORE: "page-index",
  QUERY_PREFIX: "Represent this sentence for searching relevant passages: ",
};
