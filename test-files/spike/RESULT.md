# RAG-1 Spike — RESULT

**Date:** 2026-08-02  ·  **Branch:** `dev/rag-for-website-v1`  ·  **Harness:** `test-files/spike/`
**Verdict:** **GO (desktop).** Mobile Q4 (real low-end device, peak < ~700MB) is the **binding** gate measurement and still needs a human on a phone.

## TL;DR

The neural-embeddings path is **viable**. Two Wllama instances coexist; bge-small retrieves the correct section for 3/3 test queries well above threshold. But the spike surfaced **three load-bearing corrections** the plan must absorb before Stories 3–6:

1. **wllama 2.3.4's embedding path is broken** — it returns one *constant* vector for every input (verified across bge-small Q4/Q8/F16 + bge-base Q4, MEAN/CLS pooling, CompendiumLabs + ggml-org sources — all dot = 1.0). **Upgrading `@wllama/wllama` 2.3.4 → 3.5.1 is REQUIRED.** On 3.5.1, embeddings work (dot 0.33–0.68 for distinct inputs). Pre-authorized by the user ("update package versions if necessary"); confirmed necessary.
2. **The chat path breaks on 3.5.1** — `createCompletion` throws `Invalid typed array length: 1163217991` (Gemma 270M). This is a 3.5.1 migration task that **must land before Story 4** (grounded generation uses `createCompletion`). See *Follow-ups*.
3. **Model + API corrections** to FR-2: bge-small **Q8_0** not Q4_K_M (Q4 is degenerate); `pooling_type: 'LLAMA_POOLING_TYPE_MEAN'` (enum string, not `'mean'`); retrieval queries need the bge instruction prefix; `createEmbedding` returns `{data:[{embedding:[]}]}` on 3.x (raw array on 2.x); vectors must be **copied** (`Float32Array.from`) — wllama returns a buffer view.

---

## Q1 — Two concurrent `new Wllama()` instances: **YES**

- Chat instance: `new Wllama({ default: wllamaWasmUrl })` + `loadModelFromUrl(gemmaUrl)`.
- Embedder instance: a **second** `new Wllama({ default: wllamaWasmUrl })` + `loadModelFromUrl(bgeUrl, { embeddings:true, ... })`.
- **No `"already initialized"` error.** The app's singleton defense (`src/lib/wllama.js:166,204,276`) is guarding a symptom, not a real two-instance limit. Per-instance blob-URL workers (`@wllama/wllama/esm/index.js` `createWorker`) give each instance its own WASM module.
- **Story 3 action:** `embeddings.js` constructs its **own** `new Wllama(...)` — do NOT route through `getWllamaInstance()`.

## Q2 — Concurrent embed while chat model loaded: **YES**

- Gemma 270M loaded (resident); `embedder.createEmbedding({input:"where is pricing"})` returns a 384-dim vector in **33 ms**. No exit/swap between embed and chat. This is the latency-winning path.

## Q3 — bge retrieval quality: **YES (3/3)**

Chunks scraped from `test-files/poc/host.html`; brute-force cosine (dot product on normalized vectors) against bge-small-en-v1.5 **Q8_0** vectors; retrieval queries prefixed with `Represent this sentence for searching relevant passages: `.

| Query | Top-1 | Score | Threshold 0.25 |
|-------|-------|-------|----------------|
| "where is pricing" | Pricing | 0.5613 | ✓ |
| "how do i get a refund" | Frequently Asked Questions | 0.6835 | ✓ |
| "how do i contact support" | Contact | 0.6143 | ✓ |

All three correct, all well above the 0.25 floor. bge-small is sufficient for section-finding (spec N1 ✓).

## Q4 — Peak resident memory: desktop proxy only

- Desktop (Mac, 8GB, Chrome 150): `performance.memory` = usedJSHeap 16MB / total 20MB. **This excludes WASM linear memory** — the ~47MB of GGUF weights + KV/SSM state live outside the JS heap.
- `navigator.deviceMemory` = 8GB, `hardwareConcurrency` = 8.
- **The JS-heap number is NOT the binding measurement.** Mobile Safari/Chrome WASM limits (~1–1.5GB, less on low-end Android) decide whether both models can stay resident on mobile. **Needs a real low-end device** (DevTools CPU throttling does not simulate the WASM linear-memory ceiling — per spike plan).
- **Mobile handoff procedure (for the human):**
  1. Start the dev server phone-reachable: `npx vite --host` (serves on `http://<lan-ip>:5174`).
  2. On a **low-end** Android/iPhone, open Chrome → `http://<lan-ip>:5174/test-files/spike/spike.html`.
  3. Let it finish (loads ~47MB). Open the browser's tab/process memory (Chrome: `⋮ → Settings → …` or `chrome://inspect` remote-debug; or Android recents "Memory used").
  4. If peak tab memory **< ~700MB** → full GO. If higher on mobile only → **GO (desktop) + mobile degrades to context-less chat** (per grill Maj1; NOT keyword, NOT slow-swap). Record the number here:

    `Q4-mobile peak: ____ MB on ____ (device) — GO / context-less-only`

---

## Embedder construction pattern (for Story 3 — copy this verbatim)

```js
import { Wllama } from "@wllama/wllama/esm";
import wllamaWasm from "@wllama/wllama/esm/wasm/wllama.wasm?url";   // 3.x: single wasm

const embedder = new Wllama({ default: wllamaWasm }, { suppressNativeLog: true });
await embedder.loadModelFromUrl(EMBEDDER_URL, {
  embeddings: true,
  pooling_type: "LLAMA_POOLING_TYPE_MEAN",   // enum STRING (spec FR-2's 'mean' is wrong)
  n_ctx: 512, n_batch: 512, n_ubatch: 512,
  n_threads: 1,                              // matches prod (GitHub Pages = single-thread)
});
// createEmbedding returns {data:[{embedding:[...]}]} on 3.x — COPY the vector:
const vec = Float32Array.from((await embedder.createEmbedding({ input })).data[0].embedding);
```

**EMBEDDER_URL:**
- localhost: `${location.origin}/models/bge-small-en-v1.5-q8_0.gguf` (COEP-safe, same-origin)
- prod: `https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf` (HF CORS `*`, no COEP on GitHub Pages)

**Retrieval queries MUST be prefixed:** `"Represent this sentence for searching relevant passages: " + query`. Doc/chunk embeddings are unprefixed. Without the prefix, short-query recall drops (bge is asymmetric).

## Model + API corrections to the spec/plan (apply to FR-2)

| Spec/plan says | Actual (verified) |
|----------------|-------------------|
| `bge-small-en-v1.5-Q4_K_M` (~33MB), unsloth | **bge-small-en-v1.5-q8_0** (~35MB), **CompendiumLabs**. Q4_K_M is degenerate (constant vectors); unsloth repo has no Q4_K_M (404); correct filename is lowercase `q4_k_m`/`q8_0`. |
| `pooling_type: 'mean'` | `'LLAMA_POOLING_TYPE_MEAN'` (llama.cpp enum string). |
| `res.data[0].embedding` | On 3.x: `res.data[0].embedding` ✓. On 2.3.4: raw array (moot — 2.3.4 unusable). |
| `embeddings.js` reuses `getWllamaInstance` | **No** — constructs its own `new Wllama({default})`. |
| (unstated) query prefix | Required: `Represent this sentence for searching relevant passages: `. |
| (unstated) vector copy | Required: `Float32Array.from(...)` (buffer view reuse). |

## Follow-ups / blockers (NOT gate rejections — downstream work)

1. **[RESOLVED 2026-08-03] `createCompletion` on wllama 3.5.1 — was the call signature, not the engine.** The `Invalid typed array length: 1163217991` (= `"GLUE"`, the wllama 3.x worker framing magic) crash in the **real app** was caused by an **incomplete** 2.x→3.x migration: `createCompletion`'s public surface changed and the call site wasn't updated. Specifically 3.x wants a **single options object** with `prompt` inside, `max_tokens` (not `nPredict`), flat `temperature`/`penalty_repeat` (not nested `sampling`), and `onData(chunk)` (not `onNewToken(token,piece,text)`). The app kept the 2.x two-arg `createCompletion(prompt, opts)` form → 3.x read the **string prompt as the options object** → `prompt`/`max_tokens` all `undefined` → malformed `cmpl_req` → the returned `cmpl_res` deserialized at the wrong offset → the GLUE bytes read as a `Uint8Array` length. **Root cause = malformed request, 3 layers upstream of the symptom.** Fix: commit `8095b5d` (single-object call + accumulate `onData` chunks into the app's cumulative-text contract). Chat verified end-to-end on 3.5.1 (Gemma 270M streams). The earlier "browser fatigue" theory below was **wrong** — it was based on a `standalone.html` probe that used a *different model* (stories15M) + CDN, so it never exercised the app's actual call path. LESSON: a migration's binding test is the app's own call sites read against the `.d.ts` — a probe that swaps the model AND the delivery tells you nothing about the real config.
2. **[DONE] `src/lib/wllama.js` path-config migrated.** 2.x `{single-thread/multi-thread}` → 3.x `{default: wllamaWasm}`. `vite.config.js` adds `optimizeDeps.exclude: ['@wllama/wllama']` (3.x ships wasm via internal `new URL(..., import.meta.url)`; pre-bundling mishandles it). `pnpm build` passes (2284 modules, wasm emitted, embed.js built). Shared-dep risk is contained — only reaches portfolio-template/linkedinify when `embed.js` rebuilds + deploys (this branch does neither).
3. **[Pre-existing, unrelated] LFM2-700M is unloadable in-browser.** `Invalid typed array length` on load (2.3.4) and completion (3.5.1) — Mamba/SSM state alloc (~1.08GB) exceeds the WASM budget. The app's actual default is **Gemma 3 270M** (`PRESET_MODELS` `default:true`), so LFM2 was never the working model. The `download-model.cjs` postinstall fetches a model the app doesn't default to. Out of RAG-1 scope — note for a separate cleanup.
4. **Q4 mobile measurement** — see procedure above. Blocks the final GO/NO-GO on mobile-resident-memory.

## Throwaway status

This harness (`spike.html`, `chat.js`, `embed.js`, `eval.js`) is **not shipped** (stays in `test-files/`, gitignored-or-kept as a regression check per the spike plan). Story 3's real `src/lib/embeddings.js` supersedes `embed.js`/`eval.js`. Keep `RESULT.md`.
