import PropTypes from "prop-types";
import { Box, Flex, Text } from "@radix-ui/themes";
import { DocumentDuplicateIcon, SpeakerWaveIcon } from "@heroicons/react/24/outline";
import { StopCircleIcon } from "@heroicons/react/24/solid";
import { CHAT_ROLE } from "../lib/wllama";
import { ELLIPSIS } from "../lib/constants";
import Markdown from "./Markdown";
import IconButton from "./IconButton";
import RelatedSections from "./RelatedSections";

// One chat message bubble: role indicator (U/AI), the reasoning + conclusion
// split (models that emit <think>…</think>), Markdown body (or an ELLIPSIS
// placeholder while the first token is pending), per-message action buttons
// (read aloud / copy), and retrieval "Related sections". Lifted verbatim from
// App.jsx's messages.map body — pure render, no logic. App derives every flag.
function MessageItem({
  content,
  role,
  sources,
  isLastMessage,
  isGenerating,
  isCurrentSessionGenerating,
  isReadingAloud,
  onReadAloud,
  onCopy,
}) {
  const isPlaceholder = content === ELLIPSIS;
  const isUser = role === CHAT_ROLE.user;
  const [reasoning, conclusion = " "] = content.startsWith("<think>") ? content.split("</think>") : ["", content];

  // Action buttons hide while the placeholder is up and while THIS message is
  // the one actively streaming (matching the original inline predicate exactly).
  const showActions =
    role === CHAT_ROLE.assistant && !isPlaceholder && !(isLastMessage && isGenerating && isCurrentSessionGenerating);

  return (
    <Box mb="6" className="mobile-message">
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
            {!isPlaceholder ? (
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
          {showActions && (
            <Flex mt="3" gap="2" justify="start">
              <IconButton
                size="1"
                tooltip="Read aloud"
                onClick={() => onReadAloud(content)}
                variant="soft"
                color="gray"
              >
                {isReadingAloud ? <StopCircleIcon width="14" /> : <SpeakerWaveIcon width="14" />}
              </IconButton>
              <IconButton
                size="1"
                tooltip="Copy to clipboard"
                onClick={() => onCopy(content)}
                variant="soft"
                color="gray"
              >
                <DocumentDuplicateIcon width="14" />
              </IconButton>
            </Flex>
          )}
          {/* Related sections from retrieval (spec FR-5) */}
          {role === CHAT_ROLE.assistant && sources?.length > 0 && !isPlaceholder && (
            <RelatedSections sources={sources} />
          )}
        </Box>
      </Flex>
    </Box>
  );
}

MessageItem.propTypes = {
  content: PropTypes.string.isRequired,
  role: PropTypes.string.isRequired,
  sources: PropTypes.arrayOf(
    PropTypes.shape({
      anchor: PropTypes.string,
      title: PropTypes.string,
      url: PropTypes.string,
      text: PropTypes.string,
      score: PropTypes.number,
    })
  ),
  isLastMessage: PropTypes.bool,
  isGenerating: PropTypes.bool,
  isCurrentSessionGenerating: PropTypes.bool,
  isReadingAloud: PropTypes.bool,
  onReadAloud: PropTypes.func,
  onCopy: PropTypes.func,
};

export default MessageItem;
