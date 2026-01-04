// src/pages/Login.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/strapi";
import type { AuthResponse } from "../types/auth";
import { useAuth } from "../context/AuthContext";
import axios from "axios";
import "../css/login.css";
import { usePageMeta } from "../hooks/usePageMeta";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  usePageMeta({
    title: "Login | Your Social Place",
    description:
      "Log in to Your Social Place to share progress updates and stay accountable with your support network.",
    type: "website",
    robots: "noindex, nofollow",
  });

  const { login } = useAuth();
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    try {
      // ✅ clear any stale token before attempting login
      localStorage.removeItem("token");
      localStorage.removeItem("user");

      const res = await api.post<AuthResponse>("/auth/local", {
        identifier: email.trim().toLowerCase(),
        password, // don't trim passwords
      });

      console.log("LOGIN STATUS:", res.status);
      console.log("LOGIN DATA:", res.data);

      if (!res.data?.jwt) {
        setError("Login succeeded but no token was returned.");
        return;
      }

      login(res.data.user, res.data.jwt);
      navigate("/dashboard");
    } catch (err: unknown) {
      if (!axios.isAxiosError(err)) {
        setError("Login failed");
        return;
      }

      const status = err.response?.status;
      const data: any = err.response?.data;
      const msg: string =
        data?.error?.message || data?.message || "Login failed";

      console.log("Strapi login error:", status, data);

      const msgLower = msg.toLowerCase();

      if (msgLower.includes("not confirmed") || msgLower.includes("confirm your email")) {
        setError("Please confirm your email before logging in.");
        setInfo("Check your inbox (and spam), then try again.");
        return;
      }

      if (msgLower.includes("invalid identifier or password")) {
        setError("Invalid email or password.");
        return;
      }

      if (status === 401) {
        // often caused by sending a stale Authorization header or being blocked
        setError("Unauthorized. Please try again.");
        return;
      }

      if (status === 403) {
        setError("Access denied. Your account may be blocked.");
        return;
      }

      setError(msg);
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
        <h1 className="subhead-top">Welcome back!</h1>
        <p className="subhead">
          Sign in to Your Social Place and start making a difference.
        </p>
      </div>

      <form onSubmit={handleLogin} className="auth-card">
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

        <div className="field">
          <label>Password</label>
          <input
            className="auth-input"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </div>

        {error && <p className="auth-message error">{error}</p>}
        {info && <p className="auth-message info">{info}</p>}

        <div className="auth-actions">
          <button type="submit" className="btn primary">
            Login
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => navigate("/register")}
          >
            Register with Your Social Place
          </button>
        </div>
      </form>
    </div>
  );
}
