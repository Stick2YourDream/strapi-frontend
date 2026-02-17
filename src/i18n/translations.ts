import en from "./locales/en.json";
import es from "./locales/es.json";
import de from "./locales/de.json";
import fr from "./locales/fr.json";
import ja from "./locales/ja.json";
import ar from "./locales/ar.json";

export type TranslationDict = Record<string, string>;

const RAW_TRANSLATIONS = {
  en,
  es,
  de,
  fr,
  ja,
  ar,
} as const;

export type SupportedLocale = keyof typeof RAW_TRANSLATIONS;

export const TRANSLATIONS: Record<SupportedLocale, TranslationDict> = RAW_TRANSLATIONS;

export const SUPPORTED_LOCALES = Object.keys(TRANSLATIONS) as SupportedLocale[];

export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  en: "English",
  es: "Español",
  de: "Deutsch",
  fr: "Français",
  ja: "日本語",
  ar: "العربية",
};

export const RTL_LOCALES = new Set<SupportedLocale>(["ar"]);

export const normalizeLocale = (value?: string | null): SupportedLocale => {
  const raw = (value || "").trim().toLowerCase();
  if (!raw) return "en";
  if (SUPPORTED_LOCALES.includes(raw as SupportedLocale)) {
    return raw as SupportedLocale;
  }
  const prefix = raw.split("-")[0];
  if (SUPPORTED_LOCALES.includes(prefix as SupportedLocale)) {
    return prefix as SupportedLocale;
  }
  return "en";
};

export const translate = (
  key: string,
  locale: SupportedLocale,
  vars?: Record<string, string | number>
) => {
  const dict = TRANSLATIONS[locale] || TRANSLATIONS.en;
  const fallback = TRANSLATIONS.en;
  const template = dict[key] ?? fallback[key] ?? key;
  if (!vars) return template;
  return template.replace(
    /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g,
    (match: string, token: string) => {
      const value = vars[token];
      return value === undefined || value === null ? match : String(value);
    }
  );
};
