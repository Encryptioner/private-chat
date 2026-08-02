# Spec: RAG-1 — Site-aware RAG for the private-chat widget (v1)

**Date:** 2026-08-02
**Version:** v1
**Status:** Grilled
**Original Requirement:** See `original-requirement.md`

## Overview

Make the private-chat widget aware of the website it is embedded on, entirely client-side. On open, the widget scrapes the host page's visible content, embeds the chunks locally via Wllama, and answers visitor questions using only that retrieved context — including clickable links that scroll to or navigate the relevant section. Everything runs in-browser (Wllama for both embeddings and generation); no backend, no API key.

### Strategic Context
- **Problem:** The widget today is a generic local LLM — it knows nothing about the site it sits on, so it can't answer "where is pricing" or point visitors to a section.
- **Who:** Visitors to Ankur's sites (and eventually any site owner who embeds it); Ankur as the site owner who wants one widget, zero backend, zero per-site forks.
- **Why now:** The embed/iframe plumbing already exists; local models are fast enough at the 270M–1B tier; the core scraping assumption was just proven in a live browser (PoC, `test-files/poc/`).
- **If not this:** Widget stays generic. Visitors navigate manually. The "free, private, site-aware assistant" differentiator doesn't exist.

## Clarifications

1. **Q:** Scrape + train, or RAG? **A:** RAG. Training dropped — impractical client-side, and RAG achieves the goal without it.
2. **Q:** Local or hosted LLM for generation? **A:** Strictly local (Wllama). No external API.
3. **Q:** How are embeddings generated? **A:** Via Wllama with a dedicated embedding GGUF (`bge-small-en-v1.5` Q4_K_M, ~33MB). Not `transformers.js`.
4. **Q:** Cross-page (sections on OTHER pages) in MVP? **A:** No — live current-page scrape only. Static crawler is phase 2. Merge code stays so an opt-in `site-index.json` is honoured.
5. **Q:** v1 target sites? **A:** private-chat demo page + `portfolio-template`.
6. **Q:** Single pointer or related-links list? **A:** Prose answer + "Related sections" list (≤3) from retrieved sources.
7. **Q (grill C1):** Keyword-only v1 or commit to neural embeddings? **A:** Commit to embeddings. The two-Wllama-instance spike is a HARD gate in `/plan-work`; if it fails, fall back to keyword retrieval (not the slow per-question model swap), and the embeddings decision reopens.

## Functional Requirements

### FR-1: Host-page scraping (iframe-aware)
- **Description:** Scrape visible text of the host page, grouped under the nearest anchor (element `id`, or a slug from the nearest heading). Headings without an `id` get a slug assigned so they are navigable. Client-side, no network.
- **Req ref:** "take data by scraping" (intent #1).
- **Acceptance criteria:**
  - [ ] Same-origin host (all `encryptioner.github.io/*`): scrapes `window.parent.document`, NOT the iframe's own body. (Proven in PoC.)
  - [ ] Cross-origin host: scrape silently disables (SecurityError caught); widget works context-less — no crash.
  - [ ] `SCRIPT/STYLE/NAV/FOOTER/NOSCRIPT/SVG/IFRAME`, `aria-hidden`, `hidden` skipped.
  - [ ] Heading without `id` → slug assigned as `id`; **collision guard**: if `rootDoc.getElementById(slug)` already exists, suffix (`faq`, `faq-2`, …) so scroll lands on the right element. *(grill M4)*
  - [ ] Each section carries `{ anchor, title, url, text }`, `url = hostPageURL#anchor`.
- **Affected modules:** `src/lib/scraper.js` (from `test-files/files/scraper.js`).

### FR-2: Local embeddings via Wllama (dedicated embedder)
- **Description:** Chunk sections (~220 words, metadata preserved); embed each via a dedicated Wllama embedding model. Vectors cached in IndexedDB keyed by page URL + content hash; re-embed only when content changes.
- **Req ref:** "local in browser slm" (intent #2) — applies to embeddings too.
- **Acceptance criteria:**
  - [ ] Embedder loaded with `loadModelFromUrl(url, { embeddings: true, pooling_type: 'mean', n_ctx, n_batch, n_ubatch })`; vectors via `createEmbedding({ input })`.
  - [ ] Candidate model: `bge-small-en-v1.5` Q4_K_M (~33MB, 384-dim). Confirm exact HF filename at implement time (`unsloth/bge-small-en-v1.5-GGUF` or `CompendiumLabs/bge-small-en-v1.5-gguf`).
  - [ ] Identical page content (same hash) on repeat load reuses cached vectors — no re-embed, no model load for indexing.
  - [ ] IndexedDB keyed `origin + pathname`; `contentHash` mismatch triggers re-embed.
- **Affected modules:** `src/lib/embeddings.js` (rewrite from `test-files/files/embeddings.js` — drop `@xenova/transformers`, use Wllama embedder).

### FR-3: Retrieval
- **Description:** On each question, embed the query (same embedder), score all cached chunks by cosine similarity (brute-force; normalized vectors → dot product), return top-k (k=4).
- **Req ref:** "help getting info about website" (intent #1, #3).
- **Acceptance criteria:**
  - [ ] Query embedded with the SAME model/pooling as the index.
  - [ ] Returns top-k chunks with score, sorted desc; each retains `{ anchor, title, url, text }`.
  - [ ] Brute-force scan acceptable up to ~2k chunks (noted ceiling); beyond that, plan phase evaluates bucketing.
  - [ ] **Minimum-score threshold**: below it (e.g. cosine < 0.25 for bge-small), no "Related sections" render — avoids misleading links on unrelated questions. *(grill M1)*
- **Affected modules:** `src/lib/embeddings.js` (`retrieveRelevant`).

### FR-4: Grounded generation (small-context-safe)
- **Description:** Build the system message from ONLY the top-k chunks (with `url`), feed to `createChatCompletion`. Model answers strictly from context; if absent, says so.
- **Req ref:** "work as an agentic ai to help getting info about website" (intent #1, #3).
- **Acceptance criteria:**
  - [ ] System message: answer only from CONTEXT; if not present, say so; surface page context per chunk.
  - [ ] Only top-k chunks in prompt — never the whole page — fits 270M–1B models' ~2k–4k token windows.
  - [ ] Prior chat history limited (existing 4-message window preserved).
- **Affected modules:** `src/lib/ragEngine.js`.

### FR-5: Related-sections list UI (from retrieved sources)
- **Description:** Alongside the prose answer, render up to ~3 "Related sections" links from retrieved top-k. The model does NOT emit link markers — links come from retrieval (robust on small models). Clicking scrolls (same page) or navigates (different path) the HOST page.
- **Req ref:** "pointed as url with chat. With some other related message" (intent #3).
- **Acceptance criteria:**
  - [ ] Up to N (default 3) links from `retrieveRelevant` results, each showing chunk `title`, linking to `url`.
  - [ ] Same-page link → smooth-scroll host element + brief highlight.
  - [ ] Different-path link → navigate host (`window.parent.location.href = url`); cross-origin parent → best-effort `window.location`.
  - [ ] Links hide when no relevant chunks clear the score threshold (FR-3).
  - [ ] **Chat history persisted to `sessionStorage`** so a cross-page navigation (which reloads the host and destroys the iframe) restores the conversation on return. *(grill m1)*
- **Affected modules:** `src/lib/ragEngine.js` (`navigateToSection`), `src/App.jsx` + small list component, `src/lib/chatStorage.js` (extend for session persistence).
- **Note:** The `[[section: anchor|label]]` marker parser is NOT required for v1. Keep `navigateToSection`; shelve the marker path.

### FR-6: Per-site config contract (one embed.js, many sites)
- **Description:** A single unmodified `embed.js` reads `window.PRIVATE_CHAT_CONFIG` (set by the host page before the script loads) for optional `siteIndexUrl`, `label`, accent theming. No per-project code fork.
- **Req ref:** "for all of my websites … each project has their own repo" (intent #4).
- **Acceptance criteria:**
  - [ ] `PRIVATE_CHAT_CONFIG.siteIndexUrl` (optional) → static index fetch URL; falls back to `/site-index.json`, then none.
  - [ ] `PRIVATE_CHAT_CONFIG.label` (optional) → widget greeting/title.
  - [ ] Missing config → widget works (live-scrape only, default label).
  - [ ] IndexedDB keyed by full path → no cross-project collisions on the shared origin.
  - [ ] **Config-passing mechanism explicit**: `embed.ts` runs in the HOST context, reads `window.PRIVATE_CHAT_CONFIG`, and forwards it to the iframe as query params (it already forwards `embedQueryParams`); `App.jsx` reads them. The iframe cannot read the host `window` directly. *(grill m3)*
- **Affected modules:** `src/lib/siteIndex.js`, `src/scripts/embed.ts`, `src/App.jsx`.

### FR-7: Dual-model lifecycle (embedder + chat) — SPIKE-GATED
- **Description:** Manage the embedding model and chat model within Wllama's one-model-per-instance constraint. Index is built once and cached; queries still need per-turn embedding.
- **Req ref:** implied by "local in browser slm" for both roles.
- **Acceptance criteria:**
  - [ ] **HARD GATE (plan phase):** spike two concurrent Wllama instances (persistent small embedder + chat model) against the existing `"Module is already initialized"` defence in `wllama.js`. Include a tiny bge retrieval-quality eval. *(grill C1, N1)*
  - [ ] **If the spike PASSES:** ship two concurrent instances (embedder stays loaded, fast query embedding, chat stays loaded). Clean path.
  - [ ] **If the spike FAILS:** fall back to **keyword/TF retrieval** (drop the embedder entirely for v1) — NOT the slow per-question model swap. The embeddings decision then reopens (spec returns to NEEDS REWORK per grill). *(grill C1)*
  - [ ] Index-build (embedder) and chat never run simultaneously unless the spike passes.
- **Affected modules:** `src/lib/wllama.js` (`WllamaWrapper` already swaps models — extend for `embeddings:true` load; may need a second instance).

### FR-8: v1 rollout (demo + 1 real site)
- **Description:** Ship and verify on private-chat's own embedded demo page and `portfolio-template`.
- **Req ref:** "for all of my websites" (intent #4) — v1 proves the multi-site contract on two concrete sites.
- **Acceptance criteria:**
  - [ ] Widget site-aware on private-chat demo page (same-origin self-scrape).
  - [ ] `portfolio-template` (React 17 CRA — an SPA, see FR-9) gets the embed snippet + optional config; verified on its deployed GitHub Pages URL.
  - [ ] A visitor who used the widget on one `encryptioner.github.io` site gets instant model load on the next (shared HTTP cache for the GGUF).
- **Affected modules:** `portfolio-template` repo (snippet only — no private-chat code fork).

### FR-9: Host-navigation re-scrape (SPA support) *(grill C2 — added)*
- **Description:** SPAs navigate client-side without a full reload, so scrape-on-init goes stale. Re-scrape (and re-embed if content changed) on host navigation; the `contentHash` cache makes unchanged-content re-embed a no-op.
- **Req ref:** implied — the named v1 target `portfolio-template` is an SPA; stale pointers would betray the headline feature.
- **Acceptance criteria:**
  - [ ] Re-scrape when the chat opens AND the host path differs from the last-scraped path.
  - [ ] Re-scrape on host client-side navigation: detect via `popstate`, `hashchange`, and/or a `MutationObserver` on the host body (debounced).
  - [ ] Re-embed only if `contentHash` changed (cheap on unchanged).
  - [ ] General mechanism — works for any SPA host (Next.js, CRA, etc.), not just `portfolio-template`.
- **Affected modules:** `src/lib/scraper.js` / `ragEngine.js` (re-scrape trigger), `src/scripts/embed.ts`.

## Non-Functional Requirements
- **Performance:** Index build ≤ a few seconds for a typical page (one-time, cached). Per-question retrieval < 100ms (brute-force cosine over cached vectors). Generation latency = existing Wllama baseline. Init must not block the chat UI; show progress for the ~33MB embedder + model loads.
- **Payload:** Adds ~33MB embedding GGUF on top of the existing chat model. **Both GGUFs are runtime-cached (cache-on-first-fetch), NOT precached** — service-worker install must not download 33MB+ upfront. *(grill M3)* No new npm runtime dependency (transformers.js excluded).
- **Security/Privacy:** 100% client-side — no page content leaves the browser (explicit win). Host-DOM access is read-only except `id` assignment on headings and transient scroll highlight. Cross-origin hosts cannot be scraped (browser-enforced) — degrades gracefully. **Input validation:** scraped host text + model output render in the chat UI; confirm `Markdown.jsx` (react-markdown) does NOT use `rehype-raw` so scraped content cannot inject raw HTML / scripts into the chat iframe (XSS). *(grill Security)*
- **Responsive:** Widget already responsive; related-links list must render within the chat panel on mobile widths.
- **i18n:** N/A — content derived from the host site; no fixed bilingual strings. System prompt is English (matches existing).

## Degradation & Error Handling *(grill M1 — added)*
Every happy path has an unhappy path:
- **Embedder/chat GGUF load failure** (HF CDN down, `createEmbedding` throws) → fall back to context-less chat (current widget behaviour). Log, don't crash.
- **IndexedDB unavailable** (incognito/private mode, `indexedDB.open` throws) → in-memory index, no caching (re-embed each load). Surface nothing to the user.
- **0 scrapeable chunks** (page is all nav/footer) → skip grounding; generic chat.
- **Retrieval below threshold** (FR-3) → no "Related sections" links; model answers without context.
- **Cross-origin scrape blocked** (FR-1) → already handled (context-less).

## Verification Strategy *(grill M2 — added)*
- **Unit (Vitest + jsdom):** `scraper.js` (DOM → chunks, slug+collision), `chunkSections`, `hashText`, retrieval scoring + threshold, `navigateToSection` same/cross-page logic.
- **E2E (Playwright — extend `test-files/poc`):** same-origin scrape of parent; cross-origin disable; cache hit (2nd load skips re-embed); SPA re-scrape on route change; related-link scroll on host; min-score threshold hides weak links.
- **Spike (plan phase):** two-Wllama-instance feasibility (FR-7) + a tiny bge retrieval-quality eval over a real page (N1).

## Out of Scope (v1)
- **Static site-wide crawler** (`build_site_index.py` / Scrapling) and true cross-page awareness — **phase 2**. Merge code stays so an opt-in `site-index.json` is honoured, but no crawler ships.
- **Real agentic tool-calling** (multi-step browsing, function calls). v1 is single-shot grounded QA with section links.
- **Rollout beyond demo + portfolio-template.** Other sites reuse the same contract later.
- **In-browser model fine-tuning / training.** Permanently dropped.
- **Guaranteed scraping on third-party (non-github.io) domains.** Same-origin only; cross-origin degrades to context-less.

## Existing Code References
- `src/lib/wllama.js` — `CHAT_ROLE`, `WllamaWrapper` (model swap via `exit`+`load`), `getWllamaInstance` (singleton + `"already initialized"` defence), `createChatCompletion`. RAG generation + embedder lifecycle plug in here.
- `src/scripts/embed.ts` — iframe creation with `sandbox="allow-scripts allow-same-origin"` (makes same-origin parent scraping work), `_getPublicPath` (GitHub Pages path logic), `embedQueryParams` forwarding (reuse for config).
- `vite.embed.config.js` — `embed.js` IIFE build (`inlineDynamicImports`).
- `public/sw.js` — service worker; extend with runtime cache for both GGUFs (NOT precache).
- `src/components/Markdown.jsx` — confirm no `rehype-raw` (XSS).
- `src/lib/chatStorage.js` — extend for `sessionStorage` cross-nav persistence (FR-5).
- `test-files/files/scraper.js`, `ragEngine.js` — PoC-fixed versions to adapt into `src/lib/`.
- `test-files/poc/host.html` + `frame.html` — proven the iframe→parent scrape (FR-1).
- `public/test-embed.html`, `test-floating.html` — existing embed test harnesses.

## Open Questions
1. ~~Two-Wllama-instance feasibility~~ → **Resolved as a hard-gate spike (FR-7)**; failure → keyword fallback + spec reopens.
2. **Exact embed GGUF filename** — confirm `bge-small-en-v1.5-Q4_K_M.gguf` under `unsloth/` (or use `CompendiumLabs/`).
3. **Embed-mode model selection** — expose dropdown to visitors, or hardcode a default in embed mode?
4. **Chunk size / overlap** — 220 words fixed, or tune with overlap?
5. **Top site size ceiling** — confirm brute-force cosine fine to ~2k chunks; define bucketing threshold.

## Technical Notes
- **Iframe scrape contract (proven):** under `sandbox="allow-scripts allow-same-origin"`, a same-origin iframe reaches `window.parent.document`. `resolveRootDoc()` catches cross-origin `SecurityError` and falls back. PoC: `sameOriginAccess: true`, chunks carried host URLs not iframe URLs.
- **Wllama embedding API (verified via docs):** `loadModelFromUrl(url, { embeddings: true, pooling_type: 'mean', n_ctx, n_batch, n_ubatch })` then `createEmbedding({ input })` → `res.data[0].embedding`. Official demo uses `CompendiumLabs/bge-base-en-v1.5-gguf`; we use smaller `bge-small`.
- **COOP/COEP only on dev server** (`vite.config.js`); GitHub Pages sends none → Wllama runs single-threaded in prod. Embeddings work the same way; no header changes needed.
- **Marker system removed for v1:** links come from `retrieveRelevant` top-k rendered by the UI; `extractSectionPointer`/regex unnecessary.
- **`hashText` is a 32-bit non-crypto hash** — acceptable for v1 small sites; switch to SubtleCrypto `SHA-256` if large/dynamic sites appear. *(grill m2)*

## Change Log
| Date | Section Changed | What Changed | Why |
|------|-----------------|--------------|-----|
| 2026-08-02 | — | Initial v1 draft | New spec |
| 2026-08-02 | Multiple | Incorporated grill findings (grill-spec-v1.md): added FR-9 (SPA re-scrape), FR-1 id-collision guard, FR-3 min-score threshold, FR-5 sessionStorage, FR-6 config-passing, FR-7 spike-gated w/ keyword fallback, Degradation section, Verification section, NFR runtime-cache + XSS note, m2 hash ceiling | Hardening after hard-critic pass; user chose embeddings-commit (B) for grill C1 |
