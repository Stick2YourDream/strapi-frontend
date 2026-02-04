// src/api/strapi.ts
import axios, {
  type AxiosRequestHeaders,
  type InternalAxiosRequestConfig,
} from "axios";

let cachedToken: string | null = null;
const apiBaseRaw = String(import.meta.env.VITE_API_URL || "").trim();
const apiBaseNormalized = apiBaseRaw.replace(/\/+$/, "");
const publicAuthEndpoints = new Set([
  "auth/local",
  "auth/login",
  "auth/login/verify",
  "auth/login/resend",
  "auth/email/confirm/verify",
  "auth/email/confirm/resend",
  "auth/sms/send",
  "auth/forgot-password",
  "auth/reset-password",
  "register",
]);

const normalizeToken = (token?: string | null) => {
  const trimmed = token?.trim();
  return trimmed ? trimmed : null;
};

const safeGetStorage = (storage: Storage | null | undefined, key: string) => {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const resolveToken = () => {
  if (cachedToken) return cachedToken;
  if (typeof window === "undefined") return null;
  return (
    normalizeToken(safeGetStorage(window.localStorage, "token")) ||
    normalizeToken(safeGetStorage(window.sessionStorage, "token"))
  );
};

const extractPath = (config: InternalAxiosRequestConfig) => {
  const url = String(config.url || "").trim();
  const baseUrl = String(config.baseURL || "").trim();
  if (!url && !baseUrl) return "";
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      return new URL(url).pathname.replace(/^\/+/, "");
    } catch {
      return url.replace(/^\/+/, "");
    }
  }
  if (baseUrl && url) {
    try {
      return new URL(url, baseUrl).pathname.replace(/^\/+/, "");
    } catch {
      return url.replace(/^\/+/, "");
    }
  }
  return url.replace(/^\/+/, "");
};

const isPublicEndpoint = (path: string) => {
  if (!path) return false;
  if (publicAuthEndpoints.has(path)) return true;
  if (path.startsWith("news")) return true;
  return false;
};

const shouldAttachAuth = (config: InternalAxiosRequestConfig) => {
  const url = String(config.url || "").trim();
  const baseUrl = String(config.baseURL || "").trim();
  if (apiBaseNormalized) {
    if (baseUrl && baseUrl.startsWith(apiBaseNormalized)) return true;
    if (url.startsWith(apiBaseNormalized)) return true;
    if (baseUrl && url) {
      try {
        const full = new URL(url, baseUrl).toString();
        if (full.startsWith(apiBaseNormalized)) return true;
      } catch {
        // ignore URL errors
      }
    }
  }
  return url.startsWith("/api") || url.startsWith("api/");
};

export const setAuthToken = (token: string | null) => {
  cachedToken = normalizeToken(token);
  if (cachedToken) {
    api.defaults.headers.common.Authorization = `Bearer ${cachedToken}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
};

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

  const token = resolveToken();
  const url = config.url || "";
  const path = url.split("?")[0].replace(/^\/+/, "");
  const isPublic = isPublicEndpoint(path);

  const headers = (config.headers ??
    {}) as AxiosRequestHeaders & { [key: string]: any };
  config.headers = headers;
  if (token && !isPublic) {
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

axios.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (!shouldAttachAuth(config)) return config;
  const path = extractPath(config);
  if (isPublicEndpoint(path)) return config;
  const token = resolveToken();
  if (!token) return config;
  const headers = (config.headers ?? {}) as AxiosRequestHeaders & { [key: string]: any };
  config.headers = headers;
  if (typeof headers.set === "function") {
    headers.set("Authorization", `Bearer ${token}`);
  } else {
    headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

const initialToken = resolveToken();
if (initialToken) {
  api.defaults.headers.common.Authorization = `Bearer ${initialToken}`;
}

export default api;
