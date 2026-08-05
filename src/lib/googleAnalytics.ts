/**
 * Google Analytics 4 — Typed event tracking for private-chat.
 *
 * Privacy guarantees:
 *  - Message content is NEVER sent — only message_length.
 *  - LLM outputs are NEVER sent — only response_length and timing.
 *  - embed_opened records hostname only, never the full URL.
 *  - All error strings pass through sanitizeError().
 *
 * Pure TypeScript module — no React imports. Safe to call from any file.
 */

// ── Config ──────────────────────────────────────────────────

const isProduction = import.meta.env.MODE === "production";

export const GOOGLE_ANALYTICS_CONFIG = {
  measurementId: "G-K8S4D3R1C6",

  /**
   * Set to true to enable tracking. Kept false until intentionally activated.
   */
  enabled: false,

  /**
   * Set to true to also track in the local dev server.
   */
  trackInDevelopment: false,

  get shouldTrack(): boolean {
    if (!this.enabled) return false;
    if (!isProduction && !this.trackInDevelopment) return false;
    return true;
  },
};

// ── Event taxonomy ──────────────────────────────────────────

type ModelEvent =
  | { name: "model_load_started"; params: { model_name: string; source: "preset" | "local_file" } }
  | {
      name: "model_load_completed";
      params: { model_name: string; source: "preset" | "local_file"; duration_ms: number };
    }
  | { name: "model_load_failed"; params: { model_name: string; error: string } }
  | { name: "model_switched"; params: { from_model: string; to_model: string } };

type ChatEvent =
  | { name: "message_sent"; params: { message_length: number; context_messages: number } }
  | { name: "response_received"; params: { response_length: number; generation_time_ms: number } }
  | { name: "response_failed"; params: { error: string } }
  | { name: "chat_cleared"; params: { message_count: number } };

type SessionEvent =
  | { name: "session_created" }
  | { name: "session_switched" }
  | { name: "session_deleted"; params: { message_count: number } };

type AccessibilityEvent =
  | { name: "speech_input_used"; params: { duration_seconds: number } }
  | { name: "tts_played"; params: { text_length: number } }
  | { name: "tts_stopped" };

type EmbedEvent = {
  name: "embed_opened";
  params: { host: string };
};

type ErrorEvent = {
  name: "error_occurred";
  params: { category: string; action: string; error: string };
};

export type AnalyticsEvent =
  | ModelEvent
  | ChatEvent
  | SessionEvent
  | AccessibilityEvent
  | EmbedEvent
  | ErrorEvent;

// ── Core tracking function ──────────────────────────────────

/**
 * Send a typed analytics event to Google Analytics via raw gtag.
 * No-ops gracefully when gtag is unavailable (ad-blockers, SSR-like environments).
 */
export function trackEvent(event: AnalyticsEvent): void {
  if (!GOOGLE_ANALYTICS_CONFIG.shouldTrack) return;
  if (typeof window === "undefined" || typeof window.gtag !== "function") return;

  const { name, ...rest } = event;
  const params = "params" in rest ? (rest.params as Record<string, string | number | boolean | undefined>) : undefined;
  window.gtag("event", name, params);
}

// ── Helpers ─────────────────────────────────────────────────

const EMAIL_PATTERN = /[\w.+-]+@[\w.-]+\.\w+/g;

/**
 * Strip email addresses and truncate to 100 chars to prevent PII leakage.
 */
export function sanitizeError(msg: unknown): string {
  const str = msg instanceof Error ? msg.message : String(msg);
  return str.replace(EMAIL_PATTERN, "[email]").slice(0, 100);
}

/**
 * Extract the hostname from the current page's referrer or document.referrer.
 * Falls back to window.location.hostname (meaning the chat itself is the host).
 * Used for embed_opened to track which downstream site opened the widget.
 */
export function getEmbedHost(): string {
  try {
    if (document.referrer) {
      return new URL(document.referrer).hostname;
    }
  } catch {
    // malformed referrer — fall through
  }
  return window.location.hostname;
}
