import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const devPort = Number(env.VITE_DEV_PORT || 5173);

  return {
    plugins: [react()],
    server: {
      host: "localhost",
      // allowedHosts: ["testing.yoursocialplace.com"],
      port: Number.isFinite(devPort) ? devPort : 5173,
      strictPort: true,
    },
  };
});
