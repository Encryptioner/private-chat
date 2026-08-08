// src/lib/modelLoadError.js
// Classifies a model-load failure so the UI shows the right recovery path instead
// of a one-size-fits-all "Retry" — which loops forever on PERMANENT failures
// (model too large for WebAssembly memory, a corrupt/non-GGUF file). Transient
// failures (network drop, quota) keep Retry; permanent ones point the visitor at
// the model picker (never disabled during an error) or at freeing storage.
//
// Pure function over the raw error: the UI stays dumb, all classification lives
// here (the "pluggable" recovery layer). Add a new category here and every error
// prompt picks it up. See docs/MODEL-LOADING.md.

// Signature → category, tested in order (first match wins). Matched against the
// lowercased `message + name`. Patterns are deliberately broad substrings —
// wllama / ggml / browsers word these failures differently across versions, so
// we prefer distinctive fragments over exact strings.
const TOO_LARGE = [
  "out of memory",
  "unable to allocate", // ggml allocation failure
  "memory access out of bounds", // wasm trap on alloc
  "linear memory", // wasm linear-memory ceiling (~4GB, less in practice)
  "exceeded the memory",
  "allocation failed",
];

const STORAGE = [
  "quotaexceeded", // DOMException.name when origin storage is full
  "storage is full",
  "not enough storage",
  "exceeded the quota",
  "persistent storage",
];

const INVALID = [
  "invalid gguf",
  "not a gguf",
  "magic", // GGUF magic-number mismatch
  "unexpected end of file", // truncated / partial
  "failed to open file", // wllama: "model may be invalid, please refresh"
  "invalid model",
];

const has = (msg, list) => list.some((s) => msg.includes(s));

/**
 * Map a raw load error to a recovery category + user-facing strings.
 *
 * @param {Error | { message?: string, name?: string } | string | null | undefined} err
 * @returns {{
 *   category: "too_large" | "storage" | "invalid" | "network",
 *   recoverable: boolean, title: string, message: string, hint?: string,
 * }}
 *   recoverable = true when Retry is the right action; false when Retry would just
 *   re-fail and the visitor must switch model / free space instead.
 */
export function describeLoadError(err) {
  const raw = err && (err.message || err.name) ? `${err.message || ""} ${err.name || ""}` : String(err ?? "");
  const msg = raw.toLowerCase();

  if (has(msg, TOO_LARGE)) {
    return {
      category: "too_large",
      recoverable: false,
      title: "This model is too large",
      message: "It doesn't fit in this device's browser memory.",
      hint: "Pick a smaller model from the menu — Retry won't help here.",
    };
  }
  if (has(msg, STORAGE)) {
    return {
      category: "storage",
      recoverable: true,
      title: "Browser storage is full",
      message: "There isn't room to cache this model.",
      hint: "Free up space (clear this site's data) and try again, or pick a smaller model.",
    };
  }
  if (has(msg, INVALID)) {
    return {
      category: "invalid",
      recoverable: false,
      title: "This model file can't be loaded",
      message: "It may be corrupt or not a valid GGUF file.",
      hint: "Pick another model from the menu.",
    };
  }
  // network drop, CORS, fetch failure, abort, or unknown → transient; Retry fits.
  return {
    category: "network",
    recoverable: true,
    title: "Download failed",
    message: "Check your connection and try again.",
  };
}
