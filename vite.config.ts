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

  const devHost = String(env.VITE_DEV_HOST || "localhost").trim() || "localhost";
  const manualChunks = (id: string) => {
    if (!id.includes("node_modules")) return undefined;
    if (
      id.includes("@mediapipe/tasks-vision") ||
      id.includes("@mediapipe/selfie_segmentation")
    ) {
      return "vendor-mediapipe";
    }
    if (id.includes("react-router-dom") || id.includes("react-router")) {
      return "vendor-router";
    }
    if (id.includes("socket.io-client")) {
      return "vendor-realtime";
    }
    if (id.includes("axios")) {
      return "vendor-http";
    }
    if (id.includes("lucide-react") || id.includes("@fortawesome/")) {
      return "vendor-ui";
    }
    if (id.includes("@giphy/")) {
      return "vendor-giphy";
    }
    if (id.includes("jspdf")) {
      return "vendor-export";
    }
    return "vendor";
  };

  return {
    plugins: [react()],
    server: {
      host: devHost,
      // allowedHosts: ["testing.yoursocialplace.com"],
      allowedHosts: [
        "testing.yoursocialplace.com",
        "testing.jasonhouse.net",
        "jasonhouse.net",
        "www.jasonhouse.net",
        "strapi.jasonhouse.net",
        "production.jasonhouse.net",
      ],
      port: Number.isFinite(devPort) ? devPort : 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: "http://localhost:1337",
          changeOrigin: true,
          secure: false,
        },
        "/uploads": {
          target: "http://localhost:1337",
          changeOrigin: true,
          secure: false,
        },
        "/socket.io": {
          target: "http://localhost:1337",
          changeOrigin: true,
          secure: false,
          ws: true,
        },
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
        output: {
          manualChunks,
        },
      },
    },
  };
});
