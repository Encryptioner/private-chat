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
    siteIndexUrl: "site-index.json", // optional — override where the cross-page index lives
    persona: "You are Aria, the friendly assistant for Acme Labs.", // optional — customize the assistant's voice
    modelUrl: null,                // optional — load your own GGUF instead of the built-in default
    defaultModel: null,            // optional — pick a built-in preset by id, e.g. "qwen3-0.6b"
    preloadModel: null,            // optional — seconds to wait, then background-download the model
    preIndex: null,                // optional — "on-open" | "after-model": warm the search index early
    getSections: null              // optional custom scraper (see below)
  };
</script>
<script id="aiChatEmbedScript" defer
        src="https://encryptioner.github.io/private-chat/embed.js"></script>
```

| Field | Type | Purpose |
|-------|------|---------|
| `label` | `string` | Replaces the "Hi, how may I help you?" greeting (e.g. `"How can Acme Labs help you?"`). |
| `siteIndexUrl` | `string` | Path or URL to a pre-built static index (`site-index.json`) for cross-page awareness. **Default (omit this field): `site-index.json` right next to the host page.** Missing file = ignored. Resolved against the **host page's own location** (embed.ts does this before forwarding it to the iframe) — see [the shared-origin gotcha](#gotcha-siteindexurl-on-a-shared-origin) below before setting this to anything with a leading `/`. Generate the file with the bundled crawler (Node or Python) — see [Cross-page awareness](#cross-page-awareness-via-site-indexjson) below. |
| `persona` | `string` | Replaces just the assistant's opening identity line (default: *"You are a friendly assistant chatting with a visitor on this website."*). The rest of the grounding instructions (answer length, no verbatim copying, etc.) always apply — this only changes voice/tone, not behavior. Keep it to one sentence — see the note below. |
| `modelUrl` | `string` | URL to a GGUF file to load instead of the built-in default model — any public preset, or one you trained/fine-tuned yourself. Must be hosted with CORS enabled (HF Spaces, R2, GitHub raw, S3 with a CORS policy, etc.). See [`docs/CUSTOM-MODEL-TRAINING.md`](CUSTOM-MODEL-TRAINING.md). |
| `defaultModel` | `string` | Preset to load instead of the built-in default. Accepts an exact **id** (`qwen3-0.6b`) **or a fuzzy/partial name** (`"qwen"`, `"gemma 3"`, `"smol"`) — matched case-insensitively against id and label. One of: `gemma3-270m` (default), `gemma3-1b`, `llama3.2-1b`, `qwen3-0.6b`, `smollm2-360m`. Bigger = smarter but a larger download; smaller = faster first load. An ambiguous match (e.g. `"gemma"` → 270M + 1B) picks the **smallest** and logs the candidates so you can pin the exact id; an unknown value falls back to the built-in default + a console warning. Use `modelUrl` instead for a model you host yourself. |
| `preloadModel` | `number` | Seconds to wait after the widget initializes, then **background-download** the chat model so it's ready the instant the visitor opens the chat. Only fires on a confirmed fast/unmetered connection (Network Information API — wifi/fast 4g, no data-saver); on mobile data, slow connections, or Safari (no API) it's skipped and the model loads when the chat opens as usual. `0` = start immediately. Omit = current behavior (load when the chat opens). Floating widget only — inline-div embeds already load on page load. See [Performance tuning](#performance-tuning-preloadmodel--preindex) below. |
| `preIndex` | `string` \| `number` | When to **build the search index** (embeds the page so the first grounded answer is instant): `"on-open"` (when the chat opens — ignores the chat model), `"after-model"` (once the chat model is ready — fires immediately if the model is **cached**, no re-download), or a **number** = seconds to wait *after the model is ready* before indexing (keeps the index build from competing with a fresh model download). Omit = build on the first question (current default). True *background* warming — before the visitor opens the chat — only happens when `preloadModel` is also set; otherwise it runs when the chat opens. A first question that lands mid-build reuses it (never re-indexes twice). See [Performance tuning](#performance-tuning-preloadmodel--preindex) below. |
| `getSections` | `function` | Your own scraper. See below. |

**No config** → the widget live-scrapes the current page and grounds answers in it, and (as of the default above) also checks for a `site-index.json` next to the current page automatically.

> **Keep `persona` and `modelUrl` short.** Both get forwarded as query params on the iframe's
> URL, which is a real GET request through the host's CDN — most CDNs/servers cap request-line
> length (commonly ~8–16KB). Nothing in normal use gets remotely close to that (a one-sentence
> `persona` and a typical model URL total well under 1KB), but a multi-paragraph `persona` or a
> `modelUrl` pointing at a long signed/presigned URL (S3, R2 auth query strings routinely run
> 500–1500+ chars) eats into that budget fast. `embed.ts` logs a console warning if the built
> iframe URL exceeds 4000 characters as an early signal.

## Performance tuning — `preloadModel` + `preIndex`

By default the widget is polite about bandwidth: the chat model (~278MB) downloads **when the visitor opens the chat**, and the search index builds **on the first question**. Nothing is fetched for a visitor who never opens the chat. The two fields below are opt-in overrides for sites where you'd rather trade a little background bandwidth for an instant-first-answer experience.

**Both background features are network-gated.** They only run when the browser reports a fast, unmetered connection (wifi / fast 4g, data-saver off). On mobile data, slow connections, or browsers without the Network Information API (Safari/iOS), they're skipped automatically and the widget falls back to the default load-on-open / index-on-first-question behavior. You never strand a mobile user with a surprise 278MB download.

### Which should I set?

| Your site | `defaultModel` | `preloadModel` | `preIndex` |
|-----------|----------------|----------------|------------|
| Blog / docs, mostly mobile visitors | omit (270M is fastest) | omit | omit |
| Product/marketing site, want a smarter assistant | `gemma3-1b` | omit | omit |
| Desktop-first SaaS, want instant-open chat | omit | `5` | `"on-open"` |
| "Best experience, bandwidth is fine" | `gemma3-1b` | `3` | `"after-model"` |

### Recipes

**Smarter default, nothing preloaded** (mobile-friendly):
```html
<script>
  window.PRIVATE_CHAT_CONFIG = { defaultModel: "qwen3-0.6b" };
</script>
```

**Instant-open chat on good connections** (desktop-first; mobile users still get load-on-open):
```html
<script>
  window.PRIVATE_CHAT_CONFIG = { preloadModel: 5, preIndex: "on-open" };
</script>
```

**Fully warmed** (background model + index; only fires on wifi/fast 4g):
```html
<script>
  window.PRIVATE_CHAT_CONFIG = {
    defaultModel: "gemma3-1b",
    preloadModel: 3,
    preIndex: "after-model",
  };
</script>
```

### How preloading behaves when the visitor opens mid-download

`preloadModel` mounts the chat iframe early but hidden; opening the chat just reveals it. So if the model is 50% downloaded when the visitor opens, they **see 50% and it continues to 100%** — it never restarts. Same for `preIndex`: a first question that lands while the index is building reuses the in-flight build instead of indexing twice.

### Preload badge (automatic)

While a background preload or index is in progress and the chat is closed, the floating chat button shows a small pulsing dot; hovering it reveals what's loading (`Loading AI model · 47%` or `Indexing this page…`). The dot disappears the moment the chat opens — the in-chat loader then takes over, so the two never compete for attention. Nothing to configure; it appears only when `preloadModel`/`preIndex` actually have work to do.

### Visitor opt-out of background preloading

Background preloading is the visitor's bandwidth and battery, so they always get the final say. A visitor can disable it for your site by setting a flag in `localStorage` (on your page) and reloading:

```js
// Opt out for THIS page only (use this when several sites share one origin,
// e.g. sibling GitHub Pages projects — each is controlled independently):
localStorage["private-chat:no-preload:" + location.origin + location.pathname] = "true";

// …or opt out for the whole origin (simpler, blanket):
localStorage["private-chat:no-preload"] = "true";

// To re-enable, delete the key (or set it to "false").
```

When set, the widget skips `preloadModel` **and** withholds `preIndex` — the model loads when the chat opens and the index builds on the first question (the polite default). You can surface this yourself by exposing a small "Data saver" toggle in your UI that writes the key above.

> **Built-in preset ids:** `gemma3-270m` (default, 278MB), `smollm2-360m` (258MB), `qwen3-0.6b` (378MB), `gemma3-1b` (769MB), `llama3.2-1b` (770MB). The size in parentheses is the one-time download (cached afterwards). Pick the smallest model that answers well enough for your content.

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

**Without one** (the default, zero-config state): nothing breaks. `loadStaticSiteIndex()` gets a
failed fetch (missing file or unset `siteIndexUrl`) and silently returns `[]`. The widget still
grounds answers in the **live scrape of whatever page the visitor is currently on** — that scrape
runs automatically on every load and re-runs on SPA navigation (see
[Dynamic / SPA sites](#dynamic--spa-sites) above). What you lose is cross-page/cross-section
recall: a visitor can't ask about content the current page's scrape didn't happen to capture.

**With one**: it is always merged with the live scrape, automatically, on every question — there
is no toggle or mode switch. `ragEngine.js` runs both the live per-page scrape and a fetch of
`siteIndexUrl` in parallel, then `combineIndexes()` merges them (live wins on URL collision,
static fills in the rest). So adding `site-index.json` is strictly additive: it cannot make
answers worse, only fill gaps the live scrape leaves.

By default the widget only knows the **current** page's live-scraped content. For a **multi-page**
site (docs, a landing + changelog + guide, …), generate a static `site-index.json` once and the
chat gains **site-wide** awareness — a visitor on `/` can ask about `/changelog` and get a grounded
answer **plus a link that takes them there**.

> Single-page SPAs (one route, all content) don't strictly need this for page coverage — the live
> scrape already sees everything **currently rendered**. It still pays off there for two reasons:
> (1) it's embedded once and cached, so repeat visitors skip re-scraping cost, and (2) content that
> a component only renders conditionally (an inactive tab, a collapsed accordion whose panel text
> genuinely never mounts) won't appear in a live scrape either — a static crawl only captures it if
> you make the crawler interact with that UI first (click the tab/expand the panel) before scraping.

### Generate it (one command, from the private-chat repo)

```bash
# one-time: install the headless browser the crawler uses
npx playwright install chromium

# crawl the site → write chunks-only site-index.json (NO vectors)
pnpm build:site-index -- --url https://yoursite.example/ [--depth 1] \
  [--pages /,/about,/docs] [--out ./site-index.json]
```

- `--depth N` — follow same-**path-prefix** internal links (scoped to the start URL's directory,
  so on shared origins like `github.io` it won't crawl sibling sites). Default 1. For a single-page
  site, pass `--depth 0` — otherwise the crawler will follow every outbound link, including ones to
  unrelated sibling projects on a shared origin.
- `--pages a,b` — explicit page paths (relative to `--url`) instead of discovery.
- `--min-words N` — drops chunks shorter than N words as nav-label noise. Default 10. **Check your
  output for missing sections before trusting the default** — a site with compact content (short
  accordion entries, brief cert/skill lists, one-line bios) can lose entire sections silently. A
  chunk like `"Sololearn Multiple Technologies 2018 - 2024"` (6 words) is real content, not noise,
  but the default threshold drops it. If a section you expect isn't in the output, re-run with
  `--min-words 1` first to confirm the content was scraped at all, then pick a threshold between 1
  and 10 that keeps it without re-admitting too much genuine nav noise.
- `--expand` only helps content that's genuinely absent from the DOM until a click (accordions/
  panels using `display:none` or the `hidden` attribute, "Show More" buttons). It does **not** help
  content that's already in the DOM but filtered out by `--min-words`, and it does **not** make a
  conditionally-rendered UI element (e.g. one tab of a multi-tab slider where only the active tab's
  items ever mount) retroactively appear for other tab states — that needs either a custom
  `getSections` that reads the underlying data directly, or a crawler change to interact with that
  specific UI (click each tab) before scraping.
- The crawler renders each page with Playwright (handles SPAs) and runs the **real** `src/lib/scraper.js`
  in-page — or the site's own `getSections` if it's deployed — so the index matches the live page.
- Output is **chunks-only** (`{anchor,title,url,text}`). The widget embeds those chunks at runtime
  with its **own** bge embedder (guaranteed vector parity with the live page), **cached by content
  hash** — a one-time cost per index version, then instant.

### Deploy it

1. Commit the generated `site-index.json` to your site repo (at the root, or `public/` for CRA).
2. Serve it next to your host page (deploy the repo) — e.g. at `https://yoursite.example/site-index.json`,
   or `https://yoursite.example/some-app/site-index.json` if your site itself lives under a path.
3. **Nothing else to configure** — the default (`site-index.json` next to the current host page) finds
   it automatically. Only set `siteIndexUrl` explicitly if you're putting the file somewhere else, and
   if you do, read [the gotcha below](#gotcha-siteindexurl-on-a-shared-origin) first.
4. **Re-run the crawler when content changes** — `site-index.json` is a static snapshot. The widget's
   content-hash cache means a new file triggers one re-embed, then it's cached again.

> Worked example: `branchdiff-releases` ships a `site-index.json` covering its landing + guideline +
> changelog (3 pages, ~269 chunks), so the chat answers install/changelog/guideline questions from any
> page and links to the right one.

### Gotcha — `siteIndexUrl` on a shared origin

The widget iframe is always loaded from **private-chat's own path** (e.g. `encryptioner.github.io/private-chat/`),
never your site's path — even though it *looks* embedded in your page. If your site is a **GitHub Pages
project site** (or any site sharing an origin with something else at a different path, e.g.
`encryptioner.github.io/branchdiff-releases/` sharing `encryptioner.github.io` with `encryptioner.github.io/`
itself and every other project under that account), a **root-relative** path like `siteIndexUrl:
"/site-index.json"` resolves against the **shared origin root** — not your project's own directory. If
something else on that origin (a different project, the account's own root page) happens to serve a
`site-index.json` too, the widget silently loads **that** file instead of yours: same filename, wrong
content, no error. This is exactly what happened to `branchdiff-releases` — it set `siteIndexUrl:
"/site-index.json"` and the widget kept grounding answers in `encryptioner.github.io`'s (the account's
root portfolio page) index instead of its own.

- **Fix:** omit `siteIndexUrl` (new default resolves `site-index.json` next to the **host page**,
  correctly, via `embed.ts`) — or if you must set it explicitly, use a **fully-qualified absolute URL**
  (`https://yoursite.example/your-path/site-index.json`), which is unambiguous regardless of origin
  sharing. Avoid a bare leading-`/` path unless your site is genuinely deployed at its origin's root
  (a custom domain, or a GitHub *user/org* page with no project path).

### Testing locally before deploying

Run private-chat's dev server and point your site's embed script at it, instead of the
deployed `encryptioner.github.io/private-chat/embed.js`, so you can verify grounding end-to-end
before shipping either side.

```bash
# in the private-chat repo
pnpm run dev        # builds embed.js once, then serves the app — usually http://localhost:5173
# or, iterating on embed.ts/scraper.js:
pnpm run dev:watch  # rebuilds embed.js on every save
```

On your site, temporarily swap the script `src` (and, if you set one, `PRIVATE_CHAT_CONFIG`
stays as-is) to the printed local URL:

```html
<script id="aiChatEmbedScript" defer src="http://localhost:5173/embed.js"></script>
```

**Different localhost ports are different origins — but that's fine.** Your site (e.g.
`localhost:3000`) and private-chat's dev server (`localhost:5173`) don't share an origin, same as
your deployed site and `encryptioner.github.io/private-chat/` don't share a *path* in production.
Neither matters: `embed.ts` (the script tag you swapped above) always runs **in your page**, so it
resolves `siteIndexUrl` against **your page's own location** before ever talking to the iframe —
whatever that location is, dev port or production path. A relative value (the default —
`site-index.json` next to your page, or your own explicit relative path) just works in both
environments with no copying, no environment-detection code, and nothing to revert afterward.

Then open your site, ask a question the current page doesn't show, and confirm you get a grounded
answer with a "Related sections" link. Revert the script `src` override before deploying — that's
the only thing to undo.

### Alternative crawler — Python (Scrapling)

A second, **equivalent** crawler exists for site owners who prefer Python, need to scrape a
**local/dev URL**, or hit **anti-bot protection** (Cloudflare) on the deployed site. It produces the
**identical** `site-index.json` — it injects the same `src/lib/scraper.js` into each rendered page, so
chunk quality matches the Node crawler and the live widget.

#### Installation

Requires **Python 3.10+**. A virtualenv is recommended — Scrapling pulls Playwright plus browser
binaries you don't want in your system Python.

```bash
# 1. isolate (optional but recommended)
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate

# 2. install Scrapling WITH fetchers
#    (bare `pip install scrapling` is parser-only → ModuleNotFoundError on import)
pip install "scrapling[fetchers]"

# 3. download the browser DynamicFetcher drives (Chromium)
scrapling install
```

<details>
<summary><strong>Using <code>--stealth</code>?</strong> (StealthyFetcher / Camoufox)</summary>

`StealthyFetcher` drives [Camoufox](https://github.com/daijro/camoufox) (a hardened Firefox build),
which needs one extra setup step after the install above:

```bash
pip install camoufox
playwright install-deps firefox    # OS-level libs for headless Firefox
camoufox fetch                     # downloads the Camoufox binary
```

</details>

Verify the install:

```bash
python -c "from scrapling.fetchers import DynamicFetcher; print('ok')"
# prints: ok     → ready. If it raises ModuleNotFoundError, you installed bare `scrapling` — redo step 2.
```

#### Usage

```bash
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

- **Part of the page currently being viewed** (same origin + same path as the host) →
  smooth-scrolls the host element + brief outline highlight.
- **A different page or a different domain** → opens in a **new tab** instead of navigating the
  current one away. Same-tab navigation would reload the host page — and the iframe, and the
  chat conversation, along with it. This covers cross-page links within your own site (e.g. a
  changelog answer while browsing the landing page) and links from `site-index.json` entries that
  point elsewhere entirely.
- Same-origin hosts resolve this directly (`ragEngine.js`'s `navigateToSection`); cross-origin
  hosts ask `embed.js` to do it via `postMessage` (the iframe can't reach a cross-origin DOM
  directly). Either way, the decision (scroll vs. new tab) is the same.
- **The link looks like what it does, before you click it**: a link that will open in a new tab
  shows a small ↗ icon next to its title, gets a real `target="_blank" rel="noopener noreferrer"`
  (so hover/right-click/middle-click all agree with the click handler, and it degrades correctly
  if JS is unavailable), and its accessible name gains "(opens in a new tab)". Same-page links get
  none of that — they look like a normal in-page jump because that's what they are.
  `isCurrentPageTarget` (`ragEngine.js`) is the single check both the icon and the click use, so
  they can't drift apart. One inherent gap: for a **cross-origin** host the icon always shows
  (can't verify same-page without an async round trip to `embed.js`) — worst case a link scrolls
  when the icon implied a new tab, never the reverse.
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
| Answers/links reference a **different site's content** | You set `siteIndexUrl` to a root-relative path (`/site-index.json`) on a site that shares its origin with something else — it fetched a sibling's file. See [the gotcha](#gotcha-siteindexurl-on-a-shared-origin). |
| Cross-origin still context-less | Ensure you're on the latest `embed.js` (the host-side scrape ships there). Older cached versions fall back to iframe-side scrape (same-origin only). |

---

## Privacy & security

- **No backend, no API key.** Inference is 100% in-browser (Wasm). Page content never leaves
  the visitor's browser.
- The iframe is sandboxed (`allow-scripts allow-same-origin allow-forms allow-popups
  allow-popups-to-escape-sandbox`) — required for WebAssembly and for "Related sections" links to
  a different page/domain to open in an unsandboxed new tab. It cannot read a cross-origin host
  DOM; that's why `embed.js` (host context) does the scraping and bridges sections via
  `postMessage` with a restricted `targetOrigin`.
- New-tab links use `window.open(url, "_blank", "noopener,noreferrer")` — the new tab can't reach
  back into this window via `window.opener` (tab-nabbing protection).
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
