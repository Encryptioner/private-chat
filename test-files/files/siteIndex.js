// src/lib/siteIndex.js
// Loads the offline-built site-index.json (from build_site_index.py) and merges
// it with the live per-page index from embeddings.js, giving the bot awareness
// of the whole site, not just the current page, at near-zero runtime cost.

let staticIndexPromise = null;

/**
 * Resolves which site-index.json to load. Priority:
 * 1. Explicit argument passed in code
 * 2. window.PRIVATE_CHAT_CONFIG.siteIndexUrl set by the host page (recommended
 *    for multi-project setups, each repo sets its own before loading embed.js)
 * 3. Fallback: /site-index.json at the current directory root
 */
function resolveIndexUrl(explicitUrl) {
  if (explicitUrl) return explicitUrl;
  if (typeof window !== "undefined" && window.PRIVATE_CHAT_CONFIG?.siteIndexUrl) {
    return window.PRIVATE_CHAT_CONFIG.siteIndexUrl;
  }
  return "/site-index.json";
}

/**
 * Fetches site-index.json once per session and caches it in memory.
 * If the file has precomputed vectors (built with --embed), no client-side
 * embedding is needed for this data at all.
 */
export async function loadStaticSiteIndex(indexUrl) {
  indexUrl = resolveIndexUrl(indexUrl);
  if (!staticIndexPromise) {
    staticIndexPromise = fetch(indexUrl)
      .then((res) => (res.ok ? res.json() : { chunks: [] }))
      .then((data) => data.chunks || [])
      .catch(() => []); // Missing file is fine, site owner just hasn't run the crawler yet
  }
  return staticIndexPromise;
}

/**
 * Combines the live current-page index (always fresh, always embedded client-side)
 * with the static cross-page index (precomputed, loaded once). De-dupes by anchor+url
 * so the current page's live version wins over any stale static copy of itself.
 */
export async function getCombinedIndex(livePageVectors, indexUrl) {
  const staticChunks = await loadStaticSiteIndex(indexUrl);
  const seen = new Set(livePageVectors.map((v) => v.url));
  const staticOnly = staticChunks.filter((c) => c.vector && !seen.has(c.url));
  return [...livePageVectors, ...staticOnly];
}
