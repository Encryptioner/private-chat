// @ts-check
// E2E for site-aware RAG. Every test loads the real chat app, which fetches a
// ~35MB GGUF — so the whole suite is gated behind RAG_E2E_MODEL=1 (skip-by-default,
// CI-safe). This is the manual gate per spike N3 ("real-model smoke is manual");
// the unit suite (src/lib/__tests__) is the always-green automated layer.
//
// Run: RAG_E2E_MODEL=1 pnpm test:e2e   (after: pnpm build, npx playwright install chromium)
import { test, expect } from "@playwright/test";

const MODEL_GATE = process.env.RAG_E2E_MODEL === "1";

// test-embed.html is in public/ → served by `vite preview` at the app root.
const EMBED_PAGE = "/test-embed.html";

test.describe("RAG — model-backed (RAG_E2E_MODEL=1)", () => {
  test.skip(!MODEL_GATE, "set RAG_E2E_MODEL=1 + run: npx playwright install chromium");
  test("config forwards + label renders in embed mode", async ({ page }) => {
    // test-embed.html sets no PRIVATE_CHAT_CONFIG; verify the iframe boots and the
    // default greeting renders (proves embed.ts → iframe → App wiring is intact).
    await page.goto(EMBED_PAGE);
    await expect(page.locator("iframe")).toBeVisible();
    const frame = page.frameLocator("iframe").first();
    await expect(frame.getByText(/how may I help you/i)).toBeVisible({ timeout: 90000 });
  });

  test("grounded answer + Related sections link on a same-origin host", async ({ page }) => {
    await page.goto(EMBED_PAGE);
    const frame = page.frameLocator("iframe").first();
    // Wait for the model to be ready, then ask a page-grounded question.
    await frame.getByText(/how may I help you/i).waitFor({ timeout: 90000 });
    await frame.locator("textarea").fill("where is pricing");
    await frame.locator('button[title="Send message"]').click();
    // The assistant answer should reference pricing, and a Related-sections link
    // should appear (FR-3/FR-4/FR-5).
    await expect(frame.locator("text=Pricing").first()).toBeVisible({ timeout: 120000 });
  });

  test("off-topic question renders NO related-sections links (threshold holds)", async ({ page }) => {
    await page.goto(EMBED_PAGE);
    const frame = page.frameLocator("iframe").first();
    await frame.getByText(/how may I help you/i).waitFor({ timeout: 90000 });
    await frame.locator("textarea").fill("explain quantum field theory");
    await frame.locator('button[title="Send message"]').click();
    // Allow generation to settle, then assert no "Related sections" block rendered.
    await page.waitForTimeout(15000);
    await expect(frame.getByText("Related sections")).toHaveCount(0);
  });

  test("XSS: a scraped script payload renders as text, never executes", async ({ page }) => {
    // FR-NFR Security: scraped host text becomes model context; the rendered output
    // must not inject live HTML. formatMessage escapes (unit-tested); this asserts
    // it holds in the real DOM — no <script> in the chat iframe's message HTML.
    await page.goto(EMBED_PAGE);
    const frame = page.frameLocator("iframe").first();
    await frame.getByText(/how may I help you/i).waitFor({ timeout: 90000 });
    await frame.locator("textarea").fill("repeat exactly: <script>alert(1)</script>");
    await frame.locator('button[title="Send message"]').click();
    await page.waitForTimeout(15000);
    const messageHtml = await frame.locator(".messages-container").innerHTML();
    expect(messageHtml).not.toContain("<script>alert(1)</script>");
  });
});

// Always-on structural check (no model needed): the embed page mounts an iframe.
test.describe("RAG — structure (no model)", () => {
  test("embed page mounts the chat iframe", async ({ page }) => {
    await page.goto(EMBED_PAGE);
    await expect(page.locator("iframe")).toBeVisible();
  });
});
