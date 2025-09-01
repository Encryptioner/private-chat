import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

// Plugin to serve embed.js and service worker with correct MIME types
const serveStaticFiles = () => ({
  name: 'serve-static-files',
  configureServer(server) {
    // Serve embed.js from dist directory
    server.middlewares.use('/embed.js', (req, res, next) => {
      const embedPath = path.resolve('dist/embed.js');
      if (fs.existsSync(embedPath)) {
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(fs.readFileSync(embedPath));
      } else {
        res.statusCode = 404;
        res.end('embed.js not found. Run "pnpm run build:embed" first.');
      }
    });

    // Serve service worker with correct MIME type
    server.middlewares.use('/sw.js', (req, res, next) => {
      const swPath = path.resolve('public/sw.js');
      if (fs.existsSync(swPath)) {
        res.setHeader('Content-Type', 'application/javascript');
        res.setHeader('Service-Worker-Allowed', '/');
        res.end(fs.readFileSync(swPath));
      } else {
        res.statusCode = 404;
        res.end('Service worker not found.');
      }
    });
  }
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), serveStaticFiles()],
  server: {
    open: true,
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  build: {
    manifest: true,
  },
});
