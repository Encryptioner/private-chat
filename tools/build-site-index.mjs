#!/usr/bin/env node
/* eslint-disable no-console -- CLI tool: console output is user-facing progress */
// tools/build-site-index.mjs
//
// Site-wide crawler → chunks-only site-index.json for cross-page RAG awareness.
// Renders each page with Playwright (handles SPAs), runs the REAL src/lib/scraper.js
// in-page (single source of truth — no duplicated section logic), and writes the
// collected sections as { chunks: [{anchor,title,url,text}] } (NO vectors — the
// widget embeds them at runtime with its own bge embedder; guaranteed vector parity).
//
// Output is committed to the target site repo and served at /site-index.json; the
// widget loads it via PRIVATE_CHAT_CONFIG.siteIndexUrl.
//
// Usage:
//   pnpm build:site-index -- --url https://example.github.io/site/ [--depth 1] \
//     [--pages /,/about,/docs] [--out ./site-index.json]
//
// Requires: npx playwright install chromium  (one-time)
import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

// --- CLI ---
function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const startUrl = arg("url");
const depth = Number.parseInt(arg("depth", "1"), 10);
const pagesArg = arg("pages", ""); // comma-sep explicit paths
const outPath = arg("out", "./site-index.json");
const settleMs = Number.parseInt(arg("settle", "800"), 10);

if (!startUrl) {
  console.error("usage: build:site-index -- --url <start-url> [--depth 1] [--pages a,b] [--out site-index.json]");
  process.exit(1);
}

// The real scraper, export-stripped + exposed on window so it runs in-page.
// addInitScript injects it before every navigation (defined before page scripts run).
const scraperSrc =
  readFileSync(resolve(repoRoot, "src/lib/scraper.js"), "utf8").replace(/export\s+(function|const)/g, "$1") +
  "\nwindow.__pcScrape = scrapeCurrentPage;";

// --- page discovery (BFS over same-origin internal links) ---
function sameOrigin(href, origin) {
  try {
    return new URL(href).origin === origin;
  } catch {
    return false;
  }
}

async function discoverPages(page, start, maxDepth, explicit) {
  if (explicit) {
    return explicit.map((p) => new URL(p, start).href.split("#")[0]);
  }
  // Scope to the start URL's directory prefix. On shared origins (github.io hosts
  // many sites), same-origin-only discovery would crawl siblings (e.g. the root
  // portfolio) — so only follow links under the start path.
  const startObj = new URL(start);
  const prefix = startObj.pathname.replace(/[^/]*$/, ""); // directory of the start URL
  const inScope = (href) => {
    try {
      const u = new URL(href);
      return (
        u.origin === startObj.origin &&
        !["mailto:", "tel:", "javascript:"].includes(u.protocol) &&
        (prefix === "/" || u.pathname === prefix || u.pathname.startsWith(prefix))
      );
    } catch {
      return false;
    }
  };
  const seen = new Set();
  const queue = [{ url: start, d: 0 }];
  const result = [];
  while (queue.length) {
    const { url, d } = queue.shift();
    const clean = url.split("#")[0];
    if (seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
    if (d >= maxDepth) continue;
    try {
      await page.goto(clean, { waitUntil: "networkidle", timeout: 30000 });
    } catch {
      continue; // unreachable page — skip, keep crawling
    }
    const links = await page.evaluate(() =>
      [...document.querySelectorAll("a[href]")]
        .map((a) => a.href)
        .map((h) => h.split("#")[0])
    );
    for (const l of [...new Set(links)]) {
      if (inScope(l) && !seen.has(l)) queue.push({ url: l, d: d + 1 });
    }
  }
  return result;
}

// --- scrape one page with the real scraper ---
async function scrapePage(page, url) {
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  } catch (error) {
    console.warn(`  ! failed to load ${url}: ${error.message}`);
    return [];
  }
  if (settleMs > 0) await page.waitForTimeout(settleMs); // let SPA content render
  // Prefer the site's own custom scraper (PRIVATE_CHAT_CONFIG.getSections) so the
  // index matches what the live page produces; fall back to the default scraper.
  const sections = await page.evaluate(async () => {
    const custom = window.PRIVATE_CHAT_CONFIG?.getSections;
    if (typeof custom === "function") {
      try {
        return await custom(document);
      } catch {
        /* fall through to default */
      }
    }
    return window.__pcScrape(document.body);
  });
  return (sections || []).map((s) => ({ ...s, url: s.url || url }));
}

// --- main ---
const explicit = pagesArg ? pagesArg.split(",").map((s) => s.trim()).filter(Boolean) : null;
let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  console.error("✗ Could not launch chromium. Run: npx playwright install chromium");
  console.error(error.message);
  process.exit(1);
}
const page = await browser.newPage();
await page.addInitScript(scraperSrc);

console.log(`▶ crawling from ${startUrl} (depth ${depth}${explicit ? ", explicit pages" : ""})`);
const urls = await discoverPages(page, startUrl, depth, explicit);
console.log(`  ${urls.length} page(s): ${urls.join(", ")}`);

const all = new Map(); // url -> section, dedupe by url (page+anchor)
let total = 0;
for (const url of urls) {
  const sections = await scrapePage(page, url);
  for (const s of sections) {
    const key = s.url || url;
    if (!all.has(key)) all.set(key, s);
  }
  console.log(`  ✓ ${url}: ${sections.length} section(s)`);
  total += sections.length;
}
await browser.close();

const chunks = [...all.values()];
const doc = {
  generatedAt: new Date().toISOString(),
  startUrl,
  pages: urls,
  chunkCount: chunks.length,
  chunks, // {anchor,title,url,text} — widget embeds these at runtime
};
mkdirSync(dirname(resolve(outPath)), { recursive: true });
writeFileSync(resolve(outPath), JSON.stringify(doc, null, 2));

console.log(`\n✓ wrote ${chunks.length} chunk(s) across ${urls.length} page(s) → ${resolve(outPath)}`);
if (chunks.length > 500) {
  console.log("⚠ large index (>500 chunks). Consider precomputing vectors for this site.");
}
