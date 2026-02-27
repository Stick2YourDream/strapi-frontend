// src/api/strapi.ts
import axios, {
  type AxiosRequestHeaders,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";

let cachedToken: string | null = null;
const resolveApiBase = () => {
  const raw = String(import.meta.env.VITE_API_URL || "").trim();
  if (typeof window === "undefined") {
    return raw || "http://localhost:1337/api";
  }
  if (!raw) return "/api";
  const host = window.location.hostname;
  const isLocalHost = host === "localhost" || host === "127.0.0.1";
  const isLocalTarget = /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?/i.test(raw);
  if (isLocalTarget && !isLocalHost) return "/api";
  return raw;
};
const apiBaseRaw = resolveApiBase();
const apiBaseNormalized = apiBaseRaw.replace(/\/+$/, "");
const asNumberOr = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const API_TIMEOUT_MS = Math.max(5000, asNumberOr(import.meta.env.VITE_API_TIMEOUT_MS, 20000));
const API_RETRY_MAX = Math.max(0, asNumberOr(import.meta.env.VITE_API_RETRY_MAX, 2));
const API_RETRY_BASE_DELAY_MS = Math.max(
  100,
  asNumberOr(import.meta.env.VITE_API_RETRY_BASE_DELAY_MS, 350)
);
const API_CACHE_ENABLED = String(import.meta.env.VITE_API_CACHE_ENABLED ?? "true")
  .trim()
  .toLowerCase() !== "false";
const API_CACHE_TTL_MS = Math.max(
  1000,
  asNumberOr(import.meta.env.VITE_API_CACHE_TTL_MS, 10000)
);
const API_CACHE_MAX_ENTRIES = Math.max(
  20,
  asNumberOr(import.meta.env.VITE_API_CACHE_MAX_ENTRIES, 250)
);
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(["ECONNABORTED", "ERR_NETWORK", "ETIMEDOUT"]);
const READ_HEAVY_ENDPOINT_RE = /^(?:api\/)?(?:users-posts|posts|group-posts|profiles)(?:\/|$)/i;
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
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === "null" || lowered === "undefined") return null;
  return lowered.startsWith("bearer ")
    ? trimmed.slice(7).trim()
    : trimmed;
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

const isAuthDebugEnabled = () => {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("authDebug") !== "1") return false;
  try {
    const raw =
      window.localStorage.getItem("user") || window.sessionStorage.getItem("user");
    const parsed = raw ? (JSON.parse(raw) as { appRole?: string } | null) : null;
    return parsed?.appRole === "admin";
  } catch {
    return false;
  }
};

const logAuthDebug = (config: InternalAxiosRequestConfig, hasAuth: boolean) => {
  if (!isAuthDebugEnabled()) return;
  const base = String(config.baseURL || "");
  const url = String(config.url || "");
  const fullUrl = base && url ? `${base.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}` : url || base;
  console.debug("[auth-debug] request", {
    url: fullUrl || "n/a",
    hasAuth,
  });
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

const sleep = (ms: number) =>
  new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));

const isIdempotentMethod = (method?: string) => {
  const normalized = String(method || "get").trim().toUpperCase();
  return normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS";
};

const getRetryDelayMs = (attempt: number) => {
  const jitter = Math.floor(Math.random() * 120);
  const exponential = API_RETRY_BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(3000, exponential + jitter);
};

type RetriableRequestConfig = InternalAxiosRequestConfig & {
  __retryAttempt?: number;
  __cacheKey?: string;
  __cacheHit?: boolean;
};

type CachedEntry = {
  expiresAt: number;
  status: number;
  statusText: string;
  headers: Record<string, unknown>;
  data: unknown;
};

const responseCache = new Map<string, CachedEntry>();

const clearResponseCache = () => {
  responseCache.clear();
};

const isReadHeavyEndpoint = (path: string, url: string) => {
  const normalizedPath = String(path || "").replace(/^\/+/, "");
  if (READ_HEAVY_ENDPOINT_RE.test(normalizedPath)) return true;
  const loweredUrl = String(url || "").toLowerCase();
  if (
    loweredUrl.includes("search=") ||
    loweredUrl.includes("?q=") ||
    loweredUrl.includes("&q=")
  ) {
    return true;
  }
  return false;
};

const makeTokenScope = (token: string | null) =>
  token ? `user:${token.slice(-16)}` : "anon";

const pruneResponseCache = () => {
  if (responseCache.size === 0) return;
  const now = Date.now();
  for (const [key, entry] of responseCache.entries()) {
    if (entry.expiresAt <= now) {
      responseCache.delete(key);
    }
  }
  while (responseCache.size > API_CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next();
    if (oldest.done) break;
    responseCache.delete(oldest.value);
  }
};

export const setAuthToken = (token: string | null) => {
  cachedToken = normalizeToken(token);
  clearResponseCache();
  if (cachedToken) {
    api.defaults.headers.common.Authorization = `Bearer ${cachedToken}`;
  } else {
    delete api.defaults.headers.common.Authorization;
  }
};

const api = axios.create({
  baseURL: apiBaseRaw,
  timeout: API_TIMEOUT_MS,
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
    logAuthDebug(config, true);
  } else if (headers) {
    if (typeof headers.delete === "function") headers.delete("Authorization");
    else delete headers.Authorization;
    logAuthDebug(config, false);
  }

  const cacheConfig = config as RetriableRequestConfig;
  cacheConfig.__cacheHit = false;
  cacheConfig.__cacheKey = undefined;
  if (API_CACHE_ENABLED && isIdempotentMethod(cacheConfig.method)) {
    const requestPath = extractPath(cacheConfig);
    const requestUri = api.getUri(cacheConfig);
    if (isReadHeavyEndpoint(requestPath, requestUri)) {
      pruneResponseCache();
      const tokenScope = makeTokenScope(token);
      const cacheKey = `${tokenScope}|${requestUri}`;
      cacheConfig.__cacheKey = cacheKey;
      const cached = responseCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        cacheConfig.__cacheHit = true;
        cacheConfig.adapter = async () =>
          ({
            data: cached.data,
            status: cached.status,
            statusText: cached.statusText,
            headers: cached.headers,
            config: cacheConfig,
            request: undefined,
          }) as AxiosResponse;
      }
    }
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

api.interceptors.response.use(
  (response) => {
    const config = (response?.config || null) as RetriableRequestConfig | null;
    if (!config) return response;

    if (isIdempotentMethod(config.method)) {
      if (API_CACHE_ENABLED && config.__cacheKey && !config.__cacheHit) {
        responseCache.set(config.__cacheKey, {
          expiresAt: Date.now() + API_CACHE_TTL_MS,
          status: response.status,
          statusText: response.statusText,
          headers: (response.headers || {}) as Record<string, unknown>,
          data: response.data,
        });
        pruneResponseCache();
      }
    } else {
      clearResponseCache();
    }

    return response;
  },
  async (error) => {
    const config = (error?.config || null) as RetriableRequestConfig | null;
    if (!config || API_RETRY_MAX <= 0 || !isIdempotentMethod(config.method)) {
      return Promise.reject(error);
    }

    const status = Number(error?.response?.status || 0);
    const code = String(error?.code || "");
    const retryable =
      RETRYABLE_STATUS_CODES.has(status) ||
      RETRYABLE_ERROR_CODES.has(code) ||
      !error?.response;

    if (!retryable) {
      return Promise.reject(error);
    }

    const attempt = Number(config.__retryAttempt || 0) + 1;
    if (attempt > API_RETRY_MAX) {
      return Promise.reject(error);
    }

    config.__retryAttempt = attempt;
    const delay = getRetryDelayMs(attempt);
    await sleep(delay);
    return api.request(config);
  }
);

const initialToken = resolveToken();
if (initialToken) {
  api.defaults.headers.common.Authorization = `Bearer ${initialToken}`;
}

export default api;
