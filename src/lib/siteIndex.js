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
let staticIndexFetchedAt = 0;
// Re-fetch after 30 minutes so host redeploys of site-index.json are picked up.
const CACHE_TTL_MS = 30 * 60 * 1000;

/**
 * Resolves which site-index.json to load. Priority:
 * 1. Explicit argument (the `siteIndexUrl` query param App read from the iframe URL)
 * 2. Fallback: /site-index.json at the current origin root
 */
function resolveIndexUrl(explicitUrl) {
  return explicitUrl || "/site-index.json";
}

/**
 * Fetches site-index.json and caches the promise with a TTL. A missing file or
 * fetch failure → [] (the host just hasn't run the phase-2 crawler).
 */
export async function loadStaticSiteIndex(indexUrl) {
  const url = resolveIndexUrl(indexUrl);
  if (!staticIndexPromise || Date.now() - staticIndexFetchedAt > CACHE_TTL_MS) {
    staticIndexPromise = fetch(url)
      .then((res) => (res.ok ? res.json() : { chunks: [] }))
      .then((data) => data.chunks || [])
      .catch(() => []);
    staticIndexFetchedAt = Date.now();
  }
  return staticIndexPromise;
}

/**
 * Pure de-duping merge of the live current-page vectors with the (already-
 * embedded) static cross-page vectors. Live wins on url collision. No fetch, no
 * embedding — the caller (ragEngine) loads + embeds the static chunks first via
 * loadStaticSiteIndex + embedStaticChunks. Static chunks may carry precomputed
 * `vec` or be embedded at runtime; both work (the vec filter moved to the embed
 * step — a vec-less chunk never reaches here).
 */
export function combineIndexes(liveVectors, staticVectors) {
  const seen = new Set((liveVectors || []).map((v) => v.url));
  const staticOnly = (staticVectors || []).filter((c) => !seen.has(c.url));
  return [...(liveVectors || []), ...staticOnly];
}

// Test-only: reset the module-level fetch memo between unit tests.
export function _resetStaticIndexCache() {
  staticIndexPromise = null;
}
