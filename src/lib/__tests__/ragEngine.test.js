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

let buildGroundedContext, navigateToSection, isCurrentPageTarget, getCurrentIndexVersion, safeUrl;

beforeEach(async () => {
  vi.resetModules();
  mockRetrieve.mockReset();
  mockScrape.mockReset();
  mockScrape.mockReturnValue([
    { anchor: "pricing", title: "Pricing", url: "http://localhost/#pricing", text: "Pricing is $9." },
  ]);
  document.body.innerHTML = "";
  ({ buildGroundedContext, navigateToSection, isCurrentPageTarget, getCurrentIndexVersion, safeUrl } = await import(
    "../ragEngine.js"
  ));
});

afterEach(() => vi.unstubAllGlobals());

describe("buildGroundedContext (FR-4)", () => {
  it("builds a grounded system message from top-k chunks; urls stay out of the model's context", async () => {
    mockRetrieve.mockResolvedValue([
      { anchor: "pricing", title: "Pricing", url: "http://localhost/#pricing", text: "$9 per month", score: 0.5 },
      { anchor: "contact", title: "Contact", url: "http://localhost/#contact", text: "email us", score: 0.4 },
    ]);
    const res = await buildGroundedContext("where is pricing");
    expect(res.systemContent).toContain("$9 per month");
    // urls/anchors are citation-shaped text the model would just echo back —
    // they're surfaced to the UI via `sources` instead, never in systemContent.
    expect(res.systemContent).not.toContain("http://localhost/#pricing");
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

  it("a persona override replaces only the opening line; format rules + example still apply", async () => {
    mockRetrieve.mockResolvedValue([
      { anchor: "pricing", title: "Pricing", url: "http://localhost/#pricing", text: "$9 per month", score: 0.5 },
    ]);
    const res = await buildGroundedContext("q", undefined, undefined, "You are Aria, Acme's support assistant.");
    expect(res.systemContent).toContain("You are Aria, Acme's support assistant.");
    expect(res.systemContent).not.toContain("You are a friendly assistant chatting with a visitor");
    // Fixed anti-hallucination rules are never replaced by persona.
    expect(res.systemContent).toContain("Never copy the notes verbatim");
  });

  it("no persona → falls back to the default opening line (unchanged behavior)", async () => {
    mockRetrieve.mockResolvedValue([
      { anchor: "pricing", title: "Pricing", url: "http://localhost/#pricing", text: "$9 per month", score: 0.5 },
    ]);
    const res = await buildGroundedContext("q");
    expect(res.systemContent).toContain("You are a friendly assistant chatting with a visitor on this website.");
  });

  it("persona also swaps the opening line in the degraded (index-unavailable) system message", async () => {
    mockScrape.mockReturnValue([]); // page yielded 0 scrapeable chunks
    const res = await buildGroundedContext("anything", undefined, undefined, "You are Aria.");
    expect(res.systemContent).toContain("You are Aria.");
    expect(res.systemContent).toContain("unavailable");
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

describe("safeUrl (trust-boundary scheme check for retrieval-source urls)", () => {
  it("allows http/https, same-page fragment, and anchor-only", () => {
    expect(safeUrl(undefined)).toBe(true); // anchor-only → same page
    expect(safeUrl("")).toBe(true);
    expect(safeUrl("#pricing")).toBe(true); // same-page fragment
    expect(safeUrl("http://localhost/#pricing")).toBe(true);
    expect(safeUrl("https://example.com/page")).toBe(true);
  });

  it("rejects script-executing and unparseable schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBe(false);
    expect(safeUrl("data:text/html,<script>")).toBe(false);
    expect(safeUrl("vbscript:msgbox")).toBe(false);
    expect(safeUrl("file:///etc/passwd")).toBe(false);
    expect(safeUrl("not a url")).toBe(false);
  });
});

describe("initPageIndex in-flight dedup (preIndex + first-question race)", () => {
  it("concurrent calls share ONE build — buildIndex runs once, never twice", async () => {
    const { initPageIndex } = await import("../ragEngine.js");
    const { buildIndex } = await import("../embeddings.js");

    // Hold the first build open so a second call lands while it's in flight.
    // mockClear first: buildIndex is a shared mock whose call count carried over
    // from earlier suites' buildGroundedContext calls.
    buildIndex.mockClear();
    let resolveBuild;
    buildIndex.mockImplementationOnce(() => new Promise((resolve) => (resolveBuild = resolve)));

    const sections = [{ anchor: "a", title: "A", url: "http://localhost/#a", text: "hello world" }];
    // Fire two builds before the first resolves — exactly the preIndex background
    // build vs. the visitor's first question overlapping.
    const p1 = initPageIndex(sections);
    const p2 = initPageIndex(sections);
    expect(buildIndex).toHaveBeenCalledTimes(1); // deduped — NOT 2

    resolveBuild({ vectors: [], version: "v-hash-1" });
    await Promise.all([p1, p2]);

    // A later, NON-overlapping call rebuilds — dedup only collapses concurrent calls,
    // so a genuine SPA-nav content change still re-indexes.
    await initPageIndex(sections);
    expect(buildIndex).toHaveBeenCalledTimes(2);
  });
});
