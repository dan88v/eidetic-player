import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { defineConfig } from "vite";

const outputDirectory = resolve(import.meta.dirname, "../../dist/ui");

export default defineConfig({
  root: resolve(import.meta.dirname),
  envDir: resolve(import.meta.dirname, "../.."),
  plugins: [
    {
      name: "bundle-open-sans-license",
      async writeBundle() {
        const licenseDirectory = resolve(outputDirectory, "licenses");
        await mkdir(licenseDirectory, { recursive: true });
        await copyFile(
          resolve(import.meta.dirname, "src/assets/fonts/OFL.txt"),
          resolve(licenseDirectory, "OpenSans-OFL.txt"),
        );
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:4310",
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
  },
  build: {
    outDir: outputDirectory,
    emptyOutDir: true,
    target: "es2020",
  },
});
