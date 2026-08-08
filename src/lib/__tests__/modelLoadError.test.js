// Unit tests for src/lib/modelLoadError.js — vitest + jsdom.
import { describe, it, expect } from "vitest";
import { describeLoadError } from "../modelLoadError.js";

describe("describeLoadError", () => {
  it("classifies OOM / wasm-alloc failures as too_large (not recoverable)", () => {
    for (const msg of [
      "out of memory",
      "Unable to allocate buffer",
      "memory access out of bounds",
      "not enough linear memory",
      "Allocation failed",
    ]) {
      const e = describeLoadError(new Error(msg));
      expect(e.category).toBe("too_large");
      expect(e.recoverable).toBe(false);
    }
  });

  it("classifies quota/storage failures as storage (recoverable)", () => {
    const e = describeLoadError(Object.assign(new Error("The operation failed"), { name: "QuotaExceededError" }));
    expect(e.category).toBe("storage");
    expect(e.recoverable).toBe(true);
  });

  it("classifies corrupt/non-GGUF files as invalid (not recoverable)", () => {
    for (const msg of [
      "invalid gguf file",
      "This is not a GGUF file",
      "unexpected end of file",
      "Failed to open file xyz",
    ]) {
      const e = describeLoadError(new Error(msg));
      expect(e.category).toBe("invalid");
      expect(e.recoverable).toBe(false);
    }
  });

  it("falls back to network (recoverable) for transient / unknown errors", () => {
    for (const err of [
      new Error("Failed to fetch"),
      new Error("NetworkError when attempting to fetch resource"),
      new Error("something totally unexpected"),
    ]) {
      const e = describeLoadError(err);
      expect(e.category).toBe("network");
      expect(e.recoverable).toBe(true);
    }
  });

  it("handles null / undefined / string without throwing", () => {
    expect(describeLoadError(null).category).toBe("network");
    expect(describeLoadError(undefined).category).toBe("network");
    expect(describeLoadError("plain string failure").category).toBe("network");
  });

  it("always returns title + message for rendering", () => {
    const e = describeLoadError(new Error("out of memory"));
    expect(typeof e.title).toBe("string");
    expect(typeof e.message).toBe("string");
    expect(e.title.length).toBeGreaterThan(0);
    expect(e.message.length).toBeGreaterThan(0);
  });
});
