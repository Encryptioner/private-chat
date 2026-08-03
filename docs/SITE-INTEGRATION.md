# Site Integration Guide

How to embed the **private-chat** widget on any website so it becomes **site-aware** —
answering visitor questions from your page's own content, with clickable links that jump to
the relevant section. 100% in-browser (no backend, no API key, no data leaves the visitor).

> **Audience:** a website owner integrating the widget on their own site. You don't need to
> fork any code — just add a `<script>` tag (and optionally a small config object).

---

## TL;DR — zero config

Add one script tag. A floating chat button appears; the widget reads your page and answers
from it.

```html
<script id="aiChatEmbedScript" defer
        src="https://encryptioner.github.io/private-chat/embed.js"></script>
```

That's it. Works on **any** site — same-origin, cross-origin, static, or dynamic (SPA).

---

## How it works

```
your page (host)                         chat widget (iframe)
┌───────────────────────┐                ┌─────────────────────────┐
│  embed.js runs HERE   │  scrape host   │  React app + Wllama     │
│  reads YOUR dom       │ ─────────────▶ │  chunks → embeds (bge)  │
│  (default or custom)  │  postMessage   │  → retrieves top-k      │
│  posts sections       │ ◀───────────── │  → grounded answer      │
│  scrolls on link click│  scroll-to     │  + "Related sections"   │
└───────────────────────┘                └─────────────────────────┘
```

- **`embed.js` runs in your page's context** (the host). Because your page is always
  same-origin to itself, it can always read your DOM — so scraping works on **any** site.
- The chat itself runs in a sandboxed **iframe** (its origin is `encryptioner.github.io`).
  Sections are bridged host→iframe via `postMessage`, which works cross-origin.
- The embedding model (`bge-small-en-v1.5`, ~35MB) loads **lazily on the visitor's first
  question**, not on page load. Vectors are cached in the visitor's IndexedDB.

This split is why the widget works cross-origin: the iframe alone could never read a
cross-origin parent's DOM, but `embed.js` can always read its own host DOM.

---

## The three running modes

| Mode | When | Sections source | Links scroll… |
|------|------|-----------------|---------------|
| **Cross-origin embed** | widget on a different domain than `encryptioner.github.io` | `embed.js` scrapes host → `postMessage` | host (via `embed.js`) |
| **Same-origin embed** | widget on `encryptioner.github.io/*` (e.g. the portfolio) | `embed.js` scrapes host → `postMessage` (iframe-side scrape is a fallback) | host directly |
| **Standalone** | the app itself at its own URL (no embed) | not used — generic chat | the app |

All three are exercised by the test suite; the RAG/index path only activates in the two
embed modes.

---

## Configuration — `window.PRIVATE_CHAT_CONFIG`

Set this **before** the script tag. All fields are optional.

```html
<script>
  window.PRIVATE_CHAT_CONFIG = {
    label: "Acme Labs",            // shown in the widget greeting
    siteIndexUrl: "/site-index.json", // optional pre-built cross-page index
    getSections: null              // optional custom scraper (see below)
  };
</script>
<script id="aiChatEmbedScript" defer
        src="https://encryptioner.github.io/private-chat/embed.js"></script>
```

| Field | Type | Purpose |
|-------|------|---------|
| `label` | `string` | Replaces the "Hi, how may I help you?" greeting (e.g. `"How can Acme Labs help you?"`). |
| `siteIndexUrl` | `string` | URL of a pre-built static index (`site-index.json`) for cross-page awareness. Missing file = ignored. (Phase-2 feature; the merge contract is ready, no crawler ships yet.) |
| `getSections` | `function` | Your own scraper. See below. |

**No config** → the widget live-scrapes the current page and grounds answers in it.

---

## Custom scraper — `getSections`

The built-in scraper reads visible text grouped under the nearest heading/`id`. That covers
most sites. Override it when you want full control — e.g. a CMS-driven page, a JSON-LD block,
a specific content region, or content that loads behind interaction.

### Signature

```ts
type Section = { anchor?: string; title?: string; url?: string; text: string };

window.PRIVATE_CHAT_CONFIG.getSections = (rootDoc) => Section[] | Promise<Section[]>;
```

- Runs in **your page's context** (the host) — it can read the full DOM, `fetch` your own
  APIs, await async data, etc.
- Return one `Section` per meaningful block of content.
  - `text` is required — this is what the model grounds on.
  - `anchor` (an element `id`) + `url` are optional. Include them so "Related sections"
    links can scroll the visitor to the section. Omit → grounded answer with no links.
- Throw / return `[]` → the widget degrades to a context-less chat (no crash).

### Example 1 — scrape a specific content region only

```html
<script>
  window.PRIVATE_CHAT_CONFIG = {
    label: "Docs",
    getSections: (doc) => {
      const main = doc.querySelector("main");
      if (!main) return [];
      const sections = [];
      for (const sec of main.querySelectorAll("section")) {
        const heading = sec.querySelector("h2, h3");
        sections.push({
          anchor: sec.id || heading?.id || "",
          title: heading?.textContent?.trim() || "Section",
          url: sec.id ? `${location.origin}${location.pathname}#${sec.id}` : location.href,
          text: sec.textContent.replace(/\s+/g, " ").trim(),
        });
      }
      return sections.filter((s) => s.text.length > 20);
    },
  };
</script>
```

### Example 2 — feed structured data (FAQ JSON-LD)

```html
<script>
  window.PRIVATE_CHAT_CONFIG = {
    label: "Support",
    getSections: () => {
      const faqs = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
        .flatMap((s) => {
          try { return JSON.parse(s.textContent); } catch { return []; }
        })
        .filter((j) => j["@type"] === "FAQPage");
      return faqs.flatMap((f) =>
        (f.mainEntity || []).map((q) => ({ title: q.name, text: `${q.name} ${q.acceptedAnswer.text}` }))
      );
    },
  };
</script>
```

### Example 3 — async (fetch from your own API)

```html
<script>
  window.PRIVATE_CHAT_CONFIG = {
    label: "Shop",
    getSections: async () => {
      const res = await fetch("/api/products?fields=name,description");
      const products = await res.json();
      return products.map((p) => ({
        anchor: `product-${p.id}`,
        title: p.name,
        url: `/products/${p.slug}#product-${p.id}`,
        text: `${p.name}. ${p.description}`,
      }));
    },
  };
</script>
```

---

## Dynamic / SPA sites

The widget stays fresh on client-side-routed apps (React Router, Next.js, Vue, CRA, …) with
**no extra work**:

- On load, `embed.js` scrapes and sends sections.
- On host navigation (`popstate`, `hashchange`, and DOM changes from `pushState`) it
  **re-scrapes and re-posts**, debounced ~500ms.
- The iframe **re-embeds only if content actually changed** (a content-hash cache hit is a
  no-op), so unchanged routes cost nothing.

So a visitor on `/pricing` gets pricing-grounded answers; after they navigate to `/contact`
and ask again, the answer reflects `/contact`.

---

## "Related sections" links

When the model's answer relates to retrieved content, up to 3 links appear under it. Clicking
one:

- **Same-origin host** → smooth-scrolls the host element + brief outline highlight.
- **Cross-origin host** → asks `embed.js` to scroll/navigate the host (the iframe can't reach
  a cross-origin DOM directly; `postMessage` bridges it).
- Links hide automatically when no chunk clears the relevance threshold (off-topic question).

For links to work, sections need an `anchor` (element `id`) and `url`. The built-in scraper
assigns ids to id-less headings so they're navigable.

---

## Troubleshooting

| Symptom | Likely cause / fix |
|--------|--------------------|
| Answers are generic, no links | Page yielded little text, or the question is off-topic. Check the page has real content regions; the relevance threshold may be filtering weak matches. |
| Links don't scroll the host | Sections lack an `anchor`/`url` (custom scraper) — add them. Cross-origin links need the latest `embed.js` (which handles `scroll-to`). |
| First question is slow | The ~35MB embedder downloads on the **first** question, then caches. Subsequent loads are instant. |
| Widget doesn't appear | The script tag needs `id="aiChatEmbedScript"` and the exact `src`. Check the browser console. |
| Cross-origin still context-less | Ensure you're on the latest `embed.js` (the host-side scrape ships there). Older cached versions fall back to iframe-side scrape (same-origin only). |

---

## Privacy & security

- **No backend, no API key.** Inference is 100% in-browser (Wasm). Page content never leaves
  the visitor's browser.
- The iframe is sandboxed (`allow-scripts allow-same-origin allow-forms`) — required for
  WebAssembly. It cannot read a cross-origin host DOM; that's why `embed.js` (host context)
  does the scraping and bridges sections via `postMessage` with a restricted `targetOrigin`.
- Scraped text becomes the model's context. On trusted static sites (the v1 targets) the site
  owner controls that content. On user-generated-content sites (comments/forums), scraped UGC
  could be a prompt-injection vector — revisit before embedding there.
- Assistant output is HTML-escaped before rendering (no `rehype-raw`), so echoed content
  renders as text, not live HTML.

---

## Standalone mode (the app itself)

Opening the app at its own URL (not embedded) runs it as a normal local-LLM chat — **no
scraping, no indexing, no embedder load**. The RAG path is gated on embed mode, so standalone
behavior is unchanged by any of the above. Verify with `pnpm test` + `pnpm build`.
