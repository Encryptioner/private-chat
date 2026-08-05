/**
 * The approach used in this code is to consolidate all the logic in a single component.
 * This was done to focus on more on demonstration of the concept. Its is wise and welcome to refactor
 * the code to suit your needs.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CHAT_ROLE as ROLE, formatChat, getWllamaInstance, PRESET_MODELS, WllamaAbortError } from "./lib/wllama";
import { loadChatSessions, saveChatSessions, createNewSession, updateSession, deleteSession } from "./lib/chatStorage";
import { trackEvent, sanitizeError, getEmbedHost } from "./lib/googleAnalytics";
import { buildGroundedContext, getCurrentIndexVersion, initPageIndex, hasIndex } from "./lib/ragEngine.js";
import { installHostNavWatcher } from "./lib/hostNav.js";
import { Box, Container, DropdownMenu, Flex, Link, ScrollArea, Text, Tooltip } from "@radix-ui/themes";
import {
  ArrowRightIcon,
  DocumentDuplicateIcon,
  PencilSquareIcon,
  SpeakerWaveIcon,
  Bars3Icon,
  MicrophoneIcon,
} from "@heroicons/react/24/outline";
import { StopCircleIcon } from "@heroicons/react/24/solid";
import Markdown from "./components/Markdown";
import Footer from "./components/Footer";
import Loader from "./components/Loader";
import Dropdown from "./components/Dropdown";
import IconButton from "./components/IconButton";
import ChatHistorySidebar from "./components/ChatHistorySidebar";
import RelatedSections from "./components/RelatedSections.jsx";

const ELLIPSIS = "...";
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

const preventClickAction = (e) => e.preventDefault();
// eslint-disable-next-line no-console
const copyToClipboard = (text) => navigator.clipboard.writeText(text).catch((e) => console.error(e));

const messageIdGenerator = (function* () {
  let id = 0;
  while (true) {
    yield `msg-${id++}`;
  }
})();

const modelStateDefaults = {
  isLoading: false,
  isReady: false,
  modelId: DEFAULT_MODEL_ID,
  loadingProgress: 0,
};

function App() {
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [{ isLoading, isReady, modelId, loadingProgress }, setModelState] = useState(modelStateDefaults);
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
  // Site-owner custom model URL override. Read fresh inside loadModel() at call
  // time (not baked into `selectedModel`) — the mount effect below sets this ref
  // and calls loadModel() synchronously in the same tick, before render #1's
  // closures would ever see the updated value otherwise.
  const modelUrlRef = useRef(null);
  // Host→iframe section bridge (cross-origin support). embed.ts posts page
  // sections via postMessage; we store them here and feed them to the RAG index.
  const externalSectionsRef = useRef(null);
  const externalModeRef = useRef(false);
  const hostNavUninstallRef = useRef(null);
  const promptBeforeRecordingRef = useRef("");
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
    setModelState((current) => ({ ...current, isLoading: true }));

    const customModelUrl = modelUrlRef.current;
    const source = localModelFiles.length ? "local_file" : customModelUrl ? "custom_url" : "preset";
    const modelName = localModelFiles.length
      ? localModelFiles[0].name
      : customModelUrl
        ? "Custom model"
        : selectedModel.name;
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
      } else if (customModelUrl) {
        await wllama.loadModelFromUrl(customModelUrl, options);
      } else {
        await wllama.loadModelFromUrl(selectedModel.url, options);
      }
      trackEvent({
        name: "model_load_completed",
        params: { model_name: modelName, source, duration_ms: Date.now() - loadStartTime },
      });
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
      throw err;
    }
  };

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
    const modelUrlParam = urlParams.get("modelUrl");

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
    if (modelUrlParam) modelUrlRef.current = decodeURIComponent(modelUrlParam);

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

    loadModel();

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

      // Only save sessions that have messages
      const sessionsToSave = Object.fromEntries(
        Object.entries(updatedSessions).filter(([, session]) => session.messages.length > 0)
      );
      saveChatSessions(sessionsToSave, domainParam, isEmbedded ? "session" : "local");
    }
  }, [messages, currentSessionId]);

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
    const userMessage = { role: ROLE.user, content: prompt.trim(), id: messageIdGenerator.next().value };
    const assistantMessage = { role: ROLE.assistant, content: ELLIPSIS, id: messageIdGenerator.next().value };

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
      { role: ROLE.user, content: currentPrompt.trim(), id: messageIdGenerator.next().value },
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
  const modelSizeDisplayString = totalSize ? `(${Math.ceil(totalSize / 1024 / 1024)}MB)` : "";

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
          <Flex direction="row" align="center" justify="between" asChild>
            <header>
              <Flex gap="4" align="center">
                <IconButton tooltip="Chat History" onClick={toggleSidebar} variant="ghost">
                  <Bars3Icon width="24" />
                </IconButton>
                <IconButton tooltip="New Chat" onClick={handleOnNewChatClick} disabled={isBusy} variant="ghost">
                  <PencilSquareIcon width="24" />
                </IconButton>
                <Dropdown label={selectedModel.name}>
                  {Object.values(PRESET_MODELS).map(({ name, description }) => (
                    <Tooltip content={description} side="right" key={name}>
                      <DropdownMenu.Item
                        disabled={name === selectedModel.name || isBusy}
                        onClick={getMenuOptionHandler(name)}
                      >
                        {name}
                      </DropdownMenu.Item>
                    </Tooltip>
                  ))}
                  {localModelFiles.length > 0 && <DropdownMenu.Item disabled>{selectedModel.name}</DropdownMenu.Item>}
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item asChild onSelect={preventClickAction}>
                    <label title="Select your own local GGUF file">
                      Select GGUF file (2GB Max)...
                      <input
                        type="file"
                        accept=".gguf"
                        disabled={isBusy}
                        ref={fileInputRef}
                        onChange={handleFileInputChange}
                        hidden
                      />
                    </label>
                  </DropdownMenu.Item>
                </Dropdown>
              </Flex>
            </header>
          </Flex>
          <Container size="2" style={{ maxWidth: "100%", overflow: "hidden" }}>
            <Box minHeight="20vh" py="2" style={{ maxWidth: "100%", overflow: "hidden" }}>
              {messages.length ? (
                <ScrollArea
                  type="scroll"
                  scrollbars="vertical"
                  className={`messages-container${isEmbedded ? " embedded" : ""}`}
                  ref={messagesContainerRef}
                >
                  {messages.map(({ content, role, id, sources }, index) => {
                    const isLastMessage = index === messages.length - 1;
                    const [reasoning, conclusion = " "] = content.startsWith("<think>")
                      ? content.split("</think>")
                      : ["", content];
                    const isUser = role === ROLE.user;

                    return (
                      <Box key={id} mb="6" className="mobile-message">
                        <Flex direction="row" justify="start" align="start" gap="4">
                          {/* Role indicator */}
                          <Box
                            style={{
                              width: "28px",
                              height: "28px",
                              backgroundColor: isUser ? "var(--accent-9)" : "var(--gray-a6)",
                              borderRadius: "6px",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: "12px",
                              fontWeight: "600",
                              color: isUser ? "white" : "var(--gray-a12)",
                              flexShrink: 0,
                              marginTop: "2px",
                            }}
                          >
                            {isUser ? "U" : "AI"}
                          </Box>

                          <Box style={{ flex: 1, minWidth: 0 }}>
                            {/* Message content */}
                            <Box
                              style={{
                                background: "var(--color-surface)",
                                border: `1px solid var(--gray-a6)`,
                                borderRadius: "8px",
                                padding: "16px",
                                wordBreak: "break-word",
                                wordWrap: "break-word",
                                overflowWrap: "break-word",
                                hyphens: "auto",
                                position: "relative",
                                maxWidth: "100%",
                                overflow: "hidden",
                              }}
                            >
                              {content !== ELLIPSIS ? (
                                <div>
                                  {reasoning && (
                                    <Text
                                      as="div"
                                      size="1"
                                      style={{
                                        color: "var(--gray-a11)",
                                        marginBottom: "12px",
                                        fontStyle: "italic",
                                        padding: "8px",
                                        background: "var(--gray-a3)",
                                        borderRadius: "4px",
                                        borderLeft: "3px solid var(--gray-a6)",
                                      }}
                                    >
                                      <strong>Reasoning:</strong> {reasoning.split("<think>")[1] || ""}
                                    </Text>
                                  )}
                                  <Markdown>{conclusion}</Markdown>
                                </div>
                              ) : (
                                <div style={{ color: "var(--gray-a10)" }}>{ELLIPSIS}</div>
                              )}
                            </Box>

                            {/* Action buttons for assistant messages */}
                            {role === ROLE.assistant &&
                              content !== ELLIPSIS &&
                              !(isLastMessage && isGenerating && generatingSessionId === currentSessionId) && (
                                <Flex mt="3" gap="2" justify="start">
                                  <IconButton
                                    size="1"
                                    tooltip="Read aloud"
                                    onClick={() => handleReadAloudClick(content)}
                                    variant="soft"
                                    color="gray"
                                  >
                                    {isReadingAloud ? <StopCircleIcon width="14" /> : <SpeakerWaveIcon width="14" />}
                                  </IconButton>
                                  <IconButton
                                    size="1"
                                    tooltip="Copy to clipboard"
                                    onClick={() => copyToClipboard(content)}
                                    variant="soft"
                                    color="gray"
                                  >
                                    <DocumentDuplicateIcon width="14" />
                                  </IconButton>
                                </Flex>
                              )}
                            {/* Related sections from retrieval (spec FR-5) */}
                            {role === ROLE.assistant && sources?.length > 0 && content !== ELLIPSIS && (
                              <RelatedSections sources={sources} />
                            )}
                          </Box>
                        </Flex>
                      </Box>
                    );
                  })}
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
                <Box className="welcome-text" pb="5">
                  {isLoading ? (
                    <Flex direction="column" align="center" gap="4">
                      <Text size="6" align="center" asChild>
                        <h1>Please wait while the model loads...</h1>
                      </Text>
                      <Text size="3" color="gray" align="center">
                        {loadedSize > 0 && parseFloat(loadingProgressDisplayString) < 100 ? (
                          <>
                            <b>{loadingProgressDisplayString}</b> Downloading model {modelSizeDisplayString}
                          </>
                        ) : (
                          "Preparing model…"
                        )}
                      </Text>
                      <Text size="2" color="gray" align="center">
                        It loads only once. It will be cached on your web server.
                      </Text>
                      <Loader isLoading={true} />
                    </Flex>
                  ) : (
                    <Text size="7" align="center" asChild>
                      <h1 className="scale-up-center">
                        {widgetLabel ? `How can ${widgetLabel} help you?` : "Hi, how may I help you?"}
                      </h1>
                    </Text>
                  )}
                </Box>
              )}
            </Box>
            <Box>
              <Box
                style={{
                  position: "relative",
                  background: "var(--color-surface)",
                  borderRadius: "12px",
                  border: "2px solid var(--gray-a6)",
                  padding: "12px 16px",
                  minHeight: "52px",
                  display: "flex",
                  alignItems: "flex-end",
                  gap: "12px",
                  transition: "border-color 0.2s ease",
                }}
                onFocus={(e) => {
                  if (e.currentTarget.querySelector("textarea")) {
                    e.currentTarget.style.borderColor = "var(--accent-8)";
                  }
                }}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    e.currentTarget.style.borderColor = "var(--gray-a6)";
                  }
                }}
              >
                <Box style={{ flex: 1, position: "relative" }}>
                  <textarea
                    value={prompt}
                    onKeyDown={handleOnPressEnter}
                    onChange={handlePromptInputChange}
                    placeholder="Type your message... (Shift+Enter for new line)"
                    maxLength={4096}
                    disabled={isBusy}
                    rows={1}
                    style={{
                      width: "100%",
                      border: "none",
                      outline: "none",
                      background: "transparent",
                      color: "var(--color-text)",
                      fontSize: "var(--font-size-3)",
                      lineHeight: "1.5",
                      resize: "none",
                      overflow: "hidden",
                      minHeight: "24px",
                      maxHeight: "120px",
                      fontFamily: "inherit",
                    }}
                    onInput={(e) => {
                      e.target.style.height = "auto";
                      e.target.style.height = e.target.scrollHeight + "px";
                      if (e.target.scrollHeight > 120) {
                        e.target.style.overflow = "auto";
                      } else {
                        e.target.style.overflow = "hidden";
                      }
                    }}
                    onFocus={(e) => {
                      e.target.parentElement.parentElement.style.borderColor = "var(--accent-8)";
                    }}
                    onBlur={(e) => {
                      if (!e.target.parentElement.parentElement.contains(e.relatedTarget)) {
                        e.target.parentElement.parentElement.style.borderColor = "var(--gray-a6)";
                      }
                    }}
                  />
                </Box>
                <Flex gap="2" align="center" style={{ paddingBottom: "4px" }}>
                  {speechRecognition && (
                    <IconButton
                      size="2"
                      variant={isRecording ? "solid" : "soft"}
                      color={isRecording ? "red" : "gray"}
                      title={isRecording ? "Stop recording" : "Voice input"}
                      onClick={handleSpeechToText}
                      disabled={isBusy && !isRecording}
                    >
                      <MicrophoneIcon
                        height="16"
                        width="16"
                        style={{
                          animation: isRecording ? "pulse 1s infinite" : "none",
                        }}
                      />
                    </IconButton>
                  )}
                  <IconButton
                    size="2"
                    variant="solid"
                    title="Send message"
                    onClick={submitPrompt}
                    disabled={shouldDisableSubmit}
                    loading={isGenerating}
                    style={{
                      backgroundColor: isGenerating || !shouldDisableSubmit ? "var(--accent-9)" : "var(--gray-a6)",
                      color: "white",
                      opacity: shouldDisableSubmit && !isGenerating ? 0.6 : 1,
                      transition: "background-color 0.2s ease, opacity 0.2s ease",
                    }}
                  >
                    <ArrowRightIcon height="16" width="16" />
                  </IconButton>
                </Flex>
              </Box>
              <Text
                as="div"
                size="1"
                align="right"
                mt="1"
                style={{
                  color: prompt.length > 3500 ? "var(--red-9)" : "var(--gray-a11)",
                  fontWeight: prompt.length > 3500 ? "600" : "normal",
                }}
              >
                {prompt.length}/4096
              </Text>
            </Box>
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
