// Unit tests for src/lib/embeddings.js — vitest + jsdom.
//
// The bge model (~35MB) is NOT loaded in CI. We mock @wllama/wllama/esm so
// `new Wllama()` returns a stub whose createEmbedding maps text to a deterministic
// bag-of-words vector over a fixed vocab. This validates the CACHE, FALLBACK, and
// RETRIEVAL/THRESHOLD logic; real-model quality is the Story 3 smoke test's job.
//
// jsdom ships no IndexedDB → the in-memory fallback (grill M1) is exercised on
// every test by default. One test additionally stubs a THROWING indexedDB to
// cover the distinct "blocked, not absent" incognito branch.
import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted: shared stub instance + deterministic embedder. vi.mock factories are
// hoisted above imports, so anything they close over must come from here.
const { mockEmbedder } = vi.hoisted(() => {
  // Fixed vocab; token-prefix match so "refunds"→refund, "questions"→question.
  const VOCAB = [
    "pricing",
    "price",
    "cost",
    "plan",
    "faq",
    "question",
    "answer",
    "refund",
    "contact",
    "support",
    "email",
    "help",
  ];
  function bowEmbed(text) {
    const tokens = (text || "").toLowerCase().match(/[a-z]+/g) || [];
    const v = new Array(VOCAB.length).fill(0);
    for (const tok of tokens) {
      for (let i = 0; i < VOCAB.length; i++) {
        if (tok.startsWith(VOCAB[i])) {
          v[i] += 1;
          break;
        }
      }
    }
    return v;
  }
  const mockEmbedder = {
    loadModelFromUrl: vi.fn().mockResolvedValue(),
    createEmbedding: vi.fn(({ input }) => ({ data: [{ embedding: bowEmbed(input) }] })),
  };
  return { mockEmbedder };
});

vi.mock("@wllama/wllama/esm", () => ({ Wllama: vi.fn(() => mockEmbedder) }));
vi.mock("@wllama/wllama/esm/wasm/wllama.wasm?url", () => ({ default: "wasm-stub" }));

const CHUNKS = [
  {
    anchor: "pricing",
    title: "Pricing",
    url: "http://localhost/#pricing",
    text: "Pricing plans start at $9 per month. The price includes all features.",
  },
  {
    anchor: "frequently-asked-questions",
    title: "FAQ",
    url: "http://localhost/#frequently-asked-questions",
    text: "Frequently asked questions about refunds and answers to common questions.",
  },
  {
    anchor: "contact",
    title: "Contact",
    url: "http://localhost/#contact",
    text: "Contact support via email for help with your account.",
  },
];

let buildIndex, retrieveRelevant;

beforeEach(async () => {
  // Fresh module state (embedder promise, dbAvailable flag, memCache) per test.
  vi.resetModules();
  mockEmbedder.createEmbedding.mockClear();
  ({ buildIndex, retrieveRelevant } = await import("../embeddings.js"));
});

describe("buildIndex — caching", () => {
  it("embeds every chunk once on first build", async () => {
    const { vectors, version } = await buildIndex(CHUNKS);
    expect(vectors).toHaveLength(CHUNKS.length);
    expect(mockEmbedder.createEmbedding).toHaveBeenCalledTimes(CHUNKS.length);
    expect(version).toBeTruthy(); // race-guard stamp (grill Maj3)
    expect(vectors[0].vec).toBeInstanceOf(Float32Array);
  });

  it("cache hit (identical content) skips embedding on 2nd build", async () => {
    await buildIndex(CHUNKS);
    expect(mockEmbedder.createEmbedding).toHaveBeenCalledTimes(CHUNKS.length);

    const { vectors } = await buildIndex(CHUNKS); // same chunks → memCache hit
    expect(mockEmbedder.createEmbedding).toHaveBeenCalledTimes(CHUNKS.length); // no new calls
    expect(vectors).toHaveLength(CHUNKS.length);
  });

  it("content change forces a re-embed", async () => {
    await buildIndex(CHUNKS);
    const changed = [{ ...CHUNKS[0], text: "Completely new pricing copy that differs." }, ...CHUNKS.slice(1)];
    await buildIndex(changed);
    expect(mockEmbedder.createEmbedding).toHaveBeenCalledTimes(CHUNKS.length * 2);
  });

  it("returns an empty index for no chunks (no model load)", async () => {
    const { vectors, version } = await buildIndex([]);
    expect(vectors).toEqual([]);
    expect(version).toBe("");
    expect(mockEmbedder.createEmbedding).not.toHaveBeenCalled();
  });
});

describe("buildIndex — IDB fallback (grill M1)", () => {
  it("falls back to in-memory cache when indexedDB.open THROWS (incognito)", async () => {
    vi.stubGlobal("indexedDB", {
      open: () => {
        throw new Error("blocked by incognito");
      },
    });
    const { vectors } = await buildIndex(CHUNKS); // builds + caches in memory, no throw
    expect(vectors).toHaveLength(CHUNKS.length);
    // 2nd build serves from memCache → no re-embed
    await buildIndex(CHUNKS);
    expect(mockEmbedder.createEmbedding).toHaveBeenCalledTimes(CHUNKS.length);
    vi.unstubAllGlobals();
  });
});

describe("retrieveRelevant — ranking + threshold (FR-3)", () => {
  it("'pricing' query → pricing chunk top-1, score ≥ MIN_SCORE", async () => {
    const { vectors } = await buildIndex(CHUNKS);
    const results = await retrieveRelevant("pricing", vectors);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].anchor).toBe("pricing");
    expect(results[0].score).toBeGreaterThanOrEqual(0.25);
    // result carries chunk metadata, NOT the heavy vector
    expect(results[0].vec).toBeUndefined();
    expect(results[0].url).toContain("#pricing");
  });

  it("respects topK", async () => {
    const { vectors } = await buildIndex(CHUNKS);
    const results = await retrieveRelevant("pricing refund contact", vectors, 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("off-topic query ('quantum field theory') → [] (all below threshold)", async () => {
    const { vectors } = await buildIndex(CHUNKS);
    const results = await retrieveRelevant("quantum field theory", vectors);
    expect(results).toEqual([]);
  });

  it("raises minScore to filter marginal matches", async () => {
    const { vectors } = await buildIndex(CHUNKS);
    // 0.99 → only near-exact matches survive; 'pricing' vs pluralized chunk < 0.99
    const strict = await retrieveRelevant("pricing", vectors, 4, { minScore: 0.99 });
    expect(strict.every((r) => r.score >= 0.99)).toBe(true);
  });

  it("returns [] for empty index / empty question without throwing", async () => {
    expect(await retrieveRelevant("pricing", [])).toEqual([]);
    const { vectors } = await buildIndex(CHUNKS);
    expect(await retrieveRelevant("", vectors)).toEqual([]);
  });
});
