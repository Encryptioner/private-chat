import { useState } from "react";
import { Box, Flex, ScrollArea, Text, IconButton } from "@radix-ui/themes";
import { TrashIcon, PencilSquareIcon } from "@heroicons/react/24/outline";
import PropTypes from "prop-types";

function ChatHistorySidebar({
  sessions,
  currentSessionId,
  onSessionSelect,
  onSessionDelete,
  onSessionRename,
  isOpen,
  isMobile,
  onClose,
}) {
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editTitle, setEditTitle] = useState("");

  const handleEditStart = (session) => {
    setEditingSessionId(session.id);
    setEditTitle(session.title);
  };

  const handleEditSave = () => {
    if (editTitle.trim()) {
      onSessionRename(editingSessionId, editTitle.trim());
    }
    setEditingSessionId(null);
    setEditTitle("");
  };

  const handleEditCancel = () => {
    setEditingSessionId(null);
    setEditTitle("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleEditSave();
    } else if (e.key === "Escape") {
      handleEditCancel();
    }
  };

  const sessionsList = Object.values(sessions).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

  return (
    <>
      {isOpen && (
        <Box
          position="fixed"
          top="0"
          left="0"
          width="100vw"
          height="100vh"
          style={{
            backgroundColor: "rgba(0,0,0,0.5)",
            zIndex: 999,
          }}
          onClick={onClose}
        />
      )}

      <Box
        position="fixed"
        top="0"
        left="0"
        height="100vh"
        style={{
          width: isMobile ? "85vw" : "300px",
          backgroundColor: "var(--color-panel-solid)",
          borderRight: "1px solid var(--color-border)",
          zIndex: 1000,
          boxShadow: "2px 0 8px rgba(0,0,0,0.1)",
          transform: !isOpen ? "translateX(-100%)" : "translateX(0)",
          transition: "transform 0.3s ease",
        }}
        p="4">
        <Text size="4" weight="bold" mb="3" asChild>
          <h2>Chat History</h2>
        </Text>

        <ScrollArea type="hover" scrollbars="vertical" style={{ height: "calc(100vh - 80px)" }}>
          <Flex direction="column" gap="2">
            {sessionsList.map((session) => (
              <Box
                key={session.id}
                p="3"
                style={{
                  backgroundColor: session.id === currentSessionId ? "var(--color-accent-3)" : "transparent",
                  borderRadius: "var(--radius-2)",
                  cursor: "pointer",
                  border: "1px solid transparent",
                  transition: "background-color 0.2s ease",
                }}
                className="session-item"
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    session.id === currentSessionId ? "var(--color-accent-3)" : "var(--color-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor =
                    session.id === currentSessionId ? "var(--color-accent-3)" : "transparent")
                }>
                {editingSessionId === session.id ? (
                  <Flex direction="column" gap="2">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onBlur={handleEditSave}
                      autoFocus
                      style={{
                        background: "transparent",
                        border: "1px solid var(--color-border)",
                        borderRadius: "4px",
                        padding: "4px 8px",
                        fontSize: "14px",
                        width: "100%",
                      }}
                    />
                  </Flex>
                ) : (
                  <Flex direction="column" gap="2" onClick={() => onSessionSelect(session.id)}>
                    <Flex justify="between" align="center">
                      <Text size="2" weight="medium" style={{ cursor: "pointer" }}>
                        {session.title}
                      </Text>
                      <Flex gap="1">
                        <IconButton
                          size="1"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditStart(session);
                          }}>
                          <PencilSquareIcon width="12" height="12" />
                        </IconButton>
                        <IconButton
                          size="1"
                          variant="ghost"
                          color="red"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSessionDelete(session.id);
                          }}>
                          <TrashIcon width="12" height="12" />
                        </IconButton>
                      </Flex>
                    </Flex>
                    <Text size="1" color="gray">
                      {new Date(session.updatedAt).toLocaleDateString()}
                    </Text>
                    {session.messages.length > 0 && (
                      <Text size="1" color="gray">
                        {session.messages.length} messages
                      </Text>
                    )}
                  </Flex>
                )}
              </Box>
            ))}

            {sessionsList.length === 0 && (
              <Text size="2" color="gray" align="center" mt="4">
                No chat history yet
              </Text>
            )}
          </Flex>
        </ScrollArea>
      </Box>
    </>
  );
}

ChatHistorySidebar.propTypes = {
  sessions: PropTypes.object.isRequired,
  currentSessionId: PropTypes.string,
  onSessionSelect: PropTypes.func.isRequired,
  onSessionDelete: PropTypes.func.isRequired,
  onSessionRename: PropTypes.func.isRequired,
  isOpen: PropTypes.bool.isRequired,
  isMobile: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};

export default ChatHistorySidebar;
