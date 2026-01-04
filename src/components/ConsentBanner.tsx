import { useEffect, useMemo, useState } from "react";
import api from "../api/strapi";
import "../css/consent.css";

type ConsentSettings = {
  enabled?: boolean;
  title?: string;
  message?: string;
  acceptText?: string;
  rejectText?: string;
};

type ConsentState = {
  status: "granted" | "denied";
  ts: number;
};

const STORAGE_KEY = "s2yd_consent_v1";

const DEFAULT_COPY: Required<Pick<ConsentSettings, "title" | "message" | "acceptText" | "rejectText">> = {
  title: "We value your privacy",
  message:
    "We use cookies and similar technologies to personalize your experience and measure site usage. You can accept or decline analytics storage.",
  acceptText: "Accept",
  rejectText: "Reject",
};

const readStoredConsent = (): ConsentState | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    if (parsed?.status === "granted" || parsed?.status === "denied") {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
};

const persistConsent = (status: "granted" | "denied") => {
  if (typeof window === "undefined") return;
  const payload: ConsentState = { status, ts: Date.now() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
};

const pushGtag = (...args: any[]) => {
  if (typeof window === "undefined") return;
  const w = window as any;
  w.dataLayer = w.dataLayer || [];
  if (typeof w.gtag === "function") {
    w.gtag(...args);
  } else {
    w.dataLayer.push(args);
  }
};

const applyConsent = (status: "granted" | "denied") => {
  pushGtag("consent", "update", {
    analytics_storage: status,
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
};

export default function ConsentBanner() {
  const [settings, setSettings] = useState<ConsentSettings | null>(null);
  const [consent, setConsent] = useState<ConsentState | null>(null);

  useEffect(() => {
    const stored = readStoredConsent();
    if (stored) {
      setConsent(stored);
      applyConsent(stored.status);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const loadSettings = async () => {
      try {
        const res = await api.get("/consent-banner");
        const data = res.data?.data;
        const attrs = data?.attributes ?? data ?? {};
        if (active) setSettings(attrs as ConsentSettings);
      } catch {
        if (active) setSettings(null);
      }
    };
    loadSettings();
    return () => {
      active = false;
    };
  }, []);

  const copy = useMemo(
    () => ({
      title: settings?.title?.trim() || DEFAULT_COPY.title,
      message: settings?.message?.trim() || DEFAULT_COPY.message,
      acceptText: settings?.acceptText?.trim() || DEFAULT_COPY.acceptText,
      rejectText: settings?.rejectText?.trim() || DEFAULT_COPY.rejectText,
    }),
    [settings]
  );

  const enabled = settings?.enabled !== false;
  const shouldShow = enabled && !consent;

  if (!shouldShow) return null;

  const handleChoice = (status: "granted" | "denied") => {
    persistConsent(status);
    applyConsent(status);
    setConsent({ status, ts: Date.now() });
  };

  return (
    <div className="consent-banner" role="dialog" aria-live="polite">
      <div className="consent-banner__body">
        <div className="consent-banner__content">
          <p className="consent-banner__title">{copy.title}</p>
          <p className="consent-banner__message">{copy.message}</p>
          <div className="consent-banner__links">
            <a href="/privacy">Privacy</a>
            <a href="/cookies">Cookie Policy</a>
            <a href="/cookies#preferences">Manage cookies</a>
          </div>
        </div>
        <div className="consent-banner__actions">
          <button className="btn ghost" type="button" onClick={() => handleChoice("denied")}>
            {copy.rejectText}
          </button>
          <button className="btn primary" type="button" onClick={() => handleChoice("granted")}>
            {copy.acceptText}
          </button>
        </div>
      </div>
    </div>
  );
}
