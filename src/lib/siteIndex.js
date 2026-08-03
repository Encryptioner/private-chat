// src/lib/siteIndex.js
// Optional static site-wide index (site-index.json) merged with the live
// current-page vectors. The static index is phase-2 (no crawler ships in v1),
// but the contract is complete: a host that provides PRIVATE_CHAT_CONFIG.siteIndexUrl
// (forwarded host→iframe as a query param by embed.ts) gets cross-page awareness
// for free. A missing file → [] (silent).
//
// m3: the resolver takes an EXPLICIT url arg (the query param App read), NOT a
// window.PRIVATE_CHAT_CONFIG read — the iframe can't see the host window
// cross-origin. embed.ts is the only host-context code.

let staticIndexPromise = null;

/**
 * Resolves which site-index.json to load. Priority:
 * 1. Explicit argument (the `siteIndexUrl` query param App read from the iframe URL)
 * 2. Fallback: /site-index.json at the current origin root
 */
function resolveIndexUrl(explicitUrl) {
  return explicitUrl || "/site-index.json";
}

/**
 * Fetches site-index.json once per session and caches the promise. A missing
 * file or fetch failure → [] (the host just hasn't run the phase-2 crawler).
 */
export async function loadStaticSiteIndex(indexUrl) {
  const url = resolveIndexUrl(indexUrl);
  if (!staticIndexPromise) {
    staticIndexPromise = fetch(url)
      .then((res) => (res.ok ? res.json() : { chunks: [] }))
      .then((data) => data.chunks || [])
      .catch(() => []);
  }
  return staticIndexPromise;
}

/**
 * Combines live current-page vectors (always fresh, embedded client-side) with
 * the static cross-page index (precomputed). De-dupes by url so the live page's
 * own vectors win over any stale static copy of itself.
 */
export async function getCombinedIndex(livePageVectors, indexUrl) {
  const staticChunks = await loadStaticSiteIndex(indexUrl);
  const seen = new Set(livePageVectors.map((v) => v.url));
  const staticOnly = staticChunks.filter((c) => c.vec && !seen.has(c.url));
  return [...livePageVectors, ...staticOnly];
}

// Test-only: reset the module-level fetch memo between unit tests.
export function _resetStaticIndexCache() {
  staticIndexPromise = null;
}
