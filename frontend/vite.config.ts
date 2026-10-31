/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Bind-mounted volumes (as used by the dev container) don't always
      // deliver filesystem change events, so fall back to polling.
      usePolling: true,
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    unstubGlobals: true,
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
  },
});
