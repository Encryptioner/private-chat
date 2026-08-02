// Chat Wllama instance — FIRST instance. Loads LFM2-700M (same local path the app
// uses on localhost) and proves it can do a completion. Bypasses the singleton
// (src/lib/wllama.js getWllamaInstance) deliberately — the spike tests whether a
// SECOND independent new Wllama() can coexist with this one.
import { Wllama } from "@wllama/wllama/esm";
import wllamaWasm from "@wllama/wllama/esm/wasm/wllama.wasm?url";

// wllama 3.x: one wasm, { default } path config (2.x used separate single/multi files).
const CONFIG_PATHS = { default: wllamaWasm };

export function buildChat(log) {
  return (async () => {
    const w = new Wllama(CONFIG_PATHS, { suppressNativeLog: true });
    // Gemma 3 270M = the app's REAL default model (PRESET_MODELS default:true).
    // LFM2-700M (the postinstall-downloaded local model) is NOT the default and
    // throws "Invalid typed array length" under wllama 2.3.4 (Mamba/SSM state
    // alloc ~1.08GB exceeds the wasm budget) — pre-existing, unrelated to RAG.
    const url = `${location.origin}/models/gemma-3-270m-it-Q8_0.gguf`;
    const t0 = performance.now();
    await w.loadModelFromUrl(url, { n_ctx: 2048, n_threads: 1 });
    log(`[chat] Gemma-3-270M loaded in ${Math.round(performance.now() - t0)} ms`);
    let ok = false;
    let sample = "";
    try {
      // Two-arg form (prompt, options) — matches App.jsx. Single-object breaks it.
      const r = await w.createCompletion("Say hello in a few words.", { nPredict: 16, sampling: { temp: 0.6 } });
      sample = r?.choices?.[0]?.text || r?.content || JSON.stringify(r).slice(0, 60);
      ok = !!r;
    } catch (e) {
      log(`[chat] completion error: ${e.message}`);
    }
    log(`[chat] completion functional: ${ok}${ok ? ` — "${sample.slice(0, 40)}"` : ""}`);
    return w;
  })();
}
