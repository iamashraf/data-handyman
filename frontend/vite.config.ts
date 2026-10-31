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
    // Dev-only proxy so the Vite dev server and the backend can be explored
    // together without CORS wiring. Not part of any plan task; local
    // exploration convenience only. Target is configurable since it differs
    // between an ad hoc manual run (host.containers.internal:<port>) and a
    // future compose-based run (the backend service's name on the compose
    // network, e.g. http://backend:8000).
    proxy: {
      "/templates": process.env.VITE_DEV_PROXY_TARGET ?? "http://backend:8000",
      "/records": process.env.VITE_DEV_PROXY_TARGET ?? "http://backend:8000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    unstubGlobals: true,
    include: ["tests/**/*.{test,spec}.{ts,tsx}"],
  },
});
