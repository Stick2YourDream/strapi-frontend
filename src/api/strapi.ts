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
const API_INFLIGHT_DEDUP_ENABLED = String(
  import.meta.env.VITE_API_INFLIGHT_DEDUP_ENABLED ?? "true"
)
  .trim()
  .toLowerCase() !== "false";
const API_CACHE_TTL_MS = Math.max(
  1000,
  asNumberOr(import.meta.env.VITE_API_CACHE_TTL_MS, 10000)
);
const API_CACHE_STALE_IF_ERROR_MS = Math.max(
  0,
  asNumberOr(import.meta.env.VITE_API_STALE_IF_ERROR_MS, 60000)
);
const API_CACHE_MAX_ENTRIES = Math.max(
  20,
  asNumberOr(import.meta.env.VITE_API_CACHE_MAX_ENTRIES, 250)
);
const API_CACHE_MAX_PAYLOAD_BYTES = Math.max(
  50_000,
  asNumberOr(import.meta.env.VITE_API_CACHE_MAX_PAYLOAD_BYTES, 700_000)
);
const API_UPLOAD_TIMEOUT_MS = Math.max(
  API_TIMEOUT_MS,
  asNumberOr(import.meta.env.VITE_API_UPLOAD_TIMEOUT_MS, 60000)
);
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(["ECONNABORTED", "ERR_NETWORK", "ETIMEDOUT"]);
const READ_HEAVY_ENDPOINT_RE = /^(?:api\/)?(?:users-posts|posts|group-posts|profiles)(?:\/|$)/i;
const UPLOAD_ENDPOINT_RE =
  /(?:^|\/)(?:upload|uploads|upload-media|files)(?:\/|$)/i;
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

const parseRetryAfterMs = (value: unknown) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds) && asSeconds >= 0) {
    return Math.min(10000, Math.round(asSeconds * 1000));
  }
  const dateMs = Date.parse(raw);
  if (!Number.isFinite(dateMs)) return null;
  return Math.min(10000, Math.max(0, dateMs - Date.now()));
};

const getHeaderValue = (headers: Record<string, unknown>, key: string) => {
  const lowered = key.toLowerCase();
  for (const [headerKey, headerValue] of Object.entries(headers || {})) {
    if (headerKey.toLowerCase() === lowered) {
      return String(headerValue ?? "").trim();
    }
  }
  return "";
};

const parseContentLength = (headers: Record<string, unknown>) => {
  const raw = getHeaderValue(headers, "content-length");
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const estimatePayloadBytes = (payload: unknown) => {
  if (payload == null) return 0;
  if (typeof payload === "string") {
    return new TextEncoder().encode(payload).byteLength;
  }
  if (payload instanceof Blob) {
    return payload.size;
  }
  if (payload instanceof ArrayBuffer) {
    return payload.byteLength;
  }
  if (ArrayBuffer.isView(payload)) {
    return payload.byteLength;
  }
  try {
    return new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

type RetriableRequestConfig = InternalAxiosRequestConfig & {
  __retryAttempt?: number;
  __cacheKey?: string;
  __cacheScope?: string;
  __cacheHit?: boolean;
  __inFlightKey?: string;
  __inFlightOwner?: boolean;
};

type CachedEntry = {
  expiresAt: number;
  status: number;
  statusText: string;
  headers: Record<string, unknown>;
  data: unknown;
};

type ResponseSnapshot = Omit<CachedEntry, "expiresAt">;

type InFlightRequestEntry = {
  promise: Promise<ResponseSnapshot>;
  resolve: (snapshot: ResponseSnapshot) => void;
  reject: (reason?: unknown) => void;
  startedAt: number;
};

const responseCache = new Map<string, CachedEntry>();
const inFlightRequests = new Map<string, InFlightRequestEntry>();

const toResponseSnapshot = (response: AxiosResponse): ResponseSnapshot => ({
  status: response.status,
  statusText: response.statusText,
  headers: (response.headers || {}) as Record<string, unknown>,
  data: response.data,
});

const toAxiosResponse = (
  snapshot: ResponseSnapshot,
  config: InternalAxiosRequestConfig
) =>
  ({
    data: snapshot.data,
    status: snapshot.status,
    statusText: snapshot.statusText,
    headers: snapshot.headers,
    config,
    request: undefined,
  }) as AxiosResponse;

const createInFlightEntry = (): InFlightRequestEntry => {
  let resolve: (snapshot: ResponseSnapshot) => void = () => undefined;
  let reject: (reason?: unknown) => void = () => undefined;
  const promise = new Promise<ResponseSnapshot>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  // Avoid unhandled rejection warnings when a stalled owner request is pruned.
  promise.catch(() => undefined);
  return {
    promise,
    resolve,
    reject,
    startedAt: Date.now(),
  };
};

const settleInFlightSuccess = (
  config: RetriableRequestConfig,
  snapshot: ResponseSnapshot
) => {
  if (!config.__inFlightOwner || !config.__inFlightKey) return;
  const entry = inFlightRequests.get(config.__inFlightKey);
  if (!entry) return;
  entry.resolve(snapshot);
  inFlightRequests.delete(config.__inFlightKey);
};

const settleInFlightFailure = (config: RetriableRequestConfig, reason: unknown) => {
  if (!config.__inFlightOwner || !config.__inFlightKey) return;
  const entry = inFlightRequests.get(config.__inFlightKey);
  if (!entry) return;
  entry.reject(reason);
  inFlightRequests.delete(config.__inFlightKey);
};

const clearResponseCache = () => {
  responseCache.clear();
};

const clearResponseCacheForScope = (scope: string) => {
  const prefix = `${scope}|`;
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) {
      responseCache.delete(key);
    }
  }
};

const clearInFlightRequests = () => {
  if (inFlightRequests.size === 0) return;
  for (const entry of inFlightRequests.values()) {
    entry.reject(new Error("auth-token-updated"));
  }
  inFlightRequests.clear();
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

const touchResponseCacheEntry = (key: string, entry: CachedEntry) => {
  responseCache.delete(key);
  responseCache.set(key, entry);
};

const pruneResponseCache = () => {
  if (responseCache.size === 0) return;
  const now = Date.now();
  for (const [key, entry] of responseCache.entries()) {
    const hardExpiry = entry.expiresAt + API_CACHE_STALE_IF_ERROR_MS;
    if (hardExpiry <= now) {
      responseCache.delete(key);
    }
  }
  while (responseCache.size > API_CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next();
    if (oldest.done) break;
    responseCache.delete(oldest.value);
  }
};

const isLikelyUploadRequest = (config: RetriableRequestConfig, requestPath: string) => {
  if (isIdempotentMethod(config.method)) return false;
  if (config.data instanceof FormData) return true;
  return UPLOAD_ENDPOINT_RE.test(requestPath);
};

const shouldStoreResponseInCache = (response: AxiosResponse) => {
  const headers = (response.headers || {}) as Record<string, unknown>;
  const cacheControl = getHeaderValue(headers, "cache-control").toLowerCase();
  if (cacheControl.includes("no-store") || cacheControl.includes("private")) {
    return false;
  }
  const contentLength = parseContentLength(headers);
  if (contentLength !== null) {
    return contentLength <= API_CACHE_MAX_PAYLOAD_BYTES;
  }
  const estimatedBytes = estimatePayloadBytes(response.data);
  return estimatedBytes <= API_CACHE_MAX_PAYLOAD_BYTES;
};

const pruneInFlightRequests = () => {
  if (inFlightRequests.size === 0) return;
  const now = Date.now();
  const staleAfterMs = API_TIMEOUT_MS * 2;
  for (const [key, entry] of inFlightRequests.entries()) {
    if (now - entry.startedAt > staleAfterMs) {
      entry.reject(new Error("in-flight-request-timeout"));
      inFlightRequests.delete(key);
    }
  }
};

export const setAuthToken = (token: string | null) => {
  cachedToken = normalizeToken(token);
  clearResponseCache();
  clearInFlightRequests();
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
  const requestPath = extractPath(cacheConfig);
  const tokenScope = makeTokenScope(token);
  cacheConfig.__cacheScope = tokenScope;
  if (isLikelyUploadRequest(cacheConfig, requestPath)) {
    const currentTimeout = Number(cacheConfig.timeout || API_TIMEOUT_MS);
    cacheConfig.timeout = Math.max(API_UPLOAD_TIMEOUT_MS, currentTimeout);
  }
  cacheConfig.__cacheHit = false;
  cacheConfig.__cacheKey = undefined;
  cacheConfig.__inFlightKey = undefined;
  cacheConfig.__inFlightOwner = false;
  if (API_CACHE_ENABLED && isIdempotentMethod(cacheConfig.method)) {
    const requestUri = api.getUri(cacheConfig);
    if (isReadHeavyEndpoint(requestPath, requestUri)) {
      pruneResponseCache();
      pruneInFlightRequests();
      const cacheKey = `${tokenScope}|${requestUri}`;
      cacheConfig.__cacheKey = cacheKey;
      const cached = responseCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now()) {
        touchResponseCacheEntry(cacheKey, cached);
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
      } else if (
        typeof navigator !== "undefined" &&
        navigator.onLine === false &&
        cached &&
        cached.expiresAt + API_CACHE_STALE_IF_ERROR_MS > Date.now()
      ) {
        touchResponseCacheEntry(cacheKey, cached);
        cacheConfig.__cacheHit = true;
        cacheConfig.adapter = async () =>
          ({
            data: cached.data,
            status: cached.status,
            statusText: cached.statusText,
            headers: {
              ...(cached.headers || {}),
              "x-ysp-offline-cache": "1",
            },
            config: cacheConfig,
            request: undefined,
          }) as AxiosResponse;
      } else if (API_INFLIGHT_DEDUP_ENABLED) {
        const existingInFlight = inFlightRequests.get(cacheKey);
        if (existingInFlight) {
          cacheConfig.__inFlightKey = cacheKey;
          cacheConfig.adapter = async () => {
            const snapshot = await existingInFlight.promise;
            return toAxiosResponse(snapshot, cacheConfig);
          };
        } else {
          const inFlightEntry = createInFlightEntry();
          inFlightRequests.set(cacheKey, inFlightEntry);
          cacheConfig.__inFlightKey = cacheKey;
          cacheConfig.__inFlightOwner = true;
        }
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
      if (
        API_CACHE_ENABLED &&
        config.__cacheKey &&
        !config.__cacheHit &&
        shouldStoreResponseInCache(response)
      ) {
        responseCache.set(config.__cacheKey, {
          expiresAt: Date.now() + API_CACHE_TTL_MS,
          status: response.status,
          statusText: response.statusText,
          headers: (response.headers || {}) as Record<string, unknown>,
          data: response.data,
        });
        pruneResponseCache();
      }
      settleInFlightSuccess(config, toResponseSnapshot(response));
    } else {
      clearResponseCacheForScope(config.__cacheScope || "anon");
    }

    return response;
  },
  async (error) => {
    const config = (error?.config || null) as RetriableRequestConfig | null;
    if (!config || !isIdempotentMethod(config.method)) {
      return Promise.reject(error);
    }
    const isCanceledRequest =
      config.signal?.aborted === true ||
      String(error?.code || "").toUpperCase() === "ERR_CANCELED" ||
      String(error?.name || "").toLowerCase() === "cancelederror";
    if (isCanceledRequest) {
      settleInFlightFailure(config, error);
      return Promise.reject(error);
    }

    const toStaleCacheFallback = () => {
      if (!API_CACHE_ENABLED || API_CACHE_STALE_IF_ERROR_MS <= 0) return null;
      if (!config.__cacheKey) return null;
      const cached = responseCache.get(config.__cacheKey);
      if (!cached) return null;
      if (cached.expiresAt + API_CACHE_STALE_IF_ERROR_MS <= Date.now()) return null;
      return {
        status: cached.status,
        statusText: cached.statusText,
        headers: {
          ...(cached.headers || {}),
          "x-ysp-stale-cache": "1",
        },
        data: cached.data,
      } as ResponseSnapshot;
    };

    const status = Number(error?.response?.status || 0);
    const code = String(error?.code || "");
    const retryable =
      RETRYABLE_STATUS_CODES.has(status) ||
      RETRYABLE_ERROR_CODES.has(code) ||
      !error?.response;

    if (!retryable) {
      const staleSnapshot = toStaleCacheFallback();
      if (staleSnapshot) {
        settleInFlightSuccess(config, staleSnapshot);
        return toAxiosResponse(staleSnapshot, config);
      }
      settleInFlightFailure(config, error);
      return Promise.reject(error);
    }

    const attempt = Number(config.__retryAttempt || 0) + 1;
    if (attempt > API_RETRY_MAX) {
      const staleSnapshot = toStaleCacheFallback();
      if (staleSnapshot) {
        settleInFlightSuccess(config, staleSnapshot);
        return toAxiosResponse(staleSnapshot, config);
      }
      settleInFlightFailure(config, error);
      return Promise.reject(error);
    }

    config.__retryAttempt = attempt;
    const retryAfterRaw =
      error?.response?.headers?.["retry-after"] ??
      error?.response?.headers?.["Retry-After"];
    const retryAfterDelayMs = parseRetryAfterMs(retryAfterRaw);
    const delay = Math.max(getRetryDelayMs(attempt), retryAfterDelayMs ?? 0);
    await sleep(delay);
    return api.request(config);
  }
);

const initialToken = resolveToken();
if (initialToken) {
  api.defaults.headers.common.Authorization = `Bearer ${initialToken}`;
}

export default api;
