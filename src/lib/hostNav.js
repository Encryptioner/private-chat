// src/lib/hostNav.js
// Detects client-side navigation on the HOST page (the SPA that embeds the chat
// iframe) and re-scrapes/re-indexes when it happens (spec FR-9). General — works
// for CRA/Next/Vue, not just portfolio-template.
//
// The chat runs inside an iframe; SPA navigation happens in the PARENT window.
// React Router's default pushState fires neither popstate nor hashchange, so a
// MutationObserver on the parent body is the catch-all; the history events are a
// fast path. All three attach to window.parent — which requires same-origin
// (embed.ts sets sandbox allow-same-origin). Cross-origin parent → the watcher
// never installs (parent.document throws) and we degrade silently.

const DEFAULT_DEBOUNCE_MS = 500;

/**
 * Installs navigation listeners on the same-origin parent window.
 * @param {{onNavigate:()=>void, debounceMs?:number}} opts
 * @returns {() => void} uninstall() — removes all listeners + observer.
 */
export function installHostNavWatcher({ onNavigate, debounceMs = DEFAULT_DEBOUNCE_MS } = {}) {
  if (typeof onNavigate !== "function") return () => {};

  let parentWin;
  let parentDoc;
  try {
    if (!window.parent || window.parent === window) return () => {}; // not embedded
    parentWin = window.parent;
    parentDoc = window.parent.document; // throws cross-origin → no watcher
    void parentDoc.body; // touch to force the throw here if body is inaccessible
  } catch {
    return () => {}; // cross-origin parent: can't observe, degrade silently (FR-1)
  }

  const readPath = () => {
    try {
      return parentWin.location.pathname;
    } catch {
      return null;
    }
  };

  // Fast-path on pathname: only fire when the ROUTE changed. Same-path DOM edits
  // (ads, lazy-load) would otherwise re-scrape every debounce window. Content
  // changes on a new route still dedup via buildIndex's contentHash.
  // ponytail: pathname-gated; a same-route content edit won't refresh — acceptable
  // for v1 (route-awareness is the headline); revisit if same-route staleness bites.
  let lastPath = readPath();
  let timer = null;
  const fire = () => {
    clearTimeout(timer);
    // ponytail: debounce 500ms — a CRA route mount bursts childList mutations;
    // coalescing avoids re-scraping mid-transition. Raise if a heavy SPA thrashes.
    timer = setTimeout(() => {
      const path = readPath();
      if (path && path !== lastPath) {
        lastPath = path;
        try {
          onNavigate();
        } catch {
          /* a throw in the host callback must not kill the watcher */
        }
      }
    }, debounceMs);
  };

  parentWin.addEventListener("popstate", fire);
  parentWin.addEventListener("hashchange", fire);
  // MutationObserver from the PARENT realm, observing the parent body.
  const Observer = parentWin.MutationObserver || window.MutationObserver;
  const observer = Observer ? new Observer(fire) : null;
  if (observer) {
    observer.observe(parentDoc.body, { childList: true, subtree: true });
  }

  return () => {
    clearTimeout(timer);
    parentWin.removeEventListener("popstate", fire);
    parentWin.removeEventListener("hashchange", fire);
    if (observer) observer.disconnect();
  };
}
