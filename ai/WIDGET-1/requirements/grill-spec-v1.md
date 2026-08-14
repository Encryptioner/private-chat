# Grill Log: WIDGET-1 — Host-configurable widget position & icon (v1)

**Date:** 2026-08-12
**Grilled by:** Claude (Hard Critic Mode)
**Input:** spec-v1.md
**Ticket:** WIDGET-1
**Verdict:** PASS WITH CONDITIONS

## Summary

Tightly-scoped, low-risk client-side config feature with no backend, no auth, no data. The spec correctly reuses the existing `PRIVATE_CHAT_CONFIG` pattern and its scope decisions (bottom corners only, icon only, no raw SVG) are each defensibly justified rather than arbitrary. Two MAJOR gaps: the `icon` URL-detection heuristic has an unhandled input class (relative URLs), and the new public config surface has no documentation deliverable.

**Stats:** 8 findings — 0 Blocker, 0 Critical, 2 Major, 2 Minor, 4 Note

## Findings

### MAJOR

#### [M1] `icon` heuristic silently mishandles relative URLs
- **Location:** FR-2, description + acceptance criteria
- **Issue:** The detection rule ("a value that parses as an absolute URL... renders as `<img>`; anything else renders as text") treats a perfectly plausible host input — a relative path served from their own site, e.g. `icon: "/assets/chat-icon.png"` — as "not a URL," rendering the literal string `/assets/chat-icon.png` as button text instead of an image. No acceptance criterion tests this, and no fallback/error path is defined for it.
- **Risk:** A host who reasonably expects "any URL, relative or absolute" to work gets a silently broken button (literal path text) with no indication anything went wrong — a debugging trap for a future integrator, plausible enough to hit on day one.
- **Recommendation:** Either (a) explicitly support relative URLs by resolving against the **host page's** base (`new URL(value, document.baseURI)` — resolved relative to whoever set `PRIVATE_CHAT_CONFIG`, not `embed.ts`'s own origin), and add an acceptance criterion for it, or (b) keep absolute-only but say so explicitly in the field's doc comment/acceptance criteria as a stated restriction, not an implicit one discovered by trial and error.

#### [M2] No documentation deliverable for the new public config fields
- **Location:** Existing Code References / Out of Scope (absent)
- **Issue:** `PRIVATE_CHAT_CONFIG.position` and `.icon` become part of private-chat's public embedding API the moment they ship, but the spec never mentions `docs/SITE-INTEGRATION.md` — the project's own stated integration guide (per this repo's CLAUDE.md) — as something that needs updating.
- **Risk:** Undiscoverable API. The only way a future host site owner (or a future Claude session) learns these fields exist is by reading `embed.ts`'s source directly. Given this repo's own memory notes a prior "documentation duplication identified in site integration" issue, adding new fields here without touching the doc risks the doc silently drifting further from what `embed.ts` actually supports.
- **Recommendation:** Add an FR (or fold into FR-1/FR-2's acceptance criteria) requiring `docs/SITE-INTEGRATION.md` to document `position` and `icon` with examples, alongside the existing `label`/`persona`/etc. entries.

### MINOR

#### [m1] `side` field overloads meaning based on `corner`
- **Location:** FR-1 description
- **Issue:** `side` means "px from the right" when `corner: 'bottom-right'` and "px from the left" when `corner: 'bottom-left'` — one field, two meanings depending on another field's value. This is a deliberate, reasonable tradeoff (avoids a `left`/`right` pair that could be set to conflicting values) but is worth a one-line doc comment on the field itself so it doesn't read as a naming mistake later.
- **Recommendation:** No spec change needed — just make sure the eventual TS type's JSDoc spells out the conditional meaning explicitly (the spec already does this in prose; carry it into the code comment).

#### [m2] RTL (right-to-left) semantics unaddressed
- **Location:** FR-1 / Out of Scope
- **Issue:** `corner: 'bottom-left'`/`'bottom-right'` are literal screen-edge positions, not logical `start`/`end` — they won't flip for an RTL host page. This matches the widget's current behavior (already hardcoded `right: 24px`, no RTL awareness at all today), so it's not a regression — but it's also not called out anywhere as a conscious non-goal.
- **Recommendation:** Add one line to Out of Scope: "RTL-aware logical positioning (`start`/`end`) is not supported — `corner` values are literal screen edges, matching the widget's existing non-RTL-aware behavior."

### NOTES

#### [N1] `badgeDot` position untouched by `corner` — confirm intentional
- The preload badge dot (`top:2px; right:2px` on the button itself) isn't mentioned in FR-1's acceptance criteria. It's plausible this is correct as-is (a cosmetic marker fixed to one corner of the round button, independent of which screen-edge the widget occupies) rather than an oversight — worth a one-line confirmation in the spec or a code comment when implemented, so the next reader doesn't wonder if it was missed.

#### [N2] Check the existing site-integration doc-duplication issue before adding fields there
- This repo's own history flags a prior "documentation duplication identified in site integration" finding. Worth a quick look at `docs/SITE-INTEGRATION.md`'s current structure before adding `position`/`icon` entries (per M2), so the new fields land in the de-duplicated version rather than compounding an existing mess.

#### [N3] No unit-test strategy named for the pure resolution logic
- FR-3's backward-compat check names a testing approach (visual diff). FR-1/FR-2 don't. The corner-mirroring logic (whether `chatContainer`/`badgeTooltip` anchor left or right) and the icon-format detection are both good candidates for small pure functions (e.g. `resolvePositionStyles(config)`, `resolveIconKind(value)`) that a plain vitest unit test can cover without a full browser — worth naming during planning rather than leaving it implicit.

#### [N4] Clean reuse of the existing config pattern
- No new config subsystem invented — `position`/`icon` slot into `PRIVATE_CHAT_CONFIG` exactly like `label`/`persona`/`modelUrl` already do, and FR-3's backward-compatibility framing (explicit opt-in, zero change for silent consumers) matches how every other field in that object already behaves. Good scope discipline overall — this spec resisted scope creep into header/color theming despite the original ask's "etc." wording, correctly narrowing via the clarification round rather than guessing.

## Security Assessment

| Category | Status | Notes |
|----------|--------|-------|
| Authentication | N/A | Client-side visual config, no auth surface. |
| Authorization | N/A | No user/tenant data involved. |
| Input Validation | OK | `icon`/`position` are host-owner-supplied (trusted actor — the same host already runs arbitrary JS via `<script>` tags and `PRIVATE_CHAT_CONFIG.getSections`), not visitor input. `icon` as an image URL is safe via `img.src` (not `dangerouslySetInnerHTML`); `<img>`-loaded SVG data URIs don't execute embedded scripts per browser spec. |
| Data Exposure | N/A | No data read or transmitted by either field. |
| Rate Limiting | N/A | No network calls beyond the host's own optional icon image fetch. |
| Multi-tenancy | N/A | No backend, no tenancy model. |

## Requirement Traceability

| Original Requirement Point | Covered By | Status |
|----------------------------|------------|--------|
| "allow some param... to position the chatbot" | FR-1 | Covered |
| "bottom-right (default) + bottom-left" | FR-1 | Covered |
| "how much right, how much left, how much px... in bottom" | FR-1 | Covered |
| "Update icons etc." | FR-2 | Covered (narrowed via clarification to toggle-button icon only, emoji/URL — "etc." was explicitly resolved down, not silently dropped) |
| Backward compatibility for portfolio-template/linkedinify | FR-3 | Covered |

No missing rows. FR-1/FR-2/FR-3 all trace directly to a stated point; nothing in the original requirement is unaddressed.

## Assumptions Made

1. Host sites setting `PRIVATE_CHAT_CONFIG` are a trusted actor (not an attack surface distinct from what already exists via `getSections`/raw `<script>` tags) — risk if wrong: would need input sanitization guidance added; low likelihood given the existing threat model already grants hosts full script execution.
2. `embed.ts`'s current mobile fullscreen override (`inset: 0 !important`) is corner-agnostic — risk if wrong: FR-1's mobile acceptance criterion would need rework; low risk, verified by reading the actual CSS rule (zeroes all four edges unconditionally).

## Questions for Author

None blocking — the two MAJOR findings (M1, M2) are addressable as spec edits (add an acceptance criterion / an FR) rather than open design questions requiring your input before proceeding. Flagging the relative-URL decision (M1's option a vs. b) as something to pick during the spec update, not a hard blocker either way.

## Verdict Details

**PASS WITH CONDITIONS.** No blockers, no criticals — this is a well-scoped, low-risk feature. Conditions before moving to `/plan-work`:
1. Resolve M1 — decide and spec whether `icon` supports relative URLs or is documented as absolute-only.
2. Resolve M2 — add `docs/SITE-INTEGRATION.md` update as an explicit deliverable (FR or acceptance criterion).

Both are small spec edits, not scope changes — safe to fold in now and proceed.
