# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a browser-based AI chat assistant that runs LLMs (Large Language Models) entirely in the browser using WebAssembly. It uses the Wllama library to load and run GGUF format models locally without requiring any backend server.

## Architecture

- **Frontend**: React application with Vite as the build tool
- **LLM Engine**: Wllama (@wllama/wllama) - WebAssembly-based LLM inference
- **UI Framework**: Radix UI themes for consistent design components
- **Model Format**: GGUF format models from Hugging Face
- **State Management**: React hooks (no external state management)

### Key Components

- `src/App.jsx`: Main application component containing all chat logic
- `src/lib/wllama.js`: Wllama integration, model definitions, and chat formatting
- `src/components/`: Reusable UI components (Dropdown, Footer, Loader, etc.)
- `download-model.cjs`: Post-install script to download default model

## Development Commands

```bash
# Install dependencies (also downloads default model)
npm install

# Start development server with CORS headers for WebAssembly
npm run dev

# Build for production
npm run build

# Lint code
npm run lint

# Preview production build
npm run preview
```

## Model Management

The app supports two types of models:
1. **Preset Models**: Defined in `src/lib/wllama.js` PRESET_MODELS, downloaded from Hugging Face
2. **Local GGUF Files**: Users can upload their own .gguf files (max 2GB in browser)

Default model (LFM2-700M) is downloaded during `npm install` to `public/models/`. Set `SKIP_DOWNLOAD_MODEL=true` to skip automatic download.

## Vite Configuration

Special headers required for WebAssembly execution:
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Opener-Policy: same-origin`

These are configured in `vite.config.js` for the dev server.

## Key Technical Details

- All model inference happens client-side using WebAssembly
- Chat history is limited to last 4 messages for context management
- Models are cached in browser for offline usage
- Speech synthesis API integration for text-to-speech
- System prompt optimizes for concise responses


## General Rules
1. Be concise and accurate
2. Consider yourself as experienced professional software engineer and act accordingly
3. You must ensure production ready, professional, scalable and maintainable code
4. You must ensure the website follows responsive design and works good in all screen
5. Ensure the UX and UI follows latest standard and attractive (not pushy) to use
6. Must kill all the bash script after providing final output in chat