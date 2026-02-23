import "../css/terms.css";
import { useNavigate } from "react-router-dom";
import { usePageMeta } from "../hooks/usePageMeta";

const SUPPORT_EMAIL = "support@yoursocialplace.com";

export default function Support() {
  const navigate = useNavigate();

  usePageMeta({
    title: "Support & Contact | Your Social Place",
    description:
      "Contact support, report safety concerns, and get help with your Your Social Place account.",
    type: "website",
    canonical: "https://yoursocialplace.com/support",
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
          <h1>Support &amp; Contact</h1>
          <p className="terms-updated">We respond to account and safety requests as quickly as possible.</p>

          <section className="terms-section">
            <h2>Get help</h2>
            <p>
              For login issues, profile access, account recovery, moderation questions, or data
              requests, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </p>
            <p>
              Include the email or phone number on your account and a short description of the
              issue so we can verify and resolve it faster.
            </p>
          </section>

          <section className="terms-section">
            <h2>Safety and abuse reports</h2>
            <p>
              If you need to report harmful behavior, impersonation, or policy violations, use{" "}
              <a href="/report">Report a user</a> and include relevant links or screenshots.
            </p>
            <p>
              If there is immediate danger, contact local emergency services first, then notify us
              so we can preserve records for investigation.
            </p>
          </section>

          <section className="terms-section">
            <h2>Privacy and data requests</h2>
            <p>
              You can manage account and data requests using{" "}
              <a href="/delete-account">Delete account</a> and <a href="/delete-data">Delete data</a>.
            </p>
            <p>
              For policy details, review <a href="/privacy">Privacy Policy</a>,{" "}
              <a href="/terms">Terms</a>, and <a href="/cookies">Cookie Policy</a>.
            </p>
          </section>

          <section className="terms-section">
            <h2>Security disclosures</h2>
            <p>
              If you discover a security issue, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{" "}
              with the subject line "Security report". Include reproduction steps and impact.
            </p>
            <p>
              We publish our security contact standard at{" "}
              <a href="/.well-known/security.txt">/.well-known/security.txt</a>.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
