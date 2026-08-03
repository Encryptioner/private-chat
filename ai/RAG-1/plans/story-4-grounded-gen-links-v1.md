# Story 4: Grounded generation + related-sections UI (v1)

**Overview:** overview-v1.md · **FR:** FR-4, FR-5, R1, m1, R4 · **Depends on:** Story 3 (hard — needs `buildIndex`/`retrieveRelevant`), Story 2 (hard — `retrieveRelevant` consumes scraped chunks)
**Goal:** A visitor asks "where is pricing" → the model answers ONLY from retrieved page context (no `[[section]]` markers), and up to ~3 "Related sections" links render from the retrieval results; clicking scrolls (same page) or navigates (cross-page) the host. Conversation survives a cross-page navigation via sessionStorage.

## Build Order
1. **`ragEngine.js` — grounded message builder** — `buildGroundedMessages(userQuestion, priorMessages, index)` → `{ messages, sources }`. System message = base instructions + ONLY top-k chunks (with `url`), each formatted `(i) [anchor: x] (url) text`. Strip the PoC's `[[section:]]` marker instructions entirely (spec FR-5 Note: markers shelved for v1; links come from `sources`, not the model). → unit: builder returns ≤TOP_K chunks, never the whole page, includes `url` per chunk.
2. **`navigateToSection({url, anchor})`** — port from PoC ragEngine.js (same-page smooth-scroll + transient outline highlight on host; cross-page → `window.parent.location.href = url`; cross-origin parent → best-effort `window.location`). → unit (jsdom): same-page calls `getElementById(anchor).scrollIntoView`; cross-path sets `location.href`.
3. **Wire into `App.jsx` `submitPrompt`** (App.jsx:311-355) — the RAG hookpoint. When embed mode + an index exists: before `formatChat`, call `buildGroundedMessages` to get `{ messages, sources, version }`, build the system message from it (replaces/augments `customSystemMessage` for this turn), then pass through the **existing** `formatChat(wllama, messages)` → `wllama.createCompletion(formatted, {nPredict, sampling, onNewToken})` flow (App.jsx:340-352). **`sources` wiring (grill min2):** `streamMessages(currentPrompt, sessionId)` (App.jsx:331) returns the `onNewToken` callback AND creates the assistant placeholder; capture the placeholder's id/ref, then attach `sources` to that assistant message in both `messages` and `chatSessions[sessionId].messages` right after `buildGroundedMessages` resolves (before/around the completion), so `RelatedSections` can render once the assistant message exists. Capture `version` from `buildGroundedMessages`; if the live index version changed by completion (Story 5 re-scrape, Maj3), discard `sources` for this turn (no stale links). → **Load-bearing: do NOT call `createChatCompletion` (dead code, R1). Reuse the proven `createCompletion` path. If the grounded system message breaks `formatChat`'s Jinja template, STOP — small models choke on malformed prompts.**
4. **Related-links list component** — a small component (e.g. `src/components/RelatedSections.jsx`) rendering ≤3 links from `message.sources` (each `title` → `url`), hidden when `sources` is empty or all below threshold (Story 3 already filtered). On click → `navigateToSection`. Rendered under the assistant message inside the chat panel. → renders within mobile width (NFR Responsive).
5. **sessionStorage persistence (m1, R4)** — extend `src/lib/chatStorage.js` with a storage-type option: embed-mode visitor conversations persist to **sessionStorage** (survives the host reload on cross-page nav, clears on tab close — appropriate for a site visitor); standalone app keeps localStorage. On App init in embed mode, restore from sessionStorage. → unit: a saved session round-trips through sessionStorage; cross-page nav (simulated by re-init) restores it.

## Backend (lib)
- `src/lib/ragEngine.js` — **create** (adapt from `test-files/files/ragEngine.js`): `buildGroundedMessages`, `navigateToSection`. **Drop** `extractSectionPointer` + the marker `SYSTEM_INSTRUCTIONS` (markers shelved). Keep `initPageIndex` thin (scrape → chunk → buildIndex) — but the index lifecycle/trigger is owned by Story 5 (SPA re-scrape); here `initPageIndex` is called once on first question if no index.
- `src/lib/chatStorage.js` — **modify**: add `storage` param (`'local'` default, `'session'` for embed) to `saveChatSessions`/`loadChatSessions`; route to `localStorage`/`sessionStorage`. No behavior change for standalone.

## Frontend
- `src/App.jsx` — **modify** `submitPrompt` (311-355): RAG branch (embed mode + index). Add `sources` to assistant message shape. Restore-from-sessionStorage on embed init.
- `src/components/RelatedSections.jsx` — **create**: ≤3 `<a>` links from `message.sources`, click → `navigateToSection`.
- `src/components/Markdown.jsx` — **no change** (verified no `rehype-raw`, R6; scraped content renders safe). Confirm still no raw-HTML plugin after this story.

## How to Test
- **Human (the headline demo):**
  1. `pnpm run dev`.
  2. Open `test-files/poc/host.html` over http with the chat frame pointed at the dev app (or use `public/test-embed.html` adapted to serve the dev build).
  3. Ask "where is pricing" → assistant answer references $9/$29 pricing (grounded), AND a "Pricing" link appears.
  4. Click "Pricing" → host page smooth-scrolls to `#pricing`, brief outline highlight.
  5. Ask an unrelated question ("explain quantum computing") → answer says it's not on the page (or generic), NO related-links render (below threshold).
  6. Click a cross-page link (if poc has one) or navigate host → return → chat history restored (sessionStorage).
- **AI/automated:**
  - Vitest: `buildGroundedMessages` ≤ TOP_K chunks + url per chunk; `navigateToSection` same/cross-page; chatStorage sessionStorage round-trip.
  - **Playwright (scope `/test-playwright` here — Story 6 owns the full harness, this story adds the core RAG E2E):** load poc host, ask "where is pricing", assert assistant answer contains "pricing"/"$", assert a link with text "Pricing" present, click it, assert host scrolled (URL hash `#pricing` or element in viewport).
- **Correct =** grounded answer + link appears + scroll works + no links on off-topic + history survives nav.

## Test / DoD (local)
- [ ] `/verify` green (`pnpm lint` + `pnpm test`)
- [ ] RAG branch in `submitPrompt` uses `formatChat`→`createCompletion` (NOT `createChatCompletion`) — R1 respected
- [ ] `[[section:]]` marker code absent (markers shelved) — links come from `sources`
- [ ] "Where is pricing" → grounded answer + Pricing link; click scrolls host
- [ ] Off-topic question → NO related-links (threshold holds)
- [ ] Empty index / 0 chunks (all-nav page) → generic chat, no links, no crash (M1)
- [ ] Cross-page nav → chat history restored from sessionStorage (m1, R4)
- [ ] Related-links list renders within mobile width

## Implementation Notes (2026-08-03)

- **`buildGroundedMessages` → `buildGroundedContext`** (renamed). The PoC returned a full
  messages array; the shipped version returns `{ systemContent, sources, version }` so
  `App.jsx` stays the single owner of the Jinja-bound message list (id generation, 4-msg
  window, `formatChat`). App wraps the string as `{ role: ROLE.system, content: systemContent }`.
- **Note 49 (system-message precedence):** in grounded mode the grounded system message
  **replaces** `customSystemMessage` for that turn; `customSystemMessage` (incl. the `?system=`
  host param) still governs the **context-less** path (empty retrieval / non-embed). Both
  behaviors are explicit branches in `submitPrompt`. A future refinement could prepend a host
  `?system=` prefix to the grounded message — not done for v1 (avoids dual "you are an
  assistant" instructions confusing small models).
- **Sources wiring (min2):** `streamMessages` now returns `{ onNewToken, assistantId }`;
  `submitPrompt.attachSources(sources)` maps the placeholder by id in both `chatSessions` and
  `messages`, and is reused to clear sources on the Maj3 version mismatch.
- **`getCurrentIndexVersion()`** is wired now even though Story 4 is one-shot — Story 5's SPA
  swap needs zero `App.jsx` changes for the race guard.

## Notes
- **`createChatCompletion` stays dead.** Do not "fix" it by routing RAG through it — that's a larger change with its own risks. Inject context into the system message the existing flow already renders. (R1)
- **`message.sources` is a new optional field** on the assistant message. `chatStorage` must tolerate it (JSON.stringify handles it; sessionStorage carries it). No migration — existing localStorage sessions just have `sources: undefined`.
- **Index-on-first-question latency (grill Maj2):** the embedder loads LAZILY on the first question (Story 3's `getEmbedder` is a deferred promise — no load on widget open). If the visitor asks before the index builds, show an "Indexing this page…" state and defer the completion until `buildIndex` resolves (or fall back to context-less if it fails / mobile-RAM-short, per Story 1 Maj1). Don't block silently; surface progress for the ~33MB fetch + embed.
- **`customSystemMessage` vs grounded system:** in embed mode with an index, the grounded system message REPLACES `customSystemMessage` for that turn (the `?system=` query param still wins for the base instruction prefix). Keep both behaviors explicit in `submitPrompt`.
- **Prompt-injection awareness (grill min1):** scraped host text becomes model context. On v1's trusted static-site targets the site owner injects into their own widget — not an attack. But FR-6's multi-site contract means anyone could embed on a UGC page (comments/forum) where scraped UGC → prompt injection. Add a `// ponytail:` at the context-injection site: trust assumption breaks on UGC embeds; revisit if third-party embeds become real. No defense built for v1.
- **sessionStorage scope:** keyed per tab. Two tabs on the same site = independent visitor chats. Correct for a site-aware widget. Standalone app (the app owner's tool) keeps its localStorage sessions.
- The SPA re-scrape *trigger* (rebuild index on host nav) is Story 5; this story calls `initPageIndex` once. Story 5 will make it re-fire on route change.
