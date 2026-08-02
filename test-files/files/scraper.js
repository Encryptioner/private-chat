// src/lib/scraper.js
// Scrapes the CURRENT host page's DOM into anchor-tagged text chunks.
// Runs entirely client-side, no network calls, no backend.
//
// IMPORTANT: the chat app runs inside an iframe (src/scripts/embed.ts). To index
// the HOST page we read window.parent.document when same-origin. Cross-origin
// host pages can't be scraped (SecurityError) — callers fall back to the static
// site-index.json. Live scrape is a same-origin privilege, not a given.

const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NAV", "FOOTER", "NOSCRIPT", "SVG", "IFRAME"]);
const HEADING_TAGS = new Set(["H1", "H2", "H3", "H4", "H5", "H6"]);

// ponytail: same-origin parent only. Cross-origin parent.document read throws;
// live scrape is then disabled and we fall back to the static site index.
// Needs sandbox allow-same-origin (matches src/scripts/embed.ts).
function resolveRootDoc() {
  if (window.parent && window.parent !== window) {
    try {
      void window.parent.document; // throws cross-origin
      return window.parent.document;
    } catch {
      return document;
    }
  }
  return document;
}

/**
 * Walks the DOM and groups visible text under the nearest identifiable anchor
 * (an element with an id, or the nearest heading's generated slug).
 * @param {Element|Document} [rootEl] defaults to the resolved host-page body
 */
export function scrapeCurrentPage(rootEl) {
  const rootDoc = rootEl ? rootEl.ownerDocument : resolveRootDoc();
  const root = rootEl || rootDoc.body;

  const sections = [];
  let currentAnchor = null;
  let currentTitle = rootDoc.title || "Page";
  let buffer = [];

  const flush = () => {
    const text = buffer.join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 20) {
      sections.push({
        anchor: currentAnchor,
        title: currentTitle,
        url: buildUrl(currentAnchor, rootDoc),
        text,
      });
    }
    buffer = [];
  };

  const slugify = (str) =>
    str.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 60);

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent.trim();
      if (t) buffer.push(t);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (SKIP_TAGS.has(node.tagName)) return;
    // ponytail: skip explicitly hidden nodes. Not checking computed display:none
    // (forces per-node reflow); rely on aria-hidden / hidden attrs instead.
    if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return;
    if (node.hasAttribute && node.hasAttribute("hidden")) return;

    const hasId = node.id && node.id.trim().length > 0;
    const isHeading = HEADING_TAGS.has(node.tagName);

    if (hasId || isHeading) {
      flush();
      currentAnchor = hasId ? node.id : slugify(node.textContent);
      if (isHeading) currentTitle = node.textContent.trim().slice(0, 80);
      // FIX (was dead code): heading without an id gets its slug assigned so
      // getElementById(slug) resolves and navigateToSection can scroll to it.
      if (!hasId && currentAnchor) node.id = currentAnchor;
    }

    for (const child of node.childNodes) walk(child);
  };

  walk(root);
  flush();
  return sections;
}

function buildUrl(anchor, doc) {
  const loc = doc.location || window.location;
  const base = loc.origin + loc.pathname;
  return anchor ? `${base}#${anchor}` : base;
}

/**
 * Splits scraped sections into smaller chunks suitable for embedding.
 * Keeps anchor/url/title metadata attached to every chunk.
 */
export function chunkSections(sections, { maxWords = 220 } = {}) {
  const chunks = [];
  for (const section of sections) {
    const words = section.text.split(/\s+/);
    for (let i = 0; i < words.length; i += maxWords) {
      chunks.push({ ...section, text: words.slice(i, i + maxWords).join(" ") });
    }
  }
  return chunks;
}

/** Simple hash to detect when page content has changed, for cache invalidation. */
export function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}
