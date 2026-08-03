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
import { buildIndex, retrieveRelevant } from "./embeddings.js";
import { RAG } from "./constants.js";

let currentIndex = null; // [{vec, anchor, title, url, text}, ...] + static merge (Story 5)
let currentIndexVersion = ""; // contentHash; bumped on every initPageIndex (race guard, grill Maj3)

/**
 * Scrapes + chunks the host page and embeds it into the live index. Called once
 * on the first question (Story 4); Story 5 re-calls it on host navigation.
 * @param {string} [siteIndexUrl] reserved for Story 5's static-index merge
 * @returns {Promise<number>} chunk count
 */
export async function initPageIndex(siteIndexUrl) {
  const sections = scrapeCurrentPage();
  const chunks = chunkSections(sections, { maxWords: RAG.CHUNK_MAX_WORDS });
  const live = await buildIndex(chunks); // {vectors, version}; cache hit = no model load
  currentIndexVersion = live.version;
  // ponytail: Story 4 uses live vectors only. Story 5 merges getCombinedIndex()
  // (static site-index.json) here — siteIndexUrl param reserved for that.
  void siteIndexUrl;
  currentIndex = live.vectors;
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
 * @returns {Promise<{systemContent:string, sources:Array, version:string}>}
 *   systemContent=null when no chunks clear threshold → caller keeps its generic
 *   system message (context-less chat, no links).
 */
export async function buildGroundedContext(userQuestion) {
  if (!currentIndex) await initPageIndex();

  const relevant = await retrieveRelevant(userQuestion, currentIndex, RAG.TOP_K);
  return {
    systemContent: relevant.length ? buildSystemMessage(relevant) : null,
    sources: relevant, // [{anchor,title,url,text,score}] — no vec
    version: currentIndexVersion,
  };
}

/**
 * Navigate the HOST (parent) page to a section. Same-page → smooth scroll +
 * transient outline highlight; cross-path → navigate the parent; cross-origin
 * parent → best-effort this window. Called when the visitor clicks a link.
 * @param {{url?: string, anchor?: string}} pointer
 */
export function navigateToSection({ url, anchor } = {}) {
  if (!url && !anchor) return;

  // ponytail: chat is in an iframe; move the host page. Cross-origin parent
  // READ throws; we fall back to this window. location SET is best-effort.
  let targetWin, targetDoc, currentPath;
  try {
    if (window.parent && window.parent !== window) {
      targetWin = window.parent;
      targetDoc = window.parent.document; // throws cross-origin
      currentPath = window.parent.location.pathname;
    } else {
      throw new Error("no parent");
    }
  } catch {
    targetWin = window;
    targetDoc = document;
    currentPath = window.location.pathname;
  }

  const samePage = url ? new URL(url, window.location.href).pathname === currentPath : true;

  if (samePage && anchor) {
    const el = targetDoc.getElementById(anchor);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.style.outline = "2px solid var(--accent-9, #2dd4bf)";
      setTimeout(() => (el.style.outline = ""), 1500);
      return;
    }
  }

  if (url) targetWin.location.href = url; // cross-page navigation on the host
}
