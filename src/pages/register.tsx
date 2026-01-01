// src/pages/Register.tsx
import { Infinity } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/strapi";
import type { RegisterResponse } from "../types/auth";
import { TERMS_SECTIONS, TERMS_TITLE, TERMS_UPDATED } from "../content/terms";
import axios from "axios";
import "../css/register.css";
import { usePageMeta } from "../hooks/usePageMeta";

const slugifyHandle = (value: string) =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const getPasswordError = (password: string) => {
  const minLength = 12;
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

const parseBirthdate = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(utcDate.getTime())) return null;
  if (
    utcDate.getUTCFullYear() !== year ||
    utcDate.getUTCMonth() + 1 !== month ||
    utcDate.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
};

const getAgeFromBirthdate = (value: string) => {
  const parsed = parseBirthdate(value);
  if (!parsed) return null;
  const today = new Date();
  const yearNow = today.getUTCFullYear();
  const monthNow = today.getUTCMonth() + 1;
  const dayNow = today.getUTCDate();
  let age = yearNow - parsed.year;
  const hadBirthday =
    monthNow > parsed.month || (monthNow === parsed.month && dayNow >= parsed.day);
  if (!hadBirthday) age -= 1;
  if (age < 0) return null;
  return age;
};

const getMaxBirthdate = () => {
  const today = new Date();
  const year = today.getFullYear() - 18;
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function Register() {
  const [form, setForm] = useState({
    username: "",
    email: "",
    confirmEmail: "",
    birthday: "",
    password: "",
    confirmPassword: "",
    botField: "",
  });
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsRead, setTermsRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const formStartRef = useRef(Date.now());
  usePageMeta({
    title: "Register | Stick2YourDreams Connect",
    description:
      "Create a Stick2YourDreams account to join a motivational support network that celebrates progress and accountability.",
    type: "website",
    robots: "noindex, nofollow",
  });

  const navigate = useNavigate();
  const maxBirthdate = useMemo(() => getMaxBirthdate(), []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (form.botField) {
      setError("Unable to register at this time.");
      return;
    }

    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    const normalizedEmail = form.email.trim().toLowerCase();
    const normalizedConfirm = form.confirmEmail.trim().toLowerCase();
    if (normalizedEmail !== normalizedConfirm) {
      setError("Email addresses do not match.");
      return;
    }

    if (!termsAccepted) {
      setError("Please read and accept the Terms and Conditions.");
      return;
    }

    if (!form.birthday) {
      setError("Please enter your birthday.");
      return;
    }
    const age = getAgeFromBirthdate(form.birthday);
    if (age === null) {
      setError("Please enter a valid birthday.");
      return;
    }
    if (age < 18) {
      setError("You must be 18 or older to sign up.");
      return;
    }

    const passwordError = getPasswordError(form.password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    const elapsedMs = Date.now() - formStartRef.current;
    if (elapsedMs < 3000) {
      setError("Please take a moment to review your info before signing up.");
      return;
    }

    try {
      // ✅ custom route POST /api/register
      const res = await api.post<RegisterResponse>("/register", {
        username: form.username,
        email: normalizedEmail,
        birthday: form.birthday,
        password: form.password,
        formStart: formStartRef.current,
        botField: form.botField,
        termsAccepted,
      });

      // Best-effort: immediately create a linked profile with the chosen handle (username)
      const lockedHandle = slugifyHandle(form.username || form.email);
      const ageValue = String(age);
      try {
        await api.post("/profiles", {
          data: {
            handle: lockedHandle,
            firstName: form.username,
            birthday: form.birthday,
            age: ageValue,
            user: res.data.user.id,
            locale: "en",
          },
        });
      } catch {
        // ignore if profile already exists or creation fails (created on first edit instead)
      }

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
        <button
          type="button"
          className="auth-brand"
          onClick={() => navigate("/")}
        >
          <span className="auth-brand-mark">S2YD</span>
          <span className="auth-brand-text">| Stick2YourDreams</span>
        </button>
        <h1 className="subhead-top">Create your account</h1>
        <p className="subhead">
          Join the community and share your journey!
        </p>
      </div>

      <section className="section register-section">
        <div className="section-header register-section-header">
          <h2>What you Get!</h2>
          <p className="muted register-section-sub">Define Trust Within Our Community!</p>
        </div>
        <div className="metrics register-metrics">
          <div className="metric register-metric">
            <strong>Always</strong>
            <span>A Driven Community</span>
          </div>
          <div className="metric register-metric">
            <strong><Infinity size={30} /></strong>
            <span>People Who Care</span>
          </div>
          <div className="metric register-metric">
            <strong>0</strong>
            <span>No Nonsense Distractions</span>
          </div>
          <div className="metric register-metric">
            <strong>+</strong>
            <span>A Cleaner and Safer Community</span>
          </div>
        </div>
      </section>

      <form onSubmit={handleSubmit} className="auth-card">
        <div className="honeypot" aria-hidden="true">
          <label htmlFor="company">Company</label>
          <input
            id="company"
            name="botField"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={form.botField}
            onChange={handleChange}
          />
        </div>
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
          <label>Confirm Email</label>
          <input
            className="auth-input"
            name="confirmEmail"
            type="email"
            placeholder="Re-enter your email"
            onChange={handleChange}
            value={form.confirmEmail}
            required
          />
        </div>

        <div className="field">
          <label>Birthday</label>
          <input
            className="auth-input"
            name="birthday"
            type="date"
            max={maxBirthdate}
            min="1900-01-01"
            onChange={handleChange}
            value={form.birthday}
            required
          />
          <small className="auth-hint">You must be 18 or older to sign up.</small>
        </div>

        <div className="field">
          <label>Password</label>
          <input
            className="auth-input"
            name="password"
            type="password"
            placeholder="Enter a strong password"
            onChange={handleChange}
            value={form.password}
            required
          />
          <small className="auth-hint">
            At least 12 characters with upper/lowercase, a number, and a symbol (spaces allowed).
          </small>
        </div>

        <div className="field">
          <label>Confirm Password</label>
          <input
            className="auth-input"
            name="confirmPassword"
            type="password"
            placeholder="Confirm Password"
            onChange={handleChange}
            value={form.confirmPassword}
            required
          />
        </div>

        <div className="terms-consent">
          <button
            type="button"
            className="terms-open"
            onClick={() => {
              setTermsOpen(true);
              setTermsRead(false);
            }}
          >
            Read Terms
          </button>
          <button
            type="button"
            className={`terms-checkbox ${termsAccepted ? "checked" : ""}`}
            onClick={() => {
              if (termsAccepted) {
                setTermsAccepted(false);
                return;
              }
              setTermsOpen(true);
              setTermsRead(false);
            }}
            aria-pressed={termsAccepted}
          >
            <span className="terms-checkmark" aria-hidden="true" />
            <span>I agree to the Terms and Conditions</span>
          </button>
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

      {termsOpen && (
        <div className="terms-overlay" role="dialog" aria-modal="true">
          <div className="terms-modal">
            <div className="terms-modal-header">
              <div>
                <h3>{TERMS_TITLE}</h3>
                <p className="terms-updated">{TERMS_UPDATED}</p>
              </div>
              <button
                className="terms-close"
                type="button"
                onClick={() => setTermsOpen(false)}
              >
                Close
              </button>
            </div>
            <div
              className="terms-modal-body"
              onScroll={(event) => {
                const target = event.currentTarget;
                if (target.scrollTop + target.clientHeight >= target.scrollHeight - 8) {
                  setTermsRead(true);
                }
              }}
            >
              {TERMS_SECTIONS.map((section) => (
                <section key={section.title} className="terms-section">
                  <h4>{section.title}</h4>
                  {section.body.map((paragraph, index) => (
                    <p key={`${section.title}-${index}`}>{paragraph}</p>
                  ))}
                </section>
              ))}
            </div>
            <div className="terms-modal-footer">
              <a className="terms-link" href="/terms" target="_blank" rel="noreferrer">
                Open full page
              </a>
              <button
                className="btn primary"
                type="button"
                disabled={!termsRead}
                onClick={() => {
                  setTermsAccepted(true);
                  setTermsOpen(false);
                }}
              >
                {termsRead ? "I Agree" : "Scroll to the end to enable"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
