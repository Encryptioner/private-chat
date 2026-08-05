// Unit tests for src/lib/chatStorage.js — vitest + jsdom.
// Covers the storage-type routing added for embed mode (spec FR-5 m1, R4):
// visitor conversations persist to sessionStorage (survives a cross-page host
// reload, clears on tab close); standalone app keeps localStorage.
import { describe, it, expect, beforeEach } from "vitest";
import { saveChatSessions, loadChatSessions, createNewSession } from "../chatStorage.js";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

const makeSession = (content = "hi") => ({
  ...createNewSession(),
  messages: [{ role: "user", content, id: "m1" }],
});

describe("storage routing (R4)", () => {
  it("session storage round-trips a visitor session and stays out of localStorage", () => {
    const session = makeSession("where is pricing");
    saveChatSessions({ [session.id]: session }, "test-domain", "session");

    expect(sessionStorage.getItem("chat_sessions_test-domain")).toBeTruthy();
    expect(localStorage.getItem("chat_sessions_test-domain")).toBeNull();

    const loaded = loadChatSessions("test-domain", "session");
    expect(loaded[session.id].messages[0].content).toBe("where is pricing");
  });

  it("localStorage is the default (standalone app behavior unchanged)", () => {
    const session = makeSession("hello");
    saveChatSessions({ [session.id]: session }, "test-domain"); // no storage arg → local

    expect(localStorage.getItem("chat_sessions_test-domain")).toBeTruthy();
    expect(sessionStorage.getItem("chat_sessions_test-domain")).toBeNull();

    const loaded = loadChatSessions("test-domain");
    expect(loaded[session.id].messages[0].content).toBe("hello");
  });

  it("the two stores are independent (a tab-local visitor chat ≠ the app's history)", () => {
    const v = makeSession("visitor");
    const a = makeSession("app");
    saveChatSessions({ [v.id]: v }, "d", "session");
    saveChatSessions({ [a.id]: a }, "d", "local");

    const visitors = loadChatSessions("d", "session");
    const appHistory = loadChatSessions("d", "local");
    expect(Object.keys(visitors)).not.toEqual(Object.keys(appHistory));
  });
});
