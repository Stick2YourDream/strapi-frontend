type AnalyticsValue = string | number | boolean;
type AnalyticsParams = Record<string, AnalyticsValue | null | undefined>;

const CONSENT_STORAGE_KEY = "s2yd_consent_v1";

const toConsentGranted = () => {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { status?: string } | null;
    return parsed?.status === "granted";
  } catch {
    return false;
  }
};

const normalizeParams = (params: AnalyticsParams = {}) => {
  return Object.entries(params).reduce<Record<string, AnalyticsValue>>((acc, [key, value]) => {
    if (value === null || value === undefined) return acc;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      acc[key] = value;
    }
    return acc;
  }, {});
};

export const trackEvent = (eventName: string, params?: AnalyticsParams) => {
  if (typeof window === "undefined") return;
  if (!toConsentGranted()) return;

  const safeName = String(eventName || "").trim();
  if (!safeName) return;

  const payload = normalizeParams(params);
  const target = window as Window & {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  };

  if (typeof target.gtag === "function") {
    target.gtag("event", safeName, payload);
    return;
  }

  target.dataLayer = target.dataLayer || [];
  target.dataLayer.push(["event", safeName, payload]);
};
