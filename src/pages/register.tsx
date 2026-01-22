// src/pages/Register.tsx
import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
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

const INTENT_CONFIG = {
  "build-habit": {
    label: "Build A Habit",
    subhead: "Build consistency with daily check-ins and small wins.",
    steps: ["Pick a daily focus", "Set a check-in cadence"],
  },
  "stay-connected": {
    label: "Stay Connected",
    subhead: "Keep your people close with quick updates and encouragement.",
    steps: ["Choose your core crew", "Turn on check-in nudges"],
  },
  "find-accountability": {
    label: "Find Accountability",
    subhead: "Find partners who keep you on track and celebrate progress.",
    steps: ["Share what you need accountability on", "Invite a partner or join a group"],
  },
} as const;

type IntentKey = keyof typeof INTENT_CONFIG;

const normalizeIntent = (value?: string | null): IntentKey | null => {
  if (!value) return null;
  const cleaned = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const aliases: Record<string, IntentKey> = {
    habit: "build-habit",
    "build-habit": "build-habit",
    "build-a-habit": "build-habit",
    ship: "stay-connected",
    "stay-connected": "stay-connected",
    stayconnected: "stay-connected",
    accountability: "find-accountability",
    "find-accountability": "find-accountability",
    findaccountability: "find-accountability",
  };
  return aliases[cleaned] ?? null;
};

type LocationOption = {
  name: string;
  code: string;
  countryCode?: string;
};

const normalizeLocation = (value: string) => value.trim().toLowerCase();
const matchByName = (list: LocationOption[], value: string) =>
  list.find((item) => normalizeLocation(item.name) === normalizeLocation(value));
const phoneDigits = (value: string) => String(value || "").replace(/\D/g, "").slice(-10);

export default function Register() {
  const [form, setForm] = useState({
    username: "",
    email: "",
    confirmEmail: "",
    phoneNumber: "",
    smsCode: "",
    birthday: "",
    password: "",
    confirmPassword: "",
    country: "",
    countryCode: "",
    state: "",
    stateCode: "",
    city: "",
    botField: "",
  });
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsRead, setTermsRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [countryOptions, setCountryOptions] = useState<LocationOption[]>([]);
  const [stateOptions, setStateOptions] = useState<LocationOption[]>([]);
  const [cityOptions, setCityOptions] = useState<LocationOption[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [smsSending, setSmsSending] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const formStartRef = useRef(Date.now());
  const [searchParams] = useSearchParams();
  const intentParam = searchParams.get("intent");
  const intentKey = useMemo(() => normalizeIntent(intentParam), [intentParam]);
  const intentConfig = intentKey ? INTENT_CONFIG[intentKey] : null;
  usePageMeta({
    title: "Register | Your Social Place",
    description:
      "Create a Your Social Place account to join a motivational support network that celebrates progress and accountability.",
    type: "website",
    robots: "noindex, nofollow",
  });

  const navigate = useNavigate();
  const maxBirthdate = useMemo(() => getMaxBirthdate(), []);
  const successMessage =
    "Thank you for registering with Your Social Place. We are excited to have you on board with us. Please check your email for a confirmation link to login.";
  const stateLabel = form.countryCode === "US" ? "State" : "Province/Region";
  const needsState = stateOptions.length > 0;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
    if (name === "phoneNumber") {
      setSmsSent(false);
      setSmsError(null);
    }
  };

  const updateLocation = (changes: Partial<typeof form>) => {
    setForm((prev) => ({ ...prev, ...changes }));
  };

  const handleCountryChange = (value: string) => {
    const match = value ? matchByName(countryOptions, value) : undefined;
    updateLocation({
      country: value,
      countryCode: match?.code || "",
      state: "",
      stateCode: "",
      city: "",
    });
    setStateOptions([]);
    setCityOptions([]);
  };

  const handleStateChange = (value: string) => {
    const match = value ? matchByName(stateOptions, value) : undefined;
    updateLocation({
      state: value,
      stateCode: match?.code || "",
      city: "",
    });
    setCityOptions([]);
  };

  const handleCityChange = (value: string) => {
    updateLocation({ city: value });
  };

  const handleSendSms = async () => {
    const phoneValue = form.phoneNumber.trim();
    if (!phoneValue) {
      setSmsError("Phone number is required to send a code.");
      return;
    }
    setSmsError(null);
    setSmsSending(true);
    try {
      await api.post("/auth/sms/send", { phoneNumber: phoneValue, purpose: "register" });
      setSmsSent(true);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const msg =
          (err.response?.data as any)?.error?.message ||
          (err.response?.data as any)?.message ||
          "Unable to send SMS code.";
        setSmsError(msg);
      } else {
        setSmsError("Unable to send SMS code.");
      }
    } finally {
      setSmsSending(false);
    }
  };

  useEffect(() => {
    let active = true;
    const loadCountries = async () => {
      try {
        const res = await api.get("/locations/countries");
        const list = (res.data?.data ?? []).map((country: any) => ({
          name: country.name,
          code: country.code || country.isoCode || "",
        }));
        if (active) {
          setCountryOptions(list);
          setLocationError(null);
        }
      } catch {
        if (active) setLocationError("Unable to load country list.");
      }
    };
    loadCountries();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!form.countryCode) {
      setStateOptions([]);
      setCityOptions([]);
      return;
    }
    let active = true;
    const loadStates = async () => {
      try {
        const res = await api.get("/locations/states", {
          params: { country: form.countryCode },
        });
        const list = (res.data?.data ?? []).map((state: any) => ({
          name: state.name,
          code: state.code || state.isoCode || "",
          countryCode: state.countryCode,
        }));
        if (active) {
          setStateOptions(list);
          setLocationError(null);
        }
      } catch {
        if (active) setLocationError("Unable to load states or regions.");
      }
    };
    loadStates();
    return () => {
      active = false;
    };
  }, [form.countryCode]);

  useEffect(() => {
    if (!form.countryCode) {
      setCityOptions([]);
      return;
    }
    if (needsState && !form.stateCode) {
      setCityOptions([]);
      return;
    }
    let active = true;
    const loadCities = async () => {
      try {
        const res = await api.get("/locations/cities", {
          params: {
            country: form.countryCode,
            state: form.stateCode || undefined,
          },
        });
        const list = (res.data?.data ?? []).map((city: any) => ({
          name: city.name,
          code: city.name,
        }));
        if (active) {
          setCityOptions(list);
          setLocationError(null);
        }
      } catch {
        if (active) setLocationError("Unable to load cities.");
      }
    };
    loadCities();
    return () => {
      active = false;
    };
  }, [form.countryCode, form.stateCode, needsState]);

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

    const hasPhone = Boolean(form.phoneNumber.trim());
    if (!hasPhone) {
      setError("Phone number is required.");
      return;
    }
    const hasSmsCode = Boolean(form.smsCode.trim());
    const registrationPhone = phoneDigits(form.phoneNumber);

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
        phoneNumber: form.phoneNumber.trim(),
        smsCode: hasSmsCode ? form.smsCode.trim() : undefined,
        birthday: form.birthday,
        password: form.password,
        formStart: formStartRef.current,
        botField: form.botField,
        termsAccepted,
        intent: intentKey || undefined,
        country: form.country.trim() || undefined,
        countryCode: form.countryCode || undefined,
        state: form.state.trim() || undefined,
        stateCode: form.stateCode || undefined,
        city: form.city.trim() || undefined,
      });

      // Best-effort: create a minimal profile shell; encrypted profile fields are set after login.
      const lockedHandle =
        slugifyHandle(form.username || form.email) || `user-${res.data.user.id}`;
      try {
        const profileLocation: Record<string, string> = {};
        if (form.countryCode) {
          profileLocation.country = form.country.trim();
          profileLocation.countryCode = form.countryCode;
        }
        if (form.state || form.stateCode) {
          profileLocation.state = form.state.trim();
          profileLocation.stateCode = form.stateCode;
        }
        if (form.city) {
          profileLocation.city = form.city.trim();
        }
        if (form.birthday) {
          profileLocation.birthday = form.birthday;
        }
        if (age !== null) {
          profileLocation.age = String(age);
        }
        if (registrationPhone) {
          profileLocation.phone = registrationPhone;
        }
        const registrationLocked: Record<string, boolean> = {};
        if (form.birthday) registrationLocked.birthday = true;
        if (age !== null) registrationLocked.age = true;
        if (registrationPhone) registrationLocked.phone = true;
        if (form.country.trim()) registrationLocked.country = true;
        if (form.state.trim()) registrationLocked.state = true;
        if (form.city.trim()) registrationLocked.city = true;
        await api.post("/profiles", {
          data: {
            handle: lockedHandle,
            user: res.data.user.id,
            locale: "en",
            ...profileLocation,
            ...(Object.keys(registrationLocked).length
              ? { registrationLocked }
              : {}),
          },
        });
      } catch {
        // ignore if profile already exists or creation fails (created on first edit instead)
      }

      setInfo(successMessage);
      setShowSuccessModal(true);
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
          <span className="auth-brand-mark" aria-hidden="true">
            <img src="/logo.png" alt="" />
          </span>
          <span className="auth-brand-text">Your Social Place</span>
        </button>
        <h1 className="subhead-top">Create your account</h1>
        <p className="subhead">
          {intentConfig?.subhead || "Join the community and share your journey!"}
        </p>
      </div>

      <section className="section register-section">
        <div className="section-header register-section-header">
          <h2>What you get</h2>
          <p className="muted register-section-sub">
            Clear rules, safer defaults, real momentum.
          </p>
        </div>
        <ul className="register-trust-list">
          <li>
            <CheckCircle2 size={20} aria-hidden="true" />
            <span>No doomscrolling features</span>
          </li>
          <li>
            <CheckCircle2 size={20} aria-hidden="true" />
            <span>Encouragement and accountability first</span>
          </li>
          <li>
            <CheckCircle2 size={20} aria-hidden="true" />
            <span>Clear rules with fast reporting</span>
          </li>
          <li>
            <CheckCircle2 size={20} aria-hidden="true" />
            <span>Safer defaults, private-by-default profiles</span>
          </li>
        </ul>
        {intentConfig && (
          <div className="register-intent">
            <p className="register-intent-label">Next steps for {intentConfig.label}</p>
            <ul className="register-intent-steps">
              {intentConfig.steps.map((step) => (
                <li key={step}>
                  <CheckCircle2 size={18} aria-hidden="true" />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
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
          <label>Phone number (required)</label>
          <div className="field-row">
            <input
              className="auth-input"
              name="phoneNumber"
              type="tel"
              placeholder="+1 555 555 1234"
              onChange={handleChange}
              value={form.phoneNumber}
              autoComplete="tel"
              required
            />
            <button
              type="button"
              className="btn ghost sms-send"
              onClick={handleSendSms}
              disabled={smsSending || !form.phoneNumber.trim()}
            >
              {smsSending ? "Sending..." : smsSent ? "Resend code" : "Send code"}
            </button>
          </div>
          <small className="auth-hint">
            Required for verification. Include your country code (for example, +1).
          </small>
        </div>
        {smsError && <p className="auth-message error">{smsError}</p>}
        {smsSent && !smsError && (
          <p className="auth-message info">SMS code sent. Check your phone.</p>
        )}

        <div className="field">
          <label>SMS code (optional)</label>
          <input
            className="auth-input"
            name="smsCode"
            type="text"
            inputMode="numeric"
            placeholder="Enter the code"
            onChange={handleChange}
            value={form.smsCode}
            autoComplete="one-time-code"
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
          <label>Country</label>
          <select
            className="auth-input"
            value={form.country}
            onChange={(e) => handleCountryChange(e.target.value)}
          >
            <option value="">Select country</option>
            {countryOptions.map((country) => (
              <option key={country.code || country.name} value={country.name}>
                {country.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>{stateLabel}</label>
          <select
            className="auth-input"
            value={form.state}
            onChange={(e) => handleStateChange(e.target.value)}
            disabled={!form.countryCode || !stateOptions.length}
          >
            <option value="">
              {!form.countryCode
                ? "Select country first"
                : needsState
                ? `Select ${stateLabel.toLowerCase()}`
                : "No regions"}
            </option>
            {stateOptions.map((state) => (
              <option key={state.code || state.name} value={state.name}>
                {state.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>City</label>
          <select
            className="auth-input"
            value={form.city}
            onChange={(e) => handleCityChange(e.target.value)}
            disabled={!form.countryCode || (needsState && !form.stateCode)}
          >
            <option value="">
              {!form.countryCode
                ? "Select country first"
                : needsState && !form.stateCode
                ? `Select ${stateLabel.toLowerCase()} first`
                : "Select city"}
            </option>
            {cityOptions.map((city) => (
              <option key={city.code || city.name} value={city.name}>
                {city.name}
              </option>
            ))}
          </select>
          <small className="auth-hint">Optional. Helps suggest nearby friends.</small>
        </div>

        {locationError && <p className="auth-message error">{locationError}</p>}

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
        {info && !showSuccessModal && <p className="auth-message info">{info}</p>}

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

      {showSuccessModal && (
        <div className="register-success-overlay" role="dialog" aria-modal="true">
          <div className="register-success-modal">
            <div className="register-success-header">
              <h3>Registration complete</h3>
              <button
                type="button"
                className="register-success-close"
                onClick={() => setShowSuccessModal(false)}
              >
                Close
              </button>
            </div>
            <div className="register-success-body">
              <p>{successMessage}</p>
            </div>
            <div className="register-success-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowSuccessModal(false)}
              >
                Got it
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => navigate("/login")}
              >
                Go to login
              </button>
            </div>
          </div>
        </div>
      )}

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
