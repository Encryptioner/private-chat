import { defineConfig, devices } from "@playwright/test";

// E2E for the site-aware RAG path (spec FR-1..9, grill M2). These tests load the
// real chat app, which downloads a ~35MB GGUF on first run — so the suite is GATED
// behind RAG_E2E_MODEL=1 (see tests/e2e/rag.spec.js). Without it, every test skips
// (CI-safe). To run locally: build the app, install a browser, set the env, and
// ensure the chat + embedder GGUFs are reachable (dev: public/models/, prod: HF CDN).
//
//   pnpm build
//   npx playwright install chromium
//   RAG_E2E_MODEL=1 pnpm test:e2e
//
// `vite preview` sends NO COOP/COEP headers — matching GitHub Pages (prod), so
// wllama runs single-threaded here as it does in production (grill Note 55).
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false, // one WASM model resident at a time; serial avoids OOM races
  retries: 0,
  workers: 1,
  timeout: 120000,
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    actionTimeout: 30000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm build && vite preview --port 4173 --strictPort",
    url: "http://localhost:4173/",
    reuseExistingServer: true,
    timeout: 180000,
  },
});
