import "../css/terms.css";
import { useNavigate } from "react-router-dom";
import { TERMS_SECTIONS, TERMS_TITLE, TERMS_UPDATED } from "../content/terms";
import { usePageMeta } from "../hooks/usePageMeta";

export default function Terms() {
  const navigate = useNavigate();
  usePageMeta({
    title: "Terms & Conditions | Your Social PlaceStick2YourDreams Connect",
    description:
      "Review the Your Social Place terms and conditions for community guidelines, safety, and platform usage.",
    type: "website",
  });

  return (
    <div className="terms-page">
      <div className="terms-shell">
        <header className="terms-header">
          <button className="terms-brand" type="button" onClick={() => navigate("/")}>
            <span className="terms-mark">S2YD</span>
            <span className="terms-text">Stick2YourDreams</span>
          </button>
          <button className="terms-back" type="button" onClick={() => navigate(-1)}>
            Back
          </button>
        </header>

        <main className="terms-card">
          <h1>{TERMS_TITLE}</h1>
          <p className="terms-updated">{TERMS_UPDATED}</p>
          {TERMS_SECTIONS.map((section) => (
            <section key={section.title} className="terms-section">
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
