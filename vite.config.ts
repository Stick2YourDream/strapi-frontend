import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devPort = Number(env.VITE_DEV_PORT || 5173);
  const appMode = String(env.VITE_APP_MODE || "").toLowerCase();
  const isVideoApp = appMode === "video";
  const entryHtml = isVideoApp ? "video.html" : "index.html";

  return {
    plugins: [react()],
    server: {
      host: "localhost",
      // allowedHosts: ["testing.yoursocialplace.com"],
      port: Number.isFinite(devPort) ? devPort : 5173,
      strictPort: true,
    },
    build: {
      outDir: isVideoApp ? "dist-video" : "dist",
      rollupOptions: {
        input: resolve(process.cwd(), entryHtml),
      },
    },
  };
});
