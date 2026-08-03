// Throwaway/dev scraping eval — answers "what will RAG ground on for this site?"
//
// Runs either:
//   • the built-in default scraper (src/lib/scraper.js), or
//   • YOUR custom getSections (so you can test a scraper before deploying it)
//
// against a URL's HTML loaded in jsdom, and prints the resulting sections.
// NOT a shipped test — a manual helper.
//
// Usage:
//   node test-files/scrape-eval.mjs <url|file>                     # default scraper
//   node test-files/scrape-eval.mjs <url|file> ./my-scraper.mjs    # your getSections
//
// Your scraper file exports `getSections(doc)` (or a default) matching the contract
// in docs/CUSTOM-SCRAPER-GUIDE.md:
//   export function getSections(doc) { return [{ anchor, title, url, text }, ...] }
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";

const target = process.argv[2];
const scraperPath = process.argv[3];
if (!target) {
  console.error("usage: node test-files/scrape-eval.mjs <url|file> [scraper.mjs]");
  process.exit(1);
}

const html = target.startsWith("http")
  ? await fetch(target).then((r) => r.text())
  : await import("node:fs").then((fs) => fs.readFileSync(target, "utf8"));

const dom = new JSDOM(html, { url: target.startsWith("http") ? target : "https://example.com/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.Node = dom.window.Node;
// Expose browser globals scrapers use (location, fetch, etc.) so a scraper written
// for the real page runs unchanged in this tool.
globalThis.location = dom.window.location;

let sections;
if (scraperPath) {
  const mod = await import(pathToFileURL(resolve(scraperPath)).href);
  const getSections = mod.getSections || mod.default;
  if (typeof getSections !== "function") {
    console.error(`✗ ${scraperPath} must export a getSections(doc) function`);
    process.exit(1);
  }
  sections = await getSections(dom.window.document);
} else {
  const { scrapeCurrentPage } = await import("../src/lib/scraper.js");
  sections = scrapeCurrentPage(dom.window.document.body);
}

const list = Array.isArray(sections) ? sections : [];
const totalWords = list.reduce((n, s) => n + (s.text || "").split(/\s+/).filter(Boolean).length, 0);
console.log(
  JSON.stringify(
    {
      url: target,
      scraper: scraperPath ? `custom: ${scraperPath}` : "default",
      sectionCount: list.length,
      totalWords,
      sections: list.map((s) => ({
        anchor: s.anchor || "",
        title: (s.title || "").slice(0, 80),
        words: (s.text || "").split(/\s+/).filter(Boolean).length,
        url: s.url || "",
        sample: (s.text || "").slice(0, 160),
      })),
    },
    null,
    2
  )
);
