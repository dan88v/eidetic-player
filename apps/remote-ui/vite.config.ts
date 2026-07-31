import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: resolve(import.meta.dirname),
  envDir: resolve(import.meta.dirname, "../.."),
  server: {
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 4180,
    strictPort: true,
  },
  build: {
    outDir: resolve(import.meta.dirname, "../../dist/remote-ui"),
    emptyOutDir: true,
    target: "es2020",
    sourcemap: false,
  },
});
