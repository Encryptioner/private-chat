// src/lib/network.js
// Shared gate for background preloading (PRIVATE_CHAT_CONFIG.preloadModel /
// preIndex). The chat model is ~278MB and the RAG embedder ~35MB — big asks to
// push at a visitor who didn't ask yet. So we only background-download when we
// have a POSITIVE signal of a fast, unmetered connection; otherwise we fall
// back to load-on-open (the visitor chose to open the chat).
//
// Uses the Network Information API (navigator.connection). Safari/iOS do NOT
// implement it → isGoodNetwork() returns false there, so preload never fires on
// Apple browsers. That is the safe call: we never background-download when we
// can't confirm the connection is good.

/**
 * Best-effort "is this a fast, unmetered connection?" check.
 *   saveData true              → false (user opted into data-saver)
 *   effectiveType != "4g"      → false (3g/2g throttled out of bg downloads)
 *   no Network Information API → false (can't confirm → don't preload)
 * Note: wifi reports as effectiveType "4g", so this admits wifi + fast cellular
 * and excludes slow cellular + metered/saver + unknown. Conservative on purpose.
 * @returns {boolean}
 */
export function isGoodNetwork() {
  if (typeof navigator === "undefined") return false;
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (!conn) return false; // unsupported (Safari/iOS) → don't preload
  if (conn.saveData) return false;
  if (conn.effectiveType && conn.effectiveType !== "4g") return false;
  return true;
}
