# Model Loading & Error Recovery

> **Canonical reference** for how models load in `private-chat`, what's cached where, every way a
> load can fail, and how recovery works — for the chat model **and** the separate RAG embedder. If
> you're touching `loadModel`, the cache, or the error UI, start here.

**TL;DR** — A failed or interrupted download must **not** poison the next visit. React load-state is
in-memory and the success-only `localStorage` flag is never set by a failure, so those two layers
always start clean. The **cache layer doesn't, on its own**: wllama's own "already downloaded"
fast-path can mistake a truncated file for a complete one (see [Q1](#q1--does-an-earlier-failed--interrupted-load-create-problems-on-the-next-visit)),
so `loadModel()`'s catch block explicitly deletes the failed model's cache entry
(`WllamaWrapper.clearModelCache`) before ever showing Retry. Transient failures (network) get a Retry
button; permanent ones (model too large / bad file) point you at the model picker.

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
  if (source !== "local_file" && describeLoadError(err).category !== "too_large") {
    await wllama.clearModelCache(customModelUrl || preset.url); // drop the poisoned cache entry
  }
  if (source === "custom_url") {            // bad site-owner modelUrl → fall back
    modelUrlRef.current = null;
    setCustomModelLoadFailed(true);
    return loadModel();                      // retry as the built-in default
  }
  setModelState((c) => ({ ...c, isLoading: false, loadError: err }));
  throw err;
}
```

Resetting `isLoading` + surfacing `loadError` is the **root-cause fix** for an older bug: previously
`isLoading` stayed `true` forever on any failure (interrupted download, nav-away, OOM), which made
`isBusy` permanently `true` and locked the New Chat button + model switcher with no way out.

`clearModelCache()` is a **second, separate root-cause fix**: without it, an interrupted download can
leave the cache in a state where Retry (and even a full page reload) re-fails identically forever,
*regardless of how good the network is on the next attempt* — see [Q1](#q1--does-an-earlier-failed--interrupted-load-create-problems-on-the-next-visit).
It's skipped for `too_large` because those bytes downloaded fine; the model just doesn't fit in this
device's WASM memory, so wiping a good, expensive-to-redownload cache entry would help nothing.

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

**The `localStorage` flag and React state always self-heal. The cache layer does NOT, on its own —
this app works around it.**

1. **The `localStorage` flag is success-only.** A failed download never writes
   `pc_models_loaded_v1`, so the ask-first "Download model" prompt re-appears on the next visit
   instead of falsely assuming the model is cached.
2. **React state is in-memory.** `isLoading` / `loadError` reset on every reload. `WllamaWrapper.loadPromise`
   is always cleared in a `finally` block — no stuck in-flight promise survives across the wrapper boundary.
3. **wllama's cache validation catches size mismatches on *load*, but its own download path can't
   always get past them.** `Model.validate()` compares a cached file's real byte size against the size
   in its metadata, and a short/partial file correctly fails that check. The bug: **before**
   `validate()` ever runs, `CacheManager.download()` has an "already downloaded, skip the fetch"
   fast-path (`getSize(fileKey, hint)` in wllama 3.5.1's `cache-manager.ts`) meant for its Cross-Origin
   Storage (COS) backend. COS is an experimental API essentially no browser implements yet, so that
   check silently falls back to "does *any* file already exist at this model's plain OPFS key" — which
   is true for a truncated file left by a network drop. On the attempt right after a drop, this
   fast-path writes metadata claiming the *full* remote size against those truncated bytes and returns
   **without downloading anything**. From then on, `validate()` correctly flags the file invalid on
   load, `refresh()` calls `download()` again to fix it — and hits the exact same fast-path again
   (now even faster, since metadata already exists), which returns immediately without re-fetching.
   **The entry is bricked**: every future Retry or full page reload re-fails identically, no matter
   how good the network is by then, because the library never has a code path that clears the stale
   file itself.

**The fix:** `loadModel()`'s catch block calls `wllama.clearModelCache(url)`
(`WllamaWrapper.clearModelCache`, `src/lib/wllama.js`) — `cacheManager.delete(url)` on the raw wllama
instance — for any URL-sourced failure that isn't `too_large`. That removes the poisoned file *and*
its metadata, so the next attempt (Retry click, or just reopening the chat) can't hit the fast-path
and is forced into a real, fresh download.

### What this does NOT do

- **Downloads are not resumable.** wllama truncates and re-streams the whole file on any interruption.
  For the 278MB default that's a few seconds on wifi; for a big custom model on a flaky link, every
  drop restarts from 0%.
- **The cache is best-effort and evictable.** The app does **not** call `navigator.storage.persist()`,
  so under disk pressure a browser may evict OPFS (notably mobile Safari, ~1GB per origin + ~7-day
  inactivity window). After eviction the model re-downloads next visit. The `localStorage` flag
  survives eviction, so on Safari that re-download happens *silently* (no ask-first prompt) —
  acceptable, but worth knowing.
- **`clearModelCache` is a targeted workaround, not a patch to wllama.** It only runs from
  `loadModel()`'s own catch block, so it only protects this app's load path. If a future wllama
  version changes `cache-manager.ts`'s fast-path behavior, re-check whether this workaround is still
  needed.

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
| Network drop mid-download                       | ✅ (1 retry) | ✅         | `network`     | `clearModelCache` drops the truncated file; full re-fetch (no resume) |
| Tab closed / laptop sleep mid-download          | ✅ (1 retry) | n/a       | `network`/`invalid` | no catch ran to clear it before close; the *next* load attempt either re-fails fetching or loads the truncated blob into wllama and fails parsing it — either way that attempt's catch clears it, so the one after works |
| Custom `modelUrl` bad / CORS / 404              | ✅ clean | ✅ (auto)      | —             | auto-falls back to built-in default + reveals picker               |
| Preset URL 404 (HuggingFace outage)             | ✅ clean | ⚠️ loops       | `network`     | switch model in dropdown                                           |
| OPFS quota exceeded                             | ✅ clean | ✅             | `storage`     | truncate frees the partial; fails again only if disk truly full    |
| **OOM / model too big for WASM memory**         | ✅ clean | ❌ (loop)      | `too_large`   | **pick a smaller model** — Retry won't help                        |
| Invalid / corrupt / non-GGUF file               | ✅ clean | ✅ (1 retry) if it's actually the wllama cache-fastpath bug above; ❌ (loop) if the *remote* file itself is bad | `invalid` | `clearModelCache` clears a locally-corrupted entry; a genuinely bad remote file still needs **pick another model** |
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
5. **On failure** — for any URL-sourced source that isn't `too_large`, `wllama.clearModelCache(url)`
   drops the (possibly poisoned) cache entry first; custom URL then auto-retries as preset; otherwise
   `isLoading: false, loadError: err`.

`src/lib/wllama.js` → `WllamaWrapper` serializes loads: an in-progress `loadPromise` is awaited
rather than started twice, and it's always cleared in `finally`. The "already initialized" wllama
error (iframe/WASM-module-conflict path) is tolerated instead of thrown. `clearModelCache(url)` calls
`this.wllama.cacheManager.delete(url)` on the raw wllama instance, swallowing any error (best-effort;
the following load attempt is the real fallback if the delete itself fails).

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
- **`src/lib/__tests__/wllamaClearModelCache.test.js`** — `WllamaWrapper.clearModelCache`: deletes the
  failed model's cache entry by URL, never throws (rejecting `cacheManager.delete`, or no
  `cacheManager` at all on the iframe-conflict mock wllama).

Run with `pnpm test`. Simulate a failed download locally by pointing a preset URL at a non-existent
file or throttling the network in DevTools; the `loadError` prompt + Retry should appear and a reload
should recover cleanly.
