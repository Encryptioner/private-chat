# Regenerating `site-index.json` — dev branches & dynamic content

A companion to [`SITE-INTEGRATION.md`](./SITE-INTEGRATION.md). That doc covers *generating*
`site-index.json` for a live, deployed site. **This doc covers the two situations where crawling
the deployed URL gives you the wrong (stale or empty) index**, and how to get a correct one.

It is written for **both humans and AI agents** — there is a copy-paste
[Quick-run](#quick-run-for-ai-agents--copy-paste) block at the end an agent can execute without
reading the rest.

---

## When to use this

Use this procedure instead of a straight crawl of the production URL when **any** of these is true:

| Symptom | What's happening |
|---|---|
| The deployed `site-index.json` is missing content you recently wrote | You crawled production, but the new content **isn't released/deployed yet** (lives on a dev/feature branch). |
| A page's content is fetched/rendered by JavaScript (markdown→HTML, an SPA route, an API-fed section) and shows up empty or as "Loading…" in the index | The page is **dynamic** — content isn't in the static HTML. (The crawler renders JS, but see the [settle/wait notes](#step-2--crawl) — a too-short wait scrapes the placeholder.) |
| You're about to ship a release and want the index to match on day one, not lag one release behind | Same as row 1 — index from the **unreleased** files, commit it on the branch, let it deploy with the content. |

If none of these apply — static site, already deployed, content unchanged — just re-run the normal
crawl in [`SITE-INTEGRATION.md`](./SITE-INTEGRATION.md#generate-it-one-command-from-the-private-chat-repo).

---

## The two problems, and why this procedure solves both

### Problem 1 — content is dynamic (rendered by JS at runtime)

Many sites don't put their real content in the static HTML. A common pattern: a thin HTML shell
that `fetch()`es a markdown (or JSON) file at runtime and injects the rendered HTML into the DOM:

```js
// page fetches content.md, renders it into #content after load
const md = await (await fetch('./content/GUIDE.md')).text();
document.getElementById('content').innerHTML = marked.parse(md);
```

If you scrape the raw HTML, you get the `"Loading…"` placeholder, not the guide. **The crawler
already handles this** — it renders each page with a real headless browser (Playwright), waits for
the network to go idle, then runs the *same* scraper the widget uses at runtime. By the time it
scrapes, the JS has run and the content is in the DOM. The only knob is **how long to wait** before
scraping (see [Step 2](#step-2--crawl)).

> This is also why `site-index.json` is **chunks-only** (`{anchor,title,url,text}`, no vectors): the
> widget re-embeds the chunks at runtime with its own model, so the crawl only needs the *text* the
> user-visible page produces — including JS-rendered text.

### Problem 2 — content is unreleased (on a dev branch, not yet deployed)

The crawler takes a `--url` and crawls **whatever that URL serves right now**. If you point it at
the production site, you index the *currently deployed* content — which, by definition, does **not**
include anything still on a dev/feature branch. So:

- Crawling production the day before a release → indexes the *old* content → index is stale on release day.
- The fix is to **crawl a local serve of the branch that has the new content**, then commit the
  generated index *onto that branch*. When the branch merges and deploys, the index already matches.

This works because for a static site the dev-branch files are byte-identical to what will ship.

---

## Prerequisites

1. **The crawler** lives in the **private-chat** repo (`tools/build-site-index.mjs`, run as
   `pnpm build:site-index`). All commands below run from the private-chat repo root unless noted.
2. **Chromium for Playwright** — one-time: `npx playwright install chromium`.
3. **The new content checked out locally** — be on the dev/feature branch in the *host site* repo
   (the site whose index you're regenerating), not the private-chat repo.
4. **Know the production base URL** the widget will load the index from — i.e. the
   `siteIndexUrl` host configured in the site's embed bootstrap (look for `PRIVATE_CHAT_CONFIG`).
   You need this for the [host rewrite](#step-3--rewrite-the-host) step.

---

## Procedure

Below, `<SITE_REPO>` = the host site repo (the one with the new content + the `site-index.json`),
`<PROD_BASE>` = the production origin + path prefix the widget loads from
(e.g. `https://user.github.io/project-name`), and `<PORT>` = a free localhost port (e.g. `8080`).

### Step 1 — serve the dev branch locally

From the **host site repo**, serve it as static files. Any static server works; no build step needed
(if your site has a build, run it first so `serve`/`dist` has the fresh output).

```bash
cd <SITE_REPO>          # on the dev/feature branch with the new content
python3 -m http.server <PORT>
```

Verify the new content is actually being served **before** crawling (cheap sanity check — if this
fails, the crawl will too):

```bash
curl -s http://localhost:<PORT>/ | grep -o "<title>[^<]*</title>"
# and, if your content lives in a fetched file, confirm that file has the new text:
curl -s http://localhost:<PORT>/content/CHANGELOG.md | grep -c "<something-only-in-the-new-version>"
```

### Step 2 — crawl

From the **private-chat repo**, run the crawler against the local server.

```bash
pnpm build:site-index -- \
  --url http://localhost:<PORT>/ \
  --pages <comma-sep-page-paths>      `# e.g. /,/guide.html,/changelog.html — explicit is deterministic` \
  --settle 2500                       `# ms to wait after network-idle, so JS-rendered content is in the DOM` \
  --out <SITE_REPO>/site-index.json
```

Notes that matter for this scenario:

- **`--settle <ms>`** is the key flag for dynamic content. The crawler already waits for
  `networkidle` (no network activity for 500ms), which guarantees the `fetch()` has resolved. But
  rendering (markdown parse, syntax highlight, framework hydration) happens *after* that resolve and
  is synchronous-to-fast — `--settle 2500` gives it room. If a page does heavy async rendering,
  bump it. If your content still comes through as "Loading…", this is the dial to turn.
- **`--wait-for "<css-selector>"`** is a stronger guarantee than `--settle` for a specific page: the
  crawler won't scrape until that selector exists. Pick a selector that only appears **after** the
  dynamic content renders (e.g. `#content h2`). Caveat: it applies to *every* page in the crawl with
  a 5s timeout, so only use it if the selector is present on all crawled pages — otherwise use
  `--settle` and let the per-page timeout be skipped.
- **`--pages` vs `--depth`**: `--pages /,/a,/b` crawls an explicit list (deterministic — recommended
  when you know the full page set). `--depth N` discovers pages by following same-path-prefix links
  from the start URL (good when you don't want to enumerate). You can confirm the page set first:
  ```bash
  # every routable HTML page in the site repo:
  find <SITE_REPO> -name "*.html" -not -path "*/node_modules/*"
  ```

### Step 3 — rewrite the host

**This step is mandatory when you crawl localhost.** Each chunk's `url` (and the output's `startUrl`
+ `pages`) is stamped with the page's *real location during the crawl* — see
`src/lib/scraper.js` `buildUrl()`:

```js
const base = loc.origin + loc.pathname;   // ← the crawl-time origin (localhost!)
return anchor ? `${base}#${anchor}` : base;
```

So crawling `http://localhost:8080` writes `http://localhost:8080/guide.html#section` into every
chunk. On the deployed site, the widget's "Related sections" links would point at `localhost` —
broken. Replace the **local base** with the **production base** (origin **and** path prefix) across
the whole file:

```bash
cd <SITE_REPO>
# OS-agnostic (node is already required by the crawler):
node -e "const f='site-index.json',fs=require('fs');const s=fs.readFileSync(f,'utf8').replace(/http:\/\/localhost:<PORT>/g,'<PROD_BASE>');fs.writeFileSync(f,s);"
```

> `<PROD_BASE>` must include the path prefix if the site lives under one. For a GitHub Pages project
> site served at `https://user.github.io/project-name/`, `<PROD_BASE>` is
> `https://user.github.io/project-name` (no trailing slash), and since localhost serves at root,
> `http://localhost:8080/guide.html` → `https://user.github.io/project-name/guide.html`. Correct.
>
> Quick `sed` alternative (macOS needs `-i ''`, Linux just `-i`):
> `sed -i '' 's|http://localhost:<PORT>|<PROD_BASE>|g' site-index.json`

### Step 4 — verify

Confirm the new content actually made it in. Content from a **heading** lands in a chunk's `title`
(the scraper walks the document outline); body text lands in `text` — so check **both** fields, or
you'll falsely conclude a section is missing.

```bash
cd <SITE_REPO>
node -e "
const d=require('./site-index.json');
console.log('generatedAt:', d.generatedAt);
console.log('pages:', d.pages);
console.log('chunks:', d.chunkCount);
console.log('any localhost left?:', d.chunks.some(c => /localhost/.test(c.url + c.title + c.text)));
const hit = (re) => d.chunks.filter(c => re.test(c.title + c.text)).length;
console.log('new-content hits:', hit(/<NEW-CONTENT-MARKER>/));   // e.g. /2\.1\.0|Platform activity/
"
```

Expect: today's `generatedAt`, all `pages` under `<PROD_BASE>`, **no** `localhost` anywhere, and a
non-zero hit count for a string that only exists in the new content.

### Step 5 — commit on the branch

Commit the regenerated `site-index.json` **on the dev/feature branch** (alongside the content
change). It deploys with the content — no lag, no separate release step.

```bash
cd <SITE_REPO>
git add site-index.json
git commit -m "chore: regenerate site-index.json for <release/feature>"
```

### Step 6 — stop the local server

The static server is a long-running process — kill it when done so it doesn't linger:

```bash
kill $(lsof -ti:<PORT>)
```

---

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Chunks are empty / show `"Loading…"` | Dynamic content hadn't rendered when scraped | Raise `--settle`, or add `--wait-for "<post-render-selector>"`. |
| `✗ Could not launch chromium` | Playwright browser not installed | `npx playwright install chromium` |
| "Related sections" links point at `localhost` | You skipped [Step 3](#step-3--rewrite-the-host) | Run the host rewrite; re-verify no `localhost` remains. |
| A section you wrote is missing from the index | It's under the `--min-words` threshold (default 10), or only exists behind a click | Re-run with `--min-words 1` to confirm it was scraped at all; then tune. For click-gated content add `--expand` or a custom `getSections`. |
| Index has the *old* content despite re-crawling | You crawled the production URL, not the local dev serve | Re-crawl `http://localhost:<PORT>/` per [Step 2](#step-2--crawl). |
| Crawled pages you didn't want (sibling projects) | `--depth` followed links outside the site on a shared origin | Use explicit `--pages` instead, or `--depth 0` for a single page. |

---

## Worked example — `branchdiff-releases`

`branchdiff-releases` is a static GitHub Pages site: a landing page plus `guideline.html` and
`changelog.html`, where the latter two `fetch('./content/*.md')` and render it with `marked` at
runtime (dynamic content, Problem 1). A release was staged on the `development` branch but not yet
deployed (unreleased content, Problem 2). The deployed `site-index.json` was stale — it predated the
new `2.1.0` changelog and the restructured guide.

```bash
# 1. serve the dev branch
cd branchdiff-releases && python3 -m http.server 8080

# 2. crawl (from the private-chat repo) — 3 explicit pages, settle for the markdown render
pnpm build:site-index -- \
  --url http://localhost:8080/ \
  --pages /,/guideline.html,/changelog.html \
  --settle 2500 \
  --out ../branchdiff-releases/site-index.json

# 3. rewrite host (prod is under a /branchdiff-releases path prefix on a shared origin)
cd ../branchdiff-releases
node -e "const f='site-index.json',fs=require('fs');const s=fs.readFileSync(f,'utf8').replace(/http:\/\/localhost:8080/g,'https://encryptioner.github.io/branchdiff-releases');fs.writeFileSync(f,s);"

# 4. verify — 2.1.0 now present, no localhost, chunks across all 3 pages
node -e "const d=require('./site-index.json');console.log('chunks',d.chunkCount,'localhost?',d.chunks.some(c=>/localhost/.test(c.url+c.title+c.text)),'2.1.0?',d.chunks.some(c=>/2\.1\.0/.test(c.title+c.text)));"

# 5. commit on the branch
git add site-index.json && git commit -m "chore: regenerate site-index.json for 2.1.0"

# 6. stop the server
kill $(lsof -ti:8080)
```

Result: 361 chunks across 3 pages, `2.1.0` + new features (`Platform activity`, `--include-staged`)
indexed, all URLs under the production origin.

---

## Quick-run (for AI agents / copy-paste)

A parameterized block. Fill the four `<>` vars and run. Assumes the host site repo is on the branch
with the new content and `site-index.json` lives at its root.

```bash
SITE_REPO=<path-to-host-site-repo>          # e.g. ../branchdiff-releases
PROD_BASE=<prod-origin-and-path-prefix>     # e.g. https://user.github.io/project-name  (no trailing slash)
PORT=8080
PAGES=<comma-sep-page-paths>                # e.g. /,/guide.html,/changelog.html  (run: find $SITE_REPO -name '*.html')

# 1. serve dev branch (background)
( cd "$SITE_REPO" && python3 -m http.server $PORT >/tmp/site-index-serve.log 2>&1 & )
until curl -s -o /dev/null "http://localhost:$PORT/"; do sleep 0.3; done

# 2. crawl — from the private-chat repo (where build:site-index lives)
pnpm build:site-index -- \
  --url "http://localhost:$PORT/" \
  --pages "$PAGES" \
  --settle 2500 \
  --out "$SITE_REPO/site-index.json"

# 3. rewrite localhost → prod base (origin + path prefix)
node -e "const f='$SITE_REPO/site-index.json',fs=require('fs');const s=fs.readFileSync(f,'utf8').replace(/http:\/\/localhost:$PORT/g,'$PROD_BASE');fs.writeFileSync(f,s);"

# 4. verify
node -e "const d=require('$SITE_REPO/site-index.json');console.log({generatedAt:d.generatedAt,pages:d.pages,chunkCount:d.chunkCount,localhost_left:d.chunks.some(c=>/localhost/.test(c.url+c.title+c.text))});"

# 5. stop the server
kill $(lsof -ti:$PORT) 2>/dev/null
```

**Then** (human decision, not in the script): `git add site-index.json && git commit` on the branch.

**Agent checklist before declaring done:**
- [ ] `generatedAt` is today.
- [ ] Every entry in `pages` starts with `<PROD_BASE>`.
- [ ] `localhost_left` is `false`.
- [ ] A grep for a string unique to the new content returns > 0 hits across `title`+`text`.
- [ ] The localhost server process is dead (`lsof -ti:$PORT` returns nothing).
- [ ] No background `python3 -m http.server` remains.
