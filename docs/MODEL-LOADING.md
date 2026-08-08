# Model Loading & Error Recovery

> **Canonical reference** for how models load in `private-chat`, what's cached where, every way a
> load can fail, and how recovery works — for the chat model **and** the separate RAG embedder. If
> you're touching `loadModel`, the cache, or the error UI, start here.

**TL;DR** — A failed or interrupted download **never poisons the next visit**. Reloading the page is
always a clean slate: wllama validates cached files by size, the success-only `localStorage` flag is
never set by a failure, and all React load-state is in-memory. Transient failures (network) get a
Retry button; permanent ones (model too large / bad file) point you at the model picker.

---

## The two-state recovery machine

`App.jsx`'s `loadModel()` drives a small state machine with **two recovery states** layered on top of
the normal loading flow. The state lives in `modelState` (`src/App.jsx`):

| State field        | Meaning                                                                              |
|--------------------|--------------------------------------------------------------------------------------|
| `isLoading`        | Download/load in progress                                                            |
| `isReady`          | Model loaded, chat is live                                                           |
| `awaitingConsent`  | **Ask-first gate** — showing "Download model", waiting for the visitor to opt in     |
| `loadError`        | **Failure recovery** — a load failed; the (classified) error is surfaced with Retry  |

```
                       mount
                         │
            ┌────────────▼────────────┐
            │ gate: hasLoadedBefore   │
            │   || isGoodNetwork() ?  │
            └────────────┬────────────┘
              yes / no    │
         ┌───────────────┴───────────────┐
         ▼                               ▼
   ┌──────────┐   [Download]       ┌──────────┐
   │ loading  │ ◀───────────────── │ awaiting │  (slow/metered/Safari,
   │ isLoading│                    │ Consent  │   or never loaded before)
   └────┬─────┘                    └──────────┘
   ok / │ \ fail
        │  \────────── custom_url fail ──▶ auto-retry as preset ──▶ loading
        ▼
   ┌──────────┐                [Retry] / [switch model in dropdown]
   │  ready   │ ◀────────────────────┐
   │ isReady  │                      │
   └──────────┘                ┌─────▼─────┐
                               │ loadError │  (classified: network / too_large
                               │           │   / storage / invalid)
                               └───────────┘
```

### 1. Ask-first gate — `awaitingConsent`

The default model is ~278MB. Pushing that at a visitor who only opened the chat — on a metered or
slow link — is a bad surprise. So the model does **not** auto-download on open unless there's a
positive signal it'll be fast:

```js
if (hasLoadedModelBefore(gateModelKey) || isGoodNetwork()) {
  loadModel();
} else {
  setModelState({ ...current, awaitingConsent: true }); // show "Download model"
}
```

- `hasLoadedModelBefore(key)` (`src/lib/modelLoadCache.js`) — this exact model finished loading in this
  browser before, so it's almost certainly still cached → safe to auto-load.
- `isGoodNetwork()` (`src/lib/network.js`) — the **Network Information API** confirms a fast, unmetered
  connection (wifi / fast 4g, data-saver off).
- **Safari/iOS have no Network Information API** → `isGoodNetwork()` is always `false` there, so the
  ask-first prompt always shows unless the model loaded before. That's the safe call: we never
  background/auto-download when we can't confirm the connection is good.

### 2. Failure recovery — `loadError`

If `loadModel()` throws, the model is **not** left in a half-loaded state. The catch block resets
`isLoading` and surfaces `loadError`, so the UI can show a recovery prompt:

```js
} catch (err) {
  // ...
  if (source === "custom_url") {            // bad site-owner modelUrl → fall back
    modelUrlRef.current = null;
    setCustomModelLoadFailed(true);
    return loadModel();                      // retry as the built-in default
  }
  setModelState((c) => ({ ...c, isLoading: false, loadError: err }));
  throw err;
}
```

This is the **root-cause fix** for an old bug: previously `isLoading` stayed `true` forever on any
failure (interrupted download, nav-away, OOM), which made `isBusy` permanently `true` and locked the
New Chat button + model switcher with no way out. Resetting `isLoading` + surfacing `loadError` lets
the UI offer Retry instead of spinning forever.

The raw `loadError` is classified by `describeLoadError()` (see [Error classification](#error-classification))
before rendering, so the prompt matches the failure type.

---

## Where models are cached — the three persistence layers

| Layer                          | What it stores                                 | Persists across reload? | Survives browser pressure?          |
|--------------------------------|------------------------------------------------|:-----------------------:|-------------------------------------|
| **OPFS** (wllama `CacheManager`) | full model bytes + `metadata.originalSize`    | ✅                      | best-effort; evictable (esp. Safari) |
| **`localStorage`** `pc_models_loaded_v1` | success-only boolean per model       | ✅                      | yes (separate quota)                |
| **React `modelState`**         | `isLoading` / `isReady` / `awaitingConsent` / `loadError` | ❌ (in-memory) | n/a — fresh every load              |

The deliberate split: the **storage backend owns model integrity**, and the **success-only flag is the
only positive "this'll be fast" signal**. There is **no persistent "downloading" flag** anywhere — so
there's nothing to get stuck. That's what makes reload-always-works a free property.

---

## Q1 — Does an earlier failed / interrupted load create problems on the next visit?

**No. Three layers all self-heal.**

1. **wllama validates every cached file on load** by comparing its real byte size against the size
   recorded in its metadata (`Model.validate()`). An interrupted download leaves a short/partial file
   → size mismatch → the file is marked **invalid** and skipped. `getModelOrDownload()` then
   re-downloads it from scratch (the partial is truncated, not resumed). *(wllama 3.5.1:
   `Model.validate()` at `index.js:2286`, `getModelOrDownload` at `:2483`, OPFS worker `truncate(0)`
   on re-open.)*
2. **The `localStorage` flag is success-only.** A failed download never writes
   `pc_models_loaded_v1`, so the ask-first "Download model" prompt re-appears on the next visit
   instead of falsely assuming the model is cached.
3. **React state is in-memory.** `isLoading` / `loadError` reset on every reload.

Plus `WllamaWrapper.loadPromise` is always cleared in a `finally` block — no stuck in-flight promise
survives across the wrapper boundary.

**Conclusion:** network drop, tab close, laptop sleep, CORS error, quota error — none of it corrupts
anything. Reload (or Retry) re-attempts cleanly.

### What this does NOT do

- **Downloads are not resumable.** wllama truncates and re-streams the whole file on any interruption.
  For the 278MB default that's a few seconds on wifi; for a big custom model on a flaky link, every
  drop restarts from 0%.
- **The cache is best-effort and evictable.** The app does **not** call `navigator.storage.persist()`,
  so under disk pressure a browser may evict OPFS (notably mobile Safari, ~1GB per origin + ~7-day
  inactivity window). After eviction the model re-downloads next visit. The `localStorage` flag
  survives eviction, so on Safari that re-download happens *silently* (no ask-first prompt) —
  acceptable, but worth knowing.

---

## Error classification — `src/lib/modelLoadError.js`

The raw error from `loadModel()` is run through a pure classifier before the UI renders it, so a
transient failure gets Retry while a permanent one points the visitor at the model picker (which is
**never disabled during an error** — `isBusy = isLoading || isGenerating`, and `isLoading` is `false`
on the error branch). Add a category here and every error prompt picks it up:

| Category    | Matched on (lowercased message/name)                | `recoverable` | UI shows                                   |
|-------------|------------------------------------------------------|:-------------:|--------------------------------------------|
| `too_large` | out of memory, unable to allocate, linear memory…   | ❌            | "This model is too large" → **pick smaller** |
| `storage`   | QuotaExceededError, storage is full, exceeded quota | ✅            | "Browser storage is full" → free space / smaller |
| `invalid`   | invalid gguf, not a gguf, magic, unexpected EOF…    | ❌            | "This model file can't be loaded" → **pick another** |
| `network`   | everything else (fetch fail, CORS, abort, unknown)  | ✅            | "Download failed" → **Retry**              |

`recoverable: false` is the key signal: Retry would just re-fail, so the hint tells the visitor to
switch model. This closes the old gap where OOM / bad-file failures looped on Retry with no escape.

---

## All failure modes + recoverability

| Failure                                         | Reload? | Retry button? | Classified as | Notes                                                              |
|------------------------------------------------|:-------:|:-------------:|:-------------:|--------------------------------------------------------------------|
| Network drop mid-download                       | ✅ clean | ✅             | `network`     | full re-fetch (no resume)                                          |
| Tab closed / laptop sleep mid-download          | ✅ clean | n/a           | `network`     | partial detected invalid → re-downloaded                           |
| Custom `modelUrl` bad / CORS / 404              | ✅ clean | ✅ (auto)      | —             | auto-falls back to built-in default + reveals picker               |
| Preset URL 404 (HuggingFace outage)             | ✅ clean | ⚠️ loops       | `network`     | switch model in dropdown                                           |
| OPFS quota exceeded                             | ✅ clean | ✅             | `storage`     | truncate frees the partial; fails again only if disk truly full    |
| **OOM / model too big for WASM memory**         | ✅ clean | ❌ (loop)      | `too_large`   | **pick a smaller model** — Retry won't help                        |
| Invalid / corrupt / non-GGUF file               | ✅ clean | ❌ (loop)      | `invalid`     | pick another model                                                 |
| OPFS evicted (mobile Safari inactivity)         | ✅ redownload | n/a       | `network`     | `localStorage` flag may be stale → silent re-fetch                |
| Incognito / no storage available                | n/a     | n/a           | `network`     | nothing persists; always fresh                                     |
| WebAssembly module already initialized (iframe) | ✅ clean | n/a           | —             | `getWllamaInstance()` builds a mock; chat disabled in that context |

### Retry vs. Reload vs. Switch model — quick decision guide

| Situation                                           | Do this                                                          |
|-----------------------------------------------------|------------------------------------------------------------------|
| Download interrupted (network, sleep, tab close)    | **Reload**, or hit **Retry** — both re-download cleanly.         |
| Custom `modelUrl` can't load                        | Widget already auto-fell back to the default. Fix CORS on host.  |
| Same model fails repeatedly                         | It's permanent — **pick a smaller model** in the dropdown.       |
| "Browser storage is full"                           | Clear this site's data, then Retry (or pick a smaller model).    |

---

## How big can a model be?

- **File uploads** are capped at **2 GB** client-side (the uploader enforces it — `ChatHeader.jsx`).
- **Custom `modelUrl`** (`PRIVATE_CHAT_CONFIG.modelUrl`) has **no enforced size limit** — the site
  owner picks. But the practical ceiling is ~2 GB regardless, because:
  - **WebAssembly linear memory** caps what can *run*. 32-bit WASM addresses ~4 GB, and after KV
    cache + compute buffers a GGUF around 2 GB is the realistic top. Only dense transformers
    (Gemma / Llama / Qwen / Smol) are known to load here — Mamba/SSM-hybrids can OOM far smaller
    (a ~700M SSM-hybrid failed at ~1.08GB state alloc; see `src/lib/wllama.js`).
  - **OPFS must have room** for the full file. Desktops are fine; mobile Safari's ~1 GB origin cap
    may reject a large model outright.
  - **A bigger model = a longer, non-resumable download** — any interruption restarts it from zero.
- **Recommended:** stay on the smallest preset that answers well for your content (`gemma3-270m`,
  278MB, is the default for a reason). Only go bigger after testing the load on a mid-range device.

---

## Browser storage limits (quick reference)

OPFS is wllama's default storage backend (since v3). It is **not** the HTTP cache.

| Browser         | OPFS per origin                       | Notes                                                            |
|-----------------|---------------------------------------|------------------------------------------------------------------|
| Chrome / Edge   | up to ~80% of free disk (origin-pooled) | best-effort; evictable under pressure                           |
| Firefox         | up to ~50% of disk                    | best-effort; evictable                                           |
| Safari / iOS    | ~1 GB                                 | aggressive: ~7-day inactivity eviction; **no Network Information API** (ask-first always shows unless the model loaded before) |

The chat model + embedder together (~278 MB + 35 MB by default) fit comfortably on desktop; mobile
Safari is the tight case — prefer the smaller presets there. The app does not request persistent
storage, so all of the above is best-effort.

---

## Developer reference — the `loadModel()` code path

`src/App.jsx` → `loadModel()`:

1. **Resolve the source** (`local_file` > `custom_url` > `preset`):
   ```js
   const source = localModelFiles.length ? "local_file" : customModelUrl ? "custom_url" : "preset";
   ```
2. **wllama options** — `useCache: true` (OPFS), `allowOffline: true`, `n_ctx: 4096`, `n_threads: 1`
   (pinned single-thread — the multi-worker GLUE framing desyncs under Vite bundling, and prod is
   single-threaded anyway).
3. **Exit + load** — `wllama.exit()` (unload any current model) then `loadModel(files)` or
   `loadModelFromUrl(url, options)`.
4. **On success** — `markModelLoaded(modelKey)` (success-only flag, local files excluded), then
   `isReady: true`.
5. **On failure** — custom URL auto-retries as preset; otherwise `isLoading: false, loadError: err`.

`src/lib/wllama.js` → `WllamaWrapper` serializes loads: an in-progress `loadPromise` is awaited
rather than started twice, and it's always cleared in `finally`. The "already initialized" wllama
error (iframe/WASM-module-conflict path) is tolerated instead of thrown.

---

## Edge cases & known gaps

- **OOM / bad-file Retry loop (closed).** Retry re-runs the same `modelId`. For permanent failures
  this used to loop. The classifier now surfaces a `recoverable: false` hint pointing at the model
  picker; the dropdown itself was always reachable (`isBusy` is `false` on the error branch).
- **Stale `localStorage` after OPFS eviction.** `hasLoadedModelBefore` can be `true` while the model
  was evicted from OPFS → the gate auto-loads → wllama re-downloads silently. Not a correctness bug;
  documented so it's understood. A cross-check (does OPFS actually hold the file?) is possible but
  not worth the complexity.
- **No `navigator.storage.persist()`.** Keeps storage best-effort/evictable. Deliberate: a persistent
  prompt is intrusive for a casual visitor. Revisit if eviction becomes a real support issue.

---

## Testing

- **`src/lib/__tests__/modelLoadCache.test.js`** — the success-only flag: false for unmarked, true
  after `markModelLoaded`, independent keys, survives corrupted storage.
- **`src/lib/__tests__/modelLoadError.test.js`** — `describeLoadError`: each category, fallback to
  `network`, null/undefined/string safety, always returns renderable strings.
- **`src/lib/__tests__/network.test.js`** — the ask-first gate's `isGoodNetwork()` heuristics.

Run with `pnpm test`. Simulate a failed download locally by pointing a preset URL at a non-existent
file or throttling the network in DevTools; the `loadError` prompt + Retry should appear and a reload
should recover cleanly.
