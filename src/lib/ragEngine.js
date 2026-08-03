// src/lib/ragEngine.js
// Ties scraping + embeddings + grounded prompt construction + host navigation
// together. Owns the live page-index lifecycle (Story 4: one-shot on first
// question; Story 5 re-fires it on host SPA navigation).
//
// MARKERS ARE SHELVED (spec FR-5 Note): the model emits NO [[section:]] pointer.
// "Related sections" links come from retrieveRelevant's top-k, rendered by the
// UI. Small models are unreliable at emitting structured markers; retrieval is
// the robust source. navigateToSection is kept (links still scroll/navigate).

import { scrapeCurrentPage, chunkSections } from "./scraper.js";
import { buildIndex, retrieveRelevant, embedStaticChunks } from "./embeddings.js";
import { loadStaticSiteIndex, combineIndexes } from "./siteIndex.js";
import { RAG } from "./constants.js";

let currentIndex = null; // [{vec, anchor, title, url, text}, ...] live + static merge
let currentIndexVersion = ""; // contentHash; bumped on every initPageIndex (race guard, grill Maj3)

/**
 * Builds the live page index from sections, embeds them, and merges the optional
 * static site-index.json. Idempotent — safe to re-call on host SPA navigation;
 * a cache hit (unchanged contentHash) skips re-embedding. Bumps currentIndexVersion
 * only when content changes, so a concurrent in-flight query detects the swap via
 * version mismatch (grill Maj3).
 *
 * Sections source (precedence):
 *   1. `externalSections` — posted host-side by embed.ts (works cross-origin).
 *   2. fallback: `scrapeCurrentPage()` from inside the iframe (same-origin only).
 *
 * @param {Array} [externalSections] host-side sections from embed.ts postMessage
 * @param {string} [siteIndexUrl] optional static-index URL (query param from embed.ts)
 * @returns {Promise<number>} chunk count
 */
export async function initPageIndex(externalSections, siteIndexUrl) {
  const sections =
    Array.isArray(externalSections) && externalSections.length > 0 ? externalSections : scrapeCurrentPage();
  const chunks = chunkSections(sections, { maxWords: RAG.CHUNK_MAX_WORDS });
  const live = await buildIndex(chunks); // {vectors, version}; cache hit = no model load
  currentIndexVersion = live.version;
  // Cross-page awareness: load the static site-index.json, embed any vec-less
  // chunks with our own embedder (cached by content hash), merge (live wins).
  const staticRaw = await loadStaticSiteIndex(siteIndexUrl);
  const staticVec = await embedStaticChunks(staticRaw);
  currentIndex = combineIndexes(live.vectors, staticVec);
  return currentIndex.length;
}

/** Live index version (contentHash). Caller compares to a captured per-turn
 * version to detect a Story 5 re-scrape swap mid-query (grill Maj3). */
export function getCurrentIndexVersion() {
  return currentIndexVersion;
}

export function hasIndex() {
  return !!currentIndex && currentIndex.length > 0;
}

const BASE_INSTRUCTIONS =
  "You are a helpful assistant embedded on this website. Answer ONLY using the CONTEXT provided below. If the answer is not in the context, say you do not have that information about this page. Keep responses concise.";

function buildSystemMessage(relevantChunks) {
  const context = relevantChunks
    .map((c, i) => `(${i + 1}) section "${c.title}" [${c.anchor}] ${c.url}\n${c.text}`)
    .join("\n\n");
  return `${BASE_INSTRUCTIONS}\n\nCONTEXT:\n${context}`;
}

/**
 * Retrieves top-k relevant chunks for a question and builds the grounded system
 * message content. Returns sources separately so the UI renders "Related
 * sections" links WITHOUT the model emitting markers (spec FR-5).
 *
 * Embeds the query each call (cheap: ~33ms per spike Q2). The embedder GGUF
 * loads LAZILY here on first retrieve/init — NOT on widget open (grill Maj2).
 *
 * @param {string} userQuestion
 * @param {Array} [externalSections] host-side sections from embed.ts postMessage
 * @param {string} [siteIndexUrl] optional static-index URL (forwarded by embed.ts)
 * @returns {Promise<{systemContent:string, sources:Array, version:string}>}
 *   systemContent=null when no chunks clear threshold → caller keeps its generic
 *   system message (context-less chat, no links).
 */
export async function buildGroundedContext(userQuestion, externalSections, siteIndexUrl) {
  // (Re)build when there's no index, OR when the index is empty but host sections
  // have since arrived (race: first question fired before embed.ts posted sections
  // → empty cross-origin scrape → now sections are available, so rebuild). Does NOT
  // re-init a legitimately-empty index when no sections exist (all-nav page).
  if (!currentIndex || (currentIndex.length === 0 && externalSections && externalSections.length > 0)) {
    await initPageIndex(externalSections, siteIndexUrl);
  }

  // Snapshot index + version TOGETHER so a concurrent Story 5 re-scrape can't
  // pair a new vector set with an old version (or vice versa). retrieveRelevant
  // scans this stable snapshot; the caller compares the returned version to the
  // live one (grill Maj3).
  const index = currentIndex;
  const version = currentIndexVersion;

  // Degradation hint (grill M1 gap): the page yielded no context (all-nav/footer
  // page, embedder load failed, IDB unavailable). Tell the model instead of letting
  // it hallucinate site info. Distinct from the off-topic case below (index has
  // chunks but none clear threshold → null → generic chat, which is correct).
  if (!index || index.length === 0) {
    return {
      systemContent: `${BASE_INSTRUCTIONS}\n\nThe page context is unavailable; answer generally or say you cannot see this page's content.`,
      sources: [],
      version,
    };
  }

  const relevant = await retrieveRelevant(userQuestion, index, RAG.TOP_K);
  return {
    systemContent: relevant.length ? buildSystemMessage(relevant) : null,
    sources: relevant, // [{anchor,title,url,text,score}] — no vec
    version,
  };
}

/**
 * Navigate the HOST (parent) page to a section.
 *   same-origin parent → smooth scroll + transient highlight (same page), or
 *     navigate the parent (cross-page).
 *   cross-origin parent → ask embed.ts (host context) to scroll/navigate via
 *     postMessage — the iframe can't touch a cross-origin host DOM, but embed.ts
 *     can always reach its own DOM. Falls back to this window if no parent.
 * Called when the visitor clicks a "Related sections" link.
 * @param {{url?: string, anchor?: string}} pointer
 */
export function navigateToSection({ url, anchor } = {}) {
  if (!url && !anchor) return;

  // Resolve the target. Three cases:
  //  - same-origin parent (real embed): scroll/nav the host directly.
  //  - cross-origin parent: the iframe can't touch the host DOM, so ask embed.ts
  //    (host context) to scroll/nav via postMessage.
  //  - no parent / standalone (window.parent === window): act on this document.
  let sameOriginParent = false;
  let crossOriginParent = false;
  let targetDoc = document;
  let targetWin = window;
  let currentPath = window.location.pathname;
  try {
    if (window.parent && window.parent !== window) {
      targetDoc = window.parent.document; // throws cross-origin
      targetWin = window.parent;
      currentPath = window.parent.location.pathname;
      sameOriginParent = true;
    }
  } catch {
    crossOriginParent = true;
  }

  const scrollIntoView = (doc) => {
    if (!anchor) return false;
    const el = doc.getElementById(anchor);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.style.outline = "2px solid var(--accent-9, #2dd4bf)";
    setTimeout(() => (el.style.outline = ""), 1500);
    return true;
  };

  if (sameOriginParent) {
    const samePage = url ? new URL(url, window.location.href).pathname === currentPath : true;
    if (samePage && scrollIntoView(targetDoc)) return;
    if (url) targetWin.location.href = url; // cross-page navigation on the host
    return;
  }

  if (crossOriginParent) {
    // Ask embed.ts to scroll/navigate the host (it can always reach its own DOM).
    // ponytail: targetOrigin "*" — the iframe can't know the host origin reliably;
    // embed.ts verifies the message source instead.
    try {
      window.parent.postMessage({ type: "private-chat:scroll-to", url, anchor }, "*");
      return;
    } catch {
      /* fall through to own-window handling */
    }
  }

  // Standalone (no parent) or postMessage failed: act on this document.
  if (scrollIntoView(document)) return;
  if (url) window.location.href = url;
}
