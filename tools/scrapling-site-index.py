#!/usr/bin/env python3
# ruff: noqa: T201  — CLI tool: print() is user-facing progress
"""tools/scrapling-site-index.py

Scrapling-based site-wide crawler -> chunks-only site-index.json.

An ALTERNATIVE to tools/build-site-index.mjs for site owners who:
  - prefer Python, or run the indexer inside their own (Python) codebase,
  - need to scrape a LOCAL/DEV URL (e.g. http://localhost:5173), or
  - hit anti-bot protection (Cloudflare) on the deployed site.

PARITY: this script injects the REAL src/lib/scraper.js into every rendered
page (via Scrapling's `page_action`) and calls scrapeCurrentPage(document.body)
-- the SAME sectioning the Node crawler and the runtime widget use. Output is
the identical contract {chunks:[{anchor,title,url,text}]}; the widget embeds
those chunks at runtime with its own bge model (no vectors here).

Requires Python 3.10+. Install (one-time; see docs/SITE-INTEGRATION.md for the full guide):
  pip install "scrapling[fetchers]"
  scrapling install                 # downloads Chromium (DynamicFetcher)
  # only if using --stealth (StealthyFetcher drives Camoufox):
  pip install camoufox && playwright install-deps firefox && camoufox fetch

Usage:
  python tools/scrapling-site-index.py --url https://example.github.io/site/ \\
      [--depth 1] [--pages /,/about,/docs] [--out ./site-index.json] \\
      [--max-words 220] [--min-words 10] [--settle 1500] [--wait-for ""] \\
      [--stealth] [--solve-cloudflare] [--network-idle]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin, urlparse

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parent
SCRAPER_PATH = REPO_ROOT / "src" / "lib" / "scraper.js"

# --- pure helpers (no scrapling import -> unit-testable on their own) ---


def directory_prefix(url: str) -> str:
    """Directory of the URL path, trailing slash included (mirrors the Node
    crawler's `pathname.replace(/[^\\/]*$/, "")`). '/' for the root."""
    path = urlparse(url).path
    return path[: path.rfind("/") + 1]


def in_scope(href: str, start: str, prefix: str) -> bool:
    """Same-origin + same-path-prefix gate. On shared origins (github.io hosts
    many sites) this prevents crawling sibling sites under the same origin."""
    try:
        u = urlparse(href)
    except ValueError:
        return False
    if u.scheme in ("mailto", "tel", "javascript", ""):
        return False
    start_u = urlparse(start)
    if (u.scheme, u.netloc) != (start_u.scheme, start_u.netloc):
        return False
    return prefix == "/" or u.path == prefix or u.path.startswith(prefix)


def chunk_section(section: dict, max_words: int) -> list[dict]:
    """Split a section's text into <=max_words chunks, each carrying the
    parent metadata (anchor/title/url). Mirrors scraper.chunkSections."""
    words = section["text"].split()
    chunks = []
    for i in range(0, len(words), max_words):
        chunk = dict(section)
        chunk["text"] = " ".join(words[i : i + max_words])
        chunks.append(chunk)
    return chunks


def build_eval_script() -> str:
    """Read scraper.js, strip `export`, wrap in an IIFE that calls the scraper.
    Runs identically to the Node crawler's injected `window.__pcScrape`."""
    src = SCRAPER_PATH.read_text(encoding="utf-8")
    src = re.sub(r"export\s+(function|const)", r"\1", src)
    return "(() => {" + src + "\nreturn scrapeCurrentPage(document.body);\n})()"


# --- scraping layer ---------------------------------------------------------


def make_page_action(eval_script: str) -> tuple[dict, callable]:
    """Build a page_action closure. Scrapling calls it with the Playwright Page
    after load; we run the injected scraper and stash the result. (page_action's
    own return value is discarded by Scrapling, so we capture via a closure.)"""
    holder: dict = {}

    def action(page) -> None:  # page: playwright.sync_api.Page
        try:
            holder["sections"] = page.evaluate(eval_script)
        except Exception as exc:  # noqa: BLE001 -- page crashed / JS threw
            holder["error"] = str(exc)

    return holder, action


def fetch_page(fetcher, url: str, kwargs: dict, eval_script: str) -> tuple[list, list]:
    """One fetch -> (sections, hrefs). Single-pass: page_action scrapes sections
    while the returned Adaptor yields outbound links. Returns ([], []) on failure."""
    holder, action = make_page_action(eval_script)
    try:
        adaptor = fetcher.fetch(url, page_action=action, **kwargs)
    except Exception as exc:  # noqa: BLE001 -- unreachable / blocked page: skip
        print(f"  ! failed to load {url}: {exc}", file=sys.stderr)
        return [], []
    sections = holder.get("sections") or []
    if "error" in holder:
        print(f"  ! scraper error on {url}: {holder['error']}", file=sys.stderr)
    hrefs = []
    if adaptor is not None:
        try:
            hrefs = adaptor.css("a::attr(href)").getall() or []
        except Exception:  # noqa: BLE001 -- adaptor parse issue: links optional
            hrefs = []
    return sections, hrefs


def discover_and_scrape(fetcher, start: str, depth: int, explicit, kwargs, eval_script):
    """BFS over same-path-prefix internal links. Visits each page ONCE: scrapes
    sections + enqueues in-scope links from the same Adaptor. Returns
    (pages_in_order, {url: sections})."""
    if explicit:
        urls = []
        for p in explicit:
            urls.append(urljoin(start, p).split("#")[0])
        sections_by_url = {}
        for url in urls:
            sections, _ = fetch_page(fetcher, url, kwargs, eval_script)
            sections_by_url[url] = sections
            print(f"  + {url}: {len(sections)} section(s)")
        return urls, sections_by_url

    prefix = directory_prefix(start)
    seen: set[str] = set()
    queue: deque[tuple[str, int]] = deque([(start, 0)])
    pages_order: list[str] = []
    sections_by_url: dict[str, list] = {}

    while queue:
        url, d = queue.popleft()
        clean = url.split("#")[0]
        if clean in seen:
            continue
        seen.add(clean)
        pages_order.append(clean)

        sections, hrefs = fetch_page(fetcher, clean, kwargs, eval_script)
        sections_by_url[clean] = sections
        print(f"  + {clean}: {len(sections)} section(s)")

        if d >= depth:
            continue
        for raw in {h for h in hrefs if h}:
            absolute = urljoin(clean, raw).split("#")[0]
            if in_scope(absolute, start, prefix) and absolute not in seen:
                queue.append((absolute, d + 1))

    return pages_order, sections_by_url


# --- main -------------------------------------------------------------------


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Scrapling site-wide crawler -> chunks-only site-index.json",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--url", required=True, help="start URL (works for localhost/dev)")
    p.add_argument("--depth", type=int, default=1, help="same-path-prefix link depth (default 1)")
    p.add_argument("--pages", default="", help="comma-sep explicit paths (relative to --url)")
    p.add_argument("--out", default="./site-index.json", help="output path")
    p.add_argument("--settle", type=int, default=1500, help="post-load wait in ms (default 1500)")
    p.add_argument("--max-words", type=int, default=220, help="chunk size in words (default 220)")
    p.add_argument("--min-words", type=int, default=10, help="drop chunks shorter than this (default 10)")
    p.add_argument("--wait-for", default="", help="optional CSS selector to wait for (visible)")
    p.add_argument("--stealth", action="store_true", help="use StealthyFetcher (TLS impersonation)")
    p.add_argument("--solve-cloudflare", action="store_true", help="--stealth only: solve Cloudflare challenges")
    p.add_argument("--network-idle", action="store_true", help="wait for network idle (deployed SPAs; DO NOT use with dev/HMR servers)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    start_url = args.url

    try:
        from scrapling.fetchers import DynamicFetcher, StealthyFetcher
    except ImportError:
        sys.exit(
            "Scrapling not installed. Run:\n"
            '  pip install "scrapling[fetchers]"\n'
            "  scrapling install"
        )

    # Build fetch kwargs. network_idle is OFF by default: dev servers (Vite/Next)
    # keep an HMR WebSocket open that prevents the network from ever going idle,
    # which would hang the crawl. A fixed post-load `wait` covers both dev and
    # most deployed sites; opt into --network-idle for heavy deployed SPAs.
    kwargs: dict = {
        "headless": True,
        "network_idle": args.network_idle,
        "wait": args.settle,
        "timeout": 30000,
    }
    if args.wait_for:
        kwargs["wait_selector"] = args.wait_for
        kwargs["wait_selector_state"] = "visible"
    fetcher = StealthyFetcher if args.stealth else DynamicFetcher
    if args.stealth:
        kwargs["solve_cloudflare"] = args.solve_cloudflare

    eval_script = build_eval_script()
    explicit = [s.strip() for s in args.pages.split(",") if s.strip()] or None

    label = "StealthyFetcher" if args.stealth else "DynamicFetcher"
    print(f"> crawling from {start_url} (depth {args.depth}{', explicit pages' if explicit else ''}) [{label}]")
    pages, sections_by_url = discover_and_scrape(fetcher, start_url, args.depth, explicit, kwargs, eval_script)
    print(f"  {len(pages)} page(s): {', '.join(pages)}")

    # Collect + dedup raw sections by first 100 chars (carousels may share an
    # anchor but differ in text, so we dedup on text, not anchor).
    raw_sections: list[dict] = []
    seen_text: set[str] = set()
    for url in pages:
        for s in sections_by_url.get(url, []):
            s = dict(s)
            s["url"] = s.get("url") or url  # backfill url like the Node crawler
            key = (s.get("text") or "").strip()[:100]
            if key and key not in seen_text:
                seen_text.add(key)
                raw_sections.append(s)

    # Chunk + min-word filter.
    chunks: list[dict] = []
    for section in raw_sections:
        for chunk in chunk_section(section, args.max_words):
            if len(chunk["text"].split()) >= args.min_words:
                chunks.append(chunk)

    doc = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "startUrl": start_url,
        "pages": pages,
        "chunkCount": len(chunks),
        "chunks": chunks,  # {anchor,title,url,text} -- widget embeds at runtime
    }
    out_path = Path(args.out).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(doc, indent=2), encoding="utf-8")

    print(f"\n+ wrote {len(chunks)} chunk(s) across {len(pages)} page(s) -> {out_path}")
    if len(chunks) > 500:
        print("! large index (>500 chunks). Consider precomputing vectors for this site.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
