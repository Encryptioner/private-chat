# Plan Overview: RAG-1 — Site-aware RAG for the private-chat widget (v1)

**Date:** 2026-08-02
**Version:** v1
**Spec:** See `../requirements/spec-v1.md` (unchanged — deployable target)
**Approach:** Vertical (story slices)
**Status:** Implemented *(Stories 1–6 complete; 49 unit tests green; build + embed green. Human gate pending: model-backed Playwright E2E + portfolio-template deploy/verify — see post-impl summary.)*

## Approach Summary

Vertical: the spec is split into 6 stories, each a thin slice through scraper → embed → retrieve → generate → UI that ends at something locally testable. The first story is a **spike gate** (FR-7), not a feature slice — it decides whether the neural-embeddings path is viable at all. If the spike passes, Stories 2–6 build the full embedding-based RAG. If it fails, the plan re-opens and Stories 3–4 collapse to keyword/TF retrieval (per spec FR-7's mandated fallback — never the slow per-question model swap). One deploy at the end; each story is a local checkpoint, not a ship.

## Slicing Principle
- Every feature story cuts through the stack and ends at a DoD (concrete local test). The spike (Story 1) is the lone exception — it ends at a documented GO/NO-GO decision, which the skill explicitly allows for a hard gate.
- Full spec is the objective — stories redistribute it, nothing dropped (see FR coverage column).
- One deploy, many local checkpoints — no per-story shipping. Branch deploys once, at the end.
- Each story ends at a DoD. `/verify` green at every story boundary.

## Spec-vs-Code Reconciliations *(discovered during planning — mechanism, not scope)*

These refine HOW an FR is implemented; none change a requirement or acceptance criterion. Flagged here so `/implement` doesn't rediscover them:

| # | Spec says | Code actually does | Story affected | Action |
|---|-----------|--------------------|----------------|--------|
| R1 | FR-4: feed top-k to `createChatCompletion` | `createChatCompletion` is **dead code** (wllama.js:241, never called). App uses raw `wllama.createCompletion(formatChat(...))` with a Jinja-rendered prompt (App.jsx:339-352) | Story 4 | Inject retrieved context into the **system message** that `formatChat` renders; do NOT call `createChatCompletion`. Requirement unchanged. |
| R2 | FR-6: embed.js reads `window.PRIVATE_CHAT_CONFIG` | `PRIVATE_CHAT_CONFIG` is read **nowhere**. embed.ts forwards only the `<script src>` query string (embed.ts:69-71) | Story 5 | Add the `window.PRIVATE_CHAT_CONFIG` read in embed.ts, merge into forwarded query params. Net-new code (spec's stated contract). |
| R3 | FR-7: two Wllama instances coexist? | Singleton `getWllamaInstance` (wllama.js:262-339) shares ONE core via `window.wllamaGlobalInstance`; 2nd `new Wllama()` → "already initialized" → throwing mock (304-323) | Story 1 (spike) | Spike tests **independent** `new Wllama()` instances bypassing the singleton. Open question — gate. |
| R4 | chatStorage persistence | `chatStorage.js` uses **localStorage** (per-domain). Spec FR-5 m1 wants **sessionStorage** for embed cross-nav | Story 4 | Add a storage-type path for embed-mode visitor conversations; standalone app unchanged. |
| R5 | SW caches both GGUFs (runtime) | `public/sw.js` caches **zero `.gguf`** — `MODEL_CACHE` declared, never written; regex matches only `js\|css\|wasm` (sw.js:108) | Story 6 | Add a `.gguf` runtime-cache branch writing to `MODEL_CACHE`. |
| R6 | Security: confirm no `rehype-raw` | `Markdown.jsx` has **no `rehype-raw`**, no remark/rehype plugins; react-markdown v10 escapes raw HTML by default | Story 6 | **Verified safe — no action.** Note in NFR. |

## Stories

| # | Story | Delivers (locally testable) | Lib (BE-equivalent) | FE | FR coverage | Depends on |
|---|-------|------------------------------|---------------------|----|-------------|------------|
| 1 | Spike gate: dual-Wllama + bge eval | GO/NO-GO doc on two-instance coexistence + retrieval quality | `test-files/spike/*` | — | FR-7, N1 | — |
| 2 | Host-page scraper | Sections `{anchor,title,url,text}` from parent DOM, jsdom-tested | `src/lib/scraper.js` | — | FR-1, M4, m2 | — (parallel with 1) |
| 3 | Local index + retrieval | Vector index in IDB; query → top-k above threshold | `src/lib/embeddings.js` | — | FR-2, FR-3, M1(partial) | 1 (hard: GO), 2 (hard) |
| 4 | Grounded generation + related-links UI | "Where is pricing?" → grounded answer + ≤3 links; click scrolls host | `src/lib/ragEngine.js` | `src/App.jsx` + list component | FR-4, FR-5, R1, m1, R4 | 3 (hard) |
| 5 | Per-site config + SPA re-scrape | One embed.js, many sites; stays fresh on SPA route change | `src/lib/siteIndex.js`, `src/scripts/embed.ts` | `src/App.jsx` (query-param read) | FR-6, FR-9, m3, m4, R2 | 2 (hard), 3 (soft), 4 (soft) |
| 6 | Rollout + SW cache + degradation + tests | portfolio-template site-aware; robust to load/IDB/empty/threshold failures; Playwright harness | `public/sw.js`, `src/lib/*` degradation | `portfolio-template` snippet | FR-8, M1, M2, M3, R5, R6 | 1–5 |

**FR split across stories — explicit:** FR-2/FR-3 (index+retrieve) land in Story 3; FR-4/FR-5 (generation+links) in Story 4. They form ONE user-visible capability ("ask a question, get a grounded answer with links") split only so retrieval is verifiable in isolation before wiring the UI. FR-7 lives entirely in Story 1 (the gate).

## Implementation Order & Dependencies

```
                         ┌── GO ──┐
 1 (spike gate) ─────────┤        ├─▶ 3 (index+retrieve) ──▶ 4 (grounded+links) ─┐
                         └─ NO-GO ┘                                                │
 2 (scraper) ────────────────────────┴──────────────────▶ 5 (config+SPA) ─────────┤
                                                              │                     │
                                                              └──▶ 6 (rollout+SW+degradation+tests)
```

- **Story 1 before Story 3/4** (hard): the embeddings path does not exist until the spike says GO. If NO-GO → stop, re-plan Stories 3/4 as keyword retrieval, spec reopens (grill C1 condition).
- **Story 2 is parallel-safe with Story 1** (pure DOM, no model) — but sequenced after the gate so we don't build on a path that might be dropped. Do 1 first.
- **Story 5 needs Story 2** (hard: re-scrape needs the scraper) and Story 3 (soft: proves re-embed on content change). Full E2E needs Story 4 (soft).
- **Story 6 needs all** — it is the rollout + hardening capstone.

## Dependencies
- **No shared packages / monorepo.** Single repo. No npm runtime dep added (transformers.js explicitly excluded per spec; embedder is a Wllama GGUF, not a new lib). Dev deps added: `vitest`, `jsdom`, `@playwright/test` (grill M2 — none exist today).
- **External:** embedder GGUF `bge-small-en-v1.5-Q4_K_M` (~33MB) from HuggingFace (`unsloth/bge-small-en-v1.5-GGUF` or `CompendiumLabs/bge-small-en-v1.5-gguf` — confirm exact filename at implement time, spec OQ#2). Served from HF CDN in prod (like other presets), `public/models/` for localhost.
- **Downstream consumers:** `portfolio-template` and `linkedinify` embed private-chat via `encryptioner.github.io/private-chat/embed.js`. RAG changes to embed.ts/embed.js are backward-compatible (config is optional; missing → live-scrape only). No consumer fork required.

## Risk Areas
1. **FR-7 spike fails** (highest risk) → embeddings dropped for v1, re-plan to keyword retrieval. Baked into Story 1 + Story 3 fork; spec already mandates keyword fallback. Blast radius: Stories 3/4 reshape, not collapse — scraper/UI/rollout all survive.
2. **Two-model resident memory on mobile** (grill Maj1) → spike Q4 measures peak RAM on a low-end device; if mobile can't hold both, mobile degrades to context-less chat (NOT keyword/slow-swap). Desktop GO is independent of mobile.
3. **bge retrieval quality insufficient** for section-finding (spec N1) → mitigated by the eval inside Story 1's spike; if weak, tune chunk size/threshold before committing.
4. **SPA re-scrape race** (grill Maj3) → concurrent re-scrape + in-flight query could serve stale/partial pointers; index version-stamp (Story 3) + atomic swap (Story 5) discards stale `sources`.
5. **SPA re-scrape cost** (MutationObserver on host body) → debounce + contentHash no-op keeps it cheap; benchmark in Story 5.
6. **33MB embedder payload on first visit** → lazy-loaded (on first question, not open — grill Maj2); runtime-cached only (Story 6, R5), never precached; show progress, never block chat UI.
7. **Iframe scrape cross-origin** → already proven same-origin; cross-origin degrades gracefully (FR-1). No new risk.

## Alternative Approaches Considered
- **Keyword-only v1 (grill C1 option A):** drop embeddings entirely, retrieve via TF/keyword. Rejected by the user (spec clarification #7: commit to embeddings). Kept as the spike's NO-GO fallback.
- **Horizontal (types → lib → UI):** rejected — the spec is one cohesive capability (site-aware QA), and the spike gate must resolve before any embedding-layer work is worth doing. Vertical front-loads the risk.
- **transformers.js for embeddings (PoC's choice):** rejected by spec FR-2 — adds a second WASM runtime + 90MB dep; Wllama embedder reuses the existing runtime and a smaller (33MB) model.

## Local Testing Cadence
Per story DoD: run the app (or spike harness), exercise the manual/automated test in the story's "How to Test", confirm `/verify` green before the next story. No feature flag — but each story is safe to leave mid-build because the RAG path is strictly additive: until Story 4 wires it into `App.jsx`, the widget behaves exactly as today. "Safe to leave mid-build" = the existing chat flow is untouched until Story 4's `submitPrompt` hook lands.

## Deployment Note
Every story tested incrementally; full feature deploys as one unit once all acceptance criteria pass. **No partial rollout** — portfolio-template gets the embed snippet only after Story 6 verifies the full path. Demo page (same origin) is the first verification target.

## UI/UX Considerations
- **User flows affected:** visitor opens the chat widget on an embedded site → asks "where is pricing / how do I contact" → gets a grounded answer + "Related sections" links → clicks a link → host page scrolls/navigates. Normal-user experience: the bot now "knows the page" without any technical context.
- **States (per story ownership):**
  - Loading: embedder/model load progress → Story 3 (index build) shows progress; Story 4 surfaces "Indexing this page…" if a question lands mid-build. Embedder loads **lazily on first question**, not on open (Maj2); mobile-RAM-short falls back to context-less (Maj1).
  - Empty: page yields 0 chunks → Story 4/6 (skip grounding, generic chat, no links).
  - Error: embedder GGUF load fails / IDB unavailable → Story 3/6 (degrade to context-less, silent).
  - Success: grounded answer + ≤3 links → Story 4.
- **Normal-user clarity:** "Related sections" labeled plainly; links show the section title, not an anchor slug.
- **Accessibility:** links are real `<a href>` (keyboard-focusable, screen-reader label = section title); highlight on scroll uses outline (visible, removable). Related-links list stacks within the chat panel on mobile (NFR Responsive, Story 4).
- **Feedback:** brief host-element highlight on same-page scroll (existing navigateToSection); cross-page nav is a normal link click (no toast needed).
