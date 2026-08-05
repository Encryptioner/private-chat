# Grill Log: RAG-1 site-aware RAG — Plan v1

**Date:** 2026-08-02
**Grilled by:** Claude (Hard Critic Mode)
**Input:** `overview-v1.md` + `story-1`…`story-6`
**Ticket:** RAG-1
**Verdict:** PASS WITH CONDITIONS

## Summary

A well-structured vertical plan: every spec FR (1–9) and every spec-grill item (C1/C2/M1–4/m1–4/N1) maps to a story with no orphans, the spike-first sequencing front-loads the one real risk (FR-7), and all six spec-vs-code reconciliations (R1–R6) are accurate against the actual codebase. The vertical slices each stand alone for local testing. Three MAJORS land before implementation, all centering on the same root concern the spec under-weighted: **two Wllama models resident in a browser tab is a heavy, mobile-sensitive commitment, and the plan treats "spike GO" as binary when mobile may force a graceful-degrade path.** Plus a concurrency race in the SPA re-scrape lifecycle. All three are plan amendments, not rewrites.

**Stats:** 11 findings — 0 Blocker, 0 Critical, 3 Major, 4 Minor, 4 Note

## Findings

### MAJOR

#### [Maj1] Dual-model resident memory on mobile is unverified — spike scope too narrow, fork too binary
- **Location:** Story 1 (spike); Story 3; overview "Risk Areas".
- **Issue:** The spike tests whether two `new Wllama()` instances *coexist and function* (Q1/Q2) — desktop-flavored. It does not test whether two resident models (~22MB chat + ~33MB embedder GGUFs, plus KV caches + WASM linear memory) fit a mobile tab's RAM budget. Mobile Safari/Chrome WASM limits are real (~1–1.5GB, less on low-end Android). If both can't stay resident on mobile, the plan's binary GO/NO-GO breaks: desktop could GO (resident, fast) while mobile cannot — and the only alternatives are (a) the explicitly-rejected slow per-query swap, or (b) keyword retrieval (the NO-GO path). The plan has no "mobile degrades gracefully" story.
- **Risk:** Ships a widget that OOM-crashes the tab on the mobile target (CLAUDE.md: "works good in all screen"), or forces a premature global NO-GO because mobile failed.
- **Recommendation:** (a) Expand Story 1 spike Q2 to **observe peak resident memory** with both models loaded, and to run on a mobile/low-RAM target (real device or DevTools throttling isn't enough for memory — use a low-end Android or an iPhone). Record the number in `RESULT.md`. (b) Redefine GO: "resident within a mobile RAM budget (rough threshold: < ~700MB peak)." (c) Add the **mobile fallback** to the fork explicitly: if resident fails on mobile, mobile degrades to **context-less chat (today's behaviour)** — NOT keyword, NOT slow-swap. This keeps the binary GO/NO-GO intact (GO = embeddings wherever feasible; mobile silently context-less) and matches v1's trusted-static-site targets.

#### [Maj2] Embedder load timing (eager vs lazy) + combined payload unspecified
- **Location:** Story 3, Story 4; spec NFR Payload.
- **Issue:** The plan never says WHEN the 33MB embedder loads. Eager (on widget open, alongside the 22MB chat model) = ~55MB downloaded + resident before the visitor has asked anything — heavy for a site visitor who may never use the feature. Lazy (only when the first question arrives) = adds latency to the first answer but zero cost for visitors who just browse. The spec says "show progress for the ~33MB embedder + model loads" but doesn't decide sequencing. Today's `submitPrompt` awaits `loadModel()` lazily (App.jsx:338) — the chat model itself is already lazy.
- **Risk:** Eager load punishes every visitor with a 55MB hit; lazy load surprises the first asker with a multi-second "indexing…" delay if not surfaced.
- **Recommendation:** Specify **lazy** in Story 3/4: embedder loads on first question (after chat is ready), with a visible "Indexing this page…" state and graceful fallback to context-less chat if it fails. Note this also mitigates Maj1 (shorter resident window if the embedder is transient). Record the decision in the overview's UI/UX states.

#### [Maj3] Index lifecycle race: concurrent SPA re-scrape + in-flight query
- **Location:** Story 3 (`buildIndex`), Story 5 (hostNav re-scrape trigger); PoC `ragEngine.js` module-level `currentIndex`.
- **Issue:** The PoC holds `currentIndex` as a module-level reference that `initPageIndex` reassigns. Story 5 fires re-scrape on host nav (debounced). If a visitor asks a question while a re-scrape's `buildIndex` is mid-flight (embed in progress), the query's `retrieveRelevant` can run against the OLD index (stale, points at the previous route) or, if the reference swaps mid-query, a partially-built index. JS single-threading makes the reference swap itself atomic, but an in-flight query that started embedding against the old vectors returns stale section pointers — exactly the "confident wrong pointer" failure the SPA fix (FR-9) exists to prevent.
- **Risk:** Stale/wrong section pointers right after a route change — undermines the headline feature at the moment it's most visible.
- **Recommendation:** Cheap fix, note in Story 3 + Story 5: give the index a **version stamp / build-id**; `retrieveRelevant` captures the version it started with and re-runs (or returns "index updating, try again") if the version changed before completion. OR a build mutex that serializes re-scrape vs query. Either is ~10 lines. `// ponytail:` note the choice.

### MINOR

#### [min1] Prompt-injection via scraped content on non-trusted (UGC) embed sites
- **Location:** Story 4 (context → system message); spec assumption #4.
- **Issue:** Scraped host text becomes the model's context. On a trusted static site (v1 targets), the site owner injects into their own widget — not an attack. But FR-6's multi-site contract means anyone can embed private-chat on a UGC page (comments, forum); scraped UGC → prompt injection → model leaks/misbehaves. The spec's "host pages trusted" assumption doesn't hold there.
- **Recommendation:** NOTE for v1 (targets are trusted static sites). Add a `// ponytail:` at the context-injection site: trust assumption breaks on UGC embeds; revisit if/when third-party embeds are a real use case. Don't build defenses now.

#### [min2] `sources` → assistant-message wiring under-specified
- **Location:** Story 4 Build Order step 3.
- **Issue:** `streamMessages` (App.jsx:331) creates the assistant placeholder BEFORE `createCompletion`; `buildGroundedMessages` returns `{sources}` computed in `submitPrompt`. The plan says "stash sources on the assistant message" but doesn't pin the mechanism (attach to the placeholder object returned by streamMessages? a separate setter? post-completion merge?).
- **Recommendation:** Specify concretely: `streamMessages` returns the placeholder ref (or an id); `submitPrompt` attaches `sources` to that message in `chatSessions`/`messages`. One sentence in Story 4 to make it mechanical.

#### [min3] Embedder wasm-asset import source for the second Wllama instance
- **Location:** Story 3 (`embeddings.js` constructs `new Wllama(config)`).
- **Issue:** The singleton imports `wllamaSingle`/`wllamaMulti` via `?url` (wllama.js:1-5). The embedder's `new Wllama(config)` needs the same asset paths. If `embeddings.js` imports them *from wllama.js*, it couples the two and risks pulling singleton side-effects; if it imports the `?url` assets directly, it's clean.
- **Recommendation:** Story 3 note: import the wasm `?url` assets directly in `embeddings.js` (same import paths wllama.js uses), not via the singleton module.

#### [min4] "Stories 4–6 untouched by the NO-GO fork" is slightly optimistic
- **Location:** Story 3 NO-GO branch note.
- **Issue:** The plan claims the keyword-fallback preserves the public surface so Stories 4–6 are unaffected. Mostly true — but FR-3's min-score threshold is cosine-specific (0.25). Keyword/TF retrieval uses a different score scale, so the threshold constant/mechanism in Story 3/4 would need re-tuning under NO-GO.
- **Recommendation:** Soften the claim: "Stories 4–6 structurally unaffected; the score-threshold constant is re-tuned in the keyword re-plan." One-line edit.

### NOTES

#### [N1] Context size vs small-model generation quality
- Spec FR-4 already sized top-k to fit 270M–1B token windows (~1.2k tokens of context). Token budget is fine; whether a 270M model *follows* a long grounded instruction well is a quality question, covered by the spike's retrieval eval + Story 4's manual headline demo. No plan change.

#### [N2] Embed-mode default chat model not pinned
- Spec OQ#3 deferred model-selection UX. For v1 the embed path should use the existing default (LFM2-700M) unless the spike eval shows it's too weak to follow grounded context — then bump to Llama-3.2-1B or Gemma-3-1B. Decide in Story 1/4; default to current.

#### [N3] Real-model smoke test is manual
- Story 3's retrieval proof against real bge can't run in CI (33MB model). The DoD requires the manual smoke — acceptable; the mocked unit tests cover the cache/threshold logic. Document the smoke steps so it's repeatable.

#### [N4] CI has no test step today
- `.github/workflows/deploy-to-github-pages.yml` is deploy-only (trigger: `release/prod`); it runs `pnpm install` + `download-model.cjs` + `pnpm build`, no `test`. Adding vitest/playwright won't break CI. Optionally add a `pnpm test` job before deploy in a later hardening pass — not required for v1.

## Security Assessment

| Category | Status | Notes |
|----------|--------|-------|
| Authentication | N-A | No backend. |
| Authorization | N-A | Client-only. |
| Input Validation | OK | XSS: `Markdown.jsx` has no `rehype-raw`, react-markdown v10 escapes HTML by default (R6 verified). Scraped content renders as text. |
| Data Exposure | OK | 100% local; no page content leaves the browser. |
| Rate Limiting | N-A | No server; local inference self-limits. |
| Multi-tenancy | OK | IDB keyed by `origin+pathname`; sessionStorage per-tab. Shared `github.io` origin → no cross-project collision (different pathnames). |
| Prompt Injection | RISK (minor) | Scraped content → model context. Trusted on v1 static-site targets; breaks on UGC embeds (min1). |

## Spec Coverage (plan → spec)

| Spec Requirement | Story | Status |
|------------------|-------|--------|
| FR-1 host scrape | 2 | Covered |
| FR-2 Wllama embeddings | 3 | Covered |
| FR-3 retrieval + threshold | 3 | Covered |
| FR-4 grounded generation | 4 | Covered (R1: via `formatChat`→`createCompletion`, not dead `createChatCompletion`) |
| FR-5 related-links UI | 4 | Covered (markers shelved per spec Note) |
| FR-6 per-site config | 5 | Covered (R2: `PRIVATE_CHAT_CONFIG` net-new in embed.ts) |
| FR-7 dual-model spike | 1 | Covered (gate; Maj1 expands scope) |
| FR-8 rollout demo+portfolio | 6 | Covered |
| FR-9 SPA re-scrape | 5 | Covered (Maj3 adds race guard) |

No MISSING rows. No orphan stories. Spec-grill items (C1/C2/M1–4/m1–4/N1) all mapped (see overview "Spec-vs-Code Reconciliations" + per-story FR columns).

## Requirement Traceability (plan → original requirement)

| Original Requirement Point | Covered By | Status |
|----------------------------|------------|--------|
| "take data by scraping" | FR-1 → S2 | Covered |
| "train in browser (optional)" | Out of Scope (dropped → RAG) | Excluded |
| "agentic ai … info about website" | FR-3/4 → S3/S4 | Covered (grounded QA, not real agent — noted) |
| "pointing different section … easily" | FR-1/5 → S2/S4 | Covered |
| "use local in browser slm" (no API) | FR-2/4 → S3/S4 | Covered |
| "section … pointed as url with chat" | FR-5 → S4 | Covered (current-page; cross-page phase 2) |
| "with some other related message" | FR-5 (≤3 links) → S4 | Covered |
| "for all of my websites" | FR-6/8 → S5/S6 | Covered (v1 = 2 sites; rest via contract) |
| "same domain, /public-websites subpaths" | FR-6 (path-keyed IDB) → S3/S5 | Covered |
| "each project has their own repo" | FR-6 (no-fork config) → S5 | Covered |

No MISSING rows.

## Assumptions Made

1. Two resident Wllama instances fit a mobile tab's RAM — **risk if wrong: mobile OOM** (Maj1). Spike must verify.
2. bge-small retrieval quality suffices for section-finding — low risk, covered by spike eval (N1).
3. Host pages are trusted (site-owner content) — limits prompt-injection severity but not on UGC embeds (min1).
4. Lazy embedder load is the right timing — assumed in Maj2 recommendation.
5. The existing `formatChat`→`createCompletion` flow tolerates a longer grounded system message — low risk (token window sized in spec), small-model quality checked manually (N1).

## Missing from Plan

- [ ] Mobile-memory observation in the spike + mobile graceful-degrade path (Maj1)
- [ ] Embedder load-timing decision (eager vs lazy) (Maj2)
- [ ] Index version-stamp / build-mutex for the re-scrape race (Maj3)

## Questions for Author

None pivotal. The 3 MAJOR conditions are plan amendments the planner can apply directly (no product decision needed). OQ#2 (bge filename) and OQ#3 (embed model selection) resolve at implement time.

## Verdict Details

**PASS WITH CONDITIONS.** No blockers, no criticals. The plan is structurally sound — correct ordering, complete FR coverage, accurate reconciliations, valid vertical slices. The three MAJORS all reduce to "the dual-model commitment is heavier and more mobile-sensitive than the plan treats, plus one concurrency race" — each is a localized amendment, not a re-slice:

**Conditions before `/implement`:**
1. **[Maj1]** Expand Story 1 spike to measure resident memory on a mobile/low-RAM target; redefine GO to include a mobile-RAM budget; add "mobile degrades to context-less (not keyword, not slow-swap)" to the fork.
2. **[Maj2]** Specify **lazy** embedder loading (on first question, post-chat-ready, with progress + fallback) in Story 3/4 and the overview UI/UX states.
3. **[Maj3]** Add an index version-stamp / build-mutex note to Story 3 + Story 5 so a concurrent re-scrape can't serve a stale/partial index to an in-flight query.

Apply the 4 minors as inline notes during the same amendment pass. Then the plan is approved.
