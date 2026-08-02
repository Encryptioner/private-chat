# Story 3: Local index + retrieval (Wllama embedder, IDB cache, threshold) (v1)

**Overview:** overview-v1.md · **FR:** FR-2, FR-3, M1(partial: IDB/load) · **Depends on:** Story 1 (hard — needs GO + the embedder construction pattern from `RESULT.md`), Story 2 (hard — needs `chunkSections`, `hashText`)
**Goal:** A module that builds a vector index of the page's chunks (cached in IndexedDB, re-embed only on content change) and retrieves the top-k chunks above a minimum score for a question. No UI yet — verifiable via a test harness.

> **Branch on Story 1's verdict.** This story assumes **GO**. If Story 1 returned NO-GO, STOP and re-plan: replace the embedder with a keyword/TF retriever (no second Wllama instance, no GGUF), keep the SAME public surface (`buildIndex`, `retrieveRelevant`, IDB cache, threshold) so Stories 4–6 are unaffected. The keyword re-plan is a separate plan-version event (spec reopens).

## Build Order
1. **Embedder wrapper** in `src/lib/embeddings.js` — a module-private `getEmbedder()` that constructs its OWN `new Wllama(config)` (import the wasm `?url` assets directly — same import paths wllama.js:1-5 uses — NOT via the singleton module, to avoid coupling/min3). Loads `bge-small-en-v1.5-Q4_K_M` with `{embeddings:true, pooling_type, n_ctx, n_batch, n_ubatch}`. Exposes `embedText(text): Promise<number[]>` via `createEmbedding({input}) → res.data[0].embedding`. **Lazy by construction** (grill Maj2): `getEmbedder()` is a module-private promise created on first `embedText` — the embedder does NOT load on widget open, only when the first question triggers `buildIndex`/`retrieveRelevant`. Story 4 surfaces the "Indexing this page…" state during this load. → unit: `embedText("pricing")` returns a 384-dim array. **Load-bearing: if construction throws "already initialized" here, the spike's GO was wrong — STOP, escalate to keyword re-plan.**
2. **IDB vector store** (inline in `embeddings.js`, ponytail — ~40 lines, not worth a file) — `openDb/getCached/setCached` keyed `origin+pathname`, record `{contentHash, vectors, updatedAt}`. Wrap `indexedDB.open` in try/catch → on throw, set an in-memory fallback flag (grill M1: incognito/private mode). → unit: cache hit returns stored vectors; IDB-unavailable path returns in-memory without throwing.
3. **`buildIndex(chunks)`** — `pageKey = origin+pathname`, `contentHash = hashText(chunks.text joined)`. Cache hit (same hash) → return cached vectors, no embed, no model load. Miss → embed each chunk, store, return. Returns `{ vectors, version }` where `version` is a build-id (grill Maj3 — see step 5). → unit: 2nd call with identical chunks skips embedding (mock `embedText`, assert call count 0 on hit).
4. **`retrieveRelevant(question, vectors, topK=4, {minScore=0.25})`** — `embedText(question)`, cosine (dot product, vectors normalized) per chunk, sort desc, **filter `< minScore`**, slice topK. Return chunks with `score` + original `{anchor,title,url,text}`. → unit: "pricing" query against poc chunks → pricing chunk top-1, score ≥ 0.25; an unrelated query ("quantum field theory") → empty (all below threshold).
5. **Index version-stamp / race guard (grill Maj3)** — `buildIndex` returns a `version` (monotonic counter or `contentHash`). The current index reference in `ragEngine.js` carries its version. `retrieveRelevant` (or `buildGroundedMessages` in Story 4) captures the version at call start; if the live index's version changed by completion (a re-scrape swapped it mid-query — Story 5), the caller re-runs retrieval against the fresh index OR returns "index updating, try again" instead of serving stale/partial pointers. ~10 lines. `// ponytail:` note the choice.

## Backend (lib)
- `src/lib/embeddings.js` — **create** (rewrite of `test-files/files/embeddings.js`: drop `@xenova/transformers`, use the Wllama embedder). Exports: `buildIndex(chunks)`, `retrieveRelevant(question, vectors, topK, opts)`. Module-private: `getEmbedder`, `embedText`, IDB helpers, `cosineSim`.
- `src/lib/constants.js` — **modify**: add a `RAG` block (`EMBEDDER_URL`, `EMBEDDER_OPTIONS {pooling_type, n_ctx, n_batch, n_ubatch}`, `MIN_SCORE=0.25`, `TOP_K=4`, `CHUNK_MAX_WORDS=220`, `IDB_NAME`, `IDB_STORE`). Keeps tunables out of code (project rule: constants for config). Model URL resolves localhost→`/models/`, prod→HF CDN, mirroring the LFM2 pattern in wllama.js:30-32.
- No FE this story.

## Other Deliverables
- The embedder GGUF is NOT committed to the repo; served from HF CDN in prod (Story 1 confirmed the URL). For localhost convenience, the implementer MAY download it to `public/models/` (gitignored if large) — optional.

## How to Test
- **AI/automated (Vitest + jsdom):**
  1. `src/lib/__tests__/embeddings.test.js` — mock the embedder (`getEmbedder` returns a stub whose `createEmbedding` returns deterministic 384-dim vectors, e.g. bag-of-words-ish so "pricing" is closest to the pricing chunk). This tests the CACHE + RETRIEVAL + THRESHOLD logic without loading a 33MB model in CI.
     - Cache: 2× `buildIndex` same chunks → embedder called once.
     - IDB-unavailable: stub `indexedDB.open` to throw → builds in-memory, no crash, no cache write.
     - Retrieval: high-overlap query → top-1 correct + score ≥ 0.25; off-topic query → `[]`.
  2. **Real-model smoke (manual, not CI):** a tiny `test-files/smoke/retrieve.html` (or reuse Story 1's spike harness) that loads the REAL bge model, scrapes poc/host.html, and logs `retrieveRelevant("where is pricing")` → eyeball pricing top-1. This is the end-to-end truth check the unit mock can't give.
- **Correct =** `pnpm test` green (mocked) AND the real-model smoke shows pricing top-1.

## Test / DoD (local)
- [ ] `/verify` green
- [ ] `embeddings.js` exports `buildIndex` + `retrieveRelevant`; no `@xenova/transformers` import anywhere
- [ ] Cache-hit skips embedding (assert call count)
- [ ] IDB-unavailable → in-memory fallback, no throw (M1)
- [ ] `minScore` threshold filters weak matches (FR-3)
- [ ] Real-model smoke: correct chunk top-1 for ≥2 of 3 poc queries
- [ ] Tunables live in `constants.js`, not inline

## Notes
- **Dedicated instance, not the singleton.** `embeddings.js` calls `new Wllama(config)` directly (per Story 1's `RESULT.md`), NOT `getWllamaInstance()`. Two instances coexist by design (the spike proved it).
- **Normalize once at embed time** so retrieval is a plain dot product (cheapest brute-force). Confirm bge vectors are normalized post-pooling; if not, normalize in `embedText`.
- **Brute-force ceiling (spec FR-3, OQ#5):** fine to ~2k chunks. `// ponytail: brute-force cosine, O(n) per query; bucket/index if a site exceeds ~2k chunks` at `retrieveRelevant`.
- **Load failure (M1):** if `getEmbedder()` / `createEmbedding` throws, `buildIndex`/`retrieveRelevant` resolve to `[]` (empty index → Story 4 degrades to context-less chat). Wrap, log, never throw to the UI.
- **Threshold tuning:** 0.25 is the bge-small starting point (spec FR-3). If the real-model smoke shows good chunks scoring below it, lower; if noise scores above, raise. Record final value in `constants.js`.
- **NO-GO branch note:** if Story 1 said NO-GO, this file becomes `keywordRetrieval.js` (or the same `embeddings.js` with a TF/keyword `retrieveRelevant`), `buildIndex` stores token freqs instead of vectors, no `getEmbedder`. Same exports → Stories 4–6 are **structurally** unaffected; the one re-tune needed is the score threshold (cosine 0.25 ≠ keyword/TF scale) — re-pick `MIN_SCORE` in the keyword re-plan (grill min4).
