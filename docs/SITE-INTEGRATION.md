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
| `siteIndexUrl` | `string` | URL of a pre-built static index (`site-index.json`) for cross-page awareness. Missing file = ignored. Generate it with the bundled crawler (Node or Python) — see [Cross-page awareness](#cross-page-awareness-via-site-indexjson) below. |
| `getSections` | `function` | Your own scraper. See below. |

**No config** → the widget live-scrapes the current page and grounds answers in it.

---

## Custom scraper — `getSections`

> 📖 **Writing your own scraper?** See [`docs/CUSTOM-SCRAPER-GUIDE.md`](CUSTOM-SCRAPER-GUIDE.md)
> — a full step-by-step cookbook (when to write one, DevTools inspection, 5 copy-paste
> patterns, local testing with `test-files/scrape-eval.mjs`, and a worked branchdiff example).

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

## Cross-page awareness via `site-index.json`

By default the widget only knows the **current** page. For a **multi-page** site (docs, a
landing + changelog + guide, …), generate a static `site-index.json` once and the chat gains
**site-wide** awareness — a visitor on `/` can ask about `/changelog` and get a grounded answer
**plus a link that takes them there**.

> Single-page SPAs (one route, all content) don't need this — the live scrape already covers them.
> It pays off on sites with multiple real pages.

### Generate it (one command, from the private-chat repo)

```bash
# one-time: install the headless browser the crawler uses
npx playwright install chromium

# crawl the site → write chunks-only site-index.json (NO vectors)
pnpm build:site-index -- --url https://yoursite.example/ [--depth 1] \
  [--pages /,/about,/docs] [--out ./site-index.json]
```

- `--depth N` — follow same-**path-prefix** internal links (scoped to the start URL's directory,
  so on shared origins like `github.io` it won't crawl sibling sites). Default 1.
- `--pages a,b` — explicit page paths (relative to `--url`) instead of discovery.
- The crawler renders each page with Playwright (handles SPAs) and runs the **real** `src/lib/scraper.js`
  in-page — or the site's own `getSections` if it's deployed — so the index matches the live page.
- Output is **chunks-only** (`{anchor,title,url,text}`). The widget embeds those chunks at runtime
  with its **own** bge embedder (guaranteed vector parity with the live page), **cached by content
  hash** — a one-time cost per index version, then instant.

### Deploy it

1. Commit the generated `site-index.json` to your site repo (at the root, or `public/` for CRA).
2. Serve it at `/site-index.json` (deploy the repo).
3. Point the widget at it — set `siteIndexUrl`, or rely on the `/site-index.json` fallback:
   ```html
   <script>
     window.PRIVATE_CHAT_CONFIG = { label: "My Site", siteIndexUrl: "/site-index.json" };
   </script>
   ```
4. **Re-run the crawler when content changes** — `site-index.json` is a static snapshot. The widget's
   content-hash cache means a new file triggers one re-embed, then it's cached again.

> Worked example: `branchdiff-releases` ships a `site-index.json` covering its landing + guideline +
> changelog (3 pages, ~189 chunks), so the chat answers install/changelog/guideline questions from any
> page and links to the right one.

### Alternative crawler — Python (Scrapling)

A second, **equivalent** crawler exists for site owners who prefer Python, need to scrape a
**local/dev URL**, or hit **anti-bot protection** (Cloudflare) on the deployed site. It produces the
**identical** `site-index.json` — it injects the same `src/lib/scraper.js` into each rendered page, so
chunk quality matches the Node crawler and the live widget.

```bash
# one-time
pip install "scrapling[fetchers]"
scrapling install                 # downloads Chromium

# crawl — works against a local/dev URL OR a deployed one
python tools/scrapling-site-index.py \
  --url http://localhost:5173/ [--depth 1] [--pages /,/about] \
  [--out ./site-index.json] [--stealth] [--solve-cloudflare]
```

| Flag | When |
|------|------|
| `--stealth` | Site has bot protection. Switches to Scrapling's `StealthyFetcher` (TLS fingerprint impersonation). |
| `--solve-cloudflare` | `--stealth` only: solve Cloudflare Turnstile/interstitial challenges. |
| `--network-idle` | Deployed SPA that needs the network to settle. **Do not** use with dev servers. |

> **Local/dev servers (Vite, Next, Astro, …):** the Python crawler defaults to a fixed post-load wait
> (`--settle`, ms) instead of `network-idle`, because dev servers keep an HMR WebSocket open that prevents
> the network from ever going idle (which would hang the crawl). The Node crawler's `networkidle` has the
> same caveat — prefer the Python crawler or `--settle` when scraping `localhost`.

**Which one should I use?** Reach for Scrapling when you need Python, a dev URL, or stealth. Otherwise
prefer the Node crawler (`pnpm build:site-index`) — same stack, same output, one fewer runtime.

### The JSON contract — build your own indexer

The widget reads only `data.chunks` from `site-index.json`. **Any** tool that emits this shape works —
Node, Python, or your own script (e.g. run from inside your own codebase at build time):

```json
{
  "chunks": [
    {
      "anchor": "getting-started",
      "title": "Getting Started",
      "url": "https://yoursite.example/docs/#getting-started",
      "text": "Install the package, then add the script tag…"
    }
  ]
}
```

- `text` **(required)** — what the model grounds on.
- `anchor` + `url` *(optional)* — enable "Related sections" links that jump the visitor to the section.
- **No vectors needed** — the widget embeds every chunk at runtime with its own `bge-small-en-v1.5` model
  and caches by content hash.

> The bundled crawlers also write `generatedAt`, `startUrl`, `pages`, and `chunkCount` for your own
> debugging, but the widget only consumes `chunks`.

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
