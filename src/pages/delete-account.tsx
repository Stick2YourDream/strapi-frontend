import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import { usePageMeta } from "../hooks/usePageMeta";
import "../css/terms.css";

const getErrorMessage = (err: unknown) => {
  const fallback = "Unable to delete account. Please try again.";
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

export default function DeleteAccount() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [confirmText, setConfirmText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  usePageMeta({
    title: "Delete Account | Your Social Place",
    description:
      "Request permanent deletion of your Your Social Place account and associated data.",
    type: "website",
    canonical: "https://yoursocialplace.com/delete-account",
  });

  const canSubmit =
    Boolean(user) &&
    confirmText.trim().toLowerCase() === "delete" &&
    status !== "loading";

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!user) {
      setError("Please log in to delete your account.");
      setStatus("error");
      return;
    }
    if (confirmText.trim().toLowerCase() !== "delete") {
      setError("Type DELETE to confirm account deletion.");
      setStatus("error");
      return;
    }
    setStatus("loading");
    setError(null);
    try {
      await api.post("/account/delete", { confirm: confirmText.trim() });
      logout("user-action");
      setStatus("success");
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
          <h1>Delete your account</h1>
          <p className="terms-updated">Last updated: Jan 19, 2026</p>
          <p className="terms-status">
            This permanently deletes your account, profile, posts, messages, and group activity.
          </p>
          <p className="terms-status">
            If you can’t log in, use the data deletion request page instead.
          </p>

          <form className="terms-form" onSubmit={handleSubmit}>
            <div className="terms-field">
              <label htmlFor="delete-account-confirm">Type DELETE to confirm</label>
              <input
                id="delete-account-confirm"
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
                Your account deletion request is complete. You have been logged out.
              </p>
            )}

            <div className="terms-actions">
              {!user && (
                <button
                  type="button"
                  className="terms-button is-ghost"
                  onClick={() => navigate("/login")}
                >
                  Log in to continue
                </button>
              )}
              <button
                type="submit"
                className="terms-button is-primary"
                disabled={!canSubmit}
              >
                {status === "loading" ? "Deleting..." : "Delete account"}
              </button>
            </div>
          </form>

          <div className="terms-contact">
            <span>Need help?</span>
            <a href="/delete-data">Request data deletion</a>
            <a href="mailto:support@yoursocialplace.com">support@yoursocialplace.com</a>
          </div>
        </main>
      </div>
    </div>
  );
}
