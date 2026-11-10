import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite config. In dev, proxy /api to the backend so the SPA and API share an
 * origin (no CORS, cookies/headers pass through). In production the frontend
 * container serves the built static files and proxies /api to the backend.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.BACKEND_URL || "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: { outDir: "dist" },
});
