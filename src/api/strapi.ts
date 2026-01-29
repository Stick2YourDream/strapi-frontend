// src/api/strapi.ts
import axios, {
  type AxiosRequestHeaders,
  type InternalAxiosRequestConfig,
} from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL, // http://localhost:1337/api
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const baseUrl = String(config.baseURL || "").trim();
  const rawUrl = String(config.url || "").trim();
  if (baseUrl && /\/api\/?$/i.test(baseUrl) && rawUrl.startsWith("/")) {
    // Keep /api prefix when callers use leading slashes in endpoints.
    config.url = rawUrl.replace(/^\/+/, "");
  }

  const token = localStorage.getItem("token");
  const url = config.url || "";
  const path = url.split("?")[0];
  const publicAuthEndpoints = new Set([
    "/auth/local",
    "/auth/login",
    "/auth/login/verify",
    "/auth/login/resend",
    "/auth/email/confirm/verify",
    "/auth/email/confirm/resend",
    "/auth/sms/send",
    "/auth/forgot-password",
    "/auth/reset-password",
    "/register",
  ]);
  const isPublicEndpoint = publicAuthEndpoints.has(path) || path.startsWith("/news");

  const headers = (config.headers ??
    {}) as AxiosRequestHeaders & { [key: string]: any };
  config.headers = headers;
  if (token && !isPublicEndpoint) {
    if (typeof headers.set === "function") {
      headers.set("Authorization", `Bearer ${token}`);
    } else {
      headers.Authorization = `Bearer ${token}`;
    }
  } else if (headers) {
    if (typeof headers.delete === "function") headers.delete("Authorization");
    else delete headers.Authorization;
  }

  return config;
});

export default api;
