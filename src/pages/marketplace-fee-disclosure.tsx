import "../css/terms.css";
import { useNavigate } from "react-router-dom";
import {
  MARKETPLACE_FEE_SECTIONS,
  MARKETPLACE_FEE_TITLE,
  MARKETPLACE_FEE_UPDATED,
} from "../content/marketplace-fee-disclosure";
import { usePageMeta } from "../hooks/usePageMeta";

export default function MarketplaceFeeDisclosure() {
  const navigate = useNavigate();
  usePageMeta({
    title: "StoreFront Platform Fee Disclosure | Your Social Place",
    description: "Review StoreFront platform fee rules for online and cash payments.",
    type: "website",
    canonical: "https://s2ydconnection.com/marketplace-fee-disclosure",
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
          <h1>{MARKETPLACE_FEE_TITLE}</h1>
          <p className="terms-updated">{MARKETPLACE_FEE_UPDATED}</p>
          {MARKETPLACE_FEE_SECTIONS.map((section) => {
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
