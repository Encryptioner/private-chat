"""
build_site_index.py
Run this ONCE (or whenever site content changes, e.g. in a CI/CD step or cron job)
to pre-crawl the entire site and produce site-index.json, which ships alongside
embed.js so the in-browser bot can point users to sections on OTHER pages,
not just the current one.

With --embed, vectors are precomputed offline too (same model as the browser's
transformers.js, Xenova/all-MiniLM-L6-v2 = sentence-transformers/all-MiniLM-L6-v2,
same weights, ONNX vs PyTorch). This means the browser NEVER has to embed the
other-page content, only the current page's live scrape. That keeps first-load
fast and battery/CPU cheap on visitor devices; all the heavy lifting happened
once, on your machine, at build time.

Usage:
    pip install scrapling sentence-transformers
    python build_site_index.py https://yoursite.com --max-pages 200 --embed --out site-index.json
"""

import argparse
import json
import re
from collections import deque
from urllib.parse import urljoin, urlparse

from scrapling.fetchers import Fetcher

SKIP_EXTENSIONS = (".pdf", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".zip", ".css", ".js", ".xml", ".ico")


def same_site(base_netloc, url):
    return urlparse(url).netloc in ("", base_netloc)


def slugify(text):
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"\s+", "-", text)
    return text[:60]


def chunk_words(text, max_words=220):
    words = text.split()
    for i in range(0, len(words), max_words):
        yield " ".join(words[i : i + max_words])


def extract_sections(page, url):
    """Groups visible text under the nearest heading/id, mirroring the browser scraper's logic."""
    sections = []
    current_anchor = None
    current_title = page.css("title::text").get() or url
    buffer = []

    def flush():
        text = " ".join(buffer).strip()
        buffer.clear()
        if len(text) > 20:
            for chunk in chunk_words(text):
                sections.append(
                    {
                        "anchor": current_anchor,
                        "title": current_title,
                        "url": f"{url}#{current_anchor}" if current_anchor else url,
                        "text": chunk,
                    }
                )

    # Walk elements in document order; treat headings and ided elements as section breaks
    for el in page.css("body *"):
        tag = el.tag.lower() if hasattr(el, "tag") else ""
        if tag in ("script", "style", "nav", "footer", "noscript", "svg", "iframe"):
            continue

        el_id = el.attrib.get("id") if hasattr(el, "attrib") else None
        is_heading = tag in ("h1", "h2", "h3", "h4", "h5", "h6")

        if el_id or is_heading:
            flush()
            current_anchor = el_id or slugify(el.text or "")
            if is_heading and el.text:
                current_title = el.text.strip()[:80]

        text = (el.text or "").strip()
        if text and not is_heading:
            buffer.append(text)

    flush()
    return sections


def discover_links(page, base_url, base_netloc):
    links = set()
    for href in page.css("a::attr(href)").getall():
        if not href or href.startswith(("mailto:", "tel:", "javascript:")):
            continue
        full = urljoin(base_url, href).split("#")[0]
        if full.lower().endswith(SKIP_EXTENSIONS):
            continue
        if same_site(base_netloc, full):
            links.add(full)
    return links


def crawl(start_url, max_pages=200):
    base_netloc = urlparse(start_url).netloc
    visited = set()
    queue = deque([start_url])
    all_chunks = []

    while queue and len(visited) < max_pages:
        url = queue.popleft()
        if url in visited:
            continue
        visited.add(url)

        try:
            page = Fetcher.get(url, stealthy_headers=True)
        except Exception as e:
            print(f"  skip {url}: {e}")
            continue

        if page.status != 200:
            print(f"  skip {url}: status {page.status}")
            continue

        print(f"  crawled ({len(visited)}/{max_pages}): {url}")
        all_chunks.extend(extract_sections(page, url))

        for link in discover_links(page, url, base_netloc):
            if link not in visited:
                queue.append(link)

    return all_chunks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("start_url")
    parser.add_argument("--max-pages", type=int, default=200)
    parser.add_argument("--out", default="site-index.json")
    parser.add_argument("--embed", action="store_true", help="Precompute vectors offline (recommended)")
    args = parser.parse_args()

    print(f"Crawling {args.start_url} (max {args.max_pages} pages)...")
    chunks = crawl(args.start_url, args.max_pages)

    if args.embed:
        from sentence_transformers import SentenceTransformer

        print("Embedding chunks offline (one-time cost, runs on your machine, not visitors')...")
        model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
        texts = [c["text"] for c in chunks]
        vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=True)
        for chunk, vec in zip(chunks, vectors):
            chunk["vector"] = vec.tolist()

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"generatedFrom": args.start_url, "chunks": chunks}, f, ensure_ascii=False, indent=2)

    print(f"Done. {len(chunks)} chunks written to {args.out}")


if __name__ == "__main__":
    main()
