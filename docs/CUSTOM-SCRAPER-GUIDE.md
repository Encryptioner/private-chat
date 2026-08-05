# Writing a Custom Scraper (`getSections`)

A step-by-step cookbook for making the private-chat widget ground its answers on **your**
site's content — the way that fits your markup. Use this for any site where the default
scraper misses content, grabs chrome (nav/buttons), or you just want cleaner sections.

> **First:** try the default scraper. Most content sites (blogs, docs, portfolios) need no
> custom scraper at all. Write one only if the default is poor. See *Step 0*.

---

## The contract

`getSections` is a function you set on `window.PRIVATE_CHAT_CONFIG` **before** the embed script
loads. It runs **in your page's context** (so it can read the full DOM, `fetch` your APIs,
await async data) and returns an array of sections:

```ts
type Section = {
  anchor?: string;   // element id to scroll to. Omit → no "Related sections" link for this chunk.
  title?: string;    // short label shown on the link ("Pricing", "Install").
  url?: string;      // full URL of the section (used for the link). Usually `${location.href}#${anchor}`.
  text: string;      // REQUIRED. The content the model grounds on.
};

window.PRIVATE_CHAT_CONFIG = {
  label: "My Site",
  getSections: (doc) => Section[] | Promise<Section[]>,
};
```

Rules of thumb:
- **`text` is the only required field** — it's what RAG retrieves. Aim for ~50–500 words per
  section: enough to be meaningful, small enough to fit the model's context window.
- **Want clickable links?** Provide `anchor` (a real element `id`) + `url`. No anchor → the
  answer still grounds, just without a link.
- **Return `[]` or throw** → the widget degrades to context-less chat (no crash).

---

## Step 0 — Do you even need a custom scraper?

Run the default scraper against your site and look at the output:

```bash
cd private-chat
node test-files/scrape-eval.mjs https://yoursite.example/
```

You'll get a JSON report: section count, total words, and a sample of each section.

- **Enough relevant content?** (e.g. portfolio → 39 sections / 2,546 words) → **stop, you're
  done.** No custom scraper needed.
- **Mostly chrome / empty / an SPA shell that renders later?** → write a custom scraper.

> `scrape-eval` loads the URL's HTML in jsdom, so for client-rendered SPAs it sees the
> pre-JS shell. If the shell is empty but the real (rendered) page has content, you still
> need a custom scraper — see *Pattern: SPA / dynamic content* and verify in a real browser
> with the snippet in *Step 3*.

---

## Step 1 — Inspect your page in DevTools

Open your site in a browser → DevTools (Elements). Find the containers that hold the content
a visitor would ask about. Look for a repeating structure:

- A single content region? (e.g. `<main>`, `<article>`) → *Pattern A*
- A grid/list of cards (products, posts, features)? → *Pattern B*
- An accordion / definition list? → *Pattern C*
- Content that loads via JS / an API after mount? → *Pattern D*

Note the selector that captures one logical section, and whether each has a heading + an `id`
(or where you'd put one).

---

## Step 2 — Draft `getSections`

Pick the matching pattern below and adapt the selectors. Save it as a standalone file (e.g.
`my-scraper.mjs`) so you can test it locally first:

```js
// my-scraper.mjs — testable standalone (exports getSections)
export function getSections(doc) {
  // ... your logic ...
  return [{ anchor, title, url, text }];
}
```

### Pattern A — one content region (or a few top-level sections)

Best for landing pages, docs, marketing sites with clear `<section>` blocks.

```js
export function getSections(doc) {
  const out = [];
  doc.querySelectorAll("main > section, article").forEach((sec) => {
    const heading = sec.querySelector("h1, h2, h3");
    const title = (heading?.textContent || "Section").trim().replace(/\s+/g, " ").slice(0, 80);
    const anchor = sec.id || heading?.id || "";
    const text = (sec.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 30) {
      out.push({
        anchor,
        title,
        url: anchor ? `${location.origin}${location.pathname}#${anchor}` : location.href,
        text,
      });
    }
  });
  return out;
}
```

> **This is exactly what branchdiff-releases uses** — `main > section` blocks (features,
> install, update). Validated: 7 sections, 777 words.

### Pattern B — a grid/list of cards (products, features, posts)

```js
export function getSections(doc) {
  const out = [];
  doc.querySelectorAll(".feature-card, .product, article.post").forEach((card) => {
    const heading = card.querySelector("h2, h3, .title");
    const title = (heading?.textContent || "Item").trim().slice(0, 80);
    const link = card.querySelector("a[href]");
    const anchor = card.id || heading?.id || "";
    const url = anchor
      ? `${location.origin}${location.pathname}#${anchor}`
      : link?.href || location.href;
    const text = (card.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 30) out.push({ anchor, title, url, text });
  });
  return out;
}
```

### Pattern C — accordion / definition list (FAQ, specs)

Each expandable item is one section, titled by its own label (not the section header).

```js
export function getSections(doc) {
  const out = [];
  doc.querySelectorAll(".accordion-item, details").forEach((item, i) => {
    const label = item.querySelector(".accordion-title, summary, h3");
    const title = (label?.textContent || `Item ${i + 1}`).trim().slice(0, 80);
    // give it a stable id so links work even if the markup has none
    if (!item.id) item.id = `acc-${i + 1}`;
    const text = (item.textContent || "").replace(/\s+/g, " ").trim();
    if (text.length > 30) {
      out.push({
        anchor: item.id,
        title,
        url: `${location.origin}${location.pathname}#${item.id}`,
        text,
      });
    }
  });
  return out;
}
```

### Pattern D — SPA / content that renders after load

`getSections` runs after your app has mounted (the widget loads with `defer` and the React
app boots first on most setups). If content arrives even later (e.g. a fetch), return a
`Promise` and `await` it:

```js
export async function getSections(doc) {
  // Wait for your content container to populate.
  const main = doc.querySelector("main");
  if (!main || !main.textContent.trim()) {
    await new Promise((r) => setTimeout(r, 1500)); // give the SPA a moment
  }
  // ...then scrape as in Pattern A...
}
```

> The widget also **re-scrapes on SPA navigation** (route changes), so navigating to a new
> page re-grounds the chat automatically — you don't need to handle routing.

### Pattern E — feed structured data (JSON-LD, an API, a config)

When the good content lives in data, not markup:

```js
export async function getSections(doc) {
  const res = await fetch("/api/docs");
  const pages = await res.json();
  return pages.map((p) => ({
    anchor: p.slug,
    title: p.title,
    url: `/docs/${p.slug}#${p.slug}`,
    text: `${p.title}. ${p.body}`,
  }));
}
```

---

## Step 3 — Test locally (before touching the page)

```bash
node test-files/scrape-eval.mjs https://yoursite.example/ ./my-scraper.mjs
```

You get the same JSON report, but from **your** `getSections`. Check:
- **Section count + total words** are reasonable (not 0, not thousands).
- **Titles** are human labels ("Install", not "div.container").
- **Anchors** exist for sections you want links on, and they match real element ids.
- **Samples** read like content a visitor would ask about, not button labels.

For a rendered-SPA check that jsdom can't see, paste your `getSections` body into the browser
console on your live page and `console.log` the result.

---

## Step 4 — Add it to your page

Drop the config + embed tag before `</body>`. Set the config **before** the script:

```html
<script>
  window.PRIVATE_CHAT_CONFIG = {
    label: "My Site",
    getSections: (doc) => {
      // …the same function you tested…
      return [{ anchor, title, url, text }];
    },
  };
</script>
<script id="aiChatEmbedScript" defer
        src="https://encryptioner.github.io/private-chat/embed.js"></script>
```

> Tip: keep `getSections` inline in the page (it's site-specific). If it's large, host it as
> a `.js` file and `<script src>` it before the embed — but it must run before `embed.js`.

---

## Step 5 — Verify live (after deploy)

1. Deploy your page + ensure the private-chat RAG build is deployed too.
2. Open the page, open the chat, ask a question your content should answer.
3. Confirm a grounded answer + (if you set anchors) "Related sections" links that scroll.
4. Re-run `node test-files/scrape-eval.mjs <url> ./my-scraper.mjs` any time your markup
   changes, to catch regressions.

---

## Checklist

- [ ] Default scraper insufficient (Step 0)?
- [ ] `getSections(doc)` returns `[{ anchor?, title?, url?, text }]`?
- [ ] Each `text` is ~50–500 words of real content?
- [ ] Anchors match real element ids (for links)?
- [ ] Tested with `scrape-eval` → sensible sections?
- [ ] Config set **before** the embed `<script>`?
- [ ] Verified live after deploy?

## Pitfalls

- **`getSections` set after `embed.js` loads** → ignored. It must run first; use `defer` on
  the embed script and put the config in an inline `<script>` above it.
- **Anchors that don't exist in the DOM** → links render but won't scroll. Either use real ids
  or assign one in the scraper (`item.id = ...`).
- **One giant section** (the whole page as one `text`) → retrieval can't pinpoint; split into
  multiple smaller sections so top-k retrieval surfaces the right part.
- **Returning nav/footer/chrome** → filter by selector or length; the default scraper already
  skips `<nav>/<footer>/<script>` but a custom one must do so itself if it selects broadly.
- **Cross-origin deploy** → no problem; `embed.js` runs your `getSections` host-side and
  bridges sections via `postMessage`. (See `docs/SITE-INTEGRATION.md`.)

---

## Worked example — branchdiff-releases

The branchdiff *viewer* page is bare chrome; the *landing* page has `<main><section>` blocks.
So its `getSections` is Pattern A:

```js
window.PRIVATE_CHAT_CONFIG = {
  label: "branchdiff",
  getSections: (doc) =>
    Array.from(doc.querySelectorAll("main > section")).map((sec) => {
      const heading = sec.querySelector("h1, h2");
      return {
        anchor: sec.id || heading?.id || "",
        title: (heading?.textContent || "Section").trim().replace(/\s+/g, " ").slice(0, 80),
        url: `${location.origin}${location.pathname}#${sec.id}`,
        text: sec.textContent.replace(/\s+/g, " ").trim(),
      };
    }).filter((s) => s.text.length > 30),
};
```

Validated: 7 sections, 777 words — "What it does" (features), Install, Update & Uninstall,
Resources. Visitors get grounded install/feature answers with scroll links.
