// src/pages/ResetPassword.tsx
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/strapi";
import axios from "axios";
import "../css/login.css";
import { usePageMeta } from "../hooks/usePageMeta";

const getPasswordError = (password: string) => {
  const minLength = 8;
  if (!password || password.length < minLength) {
    return `Password must be at least ${minLength} characters long.`;
  }
  if (!/[a-z]/.test(password)) {
    return "Password must include at least one lowercase letter.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must include at least one uppercase letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must include at least one number.";
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must include at least one symbol (spaces allowed).";
  }
  return null;
};

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchParams] = useSearchParams();
  const resetCode = useMemo(() => searchParams.get("code") || "", [searchParams]);

  usePageMeta({
    title: "Set New Password | Your Social Place",
    description: "Choose a new password for your Your Social Place account.",
    type: "website",
    robots: "noindex, nofollow",
  });

  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!resetCode) {
      setError("Reset code is missing. Please request a new reset email.");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const passwordError = getPasswordError(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    try {
      setSaving(true);
      await api.post("/auth/reset-password", {
        code: resetCode,
        password,
        passwordConfirmation: confirmPassword,
      });
      setInfo("Password updated. You can now log in.");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(
          err.response?.data?.error?.message ||
            err.response?.data?.message ||
            "Unable to reset password."
        );
      } else {
        setError("Unable to reset password.");
      }
    } finally {
      setSaving(false);
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
        <h1 className="subhead-top">Set a new password</h1>
        <p className="subhead">Choose something strong and unique.</p>
      </div>

      <form onSubmit={handleSubmit} className="auth-card">
        <div className="field">
          <label>New password</label>
          <input
            className="auth-input"
            type="password"
            placeholder="Enter a strong password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
        </div>

        <div className="field">
          <label>Confirm password</label>
          <input
            className="auth-input"
            type="password"
            placeholder="Re-enter your password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            autoComplete="new-password"
          />
          <small className="auth-hint">
            At least 8 characters with upper/lowercase, a number, and a symbol.
          </small>
        </div>

        {error && <p className="auth-message error">{error}</p>}
        {info && <p className="auth-message info">{info}</p>}

        <div className="auth-actions">
          <button type="submit" className="btn primary" disabled={saving}>
            {saving ? "Saving..." : "Update password"}
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
