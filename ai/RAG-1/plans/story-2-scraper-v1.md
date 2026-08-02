# Story 2: Host-page scraper (iframe-aware) (v1)

**Overview:** overview-v1.md · **FR:** FR-1, M4, m2 · **Depends on:** None (parallel-safe with Story 1; sequenced after it)
**Goal:** A pure-DOM module that turns the host page's visible content into `{ anchor, title, url, text }` sections — same-origin parent scrape, cross-origin graceful disable — unit-testable with jsdom, no model.

## Backend (lib)
- `src/lib/scraper.js` — **create** (adapt from `test-files/files/scraper.js`). Exports: `scrapeCurrentPage(rootEl?)`, `chunkSections(sections, {maxWords=220})`, `hashText(text)`.
  - Keep: `resolveRootDoc()` (parent.document via same-origin, catch SecurityError → fallback to own document), `SKIP_TAGS`, hidden/aria-hidden skip, slug assign on id-less headings, `buildUrl`.
  - **Add (grill M4):** collision guard. Before `node.id = slug`, check `rootDoc.getElementById(slug)`; if taken, suffix (`faq`, `faq-2`, …) until free. Extract a helper `uniqueSlug(baseText, rootDoc)` so it's unit-testable.
  - **Note (grill m2):** `hashText` stays 32-bit djb2 (fine for v1 small sites). Add `// ponytail: 32-bit non-crypto hash, collision risk on large/diverse pages; switch to SubtleCrypto SHA-256 if a site exceeds ~10k chunks` at the function.
- No other file touched. No FE this story.

## How to Test
- **AI/automated (Vitest + jsdom — being added in this story's test setup, see Story 6 for the full harness; here, the minimal runner):**
  1. Add `vitest` + `jsdom` devDeps (first introduction — Story 6 owns the full Playwright layer; this story owns the unit runner + scraper tests). Add `pnpm test` script (`vitest run`).
  2. `src/lib/__tests__/scraper.test.js`:
     - Parse `test-files/poc/host.html` into jsdom; `scrapeCurrentPage()` → assert ≥3 sections with anchors `pricing`, the FAQ slug, `contact`; each `url` = `<origin>/<path>#<anchor>`; iframe's own body NOT scraped (set jsdom `window.parent` to the host doc).
     - **Collision guard:** inject a second `id="pricing"` on a heading → scraped slug becomes `pricing-2`, original untouched.
     - **Cross-origin disable:** stub `window.parent.document` getter to throw → `resolveRootDoc` returns own doc (no crash).
     - **Skip tags / hidden:** a `<nav>`, `aria-hidden`, `hidden` element's text absent from sections.
     - `chunkSections`: a 500-word section → 3 chunks (220/220/60), each carrying parent's anchor+url.
     - `hashText`: same input → same hash; different input → different hash.
- **Human:** optional — load poc/host.html + frame.html over http, call `scrapeCurrentPage()` from the console, eyeball sections.
- **Correct =** `pnpm test` green, all assertions above pass.

## Test / DoD (local)
- [ ] `/verify` green (`pnpm lint` + `pnpm test`)
- [ ] `src/lib/scraper.js` exists with the three exports + collision guard
- [ ] Scraper unit tests pass (same-origin scrape, cross-origin disable, collision suffix, skip-tags, chunking, hash)
- [ ] No `@xenova/transformers` or any new runtime dep introduced (scraper is pure DOM)

## Notes
- **iframe→parent scrape is already proven** (test-files/poc). This story productizes it; don't re-prove the mechanism.
- **jsdom limitation:** jsdom has no real `window.parent` for an iframe. Test setup constructs a fake parent: set `Object.defineProperty(window, 'parent', { value: parentWindow })` where `parentWindow.document` is the host doc (or a throwing getter for the cross-origin case). Document this in the test file header.
- **`buildUrl` uses `doc.location`** — for the parent doc that's `window.parent.location`, already validated same-origin by `resolveRootDoc`. Safe.
- Deferred to Story 3: the SPA re-scrape *trigger* (FR-9) lives in Story 5; this story only builds the scrape function itself.
- Deferred to Story 5: `getCombinedIndex` / site-index merge code stays in `siteIndex.js` (ported from PoC) but isn't wired until Story 5.
