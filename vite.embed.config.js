import { defineConfig } from "vite";
import { resolve } from "path";

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/scripts/embed.ts"),
      name: "EmbedScript",
      fileName: () => "embed.js",
      formats: ["iife"],
    },
    rollupOptions: {
      external: [],
      output: {
        globals: {},
        inlineDynamicImports: true,
      },
    },
    outDir: "dist",
    assetsDir: "",
    minify: true,
    emptyOutDir: false, // Don't clear the dist directory
  },
  define: {
    "process.env.NODE_ENV": '"production"',
  },
});
