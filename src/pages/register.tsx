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
import {
  extractNationalDigits,
  formatPhoneInput,
  normalizeDialCode,
} from "../utils/phone";

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

type ContactType = "email" | "phone";

type LocationOption = {
  name: string;
  code: string;
  phoneCode?: string;
};

type ParsedContact =
  | { type: "email"; email: string }
  | { type: "phone"; phone: string; national: string; dialCode: string };

const isValidEmail = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (!trimmed.includes("@")) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
};

const detectContactMode = (value: string, fallback: ContactType) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return fallback;
  if (/[a-zA-Z]/.test(trimmed) || trimmed.includes("@")) return "email";
  return "phone";
};

const parsePhoneContact = (value: string, dialCode: string) => {
  const dial = normalizeDialCode(dialCode || "");
  const national = extractNationalDigits(value, dial);
  if (!national) return null;
  const combinedDigits = `${dial}${national}`;
  if (combinedDigits.length < 10 || combinedDigits.length > 15) return null;
  return {
    phone: `+${combinedDigits}`,
    national,
    dialCode: dial,
  };
};

const parseContact = (value: string, dialCode: string): ParsedContact | null => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (isValidEmail(trimmed)) {
    return { type: "email" as const, email: trimmed.toLowerCase() };
  }
  if (/[a-zA-Z]/.test(trimmed)) return null;
  const normalizedPhone = parsePhoneContact(trimmed, dialCode);
  if (normalizedPhone) {
    return { type: "phone" as const, ...normalizedPhone };
  }
  return null;
};

export default function Register() {
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    contact: "",
    smsCode: "",
    birthday: "",
    password: "",
    confirmPassword: "",
    botField: "",
  });
  const [contactMode, setContactMode] = useState<ContactType>("phone");
  const [phoneDialCode, setPhoneDialCode] = useState("1");
  const [dialCodeEditing, setDialCodeEditing] = useState(false);
  const [countryOptions, setCountryOptions] = useState<LocationOption[]>([]);
  const [selectedCountryCode, setSelectedCountryCode] = useState("US");
  const [countryError, setCountryError] = useState<string | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsRead, setTermsRead] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [smsSending, setSmsSending] = useState(false);
  const [smsSent, setSmsSent] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);
  const [registeredMethod, setRegisteredMethod] = useState<ContactType | null>(null);
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
  const contactDetails = useMemo(
    () => parseContact(form.contact, phoneDialCode),
    [form.contact, phoneDialCode]
  );
  const successMessage = useMemo(() => {
    const method = registeredMethod ?? contactDetails?.type;
    if (method === "phone") {
      return "Thanks for registering! You can now log in with your phone number and password.";
    }
    return "Thank you for registering with Your Social Place. Enter the 6-digit code sent to your email to finish setup.";
  }, [registeredMethod, contactDetails?.type]);

  useEffect(() => {
    let active = true;
    const loadCountries = async () => {
      try {
        const res = await api.get("/locations/countries");
        const list = (res.data?.data ?? []).map(
          (country: {
            name?: string;
            code?: string;
            isoCode?: string;
            phoneCode?: string;
            phonecode?: string;
          }) => ({
            name: country.name,
            code: country.code || country.isoCode || "",
            phoneCode: country.phoneCode || country.phonecode || "",
          })
        );
        const usIndex = list.findIndex(
          (country: { name?: string; code?: string; isoCode?: string }) => {
            const name = String(country.name || "").trim().toLowerCase();
            return (
              String(country.code || "").toUpperCase() === "US" ||
              name === "united states" ||
              name === "united states of america"
            );
          }
        );
        const ordered =
          usIndex > 0
            ? [list[usIndex], ...list.slice(0, usIndex), ...list.slice(usIndex + 1)]
            : list;
        if (active) {
          setCountryOptions(ordered);
          setCountryError(null);
          const defaultCountry =
            ordered.find(
              (country: LocationOption) =>
                String(country.code || "").toUpperCase() === "US"
            ) ||
            ordered[0];
          if (defaultCountry?.code) {
            setSelectedCountryCode(defaultCountry.code);
          }
          if (defaultCountry?.phoneCode) {
            setPhoneDialCode(normalizeDialCode(defaultCountry.phoneCode) || "1");
          }
        }
      } catch {
        if (active) setCountryError("Unable to load country list.");
      }
    };
    loadCountries();
    return () => {
      active = false;
    };
  }, []);

  const handleContactChange = (value: string) => {
    const nextMode = detectContactMode(value, contactMode);
    setContactMode(nextMode);
    setForm((prev) => {
      const nextContact =
        nextMode === "phone"
          ? formatPhoneInput(extractNationalDigits(value, phoneDialCode), phoneDialCode)
          : value;
      return {
        ...prev,
        contact: nextContact,
        ...(nextMode !== "phone" ? { smsCode: "" } : {}),
      };
    });
    setSmsSent(false);
    setSmsError(null);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === "contact") {
      handleContactChange(value);
      return;
    }
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  useEffect(() => {
    if (contactMode !== "phone") return;
    setForm((prev) => {
      const formatted = formatPhoneInput(
        extractNationalDigits(prev.contact, phoneDialCode),
        phoneDialCode
      );
      if (formatted === prev.contact) return prev;
      return { ...prev, contact: formatted };
    });
  }, [contactMode, phoneDialCode]);

  useEffect(() => {
    if (contactMode === "phone") return;
    if (dialCodeEditing) setDialCodeEditing(false);
  }, [contactMode, dialCodeEditing]);

  const handleSendSms = async () => {
    const contact = parseContact(form.contact, phoneDialCode);
    if (!contact || contact.type !== "phone" || !contact.phone) {
      setSmsError("Enter a valid phone number to send a code.");
      return;
    }
    setSmsError(null);
    setSmsSending(true);
    try {
      await api.post("/auth/sms/send", { phoneNumber: contact.phone, purpose: "register" });
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

  const handleDialCodeSelect = (countryCode: string) => {
    setSelectedCountryCode(countryCode);
    const match = countryOptions.find(
      (country) => String(country.code || "").toUpperCase() === countryCode.toUpperCase()
    );
    const nextDial = normalizeDialCode(match?.phoneCode || "");
    if (nextDial) {
      setPhoneDialCode(nextDial);
    }
    setDialCodeEditing(false);
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

    const contact = parseContact(form.contact, phoneDialCode);
    if (!contact) {
      setError("Please enter a valid phone number or email.");
      return;
    }
    const hasSmsCode = Boolean(form.smsCode.trim());
    const registrationPhone = contact.type === "phone" ? contact.national : "";
    const normalizedEmail = contact.type === "email" ? contact.email : "";
    const contactPayload =
      contact.type === "phone" ? contact.phone : normalizedEmail || form.contact.trim();

    if (!termsAccepted) {
      setError("Please accept the Terms and Conditions and Privacy Policy.");
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
        contact: contactPayload,
        contactType: contact.type,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: contact.type === "email" ? normalizedEmail : undefined,
        phoneNumber: contact.type === "phone" ? contact.phone : undefined,
        smsCode:
          contact.type === "phone" && hasSmsCode ? form.smsCode.trim() : undefined,
        birthday: form.birthday,
        password: form.password,
        formStart: formStartRef.current,
        botField: form.botField,
        termsAccepted,
        intent: intentKey || undefined,
      });

      // Best-effort: create a minimal profile shell; encrypted profile fields are set after login.
      const lockedHandle =
        slugifyHandle(`${form.firstName} ${form.lastName}`) ||
        slugifyHandle(form.contact) ||
        `user-${res.data.user.id}`;
      try {
        const profileLocation: Record<string, string> = {};
        if (form.firstName.trim()) profileLocation.firstName = form.firstName.trim();
        if (form.lastName.trim()) profileLocation.lastName = form.lastName.trim();
        if (form.birthday) profileLocation.birthday = form.birthday;
        if (age !== null) profileLocation.age = String(age);
        if (registrationPhone) profileLocation.phone = registrationPhone;
        const registrationLocked: Record<string, boolean> = {};
        if (form.firstName.trim()) registrationLocked.firstName = true;
        if (form.lastName.trim()) registrationLocked.lastName = true;
        if (form.birthday) registrationLocked.birthday = true;
        if (age !== null) registrationLocked.age = true;
        if (registrationPhone) registrationLocked.phone = true;
        await api.post("/profiles", {
          data: {
            handle: lockedHandle,
            user: res.data.user.id,
            locale: "en",
            preferredVerificationMethod: contact.type === "phone" ? "sms" : "email",
            ...profileLocation,
            ...(Object.keys(registrationLocked).length
              ? { registrationLocked }
              : {}),
          },
        });
      } catch {
        // ignore if profile already exists or creation fails (created on first edit instead)
      }

      const nextMessage =
        contact.type === "phone"
          ? "Thanks for registering! You can now log in with your phone number and password."
          : "Thank you for registering with Your Social Place. Enter the 6-digit code sent to your email to finish setup.";
      setRegisteredMethod(contact.type);
      if (res.data.requiresConfirmation && contact.type === "email") {
        const confirmationId = String(res.data.emailConfirmationId || "").trim();
        if (!confirmationId) {
          setError("Unable to start email verification. Please try again.");
          return;
        }
        sessionStorage.setItem("emailConfirmationId", confirmationId);
        sessionStorage.setItem(
          "emailConfirmationEmail",
          normalizedEmail || res.data.user.email || ""
        );
        navigate("/verify-email");
        return;
      }
      setInfo(nextMessage);
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
          <label>Name</label>
          <div className="field-row">
            <input
              className="auth-input"
              name="firstName"
              placeholder="First name"
              onChange={handleChange}
              value={form.firstName}
              required
              autoComplete="given-name"
            />
            <input
              className="auth-input"
              name="lastName"
              placeholder="Last name"
              onChange={handleChange}
              value={form.lastName}
              required
              autoComplete="family-name"
            />
          </div>
        </div>

        <div className="field">
          <label>Phone number or email</label>
          {contactMode === "phone" ? (
            <>
              <div className="register-contact-row">
                <div className="register-phone-code">
                  <span className="register-phone-code-value">
                    +{phoneDialCode || "1"}
                  </span>
                  <button
                    type="button"
                    className="btn ghost register-code-edit"
                    onClick={() => setDialCodeEditing((prev) => !prev)}
                    disabled={!countryOptions.length}
                  >
                    {dialCodeEditing ? "Done" : "Edit"}
                  </button>
                </div>
                <input
                  className="auth-input register-phone-input"
                  name="contact"
                  type="text"
                  inputMode="tel"
                  placeholder="(555) 555-1234"
                  onChange={handleChange}
                  value={form.contact}
                  autoComplete="tel"
                  required
                />
                {contactDetails?.type === "phone" && (
                  <button
                    type="button"
                    className="btn ghost sms-send"
                    onClick={handleSendSms}
                    disabled={smsSending || !form.contact.trim()}
                  >
                    {smsSending ? "Sending..." : smsSent ? "Resend code" : "Send code"}
                  </button>
                )}
              </div>
              {dialCodeEditing && (
                <div className="register-code-select">
                  <select
                    className="auth-input"
                    value={selectedCountryCode}
                    onChange={(event) => handleDialCodeSelect(event.target.value)}
                  >
                    {countryOptions.map((country) => {
                      const dial = normalizeDialCode(country.phoneCode || "");
                      const label = country.name || country.code || "Unknown";
                      return (
                        <option key={`${country.code}-${dial}`} value={country.code}>
                          {label} {dial ? `(+${dial})` : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </>
          ) : (
            <div className="field-row">
              <input
                className="auth-input"
                name="contact"
                type="email"
                inputMode="email"
                placeholder="you@example.com"
                onChange={handleChange}
                value={form.contact}
                autoComplete="email"
                required
              />
            </div>
          )}
          <small className="auth-hint">
            Enter a valid phone number or email. Phone numbers default to +1 unless you change the
            country code.
          </small>
          {countryError && <small className="auth-hint">{countryError}</small>}
          {contactDetails?.type === "email" && (
            <small className="auth-hint">
              We will email a confirmation link after sign up.
            </small>
          )}
          {contactDetails?.type === "phone" && (
            <small className="auth-hint">
              Optional: request a text code to verify now.
            </small>
          )}
        </div>
        {contactDetails?.type === "phone" && (
          <>
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
          </>
        )}

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
            At least 8 characters with upper/lowercase, a number, and a symbol (spaces allowed).
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
          <label className={`terms-checkbox ${termsAccepted ? "checked" : ""}`}>
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
            />
            <span className="terms-checkmark" aria-hidden="true" />
            <span className="terms-copy">
              I agree to the{" "}
              <button
                type="button"
                className="terms-link"
                onClick={() => {
                  setTermsOpen(true);
                  setTermsRead(false);
                }}
              >
                Terms and Conditions
              </button>
              ,{" "}
              <a className="terms-link" href="/privacy" target="_blank" rel="noreferrer">
                Privacy Policy
              </a>
              , and{" "}
              <a className="terms-link" href="/cookies" target="_blank" rel="noreferrer">
                Cookie Policy
              </a>
              .
            </span>
          </label>
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
                className="btn ghost"
                onClick={() => navigate("/what-makes-us-different")}
              >
                What makes us different
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
