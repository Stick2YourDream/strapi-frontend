// src/pages/ForgotPassword.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/strapi";
import axios from "axios";
import "../css/login.css";
import { usePageMeta } from "../hooks/usePageMeta";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  usePageMeta({
    title: "Reset Password | Your Social Place",
    description: "Request a password reset link for Your Social Place.",
    type: "website",
    robots: "noindex, nofollow",
  });

  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!email.trim()) {
      setError("Enter the email address on your account.");
      return;
    }

    try {
      setSending(true);
      await api.post("/auth/forgot-password", { email: email.trim().toLowerCase() });
      setInfo("Reset email sent. Check your inbox.");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(
          err.response?.data?.error?.message ||
            err.response?.data?.message ||
            "Unable to send reset email."
        );
      } else {
        setError("Unable to send reset email.");
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-hero">
        <button
          type="button"
          className="auth-brand"
          onClick={() => navigate("/")}
        >
          <span className="auth-brand-mark" aria-hidden="true">
            <img src="/logo.png" alt="" />
          </span>
          <span className="auth-brand-text">Your Social Place</span>
        </button>
        <h1 className="subhead-top">Reset your password</h1>
        <p className="subhead">We will send you a secure link to reset your password.</p>
      </div>

      <form onSubmit={handleSubmit} className="auth-card">
        <div className="field">
          <label>Email</label>
          <input
            className="auth-input"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>

        {error && <p className="auth-message error">{error}</p>}
        {info && <p className="auth-message info">{info}</p>}

        <div className="auth-actions">
          <button type="submit" className="btn primary" disabled={sending}>
            {sending ? "Sending..." : "Send reset email"}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => navigate("/login")}
          >
            Back to login
          </button>
        </div>
      </form>
    </div>
  );
}
