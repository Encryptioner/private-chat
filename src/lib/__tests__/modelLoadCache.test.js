// Unit tests for src/lib/modelLoadCache.js — vitest + jsdom.
import { describe, it, expect, beforeEach } from "vitest";
import { hasLoadedModelBefore, markModelLoaded } from "../modelLoadCache.js";

beforeEach(() => localStorage.clear());

describe("modelLoadCache", () => {
  it("false for a model never marked loaded", () => {
    expect(hasLoadedModelBefore("gemma3-270m")).toBe(false);
  });

  it("true after marking a model loaded", () => {
    markModelLoaded("gemma3-270m");
    expect(hasLoadedModelBefore("gemma3-270m")).toBe(true);
  });

  it("tracks multiple keys independently", () => {
    markModelLoaded("gemma3-270m");
    expect(hasLoadedModelBefore("gemma3-270m")).toBe(true);
    expect(hasLoadedModelBefore("qwen3-0.6b")).toBe(false);
  });

  it("survives corrupted storage instead of throwing", () => {
    localStorage.setItem("pc_models_loaded_v1", "{not json");
    expect(hasLoadedModelBefore("gemma3-270m")).toBe(false);
    expect(() => markModelLoaded("gemma3-270m")).not.toThrow();
  });
});
