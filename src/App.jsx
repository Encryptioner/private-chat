import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CHAT_ROLE as ROLE,
  formatChat,
  getWllamaInstance,
  resolveDefaultModel,
  PRESET_MODELS,
  WllamaAbortError,
} from "./lib/wllama";
import { shouldPreIndex } from "./lib/preIndex";
import { loadChatSessions, saveChatSessions, createNewSession, updateSession, deleteSession } from "./lib/chatStorage";
import { trackEvent, sanitizeError, getEmbedHost } from "./lib/googleAnalytics";
import { buildGroundedContext, getCurrentIndexVersion, initPageIndex, hasIndex } from "./lib/ragEngine.js";
import { installHostNavWatcher } from "./lib/hostNav.js";
import { isGoodNetwork } from "./lib/network.js";
import { hasLoadedModelBefore, markModelLoaded } from "./lib/modelLoadCache.js";
import { ELLIPSIS } from "./lib/constants";
import { Box, Button, Container, Flex, Link, ScrollArea, Text } from "@radix-ui/themes";
import Footer from "./components/Footer";
import Loader from "./components/Loader";
import ChatHistorySidebar from "./components/ChatHistorySidebar";
import ChatHeader from "./components/ChatHeader";
import MessageItem from "./components/MessageItem";
import PromptInput from "./components/PromptInput";
import WelcomeMessage from "./components/WelcomeMessage";

const DEFAULT_MODEL_ID = Object.values(PRESET_MODELS).find((m) => m.default)?.name || Object.keys(PRESET_MODELS)[0];

// Small/tiny models occasionally leak their own chat-template control tokens as
// literal text (e.g. "<end_of_turn>", "<|im_end|>", "<|eot_id|>") instead of
// stopping cleanly — most visible on the 270M default. Strips anything shaped
// like a template token so a leaked one never renders mid-answer.
const STRAY_TOKEN_PATTERN_SRC = "<\\|[^|>\\n]{1,32}\\|>|<\\/?(?:start|end)_of_turn>";
const STRAY_TOKEN_RE = new RegExp(STRAY_TOKEN_PATTERN_SRC, "gi");
const stripStrayTokens = (text) => text.replace(STRAY_TOKEN_RE, "");
// Same shape, no `g` flag — safe to call .search() repeatedly on a growing
// string without global-flag lastIndex state leaking between calls.
const STRAY_TOKEN_DETECT_RE = new RegExp(STRAY_TOKEN_PATTERN_SRC, "i");

// Fast path for the known preset models' chat templates (Gemma, ChatML-style
// Qwen/SmolLM2, Llama 3): passed as `stop` so generation halts natively the
// instant the model tries to close its turn, before wasting tokens on
// anything past it. User-uploaded local .gguf files can use a template not
// in this list — STRAY_TOKEN_DETECT_RE + abortSignal below is the generic
// backstop that covers those (and anything this list misses) by watching the
// stream itself instead of hardcoding every model's markers.
const TURN_END_STOP_SEQUENCES = ["<end_of_turn>", "<|im_end|>", "<|eot_id|>"];

// eslint-disable-next-line no-console
const copyToClipboard = (text) => navigator.clipboard.writeText(text).catch((e) => console.error(e));

// Globally-unique per-message id (React key + assistant-message targeting during
// streaming). UUID, NOT a monotonic counter: a counter resets to 0 on every page
// load and collides with ids restored from localStorage → duplicate React keys.
const nextMessageId = () => crypto.randomUUID();

const modelStateDefaults = {
  isLoading: false,
  isReady: false,
  modelId: DEFAULT_MODEL_ID,
  loadingProgress: 0,
  awaitingConsent: false,
  loadError: null,
};

function App() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  // Resolve PRIVATE_CHAT_CONFIG.defaultModel once at init so the very first
  // loadModel() pulls the site owner's chosen preset. Accepts an exact id OR a
  // fuzzy/partial name (e.g. "qwen", "gemma 3"). Invalid → built-in default +
  // console warning; ambiguous (multiple matches) → smallest preset + warning
  // listing candidates so the owner can pin the exact id.
  const [{ isLoading, isReady, modelId, loadingProgress, awaitingConsent, loadError }, setModelState] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("defaultModel");
    const { name, ambiguous, candidates } = resolveDefaultModel(requested);
    if (requested && !name) {
      // eslint-disable-next-line no-console
      console.warn(
        `[private-chat] unknown defaultModel "${requested}" — falling back to built-in default. ` +
          `Valid ids: ${Object.values(PRESET_MODELS)
            .map((m) => m.id)
            .join(", ")}`
      );
    } else if (ambiguous) {
      // eslint-disable-next-line no-console
      console.warn(
        `[private-chat] defaultModel "${requested}" matched several presets — picked the smallest ` +
          `(${name}). Disambiguate with one of: ${candidates.join(", ")}`
      );
    }
    return { ...modelStateDefaults, modelId: name || DEFAULT_MODEL_ID };
  });
  const [isReadingAloud, setIsReadingAloud] = useState(false);
  const [localModelFiles, setLocalModelFiles] = useState([]);
  const [chatSessions, setChatSessions] = useState({});
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [speechRecognition, setSpeechRecognition] = useState(null);
  const [customSystemMessage, setCustomSystemMessage] = useState(
    "You are a friendly, helpful assistant. Reply in a natural, conversational tone — short and to the point, no long explanations."
  );
  const [isMobile, setIsMobile] = useState(false);
  const [generatingSessionId, setGeneratingSessionId] = useState(null);
  const [isIndexing, setIsIndexing] = useState(false);
  const [widgetLabel, setWidgetLabel] = useState(null);
  const siteIndexUrlRef = useRef(null);
  // Site-owner persona override (RAG opening line only — never rendered, so a
  // ref is enough; no re-render needed like widgetLabel).
  const personaRef = useRef(null);
  // Site-owner custom model URL override. The URL param is read once (lazy init
  // of `hasCustomModelUrl` below) and mirrored into this ref BEFORE render #1, so
  // `selectedModel` (derived at render) and `loadModel()` (reads it fresh) both
  // see it from the first paint. loadModel() may null this out to fall back to a
  // preset if the custom model fails to download.
  const modelUrlRef = useRef(null);
  // customModelLocked = a site-owner modelUrl is configured AND still the active
  // choice. While true, the model picker + GGUF uploader are hidden so a visitor
  // only ever sees the owner's chosen model. If the custom download fails, we flip
  // `customModelLoadFailed` → the picker is revealed again and the built-in
  // default is loaded (the existing, unlocked behavior).
  const [customModelLoadFailed, setCustomModelLoadFailed] = useState(false);
  const [hasCustomModelUrl] = useState(() => {
    const url = new URLSearchParams(window.location.search).get("modelUrl");
    if (url) modelUrlRef.current = decodeURIComponent(url); // sync ref before render #1
    return Boolean(url);
  });
  const customModelLocked = hasCustomModelUrl && !customModelLoadFailed;
  // Host→iframe section bridge (cross-origin support). embed.ts posts page
  // sections via postMessage; we store them here and feed them to the RAG index.
  const externalSectionsRef = useRef(null);
  const externalModeRef = useRef(false);
  const hostNavUninstallRef = useRef(null);
  const promptBeforeRecordingRef = useRef("");
  // PRIVATE_CHAT_CONFIG.preIndex ("on-open" | "after-model" | <seconds>), forwarded
  // by embed.ts. null = index on first question (current default). Set once in the
  // mount effect. Number = delay-then-index (timer-driven, see numeric effect).
  const preIndexRef = useRef(null);
  // isReady mirror for refs-only readers (maybePreIndex's after-model check reads
  // this from a mount-effect closure that would otherwise capture stale state).
  const isReadyRef = useRef(false);
  // Set when the numeric preIndex delay elapses (number mode only). maybePreIndex
  // gates on it via shouldPreIndex so a number-mode build only fires post-timer.
  const numericPreIndexFiredRef = useRef(false);
  // Last status key posted to the host (phase+progress), to throttle the bridge:
  // wllama's progressCallback fires per chunk, but we only postMessage when the
  // integer percent or phase actually changes.
  const lastStatusKeyRef = useRef("");
  const [domainParam, setDomainParam] = useState(null);
  const selectedModel = localModelFiles.length
    ? { name: localModelFiles[0].name, url: "file", license: "" }
    : modelUrlRef.current
      ? { name: "Custom model", url: modelUrlRef.current, license: "" }
      : PRESET_MODELS[modelId];

  const wllama = useMemo(() => getWllamaInstance(), []);

  const messagesContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const currentSessionIdRef = useRef(currentSessionId);

  const loadModel = async () => {
    setModelState((current) => ({ ...current, isLoading: true, awaitingConsent: false, loadError: null }));

    const customModelUrl = modelUrlRef.current;
    const preset = PRESET_MODELS[modelId];
    const source = localModelFiles.length ? "local_file" : customModelUrl ? "custom_url" : "preset";
    // Stable key for modelLoadCache (skip the ask-first prompt once this exact
    // model has loaded before). Local files are never persisted/re-offered
    // across reloads, so they're not tracked.
    const modelKey = customModelUrl || preset.id;
    // Resolve the effective model from refs/state, NOT `selectedModel` (a render-
    // derived value that's stale inside a retried load after we clear modelUrlRef
    // to fall back from a failed custom URL to the built-in default).
    const modelName = localModelFiles.length ? localModelFiles[0].name : customModelUrl ? "Custom model" : preset.name;
    const loadStartTime = Date.now();

    trackEvent({ name: "model_load_started", params: { model_name: modelName, source } });

    const options = {
      useCache: true,
      allowOffline: true,
      n_ctx: 4096, // Increase context window to handle longer conversations and larger prompts
      // wllama 3.x enables pthreads at runtime when SharedArrayBuffer is present
      // (COOP/COEP on in dev). The multi-worker GLUE framing desyncs under vite
      // bundling → "Invalid typed array length: 1163217991" (= "GLUE"). Pin to 1
      // thread: avoids the path, and matches prod (GitHub Pages = single-thread).
      n_threads: 1,
      progressCallback: (progress) =>
        setModelState((current) => ({
          ...current,
          loadingProgress: progress,
        })),
    };

    try {
      await wllama.exit();
      if (localModelFiles.length) {
        await wllama.loadModel(localModelFiles, options);
      } else {
        // customUrl wins while modelUrlRef is set; once a failed custom load
        // clears it, this resolves to the built-in default.
        await wllama.loadModelFromUrl(customModelUrl || preset.url, options);
      }
      trackEvent({
        name: "model_load_completed",
        params: { model_name: modelName, source, duration_ms: Date.now() - loadStartTime },
      });
      // Custom model downloaded OK → keep the picker/uploader hidden. The lock is
      // optimistic from render #1; this just confirms the success path.
      if (source === "custom_url") setCustomModelLoadFailed(false);
      if (source !== "local_file") markModelLoaded(modelKey);
      setModelState((current) => ({
        ...modelStateDefaults,
        isReady: true,
        modelId: current.modelId,
      }));
    } catch (err) {
      trackEvent({ name: "model_load_failed", params: { model_name: modelName, error: sanitizeError(err) } });
      trackEvent({
        name: "error_occurred",
        params: { category: "model", action: "load", error: sanitizeError(err) },
      });
      if (source === "custom_url") {
        // Site-owner modelUrl not downloadable (bad URL, CORS, 404, …) → fall back
        // to the built-in default AND reveal the standard picker/uploader so the
        // visitor can still choose a model (existing, unlocked behavior).
        modelUrlRef.current = null;
        setCustomModelLoadFailed(true);
        return loadModel(); // retry as preset: customModelUrl is now null → preset.url
      }
      // Root-cause fix: previously isLoading stayed true forever on any failure
      // here (a failed/interrupted download, e.g. bad network or the visitor
      // navigating away mid-download) — isBusy then permanently disabled New
      // Chat + model switching with no way out. Resetting isLoading + surfacing
      // loadError lets the UI show a Retry button instead of spinning forever.
      setModelState((current) => ({ ...current, isLoading: false, loadError: err }));
      throw err;
    }
  };

  // preIndex warming (PRIVATE_CHAT_CONFIG.preIndex). Builds the RAG index ahead
  // of the first question so the first grounded answer is instant. No-op unless
  // the site owner opted in. initPageIndex is in-flight-deduped (ragEngine), so a
  // concurrent first-question call reuses this build instead of re-embedding.
  // 'on-open' fires at mount (or whenever host sections arrive); 'after-model'
  // waits for the chat model to be ready. True background warming (before the
  // visitor opens the chat) only happens when `preloadModel` also pre-mounted the
  // iframe — otherwise this runs when the chat opens.
  const maybePreIndex = useCallback(() => {
    const mode = preIndexRef.current;
    const sections = externalSectionsRef.current;
    if (!shouldPreIndex(mode, !!sections, isReadyRef.current, numericPreIndexFiredRef.current)) return;
    setIsIndexing(true);
    initPageIndex(sections, siteIndexUrlRef.current).finally(() => setIsIndexing(false));
  }, []);

  useEffect(
    function syncReadyAndPreIndex() {
      // Mirror isReady into a ref so maybePreIndex (read from a mount-effect
      // closure) sees the current value, then drive 'after-model' pre-indexing
      // when the chat model finishes loading (covers sections-arrived-before-ready).
      isReadyRef.current = isReady;
      if (isReady) maybePreIndex();
    },
    [isReady, maybePreIndex]
  );

  useEffect(
    function scrollChatToBottom() {
      const timeout = setTimeout(() => {
        if (messagesContainerRef.current) {
          messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
        }
      }, 0);
      return () => clearTimeout(timeout);
    },
    [messages]
  );

  const [isEmbedded, setIsEmbedded] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const systemParam = urlParams.get("system");
    const domainParam = urlParams.get("domain");
    const embeddedParam = urlParams.get("embedded");
    const labelParam = urlParams.get("label");
    const siteIndexUrlParam = urlParams.get("siteIndexUrl");
    const personaParam = urlParams.get("persona");
    const preIndexParam = urlParams.get("preIndex");

    // eslint-disable-next-line no-console
    console.log({
      systemParam,
      domainParam,
      embeddedParam,
    });

    if (systemParam) {
      const decodedSystemParam = decodeURIComponent(systemParam);
      setCustomSystemMessage(decodedSystemParam);
      // Root-cause fix: `system` (existing script-tag query param — linkedinify,
      // portfolio-template already ship this as their persona) was previously only
      // used as the non-grounded fallback system message; RAG mode silently
      // discarded it. Feed it as the grounded-mode opening line too, so existing
      // integrations are fixed with no changes on their end. `persona` (below,
      // set later) wins if both are present — it's the newer, purpose-built field.
      personaRef.current = decodedSystemParam;
    }

    // Check if we're in embedded mode
    if (embeddedParam === "true") {
      setIsEmbedded(true);
      trackEvent({ name: "embed_opened", params: { host: getEmbedHost() } });
    }

    if (domainParam) {
      setDomainParam(domainParam);
    }

    // Per-site config forwarded by embed.ts (FR-6): label → greeting (embed mode);
    // siteIndexUrl → passed to the index layer (static site-index.json merge, m3).
    if (labelParam) setWidgetLabel(decodeURIComponent(labelParam));
    if (siteIndexUrlParam) siteIndexUrlRef.current = decodeURIComponent(siteIndexUrlParam);
    if (personaParam) personaRef.current = decodeURIComponent(personaParam); // wins over `system` above if both set
    // modelUrl is read once in hasCustomModelUrl's lazy init (which also mirrors
    // it into modelUrlRef before render #1) — nothing to do here.
    if (preIndexParam === "on-open" || preIndexParam === "after-model") preIndexRef.current = preIndexParam;

    const sessions = loadChatSessions(domainParam, embeddedParam === "true" ? "session" : "local");
    setChatSessions(sessions);

    const sessionIds = Object.keys(sessions);
    if (sessionIds.length > 0) {
      const latestSession = Object.values(sessions).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
      setCurrentSessionId(latestSession.id);
      currentSessionIdRef.current = latestSession.id;
      setMessages(latestSession.messages);
    } else {
      // Don't create initial session, let user start fresh
      setCurrentSessionId(null);
      currentSessionIdRef.current = null;
      setMessages([]);
    }

    // Ask-first gate: only auto-load without asking when we have a positive
    // signal it'll be fast — this exact model already loaded successfully
    // before in this browser (very likely still cached), or isGoodNetwork()
    // confirms a fast/unmetered connection right now. Otherwise show a
    // "Download to start chatting" prompt so history/model-switching aren't
    // blocked behind an unwanted download (grill: don't surprise slow-network
    // visitors with an immediate multi-hundred-MB fetch).
    const gateModelKey = modelUrlRef.current || PRESET_MODELS[modelId]?.id;
    if (hasLoadedModelBefore(gateModelKey) || isGoodNetwork()) {
      loadModel();
    } else {
      setModelState((current) => ({ ...current, awaitingConsent: true }));
    }

    // Embed mode: set up the host→iframe section bridge (cross-origin support)
    // + the iframe-side SPA watcher as a fallback.
    if (embeddedParam === "true") {
      // Receive page sections from embed.ts (host-side scrape → works on any
      // origin). Store them lazily — the embedder only loads on the first
      // question (grill Maj2), NOT when sections arrive.
      const onHostMessage = (event) => {
        if (event.source !== window.parent) return;
        const data = event.data;
        if (!data || data.type !== "private-chat:sections") return;
        externalSectionsRef.current = data.sections || null;
        // Warm the index early if the site owner opted into preIndex (no-op
        // otherwise — the default first-question path runs in submitPrompt).
        maybePreIndex();
        if (!externalModeRef.current) {
          // embed.ts now owns re-scrape; stop the iframe-side watcher (double-work).
          externalModeRef.current = true;
          if (hostNavUninstallRef.current) {
            hostNavUninstallRef.current();
            hostNavUninstallRef.current = null;
          }
        }
        // Re-index only if the index already exists (lazy). buildIndex's
        // contentHash cache makes unchanged content a cheap no-op.
        if (hasIndex()) initPageIndex(externalSectionsRef.current, siteIndexUrlRef.current);
      };
      window.addEventListener("message", onHostMessage);

      // Tell embed.ts we're ready to receive sections (it can't post before we
      // listen; this completes the handshake).
      try {
        window.parent.postMessage({ type: "private-chat:ready" }, "*");
      } catch {
        /* no parent (standalone) — ignore */
      }

      // Fallback: if embed.ts never posts sections (e.g. a cached old embed.js),
      // the iframe-side hostNav re-scrapes same-origin on navigation.
      hostNavUninstallRef.current = installHostNavWatcher({
        onNavigate: () => {
          if (hasIndex()) initPageIndex(null, siteIndexUrlRef.current);
        },
      });

      return () => {
        window.removeEventListener("message", onHostMessage);
        if (hostNavUninstallRef.current) hostNavUninstallRef.current();
      };
    }
  }, []);

  // numeric preIndex delay (preIndex = seconds). Counts FROM model-ready (not
  // mount) so the index build never competes with the model download. When the
  // model is ready, wait N more seconds, then hand off to maybePreIndex — which
  // also gates on sections being present, so a fire before sections arrive is
  // picked up when sections land. Placed after the mount effect so preIndexRef is
  // already populated on first commit.
  useEffect(
    function numericPreIndexTimer() {
      const delay = preIndexRef.current;
      if (typeof delay !== "number" || delay < 0 || !isReady) return;
      const timer = setTimeout(() => {
        numericPreIndexFiredRef.current = true;
        maybePreIndex();
      }, delay * 1000);
      return () => clearTimeout(timer);
    },
    [isReady, maybePreIndex]
  );

  // Status bridge → host (embed.ts) so the floating button can show a preload
  // badge + hover tooltip. Embed mode only. One derived phase: loading-model
  // (with integer %) takes precedence over indexing; ready clears it. Throttled
  // via lastStatusKeyRef so the per-chunk progressCallback doesn't flood the host.
  useEffect(
    function postStatusToHost() {
      if (!isEmbedded) return;
      let phase = "ready";
      let progress;
      if (isLoading) {
        phase = "loading-model";
        const total = loadingProgress?.total || 0;
        const loaded = loadingProgress?.loaded || 0;
        if (total > 0) progress = Math.min(100, Math.floor((loaded / total) * 100));
      } else if (isIndexing) {
        phase = "indexing";
      }
      const key = `${phase}:${progress ?? ""}`;
      if (key === lastStatusKeyRef.current) return;
      lastStatusKeyRef.current = key;
      try {
        window.parent.postMessage({ type: "private-chat:status", phase, progress }, "*");
      } catch {
        /* no parent (standalone) — ignore */
      }
    },
    [isEmbedded, isLoading, isIndexing, loadingProgress]
  );

  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
  }, [currentSessionId]);

  useEffect(() => {
    if (currentSessionId && chatSessions[currentSessionId]) {
      const updatedSession = updateSession(chatSessions[currentSessionId], messages);
      const updatedSessions = {
        ...chatSessions,
        [currentSessionId]: updatedSession,
      };
      setChatSessions(updatedSessions);

      // Skip the (expensive) JSON.stringify of every session on each streamed
      // token; flush once when generation ends. In-memory chatSessions stays live
      // so the UI keeps reflecting tokens mid-stream.
      if (!isGenerating) {
        // Only save sessions that have messages
        const sessionsToSave = Object.fromEntries(
          Object.entries(updatedSessions).filter(([, session]) => session.messages.length > 0)
        );
        saveChatSessions(sessionsToSave, domainParam, isEmbedded ? "session" : "local");
      }
    }
  }, [messages, currentSessionId, isGenerating]);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    if ("webkitSpeechRecognition" in window || "SpeechRecognition" in window) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = "en-US";

      let speechStartTime = 0;

      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        // Prepend whatever was already typed — each result event replaces the
        // dictated portion only (interim results re-send the whole utterance
        // so far), it must not wipe out text typed before recording started.
        const base = promptBeforeRecordingRef.current;
        setPrompt(base ? `${base} ${transcript}` : transcript);
      };

      recognition.onend = () => {
        setIsRecording(false);
        if (speechStartTime > 0) {
          const duration_seconds = Math.round((Date.now() - speechStartTime) / 1000);
          trackEvent({ name: "speech_input_used", params: { duration_seconds } });
          speechStartTime = 0;
        }
      };

      recognition.onerror = () => {
        setIsRecording(false);
        speechStartTime = 0;
      };

      // Attach start-time tracking via the start wrapper
      const originalStart = recognition.start.bind(recognition);
      recognition.start = () => {
        speechStartTime = Date.now();
        originalStart();
      };

      setSpeechRecognition(recognition);
    }

    return () => {
      window.removeEventListener("resize", handleResize);
      wllama.exit();
    };
  }, []);

  const streamMessages = (prompt, sessionId) => {
    const userMessage = { role: ROLE.user, content: prompt.trim(), id: nextMessageId() };
    const assistantMessage = { role: ROLE.assistant, content: ELLIPSIS, id: nextMessageId() };

    // Update the specific session's messages
    setChatSessions((current) => {
      const session = current[sessionId];
      if (session) {
        const updatedSession = {
          ...session,
          messages: [...session.messages, userMessage, assistantMessage],
          updatedAt: new Date().toISOString(),
        };
        return { ...current, [sessionId]: updatedSession };
      }
      return current;
    });

    // Update current messages if this is the active session
    setMessages((current) => [...current, userMessage, assistantMessage]);

    return {
      assistantId: assistantMessage.id,
      onNewToken: (token, piece, text) => {
        const clean = stripStrayTokens(text);
        // Update the specific session
        setChatSessions((current) => {
          const session = current[sessionId];
          if (session) {
            const updatedMessages = [...session.messages];
            if (updatedMessages.length > 0 && updatedMessages[updatedMessages.length - 1]) {
              updatedMessages[updatedMessages.length - 1].content = clean;
            }
            const updatedSession = {
              ...session,
              messages: updatedMessages,
              updatedAt: new Date().toISOString(),
            };
            return { ...current, [sessionId]: updatedSession };
          }
          return current;
        });

        // Update current messages only if viewing this session
        setMessages((current) => {
          // Check if we're still viewing the same session
          if (sessionId === currentSessionIdRef.current) {
            const updatedMessages = [...current];
            if (updatedMessages.length > 0 && updatedMessages[updatedMessages.length - 1]) {
              updatedMessages[updatedMessages.length - 1].content = clean;
            }
            return updatedMessages;
          }
          // Don't update if we've switched to a different session
          return current;
        });
      },
    };
  };

  const submitPrompt = async () => {
    let sessionId = currentSessionId;
    const currentPrompt = prompt; // Store the current prompt before clearing

    // Create a new session if none exists
    if (!sessionId) {
      const newSession = createNewSession();
      const updatedSessions = {
        ...chatSessions,
        [newSession.id]: newSession,
      };
      setChatSessions(updatedSessions);
      setCurrentSessionId(newSession.id);
      currentSessionIdRef.current = newSession.id;
      setMessages([]);
      sessionId = newSession.id;
      trackEvent({ name: "session_created" });
    }

    // Ensure the ref is up to date before streaming
    currentSessionIdRef.current = sessionId;
    const { onNewToken, assistantId } = streamMessages(currentPrompt, sessionId);
    setIsGenerating(true);
    setGeneratingSessionId(sessionId);

    // Clear the input immediately after starting generation
    setPrompt("");

    if (!isReady) await loadModel();

    // Attach retrieval sources to the assistant placeholder so RelatedSections
    // can render once the message exists (grill min2). null clears them.
    const attachSources = (sources) => {
      const apply = (list) => list.map((m) => (m.id === assistantId ? { ...m, sources: sources || undefined } : m));
      setChatSessions((current) => {
        const session = current[sessionId];
        if (!session) return current;
        return { ...current, [sessionId]: { ...session, messages: apply(session.messages) } };
      });
      setMessages((current) => (sessionId === currentSessionIdRef.current ? apply(current) : current));
    };

    // RAG (embed mode only, spec FR-4/FR-5): ground the system message in the
    // page's retrieved context. Reuses the proven formatChat→createCompletion
    // flow (R1) — does NOT call the dead createChatCompletion. The embedder GGUF
    // loads LAZILY on this first grounded question, not on widget open (grill Maj2);
    // any failure degrades silently to context-less chat (grill M1).
    let systemContent = customSystemMessage;
    let sourcesVersion = null;
    if (isEmbedded) {
      setIsIndexing(true);
      try {
        const grounded = await buildGroundedContext(
          currentPrompt.trim(),
          externalSectionsRef.current,
          siteIndexUrlRef.current,
          personaRef.current
        );
        if (grounded.systemContent) {
          systemContent = grounded.systemContent;
          sourcesVersion = grounded.version;
          attachSources(grounded.sources);
        }
      } catch (error) {
        console.debug("[RAG] grounding failed, falling back to context-less chat:", error?.message);
      } finally {
        setIsIndexing(false);
      }
    }

    const latestMessages = [...messages].slice(-4);

    trackEvent({
      name: "message_sent",
      params: { message_length: currentPrompt.trim().length, context_messages: latestMessages.length },
    });

    const generationStartTime = Date.now();

    const formattedChat = await formatChat(wllama, [
      {
        role: ROLE.system,
        content: systemContent,
      },
      ...latestMessages,
      { role: ROLE.user, content: currentPrompt.trim(), id: nextMessageId() },
    ]);

    const abortController = new AbortController();
    let cumulative = "";

    // Runs whether generation finished normally or was cut short by the
    // stray-token abort below — both cases produce a final `cumulative` that
    // needs the same blank-reply safety net and event tracking.
    const finalizeResponse = () => {
      if (!stripStrayTokens(cumulative).trim()) {
        onNewToken(0, "", "Sorry, I didn't get a response there — could you try asking again?");
      }
      trackEvent({
        name: "response_received",
        params: {
          response_length: cumulative.length,
          generation_time_ms: Date.now() - generationStartTime,
        },
      });
      // Race guard (grill Maj3): if a Story 5 SPA re-scrape swapped the live index
      // mid-turn, the captured sources may point at the old route — drop them.
      if (sourcesVersion !== null && getCurrentIndexVersion() !== sourcesVersion) {
        attachSources(null);
      }
    };

    try {
      // wllama 3.x: createCompletion takes a SINGLE options object (prompt inside),
      // uses max_tokens (not nPredict), flat sampling fields, and onData (not the
      // 2.x onNewToken). onData yields only the incremental piece, so we accumulate
      // to feed the app's existing onNewToken(token, piece, cumulativeText) contract.
      await wllama.createCompletion({
        prompt: formattedChat,
        max_tokens: 1024,
        temperature: 0.6,
        penalty_repeat: 1.5,
        stop: TURN_END_STOP_SEQUENCES,
        stream: true,
        abortSignal: abortController.signal,
        onData: (chunk) => {
          const piece = chunk?.choices?.[0]?.text ?? "";
          cumulative += piece;
          // Generic backstop (any model, any template): the moment a control
          // token shows up in the stream, cut the display text there and abort
          // — instead of letting the model ramble past its own turn boundary
          // into more of the same, which is what previously produced replies
          // that were 100% stray tokens (i.e. blank once stripped).
          const cutIndex = cumulative.search(STRAY_TOKEN_DETECT_RE);
          if (cutIndex !== -1) {
            cumulative = cumulative.slice(0, cutIndex);
            onNewToken(0, piece, cumulative);
            abortController.abort();
            return;
          }
          onNewToken(0, piece, cumulative);
        },
      });

      finalizeResponse();
    } catch (err) {
      if (err instanceof WllamaAbortError) {
        // Intentional stop from the backstop above — not a failure.
        finalizeResponse();
        return;
      }
      trackEvent({ name: "response_failed", params: { error: sanitizeError(err) } });
      trackEvent({
        name: "error_occurred",
        params: { category: "chat", action: "generation", error: sanitizeError(err) },
      });
      throw err;
    } finally {
      setIsGenerating(false);
      setGeneratingSessionId(null);
    }
  };

  const handleOnPressEnter = (e) => {
    if (e.key === "Enter") {
      if (e.shiftKey) {
        // Shift+Enter: Insert new line
        e.preventDefault();
        const textarea = e.target;
        const cursorPosition = textarea.selectionStart;
        const textBefore = prompt.substring(0, cursorPosition);
        const textAfter = prompt.substring(cursorPosition);
        setPrompt(textBefore + "\n" + textAfter);

        // Reset cursor position after state update
        setTimeout(() => {
          textarea.selectionStart = textarea.selectionEnd = cursorPosition + 1;
        }, 0);
      } else {
        // Regular Enter: Submit message (only if there's at least one word)
        e.preventDefault();
        const trimmedPrompt = prompt.trim();
        if (trimmedPrompt && /\S/.test(trimmedPrompt)) {
          submitPrompt();
        }
      }
    }
  };

  const handlePromptInputChange = (e) => setPrompt(e.target.value);

  const handleFileInputChange = (event) => {
    const files = event.target.files;

    if (!files.length) {
      return;
    }

    trackEvent({ name: "model_switched", params: { from_model: selectedModel.name, to_model: files[0].name } });
    setLocalModelFiles(files);
    setModelState({ ...modelStateDefaults, modelId: "file" });
  };

  const handleOnNewChatClick = () => {
    if (messages.length > 0) {
      trackEvent({ name: "chat_cleared", params: { message_count: messages.length } });
    }
    const newSession = createNewSession();
    const updatedSessions = {
      ...chatSessions,
      [newSession.id]: newSession,
    };
    setChatSessions(updatedSessions);
    setCurrentSessionId(newSession.id);
    currentSessionIdRef.current = newSession.id;
    setMessages([]);
    setPrompt("");
    trackEvent({ name: "session_created" });
    // Don't save empty sessions to localStorage
  };

  const handleSessionSelect = (sessionId) => {
    const session = chatSessions[sessionId];
    if (session) {
      setCurrentSessionId(sessionId);
      currentSessionIdRef.current = sessionId;
      setMessages(session.messages);
      setPrompt("");
      setIsSidebarOpen(false);
      trackEvent({ name: "session_switched" });
    }
  };

  const handleSessionDelete = (sessionId) => {
    const deletedSession = chatSessions[sessionId];
    if (deletedSession) {
      trackEvent({ name: "session_deleted", params: { message_count: deletedSession.messages.length } });
    }
    const updatedSessions = deleteSession(chatSessions, sessionId);
    setChatSessions(updatedSessions);

    // Only save sessions that have messages
    const sessionsToSave = Object.fromEntries(
      Object.entries(updatedSessions).filter(([, session]) => session.messages.length > 0)
    );
    saveChatSessions(sessionsToSave, domainParam, isEmbedded ? "session" : "local");

    if (sessionId === currentSessionId) {
      const remainingSessions = Object.values(updatedSessions).filter((session) => session.messages.length > 0);
      if (remainingSessions.length > 0) {
        const latestSession = remainingSessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];
        setCurrentSessionId(latestSession.id);
        currentSessionIdRef.current = latestSession.id;
        setMessages(latestSession.messages);
        setPrompt("");
      } else {
        // No sessions with messages left, create a fresh state
        setCurrentSessionId(null);
        currentSessionIdRef.current = null;
        setMessages([]);
        setPrompt("");
      }
    }
  };

  const handleSessionRename = (sessionId, newTitle) => {
    const session = chatSessions[sessionId];
    if (session) {
      const updatedSession = { ...session, title: newTitle, updatedAt: new Date().toISOString() };
      const updatedSessions = {
        ...chatSessions,
        [sessionId]: updatedSession,
      };
      setChatSessions(updatedSessions);
      saveChatSessions(updatedSessions, domainParam, isEmbedded ? "session" : "local");
    }
  };

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  const handleSpeechToText = () => {
    if (!speechRecognition) {
      return;
    }

    if (isRecording) {
      speechRecognition.stop();
      setIsRecording(false);
    } else {
      promptBeforeRecordingRef.current = prompt.trim();
      setIsRecording(true);
      speechRecognition.start();
    }
  };

  const handleReadAloudClick = (text) => {
    if ("speechSynthesis" in window) {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        setIsReadingAloud(false);
        trackEvent({ name: "tts_stopped" });
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onstart = () => {
        setIsReadingAloud(true);
        trackEvent({ name: "tts_played", params: { text_length: text.length } });
      };
      utterance.onend = () => setIsReadingAloud(false);
      window.speechSynthesis.speak(utterance);
    }
  };

  const getMenuOptionHandler = (newModelId) => () => {
    trackEvent({ name: "model_switched", params: { from_model: selectedModel.name, to_model: newModelId } });
    setLocalModelFiles([]);
    setModelState({ ...modelStateDefaults, modelId: newModelId });
  };

  const isBusy = isLoading || isGenerating;
  const shouldDisableSubmit = isBusy || !prompt.trim() || !/\S/.test(prompt.trim());
  const loadedSize = loadingProgress.loaded || 0;
  const totalSize = loadingProgress.total || 100;
  const loadingProgressDisplayString = `${(Math.floor((loadedSize / totalSize) * 10000) / 100).toFixed(2)}%`;
  // Preset models advertise a fixed sizeMb (single source of truth — matches the
  // dropdown label exactly, so the load progress never disagrees with the name
  // the way the old Math.ceil(realBytes) did: label said 278MB, download showed
  // 279MB). Custom-URL / uploaded models have no preset size → fall back to live
  // bytes from wllama's progress callback.
  const modelSizeDisplayString = selectedModel.sizeMb
    ? `(${selectedModel.sizeMb}MB)`
    : totalSize
      ? `(${Math.ceil(totalSize / 1024 / 1024)}MB)`
      : "";

  return (
    <>
      <ChatHistorySidebar
        sessions={chatSessions}
        currentSessionId={currentSessionId}
        onSessionSelect={handleSessionSelect}
        onSessionDelete={handleSessionDelete}
        onSessionRename={handleSessionRename}
        isOpen={isSidebarOpen}
        isMobile={isMobile}
        onClose={() => setIsSidebarOpen(false)}
      />
      <Box
        p={isEmbedded ? "2" : { initial: "1", md: "3" }}
        style={{
          marginLeft: !isMobile && isSidebarOpen ? "300px" : "0",
          transition: "margin-left 0.3s ease",
          height: isEmbedded ? "100vh" : "auto",
        }}
      >
        <Flex direction="column">
          <ChatHeader
            selectedModel={selectedModel}
            isBusy={isBusy}
            onToggleSidebar={toggleSidebar}
            onNewChat={handleOnNewChatClick}
            onSelectModel={getMenuOptionHandler}
            onFileInputChange={handleFileInputChange}
            fileInputRef={fileInputRef}
            localModelFiles={localModelFiles}
            lockModelSelector={customModelLocked}
            widgetLabel={widgetLabel}
          />
          <Container size="2" style={{ maxWidth: "100%", overflow: "hidden" }}>
            <Box minHeight="20vh" py="2" style={{ maxWidth: "100%", overflow: "hidden" }}>
              {messages.length ? (
                <ScrollArea
                  type="scroll"
                  scrollbars="vertical"
                  className={`messages-container${isEmbedded ? " embedded" : ""}`}
                  ref={messagesContainerRef}
                >
                  {messages.map((message, index) => (
                    <MessageItem
                      key={message.id}
                      content={message.content}
                      role={message.role}
                      sources={message.sources}
                      isLastMessage={index === messages.length - 1}
                      isGenerating={isGenerating}
                      isCurrentSessionGenerating={generatingSessionId === currentSessionId}
                      isReadingAloud={isReadingAloud}
                      onReadAloud={handleReadAloudClick}
                      onCopy={copyToClipboard}
                    />
                  ))}
                  {awaitingConsent && (
                    <Flex direction="column" align="start" gap="2" py="2">
                      <Text as="div" size="2" color="gray">
                        Download model {modelSizeDisplayString} to continue chatting.
                      </Text>
                      <Button size="1" variant="soft" onClick={loadModel}>
                        Download model
                      </Button>
                    </Flex>
                  )}
                  {loadError && (
                    <Flex direction="column" align="start" gap="2" py="2">
                      <Text as="div" size="2" color="red">
                        Model download failed. Check your connection and try again.
                      </Text>
                      <Button size="1" variant="soft" onClick={loadModel}>
                        Retry
                      </Button>
                    </Flex>
                  )}
                  {isLoading && (
                    <Text as="div" size="2">
                      {loadedSize > 0 && parseFloat(loadingProgressDisplayString) < 100 ? (
                        <>
                          <b>{loadingProgressDisplayString}</b> Downloading model file {modelSizeDisplayString} to your
                          computer. This happens only the first time you load the model.
                        </>
                      ) : (
                        "Preparing model…"
                      )}
                    </Text>
                  )}
                  <Loader isLoading={isLoading || (isGenerating && generatingSessionId === currentSessionId)} />
                  {isIndexing && (
                    <Text as="div" size="1" style={{ color: "var(--gray-a10)" }}>
                      Indexing this page…
                    </Text>
                  )}
                </ScrollArea>
              ) : (
                <WelcomeMessage
                  isLoading={isLoading}
                  loadedSize={loadedSize}
                  loadingProgressDisplayString={loadingProgressDisplayString}
                  modelSizeDisplayString={modelSizeDisplayString}
                  widgetLabel={widgetLabel}
                  awaitingConsent={awaitingConsent}
                  loadError={loadError}
                  onDownload={loadModel}
                />
              )}
            </Box>
            <PromptInput
              prompt={prompt}
              onPromptChange={handlePromptInputChange}
              onKeyDown={handleOnPressEnter}
              isBusy={isBusy}
              isGenerating={isGenerating}
              shouldDisableSubmit={shouldDisableSubmit}
              hasSpeech={!!speechRecognition}
              isRecording={isRecording}
              onSpeechToText={handleSpeechToText}
              onSubmit={submitPrompt}
            />
            {!isEmbedded && (
              <Box pt="2" pb="4">
                <Text as="div" align="center" size="1" color="gray">
                  &#9888; Models can make mistakes, always double-check responses. &bull;&nbsp;
                  <Link href={selectedModel.url} target="_blank" rel="noopener" download highContrast>
                    Model
                  </Link>
                  &nbsp;&bull;&nbsp;
                  <Link href={selectedModel.license} target="_blank" rel="noopener" highContrast>
                    License
                  </Link>
                </Text>
              </Box>
            )}
            {!isEmbedded && <Footer />}
          </Container>
        </Flex>
      </Box>
    </>
  );
}

export default App;
