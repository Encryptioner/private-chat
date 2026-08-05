import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fs from "fs";
import path from "path";

// Plugin to serve embed.js and service worker with correct MIME types
const serveStaticFiles = () => ({
  name: "serve-static-files",
  configureServer(server) {
    // Serve embed.js from dist directory
    server.middlewares.use("/embed.js", (req, res) => {
      const embedPath = path.resolve("dist/embed.js");
      if (fs.existsSync(embedPath)) {
        res.setHeader("Content-Type", "application/javascript");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.end(fs.readFileSync(embedPath));
      } else {
        res.statusCode = 404;
        res.end('embed.js not found. Run "pnpm run build:embed" first.');
      }
    });

    // Serve service worker with correct MIME type
    server.middlewares.use("/sw.js", (req, res) => {
      const swPath = path.resolve("public/sw.js");
      if (fs.existsSync(swPath)) {
        res.setHeader("Content-Type", "application/javascript");
        res.setHeader("Service-Worker-Allowed", "/");
        res.end(fs.readFileSync(swPath));
      } else {
        res.statusCode = 404;
        res.end("Service worker not found.");
      }
    });
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  const isProduction = command === "build";

  // Deployment configuration - easily switch between GitHub Pages and standalone domain
  const DEPLOYMENT_TYPE = process.env.DEPLOYMENT_TYPE || "github-pages"; // or "standalone"
  const REPO_NAME = "private-chat";

  // Determine base path based on deployment type
  let basePath = "/";
  if (isProduction) {
    if (DEPLOYMENT_TYPE === "github-pages") {
      basePath = `/${REPO_NAME}/`;
    } else {
      // Standalone domain uses root path
      basePath = "/";
    }
  }

  return {
    base: basePath,
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
    // wllama 3.x ships its wasm via internal `new URL(..., import.meta.url)`;
    // pre-bundling mishandles it (serves the wasm as a JS module → MIME error).
    // Serve the package unbundled so the wasm resolves natively.
    optimizeDeps: {
      exclude: ["@wllama/wllama"],
    },
    test: {
      environment: "jsdom",
      globals: true,
      include: ["src/**/*.test.{js,jsx}"],
    },
  };
});
