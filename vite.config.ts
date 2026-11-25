import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  define: { __ZMUSICSTATS_UI_PREVIEW__: JSON.stringify(process.env.ZMUSICSTATS_UI_PREVIEW === "true"), __ZMUSICSTATS_LOCAL_REPORTS__: JSON.stringify(process.env.ZMUSICSTATS_CLOUD === "true") },
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      deny: [".env", ".env.*", "*.{crt,pem,p8,key}", "**/.git/**", "**/.auth-state/**", "**/work/**"],
    },
    proxy: { "/api": { target: "http://127.0.0.1:8787", changeOrigin: false } },
  },
  build: { target: ["es2022", "safari16"], sourcemap: false },
});
