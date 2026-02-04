export const getStoredToken = () => {
  if (typeof window === "undefined") return "";
  const token =
    window.localStorage.getItem("token") ||
    window.sessionStorage.getItem("token") ||
    "";
  return token.trim();
};

export const getStoredExpiresAt = () => {
  if (typeof window === "undefined") return 0;
  const raw =
    window.localStorage.getItem("expiresAt") ||
    window.sessionStorage.getItem("expiresAt") ||
    "";
  const value = Number(raw);
  return Number.isFinite(value) ? value : 0;
};
