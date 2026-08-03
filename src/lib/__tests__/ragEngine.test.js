// Unit tests for src/lib/ragEngine.js — vitest + jsdom.
//
// buildGroundedContext/navigateToSection are pure-ish: we mock scraper +
// embeddings so no GGUF loads. navigateToSection manipulates window.parent, so
// same-page uses the real jsdom document (window.parent === window → fallback
// branch) and cross-page stubs a fake parent window.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// jsdom omits scrollIntoView (layout-dependent). Polyfill a noop so the spy
// has a target; real scroll verification is Story 6's Playwright suite.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}

const { mockRetrieve } = vi.hoisted(() => ({ mockRetrieve: vi.fn() }));

vi.mock("../embeddings.js", () => ({
  buildIndex: vi.fn(async (chunks) => ({ vectors: chunks, version: "v-hash-1" })),
  retrieveRelevant: mockRetrieve,
}));
vi.mock("../scraper.js", () => ({
  scrapeCurrentPage: vi.fn(() => [
    { anchor: "pricing", title: "Pricing", url: "http://localhost/#pricing", text: "Pricing is $9." },
  ]),
  chunkSections: vi.fn((sections) => sections),
}));

let buildGroundedContext, navigateToSection, getCurrentIndexVersion;

beforeEach(async () => {
  vi.resetModules();
  mockRetrieve.mockReset();
  document.body.innerHTML = "";
  ({ buildGroundedContext, navigateToSection, getCurrentIndexVersion } = await import("../ragEngine.js"));
});

afterEach(() => vi.unstubAllGlobals());

describe("buildGroundedContext (FR-4)", () => {
  it("builds a grounded system message from top-k chunks, each url surfaced", async () => {
    mockRetrieve.mockResolvedValue([
      { anchor: "pricing", title: "Pricing", url: "http://localhost/#pricing", text: "$9 per month", score: 0.5 },
      { anchor: "contact", title: "Contact", url: "http://localhost/#contact", text: "email us", score: 0.4 },
    ]);
    const res = await buildGroundedContext("where is pricing");
    expect(res.systemContent).toContain("$9 per month");
    expect(res.systemContent).toContain("http://localhost/#pricing"); // R1: url in context
    expect(res.systemContent).toContain("pricing"); // anchor surfaced
    expect(res.sources).toHaveLength(2);
    expect(res.sources[0].url).toContain("#pricing");
    expect(res.version).toBeTruthy(); // race-guard stamp (grill Maj3)
    expect(res.sources[0].vec).toBeUndefined(); // no heavy vector leaked to UI
  });

  it("returns null systemContent when nothing clears threshold (context-less, M1)", async () => {
    mockRetrieve.mockResolvedValue([]);
    const res = await buildGroundedContext("quantum computing");
    expect(res.systemContent).toBeNull();
    expect(res.sources).toEqual([]);
  });

  it("embeds the query once per call; index version is stable without a re-scrape", async () => {
    mockRetrieve.mockResolvedValue([{ anchor: "a", title: "A", url: "http://localhost/#a", text: "t", score: 0.5 }]);
    await buildGroundedContext("q1");
    const v1 = getCurrentIndexVersion();
    await buildGroundedContext("q2");
    expect(getCurrentIndexVersion()).toBe(v1); // no Story 5 swap → unchanged
  });
});

describe("navigateToSection (FR-5)", () => {
  it("no-op without url or anchor", () => {
    expect(() => navigateToSection({})).not.toThrow();
  });

  it("same-page anchor smooth-scrolls + highlights the host element", () => {
    document.body.innerHTML = '<section id="pricing"><h2>Pricing</h2></section>';
    const el = document.getElementById("pricing");
    const scrollSpy = vi.spyOn(el, "scrollIntoView");
    const samePageUrl = new URL("#pricing", window.location.href).href;
    navigateToSection({ url: samePageUrl, anchor: "pricing" });
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(el.style.outline).toMatch(/2px/); // transient highlight set
  });

  it("cross-path url navigates the parent window (best-effort)", () => {
    const fakeParent = {
      document: { getElementById: () => null },
      location: { pathname: "/other-route", href: "" },
    };
    vi.stubGlobal("parent", fakeParent); // window.parent → fake (different path)
    navigateToSection({ url: "http://localhost/pricing-page", anchor: "p" });
    expect(fakeParent.location.href).toBe("http://localhost/pricing-page");
  });

  it("falls back to this window when parent.document throws (cross-origin)", () => {
    // Same-page against own document, no parent access.
    document.body.innerHTML = '<div id="me">visible</div>';
    const el = document.getElementById("me");
    const scrollSpy = vi.spyOn(el, "scrollIntoView");
    vi.stubGlobal("parent", {
      get document() {
        throw new TypeError("cross-origin");
      },
    });
    navigateToSection({ url: new URL("#me", window.location.href).href, anchor: "me" });
    expect(scrollSpy).toHaveBeenCalled();
  });
});
