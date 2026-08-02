// Spike orchestrator — drives Q1-Q4 and derives a verdict.
//   Q1  two new Wllama() coexist (no "already initialized")
//   Q2  embed while the chat model is still loaded (+ latency)
//   Q3  bge retrieval quality over poc/host.html (≥2/3 top-1, cosine ≥0.25)
//   Q4  peak resident memory (desktop proxy only — WASM weights live outside JS heap;
//       the binding mobile measurement needs a human on a low-end device)
import { buildChat } from "./chat.js";
import { buildEmbedder } from "./embed.js";

const el = document.getElementById("log");
const lines = [];
const log = (m) => {
  lines.push(m);
  if (el) el.textContent = lines.join("\n");
  console.log(m);
};

// Minimal inline DOM walk for poc/host.html (spike plan: "inline a 10-line
// version"). Story 2's real scraper.js is richer; this just yields anchor-tagged
// text chunks good enough for a retrieval eval.
function hostChunks(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,style,nav,footer,noscript,svg,iframe").forEach((n) => n.remove());
  const chunks = [];
  let anchor = null;
  let title = "Page";
  const buf = [];
  const flush = () => {
    const t = buf.join(" ").replace(/\s+/g, " ").trim();
    if (t.length > 20) chunks.push({ anchor, title, text: t });
    buf.length = 0;
  };
  const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-").slice(0, 60);
  const walk = (n) => {
    if (n.nodeType === 3) { const t = n.textContent.trim(); if (t) buf.push(t); return; }
    if (n.nodeType !== 1) return;
    const id = n.id;
    const isH = /^H[1-6]$/.test(n.tagName);
    if (id || isH) { flush(); anchor = id || slug(n.textContent); if (isH) title = n.textContent.trim().slice(0, 80); }
    [...n.childNodes].forEach(walk);
  };
  walk(doc.body);
  flush();
  return chunks;
}

// bge vectors are normalized post-pooling → cosine = plain dot product.
const dot = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d += a[i] * b[i]; return d; };

// wllama 2.3.4 createEmbedding returns the vector array directly (not {data:[{embedding}]}).
const toVec = (r) => (Array.isArray(r) ? r : r?.data?.[0]?.embedding);

async function main() {
  log("=== RAG-1 SPIKE: dual-Wllama coexistence + bge retrieval ===");
  log(`UA: ${navigator.userAgent}`);
  log(`deviceMemory=${navigator.deviceMemory}GB  cores=${navigator.hardwareConcurrency}`);
  log("");

  // --- chat instance (first) ---
  log("--- building chat instance (LFM2-700M) ---");
  let chat;
  try {
    chat = await buildChat(log);
  } catch (e) {
    log(`[chat] FATAL: ${e.message}`);
  }

  // --- embedder instance (SECOND new Wllama) — Q1 lives here ---
  log("\n--- building embedder instance (bge-small) — second new Wllama() ---");
  const emb = await buildEmbedder(log);
  const Q1 = !emb.error && !emb.alreadyInit;
  log(`\nQ1 (two instances coexist, no "already initialized"): ${Q1 ? "YES" : "NO"}${
    emb.alreadyInit ? " — saw 'already initialized'" : ""
  }${emb.error ? " — " + emb.error : ""}`);

  if (!emb.w) {
    finalize("NO-GO (embedder failed to construct/load)", { Q1, Q2: false, Q3: null });
    return;
  }

  // --- Q2: embed while chat stays loaded ---
  let q2Ms = null;
  let q2Dim = null;
  try {
    const t = performance.now();
    const r = await emb.w.createEmbedding({ input: "where is pricing" });
    q2Ms = Math.round(performance.now() - t);
    q2Dim = toVec(r)?.length ?? null;
  } catch (e) {
    log(`Q2 embed error: ${e.message}`);
  }
  const Q2 = q2Ms != null;
  log(`Q2 (embed while chat loaded): ${Q2 ? "YES" : "NO"} — ${Q2 ? q2Ms + " ms, dim=" + q2Dim : "failed"}`);

  // Expose for interactive degeneracy probing (Q3 was all-1.0 → suspect bad quant).
  window.__embedder = emb.w;
  window.__toVec = toVec;
  window.__dot = dot;

  // --- Q3: retrieval eval ---
  log("\n--- Q3 retrieval eval (test-files/poc/host.html) ---");
  let Q3 = { results: [], pass: false };
  try {
    const html = await (await fetch(`${location.origin}/test-files/poc/host.html`)).text();
    const chunks = hostChunks(html);
    log(`scraped ${chunks.length} chunks: ${chunks.map((c) => c.title).join(" | ")}`);
    const cv = [];
    for (const c of chunks) {
      const r = await emb.w.createEmbedding({ input: c.text });
      // COPY: wllama returns a view into a reused internal buffer — without
      // Float32Array.from(), every entry becomes the last call's vector.
      cv.push(Float32Array.from(toVec(r)));
    }
    const queries = [
      ["where is pricing", "Pricing"],
      ["how do i get a refund", "Frequently Asked Questions"],
      ["how do i contact support", "Contact"],
    ];
    for (const [q, want] of queries) {
      // bge-small-en-v1.5 is asymmetric: prefix retrieval queries per BAAI model card.
      const r = await emb.w.createEmbedding({ input: "Represent this sentence for searching relevant passages: " + q });
      const qv = Float32Array.from(toVec(r));
      const ranked = chunks
        .map((c, i) => ({ title: c.title, score: dot(qv, cv[i]) }))
        .sort((a, b) => b.score - a.score);
      const top = ranked[0];
      const pass = top.title === want && top.score >= 0.25;
      Q3.results.push({ q, want, got: top.title, score: Number(top.score.toFixed(4)), pass });
      log(`  "${q}" -> top1="${top.title}" (${top.score.toFixed(4)}) want="${want}" ${pass ? "PASS" : "FAIL"}`);
    }
    Q3.pass = Q3.results.filter((r) => r.pass).length >= 2;
  } catch (e) {
    log(`Q3 error: ${e.message}`);
  }
  log(`Q3 (retrieval >=2/3 correct, score>=0.25): ${Q3.pass ? "YES" : "NO"}`);

  // --- Q4: memory (desktop proxy only) ---
  log("\n--- Q4 memory (DESKTOP PROXY — NOT a substitute for mobile) ---");
  const mem = performance.memory
    ? {
        usedJSHeapMB: Math.round(performance.memory.usedJSHeapSize / 1e6),
        totalJSHeapMB: Math.round(performance.memory.totalJSHeapSize / 1e6),
        jsHeapLimitMB: Math.round(performance.memory.jsHeapSizeLimit / 1e6),
      }
    : "performance.memory unavailable (Firefox/non-Chrome)";
  log(`JS heap (EXCLUDES wasm linear memory): ${JSON.stringify(mem)}`);
  log(`deviceMemory=${navigator.deviceMemory}GB. NOTE: the ~47MB of GGUF weights + KV caches live in WASM`);
  log(`linear memory, NOT the JS heap — true tab peak needs the browser Task Manager (Shift+Esc / chrome://tracing).`);

  finalize(
    Q1 && Q2 && Q3.pass ? "GO (desktop — mobile Q4 still binding)" : "NO-GO (desktop)",
    { Q1, Q2, q2Ms, q2Dim, Q3, mem, deviceMemory: navigator.deviceMemory }
  );
}

function finalize(verdict, data) {
  log(`\n========================= VERDICT: ${verdict} =========================`);
  log(JSON.stringify(data, null, 2));
  log("\nQ4 (mobile, real low-end device, peak < ~700MB) is the BINDING gate measurement.");
  log("It cannot be done here — needs a human on a phone. See test-files/spike/RESULT.md.");
  window.__SPIKE_RESULT__ = { verdict, ...data, finishedAt: new Date().toISOString() };
}

main().catch((e) => log("SPIKE FATAL: " + (e.stack || e.message)));
