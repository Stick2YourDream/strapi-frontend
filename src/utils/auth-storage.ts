export const getStoredToken = () => {
  if (typeof window === "undefined") return "";
  try {
    const token =
      window.localStorage.getItem("token") ||
      window.sessionStorage.getItem("token") ||
      "";
    const trimmed = token.trim();
    if (!trimmed) return "";
    const lowered = trimmed.toLowerCase();
    if (lowered === "null" || lowered === "undefined") return "";
    return lowered.startsWith("bearer ")
      ? trimmed.slice(7).trim()
      : trimmed;
  } catch {
    return "";
  }
};

export const getStoredExpiresAt = () => {
  if (typeof window === "undefined") return 0;
  try {
    const raw =
      window.localStorage.getItem("expiresAt") ||
      window.sessionStorage.getItem("expiresAt") ||
      "";
    const lowered = raw.trim().toLowerCase();
    if (!lowered || lowered === "null" || lowered === "undefined") return 0;
    const value = Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
};
