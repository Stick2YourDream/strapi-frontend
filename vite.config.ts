import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devPort = Number(env.VITE_DEV_PORT || 5174);
  const proxyTarget = env.VITE_API_PROXY_TARGET || "http://localhost:1337";

  return {
    plugins: [react(), basicSsl()],
    server: {
      host: true,
      // allowedHosts: ["testing.yoursocialplace.com"],
      port: Number.isFinite(devPort) ? devPort : 5174,
      strictPort: true,
      https: {},
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
        },
        "/socket.io": {
          target: proxyTarget,
          changeOrigin: true,
          ws: true,
          secure: false,
        },
      },
    },
  };
});
