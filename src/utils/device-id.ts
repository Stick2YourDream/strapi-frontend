const DEVICE_ID_KEY = "trustedDeviceId";

const createDeviceId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const getOrCreateDeviceId = () => {
  if (typeof window === "undefined" || !window.localStorage) {
    return createDeviceId();
  }
  const existing = window.localStorage.getItem(DEVICE_ID_KEY);
  if (existing && existing.trim().length > 0) {
    return existing;
  }
  const created = createDeviceId();
  window.localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
};
