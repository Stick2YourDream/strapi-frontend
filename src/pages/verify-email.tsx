import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import api from "../api/strapi";
import { usePageMeta } from "../hooks/usePageMeta";
import "../css/login.css";
import "../css/verify-email.css";

const CODE_LENGTH = 6;

const maskEmail = (value: string) => {
  const trimmed = String(value || "").trim();
  const [local, domain] = trimmed.split("@");
  if (!local || !domain) return trimmed;
  const safeLocal =
    local.length <= 2 ? `${local[0] || ""}*` : `${local[0]}***${local.slice(-1)}`;
  const domainParts = domain.split(".");
  const domainRoot = domainParts.shift() || domain;
  const safeDomain =
    domainRoot.length <= 2
      ? `${domainRoot[0] || ""}*`
      : `${domainRoot[0]}***${domainRoot.slice(-1)}`;
  const domainSuffix = domainParts.length ? `.${domainParts.join(".")}` : "";
  return `${safeLocal}@${safeDomain}${domainSuffix}`;
};

export default function VerifyEmail(): JSX.Element {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const storedId = sessionStorage.getItem("emailConfirmationId") || "";
  const storedEmail = sessionStorage.getItem("emailConfirmationEmail") || "";
  const confirmationId = String(searchParams.get("id") || storedId).trim();
  const emailValue = String(searchParams.get("email") || storedEmail).trim();
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  usePageMeta({
    title: "Verify Email | Your Social Place",
    description: "Verify your email address to finish setting up your account.",
    type: "website",
    robots: "noindex, nofollow",
  });

  const codeValue = useMemo(() => digits.join(""), [digits]);
  const maskedEmail = useMemo(() => maskEmail(emailValue), [emailValue]);

  const focusIndex = (index: number) => {
    inputsRef.current[index]?.focus();
    inputsRef.current[index]?.select();
  };

  const handleDigitChange = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, "");
    if (!cleaned) {
      setDigits((prev) => {
        const next = [...prev];
        next[index] = "";
        return next;
      });
      return;
    }

    const nextDigit = cleaned.slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = nextDigit;
      return next;
    });
    if (index < CODE_LENGTH - 1) {
      focusIndex(index + 1);
    }
  };

  const handleKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Backspace") return;
    if (digits[index]) {
      setDigits((prev) => {
        const next = [...prev];
        next[index] = "";
        return next;
      });
      return;
    }
    if (index > 0) {
      focusIndex(index - 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const text = event.clipboardData.getData("text");
    if (!text) return;
    const digitsOnly = text.replace(/\D/g, "").slice(0, CODE_LENGTH);
    if (!digitsOnly) return;
    event.preventDefault();
    const nextDigits = Array(CODE_LENGTH).fill("");
    digitsOnly.split("").forEach((digit, idx) => {
      nextDigits[idx] = digit;
    });
    setDigits(nextDigits);
    const nextIndex = Math.min(digitsOnly.length, CODE_LENGTH - 1);
    focusIndex(nextIndex);
  };

  const handleVerify = async () => {
    setError(null);
    setInfo(null);
    if (!confirmationId) {
      setError("Missing verification session. Please re-register.");
      return;
    }
    if (codeValue.length !== CODE_LENGTH) {
      setError("Enter the full 6-digit code.");
      return;
    }
    setVerifying(true);
    try {
      await api.post("/auth/email/confirm/verify", {
        confirmationId,
        code: codeValue,
      });
      sessionStorage.removeItem("emailConfirmationId");
      sessionStorage.removeItem("emailConfirmationEmail");
      setInfo(
        "Email verified! Please verify your age within 30 days of account creation. You can find it under Profile → Settings → Account & Security after login."
      );
      window.setTimeout(() => navigate("/login"), 900);
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message ||
        err?.response?.data?.message ||
        "Unable to verify code.";
      setError(message);
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    setError(null);
    setInfo(null);
    if (!confirmationId) {
      setError("Missing verification session. Please re-register.");
      return;
    }
    setResending(true);
    try {
      await api.post("/auth/email/confirm/resend", { confirmationId });
      setInfo("A new code has been sent.");
    } catch (err: any) {
      const message =
        err?.response?.data?.error?.message ||
        err?.response?.data?.message ||
        "Unable to resend code.";
      setError(message);
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="auth-shell verify-email-shell">
      <div className="auth-hero">
        <button type="button" className="auth-brand" onClick={() => navigate("/")}>
          <span className="auth-brand-mark" aria-hidden="true">
            <img src="/logo2.png" alt="" />
          </span>
          <span className="auth-brand-text">Your Social Place</span>
        </button>
        <h1 className="subhead-top">Verify your email</h1>
        <p className="subhead">
          Enter the 6-digit code we sent{maskedEmail ? ` to ${maskedEmail}` : ""}.
        </p>
      </div>

      <section className="section verify-email-section">
        <div className="verify-email-card">
          <p className="verify-email-instructions">
            Please enter the code that we sent to your email, the code is valid for 15 minutes.
          </p>
          <div className="verify-email-code" onPaste={handlePaste}>
            {digits.map((digit, index) => (
              <input
                key={`code-${index}`}
                ref={(el) => {
                  inputsRef.current[index] = el;
                }}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={1}
                value={digit}
                onChange={(event) => handleDigitChange(index, event.target.value)}
                onKeyDown={(event) => handleKeyDown(index, event)}
                className="verify-email-input"
                aria-label={`Digit ${index + 1}`}
              />
            ))}
          </div>

          {error && <p className="verify-email-error">{error}</p>}
          {info && <p className="verify-email-info">{info}</p>}

          <div className="verify-email-actions">
            <button
              type="button"
              className="btn primary"
              onClick={handleVerify}
              disabled={verifying}
            >
              {verifying ? "Verifying..." : "Verify email"}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={handleResend}
              disabled={resending}
            >
              {resending ? "Sending..." : "Resend code"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
