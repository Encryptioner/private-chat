// Unit tests for the preset model catalog in src/lib/wllama.js.
//
// The heavy Wllama/Jinja deps are mocked so this exercises ONLY the pure data +
// helpers (PRESET_MODELS, getPresetNameById) — the parts defaultModel relies on.
// `sizeMb` is the single source of truth for the displayed size, so the load
// progress can never disagree with the dropdown label (the old 278 vs 279 bug).
import { describe, it, expect, vi } from "vitest";

vi.mock("@wllama/wllama/esm", () => ({ Wllama: function MockWllama() {}, WllamaAbortError: class {} }));
vi.mock("@huggingface/jinja", () => ({ Template: class MockTemplate {} }));
vi.mock("@wllama/wllama/esm/wasm/wllama.wasm?url", () => ({ default: "mock-wasm-url" }));

const { PRESET_MODELS, getPresetNameById, resolveDefaultModel } = await import("../wllama.js");

describe("PRESET_MODELS catalog", () => {
  const presets = Object.values(PRESET_MODELS);

  it("every preset carries id + label + sizeMb + url, and name derives from label+sizeMb", () => {
    expect(presets.length).toBeGreaterThan(0);
    for (const m of presets) {
      expect(typeof m.id).toBe("string");
      expect(m.id.length).toBeGreaterThan(0);
      expect(typeof m.label).toBe("string");
      expect(typeof m.sizeMb).toBe("number");
      expect(m.url).toMatch(/^https:\/\//);
      // name is the ONE composed display string — label and size read from it.
      expect(m.name).toBe(`${m.label} (${m.sizeMb}MB)`);
    }
  });

  it("ids are unique (defaultModel resolves to exactly one preset)", () => {
    const ids = presets.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("exactly one preset is the built-in default (Gemma 3 270M)", () => {
    const defaults = presets.filter((m) => m.default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].id).toBe("gemma3-270m");
  });

  it("sizeMb matches the advertised size in the name (278, not the old live-ceil 279)", () => {
    const gemma = presets.find((m) => m.id === "gemma3-270m");
    expect(gemma.sizeMb).toBe(278);
    expect(gemma.name).toContain("(278MB)");
  });
});

describe("getPresetNameById", () => {
  it("resolves a known id to its display name", () => {
    expect(getPresetNameById("qwen3-0.6b")).toBe("Qwen3 0.6B (378MB)");
  });

  it("returns undefined for an unknown id (caller falls back to default)", () => {
    expect(getPresetNameById("does-not-exist")).toBeUndefined();
  });

  it("returns undefined for missing/empty input", () => {
    expect(getPresetNameById(undefined)).toBeUndefined();
    expect(getPresetNameById("")).toBeUndefined();
    expect(getPresetNameById(null)).toBeUndefined();
  });

  it("the resolved name is always a valid PRESET_MODELS key", () => {
    for (const m of Object.values(PRESET_MODELS)) {
      expect(PRESET_MODELS[getPresetNameById(m.id)]).toBeDefined();
    }
  });
});

describe("resolveDefaultModel (fuzzy)", () => {
  it("missing/empty input → no name, not ambiguous", () => {
    expect(resolveDefaultModel(undefined)).toEqual({ name: undefined, ambiguous: false, candidates: [] });
    expect(resolveDefaultModel("")).toEqual({ name: undefined, ambiguous: false, candidates: [] });
  });

  it("exact id resolves (no ambiguity)", () => {
    expect(resolveDefaultModel("qwen3-0.6b")).toEqual({
      name: "Qwen3 0.6B (378MB)",
      ambiguous: false,
      candidates: [],
    });
  });

  it("partial/fuzzy id — single match resolves", () => {
    expect(resolveDefaultModel("qwen").name).toBe("Qwen3 0.6B (378MB)");
    expect(resolveDefaultModel("qwen").ambiguous).toBe(false);
  });

  it("partial label — single match resolves (case-insensitive)", () => {
    expect(resolveDefaultModel("SMOL").name).toBe("SmolLM2 360M (258MB)");
  });

  it("ambiguous match → picks the SMALLEST preset + lists candidates", () => {
    // "gemma" matches both gemma3-270m (278MB) and gemma3-1b (769MB).
    const res = resolveDefaultModel("gemma");
    expect(res.ambiguous).toBe(true);
    expect(res.name).toBe("Gemma 3 270M (278MB)"); // smallest
    expect(res.candidates).toEqual(["gemma3-270m", "gemma3-1b"]); // sorted by size asc
  });

  it("unknown input → no name", () => {
    expect(resolveDefaultModel("totally-unknown-model").name).toBeUndefined();
  });

  it("every resolved name is a valid PRESET_MODELS key", () => {
    for (const id of Object.values(PRESET_MODELS).map((m) => m.id)) {
      const { name } = resolveDefaultModel(id);
      expect(PRESET_MODELS[name]).toBeDefined();
    }
  });
});
