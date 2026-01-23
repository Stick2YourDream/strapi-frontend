import { useEffect, useMemo, useState } from "react";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import "../css/suggestion-widget.css";

export default function SuggestionWidget() {
  const { user, profile } = useAuth();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const displayName = useMemo(() => {
    const firstName = String(profile?.firstName || "").trim();
    const lastName = String(profile?.lastName || "").trim();
    return `${firstName} ${lastName}`.trim();
  }, [profile?.firstName, profile?.lastName]);

  useEffect(() => {
    if (!user) return;
    if (!name) {
      const fallback = displayName || user.email || "";
      if (fallback) setName(fallback);
    }
    if (!email && user.email) {
      setEmail(user.email);
    }
  }, [displayName, email, name, user]);

  const openWidget = () => {
    setOpen(true);
    setStatus(null);
    setError(null);
  };

  const closeWidget = () => setOpen(false);

  const handleSubmit = async () => {
    const trimmed = message.trim();
    if (!trimmed) {
      setError("Please share a suggestion before sending.");
      return;
    }

    setSending(true);
    setError(null);
    setStatus(null);
    try {
      await api.post("/suggestions", {
        message: trimmed,
        name: name.trim(),
        email: email.trim(),
        pageUrl: typeof window !== "undefined" ? window.location.href : "",
        userId: user?.id,
      });
      setStatus("Thank you! Your suggestion was sent.");
      setMessage("");
    } catch {
      setError("Unable to send suggestion right now.");
    } finally {
      setSending(false);
    }
  };

  if (!user) return null;

  return (
    <>
      {!open && (
        <button type="button" className="suggestion-fab" onClick={openWidget}>
          Make a suggestion
        </button>
      )}

      {open && (
        <div className="suggestion-overlay" role="dialog" aria-modal="true">
          <div className="suggestion-modal">
            <div className="suggestion-header">
              <div>
                <h3>Suggestion box</h3>
                <p>Help us shape the beta. Share what you want to see next.</p>
              </div>
              <button type="button" className="suggestion-close" onClick={closeWidget}>
                Minimize
              </button>
            </div>
            <div className="suggestion-body">
              <div className="field">
                <label>Your name (optional)</label>
                <input
                  className="auth-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div className="field">
                <label>Email (optional)</label>
                <input
                  className="auth-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="field">
                <label>Your suggestion</label>
                <textarea
                  className="auth-input"
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Tell us what would make Your Social Place better."
                />
              </div>
              {error && <p className="auth-message error">{error}</p>}
              {status && <p className="auth-message info">{status}</p>}
            </div>
            <div className="suggestion-footer">
              <button className="btn ghost" type="button" onClick={closeWidget}>
                Cancel
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={handleSubmit}
                disabled={sending}
              >
                {sending ? "Sending..." : "Send suggestion"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
