# Task 3: Multi Domain & System Prompt Support - Summary

## Step 1: Context Cache Error Fix

### Issue
The application was experiencing a "Running out of context cache" error when processing larger prompts, specifically:
```
@wllama_wllama_esm.js?v=d74c3d81:2911 Uncaught (in promise) WllamaError: Running out of context cache. Please increase n_ctx when loading the model
```

### Solution
Updated the model loading configuration in `src/App.jsx` to include `n_ctx: 4096` parameter in the options object passed to both `loadModel` and `loadModelFromUrl` methods.

### Files Changed
- **src/App.jsx:90** - Added `n_ctx: 4096` to model loading options to increase context window size for handling longer conversations and larger prompts

### Technical Details
The `n_ctx` parameter controls the context window size in the Wllama WebAssembly LLM inference engine. Increasing it from the default (usually 512-1024) to 4096 allows the model to handle much longer conversation histories and larger system prompts without running out of context cache.

## Step 2: Query Parameter Support for System Messages and Domain Configuration

### Issue
The application needed to support dynamic system messages and domain configuration through query parameters, enabling integration with external websites like the markdown-to-slide project.

### Solution
Implemented end-to-end query parameter support to allow external websites to customize the chat behavior by passing parameters like `system` (for custom system messages) and `domain` through the embed script URL.

### Files Changed
- **src/scripts/embed.ts:12,22-28,61-85** - Added `embedQueryParams` property to store query parameters from embed script URL, and modified `_createIframe()` to forward all query parameters to the iframe
- **src/App.jsx:125-131,490** - Added query parameter parsing using `URLSearchParams` to extract `system` parameter and set custom system message with `setCustomSystemMessage()`. Also updated input maxLength to 4096 to match increased context window

### Integration Flow
1. External websites (like markdown-to-slide) include the embed script with query parameters: `embed.js?system=ENCODED_MESSAGE&domain=DOMAIN_URL`
2. The embed script extracts these parameters from its own URL and forwards them to the iframe
3. The main application reads the parameters via `window.location.search` and applies the custom system message
4. This works across all deployment types: standalone domains, GitHub Pages, and iframe contexts

### Technical Implementation
- Query parameters are URL-encoded for safe transmission
- The embed script uses `URLSearchParams` to parse and forward parameters
- The main app decodes parameters with `decodeURIComponent()`
- All existing functionality remains intact while adding the new parameter support