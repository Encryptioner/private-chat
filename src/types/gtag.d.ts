/**
 * Minimal ambient declaration for the Google Analytics gtag global.
 * The full gtag script is injected via index.html.
 */

type GtagCommand = "event" | "config" | "js" | "set";
type GtagParams = Record<string, string | number | boolean | undefined>;

declare function gtag(command: GtagCommand, targetId: string, params?: GtagParams): void;

interface Window {
  gtag: typeof gtag;
}
