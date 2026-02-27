const AGE_VERIFY_PUBLIC_PATH = String(
  import.meta.env.VITE_AGE_VERIFY_BASE_PATH || "/age-verify"
)
  .trim()
  .replace(/\/+$/, "") || "/age-verify";

const trimTrailingSlash = (value: string) => value.trim().replace(/\/+$/, "");

const normalizePublicPath = (value: string) => {
  const trimmed = trimTrailingSlash(value);
  if (!trimmed || trimmed === "/") return AGE_VERIFY_PUBLIC_PATH;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

export const resolveAgeVerifyApiBase = () => {
  const envValue = String(import.meta.env.VITE_AGE_VERIFY_API_URL || "").trim();
  if (envValue) return trimTrailingSlash(envValue);
  const apiBase = String(import.meta.env.VITE_API_URL || "").trim();
  if (apiBase) return `${trimTrailingSlash(apiBase)}/age-verify`;
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/age-verify`;
  }
  return "http://localhost:1337/api/age-verify";
};

export const resolveAgeVerifyPublicUrl = () => {
  const envValue = String(import.meta.env.VITE_AGE_VERIFY_PUBLIC_URL || "").trim();
  if (typeof window === "undefined") {
    return trimTrailingSlash(envValue);
  }

  const host = window.location.hostname;
  const cleaned = trimTrailingSlash(envValue);
  if (!cleaned) {
    return `${window.location.origin}${AGE_VERIFY_PUBLIC_PATH}`;
  }
  if (cleaned.startsWith("/")) {
    return `${window.location.origin}${normalizePublicPath(cleaned)}`;
  }

  try {
    const parsed = new URL(cleaned);
    const isLocalHost =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    const isCurrentLocal =
      host === "localhost" || host === "127.0.0.1" || host === "";

    if (isLocalHost && !isCurrentLocal) {
      parsed.protocol = window.location.protocol;
      parsed.hostname = window.location.hostname;
      parsed.port = window.location.port;
    }

    const normalizedPath = normalizePublicPath(parsed.pathname || "");
    if (parsed.hostname === window.location.hostname && parsed.pathname !== normalizedPath) {
      parsed.pathname = normalizedPath;
    }
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    const normalizedPath = normalizePublicPath(cleaned);
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      if (normalizedPath.includes("localhost")) {
        return normalizedPath.replace("localhost", host);
      }
      if (normalizedPath.includes("127.0.0.1")) {
        return normalizedPath.replace("127.0.0.1", host);
      }
    }
    if (normalizedPath.startsWith("/")) {
      return `${window.location.origin}${normalizedPath}`;
    }
    return normalizedPath;
  }
};

export const isAgeVerifyMobileClient = () => {
  if (typeof window === "undefined") return false;
  const userAgent = String(window.navigator.userAgent || "");
  const mobileUa = /android|iphone|ipad|ipod|iemobile|opera mini|mobile/i.test(userAgent);
  const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;
  const narrowViewport = window.matchMedia?.("(max-width: 900px)")?.matches ?? false;
  return mobileUa || (coarsePointer && narrowViewport);
};

export const launchAgeVerifyIfMobile = (url: string | null | undefined) => {
  if (!url || typeof window === "undefined") return false;
  if (!isAgeVerifyMobileClient()) return false;
  window.location.assign(url);
  return true;
};

export const AGE_VERIFY_API_BASE = resolveAgeVerifyApiBase();
export const AGE_VERIFY_PUBLIC_URL = resolveAgeVerifyPublicUrl();
