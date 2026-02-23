export const resolveAgeVerifyApiBase = () => {
  const envValue = String(import.meta.env.VITE_AGE_VERIFY_API_URL || "").trim();
  if (envValue) return envValue.replace(/\/+$/, "");
  const apiBase = String(import.meta.env.VITE_API_URL || "").trim();
  if (apiBase) return `${apiBase.replace(/\/+$/, "")}/age-verify`;
  if (typeof window !== "undefined") {
    return `${window.location.origin}/api/age-verify`;
  }
  return "http://localhost:1337/api/age-verify";
};

export const resolveAgeVerifyPublicUrl = () => {
  const envValue = String(import.meta.env.VITE_AGE_VERIFY_PUBLIC_URL || "").trim();
  if (typeof window === "undefined") {
    return envValue.replace(/\/+$/, "");
  }
  const host = window.location.hostname;
  const cleaned = envValue.replace(/\/+$/, "");
  if (!cleaned) {
    return `${window.location.origin}/age-verify`;
  }
  if (cleaned.startsWith("/")) {
    return `${window.location.origin}${cleaned}`;
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
      return parsed.toString();
    }
    return parsed.toString();
  } catch {
    if (host && host !== "localhost" && host !== "127.0.0.1") {
      if (cleaned.includes("localhost")) return cleaned.replace("localhost", host);
      if (cleaned.includes("127.0.0.1")) return cleaned.replace("127.0.0.1", host);
    }
    return cleaned;
  }
};

export const AGE_VERIFY_API_BASE = resolveAgeVerifyApiBase();
export const AGE_VERIFY_PUBLIC_URL = resolveAgeVerifyPublicUrl();
