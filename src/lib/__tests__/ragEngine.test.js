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

const { mockRetrieve, mockScrape } = vi.hoisted(() => ({
  mockRetrieve: vi.fn(),
  mockScrape: vi.fn(() => [
    { anchor: "pricing", title: "Pricing", url: "http://localhost/#pricing", text: "Pricing is $9." },
  ]),
}));

vi.mock("../embeddings.js", () => ({
  buildIndex: vi.fn(async (chunks) => ({ vectors: chunks, version: "v-hash-1" })),
  retrieveRelevant: mockRetrieve,
  embedStaticChunks: vi.fn(async (chunks) => chunks || []),
}));
vi.mock("../scraper.js", () => ({
  scrapeCurrentPage: mockScrape,
  chunkSections: vi.fn((sections) => sections),
}));
// Avoid a real fetch for /site-index.json in jsdom; passthrough merge.
vi.mock("../siteIndex.js", () => ({
  loadStaticSiteIndex: vi.fn(async () => []),
  combineIndexes: vi.fn((live, statik) => [...(live || []), ...(statik || [])]),
}));

let buildGroundedContext, navigateToSection, isCurrentPageTarget, getCurrentIndexVersion;

beforeEach(async () => {
  vi.resetModules();
  mockRetrieve.mockReset();
  mockScrape.mockReset();
  mockScrape.mockReturnValue([
    { anchor: "pricing", title: "Pricing", url: "http://localhost/#pricing", text: "Pricing is $9." },
  ]);
  document.body.innerHTML = "";
  ({ buildGroundedContext, navigateToSection, isCurrentPageTarget, getCurrentIndexVersion } = await import(
    "../ragEngine.js"
  ));
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

  it("returns null systemContent when nothing clears threshold (off-topic, M1)", async () => {
    mockRetrieve.mockResolvedValue([]);
    const res = await buildGroundedContext("quantum computing");
    expect(res.systemContent).toBeNull();
    expect(res.sources).toEqual([]);
  });

  it("empty index (all-nav page / load failed) → degradation hint, not null (M1 gap)", async () => {
    mockScrape.mockReturnValue([]); // page yielded 0 scrapeable chunks
    const res = await buildGroundedContext("anything");
    expect(res.systemContent).toContain("unavailable"); // hint so the model doesn't hallucinate
    expect(res.sources).toEqual([]);
  });

  it("uses external sections (host-side, from embed.ts) and skips iframe scrape", async () => {
    mockRetrieve.mockResolvedValue([
      { anchor: "ext", title: "Ext", url: "http://localhost/#ext", text: "external host content", score: 0.5 },
    ]);
    const external = [{ anchor: "ext", title: "Ext", url: "http://localhost/#ext", text: "external host content" }];
    mockScrape.mockClear();
    const res = await buildGroundedContext("q", external);
    expect(mockScrape).not.toHaveBeenCalled(); // external sections win
    expect(res.systemContent).toContain("external host content");
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

  it("cross-path url on the same origin opens a new tab (never navigates the host away)", () => {
    const fakeParent = {
      document: { getElementById: () => null },
      location: { pathname: "/other-route", href: "", origin: "http://localhost" },
    };
    vi.stubGlobal("parent", fakeParent); // window.parent → fake (different path, same origin)
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => {});
    navigateToSection({ url: "http://localhost/pricing-page", anchor: "p" });
    expect(openSpy).toHaveBeenCalledWith("http://localhost/pricing-page", "_blank", "noopener,noreferrer");
    expect(fakeParent.location.href).toBe(""); // never navigated the host in-place
  });

  it("same-path but different-origin url opens a new tab (not treated as same page)", () => {
    const fakeParent = {
      document: { getElementById: () => null },
      location: { pathname: "/pricing-page", href: "", origin: "http://localhost" },
    };
    vi.stubGlobal("parent", fakeParent);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => {});
    navigateToSection({ url: "https://evil.example/pricing-page", anchor: "p" });
    expect(openSpy).toHaveBeenCalledWith("https://evil.example/pricing-page", "_blank", "noopener,noreferrer");
  });

  it("cross-origin parent → asks embed.ts to scroll/navigate via postMessage", () => {
    const postMessage = vi.fn();
    vi.stubGlobal("parent", {
      // parent.document throws → detected as cross-origin
      get document() {
        throw new TypeError("cross-origin");
      },
      postMessage,
    });
    navigateToSection({ url: new URL("#host-el", window.location.href).href, anchor: "host-el" });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "private-chat:scroll-to", anchor: "host-el" }),
      "*"
    );
  });

  it("standalone (window.parent === window) scrolls its own document", () => {
    document.body.innerHTML = '<div id="me">visible</div>';
    const el = document.getElementById("me");
    const scrollSpy = vi.spyOn(el, "scrollIntoView");
    // jsdom default: window.parent === window (no stub) → standalone branch
    navigateToSection({ url: new URL("#me", window.location.href).href, anchor: "me" });
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
  });
});

describe("isCurrentPageTarget (RelatedSections' new-tab affordance)", () => {
  it("no url → treated as current page (anchor-only pointer)", () => {
    expect(isCurrentPageTarget(undefined)).toBe(true);
  });

  it("same origin + same pathname (standalone, no parent) → current page", () => {
    expect(isCurrentPageTarget(new URL("#pricing", window.location.href).href)).toBe(true);
  });

  it("same-origin parent, matching path → current page", () => {
    vi.stubGlobal("parent", {
      location: { origin: "http://localhost", pathname: "/", href: "http://localhost/" },
    });
    expect(isCurrentPageTarget("http://localhost/#pricing")).toBe(true);
  });

  it("same-origin parent, different path → NOT current page", () => {
    vi.stubGlobal("parent", {
      location: { origin: "http://localhost", pathname: "/", href: "http://localhost/" },
    });
    expect(isCurrentPageTarget("http://localhost/other-page")).toBe(false);
  });

  it("same path but different origin → NOT current page", () => {
    vi.stubGlobal("parent", {
      location: { origin: "http://localhost", pathname: "/pricing", href: "http://localhost/pricing" },
    });
    expect(isCurrentPageTarget("https://evil.example/pricing")).toBe(false);
  });

  it("cross-origin parent (can't read location) → defaults to NOT current page", () => {
    vi.stubGlobal("parent", {
      get location() {
        throw new TypeError("cross-origin");
      },
    });
    expect(isCurrentPageTarget("http://localhost/#pricing")).toBe(false);
  });
});
