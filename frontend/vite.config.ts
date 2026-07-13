import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  build: {
    // The Python server and wheel both serve assets from this package directory.
    outDir: path.resolve(__dirname, "../src/tracelabel/static"),
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8377",
    },
  },
});
