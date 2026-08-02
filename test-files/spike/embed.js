// Embedder Wllama instance — SECOND new Wllama(). Loads bge-small-en-v1.5 with
// embeddings enabled. The whole point of Q1: does this throw "already
// initialized" because the chat instance already instantiated the wasm module?
// We wrap construct + load in try/catch and sniff console for the phrase too.
import { Wllama } from "@wllama/wllama/esm";
import wllamaWasm from "@wllama/wllama/esm/wasm/wllama.wasm?url";

// wllama 3.x: one wasm, { default } path config (2.x used separate single/multi files).
const CONFIG_PATHS = { default: wllamaWasm };

// Dev-only: let the console/eval build fresh embedders to A/B test model files
// without editing + reloading. (Q3 returned constant vectors → isolate which
// GGUF actually embeds distinct inputs.)
window.__Wllama = Wllama;
window.__CONFIG = CONFIG_PATHS;
window.__loadEmbedder = async (url, { pooling = "LLAMA_POOLING_TYPE_MEAN", threads = 1 } = {}) => {
  const w = new Wllama(CONFIG_PATHS, { suppressNativeLog: true });
  await w.loadModelFromUrl(url, {
    embeddings: true,
    pooling_type: pooling,
    n_ctx: 512,
    n_batch: 512,
    n_ubatch: 512,
    n_threads: threads,
  });
  return w;
};

export function buildEmbedder(log) {
  return (async () => {
    // Sniff console for "already initialized" (the singleton's failure signal)
    // without hiding real errors.
    let alreadyInit = false;
    const tap = (...a) => {
      if (/already initialized/i.test(a.map(String).join(" "))) alreadyInit = true;
    };
    const oErr = console.error.bind(console);
    const oWarn = console.warn.bind(console);
    const oLog = console.log.bind(console);
    console.error = (...a) => { tap(...a); oErr(...a); };
    console.warn = (...a) => { tap(...a); oWarn(...a); };
    console.log = (...a) => { tap(...a); oLog(...a); };

    let w;
    try {
      w = new Wllama(CONFIG_PATHS, { suppressNativeLog: true });
    } catch (e) {
      console.error = oErr; console.warn = oWarn; console.log = oLog;
      log(`[embed] construct threw: ${e.message}`);
      return { error: e.message, alreadyInit: /already initialized/i.test(e.message) };
    }

    // Q4_K_M of bge-small is DEGENERATE (returns one constant vector for all
    // input — verified). Q8_0 is the lowest usable quant for this small model.
    const url = `${location.origin}/models/bge-small-en-v1.5-q8_0.gguf`;
    const t0 = performance.now();
    try {
      // pooling_type is the llama.cpp enum STRING, not bare 'mean' (spec FR-2
      // correction — confirmed against Wllama's official embeddings example).
      await w.loadModelFromUrl(url, {
        embeddings: true,
        pooling_type: "LLAMA_POOLING_TYPE_MEAN",
        n_ctx: 512,
        n_batch: 512,
        n_ubatch: 512,
        n_threads: 1,
      });
    } catch (e) {
      console.error = oErr; console.warn = oWarn; console.log = oLog;
      log(`[embed] load threw: ${e.message}`);
      return { error: e.message, alreadyInit: /already initialized/i.test(e.message) || alreadyInit };
    }
    const loadMs = Math.round(performance.now() - t0);

    // wllama 2.3.4 createEmbedding returns the vector array DIRECTLY, not the
    // OpenAI-style {data:[{embedding:[]}]} the docs/example show. Handle both.
    const toVec = (r) => (Array.isArray(r) ? r : r?.data?.[0]?.embedding);
    let dim = 0;
    try {
      const r = await w.createEmbedding({ input: "test" });
      dim = toVec(r)?.length ?? 0;
      if (!dim) log(`[embed] unexpected createEmbedding shape: ${JSON.stringify(r).slice(0, 120)}`);
    } catch (e) {
      console.error = oErr; console.warn = oWarn; console.log = oLog;
      log(`[embed] createEmbedding threw: ${e.message}`);
      return { error: e.message, alreadyInit };
    }

    console.error = oErr; console.warn = oWarn; console.log = oLog;
    log(`[embed] bge-small loaded in ${loadMs} ms, embedding dim=${dim}`);
    return { w, dim, alreadyInit };
  })();
}
