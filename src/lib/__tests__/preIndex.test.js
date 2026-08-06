// Unit tests for src/lib/preIndex.js — the pure preIndex-warming decision.
//
// Enumerates every arrival-order × model-cache scenario so the gate is locked
// independent of React. The headline case: a CACHED chat model (isReady already
// true, no fresh download) MUST still trigger "after-model" indexing.
import { describe, it, expect } from "vitest";
import { shouldPreIndex } from "../preIndex.js";

describe("shouldPreIndex", () => {
  it("null/omitted mode → never pre-index (first-question path owns it)", () => {
    expect(shouldPreIndex(null, true, true, true)).toBe(false);
    expect(shouldPreIndex(undefined, true, true, true)).toBe(false);
  });

  it("no sections yet → never fire (indexing needs host sections to embed)", () => {
    expect(shouldPreIndex("on-open", false, true, true)).toBe(false);
    expect(shouldPreIndex("after-model", false, true, true)).toBe(false);
    expect(shouldPreIndex(5, false, true, true)).toBe(false);
  });

  it('"on-open" fires as soon as sections arrive, ignoring chat-model state', () => {
    expect(shouldPreIndex("on-open", true, false, false)).toBe(true); // model still downloading
    expect(shouldPreIndex("on-open", true, true, true)).toBe(true); // model cached
  });

  it('"after-model" fires once the model is ready — including when it is CACHED', () => {
    // Fresh download, still loading → wait.
    expect(shouldPreIndex("after-model", true, false, false)).toBe(false);
    // Cached model → isReady already true → fire immediately (no fresh download needed).
    expect(shouldPreIndex("after-model", true, true, false)).toBe(true);
  });

  it("numeric mode fires only after the post-ready timer elapses (numericFired)", () => {
    expect(shouldPreIndex(5, true, true, false)).toBe(false); // timer pending
    expect(shouldPreIndex(5, true, true, true)).toBe(true); // timer fired
    // Sections not yet arrived even after the timer → wait for them.
    expect(shouldPreIndex(5, false, true, true)).toBe(false);
  });

  it("unknown mode string → never pre-index (defensive)", () => {
    expect(shouldPreIndex("bogus", true, true, true)).toBe(false);
  });
});
