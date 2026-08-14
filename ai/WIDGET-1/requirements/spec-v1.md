# Spec: WIDGET-1 — Host-configurable widget position & icon (v1)

**Date:** 2026-08-12
**Version:** v1
**Status:** Grilled
**Original Requirement:** See `original-requirement.md`

## Overview

Adds two new `PRIVATE_CHAT_CONFIG` fields — `position` and `icon` — that let a host site override the floating widget's screen corner/offset and its toggle-button icon. Both are read host-side in `embed.ts` (they configure the widget's outer chrome, not the iframe's own content) and are fully optional: a host that sets neither sees pixel-identical output to today.

### Strategic Context
- **Problem:** The floating widget's position and icon are hardcoded in `embed.ts`, so every host site gets an identical bottom-right chat bubble regardless of what's already occupying that corner of their own UI.
- **Who:** Any site embedding private-chat's floating widget — immediately, `branchdiff` (tracked separately as `CHATBOT-1`, blocked on this ticket), whose own "back to top" button occupies the exact same corner/offset.
- **Why now:** `CHATBOT-1` can't safely ship without it — the collision was confirmed pixel-for-pixel (same 24px bottom/right offset, private-chat's button 56×56 vs. back-to-top's 40×40, private-chat's `z-9999` guaranteeing it renders on top).
- **If not this:** Either `CHATBOT-1` ships with a visible UI collision, or the fix gets hacked into branchdiff's own `back-to-top.tsx` — coupling an unrelated component's layout to whether an opt-in third-party widget happens to be enabled, and leaving every *future* consumer with the same corner problem to solve again from scratch.

## Clarifications
1. **Q:** Which corners should the position config support?
   **A:** `bottom-right` (current default) and `bottom-left` only. Top corners are out of scope — the tooltip/panel-open-direction logic currently assumes bottom-anchoring, and re-deriving it for a need nobody has yet isn't worth the surface area.
2. **Q:** Corner presets only, or configurable offsets too?
   **A:** Configurable pixel offsets as well — "how much right, how much left, how much px will be in bottom." Not just an enum.
3. **Q:** What should be configurable on the chrome, and in what format?
   **A:** The toggle button's icon only, as an emoji string or an image URL. Header text/emoji and accent colors stay hardcoded (separate, smaller surface than doing all three at once).
4. **Q:** Does branchdiff need this AND custom branding in the same pass?
   **A:** N/A to this ticket directly (branchdiff's own decision, recorded in `CHATBOT-1`) — branchdiff ships with defaults, using only `position`.

## Functional Requirements

### FR-1: `PRIVATE_CHAT_CONFIG.position` — corner + pixel offsets
- **Description:** A new optional config field controlling where the floating widget (button + panel) sits on screen.
  ```ts
  position?: {
    corner?: 'bottom-right' | 'bottom-left'; // default: 'bottom-right'
    bottom?: number;  // px from the bottom edge, default: 24
    side?: number;    // px from the side edge named by `corner`, default: 24
  }
  ```
  `side` means "from the right" when `corner` is `bottom-right`, and "from the left" when `corner` is `bottom-left" — one field, meaning depends on which corner is active, rather than two mutually-exclusive `left`/`right` fields that could be set in conflicting combinations.
- **Req ref:** "Can we allow some param which can be passed by host website to private chat to position the chatbot" + "bottom-right (default) + bottom-left. With position say how much right, how much left, how much will px will be in bottom"
- **Acceptance criteria:**
  - [ ] Unset `position` → widget renders at `bottom:24px; right:24px` exactly as today (byte-identical inline styles).
  - [ ] `position: { corner: 'bottom-left' }` → widget's outer wrapper anchors `bottom:24px; left:24px` instead of `right:24px`.
  - [ ] `position: { corner: 'bottom-left', bottom: 40, side: 16 }` → wrapper anchors `bottom:40px; left:16px`.
  - [ ] When `corner` is `bottom-left`, the chat panel (`chatContainer`, currently `right: 0` relative to the wrapper) and the hover tooltip (`badgeTooltip`, currently `right: 0`) both open/anchor from the **left** instead, so the panel never renders off-screen or overlapping the button.
  - [ ] The existing small-screen override (`@media max-width: 480px`, `inset: 0 !important` fullscreen) is unaffected by `corner` — verified it already zeroes all four edges regardless of which edge the desktop layout anchored to.
  - [ ] `position` has **no effect** in inline-div embed mode (`<div id="ai-chat-embed-div">`) — the host's own CSS controls placement there; this field only applies to the auto-created floating widget. Documented, not silently ignored.
  - [ ] Invalid/out-of-range values (e.g. negative numbers, unrecognized `corner` string) fall back to the corresponding default rather than producing broken CSS.
- **Affected modules:** `src/scripts/embed.ts` (`_createFloatingWidget`, `_injectWidgetStyles`, the `PRIVATE_CHAT_CONFIG` type declaration).

### FR-2: `PRIVATE_CHAT_CONFIG.icon` — toggle-button icon override
- **Description:** A new optional config field replacing the hardcoded chat-bubble SVG inside the floating toggle button.
  ```ts
  icon?: string; // an emoji/short string, OR an image URL
  ```
  Detection: a value that parses as an absolute URL (`http(s)://` or `data:`) renders as an `<img>` inside the button. A value that fails absolute parsing is retried resolved against the **host page's** own base (`new URL(value, document.baseURI)` — the host that set `PRIVATE_CHAT_CONFIG`, not `embed.ts`'s own origin), so a host-relative path like `/assets/chat-icon.png` still resolves to an image. Anything that fails both resolutions renders as text content (covers emoji and any other short string).
- **Req ref:** "Update icons etc." + "Toggle-button icon only, as emoji or image URL"
- **Acceptance criteria:**
  - [ ] Unset `icon` → the existing hardcoded chat-bubble SVG renders exactly as today.
  - [ ] `icon: "💬"` → the button shows that emoji instead of the SVG.
  - [ ] `icon: "https://example.com/icon.png"` → the button shows that image instead of the SVG.
  - [ ] `icon: "/assets/chat-icon.png"` (host-relative, no scheme) → resolved against the host page's base and rendered as an image, not as literal button text. (Added post-grill — the original absolute-only heuristic silently mis-rendered this common case as text with no error.)
  - [ ] An image URL (absolute or resolved-relative) that fails to load (404, offline, CORS) falls back to the default SVG rather than showing a broken-image glyph or an empty button.
  - [ ] The button's `aria-label="Open AI chat assistant"` is unchanged regardless of `icon` — screen-reader behavior doesn't regress just because the visual glyph changed.
- **Affected modules:** `src/scripts/embed.ts` (`_createFloatingWidget`, the `PRIVATE_CHAT_CONFIG` type declaration).

### FR-3: Backward compatibility for existing consumers
- **Description:** `portfolio-template` and `linkedinify` embed private-chat today with neither field set. Both must continue rendering pixel-identical output after this change ships.
- **Req ref:** "Must stay backward compatible for existing consumers... who set nothing today and should see zero visual change." (carried over from the `CHATBOT-1` investigation that produced this ticket)
- **Acceptance criteria:**
  - [ ] A visual diff (manual or Playwright screenshot comparison) of the floating widget on `portfolio-template` and `linkedinify` before/after this change shows no difference.
- **Affected modules:** `src/scripts/embed.ts`.

### FR-4: Document the new config fields
- **Description:** `position` and `icon` become part of private-chat's public embedding API the moment they ship. Add both to `docs/SITE-INTEGRATION.md`, alongside the existing `label`/`persona`/`modelUrl`/etc. entries, with a short example each.
- **Req ref:** Added post-grill (M2) — the spec originally had no documentation deliverable for a new public config surface.
- **Acceptance criteria:**
  - [ ] `docs/SITE-INTEGRATION.md` documents `position` (both fields, both corners, defaults) and `icon` (both accepted formats, the relative-URL resolution behavior from FR-2).
  - [ ] Before writing the new entries, skim the doc's current structure for the previously-noted duplication issue (see Technical Notes) so the new fields land in a de-duplicated section rather than compounding it.
- **Affected modules:** `docs/SITE-INTEGRATION.md`.

## Non-Functional Requirements
- **Performance:** N/A — no new network calls unless a host opts into an image-URL icon (one small image fetch, already how any `<img>` on the page would behave).
- **Security:** `icon` as an image URL is host-supplied and rendered via `<img src>` (not `dangerouslySetInnerHTML`/raw SVG injection) — no injection surface beyond what any `<img src>` already has. No new user input is involved (this is site-owner config, not visitor input).
- **i18n:** N/A — no new user-facing strings.
- **Responsive:** Covered by FR-1's acceptance criteria (mobile fullscreen override verified corner-agnostic).

## Out of Scope
- Header text/emoji customization ("🤖 AI Assistant") — explicitly deferred (Clarification 3).
- Accent color / theme customization (`#3b82f6`, `#2dd4bf` and the dark-mode CSS block) — explicitly deferred.
- `top-left` / `top-right` corners — explicitly deferred (Clarification 1).
- RTL-aware logical positioning (`start`/`end`) — `corner` values are literal screen edges, matching the widget's existing non-RTL-aware behavior (it's already hardcoded `right: 24px` today with no RTL handling). Not a regression; just not advanced either. (Added post-grill, m2.)
- Any change to the inline-div embed mode's positioning — it was never widget-controlled and stays that way.
- Raw SVG string as an `icon` value (only emoji/short-text or image URL) — not requested; would need sanitization to be safe against injection and isn't worth the surface area for this ticket.

## Existing Code References
- `src/scripts/embed.ts` — `_createFloatingWidget()` (lines ~383-727 as of this writing) hardcodes `bottom:24px; right:24px; z-index:9999` on the wrapper, a literal chat-bubble `<svg>` inside `chatButton`, `right:0` on `chatContainer` and `badgeTooltip`. `_injectWidgetStyles()` holds the `@media max-width:480px` fullscreen override and the dark-mode block.
- `src/scripts/embed.ts` — the `PRIVATE_CHAT_CONFIG` global type declaration (top of file) is where `position`/`icon` get added, documented the same way `label`/`persona`/etc. already are.
- `src/lib/constants.js` — `EMBED_SCRIPT_ID`/`EMBED_DIV_ID`/`EMBED_FLOATING_ID` constants; unaffected by this ticket but confirms the actual ids any test/consumer must target (`aiChatEmbedScript`, `ai-chat-embed-div`, `ai-chat-floating-widget`) — a wrong id here silently no-ops the whole widget with no error, worth keeping in mind for the acceptance tests.
- `docs/SITE-INTEGRATION.md` — the integration guide FR-4 updates; check its current structure for the previously-noted duplication issue before adding new entries.

## Open Questions
- None blocking. If a future consumer needs top corners or header/color theming, that's a new ticket, not a v2 of this one (scope stays intentionally tight per the "if not this" analysis above).

## Technical Notes
- `position`/`icon` are **not** forwarded to the iframe as URL query params (unlike `label`, `persona`, `modelUrl`, etc.) — they configure host-context chrome that `embed.ts` renders directly, so there's nothing for the iframe side to consume.
- `CHATBOT-1` (branchdiff repo) is blocked on this ticket shipping — it needs `position: { corner: 'bottom-left' }` to avoid a confirmed pixel-exact collision with branchdiff's own back-to-top button.
- `side`'s meaning is conditional on `corner` ("from the right" for `bottom-right`, "from the left" for `bottom-left`) — a deliberate tradeoff over a `left`/`right` field pair that could be set to conflicting values. Carry this explanation into the field's JSDoc when implemented so it doesn't read as a naming mistake. (Grill m1.)
- `badgeDot`'s position (`top:2px; right:2px`, fixed to one corner of the round button) is intentionally left corner-independent — it's a cosmetic marker relative to the button itself, not the screen edge. Confirm this reading holds at implementation time; if it doesn't, FR-1 needs an added criterion. (Grill N1.)
- Threat model: `position`/`icon` are host-owner-supplied, and the host is already a trusted actor in this architecture (it can already run arbitrary JS via `<script>` tags and `PRIVATE_CHAT_CONFIG.getSections`) — no new input-validation/sanitization surface is introduced relative to what already exists. `icon` as an image URL is safe via `img.src` (not `dangerouslySetInnerHTML`); an `<img>`-loaded SVG data URI doesn't execute embedded scripts per browser spec. (Grill security assessment.)
- This repo's own history notes a prior "documentation duplication" issue in site-integration docs — check for it before adding the FR-4 entries so they land cleanly rather than compounding it. (Grill N2.)
- Recommend extracting the corner-mirroring logic and icon-format detection as small pure functions (e.g. `resolvePositionStyles(config)`, `resolveIconKind(value)`) during planning — gives FR-1/FR-2 a plain vitest unit-test target without needing a full browser test for every corner/icon-format combination. (Grill N3.)

## Change Log
| Date | Section Changed | What Changed | Why |
|------|----------------|--------------|-----|
| 2026-08-12 | — | Initial version | — |
| 2026-08-12 | FR-2, FR-4 (new), Out of Scope, Technical Notes | Added host-relative icon-URL resolution, a documentation FR, an RTL non-goal note, and grill-sourced technical notes | Grill findings M1, M2, m1, m2, N1-N3 |
