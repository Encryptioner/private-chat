/**
 * The approach used in this code is to consolidate all the logic in a single component.
 * This was done to focus on more on demonstration of the concept. Its is wise and welcome to refactor
 * the code to suit your needs.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { CHAT_ROLE as ROLE, formatChat, getWllamaInstance, PRESET_MODELS } from "./lib/wllama";
import { loadChatSessions, saveChatSessions, createNewSession, updateSession, deleteSession } from "./lib/chatStorage";
import {
  Box,
  Callout,
  Container,
  DropdownMenu,
  Flex,
  Link,
  ScrollArea,
  Text,
  TextField,
  Tooltip,
} from "@radix-ui/themes";
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

const ELLIPSIS = "...";
const DEFAULT_MODEL_ID = Object.values(PRESET_MODELS).find((m) => m.default)?.name || Object.keys(PRESET_MODELS)[0];

const preventClickAction = (e) => e.preventDefault();
// eslint-disable-next-line no-console
const copyToClipboard = (text) => navigator.clipboard.writeText(text).catch((e) => console.error(e));

const formatMessageContent = (content) => {
  if (!content || content === ELLIPSIS) return content;

  // Handle code blocks with syntax highlighting
  let formattedContent = content.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    return `<div class="code-block">
      <div class="code-header">${lang || "code"}</div>
      <pre><code>${code.trim()}</code></pre>
    </div>`;
  });

  // Handle inline code
  formattedContent = formattedContent.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Handle URLs - make them clickable
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  formattedContent = formattedContent.replace(
    urlRegex,
    (url) => `<a href="${url}" class="message-link" target="_blank" rel="noopener noreferrer">${url}</a>`
  );

  return formattedContent;
};

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
    "You are a helpful assistant. Keep responses as concise as possible. Avoid long explanations."
  );
  const [isMobile, setIsMobile] = useState(false);
  const [generatingSessionId, setGeneratingSessionId] = useState(null);
  const selectedModel = localModelFiles.length
    ? { name: localModelFiles[0].name, url: "file", license: "" }
    : PRESET_MODELS[modelId];

  const wllama = useMemo(() => getWllamaInstance(), []);

  const messagesContainerRef = useRef(null);
  const fileInputRef = useRef(null);
  const currentSessionIdRef = useRef(currentSessionId);

  const loadModel = async () => {
    setModelState((current) => ({ ...current, isLoading: true }));
    const options = {
      useCache: true,
      allowOffline: true,
      n_ctx: 4096, // Increase context window to handle longer conversations and larger prompts
      progressCallback: (progress) =>
        setModelState((current) => ({
          ...current,
          loadingProgress: progress,
        })),
    };
    await wllama.exit();
    if (localModelFiles.length) {
      await wllama.loadModel(localModelFiles, options);
    } else {
      await wllama.loadModelFromUrl(selectedModel.url, options);
    }
    setModelState((current) => ({
      ...modelStateDefaults,
      isReady: true,
      modelId: current.modelId,
    }));
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

    // eslint-disable-next-line no-console
    console.log({
      systemParam,
      domainParam,
      embeddedParam,
    });

    if (systemParam) {
      setCustomSystemMessage(decodeURIComponent(systemParam));
    }

    // Check if we're in embedded mode
    if (embeddedParam === "true") {
      setIsEmbedded(true);
    }

    const sessions = loadChatSessions();
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
        Object.entries(updatedSessions).filter(([_, session]) => session.messages.length > 0)
      );
      saveChatSessions(sessionsToSave);
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

      recognition.onresult = (event) => {
        let transcript = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        setPrompt(transcript);
      };

      recognition.onend = () => {
        setIsRecording(false);
      };

      recognition.onerror = () => {
        setIsRecording(false);
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

    return (token, piece, text) => {
      // Update the specific session
      setChatSessions((current) => {
        const session = current[sessionId];
        if (session) {
          const updatedMessages = [...session.messages];
          if (updatedMessages.length > 0 && updatedMessages[updatedMessages.length - 1]) {
            updatedMessages[updatedMessages.length - 1].content = text;
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
            updatedMessages[updatedMessages.length - 1].content = text;
          }
          return updatedMessages;
        }
        // Don't update if we've switched to a different session
        return current;
      });
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
    }

    // Ensure the ref is up to date before streaming
    currentSessionIdRef.current = sessionId;
    const onNewToken = streamMessages(currentPrompt, sessionId);
    setIsGenerating(true);
    setGeneratingSessionId(sessionId);

    // Clear the input immediately after starting generation
    setPrompt("");

    if (!isReady) await loadModel();
    const latestMessages = [...messages].slice(-4);
    const formattedChat = await formatChat(wllama, [
      {
        role: ROLE.system,
        content: customSystemMessage,
      },
      ...latestMessages,
      { role: ROLE.user, content: currentPrompt.trim(), id: messageIdGenerator.next().value },
    ]);
    await wllama.createCompletion(formattedChat, {
      nPredict: 1024,
      sampling: { temp: 0.6, penalty_repeat: 1.5 },
      onNewToken,
    });
    setIsGenerating(false);
    setGeneratingSessionId(null);
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

    setLocalModelFiles(files);
    setModelState({ ...modelStateDefaults, modelId: "file" });
  };

  const handleOnNewChatClick = () => {
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
    }
  };

  const handleSessionDelete = (sessionId) => {
    const updatedSessions = deleteSession(chatSessions, sessionId);
    setChatSessions(updatedSessions);

    // Only save sessions that have messages
    const sessionsToSave = Object.fromEntries(
      Object.entries(updatedSessions).filter(([, session]) => session.messages.length > 0)
    );
    saveChatSessions(sessionsToSave);

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
      saveChatSessions(updatedSessions);
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
      setIsRecording(true);
      speechRecognition.start();
    }
  };

  const handleReadAloudClick = (text) => {
    if ("speechSynthesis" in window) {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        setIsReadingAloud(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onstart = () => setIsReadingAloud(true);
      utterance.onend = () => setIsReadingAloud(false);
      window.speechSynthesis.speak(utterance);
    }
  };

  const getMenuOptionHandler = (modelId) => () => {
    setLocalModelFiles([]);
    setModelState({ ...modelStateDefaults, modelId });
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
        }}>
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
                      <DropdownMenu.Item disabled={name === selectedModel.name} onClick={getMenuOptionHandler(name)}>
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
                  ref={messagesContainerRef}>
                  {messages.map(({ content, role, id }, index) => {
                    const isLastMessage = index === messages.length - 1;
                    const [reasoning, conclusion = " "] = content.startsWith("<think>")
                      ? content.split("</think>")
                      : ["", content];
                    const isUser = role === ROLE.user;
                    const formattedContent = formatMessageContent(conclusion);

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
                            }}>
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
                              }}>
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
                                      }}>
                                      <strong>Reasoning:</strong> {reasoning.split("<think>")[1] || ""}
                                    </Text>
                                  )}
                                  {formattedContent === conclusion ? (
                                    <Markdown>{conclusion}</Markdown>
                                  ) : (
                                    <div
                                      dangerouslySetInnerHTML={{ __html: formattedContent }}
                                      style={{
                                        lineHeight: "1.6",
                                        wordBreak: "break-word",
                                        overflowWrap: "break-word",
                                        maxWidth: "100%",
                                      }}
                                    />
                                  )}
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
                                    color="gray">
                                    {isReadingAloud ? <StopCircleIcon width="14" /> : <SpeakerWaveIcon width="14" />}
                                  </IconButton>
                                  <IconButton
                                    size="1"
                                    tooltip="Copy to clipboard"
                                    onClick={() => copyToClipboard(content)}
                                    variant="soft"
                                    color="gray">
                                    <DocumentDuplicateIcon width="14" />
                                  </IconButton>
                                </Flex>
                              )}
                          </Box>
                        </Flex>
                      </Box>
                    );
                  })}
                  {isLoading && loadedSize > 0 && parseFloat(loadingProgressDisplayString) < 100 && (
                    <Text as="div" size="2">
                      <b>{loadingProgressDisplayString}</b> Downloading model file {modelSizeDisplayString} to your
                      computer. This happens only the first time you load the model.
                    </Text>
                  )}
                  <Loader isLoading={isGenerating && generatingSessionId === currentSessionId && !isLoading} />
                </ScrollArea>
              ) : (
                <Box className="welcome-text" pb="5">
                  {isLoading && loadedSize > 0 && parseFloat(loadingProgressDisplayString) < 100 ? (
                    <Flex direction="column" align="center" gap="4">
                      <Text size="6" align="center" asChild>
                        <h1>Please wait while the model loads...</h1>
                      </Text>
                      <Text size="3" color="gray" align="center">
                        <b>{loadingProgressDisplayString}</b> Downloading model {modelSizeDisplayString}
                      </Text>
                      <Text size="2" color="gray" align="center">
                        It loads only once. It will be cached on your web server.
                      </Text>
                      <Loader isLoading={true} />
                    </Flex>
                  ) : (
                    <Text size="7" align="center" asChild>
                      <h1 className="scale-up-center">Hi, how may I help you?</h1>
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
                }}>
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
                  <Text
                    size="1"
                    style={{
                      position: "absolute",
                      bottom: "-22px",
                      right: "0px",
                      color: prompt.length > 3500 ? "var(--red-9)" : "var(--gray-a11)",
                      background: "var(--color-background)",
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "11px",
                      fontWeight: prompt.length > 3500 ? "600" : "normal",
                    }}>
                    {prompt.length}/4096
                  </Text>
                </Box>
                <Flex gap="2" align="center" style={{ paddingBottom: "4px" }}>
                  {speechRecognition && (
                    <IconButton
                      size="2"
                      variant={isRecording ? "solid" : "soft"}
                      color={isRecording ? "red" : "gray"}
                      title={isRecording ? "Stop recording" : "Voice input"}
                      onClick={handleSpeechToText}
                      disabled={isBusy && !isRecording}>
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
                      backgroundColor: shouldDisableSubmit ? "var(--gray-a6)" : "var(--accent-9)",
                      color: "white",
                    }}>
                    <ArrowRightIcon height="16" width="16" />
                  </IconButton>
                </Flex>
              </Box>
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
