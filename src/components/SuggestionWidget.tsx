import { useEffect, useMemo, useState } from "react";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import "../css/suggestion-widget.css";

type SuggestionWidgetProps = {
  variant?: "fab" | "inline" | "footer";
  showTrigger?: boolean;
  autoOpenWeekly?: boolean;
};

const WEEKLY_PROMPT_MS = 7 * 24 * 60 * 60 * 1000;

export default function SuggestionWidget({
  variant = "fab",
  showTrigger = true,
  autoOpenWeekly = false,
}: SuggestionWidgetProps) {
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

  useEffect(() => {
    if (!user?.id || !autoOpenWeekly || typeof window === "undefined") return;
    const storageKey = `ysp-suggestion-weekly-v1:${user.id}`;
    const now = Date.now();
    let shouldOpen = false;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const lastPromptAt = raw ? Number(raw) : 0;
      shouldOpen = !Number.isFinite(lastPromptAt) || now - lastPromptAt >= WEEKLY_PROMPT_MS;
      if (shouldOpen) {
        window.localStorage.setItem(storageKey, String(now));
      }
    } catch {
      shouldOpen = true;
    }
    if (shouldOpen) {
      setOpen(true);
      setStatus(null);
      setError(null);
    }
  }, [autoOpenWeekly, user?.id]);

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

  const isInline = variant === "inline";
  const isFooter = variant === "footer";
  const buttonClassName = isInline
    ? "suggestion-inline chat-action chat-action--suggestion"
    : isFooter
    ? "suggestion-footer-link"
    : "suggestion-fab";

  return (
    <>
      {showTrigger && !open && (
        <button type="button" className={buttonClassName} onClick={openWidget}>
          {isInline ? (
            <>
              <span className="chat-action-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                  <path
                    d="M6.25 5.25h11.5A2.75 2.75 0 0 1 20.5 8v7.25A2.75 2.75 0 0 1 17.75 18H11.9l-3.4 2.5v-2.5H6.25A2.75 2.75 0 0 1 3.5 15.25V8a2.75 2.75 0 0 1 2.75-2.75Z"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M12 9.25v4.5M9.75 11.5h4.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span className="chat-action-text">
                <span className="chat-action-title">Suggestion</span>
                <span className="chat-action-help">Help shape the beta</span>
              </span>
            </>
          ) : isFooter ? (
            "Suggestion box"
          ) : (
            "Make a suggestion"
          )}
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
