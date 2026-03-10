import "../css/landing.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { gsap } from "gsap";
import { QRCodeCanvas } from "qrcode.react";
import axios from "axios";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { usePageMeta } from "../hooks/usePageMeta";
import { useTranslation } from "../i18n/TranslationProvider";
import { TERMS_SECTIONS, TERMS_TITLE, TERMS_UPDATED } from "../content/terms";
import {
  buildProfilePayloadFromAttrs,
  decryptOwnProfilePayload,
  type ProfilePayload,
} from "../utils/profile-e2ee";
import { pickMediaUrl } from "../utils/media";
import { trackEvent } from "../utils/analytics";
import type { AuthResponse, LoginStartResponse, RegisterResponse } from "../types/auth";
import { getOrCreateDeviceId } from "../utils/device-id";
import { getDefaultDeviceLabel } from "../utils/device-approval";
import {
  extractNationalDigits,
  formatPhoneInput,
  normalizeDialCode,
} from "../utils/phone";
import {
  AGE_VERIFY_API_BASE,
  AGE_VERIFY_PUBLIC_URL,
  launchAgeVerifyIfMobile,
} from "../utils/age-verify";
import SiteFooter from "../components/SiteFooter";

type ProfileSummary = {
  displayName: string;
  avatarUrl?: string;
  handle?: string;
};

type VerificationMethod = "sms" | "email" | "totp";
type ContactType = "email" | "phone";
type RecentLoginEntry = {
  id: number;
  label: string;
  identifier: string;
  handle?: string | null;
  avatarUrl?: string | null;
  lastUsedAt: number;
};

type LocationOption = {
  name: string;
  code: string;
  phoneCode?: string;
};

type ParsedContact =
  | { type: "email"; email: string }
  | { type: "phone"; phone: string; national: string; dialCode: string };

type ParsedInlineAuthError = {
  status: number | null;
  message: string;
  messageLower: string;
  code: string | null;
  supportEmail: string | null;
};

type IntentKey = "build-habit" | "stay-connected" | "find-accountability";
type PolicyModalKey = "privacy" | "cookies";

const RECENT_LOGINS_KEY = "auth:recent-logins";
const MAX_RECENT_LOGINS = 4;
const AGE_VERIFICATION_LOCK_CODE = "AGE_VERIFICATION_LOCKED";
const AGE_VERIFICATION_LOCK_REASON = "age_verification_required";
const DEFAULT_SUPPORT_EMAIL = String(
  import.meta.env.VITE_SUPPORT_EMAIL || "support@yoursocialplace.com"
).trim();
const LANDING_CAROUSEL_MIN_SPIN_MS = 1000;
const LANDING_CAROUSEL_MAX_SPIN_MS = 4000;
const LANDING_CAROUSEL_MIN_SWITCH_INTERVAL_MS = 3000;
const LANDING_CAROUSEL_MAX_SWITCH_INTERVAL_MS = 5000;
const LANDING_CAROUSEL_TRACK_REPEAT = 12;
const LANDING_MAX_DISPLAY_NAME_CHARS = 15;
const SMS_CONSENT_TEXT =
  "I agree to receive SMS security and marketplace alerts (U.S. only). Reply STOP to opt out.";
const LANDING_CAROUSEL_CAPTIONS = [
  "Real people. Real wins.",
  "Trust starts with shared momentum.",
  "Supportive people, zero fluff.",
  "Small wins become big progress.",
  "Encouragement you can count on.",
] as const;
const LANDING_CAROUSEL_ASSET_VERSION = "2026-02-23d";
const LANDING_BRAND_LOGO_SRC = "/logo2.png?v=2026-02-23d";
const LANDING_BRAND_LOGO_FALLBACK = "/logo2.png";
const LANDING_CAROUSEL_HIGH_QUALITY_SOURCES = Array.from(
  { length: 20 },
  (_, index) =>
    `/landing-carousel/happy-${String(index + 1).padStart(2, "0")}.jpg?v=${LANDING_CAROUSEL_ASSET_VERSION}`
);
const LANDING_CAROUSEL_SOURCES = LANDING_CAROUSEL_HIGH_QUALITY_SOURCES;
const LANDING_CAROUSEL_SLIDES = LANDING_CAROUSEL_SOURCES.map((src, index) => ({
  src,
  caption: LANDING_CAROUSEL_CAPTIONS[index % LANDING_CAROUSEL_CAPTIONS.length],
}));

const buildCarouselSpinOrder = (count: number, lastIndex: number) => {
  const order = Array.from({ length: count }, (_, index) => index);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (count > 1 && order[0] === lastIndex) {
    [order[0], order[1]] = [order[1], order[0]];
  }
  return order;
};

const slugifyHandle = (value: string) =>
  value
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const normalizeEntity = (entry: any) => entry?.attributes ?? entry ?? {};

const toTitleWord = (value: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 1).toUpperCase() + trimmed.slice(1).toLowerCase();
};

const fullNameFromParts = (firstName?: string | null, lastName?: string | null) =>
  `${String(firstName || "").trim()} ${String(lastName || "").trim()}`.trim();

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

const sanitizeRedirectTarget = (value: string | null) => {
  const trimmed = String(value || "").trim();
  if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("/login") || lowered.startsWith("/register")) {
    return null;
  }
  return trimmed;
};

const truncateDisplayName = (value: string, maxChars = LANDING_MAX_DISPLAY_NAME_CHARS) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  const chars = Array.from(trimmed);
  if (chars.length <= maxChars) return trimmed;
  return `${chars.slice(0, maxChars).join("")}....`;
};

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

const isDuplicateContactError = (message: string) => {
  const lower = String(message || "").toLowerCase();
  if (!lower) return false;
  return lower.includes("already in use") && (lower.includes("email") || lower.includes("phone"));
};

const isContactLikeLabel = (value: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  if (isValidEmail(trimmed)) return true;
  if (/^phone[-_\s:]*\d+$/i.test(trimmed)) return true;
  if (/^\+?\d[\d\s().-]{6,}$/.test(trimmed)) return true;
  return false;
};

const deriveNameFromHandle = (value?: string | null) => {
  const cleaned = String(value || "")
    .trim()
    .replace(/^@+/, "");
  if (!cleaned) return null;
  const tokens = cleaned
    .split(/[^a-zA-Z]+/g)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length < 2) return null;
  return `${toTitleWord(tokens[0])} ${toTitleWord(tokens[1])}`;
};

const sanitizeRecentLabel = (value: string, id: number, handle?: string | null) => {
  const trimmed = String(value || "").trim();
  if (trimmed && !isContactLikeLabel(trimmed) && /\s+/.test(trimmed)) {
    return trimmed;
  }
  const fallbackFromHandle = deriveNameFromHandle(handle);
  if (fallbackFromHandle) return fallbackFromHandle;
  return `Member ${id}`;
};

const sanitizeRecentHandle = (value?: string | null) => {
  const trimmed = String(value || "")
    .trim()
    .replace(/^@+/, "");
  if (!trimmed || isContactLikeLabel(trimmed)) return null;
  return trimmed;
};

const loadRecentLogins = (): RecentLoginEntry[] => {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(RECENT_LOGINS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length <= 0) return [];
    const entries = parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => {
        const id = Number(entry.id);
        const handle = sanitizeRecentHandle(entry.handle ? String(entry.handle) : null);
        return {
          id,
          label: sanitizeRecentLabel(String(entry.label || "").trim(), id, handle),
          identifier: String(entry.identifier || "").trim().toLowerCase(),
          handle,
          avatarUrl: entry.avatarUrl ? String(entry.avatarUrl) : null,
          lastUsedAt: Number(entry.lastUsedAt || 0),
        };
      })
      .filter(
        (entry) =>
          Number.isFinite(entry.id) &&
          entry.id > 0 &&
          Boolean(entry.identifier)
      )
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX_RECENT_LOGINS);
    return entries;
  } catch {
    return [];
  }
};

const serializeRecentLogins = (entries: RecentLoginEntry[]) =>
  JSON.stringify(
    entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      identifier: entry.identifier,
      handle: entry.handle ?? null,
      avatarUrl: entry.avatarUrl ?? null,
      lastUsedAt: entry.lastUsedAt,
    }))
  );

const fetchRecentProfileSnapshot = async (
  userId: number
): Promise<{
  label: string;
  handle: string | null;
  avatarUrl: string | null;
} | null> => {
  if (!Number.isFinite(userId) || userId <= 0) return null;
  try {
    const profileRes = await api.get(`/profiles?filters[user][id][$eq]=${userId}&populate=avatar`);
    const entry = profileRes.data?.data?.[0];
    if (!entry) return null;
    const attrs = normalizeEntity(entry);
    if (!attrs || Array.isArray(attrs)) return null;

    let payload: ProfilePayload | null = null;
    if (attrs.encryptedProfile) {
      try {
        payload = await decryptOwnProfilePayload(userId, attrs.encryptedProfile);
      } catch {
        payload = null;
      }
    }
    if (!payload) payload = buildProfilePayloadFromAttrs(attrs);

    const firstName = String(payload?.firstName || attrs.firstName || attrs.firstname || "").trim();
    const lastName = String(payload?.lastName || attrs.lastName || attrs.lastname || "").trim();
    const handle = sanitizeRecentHandle(attrs.handle ? String(attrs.handle) : null);
    const label = sanitizeRecentLabel(fullNameFromParts(firstName, lastName), userId, handle);
    const avatarField = attrs.avatar ?? entry?.avatar;
    const avatarUrl = pickMediaUrl(avatarField, { kind: "avatar" }) || null;
    return { label, handle, avatarUrl };
  } catch {
    return null;
  }
};

const parseInlineAuthError = (
  err: unknown,
  fallbackMessage: string
): ParsedInlineAuthError => {
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

export default function Landing() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, login } = useAuth();
  const { getBackgroundStyle } = useUserPreferences();
  const landingBackground = getBackgroundStyle("dashboard");
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [showInlineLogin, setShowInlineLogin] = useState(() => !user);
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeMethod, setChallengeMethod] = useState<VerificationMethod | null>(null);
  const [verificationCode, setVerificationCode] = useState("");
  const [deliveryHint, setDeliveryHint] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginInfo, setLoginInfo] = useState<string | null>(null);
  const [recentLogins, setRecentLogins] = useState<RecentLoginEntry[]>(() =>
    loadRecentLogins()
  );
  const [showAnotherProfileForm, setShowAnotherProfileForm] = useState(false);
  const [showRecentPasswordStep, setShowRecentPasswordStep] = useState(false);
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [signupForm, setSignupForm] = useState({
    firstName: "",
    lastName: "",
    contact: "",
    smsCode: "",
    password: "",
    confirmPassword: "",
    botField: "",
  });
  const [signupContactMode, setSignupContactMode] = useState<ContactType>("phone");
  const [signupPhoneDialCode, setSignupPhoneDialCode] = useState("1");
  const [signupDialCodeEditing, setSignupDialCodeEditing] = useState(false);
  const [signupCountryOptions, setSignupCountryOptions] = useState<LocationOption[]>([]);
  const [signupSelectedCountryCode, setSignupSelectedCountryCode] = useState("US");
  const [signupCountryError, setSignupCountryError] = useState<string | null>(null);
  const [signupTermsOpen, setSignupTermsOpen] = useState(false);
  const [signupPolicyModal, setSignupPolicyModal] = useState<PolicyModalKey | null>(null);
  const [signupSmsConsent, setSignupSmsConsent] = useState(false);
  const [signupSmsSending, setSignupSmsSending] = useState(false);
  const [signupSmsSent, setSignupSmsSent] = useState(false);
  const [signupSmsError, setSignupSmsError] = useState<string | null>(null);
  const [signupRegisteredMethod, setSignupRegisteredMethod] = useState<ContactType | null>(null);
  const [signupLoading, setSignupLoading] = useState(false);
  const [signupError, setSignupError] = useState<string | null>(null);
  const [signupInfo, setSignupInfo] = useState<string | null>(null);
  const [signupDuplicateModalOpen, setSignupDuplicateModalOpen] = useState(false);
  const [signupShowSuccessModal, setSignupShowSuccessModal] = useState(false);
  const [signupAccessNotice, setSignupAccessNotice] = useState<string | null>(null);
  const [carouselPosition, setCarouselPosition] = useState(0);
  const [carouselDurationMs, setCarouselDurationMs] = useState(0);
  const [carouselTransitionEnabled, setCarouselTransitionEnabled] = useState(false);
  const [carouselActiveIndex, setCarouselActiveIndex] = useState(0);
  const [ageSessionId, setAgeSessionId] = useState<string | null>(null);
  const [ageQrUrl, setAgeQrUrl] = useState<string | null>(null);
  const [ageMobileUrl, setAgeMobileUrl] = useState<string | null>(null);
  const [ageSessionStatus, setAgeSessionStatus] = useState<string>("idle");
  const [ageSessionError, setAgeSessionError] = useState<string | null>(null);
  const [ageSessionLoading, setAgeSessionLoading] = useState(false);
  const [ageModalOpen, setAgeModalOpen] = useState(false);
  const [ageLockEnforced, setAgeLockEnforced] = useState(false);
  const [ageLockSupportEmail, setAgeLockSupportEmail] = useState(DEFAULT_SUPPORT_EMAIL);
  const [trustModalOpen, setTrustModalOpen] = useState(false);
  const [trustModalLoading, setTrustModalLoading] = useState(false);
  const [trustModalError, setTrustModalError] = useState<string | null>(null);
  const [pendingInlineRedirect, setPendingInlineRedirect] = useState<string | null>(null);
  const [ageToken, setAgeToken] = useState<string | null>(null);
  const [ageVerifyContact, setAgeVerifyContact] = useState<string | null>(null);
  const [ageVerifyApplied, setAgeVerifyApplied] = useState(false);
  const [signupFormStart, setSignupFormStart] = useState(() => Date.now());
  const carouselPositionRef = useRef(0);
  const carouselOrderRef = useRef<number[]>([]);
  const carouselOrderPointerRef = useRef(0);
  const intentParam = useMemo(
    () => new URLSearchParams(location.search).get("intent"),
    [location.search]
  );
  const accessParam = useMemo(
    () => new URLSearchParams(location.search).get("access"),
    [location.search]
  );
  const ageVerificationTokenParam = useMemo(
    () => new URLSearchParams(location.search).get("ageVerificationToken"),
    [location.search]
  );
  const postAuthTarget = useMemo(
    () => sanitizeRedirectTarget(new URLSearchParams(location.search).get("redirect")),
    [location.search]
  );
  const switchProfileParam = useMemo(
    () => new URLSearchParams(location.search).get("switchProfile"),
    [location.search]
  );
  const switchProfileIdentifierParam = useMemo(
    () => String(new URLSearchParams(location.search).get("identifier") || "").trim().toLowerCase(),
    [location.search]
  );
  const forceSwitchProfileMode =
    switchProfileParam === "1" || String(switchProfileParam || "").toLowerCase() === "true";
  const trustDeviceLabel = useMemo(() => getDefaultDeviceLabel(), []);
  const intentKey = useMemo(() => normalizeIntent(intentParam), [intentParam]);
  const signupContactDetails = useMemo(
    () => parseContact(signupForm.contact, signupPhoneDialCode),
    [signupForm.contact, signupPhoneDialCode]
  );
  const signupSuccessMessage = useMemo(() => {
    const method = signupRegisteredMethod ?? signupContactDetails?.type;
    if (method === "phone") {
      return "Thanks for registering! You can now log in with your phone number and password.";
    }
    return "Thank you for registering with Your Social Place. Enter the 6-digit code sent to your email to finish setup.";
  }, [signupRegisteredMethod, signupContactDetails?.type]);
  const carouselFrames = useMemo(
    () =>
      Array.from(
        { length: LANDING_CAROUSEL_SLIDES.length * LANDING_CAROUSEL_TRACK_REPEAT },
        (_, index) => LANDING_CAROUSEL_SLIDES[index % LANDING_CAROUSEL_SLIDES.length]
      ),
    []
  );
  const policyModalMeta = useMemo(() => {
    const origin =
      typeof window !== "undefined" ? window.location.origin : "https://yoursocialplace.com";
    return {
      privacy: {
        title: "Privacy Policy",
        route: "/privacy",
        fullUrl: `${origin}/privacy`,
        summary:
          "How we collect, use, share, and protect account and profile information.",
      },
      cookies: {
        title: "Cookie Policy",
        route: "/cookies",
        fullUrl: `${origin}/cookies`,
        summary:
          "How cookies and analytics preferences work, plus controls for enabling or declining analytics.",
      },
    } as const;
  }, []);

  usePageMeta({
    title: "Motivational Social Network | Your Social Place",
    description:
      "Your Social Place is a motivational social network for accountability with live video calls, screen sharing, real-time chat, groups, and Newsroom updates.",
    type: "website",
    canonical: "https://yoursocialplace.com/",
    keywords:
      "Your Social Place, motivational social network, accountability, goals, progress, friends, groups, live video calls, screen sharing, real-time chat, Newsroom, moderation, privacy controls, PWA",
    image: "https://yoursocialplace.com/logo2.png",
    imageAlt: "Your Social Place logo",
  });

  useEffect(() => {
    if (accessParam) {
      const messageMap: Record<string, string> = {
        forums: "You must register and login to access forums.",
      };
      const notice = messageMap[accessParam] || "You must register and login.";
      setSignupAccessNotice(notice);
    } else {
      setSignupAccessNotice(null);
    }
  }, [accessParam]);

  useEffect(() => {
    if (ageVerificationTokenParam) {
      setAgeToken(ageVerificationTokenParam);
      setAgeSessionStatus("verified");
    }
  }, [ageVerificationTokenParam]);

  useEffect(() => {
    let active = true;
    const loadCountries = async () => {
      try {
        const res = await api.get("/locations/countries");
        const list: LocationOption[] = (res.data?.data ?? []).map(
          (country: {
            name?: string;
            code?: string;
            isoCode?: string;
            phoneCode?: string;
            phonecode?: string;
          }) => ({
            name: country.name || "",
            code: country.code || country.isoCode || "",
            phoneCode: country.phoneCode || country.phonecode || "",
          })
        );
        const usIndex = list.findIndex((country: LocationOption) => {
          const name = String(country.name || "").trim().toLowerCase();
          return (
            String(country.code || "").toUpperCase() === "US" ||
            name === "united states" ||
            name === "united states of america"
          );
        });
        const ordered =
          usIndex > 0
            ? [list[usIndex], ...list.slice(0, usIndex), ...list.slice(usIndex + 1)]
            : list;
        if (active) {
          setSignupCountryOptions(ordered);
          setSignupCountryError(null);
          const defaultCountry =
            ordered.find(
              (country: LocationOption) =>
                String(country.code || "").toUpperCase() === "US"
            ) || ordered[0];
          if (defaultCountry?.code) {
            setSignupSelectedCountryCode(defaultCountry.code);
          }
          if (defaultCountry?.phoneCode) {
            setSignupPhoneDialCode(normalizeDialCode(defaultCountry.phoneCode) || "1");
          }
        }
      } catch {
        if (active) setSignupCountryError("Unable to load country list.");
      }
    };
    void loadCountries();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (signupContactMode !== "phone") return;
    setSignupForm((current) => {
      const formatted = formatPhoneInput(
        extractNationalDigits(current.contact, signupPhoneDialCode),
        signupPhoneDialCode
      );
      if (formatted === current.contact) return current;
      return { ...current, contact: formatted };
    });
  }, [signupContactMode, signupPhoneDialCode]);

  useEffect(() => {
    if (signupContactMode === "phone") return;
    if (signupSmsConsent) setSignupSmsConsent(false);
  }, [signupContactMode, signupSmsConsent]);

  useEffect(() => {
    if (signupContactMode === "phone") return;
    if (signupDialCodeEditing) setSignupDialCodeEditing(false);
  }, [signupContactMode, signupDialCodeEditing]);

  useEffect(() => {
    if (!ageSessionId || ageToken) return;
    let active = true;
    const poll = async () => {
      try {
        const res = await fetch(`${AGE_VERIFY_API_BASE}/session/${ageSessionId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Unable to check status.");
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
        if (active) {
          setAgeSessionError(err?.message || "Unable to check status.");
        }
      }
    };
    void poll();
    const timer = window.setInterval(poll, 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [ageSessionId, ageToken]);

  useEffect(() => {
    if (!ageToken || !ageVerifyContact || ageVerifyApplied) return;
    let active = true;
    const applyToken = async () => {
      try {
        await api.post("/auth/age/verify-registration", {
          token: ageToken,
          contact: ageVerifyContact,
        });
        if (active) {
          setAgeVerifyApplied(true);
          setAgeLockEnforced(false);
          setAgeLockSupportEmail(DEFAULT_SUPPORT_EMAIL);
        }
      } catch (err: any) {
        const message =
          err?.response?.data?.error?.message ||
          err?.response?.data?.message ||
          err?.message ||
          "Unable to apply age verification.";
        if (active) setAgeSessionError(message);
      }
    };
    void applyToken();
    return () => {
      active = false;
    };
  }, [ageToken, ageVerifyContact, ageVerifyApplied]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.75 } });
      tl.from(".landing-left-brand", { y: -14, opacity: 0, duration: 0.45 });
      tl.from(".landing-artboard", { y: 18, opacity: 0 }, "-=0.15");
      tl.from(
        ".landing-tagline",
        { y: 18, opacity: 0, rotateX: 8, transformPerspective: 900 },
        "-=0.25"
      );
      tl.from(".landing-account-panel", { x: 16, opacity: 0 }, "-=0.25");
    }, root);

    return () => ctx.revert();
  }, []);

  useEffect(() => {
    trackEvent("landing_viewed", { logged_in: Boolean(user) });
  }, [user]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!carouselFrames.length) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const slideCount = LANDING_CAROUSEL_SLIDES.length;
    const maxPosition = carouselFrames.length - slideCount - 1;
    carouselOrderRef.current = [];
    carouselOrderPointerRef.current = 0;
    let spinTimer: number | null = null;
    let cancelled = false;

    const clearSpinTimer = () => {
      if (spinTimer) {
        window.clearTimeout(spinTimer);
        spinTimer = null;
      }
    };

    const scheduleSpin = (delayMs: number, callback: () => void) => {
      clearSpinTimer();
      spinTimer = window.setTimeout(() => {
        if (cancelled) return;
        callback();
      }, delayMs);
    };

    const randomDuration = () =>
      Math.floor(
        LANDING_CAROUSEL_MIN_SPIN_MS +
          Math.random() * (LANDING_CAROUSEL_MAX_SPIN_MS - LANDING_CAROUSEL_MIN_SPIN_MS)
      );
    const randomSwitchInterval = () =>
      Math.floor(
        LANDING_CAROUSEL_MIN_SWITCH_INTERVAL_MS +
          Math.random() *
            (LANDING_CAROUSEL_MAX_SWITCH_INTERVAL_MS -
              LANDING_CAROUSEL_MIN_SWITCH_INTERVAL_MS)
      );

    const resolveNextTargetIndex = (currentIndex: number) => {
      if (
        carouselOrderRef.current.length !== slideCount ||
        carouselOrderPointerRef.current >= carouselOrderRef.current.length
      ) {
        carouselOrderRef.current = buildCarouselSpinOrder(slideCount, currentIndex);
        carouselOrderPointerRef.current = 0;
      }
      const targetIndex = carouselOrderRef.current[carouselOrderPointerRef.current];
      carouselOrderPointerRef.current += 1;
      return targetIndex;
    };

    const runSpin = () => {
      if (cancelled) return;
      const start = carouselPositionRef.current;
      const nearEnd = start > maxPosition - slideCount * 5;
      const executeSpin = (from: number) => {
        const durationMs = randomDuration();
        const fromIndex = ((from % slideCount) + slideCount) % slideCount;
        const targetIndex = resolveNextTargetIndex(fromIndex);
        const delta = (targetIndex - fromIndex + slideCount) % slideCount || slideCount;
        const loops = 1 + Math.floor(Math.random() * 3);
        const stepCount = loops * slideCount + delta;
        const nextPosition = from + stepCount;
        setCarouselTransitionEnabled(true);
        setCarouselDurationMs(durationMs);
        setCarouselPosition(nextPosition);
        carouselPositionRef.current = nextPosition;
        setCarouselActiveIndex(targetIndex);
        const nextSwitchIntervalMs = randomSwitchInterval();
        const pauseMs = Math.max(0, nextSwitchIntervalMs - durationMs);
        scheduleSpin(durationMs + pauseMs, runSpin);
      };

      if (!nearEnd) {
        executeSpin(start);
        return;
      }

      const normalized = start % slideCount;
      setCarouselTransitionEnabled(false);
      setCarouselDurationMs(0);
      setCarouselPosition(normalized);
      carouselPositionRef.current = normalized;
      setCarouselActiveIndex(normalized);

      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (cancelled) return;
          executeSpin(normalized);
        });
      });
    };

    scheduleSpin(700, runSpin);

    return () => {
      cancelled = true;
      clearSpinTimer();
    };
  }, [carouselFrames.length]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const syncRecentLogin = () => {
      setRecentLogins(loadRecentLogins());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== RECENT_LOGINS_KEY) return;
      syncRecentLogin();
    };
    window.addEventListener("storage", onStorage);
    syncRecentLogin();
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!recentLogins.length) return;
    const needsRefresh = recentLogins.some(
      (entry) =>
        !entry.avatarUrl ||
        isContactLikeLabel(entry.label) ||
        /^member\s+\d+$/i.test(String(entry.label || "").trim()) ||
        !/\s+/.test(String(entry.label || "").trim())
    );
    if (!needsRefresh) return;

    let cancelled = false;
    const enrichRecentProfiles = async () => {
      const enriched = await Promise.all(
        recentLogins.map(async (entry) => {
          const profileSnapshot = await fetchRecentProfileSnapshot(entry.id);
          const handle = sanitizeRecentHandle(profileSnapshot?.handle ?? entry.handle ?? null);
          return {
            ...entry,
            label: sanitizeRecentLabel(profileSnapshot?.label ?? entry.label, entry.id, handle),
            handle,
            avatarUrl: profileSnapshot?.avatarUrl ?? entry.avatarUrl ?? null,
          };
        })
      );
      if (cancelled) return;
      const nextEntries = enriched
        .sort((a, b) => Number(b?.lastUsedAt || 0) - Number(a?.lastUsedAt || 0))
        .slice(0, MAX_RECENT_LOGINS);
      if (serializeRecentLogins(nextEntries) === serializeRecentLogins(recentLogins)) return;
      window.localStorage.setItem(RECENT_LOGINS_KEY, JSON.stringify(nextEntries));
      setRecentLogins(nextEntries);
    };

    void enrichRecentProfiles();
    return () => {
      cancelled = true;
    };
  }, [recentLogins]);

  useEffect(() => {
    if (!user) {
      setProfileSummary(null);
      return;
    }

    const loadProfile = async () => {
      try {
        const res = await api.get("/profiles/me?populate=avatar");
        const data = res.data?.data;
        const entry = Array.isArray(data) ? data[0] : data;
        const attrs = normalizeEntity(entry);
        if (!attrs || Array.isArray(attrs)) return;

        let payload: ProfilePayload | null = null;
        if (attrs.encryptedProfile) {
          try {
            payload = await decryptOwnProfilePayload(user.id, attrs.encryptedProfile);
          } catch {
            payload = null;
          }
        }
        if (!payload) payload = buildProfilePayloadFromAttrs(attrs);

        const displayName =
          payload.firstName || payload.lastName
            ? `${payload.firstName || ""} ${payload.lastName || ""}`.trim()
            : attrs.handle || user.email;

        setProfileSummary({
          displayName,
          handle: attrs.handle || user.email,
          avatarUrl: pickMediaUrl(attrs.avatar, { kind: "avatar" }),
        });
      } catch {
        setProfileSummary({
          displayName: user.email || "Account",
          handle: user.email || "account",
        });
      }
    };

    void loadProfile();
  }, [user]);

  const nameForDisplay = useMemo(() => {
    if (profileSummary?.displayName) return profileSummary.displayName;
    if (user?.email) return user.email;
    return "Welcome back";
  }, [profileSummary?.displayName, user?.email]);
  const nameForDisplayShort = useMemo(
    () => truncateDisplayName(nameForDisplay),
    [nameForDisplay]
  );

  const recentLogin = recentLogins[0] ?? null;
  const profileInitial = nameForDisplay.slice(0, 1).toUpperCase() || "Y";
  const loginInitial = identifier.trim().slice(0, 1).toUpperCase() || "W";
  const signupInitial = signupForm.firstName.trim().slice(0, 1).toUpperCase() || "Y";
  const showWelcomeCard = Boolean(user) && !showInlineLogin;
  const hasRecentLogin = Boolean(!user && recentLogin);
  const useRecentLogin = Boolean(!user && recentLogin && !showAnotherProfileForm);
  const showRecentActionCard = Boolean(
    useRecentLogin && !challengeId && !showRecentPasswordStep && !showRegisterForm
  );
  const showBackToRecent = Boolean(
    !challengeId && hasRecentLogin && (showRecentPasswordStep || showAnotherProfileForm)
  );
  const recentName = recentLogin?.label || "Welcome back";
  const recentNameShort = useMemo(() => truncateDisplayName(recentName), [recentName]);
  const recentInitial = recentName.slice(0, 1).toUpperCase() || loginInitial;
  const selectedRecentProfile = useMemo(() => {
    const normalized = identifier.trim().toLowerCase();
    if (!normalized) return null;
    return (
      recentLogins.find(
        (entry) => String(entry.identifier || "").trim().toLowerCase() === normalized
      ) ?? null
    );
  }, [identifier, recentLogins]);
  const selectedRecentInitial =
    selectedRecentProfile?.label?.trim().slice(0, 1).toUpperCase() || loginInitial;
  const loginCardTitle = challengeId
    ? "Verify your login"
    : showRegisterForm
    ? "Create new account"
    : showAnotherProfileForm
    ? "Use another profile"
    : recentNameShort;
  const canQuickLoginFromAvatar = Boolean(
    showRecentActionCard && recentLogin?.identifier && !loginLoading
  );

  useEffect(() => {
    if (user || !useRecentLogin || !recentLogin?.identifier) return;
    setIdentifier((current) => (current.trim() ? current : recentLogin.identifier));
  }, [user, useRecentLogin, recentLogin?.identifier]);

  const resetVerificationState = () => {
    setChallengeId(null);
    setChallengeMethod(null);
    setVerificationCode("");
    setDeliveryHint(null);
    setResending(false);
  };

  const clearInlineMessages = () => {
    setLoginError(null);
    setLoginInfo(null);
  };

  const clearSignupMessages = () => {
    setSignupError(null);
    setSignupInfo(null);
  };

  const handleClearSavedProfile = () => {
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(RECENT_LOGINS_KEY);
    }
    setRecentLogins([]);
    setShowAnotherProfileForm(false);
    setShowRecentPasswordStep(false);
    setShowRegisterForm(false);
    setIdentifier("");
    setPassword("");
    setSignupShowSuccessModal(false);
    setSignupDuplicateModalOpen(false);
    setSignupAccessNotice(null);
    setSignupTermsOpen(false);
    setAgeModalOpen(false);
    setAgeLockEnforced(false);
    setAgeLockSupportEmail(DEFAULT_SUPPORT_EMAIL);
    setTrustModalOpen(false);
    setTrustModalError(null);
    setPendingInlineRedirect(null);
    clearInlineMessages();
    clearSignupMessages();
    resetVerificationState();
  };

  const handleSignupContactChange = (value: string) => {
    const nextMode = detectContactMode(value, signupContactMode);
    setSignupContactMode(nextMode);
    setSignupForm((current) => {
      const nextContact =
        nextMode === "phone"
          ? formatPhoneInput(extractNationalDigits(value, signupPhoneDialCode), signupPhoneDialCode)
          : value;
      return {
        ...current,
        contact: nextContact,
        ...(nextMode !== "phone" ? { smsCode: "" } : {}),
      };
    });
    setSignupSmsSent(false);
    setSignupSmsError(null);
  };

  const handleSignupChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = event.target;
    if (name === "contact") {
      handleSignupContactChange(value);
      clearSignupMessages();
      return;
    }
    setSignupForm((current) => ({ ...current, [name]: value }));
    clearSignupMessages();
  };

  const handleSignupSendSms = async () => {
    const contact = parseContact(signupForm.contact, signupPhoneDialCode);
    if (!contact || contact.type !== "phone" || !contact.phone) {
      setSignupSmsError("Enter a valid phone number to send a code.");
      return;
    }
    setSignupSmsError(null);
    setSignupSmsSending(true);
    try {
      await api.post("/auth/sms/send", { phoneNumber: contact.phone, purpose: "register" });
      setSignupSmsSent(true);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const msg =
          (err.response?.data as any)?.error?.message ||
          (err.response?.data as any)?.message ||
          "Unable to send SMS code.";
        setSignupSmsError(msg);
      } else {
        setSignupSmsError("Unable to send SMS code.");
      }
    } finally {
      setSignupSmsSending(false);
    }
  };

  const handleSignupDialCodeSelect = (countryCode: string) => {
    setSignupSelectedCountryCode(countryCode);
    const match = signupCountryOptions.find(
      (country) => String(country.code || "").toUpperCase() === countryCode.toUpperCase()
    );
    const nextDial = normalizeDialCode(match?.phoneCode || "");
    if (nextDial) {
      setSignupPhoneDialCode(nextDial);
    }
    setSignupDialCodeEditing(false);
  };

  const createAgeSession = async (options?: { launchOnMobile?: boolean }) => {
    setAgeSessionError(null);
    setAgeSessionLoading(true);
    try {
      const returnUrl = `${window.location.origin}/`;
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
      if (options?.launchOnMobile && launchAgeVerifyIfMobile(nextMobileUrl)) {
        return;
      }
    } catch (err: any) {
      setAgeSessionError(err?.message || "Unable to start age verification.");
    } finally {
      setAgeSessionLoading(false);
    }
  };

  const startAgeVerification = () => {
    if (launchAgeVerifyIfMobile(ageMobileUrl)) {
      return;
    }
    void createAgeSession({ launchOnMobile: true });
  };

  const closeAgeModal = () => {
    if (ageLockEnforced) return;
    setAgeModalOpen(false);
    setAgeLockEnforced(false);
    setAgeLockSupportEmail(DEFAULT_SUPPORT_EMAIL);
  };

  const openAgeModal = (options?: {
    contactOverride?: string | null;
    lockEnforced?: boolean;
    supportEmail?: string | null;
  }) => {
    const nextSupport =
      String(options?.supportEmail || "").trim() || DEFAULT_SUPPORT_EMAIL;
    const nextContact = String(
      options?.contactOverride || ageVerifyContact || identifier || ""
    ).trim();
    setAgeLockEnforced(Boolean(options?.lockEnforced));
    setAgeLockSupportEmail(nextSupport);
    setAgeVerifyContact(nextContact || null);
    setAgeModalOpen(true);
    if (!ageSessionId && !ageSessionLoading) {
      void createAgeSession();
    }
  };

  const persistRecentLogin = async (
    account: AuthResponse["user"],
    identifierUsed?: string
  ) => {
    if (typeof window === "undefined" || !account?.id) return;
    const normalizedIdentifier = String(
      (identifierUsed || account.email || "")
    )
      .trim()
      .toLowerCase();
    if (!normalizedIdentifier) return;

    const profileSnapshot = await fetchRecentProfileSnapshot(account.id);
    const existing = loadRecentLogins();
    const existingMatch =
      existing.find((entry) => entry?.id === account.id) ??
      existing.find(
        (entry) =>
          String(entry?.identifier || "").trim().toLowerCase() === normalizedIdentifier
      ) ??
      null;

    const handle = sanitizeRecentHandle(profileSnapshot?.handle ?? existingMatch?.handle ?? null);
    const label = sanitizeRecentLabel(
      profileSnapshot?.label ?? existingMatch?.label ?? "",
      account.id,
      handle
    );
    const avatarUrl = profileSnapshot?.avatarUrl ?? existingMatch?.avatarUrl ?? null;

    const nextEntry: RecentLoginEntry = {
      id: account.id,
      label,
      identifier: normalizedIdentifier,
      handle,
      avatarUrl,
      lastUsedAt: Date.now(),
    };

    const merged = [
      nextEntry,
      ...existing.filter(
        (entry) =>
          Number(entry?.id) !== nextEntry.id &&
          String(entry?.identifier || "").toLowerCase() !== nextEntry.identifier
      ),
    ]
      .sort((a, b) => Number(b?.lastUsedAt || 0) - Number(a?.lastUsedAt || 0))
      .slice(0, MAX_RECENT_LOGINS);

    window.localStorage.setItem(RECENT_LOGINS_KEY, JSON.stringify(merged));
    setRecentLogins(merged);
  };

  const completeInlineLogin = (
    data: { jwt: string; user: AuthResponse["user"] },
    source: "password" | "verification" | "trusted",
    identifierUsed?: string
  ) => {
    const redirectTarget = postAuthTarget || "/dashboard";
    void persistRecentLogin(data.user, identifierUsed);
    login(data.user, data.jwt, { rememberDevice: false });
    resetVerificationState();
    clearInlineMessages();
    trackEvent("login_completed", { source: `landing_inline_${source}` });
    if (source === "trusted" || (data as AuthResponse).trustedDevice) {
      setTrustModalOpen(false);
      setPendingInlineRedirect(null);
      navigate(redirectTarget);
      return;
    }
    setPendingInlineRedirect(redirectTarget);
    setTrustModalError(null);
    setTrustModalOpen(true);
  };

  const applyInlineLoginResponse = (
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
      const baseMessage = data.deliveryHint
        ? `We sent a code to ${data.deliveryHint}.`
        : "We sent a verification code.";
      const fallbackMessage = data.totpInvalid
        ? `${baseMessage} Authenticator app is unavailable right now; re-link it in Settings after login.`
        : baseMessage;
      setLoginInfo(
        data.method === "totp"
          ? "Enter the code from your authenticator app."
          : fallbackMessage
      );
      return true;
    }

    if ("jwt" in data && data.jwt) {
      completeInlineLogin(data, "password", normalizedIdentifier);
      return true;
    }

    return false;
  };

  const resolveInlineLoginError = (err: unknown) => {
    const parsed = parseInlineAuthError(err, "Login failed. Please try again.");
    const lower = parsed.messageLower;
    const isAgeLock =
      parsed.code === AGE_VERIFICATION_LOCK_CODE ||
      parsed.code === AGE_VERIFICATION_LOCK_REASON ||
      (parsed.status === 403 &&
        String(parsed.message || "")
          .toLowerCase()
          .includes("age verification"));
    const supportEmail = parsed.supportEmail || DEFAULT_SUPPORT_EMAIL;

    if (lower.includes("invalid identifier") || lower.includes("invalid password")) {
      return {
        ...parsed,
        message: "Invalid email, phone number, or password.",
        supportEmail,
        isAgeLock: false,
      };
    }
    if (lower.includes("account locked") || lower.includes("too many failed")) {
      return {
        ...parsed,
        message: "Account locked for 24 hours due to too many failed login attempts.",
        supportEmail,
        isAgeLock: false,
      };
    }
    if (lower.includes("not confirmed") || lower.includes("confirm your email")) {
      return {
        ...parsed,
        message: "Please confirm your email before logging in.",
        supportEmail,
        isAgeLock: false,
      };
    }
    if (lower.includes("authenticator app is not configured")) {
      return {
        ...parsed,
        message: "Authenticator app is not configured. Use email/phone verification or re-enroll 2FA.",
        supportEmail,
        isAgeLock: false,
      };
    }
    if (isAgeLock) {
      return {
        ...parsed,
        message:
          parsed.code === AGE_VERIFICATION_LOCK_CODE
            ? `Age verification overdue. Your account is locked. Contact ${supportEmail} or complete verification to continue.`
            : "Age verification required. Verify your age to unlock your account.",
        supportEmail,
        isAgeLock: true,
      };
    }
    return {
      ...parsed,
      supportEmail,
      isAgeLock: false,
    };
  };

  const handleInlineRegisterSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    clearSignupMessages();
    setSignupDuplicateModalOpen(false);

    const firstName = signupForm.firstName.trim();
    const lastName = signupForm.lastName.trim();
    if (!firstName || !lastName) {
      setSignupError("First and last name are required.");
      return;
    }
    if (signupForm.botField) {
      setSignupError("Unable to register at this time.");
      return;
    }

    const contact = parseContact(signupForm.contact, signupPhoneDialCode);
    if (!contact) {
      setSignupError("Please enter a valid phone number or email.");
      return;
    }
    const hasSmsCode = Boolean(signupForm.smsCode.trim());
    const registrationPhone = contact.type === "phone" ? contact.national : "";
    const normalizedEmail = contact.type === "email" ? contact.email : "";
    const contactPayload =
      contact.type === "phone" ? contact.phone : normalizedEmail || signupForm.contact.trim();

    if (contact.type === "phone" && !signupSmsConsent) {
      setSignupError("Please consent to receive SMS security and marketplace alerts.");
      return;
    }

    if (signupForm.password !== signupForm.confirmPassword) {
      setSignupError("Passwords do not match.");
      return;
    }

    const passwordError = getPasswordError(signupForm.password);
    if (passwordError) {
      setSignupError(passwordError);
      return;
    }

    if (Date.now() - signupFormStart < 3000) {
      setSignupError("Please take a moment to review your info before signing up.");
      return;
    }

    try {
      setSignupLoading(true);
      trackEvent("signup_started", {
        source: "landing_inline_register",
        contact_type: contact.type,
        has_intent: Boolean(intentKey),
      });

      const response = await api.post<RegisterResponse>("/register", {
        contact: contactPayload,
        contactType: contact.type,
        firstName,
        lastName,
        email: contact.type === "email" ? normalizedEmail : undefined,
        phoneNumber: contact.type === "phone" ? contact.phone : undefined,
        smsCode: contact.type === "phone" && hasSmsCode ? signupForm.smsCode.trim() : undefined,
        password: signupForm.password,
        formStart: signupFormStart,
        botField: signupForm.botField,
        termsAccepted: true,
        intent: intentKey || undefined,
        smsConsent: contact.type === "phone" ? signupSmsConsent : false,
        smsConsentText: contact.type === "phone" ? SMS_CONSENT_TEXT : undefined,
        smsConsentSource: "register",
        ageVerificationToken: ageToken || undefined,
      });

      const lockedHandle =
        slugifyHandle(`${firstName} ${lastName}`) ||
        slugifyHandle(signupForm.contact) ||
        `user-${response.data.user.id}`;
      try {
        const profileLocation: Record<string, string> = {};
        if (firstName) profileLocation.firstName = firstName;
        if (lastName) profileLocation.lastName = lastName;
        if (registrationPhone) profileLocation.phone = registrationPhone;
        const registrationLocked: Record<string, boolean> = {};
        if (firstName) registrationLocked.firstName = true;
        if (lastName) registrationLocked.lastName = true;
        if (registrationPhone) registrationLocked.phone = true;
        await api.post("/profiles", {
          data: {
            handle: lockedHandle,
            user: response.data.user.id,
            locale: "en",
            preferredVerificationMethod: contact.type === "phone" ? "sms" : "email",
            ...profileLocation,
            ...(Object.keys(registrationLocked).length ? { registrationLocked } : {}),
          },
        });
      } catch {
        // ignore if profile already exists or creation fails
      }

      trackEvent("signup_completed", {
        source: "landing_inline_register",
        contact_type: contact.type,
        requires_confirmation: Boolean(response.data.requiresConfirmation),
      });

      if (response.data.requiresConfirmation && contact.type === "email") {
        const confirmationId = String(response.data.emailConfirmationId || "").trim();
        if (!confirmationId) {
          setSignupError("Unable to start email verification. Please try again.");
          return;
        }
        sessionStorage.setItem("emailConfirmationId", confirmationId);
        sessionStorage.setItem(
          "emailConfirmationEmail",
          normalizedEmail || response.data.user.email || ""
        );
        navigate("/verify-email");
        return;
      }

      const message =
        contact.type === "phone"
          ? "Thanks for registering! You can now log in with your phone number and password."
          : "Thank you for registering with Your Social Place. Enter the 6-digit code sent to your email to finish setup.";
      setSignupRegisteredMethod(contact.type);
      setAgeVerifyContact(contactPayload || null);
      setSignupInfo(message);
      setSignupShowSuccessModal(true);
      clearInlineMessages();
      setIdentifier(contactPayload);
      setPassword("");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const message =
          (err.response?.data as any)?.error?.message ||
          (err.response?.data as any)?.message ||
          "Error registering user";
        if (isDuplicateContactError(message)) {
          setSignupDuplicateModalOpen(true);
          setSignupError(null);
          return;
        }
        setSignupError(message);
      } else {
        setSignupError("Error registering user");
      }
    } finally {
      setSignupLoading(false);
    }
  };

  const startInlineLogin = async (requestedMethod?: VerificationMethod) => {
    clearInlineMessages();
    resetVerificationState();

    const normalizedIdentifier = identifier.trim().toLowerCase();
    if (!normalizedIdentifier || !password.trim()) {
      setLoginError("Enter your email/phone and password.");
      return;
    }

    try {
      setLoginLoading(true);
      trackEvent("login_started", {
        source: "landing_inline_password",
        verification_method: requestedMethod || "default",
      });
      const response = await api.post<LoginStartResponse>("/auth/login", {
        identifier: normalizedIdentifier,
        password,
        rememberDevice: false,
        deviceId: getOrCreateDeviceId(),
        ...(requestedMethod ? { verificationMethod: requestedMethod } : {}),
      });
      if (!applyInlineLoginResponse(response.data, normalizedIdentifier)) {
        setLoginError("Login failed. Please try again.");
      }
    } catch (err) {
      const resolved = resolveInlineLoginError(err);
      setLoginError(resolved.message);
      if (resolved.isAgeLock) {
        openAgeModal({
          contactOverride: normalizedIdentifier,
          lockEnforced:
            resolved.code === AGE_VERIFICATION_LOCK_CODE ||
            resolved.code === AGE_VERIFICATION_LOCK_REASON,
          supportEmail: resolved.supportEmail,
        });
      }
    } finally {
      setLoginLoading(false);
    }
  };

  const handleInlineLoginSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await startInlineLogin();
  };

  const handleInlineUseCodeFallback = async () => {
    if (loginLoading || verifying) return;
    const normalized = identifier.trim().toLowerCase();
    const fallbackMethod: VerificationMethod = normalized.includes("@") ? "email" : "sms";
    await startInlineLogin(fallbackMethod);
  };

  const handleInlineVerifySubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    clearInlineMessages();

    if (!challengeId) {
      setLoginError("Verification expired. Please log in again.");
      return;
    }
    if (!verificationCode.trim()) {
      setLoginError("Enter the verification code.");
      return;
    }

    try {
      setVerifying(true);
      trackEvent("login_started", {
        source: "landing_inline_verification",
        verification_method: challengeMethod || "unknown",
      });
      const response = await api.post<AuthResponse>("/auth/login/verify", {
        challengeId,
        code: verificationCode.trim(),
      });
      if (!response.data?.jwt) {
        setLoginError("Verification failed. Please try again.");
        return;
      }
      completeInlineLogin(response.data, "verification", identifier.trim().toLowerCase());
    } catch (err) {
      const parsed = parseInlineAuthError(err, "Verification failed.");
      const lower = parsed.messageLower;
      if (lower.includes("expired") || lower.includes("too many")) {
        resetVerificationState();
      }
      if (
        parsed.code === AGE_VERIFICATION_LOCK_CODE ||
        parsed.code === AGE_VERIFICATION_LOCK_REASON ||
        (parsed.status === 403 && lower.includes("age verification"))
      ) {
        openAgeModal({
          contactOverride: identifier.trim().toLowerCase(),
          lockEnforced:
            parsed.code === AGE_VERIFICATION_LOCK_CODE ||
            parsed.code === AGE_VERIFICATION_LOCK_REASON,
          supportEmail: parsed.supportEmail,
        });
      }
      setLoginError(parsed.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleInlineResend = async () => {
    if (!challengeId) return;
    if (challengeMethod === "totp") {
      setLoginError("Authenticator codes cannot be resent.");
      return;
    }
    clearInlineMessages();
    try {
      setResending(true);
      await api.post("/auth/login/resend", { challengeId });
      setLoginInfo(
        challengeMethod === "email"
          ? "Code resent. Check your email."
          : "Code resent. Check your phone."
      );
    } catch (err) {
      setLoginError(parseInlineAuthError(err, "Unable to resend code.").message);
    } finally {
      setResending(false);
    }
  };

  const handleTrustDevice = async () => {
    if (trustModalLoading) return;
    setTrustModalLoading(true);
    setTrustModalError(null);
    try {
      await api.post("/auth/trusted-devices/trust", {
        deviceId: getOrCreateDeviceId(),
        deviceLabel: trustDeviceLabel,
      });
      setTrustModalOpen(false);
      const next = pendingInlineRedirect || postAuthTarget || "/dashboard";
      setPendingInlineRedirect(null);
      navigate(next);
    } catch (err: unknown) {
      const parsed = parseInlineAuthError(err, "Unable to trust this device.");
      setTrustModalError(parsed.message);
    } finally {
      setTrustModalLoading(false);
    }
  };

  const handleAlwaysConfirm = () => {
    setTrustModalOpen(false);
    setTrustModalError(null);
    const next = pendingInlineRedirect || postAuthTarget || "/dashboard";
    setPendingInlineRedirect(null);
    navigate(next);
  };

  useEffect(() => {
    if (!user) {
      setShowInlineLogin(true);
      setProfileSummary(null);
      setShowAnotherProfileForm(false);
      setShowRecentPasswordStep(false);
      setShowRegisterForm(false);
      setTrustModalOpen(false);
      setPendingInlineRedirect(null);
      return;
    }
    setShowInlineLogin(false);
    setShowRegisterForm(false);
  }, [user]);

  useEffect(() => {
    if (user || !forceSwitchProfileMode) return;
    setShowInlineLogin(true);
    setShowAnotherProfileForm(true);
    setShowRecentPasswordStep(false);
    setShowRegisterForm(false);
    clearInlineMessages();
    clearSignupMessages();
    resetVerificationState();
    setTrustModalOpen(false);
    setPendingInlineRedirect(null);
    setIdentifier(switchProfileIdentifierParam);
    setPassword("");
  }, [switchProfileIdentifierParam, forceSwitchProfileMode, user]);

  const showPasswordStepForProfile = (entry?: RecentLoginEntry | null) => {
    setShowInlineLogin(true);
    setShowAnotherProfileForm(true);
    setShowRecentPasswordStep(false);
    setShowRegisterForm(false);
    resetVerificationState();
    clearInlineMessages();
    clearSignupMessages();
    setIdentifier(String(entry?.identifier || "").trim().toLowerCase());
    setPassword("");
    if (entry) {
      setLoginInfo("Enter your password for this profile.");
    }
  };

  const handleTrustedRecentLogin = async (
    entry?: RecentLoginEntry | null,
    options?: { fallbackToPassword?: boolean }
  ) => {
    const target = entry || recentLogin;
    if (!target?.identifier || loginLoading) {
      if (options?.fallbackToPassword) {
        showPasswordStepForProfile(target);
      }
      return;
    }
    clearInlineMessages();
    resetVerificationState();
    setLoginLoading(true);
    try {
      const response = await api.post<AuthResponse>("/auth/login/trusted", {
        identifier: String(target.identifier || "").trim().toLowerCase(),
        deviceId: getOrCreateDeviceId(),
        rememberDevice: true,
      });
      if (!response.data?.jwt) {
        throw new Error("Trusted login failed.");
      }
      completeInlineLogin(response.data, "trusted", String(target.identifier || "").trim());
      return;
    } catch (err) {
      const resolved = resolveInlineLoginError(err);
      const lower = String(resolved.messageLower || "");
      const requiresPassword =
        lower.includes("not trusted") ||
        lower.includes("missing device") ||
        lower.includes("profile not found");
      if (resolved.isAgeLock) {
        openAgeModal({
          contactOverride: String(target.identifier || "").trim().toLowerCase(),
          lockEnforced:
            resolved.code === AGE_VERIFICATION_LOCK_CODE ||
            resolved.code === AGE_VERIFICATION_LOCK_REASON,
          supportEmail: resolved.supportEmail,
        });
      }
      if (options?.fallbackToPassword || requiresPassword) {
        showPasswordStepForProfile(target);
        if (requiresPassword) {
          setLoginInfo("This profile needs password confirmation on this device.");
        } else if (resolved.message) {
          setLoginError(resolved.message);
        }
        return;
      }
      setLoginError(resolved.message);
    } finally {
      setLoginLoading(false);
    }
  };

  const handleContinue = () => {
    trackEvent("login_started", {
      source: "landing_continue",
      has_session: Boolean(user),
    });
    if (user) {
      navigate(postAuthTarget || "/dashboard");
      return;
    }
    if (useRecentLogin) {
      void handleTrustedRecentLogin(recentLogin, { fallbackToPassword: true });
      return;
    }
    setShowRegisterForm(false);
    setShowInlineLogin(true);
    clearInlineMessages();
  };

  const handleUseAnotherProfile = () => {
    trackEvent("login_started", { source: "landing_use_another_profile" });
    setShowInlineLogin(true);
    setShowAnotherProfileForm(true);
    setShowRecentPasswordStep(false);
    setShowRegisterForm(false);
    clearInlineMessages();
    clearSignupMessages();
    resetVerificationState();
    setIdentifier("");
    setPassword("");
  };

  const handleSelectRecentProfile = (entry: RecentLoginEntry) => {
    void handleTrustedRecentLogin(entry, { fallbackToPassword: true });
  };

  const handleCreateAccount = () => {
    trackEvent("signup_started", { source: "landing_create_account" });
    setShowInlineLogin(true);
    setShowRegisterForm(true);
    setShowAnotherProfileForm(true);
    setShowRecentPasswordStep(false);
    resetVerificationState();
    clearInlineMessages();
    clearSignupMessages();
    setSignupForm({
      firstName: "",
      lastName: "",
      contact: "",
      smsCode: "",
      password: "",
      confirmPassword: "",
      botField: "",
    });
    setSignupContactMode("phone");
    setSignupDialCodeEditing(false);
    setSignupSmsConsent(false);
    setSignupSmsSending(false);
    setSignupSmsSent(false);
    setSignupSmsError(null);
    setSignupTermsOpen(false);
    setSignupDuplicateModalOpen(false);
    setSignupShowSuccessModal(false);
    setSignupRegisteredMethod(null);
    setSignupAccessNotice(null);
    setAgeSessionId(null);
    setAgeQrUrl(null);
    setAgeMobileUrl(null);
    setAgeSessionStatus(ageVerificationTokenParam ? "verified" : "idle");
    setAgeSessionError(null);
    setAgeModalOpen(false);
    setAgeLockEnforced(false);
    setAgeLockSupportEmail(DEFAULT_SUPPORT_EMAIL);
    setAgeToken(ageVerificationTokenParam || null);
    setAgeVerifyContact(null);
    setAgeVerifyApplied(false);
    setSignupFormStart(Date.now());
  };

  useEffect(() => {
    if (user) return;
    const params = new URLSearchParams(location.search);
    const authMode = String(params.get("auth") || "")
      .trim()
      .toLowerCase();
    if (!authMode) return;

    const isRegisterMode =
      authMode === "register" ||
      authMode === "signup" ||
      authMode === "create" ||
      authMode === "create-account";

    const isLoginMode =
      authMode === "login" || authMode === "signin" || authMode === "sign-in";

    if (isRegisterMode) {
      setShowInlineLogin(true);
      setShowRegisterForm(true);
      setShowAnotherProfileForm(true);
      setShowRecentPasswordStep(false);
      setChallengeId(null);
      setChallengeMethod(null);
      setVerificationCode("");
      setDeliveryHint(null);
      setResending(false);
      setIdentifier("");
      setPassword("");
      setLoginError(null);
      setLoginInfo(null);
      setSignupError(null);
      setSignupInfo(null);
      setSignupForm({
        firstName: "",
        lastName: "",
        contact: "",
        smsCode: "",
        password: "",
        confirmPassword: "",
        botField: "",
      });
      setSignupContactMode("phone");
      setSignupDialCodeEditing(false);
      setSignupSmsConsent(false);
      setSignupSmsSending(false);
      setSignupSmsSent(false);
      setSignupSmsError(null);
      setSignupTermsOpen(false);
      setSignupDuplicateModalOpen(false);
      setSignupShowSuccessModal(false);
      setSignupRegisteredMethod(null);
      setSignupAccessNotice(null);
      setAgeSessionId(null);
      setAgeQrUrl(null);
      setAgeMobileUrl(null);
      setAgeSessionStatus(ageVerificationTokenParam ? "verified" : "idle");
      setAgeSessionError(null);
      setAgeModalOpen(false);
      setAgeLockEnforced(false);
      setAgeLockSupportEmail(DEFAULT_SUPPORT_EMAIL);
      setAgeToken(ageVerificationTokenParam || null);
      setAgeVerifyContact(null);
      setAgeVerifyApplied(false);
      setSignupFormStart(Date.now());
      return;
    }

    if (isLoginMode) {
      setShowInlineLogin(true);
      setShowRegisterForm(false);
      setShowAnotherProfileForm(true);
      setShowRecentPasswordStep(false);
      setChallengeId(null);
      setChallengeMethod(null);
      setVerificationCode("");
      setDeliveryHint(null);
      setResending(false);
      setLoginError(null);
      setLoginInfo(null);
      setSignupError(null);
      setSignupInfo(null);
      setSignupTermsOpen(false);
      setSignupAccessNotice(null);
      setSignupDuplicateModalOpen(false);
      setSignupShowSuccessModal(false);
      setAgeModalOpen(false);
      setAgeLockEnforced(false);
      setAgeLockSupportEmail(DEFAULT_SUPPORT_EMAIL);
    }
  }, [ageVerificationTokenParam, location.search, user]);

  return (
    <div className="landing-page" ref={rootRef} style={landingBackground}>
      <main className="landing-frame">
        <section className="landing-left">
          <div className="landing-left-logo-wrapper">
            <button
              type="button"
              className="landing-left-brand"
              onClick={() => navigate("/")}
              aria-label="Go to Your Social Place home"
              >
              <span className="landing-logo-coin" aria-hidden="true">
                <span className="landing-logo-coin-inner">
                  <span className="landing-logo-coin-face landing-logo-coin-face--front">
                    <img
                      src={LANDING_BRAND_LOGO_SRC}
                      alt=""
                      loading="eager"
                      onError={(event) => {
                        const target = event.currentTarget;
                        if (target.dataset.fallbackApplied === "1") return;
                        target.dataset.fallbackApplied = "1";
                        target.src = LANDING_BRAND_LOGO_FALLBACK;
                      }}
                    />
                  </span>
                  <span className="landing-logo-coin-face landing-logo-coin-face--back">
                    <img
                      src={LANDING_BRAND_LOGO_SRC}
                      alt=""
                      loading="eager"
                      onError={(event) => {
                        const target = event.currentTarget;
                        if (target.dataset.fallbackApplied === "1") return;
                        target.dataset.fallbackApplied = "1";
                        target.src = LANDING_BRAND_LOGO_FALLBACK;
                      }}
                    />
                  </span>
                </span>
              </span>
              <p className="landing-left-brand-title">
                Your Social Place | <span className="landing-beta-tag">BETA</span>
              </p>
            </button>
          </div>

          <div className="landing-artboard" aria-hidden="true">
            <div className="landing-carousel">
              <div
                className={`landing-carousel-track${
                  carouselTransitionEnabled ? " is-animated" : ""
                }`}
                style={{
                  transform: `translateX(-${carouselPosition * 100}%)`,
                  transitionDuration: `${carouselDurationMs}ms`,
                }}
              >
                {carouselFrames.map((slide, index) => (
                  <div className="landing-carousel-slide" key={`carousel-${index}`}>
                    <img src={slide.src} alt="" loading={index < 6 ? "eager" : "lazy"} />
                  </div>
                ))}
              </div>
              <p className="landing-carousel-caption">
                {LANDING_CAROUSEL_SLIDES[carouselActiveIndex]?.caption || "Trust starts with real smiles."}
              </p>
            </div>
          </div>

          <h1 className="landing-tagline">
            Your Social Place Is
            <br />
            <span>For You!</span>
          </h1>
        </section>

        <aside className={`landing-right${showRegisterForm ? " is-registering" : ""}`}>
          <section
            className={`landing-account-panel${showRegisterForm ? " is-registering" : ""}`}
            aria-label="Account actions"
          >
            {showWelcomeCard ? (
              <>
                <div
                  className={`landing-account-avatar-wrap${
                    canQuickLoginFromAvatar ? " is-clickable" : ""
                  }`}
                  role={canQuickLoginFromAvatar ? "button" : undefined}
                  tabIndex={canQuickLoginFromAvatar ? 0 : -1}
                  onClick={() => {
                    if (!canQuickLoginFromAvatar) return;
                    void handleTrustedRecentLogin(recentLogin, { fallbackToPassword: true });
                  }}
                  onKeyDown={(event) => {
                    if (!canQuickLoginFromAvatar) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    void handleTrustedRecentLogin(recentLogin, { fallbackToPassword: true });
                  }}
                  aria-label={
                    canQuickLoginFromAvatar ? "Continue with saved trusted profile" : undefined
                  }
                >
                  {profileSummary?.avatarUrl ? (
                    <img
                      className="landing-account-avatar"
                      src={profileSummary.avatarUrl}
                      alt={nameForDisplay}
                    />
                  ) : (
                    <div className="landing-account-avatar landing-account-avatar--fallback">
                      {profileInitial}
                    </div>
                  )}
                </div>

                <h2>{nameForDisplayShort}</h2>

                <div className="landing-account-actions">
                  <button
                    type="button"
                    className="landing-btn landing-btn--primary"
                    onClick={handleContinue}
                  >
                    Continue
                  </button>
                  <button
                    type="button"
                    className="landing-btn landing-btn--ghost"
                    onClick={handleUseAnotherProfile}
                  >
                    Use another profile
                  </button>
                  <button
                    type="button"
                    className="landing-btn landing-btn--outline"
                    onClick={handleCreateAccount}
                  >
                    Create new account
                  </button>
                </div>
              </>
            ) : (
              <>
                {hasRecentLogin && (
                  <button
                    type="button"
                    className="landing-form-gear"
                    onClick={handleClearSavedProfile}
                    aria-label="Remove saved profile"
                    title="Remove saved profile"
                  >
                    ⚙
                  </button>
                )}
                <div className="landing-account-avatar-wrap">
                  {showRegisterForm ? (
                    <div className="landing-account-avatar landing-account-avatar--fallback">
                      {signupInitial}
                    </div>
                  ) : showAnotherProfileForm && selectedRecentProfile?.avatarUrl ? (
                    <img
                      className="landing-account-avatar"
                      src={selectedRecentProfile.avatarUrl}
                      alt={selectedRecentProfile.label || "Saved profile"}
                    />
                  ) : useRecentLogin && recentLogin?.avatarUrl ? (
                    <img
                      className="landing-account-avatar"
                      src={recentLogin.avatarUrl}
                      alt={recentName}
                    />
                  ) : (
                    <div className="landing-account-avatar landing-account-avatar--fallback">
                      {showAnotherProfileForm
                        ? selectedRecentInitial
                        : useRecentLogin
                        ? recentInitial
                        : loginInitial}
                    </div>
                  )}
                </div>

                <h2>{loginCardTitle}</h2>

                {showRecentActionCard ? (
                  <div className="landing-account-actions">
                    <button
                      type="button"
                      className="landing-btn landing-btn--primary"
                      onClick={() => {
                        void handleTrustedRecentLogin(recentLogin, { fallbackToPassword: true });
                      }}
                      disabled={loginLoading}
                    >
                      {loginLoading ? "Continuing..." : "Continue"}
                    </button>
                    <button
                      type="button"
                      className="landing-btn landing-btn--ghost"
                      onClick={handleUseAnotherProfile}
                    >
                      Use another profile
                    </button>
                    <button
                      type="button"
                      className="landing-btn landing-btn--outline"
                      onClick={handleCreateAccount}
                    >
                      Create new account
                    </button>
                  </div>
                ) : (
                  showRegisterForm ? (
                    <form className="landing-login-form landing-register-form" onSubmit={handleInlineRegisterSubmit}>
                      <input
                        className="landing-hidden-field"
                        type="text"
                        name="botField"
                        value={signupForm.botField}
                        onChange={handleSignupChange}
                        autoComplete="off"
                        tabIndex={-1}
                        aria-hidden="true"
                      />

                      <div className="landing-register-grid">
                        <label className="landing-login-field">
                          <span>First name</span>
                          <input
                            className="landing-login-input"
                            type="text"
                            name="firstName"
                            value={signupForm.firstName}
                            onChange={handleSignupChange}
                            autoComplete="given-name"
                            placeholder="First name"
                            required
                          />
                        </label>
                        <label className="landing-login-field">
                          <span>Last name</span>
                          <input
                            className="landing-login-input"
                            type="text"
                            name="lastName"
                            value={signupForm.lastName}
                            onChange={handleSignupChange}
                            autoComplete="family-name"
                            placeholder="Last name"
                            required
                          />
                        </label>
                      </div>

                      <div className="landing-login-field">
                        <span>Phone number or email</span>
                        <div
                          className={`landing-register-contact-row${
                            signupContactMode === "phone" ? "" : " is-email"
                          }`}
                        >
                          {signupContactMode === "phone" && (
                            <div className="landing-register-phone-code">
                              <span className="landing-register-phone-code-value">
                                +{signupPhoneDialCode || "1"}
                              </span>
                              <button
                                type="button"
                                className="landing-btn landing-btn--ghost landing-register-code-edit"
                                onClick={() => setSignupDialCodeEditing((prev) => !prev)}
                                disabled={!signupCountryOptions.length}
                              >
                                {signupDialCodeEditing ? "Done" : "Edit"}
                              </button>
                            </div>
                          )}
                          <input
                            className={`landing-login-input${
                              signupContactMode === "phone" ? " landing-register-phone-input" : ""
                            }`}
                            name="contact"
                            type="text"
                            inputMode={signupContactMode === "phone" ? "tel" : "email"}
                            placeholder={
                              signupContactMode === "phone" ? "(555) 555-1234" : "you@example.com"
                            }
                            onChange={handleSignupChange}
                            value={signupForm.contact}
                            autoComplete={signupContactMode === "phone" ? "tel" : "email"}
                            required
                          />
                          {signupContactMode === "phone" && signupContactDetails?.type === "phone" && (
                            <button
                              type="button"
                              className="landing-btn landing-btn--ghost landing-sms-send"
                              onClick={handleSignupSendSms}
                              disabled={signupSmsSending || !signupForm.contact.trim()}
                            >
                              {signupSmsSending
                                ? "Sending..."
                                : signupSmsSent
                                ? "Resend code"
                                : "Send code"}
                            </button>
                          )}
                        </div>
                        {signupContactMode === "phone" && signupDialCodeEditing && (
                          <div className="landing-register-code-select">
                            <select
                              className="landing-login-input"
                              value={signupSelectedCountryCode}
                              onChange={(event) => handleSignupDialCodeSelect(event.target.value)}
                            >
                              {signupCountryOptions.map((country) => {
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
                        <small className="landing-auth-hint">
                          Enter a valid phone number or email. Phone numbers default to +1 unless
                          you change the country code.
                        </small>
                        {signupCountryError && (
                          <small className="landing-auth-hint">{signupCountryError}</small>
                        )}
                        {signupContactDetails?.type === "email" && (
                          <small className="landing-auth-hint">
                            We will email a confirmation link after sign up.
                          </small>
                        )}
                        {signupContactDetails?.type === "phone" && (
                          <small className="landing-auth-hint">
                            Optional: request a text code to verify now.
                          </small>
                        )}
                      </div>

                      {signupContactDetails?.type === "phone" && (
                        <>
                          {signupSmsError && (
                            <p className="landing-login-message is-error">{signupSmsError}</p>
                          )}
                          {signupSmsSent && !signupSmsError && (
                            <p className="landing-login-message is-info">
                              SMS code sent. Check your phone.
                            </p>
                          )}
                          <label className="landing-login-field">
                            <span>SMS code (optional)</span>
                            <input
                              className="landing-login-input"
                              name="smsCode"
                              type="text"
                              inputMode="numeric"
                              placeholder="Enter the code"
                              onChange={handleSignupChange}
                              value={signupForm.smsCode}
                              autoComplete="one-time-code"
                            />
                          </label>
                        </>
                      )}

                      <label className="landing-login-field">
                        <span>Password</span>
                        <input
                          className="landing-login-input"
                          type="password"
                          name="password"
                          value={signupForm.password}
                          onChange={handleSignupChange}
                          autoComplete="new-password"
                          placeholder="Enter a strong password"
                          required
                        />
                        <small className="landing-auth-hint">
                          At least 8 characters with upper/lowercase, a number, and a symbol
                          (spaces allowed).
                        </small>
                      </label>

                      <label className="landing-login-field">
                        <span>Confirm password</span>
                        <input
                          className="landing-login-input"
                          type="password"
                          name="confirmPassword"
                          value={signupForm.confirmPassword}
                          onChange={handleSignupChange}
                          autoComplete="new-password"
                          placeholder="Confirm password"
                          required
                        />
                      </label>

                      <div className="landing-terms-consent">
                        <label
                          className={`landing-sms-consent-toggle ${
                            signupSmsConsent ? "checked" : ""
                          } ${signupContactMode !== "phone" ? "disabled" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={signupSmsConsent}
                            onChange={(event) => setSignupSmsConsent(event.target.checked)}
                            disabled={signupContactMode !== "phone"}
                          />
                          <span className="landing-sms-consent-slider" aria-hidden="true" />
                          <span className="landing-terms-copy">
                            {SMS_CONSENT_TEXT}
                            <span className="landing-sms-consent-meta">
                              Message &amp; data rates may apply.
                            </span>
                          </span>
                        </label>
                        <p className="landing-terms-inline">
                          By signing up, you agree to the{" "}
                          <button
                            type="button"
                            className="landing-terms-link"
                            onClick={() => setSignupTermsOpen(true)}
                          >
                            Terms and Conditions
                          </button>
                          ,{" "}
                          <button
                            type="button"
                            className="landing-terms-link"
                            onClick={() => setSignupPolicyModal("privacy")}
                          >
                            Privacy Policy
                          </button>
                          , and{" "}
                          <button
                            type="button"
                            className="landing-terms-link"
                            onClick={() => setSignupPolicyModal("cookies")}
                          >
                            Cookie Policy
                          </button>
                          .
                        </p>
                      </div>

                      {signupError && <p className="landing-login-message is-error">{signupError}</p>}
                      {signupInfo && !signupShowSuccessModal && (
                        <p className="landing-login-message is-info">{signupInfo}</p>
                      )}

                      <div className="landing-account-actions">
                        <button
                          type="submit"
                          className="landing-btn landing-btn--primary"
                          disabled={signupLoading}
                        >
                          {signupLoading ? "Creating account..." : "Create account"}
                        </button>
                        <button
                          type="button"
                          className="landing-btn landing-btn--ghost"
                          onClick={() => {
                            setShowRegisterForm(false);
                            setShowRecentPasswordStep(false);
                            clearSignupMessages();
                            clearInlineMessages();
                            resetVerificationState();
                            setSignupDuplicateModalOpen(false);
                            setSignupShowSuccessModal(false);
                          }}
                        >
                          Back to login
                        </button>
                      </div>
                    </form>
                  ) : (
                  <form
                    className="landing-login-form"
                    onSubmit={challengeId ? handleInlineVerifySubmit : handleInlineLoginSubmit}
                  >
                    {!challengeId ? (
                      <>
                        {showAnotherProfileForm && recentLogins.length > 1 && (
                          <div className="landing-saved-profiles" aria-label="Saved profiles">
                            <p className="landing-saved-profiles-label">Recent profiles</p>
                            <div className="landing-saved-profiles-list">
                              {recentLogins.map((entry) => {
                                const isActive =
                                  String(entry.identifier || "").trim().toLowerCase() ===
                                  identifier.trim().toLowerCase();
                                const profileLabel = sanitizeRecentLabel(
                                  String(entry.label || "").trim(),
                                  entry.id,
                                  entry.handle
                                );
                                const profileLabelShort = truncateDisplayName(profileLabel);
                                const profileSubtitle = entry.handle
                                  ? `@${entry.handle}`
                                  : "Saved profile";
                                const profileInitial = profileLabel.slice(0, 1).toUpperCase() || "U";
                                return (
                                  <button
                                    key={`${entry.id}-${entry.identifier}`}
                                    type="button"
                                    className={`landing-saved-profile${isActive ? " is-active" : ""}`}
                                    onClick={() => handleSelectRecentProfile(entry)}
                                    title={profileLabelShort}
                                  >
                                    {entry.avatarUrl ? (
                                      <img
                                        className="landing-saved-profile-avatar"
                                        src={entry.avatarUrl}
                                        alt={profileLabel}
                                      />
                                    ) : (
                                      <span className="landing-saved-profile-avatar landing-saved-profile-avatar--fallback">
                                        {profileInitial}
                                      </span>
                                    )}
                                    <span className="landing-saved-profile-meta">
                                      <span className="landing-saved-profile-name">
                                        {profileLabelShort}
                                      </span>
                                      <span className="landing-saved-profile-id">{profileSubtitle}</span>
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {!useRecentLogin && (
                          <label className="landing-login-field">
                            <span>Email or phone number</span>
                            <input
                              className="landing-login-input"
                              type="text"
                              value={identifier}
                              onChange={(event) => setIdentifier(event.target.value)}
                              autoComplete="username"
                              placeholder="you@example.com"
                              required
                            />
                          </label>
                        )}

                        <label className="landing-login-field">
                          <span>Password</span>
                          <input
                            className="landing-login-input"
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete="current-password"
                            placeholder="Password"
                            required
                          />
                        </label>
                      </>
                    ) : (
                      <label className="landing-login-field">
                        <span>Verification code</span>
                        <input
                          className="landing-login-input"
                          type="text"
                          value={verificationCode}
                          onChange={(event) => setVerificationCode(event.target.value)}
                          autoComplete="one-time-code"
                          inputMode="numeric"
                          placeholder="Enter code"
                          required
                        />
                        {deliveryHint && (
                          <small className="landing-login-hint">Sent to {deliveryHint}.</small>
                        )}
                      </label>
                    )}

                    {loginError && <p className="landing-login-message is-error">{loginError}</p>}
                    {loginInfo && <p className="landing-login-message is-info">{loginInfo}</p>}

                    <div className="landing-account-actions">
                      <button
                        type="submit"
                        className="landing-btn landing-btn--primary"
                        disabled={loginLoading || verifying}
                      >
                        {challengeId
                          ? verifying
                            ? "Verifying..."
                            : "Verify and continue"
                          : loginLoading
                          ? "Logging in..."
                          : "Login"}
                      </button>

                      {!challengeId ? (
                        <>
                          {useRecentLogin && (
                            <button
                              type="button"
                              className="landing-btn landing-btn--ghost"
                              onClick={() => {
                                setShowAnotherProfileForm(true);
                                setShowRecentPasswordStep(false);
                                setShowRegisterForm(false);
                                clearInlineMessages();
                                clearSignupMessages();
                                resetVerificationState();
                                setIdentifier("");
                                setPassword("");
                              }}
                            >
                              Use another profile
                            </button>
                          )}
                          {showBackToRecent && (
                            <button
                              type="button"
                              className="landing-btn landing-btn--ghost"
                              onClick={() => {
                                if (showAnotherProfileForm) {
                                  setShowAnotherProfileForm(false);
                                }
                                setShowRecentPasswordStep(false);
                                setShowRegisterForm(false);
                                clearInlineMessages();
                                clearSignupMessages();
                                resetVerificationState();
                                setPassword("");
                              }}
                            >
                              Back
                            </button>
                          )}
                          <button
                            type="button"
                            className="landing-btn landing-btn--ghost"
                            onClick={() => navigate("/forgot-password")}
                          >
                            Forgot password?
                          </button>
                          {loginError &&
                            loginError.toLowerCase().includes("authenticator app is not configured") && (
                              <button
                                type="button"
                                className="landing-btn landing-btn--ghost"
                                onClick={() => void handleInlineUseCodeFallback()}
                                disabled={loginLoading || verifying}
                              >
                                {identifier.trim().toLowerCase().includes("@")
                                  ? "Use email code instead"
                                  : "Use text code instead"}
                              </button>
                            )}
                        </>
                      ) : (
                        <div className="landing-login-inline-actions">
                          {challengeMethod !== "totp" && (
                            <button
                              type="button"
                              className="landing-btn landing-btn--ghost"
                              onClick={handleInlineResend}
                              disabled={resending}
                            >
                              {resending ? "Resending..." : "Resend code"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="landing-btn landing-btn--ghost"
                            onClick={() => {
                              resetVerificationState();
                              clearInlineMessages();
                              clearSignupMessages();
                              if (useRecentLogin) {
                                setShowRecentPasswordStep(true);
                              }
                            }}
                          >
                            Back to login
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        className="landing-btn landing-btn--outline"
                        onClick={handleCreateAccount}
                      >
                        Create new account
                      </button>

                      {user && (
                        <button
                          type="button"
                          className="landing-btn landing-btn--ghost"
                          onClick={() => {
                            setShowInlineLogin(false);
                            setShowAnotherProfileForm(false);
                            setShowRecentPasswordStep(false);
                            setShowRegisterForm(false);
                            resetVerificationState();
                            clearInlineMessages();
                            clearSignupMessages();
                          }}
                        >
                          Back to profile
                        </button>
                      )}
                    </div>
                  </form>
                  )
                )}
              </>
            )}
          </section>
        </aside>
      </main>

      {trustModalOpen && (
        <div className="landing-modal-overlay" role="dialog" aria-modal="true">
          <div className="landing-modal landing-modal--trust">
            <div className="landing-modal-header">
              <div>
                <h3>Trust this device?</h3>
                <p className="landing-modal-muted">
                  Trusted devices let you continue by tapping your avatar without entering a
                  password.
                </p>
              </div>
            </div>
            <div className="landing-modal-body">
              <p>
                Device label:{" "}
                <span className="landing-trust-device-label">{trustDeviceLabel}</span>
              </p>
              <p>
                Use <strong>Not now</strong> on shared devices. You can trust this device later in
                account security settings.
              </p>
              {trustModalError && (
                <p className="landing-login-message is-error">{trustModalError}</p>
              )}
            </div>
            <div className="landing-modal-actions">
              <button
                type="button"
                className="landing-btn landing-btn--ghost"
                onClick={handleAlwaysConfirm}
                disabled={trustModalLoading}
              >
                Not now
              </button>
              <button
                type="button"
                className="landing-btn landing-btn--primary"
                onClick={() => {
                  void handleTrustDevice();
                }}
                disabled={trustModalLoading}
              >
                {trustModalLoading ? "Saving..." : "Trust this device"}
              </button>
            </div>
          </div>
        </div>
      )}

      {ageModalOpen && (
        <div className="landing-modal-overlay" role="dialog" aria-modal="true">
          <div className="landing-modal landing-modal--age">
            <div className="landing-modal-header">
              <div>
                <h3>
                  {ageLockEnforced
                    ? "Account locked: age verification overdue"
                    : "Verify your age"}
                </h3>
                <p className="landing-modal-muted">
                  {ageLockEnforced
                    ? "Your account stays locked until age verification is completed or a moderator/admin unlocks it."
                    : "Live ID scan + liveness selfie required."}
                </p>
              </div>
              {!ageLockEnforced && (
                <button
                  type="button"
                  className="landing-modal-close"
                  onClick={closeAgeModal}
                >
                  X
                </button>
              )}
            </div>
            <div className="landing-modal-body">
              {ageLockEnforced && (
                <p className="landing-login-message is-error">
                  Need help unlocking? Contact support at{" "}
                  <a href={`mailto:${ageLockSupportEmail}`}>{ageLockSupportEmail}</a>.
                </p>
              )}
              <div className="landing-age-card">
                <div className="landing-age-info">
                  <p className="landing-age-copy">
                    Scan the QR code with your phone to take live photos. File uploads are
                    blocked.
                  </p>
                  <div
                    className={`landing-age-status ${
                      ageToken
                        ? "verified"
                        : ageSessionStatus === "failed" || ageSessionStatus === "denied"
                        ? "failed"
                        : ageSessionStatus !== "idle"
                        ? "pending"
                        : ""
                    }`}
                  >
                    {ageToken
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
                  <div className="landing-age-actions">
                    <button
                      type="button"
                      className="landing-btn landing-btn--ghost"
                      onClick={startAgeVerification}
                      disabled={ageSessionLoading}
                    >
                      {ageSessionLoading
                        ? "Starting..."
                        : ageToken
                        ? "Re-verify"
                        : "Start verification"}
                    </button>
                    {ageMobileUrl && (
                      <button
                        type="button"
                        className="landing-btn landing-btn--ghost"
                        onClick={() => {
                          void navigator.clipboard?.writeText(ageMobileUrl);
                        }}
                      >
                        Copy link
                      </button>
                    )}
                  </div>
                  {ageMobileUrl && (
                    <div className="landing-age-link">
                      <span>Mobile link</span>
                      <a href={ageMobileUrl} target="_blank" rel="noreferrer">
                        {ageMobileUrl}
                      </a>
                    </div>
                  )}
                  {ageSessionError && (
                    <p className="landing-login-message is-error">{ageSessionError}</p>
                  )}
                  {ageToken && !ageSessionError && (
                    <p className="landing-login-message is-info">
                      {ageVerifyApplied
                        ? "Age verification complete."
                        : "Verification captured. Applying to your account..."}
                    </p>
                  )}
                </div>
                {ageQrUrl && (
                  <div className="landing-age-qr">
                    <QRCodeCanvas value={ageQrUrl} size={160} includeMargin />
                    <span>Scan to continue</span>
                  </div>
                )}
              </div>
            </div>
            {!ageLockEnforced && (
              <div className="landing-modal-actions">
                <button
                  type="button"
                  className="landing-btn landing-btn--ghost"
                  onClick={closeAgeModal}
                >
                  Close
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {signupAccessNotice && (
        <div className="landing-modal-overlay" role="dialog" aria-modal="true">
          <div className="landing-modal landing-modal--access">
            <div className="landing-modal-header">
              <h3>Heads up</h3>
              <button
                type="button"
                className="landing-modal-close"
                onClick={() => setSignupAccessNotice(null)}
              >
                X
              </button>
            </div>
            <div className="landing-modal-body">
              <p>{signupAccessNotice}</p>
            </div>
            <div className="landing-modal-actions">
              <button
                type="button"
                className="landing-btn landing-btn--primary"
                onClick={() => setSignupAccessNotice(null)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {signupShowSuccessModal && (
        <div className="landing-modal-overlay" role="dialog" aria-modal="true">
          <div className="landing-modal landing-modal--success">
            <div className="landing-modal-header">
              <h3>Registration complete</h3>
              <button
                type="button"
                className="landing-modal-close"
                onClick={() => setSignupShowSuccessModal(false)}
              >
                Close
              </button>
            </div>
            <div className="landing-modal-body">
              <p>{signupSuccessMessage}</p>
              <p>
                Next step: verify your age within 30 days to keep your account active. You can
                find this anytime under Profile -&gt; Settings -&gt; Account &amp; Security.
              </p>
            </div>
            <div className="landing-modal-actions landing-modal-actions--stack">
              <button
                type="button"
                className="landing-btn landing-btn--ghost"
                onClick={() => setSignupShowSuccessModal(false)}
              >
                Got it
              </button>
              <button
                type="button"
                className="landing-btn landing-btn--ghost"
                onClick={() => {
                  setSignupShowSuccessModal(false);
                  openAgeModal();
                }}
              >
                Verify age now
              </button>
              <button
                type="button"
                className="landing-btn landing-btn--ghost"
                onClick={() => navigate("/what-makes-us-different")}
              >
                What makes us different
              </button>
              <button
                type="button"
                className="landing-btn landing-btn--primary"
                onClick={() => {
                  setSignupShowSuccessModal(false);
                  setShowRegisterForm(false);
                  setShowAnotherProfileForm(true);
                  setShowRecentPasswordStep(false);
                  setLoginInfo(signupSuccessMessage);
                }}
              >
                Go to login
              </button>
            </div>
          </div>
        </div>
      )}

      {signupDuplicateModalOpen && (
        <div className="landing-modal-overlay" role="dialog" aria-modal="true">
          <div className="landing-modal landing-modal--duplicate">
            <div className="landing-modal-header">
              <h3>Email/Phone Number Already Exists</h3>
              <button
                type="button"
                className="landing-modal-close"
                onClick={() => setSignupDuplicateModalOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="landing-modal-body">
              <p>Try Another Email/Phone Number</p>
            </div>
            <div className="landing-modal-actions">
              <button
                type="button"
                className="landing-btn landing-btn--primary"
                onClick={() => setSignupDuplicateModalOpen(false)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

      {signupTermsOpen && (
        <div className="landing-modal-overlay" role="dialog" aria-modal="true">
          <div className="landing-modal landing-modal--terms">
            <div className="landing-modal-header">
              <div>
                <h3>{t(TERMS_TITLE)}</h3>
                <p className="landing-modal-muted">{t("Last updated: {{date}}", { date: TERMS_UPDATED })}</p>
              </div>
              <button
                className="landing-modal-close"
                type="button"
                onClick={() => setSignupTermsOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="landing-modal-body landing-modal-body--terms">
              {TERMS_SECTIONS.map((section) => (
                <section key={section.title} className="landing-terms-section">
                  <h4>{t(section.title)}</h4>
                  {section.body.map((paragraph, index) => (
                    <p key={`${section.title}-${index}`}>{t(paragraph)}</p>
                  ))}
                </section>
              ))}
            </div>
            <div className="landing-modal-actions">
              <a className="landing-terms-link" href="/terms" target="_blank" rel="noreferrer">
                Open full page
              </a>
              <button
                className="landing-btn landing-btn--primary"
                type="button"
                onClick={() => setSignupTermsOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {signupPolicyModal && (
        <div className="landing-modal-overlay" role="dialog" aria-modal="true">
          <div className="landing-modal landing-modal--policy">
            <div className="landing-modal-header">
              <div>
                <h3>{policyModalMeta[signupPolicyModal].title}</h3>
                <p className="landing-modal-muted">{policyModalMeta[signupPolicyModal].summary}</p>
              </div>
              <button
                className="landing-modal-close"
                type="button"
                onClick={() => setSignupPolicyModal(null)}
              >
                Close
              </button>
            </div>
            <div className="landing-modal-body">
              <p>
                Open the full policy page here:
              </p>
              <a
                className="landing-policy-url"
                href={policyModalMeta[signupPolicyModal].route}
                onClick={() => setSignupPolicyModal(null)}
              >
                {policyModalMeta[signupPolicyModal].fullUrl}
              </a>
              <p>
                If opening in a new tab is blocked by hosting behavior, use the in-app button
                below.
              </p>
            </div>
            <div className="landing-modal-actions">
              <button
                className="landing-btn landing-btn--primary"
                type="button"
                onClick={() => {
                  const route = policyModalMeta[signupPolicyModal].route;
                  setSignupPolicyModal(null);
                  navigate(route);
                }}
              >
                Open full page
              </button>
              <a
                className="landing-terms-link"
                href={policyModalMeta[signupPolicyModal].fullUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open in new tab
              </a>
            </div>
          </div>
        </div>
      )}

      <SiteFooter />
    </div>
  );
}
