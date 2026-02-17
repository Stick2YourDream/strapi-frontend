import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { normalizeLocale, translate, SUPPORTED_LOCALES } from "./translations";
import type { SupportedLocale } from "./translations";
import { startAutoTranslate, updateAutoTranslateLocale } from "./autoTranslate";

type TranslationContextValue = {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
  locales: SupportedLocale[];
};

const TranslationContext = createContext<TranslationContextValue | undefined>(undefined);

const STORAGE_KEY = "ysp_locale_v1";

const resolveInitialLocale = (): SupportedLocale => {
  if (typeof window === "undefined") return "en";
  const params = new URLSearchParams(window.location.search);
  const paramLocale = params.get("lang");
  if (paramLocale) return normalizeLocale(paramLocale);
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored) return normalizeLocale(stored);
  return normalizeLocale(window.navigator.language);
};

export const TranslationProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocaleState] = useState<SupportedLocale>(() => resolveInitialLocale());

  const setLocale = useCallback((next: SupportedLocale) => {
    setLocaleState(normalizeLocale(next));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, locale);
    updateAutoTranslateLocale(locale);
  }, [locale]);

  useEffect(() => {
    startAutoTranslate();
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      translate(key, locale, vars),
    [locale]
  );

  const value = useMemo(
    () => ({
      locale,
      setLocale,
      t,
      locales: SUPPORTED_LOCALES,
    }),
    [locale, setLocale, t]
  );

  return (
    <TranslationContext.Provider value={value}>{children}</TranslationContext.Provider>
  );
};

export const useTranslation = () => {
  const context = useContext(TranslationContext);
  if (!context) {
    throw new Error("useTranslation must be used within TranslationProvider");
  }
  return context;
};
