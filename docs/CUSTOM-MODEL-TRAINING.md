# Custom Model Training & Loading

> **Status:** loading a self-hosted model (`PRIVATE_CHAT_CONFIG.modelUrl`) is **shipped** — see
> [SITE-INTEGRATION.md](SITE-INTEGRATION.md#configuration--windowprivate_chat_config).
> **Training** the model itself is **not** something we build tooling for — it's entirely the
> site owner's choice and responsibility. This doc gives the recipe for those who want to do it
> anyway, but the widget only ever commits to *loading* whatever GGUF you point it at.

---

## TL;DR

- Want your grounded answers to reflect your content? Already done, zero training — see
  [SITE-INTEGRATION.md](SITE-INTEGRATION.md).
- Want a custom voice/tone? Already done, zero training —
  [`persona`](SITE-INTEGRATION.md#configuration--windowprivate_chat_config).
- Want to swap the underlying model itself (a different base model, or one you fine-tuned)?
  **Shipped:** `PRIVATE_CHAT_CONFIG.modelUrl` (see below). This repo supports *loading* it;
  whether and how you *produce* that GGUF is up to you.

---

## `PRIVATE_CHAT_CONFIG.modelUrl`

Same pattern as `persona`: a scalar config value, forwarded by `embed.ts` as a query param,
consumed by `App.jsx`.

```html
<script>
  window.PRIVATE_CHAT_CONFIG = {
    modelUrl: "https://your-cors-enabled-host/your-model.gguf",
  };
</script>
```

### How it works

| File | What it does |
|------|--------------|
| `src/scripts/embed.ts` | `PRIVATE_CHAT_CONFIG.modelUrl` is forwarded onto the iframe URL as a `modelUrl` query param, same as `persona`/`label`. |
| `src/App.jsx` | Reads `modelUrlParam` into a ref at mount. `loadModel()` reads the ref fresh at call time and, when set, calls `wllama.loadModelFromUrl(customModelUrl, options)` instead of the built-in default — the exact same API `PRESET_MODELS` already uses, just pointed at your URL. Local file upload still wins over `modelUrl` if a visitor picks their own GGUF. |
| `docs/SITE-INTEGRATION.md` | `modelUrl` row in the `PRIVATE_CHAT_CONFIG` table. |

### Error handling

`loadModel` already wraps the load in `try/catch` and fires `model_load_failed` /
`error_occurred` analytics events (`src/App.jsx:150-155`). A bad `modelUrl` (404, CORS
rejection, corrupt/non-GGUF file) hits that same catch — **no new failure mode**, it just
degrades the same way a broken preset URL already would. No fallback-to-default-model retry is
planned: a site owner who sets a broken URL should see the load fail loudly (via the existing
error UI), not silently get a different model than the one they configured.

### Requirements for the hosted GGUF

- Must be reachable with **CORS enabled** (HF Spaces, Cloudflare R2, GitHub raw, S3 with a CORS
  policy, etc.) — Wllama fetches it via range requests from the iframe's origin, same
  cross-origin constraint the embedder model already has.
- Architecture must be one `llama.cpp` (and therefore Wllama) supports.
- No hard size cap enforced by the widget, but anything much past the current default
  (Gemma 3 270M, 278MB) meaningfully hurts first-load time for visitors on slow connections —
  same tradeoff as choosing any `PRESET_MODELS` entry today.
- **Avoid long signed/presigned URLs** (S3, R2 query-string auth) if possible — `modelUrl` is
  forwarded as a query param on the iframe's own URL, and auth query strings routinely add
  500–1500+ characters. Prefer a public/unsigned URL (HF Spaces, a public R2/GitHub raw path)
  where you can. See the URL-length note in
  [SITE-INTEGRATION.md](SITE-INTEGRATION.md#configuration--windowprivate_chat_config).

### Testing

No unit test planned — `App.jsx` has no unit test file today (UI orchestration is covered by
the Playwright e2e suite instead, `pnpm run test:e2e`). Verification for this feature is
manual/e2e: point `modelUrl` at a small real GGUF and confirm it loads in place of the default.

---

## If you choose to train your own model

Entirely optional, entirely on you — nothing here is built or maintained by this repo. Recipe
for those who want it:

### Compatible base models

Must be a `llama.cpp`-supported architecture, small enough for browser download/inference:
- Gemma 3 270M / 1B
- Qwen2.5-0.5B / 1.5B-Instruct
- SmolLM2-135M / 360M

### CPU training pipeline (LoRA, not full fine-tune)

Full fine-tuning even a 0.5B model on CPU is impractical. LoRA is the realistic path:

1. Turn site content into instruction (Q&A) pairs — reuse the existing scraper/`site-index.json`
   output as source material; templated heuristics or a synthetic-generation pass (calling a
   larger LLM) to produce the pairs.
2. LoRA fine-tune (rank 8) via Hugging Face `transformers` + `peft`, CPU-only.
3. Merge the adapter, convert to GGUF (`convert_hf_to_gguf.py`), quantize (`q4_k_m`/`q8_0`).
4. Host the resulting `.gguf` somewhere CORS-enabled, point `modelUrl` at it.

**Time estimate:** ~0.5B model, ~1k QA pairs, 3 epochs, 8+ core CPU / 16GB RAM → roughly 1–3
hours. Feasible, but not "no hassle" — requires a Python environment, HF familiarity, and
patience for conversion/quantization failures.

---

## Scope: what we ship vs. what's on you

We ship **loading** (`modelUrl`) because it's a few lines reusing an API already in the
codebase, and it's genuinely useful even without training (swap in any public GGUF). We do
**not** ship a training pipeline/tool: building and supporting one for non-technical site owners
(Python setup, dataset generation, LoRA training, conversion/quantization debugging) is ongoing
engineering and support cost for a gain — persona/tone, mostly — that `persona` + RAG already
cover for free in the common case. If real usage shows that's insufficient, a training tool
becomes worth revisiting; until then it stays a documented recipe, not a product.
