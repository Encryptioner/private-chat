# Story 5: Per-site config contract + SPA host re-scrape (v1)

**Overview:** overview-v1.md · **FR:** FR-6, FR-9, m3, m4, R2 · **Depends on:** Story 2 (hard — re-scrape needs `scrapeCurrentPage`), Story 3 (soft — re-embed proof via `buildIndex` contentHash no-op), Story 4 (soft — full E2E)
**Goal:** One unmodified `embed.js` serves many sites via `window.PRIVATE_CHAT_CONFIG` (optional `siteIndexUrl`, `label`), forwarded host→iframe as query params. And: on a client-side-routed SPA host (the named v1 target `portfolio-template` is React/CRA), the index re-scrapes when the route changes — general mechanism, not a per-site patch.

## Build Order
1. **Config contract in `embed.ts`** (R2, m3) — in `_createIframe` (embed.ts:61-86), BEFORE building the iframe URL: read `window.PRIVATE_CHAT_CONFIG` (host context — embed.ts runs in the host, so it CAN read host window, unlike the iframe). Merge its keys (`siteIndexUrl`, `label`, + any accent theming) into `this.embedQueryParams` so the existing forwarding loop (embed.ts:69-71) carries them onto the iframe URL. Missing config → no keys added → live-scrape only (FR-6). → manual: host sets `window.PRIVATE_CHAT_CONFIG = { label: "Acme" }` before the script tag; iframe URL includes `?label=Acme`.
2. **App reads config from query params** (FR-6, m3) — in `App.jsx` init `useEffect` (App.jsx:149-192, which already reads `system`/`domain`/`embedded`): also read `siteIndexUrl`, `label`. `label` → greeting/title (embed mode only); `siteIndexUrl` → passed to the index layer. → manual: `?label=Acme&siteIndexUrl=/site-index.json` → greeting shows "Acme", static index fetch attempted.
3. **`siteIndex.js` — config via param, not host window** (m3) — port from `test-files/files/siteIndex.js` but **change the resolver**: `resolveIndexUrl(explicitUrl)` priority = (1) explicit arg, (2) the `siteIndexUrl` query param read in App and passed in, (3) fallback `/site-index.json`. **Remove** the direct `window.PRIVATE_CHAT_CONFIG?.siteIndexUrl` read (the iframe can't see host window cross-origin — m3). `getCombinedIndex(livePageVectors, indexUrl)` merge logic unchanged (de-dupe by url, live wins). → unit: resolver returns the param value; missing → `/site-index.json`; fetch failure → `[]`.
4. **SPA re-scrape trigger (FR-9, m4 — general)** — a `src/lib/hostNav.js` (or inline in `ragEngine.js`): when in embed mode + same-origin parent, install listeners: `popstate`, `hashchange`, and a debounced `MutationObserver` on the host body subtree. On any firing, compare current host `location.pathname` to last-scraped path; if changed (or content `hashText` changed), re-run `scrapeCurrentPage → chunkSections → buildIndex` (contentHash makes unchanged content a no-op embed). Debounce ~500ms; disconnect on widget close. **Race coordination (grill Maj3):** the re-scrape must atomically swap the live index reference AND bump its `version` (from Story 3 step 5). An in-flight query (Story 4's `buildGroundedMessages`) that captured the old version then sees a newer one discards its `sources` rather than serving pointers from the stale/pre-update route. A build mutex serializing re-scrape vs query is an acceptable alternative. → manual/E2E: in an SPA harness, click a client-side route link → assert re-scrape fires + index reflects new route's content; navigating to a route with identical content → no re-embed; fire a question mid-re-scrape → no stale pointers served.

## Backend (lib)
- `src/lib/siteIndex.js` — **create** (adapt PoC; fix the host-window read per m3).
- `src/lib/hostNav.js` — **create** (or inline in ragEngine): `installHostNavWatcher({onNavigate})`, `uninstall()`. General SPA detector (works for CRA/Next/Vue — m4), not portfolio-specific.
- `src/lib/ragEngine.js` — **modify**: `initPageIndex(siteIndexUrl)` now calls `getCombinedIndex`; wire `installHostNavWatcher` to re-trigger indexing on host nav (Story 4 left this as one-shot).

## Frontend
- `src/scripts/embed.ts` — **modify** `_createIframe`: read `window.PRIVATE_CHAT_CONFIG`, merge into forwarded query params (R2).
- `src/App.jsx` — **modify** init `useEffect`: read `siteIndexUrl`, `label` from query params; pass `siteIndexUrl` into `initPageIndex`; apply `label` to greeting/title in embed mode.

## Other Deliverables
- An SPA test harness `test-files/spa-host.html` — a tiny fake SPA (2 "routes" swapped via JS, no full reload) that embeds the chat, so the re-scrape trigger is testable without portfolio-template deployed.

## How to Test
- **Human:**
  1. **Config:** `test-files/spa-host.html` sets `window.PRIVATE_CHAT_CONFIG = { label: "Acme Labs", siteIndexUrl: "/none.json" }` before loading embed.js → chat greeting shows "Acme Labs"; missing-config variant → default greeting + live scrape.
  2. **SPA re-scrape:** in `spa-host.html`, click "Go to Route B" (client-side) → ask "what's on route B" → answer grounds in Route B's content (not Route A's). Click back to A → re-scrape, A's content returns.
- **AI/automated:**
  - Vitest: `siteIndex.resolveIndexUrl` (param → fallback); `hostNav` debounce + path-change detection (fake history + a mock MutationObserver).
  - **Playwright (`/test-playwright` scoped here):** load `spa-host.html`, click Route B, ask a Route-B question, assert answer references Route B content (proves re-scrape fired). This is the FR-9 acceptance test.
- **Correct =** config flows host→iframe→App; label shows; SPA route change re-scrapes + re-embeds only on content change; cross-origin (no parent access) skips the watcher gracefully.

## Test / DoD (local)
- [ ] `/verify` green
- [ ] `window.PRIVATE_CHAT_CONFIG` read in embed.ts (host context) → forwarded as query params → App reads them (R2, m3 explicit + tested)
- [ ] No `window.PRIVATE_CHAT_CONFIG` read inside the iframe (m3 — iframe can't see host window)
- [ ] `label` shows in greeting (embed mode); missing config → live-scrape only, default label (FR-6)
- [ ] SPA route change → re-scrape + index reflects new route (FR-9); identical content → no re-embed
- [ ] Watcher is general (works on the fake SPA, not hardcoded to portfolio-template) — m4
- [ ] Cross-origin parent → watcher never installs / no crash

## Notes
- **embed.ts is the ONLY host-context code.** It can read `window.PRIVATE_CHAT_CONFIG`; the iframe (App.jsx) cannot (cross-origin). That's why config must be forwarded as query params (m3). Keep this boundary strict.
- **MutationObserver cost:** observe `{childList:true, subtree:true}` on host body, debounce 500ms, and short-circuit on unchanged `hashText`. Benchmark on a heavy SPA in Story 5 — if it thrashes, narrow to `childList` only (no `subtree`) or raise debounce. `// ponytail:` note the debounce choice.
- **`popstate`/`hashchange` alone miss pushState navigations** (React Router's default). The MutationObserver is the catch-all; the history events are fast-path. All three are needed for general SPA support (m4).
- **site-index.json is still phase-2** (no crawler ships). This story only honors it IF a host provides `siteIndexUrl`. The merge code (`getCombinedIndex`) is ported now so the contract is complete; a missing file → `[]`, silent.
- `portfolio-template` itself gets its embed snippet in Story 6 (rollout). This story proves the mechanism on `spa-host.html`.
