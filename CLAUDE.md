# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a browser-based AI chat assistant that runs LLMs (Large Language Models) entirely in the browser using WebAssembly. It uses the Wllama library to load and run GGUF format models locally without requiring any backend server.

## Architecture

- **Frontend**: React application with Vite as the build tool
- **LLM Engine**: Wllama (@wllama/wllama) - WebAssembly-based LLM inference
- **Site-Aware RAG**: When embedded, `embed.js` (running in the **host** context) scrapes the host page — works on **any** origin (same- or cross-origin, since the host is always same-origin to itself) — and bridges the sections to the chat iframe via `postMessage`. The iframe chunks → embeds locally (a *dedicated* second Wllama instance running `bge-small-en-v1.5`) → retrieves top-k → grounds the answer and renders "Related sections" links. Site owners can supply a custom scraper via `PRIVATE_CHAT_CONFIG.getSections`. The embedder loads lazily on the first question; vectors are IndexedDB-cached. Integration guide: `docs/SITE-INTEGRATION.md`. See `src/scripts/embed.ts`, `src/lib/ragEngine.js`, `embeddings.js`, `scraper.js`.
- **UI Framework**: Radix UI themes for consistent design components
- **Model Format**: GGUF format models from Hugging Face
- **State Management**: React hooks (no external state management)

### Key Components

- `src/App.jsx`: Main application component containing all chat logic (incl. the embed-mode RAG branch in `submitPrompt` + the host→iframe `postMessage` section consumer)
- `src/scripts/embed.ts`: Host-context embed script (built to `dist/embed.js`). Scrapes the host (default or `PRIVATE_CHAT_CONFIG.getSections`), bridges sections to the iframe via `postMessage`, re-scrapes on SPA nav, and handles cross-origin scroll-to. Same-origin iframe-side scrape is the fallback.
- `src/lib/wllama.js`: Wllama integration, model definitions, and chat formatting
- `src/lib/ragEngine.js`: Site-aware RAG — grounded system-message builder + `navigateToSection` (host scroll/nav)
- `src/lib/embeddings.js`: Local vector index (its **own** Wllama embedder instance, not the chat singleton) + brute-force retrieval; IndexedDB-cached
- `src/lib/scraper.js`: Host-page DOM → anchor-tagged chunks (iframe-aware: reads same-origin `window.parent.document`)
- `src/lib/siteIndex.js` + `hostNav.js`: optional static `site-index.json` merge + SPA route re-scrape watcher
- `src/lib/formatMessage.js`: Escapes + formats assistant output (XSS-hardened `dangerouslySetInnerHTML` path)
- `src/components/`: Reusable UI components (Dropdown, Footer, Loader, RelatedSections, etc.)
- `download-model.cjs`: Post-install script to download default model

## Development Commands

```bash
# Install dependencies (also downloads default model)
pnpm install

# Start development server with CORS headers for WebAssembly
pnpm run dev

# Build for production
pnpm run build

# Lint code
pnpm run lint

# Run unit tests (vitest + jsdom)
pnpm test

# Run E2E (Playwright). Model-backed tests need RAG_E2E_MODEL=1 + chromium:
#   npx playwright install chromium && RAG_E2E_MODEL=1 pnpm run test:e2e
pnpm run test:e2e

# Preview production build
pnpm run preview
```

## Model Management

The app supports two types of models:
1. **Preset Models**: Defined in `src/lib/wllama.js` PRESET_MODELS, downloaded from Hugging Face
2. **Local GGUF Files**: Users can upload their own .gguf files (max 2GB in browser)

Default chat model (**Gemma 3 270M**, `default: true` in `PRESET_MODELS`) is downloaded during `pnpm install` to `public/models/`. Set `SKIP_DOWNLOAD_MODEL=true` to skip automatic download.

### RAG embedder model

Site-aware RAG uses a separate, smaller embedder: **`bge-small-en-v1.5-q8_0.gguf`** (~35MB), loaded lazily by its own Wllama instance on the first grounded question (`src/lib/embeddings.js`). In prod it streams from the HuggingFace CDN; for **local dev** it must exist at `public/models/bge-small-en-v1.5-q8_0.gguf` (COEP-safe same-origin). Download it manually:

```bash
curl -L -o public/models/bge-small-en-v1.5-q8_0.gguf \
  https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf
```

(`public/models/` is gitignored — models are local-only.)

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