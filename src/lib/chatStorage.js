const STORAGE_KEY = "chat_sessions";
const MAX_SESSIONS = 50;

export const generateSessionId = () => `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

export const generateSessionTitle = (messages) => {
  const firstUserMessage = messages.find((msg) => msg.role === "user");
  if (!firstUserMessage) {
    return "New Chat";
  }

  const title = firstUserMessage.content.trim();
  return title.length > 30 ? title.substring(0, 30) + "..." : title;
};

export const saveChatSessions = (sessions) => {
  try {
    const sessionsArray = Object.values(sessions);
    const limitedSessions = sessionsArray
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
      .slice(0, MAX_SESSIONS);

    const sessionsObject = limitedSessions.reduce((acc, session) => {
      acc[session.id] = session;
      return acc;
    }, {});

    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionsObject));
  } catch (error) {
    console.debug("Failed to save chat sessions:", error);
  }
};

export const loadChatSessions = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
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
