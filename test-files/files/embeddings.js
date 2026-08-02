// src/lib/embeddings.js
// Local in-browser embeddings via transformers.js (separate WASM runtime from Wllama).
// npm install @xenova/transformers

import { pipeline } from "@xenova/transformers";
import { hashText } from "./scraper";

const DB_NAME = "private-chat-rag";
const STORE_NAME = "chunks";
const MODEL_NAME = "Xenova/all-MiniLM-L6-v2"; // ~90MB, quantized, runs fully offline after first load

let embedderPromise = null;
function getEmbedder() {
  if (!embedderPromise) {
    embedderPromise = pipeline("feature-extraction", MODEL_NAME, { quantized: true });
  }
  return embedderPromise;
}

async function embedText(text) {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "pageKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getCached(pageKey) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(pageKey);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function setCached(pageKey, record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ pageKey, ...record });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Embeds chunks, but reuses the cached vectors if this exact page content
 * (by hash) was already embedded before. This is the "training" step,
 * it only runs when content actually changes.
 */
export async function buildIndex(chunks) {
  const pageKey = window.location.origin + window.location.pathname;
  const contentHash = hashText(chunks.map((c) => c.text).join("|"));

  const cached = await getCached(pageKey);
  if (cached && cached.contentHash === contentHash) {
    return cached.vectors; // [{ anchor, title, url, text, vector }]
  }

  const vectors = [];
  for (const chunk of chunks) {
    const vector = await embedText(chunk.text);
    vectors.push({ ...chunk, vector });
  }

  await setCached(pageKey, { contentHash, vectors, updatedAt: Date.now() });
  return vectors;
}

function cosineSim(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // already normalized, so dot product == cosine similarity
}

/** Returns the top-k most relevant chunks for a user question. */
export async function retrieveRelevant(question, vectors, topK = 4) {
  const qVec = await embedText(question);
  return vectors
    .map((v) => ({ ...v, score: cosineSim(qVec, v.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
