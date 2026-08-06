import PropTypes from "prop-types";
import { DropdownMenu, Flex, Tooltip } from "@radix-ui/themes";
import { Bars3Icon, PencilSquareIcon } from "@heroicons/react/24/outline";
import { PRESET_MODELS } from "../lib/wllama";
import Dropdown from "./Dropdown";
import IconButton from "./IconButton";

// Top toolbar: chat-history toggle, new-chat, and the model picker dropdown
// (preset list + a local-GGUF file uploader). Lifted verbatim from App.jsx's
// header — pure render. App owns selectedModel + every handler.
function ChatHeader({
  selectedModel,
  isBusy,
  onToggleSidebar,
  onNewChat,
  onSelectModel,
  onFileInputChange,
  fileInputRef,
  localModelFiles,
}) {
  return (
    <Flex direction="row" align="center" justify="between" asChild>
      <header>
        <Flex gap="4" align="center">
          <IconButton tooltip="Chat History" onClick={onToggleSidebar} variant="ghost">
            <Bars3Icon width="24" />
          </IconButton>
          <IconButton tooltip="New Chat" onClick={onNewChat} disabled={isBusy} variant="ghost">
            <PencilSquareIcon width="24" />
          </IconButton>
          <Dropdown label={selectedModel.name}>
            {Object.values(PRESET_MODELS).map(({ name, description }) => (
              <Tooltip content={description} side="right" key={name}>
                <DropdownMenu.Item disabled={name === selectedModel.name || isBusy} onClick={onSelectModel(name)}>
                  {name}
                </DropdownMenu.Item>
              </Tooltip>
            ))}
            {localModelFiles.length > 0 && <DropdownMenu.Item disabled>{selectedModel.name}</DropdownMenu.Item>}
            <DropdownMenu.Separator />
            <DropdownMenu.Item asChild onSelect={(e) => e.preventDefault()}>
              <label title="Select your own local GGUF file">
                Select GGUF file (2GB Max)...
                <input
                  type="file"
                  accept=".gguf"
                  disabled={isBusy}
                  ref={fileInputRef}
                  onChange={onFileInputChange}
                  hidden
                />
              </label>
            </DropdownMenu.Item>
          </Dropdown>
        </Flex>
      </header>
    </Flex>
  );
}

ChatHeader.propTypes = {
  selectedModel: PropTypes.shape({
    name: PropTypes.string.isRequired,
  }).isRequired,
  isBusy: PropTypes.bool,
  onToggleSidebar: PropTypes.func.isRequired,
  onNewChat: PropTypes.func.isRequired,
  onSelectModel: PropTypes.func.isRequired,
  onFileInputChange: PropTypes.func.isRequired,
  fileInputRef: PropTypes.oneOfType([PropTypes.object, PropTypes.func]),
  localModelFiles: PropTypes.array,
};

export default ChatHeader;
