# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a browser-based AI chat application that runs LLMs (Large Language Models) entirely in the browser using WebAssembly. The project uses Wllama to enable offline AI inference without any backend servers.

## Development Commands

```bash
# Install dependencies (downloads default model on first install)
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Lint code
npm run lint

# Preview production build
npm run preview

# Skip model download during install
SKIP_DOWNLOAD_MODEL=1 npm install
```

## Architecture

### Core Components
- **App.jsx**: Main application component containing all chat logic, model management, and UI state
- **src/lib/wllama.js**: Wllama integration layer with model definitions, chat formatting, and WebAssembly instance management
- **src/components/**: Reusable UI components (Dropdown, Footer, IconButton, Loader, Markdown, NavLink)

### Model System
- Models are defined in `PRESET_MODELS` object in `src/lib/wllama.js`
- Supports both preset models (downloaded from HuggingFace) and local GGUF files
- Default model is LFM2 (700M) for localhost, downloaded models for production
- Model files are cached in browser storage after first download

### Chat System
- Messages use roles: `system`, `assistant`, `user` (defined in `CHAT_ROLE`)
- Chat history is limited to last 4 messages to manage memory
- Uses Jinja templates for chat formatting with fallback to custom template
- Supports streaming responses with real-time token updates

### Key Technical Details
- Requires specific COOP/COEP headers for SharedArrayBuffer (configured in vite.config.js)
- Uses Radix UI themes for consistent styling
- Implements text-to-speech for assistant responses
- Single-component architecture for simplicity (as noted in App.jsx comments)

## File Structure
- `public/models/`: Model files storage
- `public/sw.js`: Service worker for offline functionality
- `download-model.cjs`: Automatic model download script
- ESLint configured with React hooks, Prettier, and custom rules