import { defineConfig, loadEnv } from "vite";
import { resolve } from "path";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devPort = Number(env.VITE_DEV_PORT || 5173);
  const appMode = String(env.VITE_APP_MODE || "").toLowerCase();
  const isVideoApp = mode === "video" || appMode === "video";
  const entryHtml = isVideoApp ? "video.html" : "index.html";
  const newsTargetRaw =
    env.VITE_NEWS_PROXY_TARGET ||
    env.NEWS_API_URL ||
    env.VITE_NEWS_API_URL ||
    "https://newsapp_backend.rousehouse.net";
  const newsTarget = /^https?:\/\//i.test(newsTargetRaw)
    ? newsTargetRaw
    : "https://newsapp_backend.rousehouse.net";
  const newsKey = env.NEWS_API_KEY || env.VITE_NEWS_API_KEY;

  return {
    plugins: [react()],
    server: {
      host: "localhost",
      // allowedHosts: ["testing.yoursocialplace.com"],
      port: Number.isFinite(devPort) ? devPort : 5173,
      strictPort: true,
      proxy: {
        "/news-proxy": {
          target: newsTarget,
          changeOrigin: true,
          secure: true,
          rewrite: (path) => path.replace(/^\/news-proxy/, ""),
          headers: newsKey ? { Authorization: `Bearer ${newsKey}` } : undefined,
        },
      },
    },
    build: {
      outDir: isVideoApp ? "dist-video" : "dist",
      rollupOptions: {
        input: resolve(process.cwd(), entryHtml),
      },
    },
  };
});
