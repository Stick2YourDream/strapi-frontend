// src/pages/Login.tsx
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";
import api from "../api/strapi";
import type { AuthResponse, LoginStartResponse } from "../types/auth";
import { useAuth } from "../context/AuthContext";
import axios from "axios";
import "../css/login.css";
import { usePageMeta } from "../hooks/usePageMeta";
import { getOrCreateDeviceId } from "../utils/device-id";
import { getDefaultDeviceLabel } from "../utils/device-approval";
import { getStoredExpiresAt, getStoredToken } from "../utils/auth-storage";
import { pickMediaUrl } from "../utils/media";
import { AGE_VERIFY_API_BASE, AGE_VERIFY_PUBLIC_URL } from "../utils/age-verify";
import { trackEvent } from "../utils/analytics";

const SETTINGS_GLOBAL_KEY = "video-call-settings:global";
const AUTH_DEBUG_SESSION_KEY = "auth:debug-last-login";
const RECENT_LOGINS_KEY = "auth:recent-logins";
const LOGOUT_MESSAGE_KEY = "auth:logout-message";
const LOGIN_CHALLENGE_KEY = "auth:login-challenge";
const MAX_RECENT_LOGINS = 4;
const AGE_VERIFICATION_LOCK_CODE = "AGE_VERIFICATION_LOCKED";
const DEFAULT_SUPPORT_EMAIL = String(
  import.meta.env.VITE_SUPPORT_EMAIL || "support@yoursocialplace.com"
).trim();

type AuthDebugSnapshot = {
  at: number;
  rememberDevice: boolean;
  requestedExpiresAt: number;
  effectiveExpiresAt: number;
  tokenIssuedAt?: number | null;
  tokenExpiresAt?: number | null;
  tokenIssuer?: string | null;
};

const loadBackgroundSettings = (raw: string | null) => {
  if (!raw) return { backgroundImage: "", backgroundColor: "" };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return { backgroundImage: "", backgroundColor: "" };
    }
    return {
      backgroundImage:
        typeof parsed.backgroundImage === "string" ? parsed.backgroundImage : "",
      backgroundColor:
        typeof parsed.backgroundColor === "string" ? parsed.backgroundColor : "",
    };
  } catch {
    return { backgroundImage: "", backgroundColor: "" };
  }
};

type VerificationMethod = "sms" | "email" | "totp";
type LoginChallengeSnapshot = {
  challengeId: string;
  method: VerificationMethod;
  deliveryHint?: string | null;
  identifier?: string;
  createdAt: number;
};

type RecentLoginEntry = {
  id: number;
  label: string;
  identifier: string;
  avatarUrl?: string | null;
  lastUsedAt: number;
};

type ParsedAxiosAuthError = {
  status: number | null;
  message: string;
  messageLower: string;
  code: string | null;
  supportEmail: string | null;
};

const loadRecentLogins = () => {
  if (typeof window === "undefined") return [] as RecentLoginEntry[];
  const raw = window.localStorage.getItem(RECENT_LOGINS_KEY);
  if (!raw) return [] as RecentLoginEntry[];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as RecentLoginEntry[];
    return parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        id: Number(entry.id),
        label: String(entry.label || ""),
        identifier: String(entry.identifier || ""),
        avatarUrl: entry.avatarUrl ? String(entry.avatarUrl) : null,
        lastUsedAt: Number(entry.lastUsedAt || 0),
      }))
      .filter(
        (entry) =>
          Number.isFinite(entry.id) &&
          entry.id > 0 &&
          Boolean(entry.identifier.trim())
      )
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX_RECENT_LOGINS);
  } catch {
    return [] as RecentLoginEntry[];
  }
};

const loadLogoutMessage = () => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(LOGOUT_MESSAGE_KEY);
  if (!raw) return null;
  window.localStorage.removeItem(LOGOUT_MESSAGE_KEY);
  return raw;
};

const loadStoredChallenge = (): LoginChallengeSnapshot | null => {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(LOGIN_CHALLENGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as LoginChallengeSnapshot;
    if (!parsed || typeof parsed !== "object") return null;
    const createdAt = Number(parsed.createdAt || 0);
    if (!Number.isFinite(createdAt)) return null;
    // Drop stale challenges after 15 minutes.
    if (Date.now() - createdAt > 15 * 60 * 1000) {
      window.sessionStorage.removeItem(LOGIN_CHALLENGE_KEY);
      return null;
    }
    const method = parsed.method as VerificationMethod | undefined;
    if (!parsed.challengeId || !method) return null;
    return {
      challengeId: String(parsed.challengeId),
      method,
      deliveryHint: parsed.deliveryHint ?? null,
      identifier: parsed.identifier ? String(parsed.identifier) : undefined,
      createdAt,
    };
  } catch {
    return null;
  }
};

const parseAxiosAuthError = (
  err: unknown,
  fallbackMessage: string
): ParsedAxiosAuthError => {
  if (!axios.isAxiosError(err)) {
    const message = String(err || fallbackMessage);
    return {
      status: null,
      message,
      messageLower: message.toLowerCase(),
      code: null,
      supportEmail: null,
    };
  }

  const status = typeof err.response?.status === "number" ? err.response.status : null;
  const payload = err.response?.data as
    | {
        error?: { message?: string; code?: string; supportEmail?: string } | string;
        message?: string;
        code?: string;
        supportEmail?: string;
      }
    | undefined;
  const nestedError =
    payload?.error && typeof payload.error === "object" ? payload.error : null;
  const message =
    (typeof payload?.error === "string" && payload.error.trim()) ||
    nestedError?.message ||
    (typeof payload?.message === "string" && payload.message.trim()) ||
    fallbackMessage;
  const code = String(nestedError?.code || payload?.code || "").trim() || null;
  const supportEmail =
    String(nestedError?.supportEmail || payload?.supportEmail || "").trim() || null;

  return {
    status,
    message,
    messageLower: message.toLowerCase(),
    code,
    supportEmail,
  };
};

const persistStoredChallenge = (snapshot: LoginChallengeSnapshot | null) => {
  if (typeof window === "undefined") return;
  if (!snapshot) {
    window.sessionStorage.removeItem(LOGIN_CHALLENGE_KEY);
    return;
  }
  window.sessionStorage.setItem(LOGIN_CHALLENGE_KEY, JSON.stringify(snapshot));
};

const persistRecentLogins = (entries: RecentLoginEntry[]) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(RECENT_LOGINS_KEY, JSON.stringify(entries));
};

const decodeJwtPayload = (token: string) => {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  try {
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

const toMsFromSeconds = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value * 1000 : null;

const formatIso = (value: number | null | undefined) =>
  Number.isFinite(value as number) ? new Date(value as number).toISOString() : "n/a";

const formatRemaining = (value: number | null | undefined) => {
  if (!Number.isFinite(value as number)) return "n/a";
  const ms = value as number;
  const sign = ms < 0 ? "-" : "";
  const total = Math.round(Math.abs(ms) / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${sign}${hours}h ${minutes}m ${seconds}s`;
};

const maskDeviceId = (value: string) => {
  if (!value) return "n/a";
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
};

export default function Login() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const rememberDevice = false;
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeMethod, setChallengeMethod] = useState<VerificationMethod | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [deliveryHint, setDeliveryHint] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [alternateLoading, setAlternateLoading] = useState(false);
  const [alternateMethod, setAlternateMethod] = useState<VerificationMethod | null>(null);
  const [showAlternateOptions, setShowAlternateOptions] = useState(false);
  const [allowAlternateOnLogin, setAllowAlternateOnLogin] = useState(false);
  const [showLoginAlternateOptions, setShowLoginAlternateOptions] = useState(false);
  const [forceSecurityAfterLogin, setForceSecurityAfterLogin] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [logoutMessage, setLogoutMessage] = useState<string | null>(() =>
    loadLogoutMessage()
  );
  const [debugDetails, setDebugDetails] = useState<string | null>(null);
  const [lastLoginDebug, setLastLoginDebug] = useState<AuthDebugSnapshot | null>(() => {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(AUTH_DEBUG_SESSION_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as AuthDebugSnapshot;
    } catch {
      return null;
    }
  });
  const [trustModalOpen, setTrustModalOpen] = useState(false);
  const [trustModalLoading, setTrustModalLoading] = useState(false);
  const [trustModalError, setTrustModalError] = useState<string | null>(null);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);
  const [pendingTrustDecision, setPendingTrustDecision] = useState(false);
  const [recentLogins, setRecentLogins] = useState<RecentLoginEntry[]>(() =>
    loadRecentLogins()
  );
  const [selectedRecentLogin, setSelectedRecentLogin] =
    useState<RecentLoginEntry | null>(null);
  const [showAccountSwitch, setShowAccountSwitch] = useState(false);
  const [showAgeVerifyModal, setShowAgeVerifyModal] = useState(false);
  const [ageSessionId, setAgeSessionId] = useState<string | null>(null);
  const [ageSessionStatus, setAgeSessionStatus] = useState("idle");
  const [ageSessionError, setAgeSessionError] = useState<string | null>(null);
  const [ageSessionLoading, setAgeSessionLoading] = useState(false);
  const [ageMobileUrl, setAgeMobileUrl] = useState<string | null>(null);
  const [ageQrUrl, setAgeQrUrl] = useState<string | null>(null);
  const [ageToken, setAgeToken] = useState<string | null>(null);
  const [ageVerifyApplying, setAgeVerifyApplying] = useState(false);
  const [ageVerifyContact, setAgeVerifyContact] = useState("");
  const [ageLockEnforced, setAgeLockEnforced] = useState(false);
  const [ageLockSupportEmail, setAgeLockSupportEmail] = useState(DEFAULT_SUPPORT_EMAIL);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const { login, keyBackupStatus, keyBackupLoading } = useAuth();
  const navigate = useNavigate();
  const appMode = String(import.meta.env.VITE_APP_MODE || "").toLowerCase();
  const isVideoApp = appMode === "video";
  const isDesktopShell =
    typeof window !== "undefined" && Boolean(window.yspDesktop?.isAvailable) && isVideoApp;
  const envDebug =
    String(import.meta.env.VITE_AUTH_DEBUG || "").toLowerCase() === "true";
  const showDebug = import.meta.env.DEV || envDebug;
  const brandName = String(import.meta.env.VITE_APP_NAME || "").trim() || "Your Social Place";
  usePageMeta({
    title: `Login | ${isVideoApp ? brandName : "Your Social Place"}`,
    description: isVideoApp
      ? `Log in to start your ${brandName} video calls.`
      : "Log in to Your Social Place to share progress updates and stay accountable with your support network.",
    type: "website",
    robots: "noindex, nofollow",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    setBackgroundSettings(loadBackgroundSettings(localStorage.getItem(SETTINGS_GLOBAL_KEY)));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem("authDebug", "0");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = loadStoredChallenge();
    if (!stored || challengeId) return;
    setChallengeId(stored.challengeId);
    setChallengeMethod(stored.method);
    setDeliveryHint(stored.deliveryHint ?? null);
    if (!identifier && stored.identifier) {
      setIdentifier(stored.identifier);
    }
  }, [challengeId, identifier]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SETTINGS_GLOBAL_KEY) return;
      setBackgroundSettings(loadBackgroundSettings(event.newValue));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);
  const defaultPostLoginPath = isVideoApp ? "/call" : "/dashboard";
  const securityPostLoginPath = "/me?view=settings&section=security";
  const postLoginPath = forceSecurityAfterLogin
    ? securityPostLoginPath
    : defaultPostLoginPath;
  const isVerificationStep = Boolean(challengeId);
  const hasRecentLogins = recentLogins.length > 0 && !isVerificationStep;
  const primaryRecentLogin = hasRecentLogins ? recentLogins[0] : null;
  const showRecentOnly = Boolean(primaryRecentLogin);
  const showRecentPassword = Boolean(selectedRecentLogin) && !showAccountSwitch;
  const showFullLoginForm =
    !showRecentOnly || isVerificationStep || showAccountSwitch;
  const [backgroundSettings, setBackgroundSettings] = useState(() => {
    if (typeof window === "undefined") return { backgroundImage: "", backgroundColor: "" };
    return loadBackgroundSettings(localStorage.getItem(SETTINGS_GLOBAL_KEY));
  });
  const trustDeviceLabel = useMemo(() => getDefaultDeviceLabel(), []);

  const saveLoginDebug = (jwt: string, remember: boolean) => {
    if (typeof window === "undefined") return;
    const now = Date.now();
    const payload = decodeJwtPayload(jwt);
    const tokenIssuedAt = toMsFromSeconds(payload?.iat);
    const tokenExpiresAt = toMsFromSeconds(payload?.exp);
    const sessionDays = remember ? 30 : 1;
    const requestedExpiresAt = now + sessionDays * 24 * 60 * 60 * 1000;
    const effectiveExpiresAt = tokenExpiresAt
      ? Math.min(requestedExpiresAt, tokenExpiresAt)
      : requestedExpiresAt;
    const snapshot: AuthDebugSnapshot = {
      at: now,
      rememberDevice: remember,
      requestedExpiresAt,
      effectiveExpiresAt,
      tokenIssuedAt,
      tokenExpiresAt,
      tokenIssuer: typeof payload?.iss === "string" ? payload.iss : null,
    };
    window.sessionStorage.setItem(AUTH_DEBUG_SESSION_KEY, JSON.stringify(snapshot));
    setLastLoginDebug(snapshot);
  };
  const authShellStyle = useMemo(() => {
    const style: CSSProperties = {};
    const vars = style as Record<string, string>;
    const backgroundImage = backgroundSettings.backgroundImage.trim();
    const backgroundColor = backgroundSettings.backgroundColor.trim();
    if (backgroundColor) {
      vars["--auth-bg-color"] = backgroundColor;
    }
    if (backgroundImage) {
      vars["--auth-bg-image"] = `url(\"${backgroundImage}\")`;
    } else if (backgroundColor) {
      vars["--auth-bg-image"] = "none";
    }
    return style;
  }, [backgroundSettings.backgroundColor, backgroundSettings.backgroundImage]);

  const authDebugText = useMemo(() => {
    if (typeof window === "undefined") return "";
    const now = Date.now();
    const deviceId = getOrCreateDeviceId();
    const token = getStoredToken();
    const payload = token ? decodeJwtPayload(token) : null;
    const tokenIssuedAt = toMsFromSeconds(payload?.iat);
    const tokenExpiresAt = toMsFromSeconds(payload?.exp);
    const storedExpiresAt = getStoredExpiresAt();
    const effectiveStoredExpiresAt = Number.isFinite(storedExpiresAt) ? storedExpiresAt : null;
    const timeLeftMs =
      effectiveStoredExpiresAt && Number.isFinite(effectiveStoredExpiresAt)
        ? effectiveStoredExpiresAt - now
        : null;
    const apiBase = String(import.meta.env.VITE_API_URL || "");
    const socketBase = String(import.meta.env.VITE_SOCKET_URL || "");
    const lines = [
      `Now: ${formatIso(now)}`,
      `App mode: ${appMode || "n/a"}`,
      `Origin: ${window.location.origin}`,
      `API base: ${apiBase || "n/a"}`,
      `Socket base: ${socketBase || "n/a"}`,
      `Device ID: ${maskDeviceId(deviceId)}`,
      `Remember device toggle: ${rememberDevice ? "true (30d)" : "false (1d)"}`,
      "",
      "Current session",
      `- Token present: ${token ? "yes" : "no"}`,
      `- Token iat: ${formatIso(tokenIssuedAt)}`,
      `- Token exp: ${formatIso(tokenExpiresAt)}`,
      `- Stored expiresAt: ${formatIso(effectiveStoredExpiresAt)}`,
      `- Time left: ${formatRemaining(timeLeftMs)}`,
    ];
    if (lastLoginDebug) {
      lines.push("", "Last login attempt");
      lines.push(`- At: ${formatIso(lastLoginDebug.at)}`);
      lines.push(
        `- Remember device: ${lastLoginDebug.rememberDevice ? "true (30d)" : "false (1d)"}`
      );
      lines.push(`- Token iat: ${formatIso(lastLoginDebug.tokenIssuedAt)}`);
      lines.push(`- Token exp: ${formatIso(lastLoginDebug.tokenExpiresAt)}`);
      lines.push(`- Requested expiresAt: ${formatIso(lastLoginDebug.requestedExpiresAt)}`);
      lines.push(`- Effective expiresAt: ${formatIso(lastLoginDebug.effectiveExpiresAt)}`);
      if (lastLoginDebug.tokenIssuer) {
        lines.push(`- Token issuer: ${lastLoginDebug.tokenIssuer}`);
      }
    }
    return lines.join("\n");
  }, [appMode, lastLoginDebug, rememberDevice]);

  const updateRecentLogins = async (
    user: AuthResponse["user"],
    identifierUsed?: string
  ) => {
    if (!user?.id) return;
    const safeIdentifier =
      identifierUsed?.trim().toLowerCase() || user.email || "";
    const emailFallback = user.email ? user.email.split("@")[0] : "";
    let label = safeIdentifier || emailFallback || `User ${user.id}`;
    let avatarUrl: string | null = null;

    try {
      const profileRes = await api.get(
        `/profiles?filters[user][id][$eq]=${user.id}&populate=avatar`
      );
      const entry = profileRes.data?.data?.[0];
      const attrs = entry?.attributes ?? entry ?? {};
      const firstName = String(attrs.firstName || attrs.firstname || "").trim();
      const lastName = String(attrs.lastName || attrs.lastname || "").trim();
      const handle = String(attrs.handle || "").trim();
      const fullName = `${firstName} ${lastName}`.trim();
      label = fullName || handle || emailFallback || label;
      const avatarField = attrs.avatar ?? entry?.avatar;
      const resolvedAvatar = pickMediaUrl(avatarField, { kind: "avatar" });
      avatarUrl = resolvedAvatar || null;
    } catch {
      // ignore profile lookup failures
    }

    const nextEntry: RecentLoginEntry = {
      id: user.id,
      label,
      identifier: safeIdentifier || user.email || "",
      avatarUrl,
      lastUsedAt: Date.now(),
    };

    setRecentLogins((prev) => {
      const merged = [
        nextEntry,
        ...prev.filter(
          (entry) =>
            entry.id !== nextEntry.id &&
            entry.identifier.toLowerCase() !== nextEntry.identifier.toLowerCase()
        ),
      ];
      const trimmed = merged
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
        .slice(0, MAX_RECENT_LOGINS);
      persistRecentLogins(trimmed);
      return trimmed;
    });
  };

  const handleRecentLoginSelect = (entry: RecentLoginEntry) => {
    if (!entry) return;
    resetVerificationState();
    setIdentifier(entry.identifier);
    setPassword("");
    setSelectedRecentLogin(entry);
    setShowAccountSwitch(false);
    setError(null);
    setInfo(null);
    setDebugDetails(null);
    requestAnimationFrame(() => {
      passwordInputRef.current?.focus();
    });
  };

  const handleSwitchAccount = () => {
    resetVerificationState();
    setSelectedRecentLogin(null);
    setIdentifier("");
    setPassword("");
    setShowAccountSwitch(true);
    setError(null);
    setInfo(null);
    setDebugDetails(null);
  };

  const initialsForLogin = (value: string) => {
    const cleaned = String(value || "").trim();
    if (!cleaned) return "U";
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return parts[0].slice(0, 1).toUpperCase();
    }
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  };

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
    setAlternateLoading(false);
    setAlternateMethod(null);
    setShowAlternateOptions(false);
    setAllowAlternateOnLogin(false);
    setShowLoginAlternateOptions(false);
    persistStoredChallenge(null);
  };

  const completeLogin = (
    data: { jwt: string; user: AuthResponse["user"]; trustedDevice?: boolean },
    identifierUsed?: string
  ) => {
    persistStoredChallenge(null);
    saveLoginDebug(data.jwt, rememberDevice);
    login(data.user, data.jwt, { rememberDevice });
    void updateRecentLogins(data.user, identifierUsed);
    trackEvent("login_completed", {
      verification_method: challengeMethod || "password",
      trusted_device: Boolean(data.trustedDevice),
    });
    if (data.trustedDevice) {
      setPendingTrustDecision(false);
      navigate(postLoginPath);
      return;
    }
    setPendingRedirect(postLoginPath);
    setTrustModalError(null);
    setPendingTrustDecision(true);
  };

  useEffect(() => {
    if (!pendingTrustDecision) return;
    if (!isVideoApp && (keyBackupLoading || keyBackupStatus === "unknown")) return;
    setPendingTrustDecision(false);
    if (!isVideoApp && keyBackupStatus === "needs-restore") {
      setTrustModalOpen(false);
      setPendingRedirect(null);
      navigate(pendingRedirect || postLoginPath);
      return;
    }
    setTrustModalOpen(true);
  }, [
    isVideoApp,
    keyBackupLoading,
    keyBackupStatus,
    navigate,
    pendingRedirect,
    pendingTrustDecision,
    postLoginPath,
  ]);

  const handleTrustDevice = async () => {
    if (trustModalLoading) return;
    setTrustModalLoading(true);
    setTrustModalError(null);
    try {
      const deviceId = getOrCreateDeviceId();
      await api.post("/auth/trusted-devices/trust", {
        deviceId,
        deviceLabel: trustDeviceLabel,
      });
      setTrustModalOpen(false);
      setPendingRedirect(null);
      navigate(pendingRedirect || postLoginPath);
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to trust this device."
        : "Unable to trust this device.";
      setTrustModalError(String(msg));
    } finally {
      setTrustModalLoading(false);
    }
  };

  const handleAlwaysConfirm = () => {
    setTrustModalOpen(false);
    setPendingRedirect(null);
    setTrustModalError(null);
    navigate(pendingRedirect || postLoginPath);
  };

  const applyLoginStartResponse = (
    data: LoginStartResponse,
    normalizedIdentifier: string
  ) => {
    if ("requiresEmailConfirmation" in data && data.requiresEmailConfirmation) {
      sessionStorage.setItem("emailConfirmationId", data.confirmationId);
      if (normalizedIdentifier.includes("@")) {
        sessionStorage.setItem("emailConfirmationEmail", normalizedIdentifier);
      } else {
        sessionStorage.removeItem("emailConfirmationEmail");
      }
      navigate("/verify-email");
      return true;
    }

    if ("requiresVerification" in data && data.requiresVerification) {
      setChallengeId(data.challengeId);
      setChallengeMethod(data.method);
      setDeliveryHint(data.deliveryHint ?? null);
      setVerificationCode("");
      setShowAlternateOptions(false);
      setAllowAlternateOnLogin(false);
      setShowLoginAlternateOptions(false);
      if (data.totpInvalid) {
        setForceSecurityAfterLogin(true);
      }
      if (data.method === "totp") {
        setInfo("Enter the code from your authenticator app.");
      } else {
        const baseMessage = data.deliveryHint
          ? `We sent a code to ${data.deliveryHint}.`
          : "We sent a verification code.";
        const fallbackMessage = data.totpInvalid
          ? `${baseMessage} Authenticator app is unavailable right now; re-link it in Settings after login.`
          : baseMessage;
        setInfo(
          fallbackMessage
        );
      }
      persistStoredChallenge({
        challengeId: data.challengeId,
        method: data.method,
        deliveryHint: data.deliveryHint ?? null,
        identifier: normalizedIdentifier,
        createdAt: Date.now(),
      });
      return true;
    }

    if ("jwt" in data && data.jwt) {
      completeLogin(data, normalizedIdentifier);
      return true;
    }

    return false;
  };

  const handleLoginError = (err: unknown) => {
    if (!axios.isAxiosError(err)) {
      setError("Login failed");
      setDebugDetails(buildDebugDetails(err));
      return;
    }

    const parsed = parseAxiosAuthError(err, "Login failed");
    const status = parsed.status;
    const msg = parsed.message;
    const msgLower = parsed.messageLower;
    const isAgeLock = parsed.code === AGE_VERIFICATION_LOCK_CODE;
    const supportEmail = parsed.supportEmail || DEFAULT_SUPPORT_EMAIL;

    if (msgLower.includes("account locked") || msgLower.includes("too many failed")) {
      setError(
        "Account locked for 24 hours due to too many failed login attempts. Contact support@yoursocialplace.com to unlock."
      );
      setDebugDetails(buildDebugDetails(err));
      return;
    }

    if (msgLower.includes("time limit") && msgLower.includes("cooldown")) {
      setError(msg);
      setDebugDetails(buildDebugDetails(err));
      return;
    }

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

    if (msgLower.includes("authenticator app is not configured")) {
      setError("We couldn’t use your authenticator app. Try another way.");
      setInfo("Send a one-time code to your email or phone.");
      setAllowAlternateOnLogin(true);
      setShowLoginAlternateOptions(true);
      setForceSecurityAfterLogin(true);
      setDebugDetails(buildDebugDetails(err));
      return;
    }

    if (status === 401) {
      setError("Unauthorized. Please try again.");
      setDebugDetails(buildDebugDetails(err));
      return;
    }

    if (status === 403) {
      if (isAgeLock || msgLower.includes("age verification")) {
        setError(
          isAgeLock
            ? `Age verification overdue. Your account is locked. Contact ${supportEmail} or complete verification to continue.`
            : "Age verification required. Verify your age to unlock your account."
        );
        openAgeVerifyModal({
          contactOverride: identifier.trim(),
          lockEnforced: isAgeLock,
          supportEmail,
        });
      } else {
        setError("Access denied. Your account may be blocked.");
      }
      setDebugDetails(buildDebugDetails(err));
      return;
    }

    setError(msg);
    setDebugDetails(buildDebugDetails(err));
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setDebugDetails(null);
    setLogoutMessage(null);
    resetVerificationState();
    setForceSecurityAfterLogin(false);

    try {
      setLoginLoading(true);
      trackEvent("login_started", {
        source: "login_form",
        has_recent_login: hasRecentLogins,
      });

      const deviceId = getOrCreateDeviceId();
      const normalizedIdentifier = identifier.trim().toLowerCase();
      const res = await api.post<LoginStartResponse>("/auth/login", {
        identifier: normalizedIdentifier,
        password,
        rememberDevice,
        deviceId,
      });

      if (!applyLoginStartResponse(res.data, normalizedIdentifier)) {
        setError("Login failed. Please try again.");
      }
    } catch (err: unknown) {
      handleLoginError(err);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleTryAnotherWay = async (method: VerificationMethod) => {
    if (alternateLoading || loginLoading || verifying) return;
    setError(null);
    setInfo(null);
    setDebugDetails(null);
    setLogoutMessage(null);

    if (!identifier.trim() || !password.trim()) {
      setError("Enter your password to try another method.");
      return;
    }

    try {
      setAlternateLoading(true);
      setAlternateMethod(method);
      const deviceId = getOrCreateDeviceId();
      const normalizedIdentifier = identifier.trim().toLowerCase();
      const res = await api.post<LoginStartResponse>("/auth/login", {
        identifier: normalizedIdentifier,
        password,
        rememberDevice,
        deviceId,
        verificationMethod: method,
      });
      if (!applyLoginStartResponse(res.data, normalizedIdentifier)) {
        setError("Login failed. Please try again.");
      }
    } catch (err: unknown) {
      handleLoginError(err);
    } finally {
      setAlternateLoading(false);
      setAlternateMethod(null);
    }
  };

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setDebugDetails(null);
    setLogoutMessage(null);

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
      trackEvent("login_started", {
        source: "login_verification",
        verification_method: challengeMethod || "unknown",
      });
      const res = await api.post<AuthResponse>("/auth/login/verify", {
        challengeId,
        code: verificationCode.trim(),
      });

      if (!res.data?.jwt) {
        setError("Login failed. Please try again.");
        return;
      }

      const normalizedIdentifier = identifier.trim().toLowerCase();
      completeLogin(res.data, normalizedIdentifier);
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
    setLogoutMessage(null);
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
    setLogoutMessage(null);
  };

  const resetAgeVerifyState = () => {
    setAgeSessionId(null);
    setAgeSessionStatus("idle");
    setAgeSessionError(null);
    setAgeSessionLoading(false);
    setAgeMobileUrl(null);
    setAgeQrUrl(null);
    setAgeToken(null);
    setAgeVerifyApplying(false);
  };

  const closeAgeVerifyModal = () => {
    if (ageLockEnforced) return;
    setShowAgeVerifyModal(false);
    setAgeLockEnforced(false);
    setAgeLockSupportEmail(DEFAULT_SUPPORT_EMAIL);
    resetAgeVerifyState();
  };

  const openAgeVerifyModal = (options?: {
    contactOverride?: string;
    lockEnforced?: boolean;
    supportEmail?: string | null;
  }) => {
    const contactValue = String((options?.contactOverride ?? identifier) || "").trim();
    const normalizedSupport =
      String(options?.supportEmail || "").trim() || DEFAULT_SUPPORT_EMAIL;
    setAgeVerifyContact(contactValue);
    setAgeLockEnforced(Boolean(options?.lockEnforced));
    setAgeLockSupportEmail(normalizedSupport);
    setShowAgeVerifyModal(true);
    if (!ageSessionId && !ageSessionLoading) {
      void createAgeSession();
    }
  };

  const createAgeSession = async () => {
    setAgeSessionError(null);
    setAgeSessionLoading(true);
    try {
      const returnUrl = `${window.location.origin}/login`;
      const res = await fetch(`${AGE_VERIFY_API_BASE}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          returnUrl,
          publicBaseUrl: AGE_VERIFY_PUBLIC_URL || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Unable to start age verification.");
      }
      const sessionId = data?.data?.sessionId || null;
      const serverQrUrl = data?.data?.qrUrl || null;
      const serverMobileUrl = data?.data?.mobileUrl || null;
      const computedMobile =
        AGE_VERIFY_PUBLIC_URL && sessionId
          ? `${AGE_VERIFY_PUBLIC_URL}/session/${sessionId}?mode=mobile`
          : null;
      const nextMobileUrl = computedMobile || serverMobileUrl;
      setAgeSessionId(sessionId);
      setAgeMobileUrl(nextMobileUrl);
      setAgeQrUrl(computedMobile || serverQrUrl || nextMobileUrl);
      setAgeSessionStatus("pending");
    } catch (err: any) {
      setAgeSessionError(err?.message || "Unable to start age verification.");
    } finally {
      setAgeSessionLoading(false);
    }
  };

  useEffect(() => {
    if (!showAgeVerifyModal || !ageSessionId || ageToken) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`${AGE_VERIFY_API_BASE}/session/${ageSessionId}`);
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data?.error || "Unable to check status.");
        }
        if (!active) return;
        const status = data?.data?.status || "pending";
        setAgeSessionStatus(status);
        if (status === "verified" && data?.data?.token) {
          setAgeToken(data.data.token);
          setAgeSessionStatus("verified");
        }
        if (status === "failed" || status === "denied") {
          setAgeSessionError(data?.data?.reason || "Verification failed.");
        }
      } catch (err: any) {
        if (active) setAgeSessionError(err?.message || "Unable to check status.");
      }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [showAgeVerifyModal, ageSessionId, ageToken]);

  useEffect(() => {
    if (!showAgeVerifyModal || !ageToken || ageVerifyApplying) return;
    if (!ageVerifyContact.trim()) {
      setAgeSessionError("Enter your email or phone number to unlock your account.");
      return;
    }
    let active = true;
    const applyToken = async () => {
      try {
        setAgeVerifyApplying(true);
        await api.post("/auth/age/verify-registration", {
          token: ageToken,
          contact: ageVerifyContact.trim(),
        });
        if (!active) return;
        setInfo("Age verified. You can log in now.");
        setError(null);
        setAgeLockEnforced(false);
        setAgeLockSupportEmail(DEFAULT_SUPPORT_EMAIL);
        setShowAgeVerifyModal(false);
        resetAgeVerifyState();
      } catch (err: any) {
        const message =
          err?.response?.data?.error?.message ||
          err?.response?.data?.message ||
          err?.message ||
          "Unable to apply age verification.";
        if (active) setAgeSessionError(message);
      } finally {
        if (active) setAgeVerifyApplying(false);
      }
    };
    void applyToken();
    return () => {
      active = false;
    };
  }, [showAgeVerifyModal, ageToken, ageVerifyApplying, ageVerifyContact]);

  return (
    <div
      className={`auth-shell${isDesktopShell ? " is-desktop-shell" : ""}`}
      style={authShellStyle}
    >
      <div
        className={`auth-layout${hasRecentLogins ? " is-recent-only" : " is-form-only"}`}
      >
        <div className={`auth-left${showRecentOnly || showFullLoginForm ? " is-centered" : ""}`}>
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
          {logoutMessage && (
            <p className="auth-message info">{logoutMessage}</p>
          )}

          {showRecentOnly && primaryRecentLogin && (
            <section className="auth-recent auth-recent--single" aria-label="Recent logins">
              <div className="auth-recent-header">
                <h2>Recent Logins</h2>
                <p>Click your picture to continue.</p>
              </div>
              <button
                type="button"
                className="auth-recent-card auth-recent-card--single"
                onClick={() => handleRecentLoginSelect(primaryRecentLogin)}
              >
                <div className="auth-recent-avatar auth-recent-avatar--large">
                  {primaryRecentLogin.avatarUrl ? (
                    <img src={primaryRecentLogin.avatarUrl} alt={primaryRecentLogin.label} />
                  ) : (
                    <span>{initialsForLogin(primaryRecentLogin.label)}</span>
                  )}
                </div>
                <span className="auth-recent-name">{primaryRecentLogin.label}</span>
              </button>
              {showRecentPassword && (
                <form
                  onSubmit={handleLogin}
                  className="auth-card auth-card--recent"
                >
                  <input
                    className="sr-only"
                    type="text"
                    name="username"
                    autoComplete="username"
                    value={
                      selectedRecentLogin?.identifier ||
                      primaryRecentLogin?.identifier ||
                      ""
                    }
                    readOnly
                    tabIndex={-1}
                    aria-hidden="true"
                  />
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
                      ref={passwordInputRef}
                    />
                  </div>
                  {error && <p className="auth-message error">{error}</p>}
                  {info && <p className="auth-message info">{info}</p>}
                  {showDebug && debugDetails && (
                    <details className="auth-debug">
                      <summary>Show error details</summary>
                      <pre>{debugDetails}</pre>
                    </details>
                  )}
                  {showDebug && (
                    <details className="auth-debug">
                      <summary>Auth debug</summary>
                      <pre>{authDebugText}</pre>
                    </details>
                  )}
                  <div className="auth-actions">
                    <button
                      type="submit"
                      className="btn primary"
                      disabled={loginLoading}
                    >
                      {loginLoading ? "Logging in..." : "Login"}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => navigate("/forgot-password")}
                    >
                      Forgot password?
                    </button>
                  </div>
                </form>
              )}
              <button
                type="button"
                className="auth-recent-switch"
                onClick={handleSwitchAccount}
              >
                Use another account
              </button>
            </section>
          )}
        </div>

        {showFullLoginForm && (
          <form
            onSubmit={isVerificationStep ? handleVerify : handleLogin}
            className="auth-card"
          >
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
                ref={passwordInputRef}
              />
            </div>

            <p className="auth-hint">
              If you have 2FA enabled, you will need to enter the code from your authenticator app.
            </p>

            {allowAlternateOnLogin && (
              <>
                <div className="sms-actions">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => setShowLoginAlternateOptions((prev) => !prev)}
                    disabled={alternateLoading || loginLoading || verifying}
                  >
                    Try another way
                  </button>
                </div>
                {showLoginAlternateOptions && (
                  <div className="sms-actions">
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => void handleTryAnotherWay("totp")}
                      disabled={alternateLoading || loginLoading || verifying}
                    >
                      {alternateLoading && alternateMethod === "totp"
                        ? "Starting..."
                        : "Use authenticator app"}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => void handleTryAnotherWay("email")}
                      disabled={alternateLoading || loginLoading || verifying}
                    >
                      {alternateLoading && alternateMethod === "email"
                        ? "Sending..."
                        : "Send code to email"}
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => void handleTryAnotherWay("sms")}
                      disabled={alternateLoading || loginLoading || verifying}
                    >
                      {alternateLoading && alternateMethod === "sms"
                        ? "Sending..."
                        : "Send code to phone"}
                    </button>
                  </div>
                )}
              </>
            )}

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
              <button
                type="button"
                className="btn ghost"
                onClick={() => setShowAlternateOptions((prev) => !prev)}
                disabled={alternateLoading || loginLoading || verifying}
              >
                Try another way
              </button>
              <button type="button" className="btn ghost" onClick={handleBack}>
                Back to login
              </button>
            </div>
            {showAlternateOptions && (
              <div className="sms-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void handleTryAnotherWay("totp")}
                  disabled={
                    alternateLoading ||
                    loginLoading ||
                    verifying ||
                    challengeMethod === "totp"
                  }
                >
                  {alternateLoading && alternateMethod === "totp"
                    ? "Starting..."
                    : "Use authenticator app"}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void handleTryAnotherWay("email")}
                  disabled={
                    alternateLoading ||
                    loginLoading ||
                    verifying ||
                    challengeMethod === "email"
                  }
                >
                  {alternateLoading && alternateMethod === "email"
                    ? "Sending..."
                    : "Send code to email"}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void handleTryAnotherWay("sms")}
                  disabled={
                    alternateLoading ||
                    loginLoading ||
                    verifying ||
                    challengeMethod === "sms"
                  }
                >
                  {alternateLoading && alternateMethod === "sms"
                    ? "Sending..."
                    : "Send code to phone"}
                </button>
              </div>
            )}
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
        {showDebug && (
          <details className="auth-debug">
            <summary>Auth debug</summary>
            <pre>{authDebugText}</pre>
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
        )}
      </div>

      {trustModalOpen && (
        <div
          className="auth-trust-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="trust-device-title"
          aria-describedby="trust-device-desc"
        >
          <div className="auth-trust-modal">
            <div className="auth-trust-hero">
              <div className="auth-trust-art" aria-hidden="true">
                <svg viewBox="0 0 140 140" role="img" aria-label="">
                  <rect x="46" y="16" width="54" height="96" rx="12" fill="#0b0f1c" />
                  <rect
                    x="52"
                    y="24"
                    width="42"
                    height="72"
                    rx="8"
                    fill="#1d2a4a"
                  />
                  <rect x="60" y="102" width="26" height="6" rx="3" fill="#2b3a60" />
                  <path
                    d="M24 82c0-10 8-18 18-18h18c8 0 14 6 14 14v30c0 8-6 14-14 14H42c-10 0-18-8-18-18V82Z"
                    fill="#f2d6c7"
                  />
                  <path
                    d="M56 64c0-6 5-10 10-10h12c6 0 10 4 10 10v20c0 6-4 10-10 10H66c-6 0-10-4-10-10V64Z"
                    fill="#e9c3b1"
                  />
                  <path
                    d="M36 70c-5 0-9 4-9 9v18c0 5 4 9 9 9h18"
                    stroke="#d9b09e"
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div>
                <h2 id="trust-device-title">You're logged in</h2>
                <p id="trust-device-desc">Do you want to trust this device?</p>
              </div>
            </div>
            <div className="auth-trust-device">
              <span className="auth-trust-label">Trusted device name</span>
              <strong>{trustDeviceLabel}</strong>
            </div>
            {trustModalError && <p className="auth-message error">{trustModalError}</p>}
            <div className="auth-trust-actions">
              <button
                type="button"
                className="btn primary"
                onClick={handleTrustDevice}
                disabled={trustModalLoading}
              >
                {trustModalLoading ? "Trusting..." : "Trust this device"}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={handleAlwaysConfirm}
                disabled={trustModalLoading}
              >
                Always confirm it's me
              </button>
            </div>
          </div>
        </div>
      )}

      {showAgeVerifyModal && (
        <div className="auth-age-overlay" role="dialog" aria-modal="true">
          <div className="auth-age-modal">
            <div className="auth-age-header">
              <div>
                <h2>
                  {ageLockEnforced
                    ? "Account locked: age verification overdue"
                    : "Verify your age to unlock"}
                </h2>
                <p>
                  {ageLockEnforced
                    ? "Your account stays locked until age verification is completed or a moderator/admin unlocks it."
                    : "You can verify without logging in. We’ll unlock your account after verification."}
                </p>
              </div>
              {!ageLockEnforced && (
                <button
                  type="button"
                  className="auth-age-close"
                  onClick={closeAgeVerifyModal}
                >
                  X
                </button>
              )}
            </div>
            <div className="auth-age-body">
              {ageLockEnforced && (
                <p className="auth-message error">
                  Need help unlocking? Contact support at{" "}
                  <a href={`mailto:${ageLockSupportEmail}`}>{ageLockSupportEmail}</a>.
                </p>
              )}
              <label className="field">
                <span>Email or phone number</span>
                <input
                  className="auth-input"
                  type="text"
                  placeholder="Enter the email or phone on your account"
                  value={ageVerifyContact}
                  onChange={(e) => setAgeVerifyContact(e.target.value)}
                />
              </label>
              <div className="auth-age-card">
                <div className="auth-age-info">
                  <div
                    className={`auth-age-status ${
                      ageSessionStatus === "verified"
                        ? "verified"
                        : ageSessionStatus === "failed" || ageSessionStatus === "denied"
                        ? "failed"
                        : ageSessionStatus !== "idle"
                        ? "pending"
                        : ""
                    }`}
                  >
                    {ageSessionStatus === "verified"
                      ? "Verified"
                      : ageSessionStatus === "processing"
                      ? "Processing..."
                      : ageSessionStatus === "pending"
                      ? "Pending"
                      : ageSessionStatus === "failed"
                      ? "Failed"
                      : ageSessionStatus === "denied"
                      ? "Denied"
                      : "Not started"}
                  </div>
                  <div className="auth-age-actions">
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => createAgeSession()}
                      disabled={ageSessionLoading}
                    >
                      {ageSessionLoading ? "Starting..." : "Start verification"}
                    </button>
                    {ageMobileUrl && (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => {
                          void navigator.clipboard?.writeText(ageMobileUrl);
                        }}
                      >
                        Copy link
                      </button>
                    )}
                  </div>
                  {ageMobileUrl && (
                    <div className="auth-age-link">
                      <span>Mobile link</span>
                      <a href={ageMobileUrl} target="_blank" rel="noreferrer">
                        {ageMobileUrl}
                      </a>
                    </div>
                  )}
                  {ageSessionError && <p className="auth-message error">{ageSessionError}</p>}
                  {ageVerifyApplying && (
                    <p className="auth-message info">Applying verification...</p>
                  )}
                </div>
                {ageQrUrl && (
                  <div className="auth-age-qr">
                    <QRCodeCanvas value={ageQrUrl} size={160} includeMargin />
                    <span>Scan to continue</span>
                  </div>
                )}
              </div>
            </div>
            {!ageLockEnforced && (
              <div className="auth-age-footer">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={closeAgeVerifyModal}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
