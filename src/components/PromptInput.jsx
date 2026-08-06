import PropTypes from "prop-types";
import { Box, Flex, Text } from "@radix-ui/themes";
import { ArrowRightIcon, MicrophoneIcon } from "@heroicons/react/24/outline";
import IconButton from "./IconButton";

// Composer: auto-growing textarea (Shift+Enter newline, Enter submit — handled by
// the passed onKeyDown), voice-input mic, send button, and the char counter.
// Lifted verbatim from App.jsx — pure render. The two focus/blur border recolors
// (composer box + textarea) are preserved exactly as-is.
const MAX_INPUT_LENGTH = 4096;

function PromptInput({
  prompt,
  onPromptChange,
  onKeyDown,
  isBusy,
  isGenerating,
  shouldDisableSubmit,
  hasSpeech,
  isRecording,
  onSpeechToText,
  onSubmit,
}) {
  return (
    <>
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
            onKeyDown={onKeyDown}
            onChange={onPromptChange}
            placeholder="Type your message... (Shift+Enter for new line)"
            maxLength={MAX_INPUT_LENGTH}
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
          {hasSpeech && (
            <IconButton
              size="2"
              variant={isRecording ? "solid" : "soft"}
              color={isRecording ? "red" : "gray"}
              title={isRecording ? "Stop recording" : "Voice input"}
              onClick={onSpeechToText}
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
            onClick={onSubmit}
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
        {prompt.length}/{MAX_INPUT_LENGTH}
      </Text>
    </>
  );
}

PromptInput.propTypes = {
  prompt: PropTypes.string.isRequired,
  onPromptChange: PropTypes.func.isRequired,
  onKeyDown: PropTypes.func.isRequired,
  isBusy: PropTypes.bool,
  isGenerating: PropTypes.bool,
  shouldDisableSubmit: PropTypes.bool,
  hasSpeech: PropTypes.bool,
  isRecording: PropTypes.bool,
  onSpeechToText: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
};

export default PromptInput;
