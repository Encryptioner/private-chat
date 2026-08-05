// Unit tests for src/lib/hostNav.js — vitest + jsdom + fake timers.
//
// hostNav attaches to window.parent (the host SPA), which jsdom does not model
// (window.parent === window). We stub a fake EventTarget parent that exposes
// addEventListener/removeEventListener + a location + a body + MutationObserver.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { installHostNavWatcher } from "../hostNav.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Build a fake same-origin parent window: a real EventTarget so dispatchEvent
// drives the listeners, plus the fields hostNav touches.
function fakeParent(pathname = "/route-a") {
  const parent = new EventTarget();
  parent.location = { pathname };
  parent.document = { body: document.createElement("div") };
  parent.MutationObserver = window.MutationObserver;
  return parent;
}

describe("installHostNavWatcher — guard clauses", () => {
  it("noop when not embedded (parent === window)", () => {
    const onNavigate = vi.fn();
    const uninstall = installHostNavWatcher({ onNavigate });
    expect(typeof uninstall).toBe("function");
    uninstall();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("noop + no crash when the parent is cross-origin (document throws)", () => {
    const onNavigate = vi.fn();
    vi.stubGlobal("parent", {
      get document() {
        throw new TypeError("cross-origin");
      },
    });
    const uninstall = installHostNavWatcher({ onNavigate });
    uninstall();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});

describe("installHostNavWatcher — route-change detection (FR-9)", () => {
  it("fires onNavigate on pathname change, after the debounce", () => {
    const parent = fakeParent("/route-a");
    vi.stubGlobal("parent", parent);
    const onNavigate = vi.fn();
    const uninstall = installHostNavWatcher({ onNavigate, debounceMs: 500 });

    parent.location.pathname = "/route-b";
    parent.dispatchEvent(new Event("popstate"));

    vi.advanceTimersByTime(499);
    expect(onNavigate).not.toHaveBeenCalled(); // still debounced
    vi.advanceTimersByTime(2);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it("does NOT fire when pathname is unchanged (same-route DOM edits)", () => {
    const parent = fakeParent("/same");
    vi.stubGlobal("parent", parent);
    const onNavigate = vi.fn();
    const uninstall = installHostNavWatcher({ onNavigate, debounceMs: 100 });

    parent.dispatchEvent(new Event("hashchange")); // burst with no path change
    vi.advanceTimersByTime(300);
    expect(onNavigate).not.toHaveBeenCalled();
    uninstall();
  });

  it("coalesces a burst into one fire", () => {
    const parent = fakeParent("/a");
    vi.stubGlobal("parent", parent);
    const onNavigate = vi.fn();
    const uninstall = installHostNavWatcher({ onNavigate, debounceMs: 100 });

    parent.location.pathname = "/b";
    parent.dispatchEvent(new Event("popstate"));
    parent.dispatchEvent(new Event("popstate"));
    parent.dispatchEvent(new Event("hashchange"));
    vi.advanceTimersByTime(200);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it("uninstall removes listeners (no further fires)", () => {
    const parent = fakeParent("/a");
    vi.stubGlobal("parent", parent);
    const onNavigate = vi.fn();
    const uninstall = installHostNavWatcher({ onNavigate, debounceMs: 100 });
    uninstall();

    parent.location.pathname = "/b";
    parent.dispatchEvent(new Event("popstate"));
    vi.advanceTimersByTime(300);
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
