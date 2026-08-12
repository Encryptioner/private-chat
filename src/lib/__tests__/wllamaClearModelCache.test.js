// Unit tests for WllamaWrapper.clearModelCache (src/lib/wllama.js).
//
// Regression test: wllama's own CacheManager.download() "already downloaded"
// fast-path checks file existence by the model's plain cache key whenever the
// Cross-Origin Storage API is unsupported (true almost everywhere) — so a
// network drop mid-download leaves a truncated file that the NEXT load
// attempt mistakes for "already cached" and never re-fetches, permanently
// failing even once the network is back. clearModelCache() is the app-side
// workaround called after any URL load failure; these tests pin its contract:
// delete the failed model's cache entry, and never throw regardless of what
// the underlying cacheManager does.
import { describe, it, expect, vi } from "vitest";

vi.mock("@wllama/wllama/esm", () => ({ Wllama: function MockWllama() {}, WllamaAbortError: class {} }));
vi.mock("@huggingface/jinja", () => ({ Template: class MockTemplate {} }));
vi.mock("@wllama/wllama/esm/wasm/wllama.wasm?url", () => ({ default: "mock-wasm-url" }));

const { getWllamaInstance } = await import("../wllama.js");

describe("WllamaWrapper.clearModelCache", () => {
  it("deletes the model's cache entry by URL", async () => {
    const instance = getWllamaInstance();
    instance.wllama.cacheManager = { delete: vi.fn().mockResolvedValue(undefined) };

    await instance.clearModelCache("https://example.com/model.gguf");

    expect(instance.wllama.cacheManager.delete).toHaveBeenCalledWith("https://example.com/model.gguf");
  });

  it("swallows a rejecting cacheManager.delete instead of throwing", async () => {
    const instance = getWllamaInstance();
    instance.wllama.cacheManager = { delete: vi.fn().mockRejectedValue(new Error("OPFS delete failed")) };

    await expect(instance.clearModelCache("https://example.com/model.gguf")).resolves.toBeUndefined();
  });

  it("no-ops without throwing when cacheManager is absent (e.g. the iframe-conflict mock wllama)", async () => {
    const instance = getWllamaInstance();
    instance.wllama.cacheManager = undefined;

    await expect(instance.clearModelCache("https://example.com/model.gguf")).resolves.toBeUndefined();
  });
});
