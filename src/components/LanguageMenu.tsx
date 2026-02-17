import { LOCALE_LABELS } from "../i18n/translations";
import { useTranslation } from "../i18n/TranslationProvider";
import "../css/translation.css";

type LanguageMenuProps = {
  inline?: boolean;
};

export default function LanguageMenu({ inline }: LanguageMenuProps) {
  const { locale, setLocale, locales, t } = useTranslation();

  return (
    <div
      className={`language-menu${inline ? " language-menu--inline" : ""}`}
      role="region"
      aria-label={t("Language")}
    >
      <span className="language-menu__label">{t("Language")}</span>
      <select
        className="language-menu__select"
        value={locale}
        onChange={(event) => setLocale(event.target.value as typeof locale)}
        aria-label={t("Language")}
      >
        {locales.map((code) => (
          <option key={code} value={code}>
            {LOCALE_LABELS[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
