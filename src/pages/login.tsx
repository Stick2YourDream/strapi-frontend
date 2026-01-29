// src/pages/Login.tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/strapi";
import type { AuthResponse, LoginStartResponse } from "../types/auth";
import { useAuth } from "../context/AuthContext";
import axios from "axios";
import "../css/login.css";
import { usePageMeta } from "../hooks/usePageMeta";
import { getOrCreateDeviceId } from "../utils/device-id";

type VerificationMethod = "sms" | "email" | "totp";

export default function Login() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeMethod, setChallengeMethod] = useState<VerificationMethod | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [deliveryHint, setDeliveryHint] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [debugDetails, setDebugDetails] = useState<string | null>(null);
  const { login } = useAuth();
  const navigate = useNavigate();
  const appMode = String(import.meta.env.VITE_APP_MODE || "").toLowerCase();
  const isVideoApp = appMode === "video";
  const showDebug = isVideoApp || import.meta.env.DEV;
  const brandName = String(import.meta.env.VITE_APP_NAME || "").trim() || "Your Social Place";
  usePageMeta({
    title: `Login | ${isVideoApp ? brandName : "Your Social Place"}`,
    description: isVideoApp
      ? `Log in to start your ${brandName} video calls.`
      : "Log in to Your Social Place to share progress updates and stay accountable with your support network.",
    type: "website",
    robots: "noindex, nofollow",
  });
  const postLoginPath = isVideoApp ? "/call" : "/dashboard";
  const isVerificationStep = Boolean(challengeId);

  const buildDebugDetails = (err: unknown) => {
    if (!axios.isAxiosError(err)) {
      return String(err || "Unknown error");
    }

    const status = err.response?.status ?? "n/a";
    const method = String(err.config?.method || "").toUpperCase() || "n/a";
    const baseURL = err.config?.baseURL || "";
    const url = err.config?.url || "";
    let fullUrl = url || baseURL || "";
    if (baseURL && url) {
      try {
        fullUrl = new URL(url, baseURL).toString();
      } catch {
        fullUrl = `${baseURL}${url}`;
      }
    }
    const origin = typeof window !== "undefined" ? window.location.origin : "n/a";
    const apiBase = String(import.meta.env.VITE_API_URL || "");
    const responseData = err.response?.data;
    const responseText =
      typeof responseData === "string"
        ? responseData
        : responseData
        ? JSON.stringify(responseData)
        : "";
    const hasResponse = Boolean(err.response);
    const hint = hasResponse
      ? ""
      : "No response received (network/CORS/offline or server down).";

    return [
      `Status: ${status}`,
      `Request: ${method} ${fullUrl}`,
      apiBase ? `VITE_API_URL: ${apiBase}` : "VITE_API_URL: (not set)",
      `App Origin: ${origin}`,
      hint ? `Hint: ${hint}` : "",
      responseText ? `Response: ${responseText.slice(0, 600)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  };

  const resetVerificationState = () => {
    setChallengeId(null);
    setChallengeMethod(null);
    setVerificationCode("");
    setDeliveryHint(null);
    setResending(false);
    setVerifying(false);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setDebugDetails(null);
    resetVerificationState();

    try {
      setLoginLoading(true);
      localStorage.removeItem("token");
      localStorage.removeItem("user");

      const deviceId = getOrCreateDeviceId();
      const normalizedIdentifier = identifier.trim().toLowerCase();
      const res = await api.post<LoginStartResponse>("/auth/login", {
        identifier: normalizedIdentifier,
        password,
        rememberDevice,
        deviceId,
      });

      if ("requiresEmailConfirmation" in res.data && res.data.requiresEmailConfirmation) {
        sessionStorage.setItem("emailConfirmationId", res.data.confirmationId);
        if (normalizedIdentifier.includes("@")) {
          sessionStorage.setItem("emailConfirmationEmail", normalizedIdentifier);
        } else {
          sessionStorage.removeItem("emailConfirmationEmail");
        }
        navigate("/verify-email");
        return;
      }

      if ("requiresVerification" in res.data && res.data.requiresVerification) {
        setChallengeId(res.data.challengeId);
        setChallengeMethod(res.data.method);
        setDeliveryHint(res.data.deliveryHint ?? null);
        if (res.data.method === "totp") {
          setInfo("Enter the code from your authenticator app.");
        } else {
          setInfo(
            res.data.deliveryHint
              ? `We sent a code to ${res.data.deliveryHint}.`
              : "We sent a verification code."
          );
        }
        return;
      }

      if ("jwt" in res.data && res.data.jwt) {
        login(res.data.user, res.data.jwt);
        navigate(postLoginPath);
        return;
      }

      setError("Login failed. Please try again.");
    } catch (err: unknown) {
      if (!axios.isAxiosError(err)) {
        setError("Login failed");
        setDebugDetails(buildDebugDetails(err));
        return;
      }

      const status = err.response?.status;
      const data: any = err.response?.data;
      const msg: string =
        data?.error?.message || data?.message || "Login failed";

      const msgLower = msg.toLowerCase();

      if (msgLower.includes("not confirmed") || msgLower.includes("confirm your email")) {
        setError("Please confirm your email before logging in.");
        setInfo("Check your inbox (and spam), then try again.");
        setDebugDetails(buildDebugDetails(err));
        return;
      }

      if (msgLower.includes("invalid identifier") || msgLower.includes("invalid password")) {
        setError("Invalid email, phone number, or password.");
        setDebugDetails(buildDebugDetails(err));
        return;
      }

      if (msgLower.includes("phone number required")) {
        setError(
          "Phone number required for SMS verification. Update your login phone number in profile settings."
        );
        setDebugDetails(buildDebugDetails(err));
        return;
      }

      if (status === 401) {
        setError("Unauthorized. Please try again.");
        setDebugDetails(buildDebugDetails(err));
        return;
      }

      if (status === 403) {
        setError("Access denied. Your account may be blocked.");
        setDebugDetails(buildDebugDetails(err));
        return;
      }

      setError(msg);
      setDebugDetails(buildDebugDetails(err));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setDebugDetails(null);

    if (!challengeId) {
      setError("Verification expired. Please log in again.");
      return;
    }

    if (!verificationCode.trim()) {
      setError("Enter the verification code.");
      return;
    }

    try {
      setVerifying(true);
      const res = await api.post<AuthResponse>("/auth/login/verify", {
        challengeId,
        code: verificationCode.trim(),
      });

      if (!res.data?.jwt) {
        setError("Login failed. Please try again.");
        return;
      }

      login(res.data.user, res.data.jwt);
      navigate(postLoginPath);
    } catch (err: unknown) {
      if (!axios.isAxiosError(err)) {
        setError("Verification failed");
        setDebugDetails(buildDebugDetails(err));
        return;
      }

      const data: any = err.response?.data;
      const msg: string =
        data?.error?.message || data?.message || "Verification failed";
      const msgLower = msg.toLowerCase();

      if (msgLower.includes("expired")) {
        resetVerificationState();
        setError("Verification expired. Please log in again.");
        setDebugDetails(buildDebugDetails(err));
        return;
      }

      if (msgLower.includes("too many")) {
        resetVerificationState();
        setError("Too many attempts. Please log in again.");
        setDebugDetails(buildDebugDetails(err));
        return;
      }

      setError(msg);
      setDebugDetails(buildDebugDetails(err));
    } finally {
      setVerifying(false);
    }
  };

  const handleResend = async () => {
    if (!challengeId) return;
    if (challengeMethod === "totp") {
      setError("Authenticator codes cannot be resent.");
      setDebugDetails(null);
      return;
    }
    setError(null);
    setInfo(null);
    setDebugDetails(null);
    try {
      setResending(true);
      await api.post("/auth/login/resend", { challengeId });
      setInfo(
        challengeMethod === "email"
          ? "Code resent. Check your email."
          : "Code resent. Check your phone."
      );
    } catch (err: unknown) {
      if (!axios.isAxiosError(err)) {
        setError("Unable to resend code.");
        setDebugDetails(buildDebugDetails(err));
        return;
      }
      const data: any = err.response?.data;
      setError(data?.error?.message || data?.message || "Unable to resend code.");
      setDebugDetails(buildDebugDetails(err));
    } finally {
      setResending(false);
    }
  };

  const handleBack = () => {
    resetVerificationState();
    setError(null);
    setInfo(null);
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
            <img src="/logo2.png" alt="" />
          </span>
          <span className="auth-brand-text">
            {isVideoApp ? brandName : "Your Social Place"}
          </span>
        </button>
        <h1 className="subhead-top">Welcome back!</h1>
        <p className="subhead">
          Sign in to Your Social Place and start making a difference.
        </p>
      </div>

      <form onSubmit={isVerificationStep ? handleVerify : handleLogin} className="auth-card">
        {!isVerificationStep ? (
          <>
            <div className="field">
              <label>Email or phone number</label>
              <input
                className="auth-input"
                type="text"
                placeholder="you@example.com or +1 555 555 1234"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoComplete="username"
              />
            </div>

            <div className="field">
              <label>Password</label>
              <input
                className="auth-input"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>

            <p className="auth-hint">
              If you have 2FA enabled, we will send a code or prompt your authenticator app.
            </p>

            <label className="auth-check">
              <input
                type="checkbox"
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
              />
              <span>Remember this device for 30 days</span>
            </label>
          </>
        ) : (
          <>
            <div className="field">
              <label>Verification code</label>
              <input
                className="auth-input"
                type="text"
                inputMode="numeric"
                placeholder="Enter the code"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value)}
                autoComplete="one-time-code"
                required
              />
              {deliveryHint && (
                <small className="auth-hint">Sent to {deliveryHint}.</small>
              )}
            </div>

            <div className="sms-actions">
              {challengeMethod !== "totp" && (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={handleResend}
                  disabled={resending}
                >
                  {resending ? "Resending..." : "Resend code"}
                </button>
              )}
              <button type="button" className="btn ghost" onClick={handleBack}>
                Back to login
              </button>
            </div>
          </>
        )}

        {error && <p className="auth-message error">{error}</p>}
        {info && <p className="auth-message info">{info}</p>}
        {showDebug && debugDetails && (
          <details className="auth-debug">
            <summary>Show error details</summary>
            <pre>{debugDetails}</pre>
          </details>
        )}

        <div className="auth-actions">
          <button
            type="submit"
            className="btn primary"
            disabled={loginLoading || verifying}
          >
            {isVerificationStep
              ? verifying
                ? "Verifying..."
                : "Verify and login"
              : loginLoading
              ? "Logging in..."
              : "Login"}
          </button>
          {!isVerificationStep && (
            <>
              {!isVideoApp ? (
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => navigate("/register")}
                >
                  Register with Your Social Place
                </button>
              ) : (
                <a
                  className="btn ghost"
                  href="https://yoursocialplace.com/register"
                  target="_blank"
                  rel="noreferrer"
                >
                  Create a new account online
                </a>
              )}
              <button
                type="button"
                className="btn ghost"
                onClick={() => navigate("/forgot-password")}
              >
                Forgot password?
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
