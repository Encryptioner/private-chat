# Story 1: Spike gate — dual-Wllama coexistence + bge retrieval eval (v1)

**Overview:** overview-v1.md · **FR:** FR-7, N1 · **Depends on:** None
**Goal:** A documented GO/NO-GO decision on whether a dedicated embedding Wllama instance can coexist with the chat instance — and whether bge-small retrieves well enough to find page sections.

## Why this is a story, not a phase
FR-7 is a **hard gate** (spec clarification #7, grill C1). The entire neural-embeddings path (Stories 3–4) is conditional on its outcome. This story ends at a decision + eval artifact, not a shipped feature — the only gate-type story in the plan. If it fails, Stories 3–4 re-plan to keyword retrieval (spec's mandated fallback, **not** the slow per-question model swap) and the spec reopens.

## What the spike tests (four independent questions)

1. **Q1 — Two concurrent instances:** can two `new Wllama(config)` objects (same wasm paths as the singleton at wllama.js:267-273) coexist — one loading a causal chat model, one loading `bge-small-en-v1.5` with `{ embeddings: true, pooling_type: 'mean', n_ctx, n_batch, n_ubatch }` — WITHOUT the second hitting `"already initialized"` (the error the singleton swallows at wllama.js:166,204 and that produces the throwing mock at 304-323)?
2. **Q2 — Concurrent use:** with both models loaded, can `embedWllama.createEmbedding({ input })` run while the chat model is loaded (no exit/swap between embed and chat)? This is the latency-winning path.
3. **Q3 — Retrieval quality (N1):** embed chunks scraped from `test-files/poc/host.html` (pricing / FAQ / contact), then for queries `["where is pricing", "how do i get a refund", "how do i contact support"]` assert the correct chunk is top-1 with cosine ≥ ~0.25.
4. **Q4 — Resident memory on mobile (grill Maj1):** with BOTH models loaded, measure peak resident memory (DevTools → Performance/Memory, or `performance.memory` / `chrome://tracing`). Run on a **mobile/low-RAM target** — a real low-end Android or iPhone, NOT just desktop DevTools throttling (throttling simulates CPU/network, not the WASM-linear-memory ceiling). Record the peak. **GO requires this fit a mobile tab budget** (rough threshold: peak < ~700MB; mobile Safari/Chrome WASM limits are ~1–1.5GB, less on low-end).

## Build Order
1. **Harness page** `test-files/spike/spike.html` — loads wllama from the dev server (same wasm asset paths the app uses), two `<script type=module>` blocks: `chat.js`, `embed.js`. → open in browser, no console errors on boot.
2. **Chat instance** `test-files/spike/chat.js` — `new Wllama(config)` + `loadModelFromUrl(LFM2-700M url, {useCache,allowOffline,n_ctx:4096})`. → loads, can `createCompletion`. **Load-bearing: if a single instance won't even construct/load outside the singleton, STOP — the singleton's assumptions are wrong and Story 3's design changes.**
3. **Embed instance** `test-files/spike/embed.js` — a SECOND `new Wllama(config)` (same paths) + `loadModelFromUrl(bgeUrl, {embeddings:true, pooling_type:'mean', n_ctx:512, n_batch:512, n_ubatch:512})`. → **watch console for `"already initialized"`.** This is Q1.
4. **Concurrent embed** — call `embedInstance.createEmbedding({input:"pricing"})` while chat model is loaded. → returns a 384-dim vector. This is Q2.
5. **Retrieval eval** — scrape poc/host.html chunks (copy the walk logic from `test-files/files/scraper.js`, or import it once Story 2 lands — for the spike, inline a 10-line version), embed each, embed each query, cosine rank, print top-1 + score. → this is Q3.

> **Run over http, not file://** (wllama needs http + the dev-server COOP/COEP headers for multi-thread). Use `pnpm run dev` and open `http://localhost:5173/test-files/spike/spike.html` — or a plain `http-server` on the dir if the dev server won't serve test-files.

## Deliverables
- `test-files/spike/spike.html`, `chat.js`, `embed.js`, `eval.js` — throwaway harness (not shipped).
- `test-files/spike/RESULT.md` — **the decision.** Four sections: Q1 (yes/no + exact console output/error), Q2 (yes/no + embed latency while chat loaded), Q3 (top-1 per query + scores), **Q4 (peak resident memory, mobile + desktop)**. A one-line verdict: **GO** (build Stories 3–4 on a dedicated embedder instance, both models resident within the mobile RAM budget) or **NO-GO** (re-plan to keyword retrieval).

## How to Test
- **AI/automated (this story IS the test):**
  1. `pnpm run dev` (builds embed.js + starts vite with COOP/COEP).
  2. Open `http://localhost:5173/test-files/spike/spike.html`.
  3. Read the on-page console output (the harness logs each step + verdict) OR `RESULT.md`.
- **Correct =** Q1 = yes (no "already initialized" on the 2nd instance), Q2 = yes (embed returns a vector with chat loaded), Q3 = top-1 correct for ≥2 of 3 queries with cosine ≥ 0.25, **Q4 = peak resident memory < ~700MB on the mobile target**. Any "no" → NO-GO (or, for Q4-only failure on mobile: GO on desktop, **mobile degrades to context-less chat** — not keyword, not slow-swap; see Notes).

## Test / DoD (local)
- [ ] `/verify` green (harness boots, no uncaught errors)
- [ ] `RESULT.md` written with all three answers + a GO/NO-GO verdict
- [ ] If GO: the embedder-instance construction pattern is captured in `RESULT.md` (the exact `new Wllama` + `loadModelFromUrl` options that worked) so Story 3 is mechanical
- [ ] If NO-GO: keyword-retrieval re-plan is triggered BEFORE touching Stories 3–4 (spec reopens per grill C1)

## Notes
- **Bypass the singleton deliberately.** `getWllamaInstance()` (wllama.js:262) cannot produce two instances — it caches one and reuses `window.wllamaGlobalInstance`. The spike calls `new Wllama(...)` directly. Story 3's `embeddings.js` will do the same (its own instance), NOT `getWllamaInstance()`.
- **Confirm the bge filename** during this story (spec OQ#2): try `unsloth/bge-small-en-v1.5-GGUF` `bge-small-en-v1.5-Q4_K_M.gguf` first; fall back to `CompendiumLabs/bge-small-en-v1.5-gguf`. Record the working URL in `RESULT.md` — Story 3 needs it.
- **If Q1 passes but Q2 fails** (instances coexist but embed-blocks-chat or vice versa): that's a SOFT NO-GO — re-plan to "build index once on open (embed), exit embedder, keep chat loaded; queries do keyword retrieval OR a one-time embed of the query if cheap." Decide in the re-plan; don't silently ship the slow swap.
- **Mobile graceful-degrade (grill Maj1):** if Q4 fails on mobile (two models don't fit RAM) but Q1–Q3 pass on desktop, the verdict is **GO (desktop) + mobile-context-less**. Detect low-RAM via the Q4 measurement / `navigator.deviceMemory` (< 4) / a try-catch on the second `loadModelFromUrl` → on mobile, skip the embedder entirely and fall back to today's context-less chat. This keeps the binary GO/NO-GO intact: GO = embeddings wherever RAM allows; constrained devices silently get current behaviour. Do NOT fall back to keyword retrieval or the slow per-query swap on mobile — both are worse than context-less for v1's trusted-static-site targets.
- **bge pooling:** `mean` is the spec's choice. If retrieval quality is poor, also try `CLS` (some bge variants prefer CLS) — record whichever scores higher.
- Throwaway harness — delete `test-files/spike/` (or keep as a regression check) once Story 3's real `embeddings.js` exists. Not shipped to `public/`.
