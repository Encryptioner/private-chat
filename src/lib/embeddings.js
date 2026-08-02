// src/lib/embeddings.js
// Local vector index + retrieval for site-aware RAG. 100% client-side.
//
// Builds its OWN Wllama embedder instance (NOT the chat singleton) — the spike
// (test-files/spike/RESULT.md) proved two instances coexist. Loads bge-small-en-v1.5
// (q8_0) lazily on first buildIndex/retrieveRelevant, NOT on widget open.
//
// Vectors are L2-normalized at embed time → retrieval is a plain dot product.
// Index cached in IndexedDB keyed by origin+pathname; re-embeds only on content
// change. IDB-unavailable (incognito/private mode) → in-memory fallback, never throws.

import { Wllama } from "@wllama/wllama/esm";
import wllamaWasm from "@wllama/wllama/esm/wasm/wllama.wasm?url";

import { RAG } from "./constants.js";
import { hashText } from "./scraper.js";

let embedderPromise = null;

// Lazy: the embedder GGUF (~35MB) loads only when buildIndex/retrieveRelevant
// first runs. Widget open does NOT trigger a load (grill Maj2).
function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const embedder = new Wllama({ default: wllamaWasm }, { suppressNativeLog: true });
      await embedder.loadModelFromUrl(RAG.EMBEDDER_URL, RAG.EMBEDDER_OPTIONS);
      return embedder;
    })();
  }
  return embedderPromise;
}

// createEmbedding returns {data:[{embedding:[...]}]} on wllama 3.x (2.x returned a
// raw array). Copy out of the reused buffer view, then L2-normalize so retrieval
// is a dot product. Returns Float32Array (structured-cloneable for IDB).
async function embedText(text) {
  const embedder = await getEmbedder();
  const res = await embedder.createEmbedding({ input: text });
  const raw = Array.isArray(res) ? res : res?.data?.[0]?.embedding;
  const vec = Float32Array.from(raw);
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < vec.length; i++) vec[i] /= norm;
  return vec;
}

// --- IDB vector store (inlined; ~40 lines, ponytail — not worth a file) ---

let dbAvailable = null; // null=unknown, true=ok, false=use memCache
const memCache = new Map();

function pageKey() {
  return window.location.origin + window.location.pathname;
}

function openDb() {
  return new Promise((resolve, reject) => {
    let req;
    try {
      if (typeof indexedDB === "undefined") throw new Error("indexedDB unavailable");
      req = indexedDB.open(RAG.IDB_NAME, 1);
    } catch (e) {
      return reject(e);
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(RAG.IDB_STORE)) {
        req.result.createObjectStore(RAG.IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCached(key) {
  if (dbAvailable === false) return memCache.get(key) ?? null;
  try {
    const db = await openDb();
    dbAvailable = true;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(RAG.IDB_STORE, "readonly");
      const req = tx.objectStore(RAG.IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    dbAvailable = false; // incognito/private → never retry IDB this session
    return memCache.get(key) ?? null;
  }
}

async function setCached(key, value) {
  if (dbAvailable === false) {
    memCache.set(key, value);
    return;
  }
  try {
    const db = await openDb();
    dbAvailable = true;
    await new Promise((resolve, reject) => {
      const tx = db.transaction(RAG.IDB_STORE, "readwrite");
      tx.objectStore(RAG.IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    dbAvailable = false;
    memCache.set(key, value);
  }
}

/**
 * Embeds chunks and caches the index by page URL + content hash. A cache hit
 * (unchanged content) returns stored vectors WITHOUT loading the model.
 * @param {{anchor:string,title:string,url:string,text:string}[]} chunks
 * @returns {Promise<{vectors:Array, version:string}>} version=contentHash (race guard)
 */
export async function buildIndex(chunks) {
  if (!chunks || chunks.length === 0) return { vectors: [], version: "" };

  const key = pageKey();
  const contentHash = hashText(chunks.map((c) => c.text).join(" "));

  const cached = await getCached(key);
  if (cached && cached.contentHash === contentHash) {
    return { vectors: cached.vectors, version: cached.contentHash };
  }

  try {
    const vectors = [];
    for (const chunk of chunks) {
      const vec = await embedText(chunk.text);
      vectors.push({ ...chunk, vec });
    }
    await setCached(key, { contentHash, vectors, updatedAt: Date.now() });
    // ponytail: version=contentHash so a Story 5 re-scrape that swaps the index
    // mid-query is detectable by the caller (version mismatch) without a counter.
    return { vectors, version: contentHash };
  } catch (error) {
    // Load/embed failure → empty index; Story 4 degrades to context-less chat.
    console.debug("[RAG] buildIndex failed, degrading to empty index:", error?.message);
    return { vectors: [], version: contentHash };
  }
}

/**
 * Retrieves the top-k chunks above minScore for a question (asymmetric bge:
 * the query is prefixed, chunks are not).
 * @param {string} question
 * @param {{vec:Float32Array,anchor,title,url,text}[]} vectors
 * @param {number} [topK]
 * @param {{minScore?:number}} [opts]
 * @returns {Promise<{anchor,title,url,text,score}[]>} chunk metadata + score, no vec
 */
// ponytail: brute-force dot on normalized vectors, O(n) per query; fine to ~2k
// chunks. Bucket/ANN if a site exceeds that.
export async function retrieveRelevant(question, vectors, topK = RAG.TOP_K, { minScore = RAG.MIN_SCORE } = {}) {
  if (!question || !vectors || vectors.length === 0) return [];
  try {
    const qVec = await embedText(RAG.QUERY_PREFIX + question);
    const scored = [];
    for (const v of vectors) {
      let dot = 0;
      const vv = v.vec;
      for (let i = 0; i < qVec.length; i++) dot += qVec[i] * vv[i];
      if (dot >= minScore) {
        scored.push({ anchor: v.anchor, title: v.title, url: v.url, text: v.text, score: dot });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  } catch (error) {
    console.debug("[RAG] retrieveRelevant failed, returning no context:", error?.message);
    return [];
  }
}
