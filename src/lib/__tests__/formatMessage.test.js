// Unit tests for src/lib/formatMessage.js — XSS hardening (spec NFR Security).
// The dangerouslySetInnerHTML render path must not let model output (incl. echoed
// scraped content under RAG) inject live HTML/scripts.
import { describe, it, expect } from "vitest";
import { escapeHtml, formatMessageContent } from "../formatMessage.js";

describe("escapeHtml", () => {
  it("neutralizes tag/attribute breakouts", () => {
    expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(escapeHtml(`<img src=x onerror="alert(1)">`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(escapeHtml("a < b && c > d")).toBe("a &lt; b &amp;&amp; c &gt; d");
  });
});

describe("formatMessageContent — XSS hardening (R6 + NFR Security)", () => {
  it("renders a scraped <script> payload as TEXT, not executable HTML", () => {
    const out = formatMessageContent("Here is the code: <script>alert('pwned')</script>");
    expect(out).not.toMatch(/<script>/); // no live script tag
    expect(out).toContain("&lt;script&gt;"); // escaped → renders as text
  });

  it("code blocks render literal HTML as text (no breakout via </code>)", () => {
    const out = formatMessageContent("```html\n</code><script>alert(1)</script>\n```");
    expect(out).not.toMatch(/<script>alert/); // the injected script does not survive
    expect(out).toContain("&lt;script&gt;"); // shown escaped inside the code block
  });

  it("still linkifies a plain URL (escaping does not break URLs)", () => {
    const out = formatMessageContent("see https://example.com for more");
    expect(out).toContain('href="https://example.com"');
  });

  it("strips trailing punctuation from URL in href but keeps it in display", () => {
    const out = formatMessageContent("visit https://example.com/path. for info");
    expect(out).toContain('href="https://example.com/path"');
    expect(out).toContain("https://example.com/path.");
  });

  it("strips trailing closing paren from URL", () => {
    const out = formatMessageContent("see (https://example.com/page) for details");
    expect(out).toContain('href="https://example.com/page"');
    expect(out).toContain("https://example.com/page)");
  });

  it("passes through ELLIPSIS / empty without altering render branching", () => {
    expect(formatMessageContent("...")).toBe("...");
    expect(formatMessageContent("")).toBe("");
  });
});
