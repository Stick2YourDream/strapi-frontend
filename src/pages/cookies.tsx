import "../css/terms.css";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "../i18n/TranslationProvider";
import { usePageMeta } from "../hooks/usePageMeta";

type ConsentState = {
  status: "granted" | "denied";
  ts: number;
};

const STORAGE_KEY = "s2yd_consent_v1";

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

const formatTimestamp = (
  value: number | undefined,
  locale: string,
  t: (key: string) => string
) => {
  if (!value) return t("Not set yet.");
  try {
    return new Intl.DateTimeFormat(locale || "en", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return t("Recently updated.");
  }
};

export default function Cookies() {
  const navigate = useNavigate();
  const { t, locale } = useTranslation();
  usePageMeta({
    title: "Cookie Policy | Your Social Place",
    description:
      "Read the Your Social Place Cookie Policy and manage your analytics preferences.",
    type: "website",
    canonical: "https://s2ydconnection.com/cookies",
  });

  const [consent, setConsent] = useState<ConsentState | null>(null);

  useEffect(() => {
    setConsent(readStoredConsent());
  }, []);

  const statusLabel = useMemo(() => {
    if (!consent) return t("No preference saved yet.");
    return consent.status === "granted"
      ? t("Analytics cookies are enabled.")
      : t("Analytics cookies are disabled.");
  }, [consent, t]);

  const handleChoice = (status: "granted" | "denied") => {
    persistConsent(status);
    applyConsent(status);
    setConsent({ status, ts: Date.now() });
  };

  return (
    <div className="terms-page">
      <div className="terms-shell">
        <header className="terms-header">
          <button className="terms-brand" type="button" onClick={() => navigate("/")}>
            <span className="terms-mark" aria-hidden="true">
              <img src="/logo2.png" alt="" />
            </span>
            <span className="terms-text">Your Social Place</span>
          </button>
          <button className="terms-back" type="button" onClick={() => navigate(-1)}>
            Back
          </button>
        </header>

        <main className="terms-card">
          <h1>{t("Cookie Policy")}</h1>
          <p className="terms-updated">
            {t("Last updated: {{date}}", { date: "Jan 4, 2026" })}
          </p>

          <section className="terms-section">
            <h2>{t("1. Why we use cookies")}</h2>
            <p>
              {t(
                "Cookies help us keep you signed in, remember your preferences, and understand which parts of the site are working well."
              )}
            </p>
          </section>

          <section className="terms-section">
            <h2>{t("2. Analytics cookies")}</h2>
            <p>
              {t(
                "We use analytics to understand usage trends and improve the product. You can enable or disable analytics cookies at any time."
              )}
            </p>
          </section>

          <section className="terms-section" id="preferences">
            <h2>{t("3. Manage cookies")}</h2>
            <p className="terms-status">{statusLabel}</p>
            <p className="terms-status">
              {t("Preference last updated:")}{" "}
              {formatTimestamp(consent?.ts, locale, t)}
            </p>
            <div className="terms-actions">
              <button
                className="terms-button is-primary"
                type="button"
                onClick={() => handleChoice("granted")}
              >
                {t("Allow analytics")}
              </button>
              <button
                className="terms-button is-ghost"
                type="button"
                onClick={() => handleChoice("denied")}
              >
                {t("Decline analytics")}
              </button>
            </div>
          </section>

          <div className="terms-contact">
            <span>{t("Questions?")}</span>
            <a href="mailto:support@yoursocialplace.com">support@yoursocialplace.com</a>
          </div>
        </main>
      </div>
    </div>
  );
}
