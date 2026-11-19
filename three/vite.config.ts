import { defineConfig } from "vite";

// The page as a player gets it: a production build, its assets beside it.
export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  build: { outDir: "dist", emptyOutDir: true, target: "esnext", assetsInlineLimit: 0, chunkSizeWarningLimit: 4096 },
  server: { fs: { allow: [".."] } },
});
