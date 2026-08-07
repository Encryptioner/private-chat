import PropTypes from "prop-types";
import { Box, Button, Flex, Text } from "@radix-ui/themes";
import Loader from "./Loader";

// Empty-state: a download-consent prompt (slow/unknown network + never loaded
// before), a load-failed prompt with Retry, a model-loading screen (with
// download %), or the greeting (site-owner widgetLabel when embedded).
// Lifted verbatim from App.jsx's `messages.length === 0` branch — pure render.
function WelcomeMessage({
  isLoading,
  loadedSize,
  loadingProgressDisplayString,
  modelSizeDisplayString,
  widgetLabel,
  awaitingConsent,
  loadError,
  onDownload,
}) {
  return (
    <Box className="welcome-text" pb="5">
      {awaitingConsent ? (
        <Flex direction="column" align="center" gap="4">
          <Text size="6" align="center" asChild>
            <h1>Ready to chat?</h1>
          </Text>
          <Text size="3" color="gray" align="center">
            Download the model {modelSizeDisplayString} to start chatting. It loads only once and is cached for next
            time.
          </Text>
          <Button size="2" onClick={onDownload}>
            Download model
          </Button>
        </Flex>
      ) : loadError ? (
        <Flex direction="column" align="center" gap="4">
          <Text size="6" align="center" asChild>
            <h1>Download failed</h1>
          </Text>
          <Text size="3" color="gray" align="center">
            Check your connection and try again.
          </Text>
          <Button size="2" onClick={onDownload}>
            Retry
          </Button>
        </Flex>
      ) : isLoading ? (
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
  );
}

WelcomeMessage.propTypes = {
  isLoading: PropTypes.bool,
  loadedSize: PropTypes.number,
  loadingProgressDisplayString: PropTypes.string,
  modelSizeDisplayString: PropTypes.string,
  widgetLabel: PropTypes.string,
  awaitingConsent: PropTypes.bool,
  loadError: PropTypes.oneOfType([PropTypes.instanceOf(Error), PropTypes.object]),
  onDownload: PropTypes.func,
};

export default WelcomeMessage;
