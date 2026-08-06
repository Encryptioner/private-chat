// Unit tests for src/lib/network.js — vitest + jsdom.
//
// isGoodNetwork is the gate for background preloading (preloadModel/preIndex).
// It must be CONSERVATIVE: when in doubt (no API, data-saver, slow connection),
// return false so we never push a surprise ~278MB download at a mobile user.
import { describe, it, expect, afterEach } from "vitest";
import { isGoodNetwork } from "../network.js";

// navigator.connection is non-standard; define/delete it as a configurable prop
// so each case starts from a known state.
const setConn = (value) =>
  Object.defineProperty(navigator, "connection", { value, configurable: true, writable: true });
const clearConn = () => {
  try {
    delete navigator.connection;
  } catch {
    Object.defineProperty(navigator, "connection", { value: undefined, configurable: true });
  }
};

afterEach(clearConn);

describe("isGoodNetwork", () => {
  it("false when the Network Information API is unavailable (Safari/iOS)", () => {
    clearConn();
    expect(isGoodNetwork()).toBe(false);
  });

  it("false when saveData is on (user opted into data-saver)", () => {
    setConn({ effectiveType: "4g", saveData: true });
    expect(isGoodNetwork()).toBe(false);
  });

  it("false on slow effectiveType (slow-2g/2g/3g)", () => {
    for (const effectiveType of ["slow-2g", "2g", "3g"]) {
      setConn({ effectiveType, saveData: false });
      expect(isGoodNetwork()).toBe(false);
    }
  });

  it("true on 4g without saveData (wifi/fast cellular)", () => {
    setConn({ effectiveType: "4g", saveData: false });
    expect(isGoodNetwork()).toBe(true);
  });

  it("true when effectiveType is absent but saveData off (lenient — unknown speed)", () => {
    setConn({ saveData: false });
    expect(isGoodNetwork()).toBe(true);
  });
});
