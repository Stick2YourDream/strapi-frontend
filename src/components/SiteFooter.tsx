import "../css/site-footer.css";
import { useAuth } from "../context/AuthContext";

export default function SiteFooter() {
  const { user } = useAuth();

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
              <a href="/login">Login</a>
              <a href="/register">Create account</a>
            </>
          )}
          <a href="/what-makes-us-different">What makes us different</a>
          <a href="/forums">Forums</a>
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
          <a href="mailto:support@yoursocialplace.com">Contact</a>
          <a className="footer-muted" href="mailto:support@yoursocialplace.com">
            support@yoursocialplace.com
          </a>
        </div>
      </div>
      <div className="footer-meta">
        <span>Your Social Place</span>
        <span>by Stick2YourDreams</span>
      </div>
    </footer>
  );
}
