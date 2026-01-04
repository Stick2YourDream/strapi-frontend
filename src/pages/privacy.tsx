import "../css/terms.css";
import { useNavigate } from "react-router-dom";
import { PRIVACY_SECTIONS, PRIVACY_TITLE, PRIVACY_UPDATED } from "../content/privacy";
import { usePageMeta } from "../hooks/usePageMeta";

export default function Privacy() {
  const navigate = useNavigate();
  usePageMeta({
    title: "Privacy Policy | Your Social Place",
    description:
      "Learn how Your Social Place collects, uses, and protects your information.",
    type: "website",
    canonical: "https://yoursocialplace.com/privacy",
  });

  return (
    <div className="terms-page">
      <div className="terms-shell">
        <header className="terms-header">
          <button className="terms-brand" type="button" onClick={() => navigate("/")}>
            <span className="terms-mark" aria-hidden="true">
              <img src="/logo.png" alt="" />
            </span>
            <span className="terms-text">Your Social Place</span>
          </button>
          <button className="terms-back" type="button" onClick={() => navigate(-1)}>
            Back
          </button>
        </header>

        <main className="terms-card">
          <h1>{PRIVACY_TITLE}</h1>
          <p className="terms-updated">{PRIVACY_UPDATED}</p>
          {PRIVACY_SECTIONS.map((section) => (
            <section
              key={section.title}
              className="terms-section"
              id={section.id}
            >
              <h2>{section.title}</h2>
              {section.body.map((paragraph, index) => (
                <p key={`${section.title}-${index}`}>{paragraph}</p>
              ))}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
