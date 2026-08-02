# Grill Log: Site-aware RAG for private-chat (v1)

**Date:** 2026-08-02
**Grilled by:** Claude (Hard Critic Mode)
**Input:** `spec-v1.md`
**Ticket:** RAG-1
**Verdict:** PASS WITH CONDITIONS

## Summary

Architecture is sound and the riskiest assumption (iframe→parent scrape) is already proven. But two criticals land before implementation: (1) the chosen local-embeddings path hinges on a Wllama two-instance spike whose fallback is genuinely poor, and a far simpler MVP (keyword retrieval, no second model) may achieve 80% of the value at ~0 risk — the spec never considers it; (2) the named v1 target `portfolio-template` is a React SPA, so scrape-on-init goes stale on client-side route change. Several unhappy paths and the SW caching strategy for the 33MB embedder are also undefined.

**Stats:** 11 findings — 0 Blocker, 2 Critical, 4 Major, 4 Minor, 1 Note

## Findings

### CRITICAL

#### [C1] Embeddings in v1 may be the wrong bet — a simpler MVP exists, and the chosen path's fallback is poor
- **Location:** FR-2, FR-3, FR-7; Open Question #1.
- **Issue:** The entire dual-model lifecycle (FR-7) — the spec's #1 risk — exists *only* because we want local embeddings. But the proven PoC retrieved relevant sections with **keyword overlap, zero model, zero swap, zero extra payload**. For v1's goal ("point me to X section" on two small sites), keyword/TF retrieval is often sufficient; semantic embeddings matter most for paraphrased queries, which is a phase-2 refinement. Worse, FR-7's *fallback* if the two-instance spike fails is "2 model loads per question" (exit chat → load embedder → embed → exit → load chat → generate) — seconds of latency per turn. That is not a real Plan B.
- **Risk:** The team commits to embeddings, the spike fails, and the only fallback ships a widget that freezes for seconds on every message. Or: weeks spent on model-swap machinery when keyword search would have shipped the feature in days.
- **Recommendation:** Decide explicitly before planning: **(A) Keyword-only v1** — no embedder, no FR-2/FR-7, retrieve via TF/keyword over chunks, defer embeddings to phase 2 behind the spike; or **(B) Commit to embeddings** — but then the two-instance spike is a *hard gate* in `/plan-work`, and if it fails, fall back to A, not to the slow per-question swap. The spec currently assumes B without acknowledging A exists.

#### [C2] `portfolio-template` is a React SPA → scrape-on-init goes stale on route change
- **Location:** FR-1, FR-8.
- **Issue:** Per the root `CLAUDE.md`, `portfolio-template` is "React 17 + Chakra UI (CRA)" — a client-side-routed SPA. FR-1 scrapes once on widget init. When the visitor navigates client-side (no full page reload), the cached index still describes the *old* route. The bot then points at sections that no longer exist on screen.
- **Risk:** The widget confidently gives wrong/stale section pointers on the very first real target site. Undermines trust in the headline feature.
- **Recommendation:** Add an FR or acceptance criterion: re-scrape (or invalidate cache) on (a) chat-open if the URL/path changed since last scrape, and (b) host route change detected via `popstate` / `hashchange` / `MutationObserver` on the host. The `contentHash` cache already supports cheap re-embed when content differs — wire a trigger to it.

### MAJOR

#### [M1] No unhappy paths defined
- **Location:** FR-2, FR-3, FR-4, FR-5.
- **Issue:** No behavior specified for: embedder GGUF fails to load (HF CDN down) or `createEmbedding` throws; IndexedDB unavailable (private/incognito mode — `indexedDB.open` throws); page yields 0 scrapeable chunks (all nav/footer); query matches nothing above a useful threshold (top-3 returned regardless of score → misleading "related" links on an unrelated question).
- **Risk:** Widget crashes or silently serves garbage in common real-world conditions.
- **Recommendation:** Add a "Degradation" subsection per FR: model-load failure → fall back to context-less chat (current behaviour); IDB unavailable → in-memory index, no caching; 0 chunks → skip grounding; retrieval → define a minimum cosine threshold below which no "related" links render.

#### [M2] No test / verification strategy
- **Location:** whole spec.
- **Issue:** Acceptance criteria exist but are checkboxes, not a verification plan. Repo has no test runner (`package.json` has no `test` script). The dual-model lifecycle, cross-origin fallback, cache-hit path, and SPA re-scrape are all hard to verify by hand reliably.
- **Risk:** Regressions slip in; the riskiest behaviours (FR-7, C2) ship unverified.
- **Recommendation:** Define minimal verification: extend `test-files/poc` into a Playwright harness (project already lists Playwright as the E2E tool for some sites) covering same-origin scrape, cross-origin disable, cache hit, and a retrieval assertion. Unit-cover `scraper.js` (pure DOM → chunks, easy to test with jsdom).

#### [M3] Service-worker caching strategy for the 33MB embedder undefined
- **Location:** NFR Payload; FR-2; `public/sw.js`.
- **Issue:** Spec says "both cached by the service worker" but doesn't say *how*. If the embedder GGUF is added to the SW **precache** list, first SW install downloads 33MB+ (plus the chat model) before the page is usable — harmful. If it's runtime-cached on first use, install stays lean.
- **Risk:** Slow first-visit / broken SW install on mobile.
- **Recommendation:** State explicitly: embedder + chat GGUF are **runtime-cached** (cache-on-first-fetch), NOT precached. Verify `sw.js` uses a runtime cache strategy for `*.gguf`.

#### [M4] Heading-`id` assignment can collide with existing host IDs
- **Location:** FR-1 ("heading without an id receives its slugified text as id").
- **Issue:** If the host page already has `id="faq"` elsewhere, the scraper generates slug `faq` and assigns it to the heading → duplicate IDs → `getElementById` returns the first → scroll lands on the wrong element.
- **Risk:** Wrong-section scroll on pages with pre-existing IDs that collide with generated slugs.
- **Recommendation:** Before assigning, check `rootDoc.getElementById(slug)`; if taken, suffix (`faq`, `faq-2`, …). Cheap, prevents the collision.

### MINOR

#### [m1] Cross-page navigation destroys the chat session
- **Location:** FR-5.
- **Issue:** A cross-page "related" link sets `window.parent.location.href = url` → host reloads → iframe (chat) destroyed → conversation lost.
- **Recommendation:** Persist chat history in `sessionStorage` (the original AI discussion already proposed this) so it survives same-origin page navigations. Note in FR-5.

#### [m2] `hashText` is a 32-bit non-crypto hash — collision risk
- **Location:** `scraper.js` `hashText` (cache key).
- **Issue:** djb2-style 32-bit hash; on very large/diverse pages, collisions are possible → stale index served for changed content.
- **Recommendation:** Acceptable for v1 (small sites). Note the ceiling; switch to SubtleCrypto `SHA-256` if large/dynamic sites appear. `// ponytail:` comment naming the ceiling.

#### [m3] FR-6 config-passing mechanism underspecified
- **Location:** FR-6 acceptance criteria.
- **Issue:** `window.PRIVATE_CHAT_CONFIG` lives on the HOST window; the chat runs in a separate iframe document and cannot read host `window` directly. The mechanism is: `embed.ts` (runs in host) reads `PRIVATE_CHAT_CONFIG` → forwards as iframe query params (it already forwards `embedQueryParams`) → `App.jsx` reads them. Spec names this only in "Affected modules", not in acceptance criteria.
- **Recommendation:** Add an acceptance criterion making the host→query-param→App path explicit and tested.

#### [m4] SPA concern extends beyond `portfolio-template`
- **Location:** C2 / FR-8.
- **Issue:** Other target candidates (e.g. `encryptioner.github.io` profile site, Drive-Pool/Next.js, markdown-to-slide/Next.js) are also SPA/router-based. C2's fix should be general, not portfolio-template-specific.
- **Recommendation:** Frame the re-scrape trigger as a general host-navigation detector, not a per-site patch.

### NOTES

#### [N1] bge-small retrieval quality is unverified
- **Issue:** Assumes `bge-small-en-v1.5` embeddings are "good enough" for site-section retrieval. Likely fine, but a 10-minute eval (does "where is pricing" retrieve the pricing chunk over a real page?) would de-risk FR-2 before committing.
- **Recommendation:** Add a tiny retrieval eval to the spike/plan phase.

## Security Assessment

| Category | Status | Notes |
|----------|--------|-------|
| Authentication | N-A | No backend, no auth. |
| Authorization | N-A | Client-only. |
| Input Validation | RISK | Scraped host text + model output render in chat UI; confirm `Markdown.jsx` (react-markdown) does NOT render raw HTML (no `rehype-raw`). If it does, scraped content → XSS in the chat iframe context. Verify in plan. |
| Data Exposure | OK | All processing local; no page content leaves the browser. Explicit privacy win — call it out. |
| Rate Limiting | N-A | No server. Local inference self-limits. |
| Multi-tenancy | OK | IndexedDB keyed by full path; no cross-project collision on shared origin. |

## Requirement Traceability

| Original Requirement Point | Covered By | Status |
|----------------------------|------------|--------|
| "take data by scraping" | FR-1 | Covered |
| "train the model in browser (optional)" | Clarifications + Out of Scope | Excluded (dropped → RAG) |
| "agentic ai to help getting info about website" | FR-3, FR-4 | Covered (QA, not real agent — noted) |
| "pointing different section of website easily" | FR-1, FR-5 | Covered |
| "use local in browser slm" (no API) | FR-2, FR-4, NFR Privacy | Covered |
| "section … pointed as url with chat" | FR-5 | Covered (current-page; cross-page = phase 2) |
| "with some other related message" | FR-5 (≤3 related links) | Covered |
| "for all of my websites" | FR-6, FR-8 | Covered (v1 = 2 sites; rest via same contract) |
| "same domain, /public-websites subpaths" | FR-6 (path-keyed DB, shared origin) | Covered |
| "each project has their own repo" | FR-6 (no-fork config) | Covered |

No MISSING rows. FR-7 (dual-model lifecycle) and the related-sections-list detail are **additions** beyond the literal original (engineering implications of the local choice) — called out, not silent scope creep.

## Assumptions Made

1. Two Wllama instances can coexist (or the slow fallback is acceptable) — **risk if wrong: v1 UX is broken or embeddings must be dropped** (see C1).
2. `portfolio-template` content is scrapable as-is — **risk if wrong: SPA nav invalidates index** (see C2).
3. bge-small retrieval quality suffices for section-finding — low risk, unverified (N1).
4. Host pages are trusted (site owner controls content) — limits XSS severity but doesn't eliminate it (Input Validation).
5. 220-word chunks are appropriate — unverified, tunable.

## Missing from Spec

- [ ] Degradation/error behaviour per FR (M1)
- [ ] SPA re-scrape trigger (C2)
- [ ] Embedder SW caching strategy = runtime, not precache (M3)
- [ ] Heading-id collision guard (M4)
- [ ] Verification/test strategy (M2)
- [ ] sessionStorage chat persistence across cross-page nav (m1)

## Questions for Author

1. **Embeddings in v1, or keyword-only MVP?** (C1 — pivotal; changes FR-2/FR-7 scope and risk profile)

## Verdict Details

**PASS WITH CONDITIONS.** No blockers; architecture is sound and the core assumption is proven. Conditions before `/plan-work`:
1. Resolve C1 — choose keyword-only v1 (drop FR-2/FR-7 to phase 2) OR commit to embeddings with the two-instance spike as a hard plan-phase gate (fallback = keyword, not the slow swap).
2. Accept C2's SPA re-scrape as a new FR/acceptance criterion (non-negotiable for the named target).
3. Address M1 (degradation paths) and M3 (SW runtime-cache) in the spec before planning.

If C1 lands on "commit to embeddings" and the later spike fails, this returns to **NEEDS REWORK**.
