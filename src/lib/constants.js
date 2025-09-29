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
