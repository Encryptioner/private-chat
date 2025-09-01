# Private AI Chat Assistant: Pure Browser, Zero Backend

## Download and run local LLMs within your browser.

[preview](https://github.com/user-attachments/assets/d7e00366-d78f-4c8e-ae66-fd8319d1375d)

Live site: https://private-ai-chat.vercel.app

Blog post: https://dev.to/dchif/run-your-offline-ai-chat-assistant-pure-browser-zero-backend-1e48

## Features

- 🤖 **Local AI Chat**: Run large language models entirely in your browser
- 🔌 **Plug-and-Play Embed**: Easily integrate into any website
- 🔒 **Privacy First**: No data leaves your browser, completely offline-capable
- 📱 **Responsive Design**: Works across all devices and screen sizes
- ⚡ **WebAssembly Powered**: Fast inference using Wllama
- 🎯 **Easy Integration**: Simple embed script for websites

## Quick Start

### Running Locally

1. Install dependencies
```bash
pnpm install
```

2. Start development server
```bash
pnpm run dev
```

3. Navigate to http://localhost:5173/

### Building for Production

```bash
# Build main app and embed script
pnpm run build

# Preview production build
pnpm run preview
```

## Embed Integration

### Basic Integration

Add this to any website to embed the chat:

```html
<script 
  id="aiChatEmbedScript" 
  defer 
  src="https://username.github.io/repository-name/embed.js">
</script>

<!-- Chat loads automatically here -->
<div id="ai-chat-embed-div"></div>
```

### Advanced Integration

```html
<button onclick="openChat()">Open AI Chat</button>
<div id="my-chat-container"></div>

<script 
  id="aiChatEmbedScript" 
  defer 
  src="https://username.github.io/repository-name/embed.js">
</script>

<script>
function openChat() {
  if (window.loadChatApp) {
    window.loadChatApp('my-chat-container');
  }
}
</script>
```

## Development & Testing

For detailed development and testing instructions, see [Testing Guide](./docs/testing-guide.md).

### Quick Testing

1. **Local Development**
   ```bash
   pnpm run dev  # Main app at http://localhost:5173
   ```

2. **Test Embed Locally**
   ```bash
   pnpm run build:embed  # Creates dist/embed.js
   ```

3. **Production Build**
   ```bash
   pnpm run build  # Full production build
   ```

## Deployment

### Automatic GitHub Pages

Push to `main` branch - GitHub Actions automatically:
- Builds the application
- Downloads models
- Deploys to GitHub Pages
- Makes embed script available at: `https://username.github.io/repository-name/embed.js`

### Manual Deployment

```bash
pnpm run build
# Deploy dist/ folder to your hosting provider
```

## Configuration

The app supports various GGUF models from Hugging Face:
- SmolLM2-135M-Instruct (default)
- SmolLM2-360M-Instruct  
- Llama-3.2-1B-Instruct
- Custom GGUF file upload (max 2GB)

Models are automatically cached in browser for offline use.

## Credits
- [Wllama](https://github.com/ngxson/wllama)
- SmolLm - [HuggingFace](https://huggingface.co/HuggingFaceTB)
- Llama 3.2 - [Meta](https://www.llama.com/)

