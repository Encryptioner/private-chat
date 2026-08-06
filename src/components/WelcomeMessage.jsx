import PropTypes from "prop-types";
import { Box, Flex, Text } from "@radix-ui/themes";
import Loader from "./Loader";

// Empty-state: either a model-loading screen (with download %) or the greeting
// (site-owner widgetLabel when embedded). Lifted verbatim from App.jsx's
// `messages.length === 0` branch — pure render.
function WelcomeMessage({ isLoading, loadedSize, loadingProgressDisplayString, modelSizeDisplayString, widgetLabel }) {
  return (
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
  );
}

WelcomeMessage.propTypes = {
  isLoading: PropTypes.bool,
  loadedSize: PropTypes.number,
  loadingProgressDisplayString: PropTypes.string,
  modelSizeDisplayString: PropTypes.string,
  widgetLabel: PropTypes.string,
};

export default WelcomeMessage;
