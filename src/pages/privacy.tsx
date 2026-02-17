import "../css/terms.css";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { POLICY_REGIONS } from "../content/policy-regions";
import {
  PRIVACY_REGIONAL_SECTIONS,
  PRIVACY_SECTIONS,
  PRIVACY_TITLE,
  PRIVACY_UPDATED,
} from "../content/privacy";
import { useTranslation } from "../i18n/TranslationProvider";
import {
  getInitialPolicyRegion,
  POLICY_REGION_STORAGE_KEY,
} from "../utils/policy-region";
import { usePageMeta } from "../hooks/usePageMeta";

export default function Privacy() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [policyRegion, setPolicyRegion] = useState(getInitialPolicyRegion);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(POLICY_REGION_STORAGE_KEY, policyRegion);
  }, [policyRegion]);

  const regionOptions = useMemo(() => POLICY_REGIONS, []);
  const regionalSections = PRIVACY_REGIONAL_SECTIONS[policyRegion] || [];
  usePageMeta({
    title: "Privacy Policy | Your Social Place",
    description:
      "Learn how Your Social Place collects, uses, and protects your information.",
    type: "website",
    canonical: "https://s2ydconnection.com/privacy",
  });

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
          <h1>{t(PRIVACY_TITLE)}</h1>
          <p className="terms-updated">
            {t("Last updated: {{date}}", { date: PRIVACY_UPDATED })}
          </p>
          <div className="terms-region">
            <div className="terms-region__summary">
              <p className="terms-region__eyebrow">{t("Region")}</p>
              <h3 className="terms-region__title">{t("Policy region")}</h3>
              <p className="terms-region__desc">
                {t("Select your region to view the privacy rights that apply to you.")}
              </p>
            </div>
            <div className="terms-region__controls">
              <label className="terms-field">
                <span>{t("Region")}</span>
                <select
                  className="terms-input"
                  value={policyRegion}
                  onChange={(event) => setPolicyRegion(event.target.value as typeof policyRegion)}
                >
                  {regionOptions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {t(region.label)}
                    </option>
                  ))}
                </select>
              </label>
              <p className="terms-region__note">
                {t(
                  "This addendum summarizes the privacy rights that apply based on your region. Local laws may provide additional rights."
                )}
              </p>
            </div>
          </div>
          {PRIVACY_SECTIONS.map((section) => (
            <section
              key={section.title}
              className="terms-section"
              id={section.id}
            >
              <h2>{t(section.title)}</h2>
              {section.body.map((paragraph, index) => (
                <p key={`${section.title}-${index}`}>{t(paragraph)}</p>
              ))}
            </section>
          ))}
          {regionalSections.length > 0 && (
            <section className="terms-section terms-section--regional">
              <h2>{t("Regional privacy addendum")}</h2>
              <p>{t("These regional disclosures apply in addition to the global policy above.")}</p>
            </section>
          )}
          {regionalSections.map((section) => (
            <section
              key={`regional-${section.title}`}
              className="terms-section terms-section--regional"
            >
              <h2>{t(section.title)}</h2>
              {section.body.map((paragraph, index) => (
                <p key={`${section.title}-${index}`}>{t(paragraph)}</p>
              ))}
            </section>
          ))}
          <section className="terms-section" id="account-deletion">
            <h2>{t("Account and data deletion")}</h2>
            <p>
              {t("Use the self-serve forms to request deletion:")}{" "}
              <a href="/delete-account">{t("Delete account")}</a> {t("or")}{" "}
              <a href="/delete-data">{t("Delete data")}</a>.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
