import "../css/terms.css";
import { useNavigate } from "react-router-dom";
import { usePageMeta } from "../hooks/usePageMeta";

export default function Safety() {
  const navigate = useNavigate();
  usePageMeta({
    title: "Safety & Moderation | Your Social Place",
    description:
      "Learn how Your Social Place keeps the community safe with clear rules, fast reporting, and thoughtful moderation.",
    type: "website",
    canonical: "https://yoursocialplace.com/safety",
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
          <h1>Safety &amp; Moderation</h1>
          <p className="terms-updated">Last updated: Jan 4, 2026</p>

          <section className="terms-section">
            <h2>1. Our commitment</h2>
            <p>
              Your Social Place is built for encouragement, accountability, and respectful
              collaboration. We remove harmful content and act on reports to keep the space safe.
            </p>
          </section>

          <section className="terms-section">
            <h2>2. What is not allowed</h2>
            <p>
              Harassment, hate, threats, impersonation, and spam are not allowed. Content that
              undermines safety or disrupts the community may be removed.
            </p>
          </section>

          <section className="terms-section">
            <h2>3. Reporting &amp; response</h2>
            <p>
              Reports are reviewed by our team. We look at context and history before deciding
              on warnings, removals, or account restrictions.
            </p>
            <p>
              Need to report someone? Visit the reporting page for what happens next and timing
              expectations.
            </p>
            <div className="terms-actions">
              <button className="terms-button is-primary" type="button" onClick={() => navigate("/report")}>
                Go to reporting
              </button>
              <button className="terms-button is-ghost" type="button" onClick={() => navigate("/guidelines")}>
                Read Community Guidelines
              </button>
            </div>
          </section>

          <section className="terms-section">
            <h2>4. Muting and blocking</h2>
            <p>
              Mute stops inbound messages. Block removes all communication between two users. You
              can manage both from your Friends page.
            </p>
          </section>

          <div className="terms-contact">
            <span>Need help?</span>
            <a href="mailto:support@yoursocialplace.com">support@yoursocialplace.com</a>
          </div>
        </main>
      </div>
    </div>
  );
}
