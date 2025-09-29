# Testing Guide: Plug-and-Play Chat Integration

This guide explains how to test the embed functionality in both development and production environments.

## How It Works

The embed script now works as a true **plug-and-play** solution:

1. **Automatic Detection**: The script looks for a div with id `ai-chat-embed-div`
2. **Fallback Creation**: If no div is found, it automatically creates a floating chat widget
3. **Zero Configuration**: No manual HTML elements or styling required
4. **Cross-Site Compatible**: Works on any website with just one script tag

### Behavior Modes

- **Inline Mode**: If `<div id="ai-chat-embed-div"></div>` exists → chat loads directly in that div
- **Floating Mode**: If no div exists → automatic floating chat button appears in bottom-right corner

## Development Testing

### Prerequisites
- Node.js 18+ installed
- pnpm installed globally
- Git repository cloned

### Setup Steps

1. **Install Dependencies**
   ```bash
   cd private-chat
   pnpm install
   ```

2. **Start Development Server**
   ```bash
   pnpm run dev
   ```
   This automatically builds the embed script and starts the main application at `http://localhost:5173`
   
   **Note**: The embed script (`embed.js`) is automatically built and served at `http://localhost:5173/embed.js`

### Local Embed Testing

#### Method 1: Floating Widget Test (Recommended)

Create a test HTML file (`test-floating.html`):
```html
<!DOCTYPE html>
<html>
<head>
    <title>Floating Chat Test</title>
</head>
<body>
    <h1>Test Page</h1>
    <p>No chat div needed - widget appears automatically!</p>
    
    <script id="aiChatEmbedScript" defer src="http://localhost:5173/embed.js"></script>
</body>
</html>
```

#### Method 2: Traditional Div Test

Create a test HTML file (`test-embed.html`):
```html
<!DOCTYPE html>
<html>
<head>
    <title>Chat Embed Test</title>
</head>
<body>
    <h1>Test Page</h1>
    <p>The chat should load below:</p>
    
    <!-- Default div - chat loads automatically -->
    <div id="ai-chat-embed-div"></div>
    
    <!-- Custom div for manual loading -->
    <div id="custom-chat-div" style="margin-top: 20px;"></div>
    <button onclick="window.loadChatApp('custom-chat-div')">
        Load Chat in Custom Div
    </button>
    
    <script id="aiChatEmbedScript" defer src="http://localhost:5173/embed.js"></script>
</body>
</html>
```

#### Method 3: Test with Another Local Project

1. Start the chat app: `pnpm run dev` (runs on port 5173)
2. In another project, add the embed script:
   ```html
   <script id="aiChatEmbedScript" defer src="http://localhost:5173/embed.js"></script>
   ```
3. **No additional setup required** - floating chat widget appears automatically!

### Development Server Configuration

The development server is configured with necessary headers:
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Opener-Policy: same-origin`

These headers are required for WebAssembly to work.

## Production Testing

### GitHub Pages Deployment

1. **Automatic Deployment**
   - Push changes to `main` branch
   - GitHub Actions automatically builds and deploys
   - Available at: `https://username.github.io/repository-name/`

2. **Manual Build Testing**
   ```bash
   # Build for production
   pnpm run build
   
   # Test production build locally
   pnpm run preview
   ```

### Production Embed Testing

Use the production URL in your embed script:
```html
<script 
    id="aiChatEmbedScript" 
    defer 
    src="https://username.github.io/repository-name/embed.js">
</script>
```

### Service Worker Considerations

The production deployment uses a service worker to inject necessary headers for WebAssembly:
- Headers are added dynamically in the browser
- Required for cross-origin embedding
- Handles offline caching

## Integration Examples

### Basic Integration (Automatic Floating Widget)
```html
<!DOCTYPE html>
<html>
<body>
    <!-- NO div needed - chat widget appears automatically -->
    
    <script 
        id="aiChatEmbedScript" 
        defer 
        src="https://username.github.io/repository-name/embed.js">
    </script>
</body>
</html>
```

### Integration with Custom Div (Optional)
```html
<!DOCTYPE html>
<html>
<body>
    <!-- Chat loads directly in this div if present -->
    <div id="ai-chat-embed-div"></div>
    
    <script 
        id="aiChatEmbedScript" 
        defer 
        src="https://username.github.io/repository-name/embed.js">
    </script>
</body>
</html>
```

### Advanced Integration with Manual Loading
```html
<!DOCTYPE html>
<html>
<body>
    <button id="chatBtn">Open Chat</button>
    <div id="chat-container" style="display:none;"></div>
    
    <script 
        id="aiChatEmbedScript" 
        defer 
        src="https://username.github.io/repository-name/embed.js">
    </script>
    
    <script>
        document.getElementById('chatBtn').onclick = function() {
            const container = document.getElementById('chat-container');
            container.style.display = 'block';
            
            if (window.loadChatApp) {
                window.loadChatApp('chat-container');
            } else {
                console.error('Chat app not loaded yet');
            }
        };
    </script>
</body>
</html>
```

### React/Next.js Integration
```tsx
'use client';

import { useEffect, useState } from 'react';

declare global {
  interface Window {
    loadChatApp?: (elementId: string) => void;
  }
}

export default function ChatIntegration() {
  const [isLoaded, setIsLoaded] = useState(false);
  
  useEffect(() => {
    const script = document.createElement('script');
    script.id = 'aiChatEmbedScript';
    script.defer = true;
    script.src = 'https://username.github.io/repository-name/embed.js';
    document.head.appendChild(script);
    
    const checkLoaded = () => {
      if (window.loadChatApp) {
        setIsLoaded(true);
      } else {
        setTimeout(checkLoaded, 100);
      }
    };
    checkLoaded();
    
    return () => {
      const existingScript = document.getElementById('aiChatEmbedScript');
      if (existingScript) {
        existingScript.remove();
      }
    };
  }, []);
  
  const openChat = () => {
    if (isLoaded && window.loadChatApp) {
      window.loadChatApp('chat-div');
    }
  };
  
  return (
    <div>
      <button onClick={openChat} disabled={!isLoaded}>
        Open Chat
      </button>
      <div id="chat-div"></div>
    </div>
  );
}
```

## Troubleshooting

### Common Issues

1. **404 Error for embed.js in development**
   - **Problem**: `Failed to load resource: the server responded with a status of 404 (Not Found) embed.js`
   - **Solution**: 
     ```bash
     # Make sure to run the full dev command which builds embed script first
     pnpm run dev
     
     # If still issues, build embed script manually first
     pnpm run build:embed
     pnpm run dev
     ```
   - The embed script is automatically served at `http://localhost:5173/embed.js`

2. **Service Worker ReferenceError**
   - **Problem**: `Uncaught (in promise) ReferenceError: e is not defined`
   - **Solution**: This has been fixed in the service worker code. Update your service worker to the latest version.
   - The service worker now properly handles error variables in catch blocks

3. **Service Worker MIME Type Error**
   - **Problem**: `The script has an unsupported MIME type ('text/html')`
   - **Solution**: Fixed in Vite configuration to serve service worker with correct `application/javascript` MIME type
   - Both development and production environments now serve static files correctly

4. **React DOM Nesting Warning**
   - **Problem**: `Warning: validateDOMNesting(...): <p> cannot appear as a descendant of <p>`
   - **Solution**: Fixed in Markdown component to use proper heading elements instead of converting all headings to `<p>` tags
   - Headings now render as proper `h1`-`h6` elements with appropriate styling

5. **Chat doesn't load**
   - Check browser console for errors
   - Verify embed script URL is accessible
   - In inline mode: Ensure target div exists in DOM
   - In floating mode: Check bottom-right corner for chat button
   - Wait a few seconds for the embed script to load

6. **Floating widget not appearing**
   - Verify no div with id `ai-chat-embed-div` exists (this forces inline mode)
   - Check browser console for JavaScript errors
   - Ensure `document.body` exists when script runs
   - Check for CSS conflicts with `z-index: 9999`

7. **WebAssembly errors**
   - Check if COOP/COEP headers are present
   - Verify service worker is registered and active
   - Test in different browsers

8. **Cross-origin issues**
   - Embed uses iframe to isolate cross-origin content
   - Verify iframe permissions are set correctly
   - Check for Content Security Policy restrictions

### Debug Mode

Add this to check if embed script is loaded:
```javascript
window.addEventListener('load', () => {
  console.log('loadChatApp available:', !!window.loadChatApp);
  
  // Force load after 2 seconds if not auto-loaded
  setTimeout(() => {
    if (window.loadChatApp && document.getElementById('ai-chat-embed-div')) {
      window.loadChatApp('ai-chat-embed-div');
    }
  }, 2000);
});
```

## Performance Considerations

- The embed script is small (~6KB minified)
- Initial model download happens once per origin (each website gets its own cache)
- Models are cached in browser for offline use within each iframe context
- Iframe isolation prevents performance impact on parent page
- Enhanced floating widget with majority screen space (90% viewport width/height)

### Cross-Site Caching Behavior

Each embedded instance has its own storage context:
- **localStorage**: Models and settings are cached per iframe origin
- **Service Worker**: Each iframe registers its own service worker for caching
- **Security**: This isolation prevents cross-site data leakage
- **Impact**: Models may need to be re-downloaded when embedded on different domains

This is expected security behavior and ensures user privacy.

## Security Notes

- All computation happens client-side
- No data is sent to external servers
- Models are loaded directly from CDN or local cache
- Iframe sandbox provides additional security isolation