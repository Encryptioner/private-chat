// Unit tests for src/lib/scraper.js — vitest + jsdom.
//
// jsdom limitation: window.parent === window (no real iframe parent), so for
// same-origin scrape tests we load the host markup into the global document and
// scrapeCurrentPage() resolves window.parent.document to it. For the cross-origin
// case we vi.stubGlobal("parent", ...) with a throwing document getter.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { scrapeCurrentPage, chunkSections, hashText, slugify, uniqueSlug } from "../scraper.js";

const here = dirname(fileURLToPath(import.meta.url));
const hostHtml = readFileSync(resolve(here, "../../../test-files/poc/host.html"), "utf8");

function loadBody(html) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  document.body.innerHTML = parsed.body.innerHTML;
  document.title = parsed.title || "Acme — Demo Host Site";
}

beforeEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scrapeCurrentPage — host.html (same-origin parent)", () => {
  beforeEach(() => loadBody(hostHtml));

  it("yields the pricing / FAQ / contact sections with anchors + urls", () => {
    const sections = scrapeCurrentPage();
    const anchors = sections.map((s) => s.anchor);

    expect(sections.length).toBeGreaterThanOrEqual(3);
    expect(anchors).toContain("pricing");
    expect(anchors).toContain("frequently-asked-questions"); // id-less heading → slug
    expect(anchors).toContain("contact");

    const pricing = sections.find((s) => s.anchor === "pricing");
    expect(pricing.url).toContain("#pricing");
    expect(pricing.text).toContain("$9");
  });

  it("assigns an id to the id-less FAQ heading so it becomes navigable", () => {
    scrapeCurrentPage();
    expect(document.getElementById("frequently-asked-questions")).not.toBeNull();
  });

  it("does NOT scrape the iframe element itself", () => {
    const sections = scrapeCurrentPage();
    // frame.html content ("chat panel" / frame body) must not leak into sections
    expect(sections.some((s) => /frame\.html/i.test(s.url))).toBe(false);
  });
});

describe("uniqueSlug — collision guard (grill M4)", () => {
  it("returns the base slug when the id is free", () => {
    loadBody("<div><h2>Pricing</h2></div>");
    expect(uniqueSlug("Pricing", document)).toBe("pricing");
  });

  it("suffixes when a SEPARATE element with that id already exists", () => {
    // An id'd "pricing" section (with its own text) + a later id-less "Pricing"
    // heading in a different section → the later one becomes pricing-2.
    loadBody('<section id="pricing"><h2>Pricing</h2><p>original pricing text goes here</p></section>');
    document.body.insertAdjacentHTML(
      "beforeend",
      "<section><h2>Pricing</h2><p>second pricing copy long enough to flush</p></section>"
    );
    const sections = scrapeCurrentPage();
    const anchors = sections.map((s) => s.anchor);

    expect(anchors).toContain("pricing");
    expect(anchors).toContain("pricing-2");
    expect(document.getElementById("pricing").tagName).toBe("SECTION"); // original untouched
  });

  it("does NOT spawn a colliding slug when the heading titles its own id'd section", () => {
    // h2 "Pricing" INSIDE <section id="pricing"> is the section's title, not a
    // new boundary — anchor stays "pricing" (no pricing-2 fragmentation).
    loadBody('<section id="pricing"><h2>Pricing</h2><p>Starter is $9 per month.</p></section>');
    const anchors = scrapeCurrentPage().map((s) => s.anchor);
    expect(anchors).toContain("pricing");
    expect(anchors).not.toContain("pricing-2");
  });
});

describe("resolveRootDoc — cross-origin graceful disable", () => {
  it("falls back to own document when parent.document throws (no crash)", () => {
    loadBody("<main><h2 id='me'>Own doc content visible</h2><p>hello world text</p></main>");
    // Simulate a cross-origin parent: parent !== window and parent.document throws.
    vi.stubGlobal("parent", {
      get document() {
        throw new TypeError("Blocked a frame with origin from accessing a cross-origin frame.");
      },
    });

    const sections = scrapeCurrentPage();
    expect(sections.length).toBeGreaterThanOrEqual(1);
    expect(sections.some((s) => s.text.includes("Own doc content"))).toBe(true);
  });
});

describe("skip tags + hidden nodes", () => {
  it("excludes SCRIPT/STYLE/NAV/FOOTER/NOSCRIPT/SVG/IFRAME, aria-hidden, hidden", () => {
    loadBody(`
      <main>
        <h2 id='keep'>Keep</h2>
        <p>visible text here</p>
        <nav><h2>Nav Heading</h2><p>nav secret unicorn marker</p></nav>
        <footer><p>footer secret unicorn marker</p></footer>
        <div aria-hidden='true'><p>aria hidden unicorn marker</p></div>
        <div hidden><p>hidden attr unicorn marker</p></div>
        <script>var x = 'script unicorn marker';</script>
        <style>.c { content: 'style unicorn marker'; }</style>
      </main>
    `);
    const text = scrapeCurrentPage()
      .map((s) => s.text)
      .join(" ");
    expect(text).not.toContain("unicorn");
    expect(text).toContain("visible text");
  });
});

describe("chunkSections", () => {
  it("splits a long section into ~maxWord chunks, each carrying parent metadata", () => {
    const section = {
      anchor: "pricing",
      title: "Pricing",
      url: "http://localhost/#pricing",
      text: Array.from({ length: 500 }, (_, i) => `word${i}`).join(" "),
    };
    const chunks = chunkSections([section], { maxWords: 220 });
    expect(chunks.length).toBe(3); // 220 + 220 + 60
    expect(chunks[0].text.split(/\s+/).length).toBe(220);
    expect(chunks[2].text.split(/\s+/).length).toBe(60);
    // metadata preserved on every chunk
    for (const c of chunks) {
      expect(c.anchor).toBe("pricing");
      expect(c.url).toBe("http://localhost/#pricing");
    }
  });
});

describe("hashText", () => {
  it("is deterministic and input-sensitive", () => {
    expect(hashText("hello world")).toBe(hashText("hello world"));
    expect(hashText("hello world")).not.toBe(hashText("goodbye world"));
    expect(hashText("")).toBe(hashText("")); // ponytail: 32-bit, fine for small sites
  });
});

describe("slugify", () => {
  it("lowercases, strips non-alnum, dash-joins, caps length", () => {
    expect(slugify("Frequently Asked Questions!")).toBe("frequently-asked-questions");
    expect(slugify("A".repeat(100))).toHaveLength(60);
  });
});
