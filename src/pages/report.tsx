import "../css/terms.css";
import { useNavigate } from "react-router-dom";
import { usePageMeta } from "../hooks/usePageMeta";

export default function Report() {
  const navigate = useNavigate();
  usePageMeta({
    title: "Reporting | Your Social Place",
    description:
      "Report a user or post and learn what happens next at Your Social Place.",
    type: "website",
    canonical: "https://yoursocialplace.com/report",
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
          <h1>Reporting</h1>
          <p className="terms-updated">Last updated: Jan 4, 2026</p>

          <section className="terms-section">
            <h2>1. How to report</h2>
            <p>
              In the app, open the Friends page, choose a user, and select Report. Provide
              details so we can act quickly.
            </p>
          </section>

          <section className="terms-section">
            <h2>2. What happens next</h2>
            <p>
              Reports enter our review queue. We evaluate context, user history, and severity
              before deciding on warnings, removals, or account restrictions.
            </p>
          </section>

          <section className="terms-section">
            <h2>3. Turnaround times</h2>
            <p>
              Most reports are reviewed within 24-48 hours. Urgent safety threats are prioritized
              immediately.
            </p>
          </section>

          <section className="terms-section">
            <h2>4. Need faster help?</h2>
            <p>
              Email us at support@yoursocialplace.com with details, screenshots, or links to the
              content.
            </p>
          </section>

          <div className="terms-contact">
            <span>Contact:</span>
            <a href="mailto:support@yoursocialplace.com">support@yoursocialplace.com</a>
          </div>
        </main>
      </div>
    </div>
  );
}
