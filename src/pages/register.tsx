// src/pages/Register.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/strapi";
import type { RegisterResponse } from "../types/auth";
import axios from "axios";
import "../css/register.css";

export default function Register() {
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    try {
      // ✅ custom route POST /api/register
      const res = await api.post<RegisterResponse>("/register", form);

      setInfo(
        res.data.message ||
          "Account created! Please check your email to confirm your account."
      );

      // Optional: send them to login page after a moment
      setTimeout(() => navigate("/login"), 1500);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        setError(
          (err.response?.data as any)?.error?.message ||
            (err.response?.data as any)?.message ||
            "Error registering user"
        );
      } else {
        setError("Error registering user");
      }
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-hero">
        <p className="eyebrow">Stick2YourDreams</p>
        <h1>Create your account</h1>
        <p className="subhead">
          Join the community and share your journey. A few fields and you are in.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="auth-card">
        <div className="field">
          <label>Username</label>
          <input
            className="auth-input"
            name="username"
            placeholder="Pick a handle"
            onChange={handleChange}
            value={form.username}
            required
          />
        </div>

        <div className="field">
          <label>Email</label>
          <input
            className="auth-input"
            name="email"
            type="email"
            placeholder="you@example.com"
            onChange={handleChange}
            value={form.email}
            required
          />
        </div>

        <div className="field">
          <label>Password</label>
          <input
            className="auth-input"
            name="password"
            type="password"
            placeholder="••••••••"
            onChange={handleChange}
            value={form.password}
            required
          />
        </div>

        {error && <p className="auth-message error">{error}</p>}
        {info && <p className="auth-message info">{info}</p>}

        <div className="auth-actions">
          <button type="submit" className="btn primary">
            Sign Up
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => navigate("/login")}
          >
            Back to Login
          </button>
        </div>
      </form>
    </div>
  );
}
