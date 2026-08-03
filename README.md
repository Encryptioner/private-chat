# Local Whisper - Private AI Chat Assistant: Pure Browser, Zero Backend

## Download and run local LLMs within your browser.

Live site: https://encryptioner.github.io/private-chat/

Blog post: 

## Features

- 🤖 **Local AI Chat**: Run large language models entirely in your browser
- 🔌 **Plug-and-Play Embed**: Easily integrate into any website
- 🔒 **Privacy First**: No data leaves your browser, completely offline-capable
- 📱 **Responsive Design**: Works across all devices and screen sizes
- ⚡ **WebAssembly Powered**: Fast inference using Wllama
- 🎯 **Easy Integration**: Simple embed script for websites
- 🧠 **Site-Aware (RAG)**: When embedded, the widget scrapes the host page and answers from its own content — with clickable links that scroll to the relevant section. 100% in-browser, no backend.

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

**GitHub Pages (Default):**
```bash
# Build for GitHub Pages
pnpm run build

# Preview production build
pnpm run preview
```

**Standalone Domain:**
```bash
# Build for custom domain
DEPLOYMENT_TYPE=standalone pnpm run build
```

The application automatically detects the deployment environment and adjusts URLs accordingly.

## Embed Integration

### Plug-and-Play (Recommended)

Just add one script tag - no setup required! A floating chat button appears automatically:

```html
<script 
  id="aiChatEmbedScript" 
  defer 
  src="https://encryptioner.github.io/private-chat/embed.js">
</script>
<!-- That's it! Floating chat widget appears automatically -->
```

### Custom Div Integration

If you want the chat to load in a specific location:

```html
<script 
  id="aiChatEmbedScript" 
  defer 
  src="https://encryptioner.github.io/private-chat/embed.js">
</script>

<!-- Chat loads automatically here -->
<div id="ai-chat-embed-div"></div>
```

### Site-Aware Configuration (Optional)

Set `window.PRIVATE_CHAT_CONFIG` **before** the embed script loads to customize the widget per site. The config is read in the host context and forwarded to the chat iframe — no per-site code fork.

```html
<script>
  // Both fields optional
  window.PRIVATE_CHAT_CONFIG = {
    label: "Acme Labs",          // shown in the widget greeting
    siteIndexUrl: "/site-index.json" // optional pre-built cross-page index
  };
</script>
<script id="aiChatEmbedScript" defer src="https://encryptioner.github.io/private-chat/embed.js"></script>
```

- **No config** → the widget still works: it live-scrapes the current page (same-origin only) and grounds answers in that.
- **Cross-origin host** → scraping silently disables; the widget falls back to a generic, context-less chat (no crash).
- `siteIndexUrl` is optional (phase-2 cross-page index); a missing file is ignored.

> The widget answers **only** from the page's retrieved content. If a question isn't covered, it says so. Up to 3 "Related sections" links appear under the answer when relevant.

### Advanced Integration

```html
<button onclick="openChat()">Open AI Chat</button>
<div id="my-chat-container"></div>

<script 
  id="aiChatEmbedScript" 
  defer 
  src="https://encryptioner.github.io/private-chat/embed.js">
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
- Makes embed script available at: `https://encryptioner.github.io/private-chat/embed.js`

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
- [SmolLm - HuggingFace](https://huggingface.co/HuggingFaceTB)
- [Llama 3.2 - Meta](https://www.llama.com/)
- [Daniel Chifamba](https://dev.to/dchif/run-your-offline-ai-chat-assistant-pure-browser-zero-backend-1e48)



---

## Support

If you find my work useful, consider supporting it:

[![SupportKori](https://img.shields.io/badge/SupportKori-☕-FFDD00?style=flat-square)](https://www.supportkori.com/mirmursalinankur)
