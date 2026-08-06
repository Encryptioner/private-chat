// src/lib/preIndex.js
// Pure decision for PRIVATE_CHAT_CONFIG.preIndex warming. Kept separate from
// App.jsx so every arrival-order × model-cache scenario is unit-testable without
// rendering React.
//
// preIndex fires the moment its prerequisites are met, regardless of which
// arrived first — App.jsx calls maybePreIndex from up to THREE triggers (host
// sections landing, the chat model becoming ready, and for numeric mode a timer),
// so the LAST condition to arrive is what fires it. The in-flight dedup in
// ragEngine.initPageIndex makes the inevitable double-call safe — one build.
//
// Modes:
//   null / omitted → never pre-index (first question builds it, on demand).
//   "on-open"      → fire as soon as host sections arrive. Ignores the chat
//                    model entirely (indexing uses its OWN embedder, not the
//                    chat model). Best when you want indexing regardless of
//                    model state — e.g. the model is already cached.
//   "after-model"  → fire once the chat model is ready. NOTE: a CACHED chat
//                    model flips isReady near-instantly (no fresh download), so
//                    this still fires — `isReady === true` covers both fresh and
//                    cached. Sequences the embedder after a fresh chat download
//                    to avoid two big downloads at once.
//   <number>       → fire N seconds AFTER the chat model is ready (the timer is
//                    armed on isReady, so indexing never competes with the model
//                    download). numericFired is set when that timer elapses.
//                    Primarily for background warming alongside preloadModel.
//
// @param {string|null|undefined|number} mode
// @param {boolean} hasSections   host page sections have arrived (from embed.ts)
// @param {boolean} isReady       chat model loaded (fresh download OR cache hit)
// @param {boolean} numericFired  the numeric-delay timer has elapsed (number mode)
// @returns {boolean}
export function shouldPreIndex(mode, hasSections, isReady, numericFired) {
  if (!mode || !hasSections) return false;
  if (mode === "on-open") return true;
  if (mode === "after-model") return isReady; // cached model → isReady already true → fires
  if (typeof mode === "number") return numericFired;
  return false; // unknown mode → first-question path handles it
}
