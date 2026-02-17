const DEVICE_ID_KEY = "trustedDeviceId";
let cachedDeviceId: string | null = null;

const createDeviceId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

export const getOrCreateDeviceId = () => {
  if (cachedDeviceId) return cachedDeviceId;
  if (typeof window === "undefined") {
    const created = createDeviceId();
    cachedDeviceId = created;
    return created;
  }
  const readFrom = (storage: Storage | null | undefined) => {
    if (!storage) return "";
    try {
      return storage.getItem(DEVICE_ID_KEY) || "";
    } catch {
      return "";
    }
  };
  const writeTo = (storage: Storage | null | undefined, value: string) => {
    if (!storage) return false;
    try {
      storage.setItem(DEVICE_ID_KEY, value);
      return true;
    } catch {
      return false;
    }
  };
  const existing =
    readFrom(window.localStorage) || readFrom(window.sessionStorage);
  if (existing && existing.trim().length > 0) {
    // Keep both storages in sync when possible.
    writeTo(window.localStorage, existing);
    writeTo(window.sessionStorage, existing);
    cachedDeviceId = existing;
    return existing;
  }
  const created = createDeviceId();
  writeTo(window.localStorage, created);
  writeTo(window.sessionStorage, created);
  cachedDeviceId = created;
  return created;
};
