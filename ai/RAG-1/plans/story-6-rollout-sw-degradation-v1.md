# Story 6: Rollout + SW runtime cache + degradation + verification harness (v1)

**Overview:** overview-v1.md · **FR:** FR-8, M1, M2, M3, R5, R6 · **Depends on:** Stories 1–5 (capstone — needs the full path)
**Goal:** Ship + verify site-awareness on private-chat's own demo page and `portfolio-template`; make the feature robust to every failure mode (load fail, IDB unavailable, 0 chunks, below-threshold); cache both GGUFs at runtime (never precache); lock in a Playwright harness; confirm XSS posture.

## Build Order
1. **SW runtime cache for `*.gguf`** (M3, R5) — in `public/sw.js`, add a fetch-handler branch (before the catch-all, sw.js:123) matching `\.gguf(\?|$)`: **cache-on-first-fetch** into `MODEL_CACHE` (network → clone → `safePut` → return; offline → cache fallback). Do NOT add to `CORE_ASSETS` precache (sw.js:8) — 33MB+ on install is the failure M3 prevents. → verify: first visit fetches the embedder; second visit (offline) loads from `MODEL_CACHE`; SW install does NOT download the GGUF.
2. **Degradation consolidation (M1)** — audit every RAG entry point for the unhappy paths and confirm silent fallback (most are in Stories 3–4; this story verifies + fills gaps):
   - Embedder/chat GGUF load fails → context-less chat (current behavior). ✓ Story 3.
   - IndexedDB unavailable → in-memory index. ✓ Story 3.
   - 0 scrapeable chunks (all nav/footer) → skip grounding, generic chat, no links. ✓ Story 4.
   - Retrieval below threshold → no links. ✓ Story 3.
   - Cross-origin scrape blocked → context-less. ✓ Story 2.
   - **Gap to close here:** a single `degraded` flag surfaced subtly (e.g. a quiet "I can't see this page's content" system note) so the model doesn't hallucinate when grounding silently failed. Decide: silent (current) vs. a gentle hint. Default: a one-line system addition when index is empty ("The page context is unavailable; answer generally or say you can't see the page."). → verify each path with a Playwright/forced-failure case.
3. **Playwright harness (M2)** — `@playwright/test` devDep + `playwright.config.js` + `tests/e2e/rag.spec.js` consolidating the per-story E2E checks: same-origin scrape + grounded answer; cross-origin disable; cache hit (2nd load skips re-embed — assert via a spy/log); SPA re-scrape (Story 5's spa-host); min-score hides weak links; degradation (block the GGUF → context-less). Serve poc/spa hosts via Playwright's static server or `vite preview`. → `pnpm test:e2e` green.
4. **portfolio-template rollout (FR-8)** — in the `portfolio-template` repo (snippet only, NO private-chat code fork): add the embed `<script>` + `window.PRIVATE_CHAT_CONFIG` (optional `label`). Verify on its deployed GitHub Pages URL that the widget answers site questions and points to sections. → manual verify on the live URL.
5. **XSS confirm (R6)** — re-grep `src/` + `package.json` for `rehype-raw`/`allowDangerousHtml`; confirm `Markdown.jsx` still has none; add a Playwright assertion that scraped `<script>` payload text is rendered as text, not executed. → assertion passes.

## Backend (lib)
- `public/sw.js` — **modify**: `*.gguf` runtime-cache branch → `MODEL_CACHE`.
- `src/lib/ragEngine.js` — **modify** (if gap #2 chosen): empty-index hint in the system message.
- Degradation paths otherwise already in `embeddings.js` (Story 3) + `App.jsx` (Story 4).

## Frontend
- `portfolio-template` repo — **snippet only** (its own repo): embed script + optional `PRIVATE_CHAT_CONFIG`. No `src/` change in private-chat for this.

## Other Deliverables
- `playwright.config.js`, `tests/e2e/rag.spec.js` — the E2E suite.
- `pnpm test:e2e` script.

## How to Test
- **AI/automated:**
  1. `pnpm test` (Vitest unit) green.
  2. `pnpm test:e2e` (Playwright) green — the consolidated RAG E2E + degradation suite.
  3. Lighthouse/SW check: load the app, confirm SW install does NOT fetch `*.gguf` (Network tab / Playwright request log); go offline, reload, confirm GGUF served from `MODEL_CACHE`.
- **Human (rollout):**
  1. private-chat demo page (same origin): ask "what can this widget do" → grounded answer + section links.
  2. `portfolio-template` deployed URL: ask "where are your projects" → grounded answer pointing to the projects section; click → scrolls/navigates.
  3. Shared HTTP cache: visit private-chat demo, then portfolio-template → embedder + chat model load fast (shared browser HTTP cache for the GGUF, FR-8).
- **Correct =** both sites site-aware; degradation paths all pass; SW runtime-caches GGUF without precaching; XSS assertion holds.

## Test / DoD (local)
- [ ] `/verify` green (`pnpm lint` + `pnpm test` + `pnpm test:e2e`)
- [ ] SW caches `*.gguf` at runtime into `MODEL_CACHE`; NOT in precache (M3, R5)
- [ ] Every degradation path (load fail, IDB unavailable, 0 chunks, below threshold, cross-origin) → silent/gentle fallback, no crash (M1)
- [ ] Playwright suite covers: same-origin grounded answer, cross-origin disable, cache hit, SPA re-scrape, threshold hides weak links, degradation
- [ ] `portfolio-template` deployed URL: site-aware, section links work (FR-8)
- [ ] XSS: no `rehype-raw`; scraped `<script>` renders as text (R6)
- [ ] Full spec acceptance criteria from `spec-v1.md` all checkable on the two target sites

## Implementation Notes (2026-08-03)

- **SW `*.gguf` cache (M3/R5):** cache-on-first-fetch into `MODEL_CACHE`, cache-first on
  repeat. NOT in `CORE_ASSETS` precache (33MB+ on install is the failure M3 prevents).
  `VERSION` bumped `v1.0.5 → v1.0.6` (per Note 53) so old SWs release their caches.
- **Degradation hint (M1 gap):** `buildGroundedContext` returns a "page context unavailable"
  system note when the index is empty (all-nav page / load failed / IDB unavailable), so the
  model doesn't hallucinate site info. Distinct from the off-topic case (index has chunks,
  none clear threshold → `null` → generic chat, correct). Unit-tested.
- **XSS hardening (R6 + NFR Security — MODERATE adjustment):** the spec's R6 check scoped XSS
  to `Markdown.jsx`/`rehype-raw` (clean), but `formatMessageContent` built an HTML string
  from **unsanitized** model output and rendered it via `dangerouslySetInnerHTML` — a path
  RAG amplifies (scraped text → model context → echoed → live). **Fix:** escape HTML first
  (`src/lib/formatMessage.js`), then apply the code-block/URL wrappers. Code blocks now render
  literal HTML as text (correct; the prior live-render was itself a bug). Both render branches
  (`Markdown` and `dangerouslySetInnerHTML`) are now safe. Unit-tested (XSS payloads → text).
  This fulfills the spec's stated NFR Security intent; recorded in `spec-v1.md` Change Log.
- **Playwright harness (M2):** `playwright.config.js` + `tests/e2e/rag.spec.js`. Every app-loaded
  test downloads the ~35MB GGUF, so the model-backed suite is gated behind `RAG_E2E_MODEL=1`
  (skip-by-default → CI-safe). This is the manual gate per spike N3; the **49 unit tests are the
  always-green automated layer**. `vite preview` (no COOP/COEP) matches prod threading (Note 55).
- **portfolio-template (FR-8):** embed snippet + `PRIVATE_CHAT_CONFIG = { label }` added to its
  `public/index.html` (local edit only). Commit to that repo + GitHub Pages deploy + live verify
  = **human handoff**. No private-chat code fork (FR-6 honored).

## Notes
- **No phased rollout.** The full feature deploys as one unit once this story's DoD passes. portfolio-template gets the snippet only after verification.
- **SW version bump:** adding the `.gguf` branch changes cache behavior → bump `VERSION`/`STATIC_CACHE`/`MODEL_CACHE` in sw.js (currently `v1.0.4`) so old SWs release. Follow the existing versioning pattern.
- **Degradation "hint" decision (gap #2):** if the team prefers fully silent (current), skip the system-message hint — but then the model may confidently hallucinate when grounding silently failed. Recommend the gentle one-liner; it's a system-prompt tweak, not UI. Note the choice.
- **Playwright + COOP/COEP:** the prod GitHub Pages build sends NO cross-origin headers (spec Technical Notes); only the dev server does. E2E against `vite preview` (prod-like, no special headers) to match real conditions — wllama runs single-threaded there, which is what prod gets.
- **`test-files/` cleanup:** by end of this story, decide which spike/poc harnesses graduate into `tests/` (kept) vs stay throwaway in `test-files/` (gitignored or deleted). Don't ship PoC scratch to `public/`.
- This story is where `/pre-review` + `/ship` run (per the workflow chain) before the branch deploys.
