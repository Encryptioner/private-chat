const MAX_SESSIONS = 50;

const getDomainKey = (domainParam = null) => {
  if (domainParam) {
    return domainParam;
  }

  try {
    // Check if we're in an iframe
    if (window !== window.parent) {
      // Try to get parent domain from referrer
      if (document.referrer) {
        const referrerUrl = new URL(document.referrer);
        return referrerUrl.hostname;
      }
      // Fallback to trying parent location (may fail due to CORS)
      try {
        return window.parent.location.hostname;
      } catch {
        // Cross-origin access blocked, use current domain
        return window.location.hostname;
      }
    }
    // Not in iframe, use current domain
    return window.location.hostname;
  } catch {
    // Fallback to generic key
    return "default";
  }
};

const getStorageKey = (domainParam = null) => {
  const domain = getDomainKey(domainParam);
  return `chat_sessions_${domain}`;
};

export const generateSessionId = () => `session_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

export const generateSessionTitle = (messages) => {
  const firstUserMessage = messages.find((msg) => msg.role === "user");
  if (!firstUserMessage) {
    return "New Chat";
  }

  const title = firstUserMessage.content.trim();
  return title.length > 30 ? title.substring(0, 30) + "..." : title;
};

export const saveChatSessions = (sessions, domainParam = null) => {
  try {
    const sessionsArray = Object.values(sessions);
    const limitedSessions = sessionsArray
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, MAX_SESSIONS);

    const sessionsObject = limitedSessions.reduce((acc, session) => {
      acc[session.id] = session;
      return acc;
    }, {});

    localStorage.setItem(getStorageKey(domainParam), JSON.stringify(sessionsObject));
  } catch (error) {
    console.debug("Failed to save chat sessions:", error);
  }
};

export const loadChatSessions = (domainParam = null) => {
  try {
    const stored = localStorage.getItem(getStorageKey(domainParam));
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.debug("Failed to load chat sessions:", error);
    return {};
  }
};

export const createNewSession = () => {
  const id = generateSessionId();
  return {
    id,
    title: "New Chat",
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
};

export const updateSession = (session, messages) => {
  const title = messages.length > 0 ? generateSessionTitle(messages) : "New Chat";
  return {
    ...session,
    title,
    messages,
    updatedAt: new Date().toISOString(),
  };
};

export const deleteSession = (sessions, sessionId) => {
  const newSessions = { ...sessions };
  delete newSessions[sessionId];
  return newSessions;
};
