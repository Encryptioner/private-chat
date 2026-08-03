// Unit tests for src/lib/siteIndex.js — vitest + jsdom.
// Covers the m3 resolver (explicit param, never window.PRIVATE_CHAT_CONFIG),
// fetch resilience, memoization, and the live/static merge de-dupe.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let loadStaticSiteIndex, combineIndexes, _resetStaticIndexCache;

beforeEach(async () => {
  vi.resetModules();
  ({ loadStaticSiteIndex, combineIndexes, _resetStaticIndexCache } = await import("../siteIndex.js"));
});

afterEach(() => {
  _resetStaticIndexCache();
  vi.unstubAllGlobals();
});

function stubFetch(response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response))
  );
}

describe("loadStaticSiteIndex — resolver (m3: param, NOT window config)", () => {
  it("uses the explicit url when given", async () => {
    const fetchSpy = vi.fn();
    stubFetch({ ok: true, json: () => Promise.resolve({ chunks: [] }) });
    vi.stubGlobal("fetch", fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve({ chunks: [] }) }));
    await loadStaticSiteIndex("/explicit.json");
    expect(fetchSpy).toHaveBeenCalledWith("/explicit.json");
  });

  it("falls back to /site-index.json when no explicit url", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ chunks: [] }) });
    vi.stubGlobal("fetch", fetchSpy);
    await loadStaticSiteIndex();
    expect(fetchSpy).toHaveBeenCalledWith("/site-index.json");
  });

  it("missing file / fetch failure → [] (silent, no throw)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("404")))
    );
    expect(await loadStaticSiteIndex("/none.json")).toEqual([]);
  });

  it("memoizes: one fetch per session", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ chunks: [] }) });
    vi.stubGlobal("fetch", fetchSpy);
    await loadStaticSiteIndex();
    await loadStaticSiteIndex();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("combineIndexes — pure merge + de-dupe (live wins)", () => {
  it("appends static-only chunks; live wins on url collision (no fetch)", () => {
    const live = [
      { url: "http://localhost/#pricing", vec: [1], title: "Live Pricing" },
      { url: "http://localhost/#contact", vec: [2], title: "Contact" },
    ];
    const statik = [
      { url: "http://localhost/#pricing", vec: [9], title: "Static Pricing" }, // dup → dropped
      { url: "http://localhost/#about", vec: [1], title: "About" }, // static-only → kept
    ];
    const combined = combineIndexes(live, statik);
    expect(combined).toHaveLength(3);
    const pricing = combined.find((c) => c.url.includes("#pricing"));
    expect(pricing.title).toBe("Live Pricing"); // live wins over stale static
    expect(combined.some((c) => c.url.includes("#about"))).toBe(true);
  });

  it("keeps static chunks even without a vec (embedding happens upstream now)", () => {
    const combined = combineIndexes([], [{ url: "http://localhost/#about", title: "About" }]);
    expect(combined).toHaveLength(1); // vec-less chunks pass through; ragEngine embeds them
  });

  it("tolerates null/empty inputs", () => {
    expect(combineIndexes(null, null)).toEqual([]);
    expect(combineIndexes([{ url: "a", vec: [1] }], null)).toHaveLength(1);
  });
});
