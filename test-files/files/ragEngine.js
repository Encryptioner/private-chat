// src/lib/ragEngine.js
// Ties scraping + embeddings + prompt construction + section-link parsing together.

import { scrapeCurrentPage, chunkSections } from "./scraper";
import { buildIndex, retrieveRelevant } from "./embeddings";
import { getCombinedIndex } from "./siteIndex";
import { CHAT_ROLE } from "./wllama";

let currentIndex = null; // live page vectors + merged static site-wide vectors

/**
 * Call once when the chat widget opens, or on page navigation.
 * @param {string} [siteIndexUrl] optional explicit override; otherwise reads
 *   window.PRIVATE_CHAT_CONFIG.siteIndexUrl, set by each host project before
 *   loading embed.js, so the same embed.js works unmodified across all sites.
 */
export async function initPageIndex(siteIndexUrl) {
  const sections = scrapeCurrentPage();
  const chunks = chunkSections(sections);
  const liveVectors = await buildIndex(chunks);
  currentIndex = await getCombinedIndex(liveVectors, siteIndexUrl); // falls back to /site-index.json if no config set
  return currentIndex.length;
}

const SYSTEM_INSTRUCTIONS = `You are a helpful assistant embedded on this website.
Answer ONLY using the CONTEXT provided below. If the answer isn't in the context, say you don't have that information.
When your answer relates to a specific part of the page, end your reply with a pointer in this exact format:
[[section: <anchor> | <short label>]]
Use the anchor EXACTLY as shown in the context brackets, e.g. [anchor: pricing]. Include only one pointer, and only if it is genuinely useful. Do not invent anchors.`;

function buildSystemMessage(relevantChunks) {
  // FIX: surface each chunk's url so the model has page context for cross-page
  // reasoning. It still emits ONLY an anchor (reliable for small models); the
  // UI resolves the real url from the retrieved sources, not from the model.
  const context = relevantChunks
    .map((c, i) => `(${i + 1}) [anchor: ${c.anchor}] (${c.url}) ${c.text}`)
    .join("\n\n");
  return `${SYSTEM_INSTRUCTIONS}\n\nCONTEXT:\n${context}`;
}

/**
 * Builds the messages array to feed into wllama's createChatCompletion.
 * Keeps token usage small: only top-k chunks go in, never the whole page.
 */
export async function buildGroundedMessages(userQuestion, priorMessages = []) {
  if (!currentIndex) await initPageIndex();

  const relevant = await retrieveRelevant(userQuestion, currentIndex, 4);
  const systemMessage = { role: CHAT_ROLE.system, content: buildSystemMessage(relevant) };

  return {
    messages: [systemMessage, ...priorMessages, { role: CHAT_ROLE.user, content: userQuestion }],
    sources: relevant, // pass to extractSectionPointer so it can resolve the real url
  };
}

/**
 * Parses a model reply for a [[section: anchor | label]] marker, strips it from
 * the visible text, and resolves the REAL url from retrieved sources by anchor.
 * The model only emits the anchor; the reliable page+anchor url comes from
 * retrieval. Returns pointer: null if the anchor isn't found in sources.
 */
export function extractSectionPointer(replyText, sources = []) {
  const match = replyText.match(/\[\[section:\s*([^\|\]]+)\s*\|\s*([^\]]+)\]\]/);
  if (!match) return { text: replyText.trim(), pointer: null };

  const [full, anchorRaw, labelRaw] = match;
  const anchor = anchorRaw.trim();
  const label = labelRaw.trim();
  const cleanText = replyText.replace(full, "").trim();

  const source = sources.find((s) => s.anchor === anchor);
  return {
    text: cleanText,
    pointer: source ? { anchor, label, url: source.url } : null,
  };
}

/**
 * Navigate the HOST (parent) page to a section. Same-page → smooth scroll +
 * highlight; cross-page (url on a different path) → navigate the parent there.
 * Call when the user taps the "Go to section" button.
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
      el.style.outline = "2px solid #2dd4bf";
      setTimeout(() => (el.style.outline = ""), 1500);
      return;
    }
  }

  if (url) targetWin.location.href = url; // cross-page navigation on the host
}
