import "../css/terms.css";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { POLICY_REGIONS } from "../content/policy-regions";
import {
  TERMS_REGIONAL_SECTIONS,
  TERMS_SECTIONS,
  TERMS_TITLE,
  TERMS_UPDATED,
} from "../content/terms";
import { useTranslation } from "../i18n/TranslationProvider";
import {
  getInitialPolicyRegion,
  POLICY_REGION_STORAGE_KEY,
} from "../utils/policy-region";
import { usePageMeta } from "../hooks/usePageMeta";

export default function Terms() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [policyRegion, setPolicyRegion] = useState(getInitialPolicyRegion);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(POLICY_REGION_STORAGE_KEY, policyRegion);
  }, [policyRegion]);

  const regionOptions = useMemo(() => POLICY_REGIONS, []);
  const regionalSections = TERMS_REGIONAL_SECTIONS[policyRegion] || [];
  usePageMeta({
    title: "Terms & Conditions | Your Social Place",
    description:
      "Review the Your Social Place terms and conditions for community guidelines, safety, and platform usage.",
    type: "website",
    canonical: "https://s2ydconnection.com/terms",
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
          <h1>{t(TERMS_TITLE)}</h1>
          <p className="terms-updated">
            {t("Last updated: {{date}}", { date: TERMS_UPDATED })}
          </p>
          <div className="terms-region">
            <div className="terms-region__summary">
              <p className="terms-region__eyebrow">{t("Region")}</p>
              <h3 className="terms-region__title">{t("Policy region")}</h3>
              <p className="terms-region__desc">
                {t("Select your region to view the terms that apply to you.")}
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
                  "This addendum summarizes the terms that apply based on your region. Local laws may provide additional rights."
                )}
              </p>
            </div>
          </div>
          {TERMS_SECTIONS.map((section) => {
            const sectionId = section.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "");
            return (
              <section key={sectionId || section.title} className="terms-section" id={sectionId}>
                <h2>{t(section.title)}</h2>
                {section.body.map((paragraph, index) => (
                  <p key={`${section.title}-${index}`}>{t(paragraph)}</p>
                ))}
              </section>
            );
          })}
          {regionalSections.length > 0 && (
            <section className="terms-section terms-section--regional">
              <h2>{t("Regional policy addendum")}</h2>
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
          <div className="terms-contact">
            <span>{t("Contact")}:</span>
            <a href="mailto:support@yoursocialplace.com">support@yoursocialplace.com</a>
          </div>
        </main>
      </div>
    </div>
  );
}
