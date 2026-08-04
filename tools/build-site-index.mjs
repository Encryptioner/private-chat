#!/usr/bin/env node
/* eslint-disable no-console -- CLI tool: console output is user-facing progress */
// tools/build-site-index.mjs
//
// Site-wide crawler → chunks-only site-index.json for cross-page RAG awareness.
// Renders each page with Playwright (handles SPAs), runs the REAL src/lib/scraper.js
// in-page (single source of truth — no duplicated section logic), chunks long
// sections to match the widget's runtime behavior, and writes the collected chunks
// as { chunks: [{anchor,title,url,text}] } (NO vectors — the widget embeds them
// at runtime with its own bge embedder; guaranteed vector parity).
//
// Output is committed to the target site repo and served at /site-index.json; the
// widget loads it via PRIVATE_CHAT_CONFIG.siteIndexUrl.
//
// Usage:
//   pnpm build:site-index -- --url https://example.github.io/site/ [--depth 1] \
//     [--pages /,/about,/docs] [--out ./site-index.json] [--max-words 220] \
//     [--min-words 10] [--wait-for ""] [--settle 1500] [--expand] [--max-expand-rounds 8]
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
const settleMs = Number.parseInt(arg("settle", "1500"), 10);
const maxWords = Number.parseInt(arg("max-words", "220"), 10);
const minWords = Number.parseInt(arg("min-words", "10"), 10);
const waitFor = arg("wait-for", ""); // optional CSS selector to wait for
const expand = process.argv.includes("--expand"); // opt-in: click "Show More" etc.
const maxExpandRounds = Number.parseInt(arg("max-expand-rounds", "8"), 10);

if (!startUrl) {
  console.error(
    "usage: build:site-index -- --url <start-url> [--depth 1] [--pages a,b] " +
      "[--out site-index.json] [--max-words 220] [--min-words 10] [--wait-for sel] " +
      "[--settle 1500] [--expand] [--max-expand-rounds 8]"
  );
  process.exit(1);
}

// The real scraper, export-stripped + exposed on window so it runs in-page.
// addInitScript injects it before every navigation (defined before page scripts run).
const scraperSrc =
  readFileSync(resolve(repoRoot, "src/lib/scraper.js"), "utf8").replace(/export\s+(function|const)/g, "$1") +
  "\nwindow.__pcScrape = scrapeCurrentPage;";

// --- page discovery (BFS over same-path-prefix internal links) ---
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
      [...document.querySelectorAll("a[href]")].map((a) => a.href).map((h) => h.split("#")[0])
    );
    for (const l of [...new Set(links)]) {
      if (inScope(l) && !seen.has(l)) queue.push({ url: l, d: d + 1 });
    }
  }
  return result;
}

// Scroll to the bottom of the page to trigger lazy-loaded content.
async function scrollToBottom(page) {
  await page.evaluate(async () => {
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    // Scroll in steps to trigger intersection-observer-based lazy loading
    for (let y = 0; y < document.body.scrollHeight; y += 500) {
      window.scrollTo(0, y);
      await delay(100);
    }
    // Scroll back to top so the page looks normal
    window.scrollTo(0, 0);
  });
}

// Expand hidden content (accordions, "Show More" buttons, etc.) before scraping.
// Single page.evaluate per round to avoid browser crashes from repeated DOM mutations.
// Capped at maxRounds to prevent runaway expansion on complex SPAs.
async function expandHiddenContent(page, maxRounds) {
  const EXPAND_TEXTS = [
    /^show\s/i, // "Show 3 More", "Show Remaining (19)"
    /^see more/i, // "See more"
    /read\s*more/i, // "Read More"
    /^expand/i, // "Expand"
    /^load\s*more/i, // "Load More"
    /^view\s*more/i, // "View More"
    /^show\s*all/i, // "Show All"
    /^see\s*all/i, // "See All"
  ];

  let totalClicked = 0;
  for (let round = 0; round < maxRounds; round++) {
    try {
      const clicked = await page.evaluate((patterns) => {
        const regexes = patterns.map((p) => new RegExp(p));
        const selectors = ["button", '[role="button"]', "summary", '[aria-expanded="false"]'];
        const candidates = new Set();
        for (const sel of selectors) {
          document.querySelectorAll(sel).forEach((el) => candidates.add(el));
        }
        let count = 0;
        for (const el of candidates) {
          const text = (el.textContent || "").trim();
          if (!text || /^see\s*less/i.test(text)) continue;
          if (!regexes.some((rx) => rx.test(text))) continue;
          const style = window.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") continue;
          el.click();
          count++;
        }
        return count;
      }, EXPAND_TEXTS);

      if (clicked === 0) break;
      totalClicked += clicked;
      await page.waitForTimeout(800); // let framework re-render
    } catch {
      // page navigated or crashed — stop expanding, proceed with what we have
      break;
    }
  }
  return totalClicked;
}

// Safe scroll to bottom — wraps in try/catch so expansion failures don't kill the run.
async function safeScrollToBottom(page) {
  try {
    await scrollToBottom(page);
  } catch {
    // page may have crashed during expansion — continue with current DOM state
  }
}

// --- scrape one page with the real scraper ---
async function scrapePage(context, url) {
  let page;
  try {
    page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  } catch (error) {
    console.warn(`  ! failed to load ${url}: ${error.message}`);
    try {
      await page?.close();
    } catch {}
    return [];
  }
  // Wait for a specific element if --wait-for is set
  if (waitFor) {
    try {
      await page.waitForSelector(waitFor, { timeout: 5000 });
    } catch {
      // selector not found — continue anyway, the content might still be useful
    }
  }
  // Expand hidden content only when --expand is passed (opt-in, prevents crashes)
  if (expand) {
    const clicked = await expandHiddenContent(page, maxExpandRounds);
    if (clicked > 0) console.log(`    expanded ${clicked} button(s)`);
  }
  // Scroll to trigger lazy-loaded images/content
  await safeScrollToBottom(page);
  if (settleMs > 0) {
    try {
      await page.waitForTimeout(settleMs);
    } catch {
      /* page crashed */
    }
  }
  // Scrape the page content
  let sections;
  try {
    sections = await page.evaluate(async () => {
      const custom = window.PRIVATE_CHAT_CONFIG?.getSections;
      if (typeof custom === "function") {
        try {
          return await custom(document);
        } catch {
          /* fall through */
        }
      }
      return window.__pcScrape(document.body);
    });
  } catch {
    // Page may have crashed — try a fresh load without expansion
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      if (settleMs > 0) await page.waitForTimeout(settleMs);
      sections = await page.evaluate(async () => {
        const custom = window.PRIVATE_CHAT_CONFIG?.getSections;
        if (typeof custom === "function") {
          try {
            return await custom(document);
          } catch {
            /* fall through */
          }
        }
        return window.__pcScrape(document.body);
      });
    } catch {
      console.warn(`  ! failed to scrape ${url} even after reload`);
      try {
        await page.close();
      } catch {}
      return [];
    }
  }
  try {
    await page.close();
  } catch {}
  return (sections || []).map((s) => ({ ...s, url: s.url || url }));
}

// Chunk a section into smaller pieces, matching the widget's chunkSections behavior.
// Each chunk carries the parent section's metadata (anchor, title, url).
function chunkSection(section) {
  const words = section.text.split(/\s+/);
  const chunks = [];
  for (let i = 0; i < words.length; i += maxWords) {
    chunks.push({ ...section, text: words.slice(i, i + maxWords).join(" ") });
  }
  return chunks;
}

// --- main ---
const explicit = pagesArg
  ? pagesArg
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : null;
let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  console.error("✗ Could not launch chromium. Run: npx playwright install chromium");
  console.error(error.message);
  process.exit(1);
}
const context = await browser.newContext();
await context.addInitScript(scraperSrc);

console.log(`▶ crawling from ${startUrl} (depth ${depth}${explicit ? ", explicit pages" : ""})`);
const urls = await discoverPages(await context.newPage(), startUrl, depth, explicit);
console.log(`  ${urls.length} page(s): ${urls.join(", ")}`);

// Collect raw sections (before chunking). Deduplicate by exact text match only —
// carousel slides may share an anchor but have different content, so we don't
// deduplicate by anchor alone.
const rawSections = [];
const seenText = new Set();
for (const url of urls) {
  const sections = await scrapePage(context, url);
  for (const s of sections) {
    const textHash = s.text.trim().slice(0, 100); // use first 100 chars as dedup key
    if (!seenText.has(textHash)) {
      seenText.add(textHash);
      rawSections.push(s);
    }
  }
  console.log(`  ✓ ${url}: ${sections.length} section(s)`);
}
await browser.close();

// Chunk all sections and filter by minimum word count
const chunks = [];
for (const section of rawSections) {
  const chunked = chunkSection(section);
  for (const chunk of chunked) {
    const wordCount = chunk.text.split(/\s+/).length;
    if (wordCount >= minWords) chunks.push(chunk);
  }
}

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
