import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import { usePageMeta } from "../hooks/usePageMeta";
import "../css/terms.css";

const getErrorMessage = (err: unknown) => {
  const fallback = "Unable to submit request. Please try again.";
  if (!err || typeof err !== "object") return fallback;
  const maybeAny = err as {
    response?: { data?: { error?: { message?: string }; message?: string } };
    message?: string;
  };
  return (
    maybeAny.response?.data?.error?.message ||
    maybeAny.response?.data?.message ||
    maybeAny.message ||
    fallback
  );
};

export default function DeleteData() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [handle, setHandle] = useState("");
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  usePageMeta({
    title: "Delete Data | Your Social Place",
    description:
      "Request deletion of your personal data from Your Social Place.",
    type: "website",
    canonical: "https://yoursocialplace.com/delete-data",
  });

  useEffect(() => {
    if (!user) return;
    if (!name) {
      const displayName =
        profile?.firstName || profile?.lastName
          ? `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim()
          : "";
      if (displayName) setName(displayName);
    }
    if (!email) setEmail(user.email || "");
    if (!handle) setHandle(profile?.handle || "");
    if (!userId) setUserId(String(user.id || ""));
  }, [user, profile, name, email, handle, userId]);

  const canSubmit =
    email.trim().length > 0 &&
    confirmText.trim().toLowerCase() === "delete" &&
    status !== "loading";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim()) {
      setError("Email is required.");
      setStatus("error");
      return;
    }
    if (confirmText.trim().toLowerCase() !== "delete") {
      setError("Type DELETE to confirm the request.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      await api.post("/data/delete-request", {
        name: name.trim() || undefined,
        email: email.trim(),
        handle: handle.trim() || undefined,
        userId: userId.trim() || undefined,
        reason: reason.trim() || undefined,
        confirm: confirmText.trim(),
        pageUrl: typeof window === "undefined" ? undefined : window.location.href,
      });
      setStatus("success");
      setConfirmText("");
    } catch (err) {
      setError(getErrorMessage(err));
      setStatus("error");
    }
  };

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
          <h1>Delete your data</h1>
          <p className="terms-updated">Last updated: Jan 19, 2026</p>
          <p className="terms-status">
            Submit this form to request deletion of your personal data. We may contact you to
            confirm ownership before processing the request.
          </p>

          <form className="terms-form" onSubmit={handleSubmit}>
            <div className="terms-field">
              <label htmlFor="delete-data-name">Full name (optional)</label>
              <input
                id="delete-data-name"
                className="terms-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
              />
            </div>

            <div className="terms-field">
              <label htmlFor="delete-data-email">Email address</label>
              <input
                id="delete-data-email"
                className="terms-input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                required
              />
            </div>

            <div className="terms-grid">
              <div className="terms-field">
                <label htmlFor="delete-data-handle">Handle (optional)</label>
                <input
                  id="delete-data-handle"
                  className="terms-input"
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  placeholder="@yourhandle"
                />
              </div>
              <div className="terms-field">
                <label htmlFor="delete-data-user-id">User ID (optional)</label>
                <input
                  id="delete-data-user-id"
                  className="terms-input"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  placeholder="12345"
                />
              </div>
            </div>

            <div className="terms-field">
              <label htmlFor="delete-data-reason">What should we delete? (optional)</label>
              <textarea
                id="delete-data-reason"
                className="terms-textarea"
                rows={4}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Describe the data you want removed."
              />
            </div>

            <div className="terms-field">
              <label htmlFor="delete-data-confirm">Type DELETE to confirm</label>
              <input
                id="delete-data-confirm"
                className="terms-input"
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                placeholder="DELETE"
                autoComplete="off"
              />
            </div>

            {error && <p className="terms-alert is-error">{error}</p>}
            {status === "success" && (
              <p className="terms-alert is-success">
                Request received. We will email you with next steps.
              </p>
            )}

            <div className="terms-actions">
              <button
                type="submit"
                className="terms-button is-primary"
                disabled={!canSubmit}
              >
                {status === "loading" ? "Submitting..." : "Submit request"}
              </button>
            </div>
          </form>

          <div className="terms-contact">
            <span>Prefer email?</span>
            <a href="mailto:support@yoursocialplace.com">support@yoursocialplace.com</a>
          </div>
        </main>
      </div>
    </div>
  );
}
