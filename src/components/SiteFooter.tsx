import "../css/site-footer.css";
import { useAuth } from "../context/AuthContext";

const DONATION_HOSTED_BUTTON_ID = "XLE5DBUY2GZBJ";
const DONATION_URL = `https://www.paypal.com/donate/?hosted_button_id=${DONATION_HOSTED_BUTTON_ID}`;

export default function SiteFooter() {
  const { user } = useAuth();

  const handleDonateClick = () => {
    if (typeof window === "undefined") return;
    const width = 720;
    const height = 820;
    const left = Math.max(0, Math.round((window.screen.width - width) / 2));
    const top = Math.max(0, Math.round((window.screen.height - height) / 2));
    const popup = window.open(
      DONATION_URL,
      "paypal_donate_popup",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
    );
    if (!popup) {
      window.location.assign(DONATION_URL);
    }
  };

  return (
    <footer className="landing-footer">
      <div className="footer-brand">
        <div className="footer-logo">
          <img src="/logo2.png" alt="Your Social Place logo" />
        </div>
        <div className="footer-brand-text">
          <strong>Your Social Place</strong>
          <p>
            A motivational support network built for real progress. Beta access is live and
            evolving.
          </p>
        </div>
      </div>
      <div className="footer-nav">
        <div className="footer-column">
          <span className="footer-title">Explore</span>
          {!user && (
            <>
              <a href="/">Login</a>
              <a href="/register">Create account</a>
            </>
          )}
          <a href="/what-makes-us-different">What makes us different</a>
          <a href={user ? "/forums" : "/register?access=forums"}>Forums</a>
          <a href="/apps">Apps</a>
          <a href="/guidelines">Community Guidelines</a>
        </div>
        <div className="footer-column">
          <span className="footer-title">Safety</span>
          <a href="/safety">Safety &amp; Moderation</a>
          <a href="/report">Report a user</a>
        </div>
        <div className="footer-column">
          <span className="footer-title">Legal</span>
          <a href="/terms">Terms</a>
          <a href="/privacy">Privacy</a>
          <a href="/delete-account">Delete account</a>
          <a href="/delete-data">Delete data</a>
          <a href="/cookies">Cookie Policy</a>
        </div>
        <div className="footer-column footer-apps">
          <span className="footer-title">Apps</span>
          <a className="footer-app-badge" href="/downloads">
            Downloads
          </a>
        </div>
        <div className="footer-column footer-contact">
          <span className="footer-title">Connect</span>
          <a href="/support">Support</a>
          <a href="mailto:support@yoursocialplace.com">Contact</a>
          <a className="footer-muted" href="mailto:support@yoursocialplace.com">
            support@yoursocialplace.com
          </a>
        </div>
      </div>
      <div className="footer-meta">
        <span>Your Social Place</span>
        <span>by Stick2YourDreams</span>
          <div className="footer-donate-wrap">
            <button
              type="button"
              className="footer-donate-btn"
              onClick={handleDonateClick}
              aria-label="Donate with PayPal"
            >
              <span className="footer-donate-badge" aria-hidden="true">
                PayPal
              </span>
              <span className="footer-donate-text">
                <strong>Support Your Social Place</strong>
                <small>Donate securely</small>
              </span>
            </button>
            <a
              className="footer-donate-link"
              href={DONATION_URL}
              target="_blank"
              rel="noreferrer"
            >
              Open donation page
            </a>
          </div>
      </div>
    </footer>
  );
}
