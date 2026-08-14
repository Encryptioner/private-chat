# Original Requirement — Host-configurable widget position & icon

**Source:** user conversation, 2026-08-12.
**Context:** private-chat's floating widget chrome (button, header, panel) is created entirely inside `src/scripts/embed.ts` (`_createFloatingWidget()` / `_injectWidgetStyles()`), running in the HOST page's context. Every host site currently gets the exact same fixed bottom-right button, fixed 24px offsets, and a hardcoded chat-bubble SVG icon — none of it is configurable via `PRIVATE_CHAT_CONFIG` today (that object only forwards fields INTO the iframe: `label`, `persona`, `modelUrl`, `defaultModel`, `preloadModel`, `preIndex`, `siteIndexUrl`, `getSections`).

This came up while scoping a separate integration (embedding private-chat into `branchdiff`'s browser UI, tracked as `CHATBOT-1` in the branchdiff repo) — branchdiff has its own "back to top" button fixed at the exact same bottom-right corner/offset (`bottom-6 right-6`, 40×40px, `z-20`) that private-chat's widget (`bottom:24px; right:24px`, 56×56px, `z-9999`) would sit directly on top of. Rather than hack around this in every consumer, the fix belongs in private-chat: let the host choose where the widget sits.

## Verbatim intent (the user's own words)

1. > "Can we allow some param which can be passed by host website to private chat to position the chatbot, Update icons etc."

2. When asked which corners to support:
   > "bottom-right (default) + bottom-left. With position say how much right, how much left, how much will px will be in bottom"
   — i.e. not just a corner enum, but configurable pixel offsets too.

3. When asked what should be configurable and in what format:
   > "Toggle-button icon only, as emoji or image URL"

## Clarified decisions (this session, 2026-08-12)

- **Corners in scope:** `bottom-right` (current default, unchanged) and `bottom-left` only. `top-left`/`top-right` explicitly out of scope for this ticket — the driving need is dodging a bottom-anchored element, and top corners would require re-deriving the tooltip/panel-open-direction logic that currently assumes bottom-anchoring, for a need nobody has yet.
- **Pixel offsets are configurable, not just the corner.** The host can override how far from the bottom and from the side edge the widget sits, not only pick a preset corner.
- **Icon customization scope:** the floating toggle button's icon only (emoji string or image URL). The header text/emoji ("🤖 AI Assistant") and the widget's accent colors stay hardcoded for now — out of scope.
- **Backward compatibility is load-bearing:** two existing live consumers (`portfolio-template`, `linkedinify`) set none of these new fields today and must render pixel-identical to before.
