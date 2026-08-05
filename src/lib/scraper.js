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
// Heading level for the document-outline stack (hierarchical section titles).
const HEADING_LEVEL = { H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6 };

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

export function slugify(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
}

/**
 * Slugifies baseText into a DOM-unique id. If `rootDoc` already has an element
 * with that id (host page collision), suffixes `-2`, `-3`, … so a later
 * getElementById lands on the RIGHT element (grill M4).
 */
export function uniqueSlug(baseText, rootDoc) {
  const base = slugify(baseText);
  if (!base) return base;
  let slug = base;
  let n = 2;
  while (rootDoc.getElementById(slug)) slug = `${base}-${n++}`;
  return slug;
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
  // Document-outline stack: [{level, text}]. Each section's title is the outline
  // path joined ("H2 — H3"), so subsections carry parent context (hierarchical)
  // instead of a flat/stale nearest-heading title.
  const outline = [];
  const headingTitle = (node) => {
    const level = HEADING_LEVEL[node.tagName];
    const text = node.textContent.trim().replace(/\s+/g, " ");
    if (level) {
      while (outline.length && outline[outline.length - 1].level >= level) outline.pop();
      outline.push({ level, text });
    }
    return outline
      .map((o) => o.text)
      .join(" — ")
      .slice(0, 80);
  };

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

    if (hasId) {
      flush();
      currentAnchor = node.id;
      if (isHeading) currentTitle = headingTitle(node);
    } else if (isHeading) {
      const slug = slugify(node.textContent);
      // If an element already owns this id AND this heading lives INSIDE it, the
      // heading is that section's title — reuse the section's anchor instead of
      // spawning a colliding boundary (grill M4: avoid false collisions).
      const owner = slug ? rootDoc.getElementById(slug) : null;
      if (owner && owner.contains(node)) {
        flush();
        currentAnchor = slug;
        currentTitle = headingTitle(node);
      } else {
        // id-less heading out in the open: assign a collision-free slug so
        // getElementById resolves and navigateToSection can scroll to it.
        // NOTE: this mutates the host DOM (adds an id attribute). The mutation
        // is intentional — it makes headings navigable for "Related sections"
        // links. Host integrators should be aware that running the scraper
        // adds ids to previously id-less heading elements.
        flush();
        currentAnchor = uniqueSlug(node.textContent, rootDoc);
        node.id = currentAnchor;
        currentTitle = headingTitle(node);
      }
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

/**
 * Simple hash to detect when page content has changed, for cache invalidation.
 * ponytail: 32-bit non-crypto djb2-style hash; collision risk on large/diverse
 * pages. Switch to SubtleCrypto SHA-256 if a site exceeds ~10k chunks.
 */
export function hashText(text) {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}
