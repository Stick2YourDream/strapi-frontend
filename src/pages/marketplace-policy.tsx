import "../css/terms.css";
import { useNavigate } from "react-router-dom";
import {
  MARKETPLACE_POLICY_SECTIONS,
  MARKETPLACE_POLICY_TITLE,
  MARKETPLACE_POLICY_UPDATED,
} from "../content/marketplace-policy";
import { usePageMeta } from "../hooks/usePageMeta";

export default function MarketplacePolicy() {
  const navigate = useNavigate();
  const handleBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate("/storefront/seller#list");
  };
  usePageMeta({
    title: "StoreFront Shipping & Fees Policy | Your Social Place",
    description:
      "Review StoreFront shipping, local pickup, platform fee, and payment policies.",
    type: "website",
    canonical: "https://s2ydconnection.com/marketplace-policy",
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
          <button className="terms-back" type="button" onClick={handleBack}>
            Back
          </button>
        </header>

        <main className="terms-card">
          <h1>{MARKETPLACE_POLICY_TITLE}</h1>
          <p className="terms-updated">{MARKETPLACE_POLICY_UPDATED}</p>
          {MARKETPLACE_POLICY_SECTIONS.map((section) => {
            const sectionId = section.title
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "");
            return (
              <section key={sectionId || section.title} className="terms-section" id={sectionId}>
                <h2>{section.title}</h2>
                {section.body.map((paragraph, index) => (
                  <p key={`${section.title}-${index}`}>{paragraph}</p>
                ))}
              </section>
            );
          })}
          <div className="terms-contact">
            <span>Contact:</span>
            <a href="mailto:support@yoursocialplace.com">support@yoursocialplace.com</a>
          </div>
        </main>
      </div>
    </div>
  );
}
