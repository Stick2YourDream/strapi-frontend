import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useAuth } from "../context/AuthContext";
import api from "../api/strapi";
import type { AuthResponse, LoginStartResponse } from "../types/auth";
import {
  Bell,
  ChevronDown,
  ChevronLeft,
  Download,
  EyeOff,
  Home,
  LayoutDashboard,
  Lock,
  LogOut,
  MessageSquare,
  Newspaper,
  Palette,
  RefreshCcw,
  Settings,
  Shield,
  Store,
  Timer,
  User,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import {
  useNotifications,
  type BirthdayPreview,
  type FriendRequestPreview,
} from "../hooks/useNotifications";
import { getOrCreateDeviceId } from "../utils/device-id";
import { getDefaultDeviceLabel } from "../utils/device-approval";
import {
  buildProfilePayloadFromAttrs,
  decryptOwnProfilePayload,
  type NotificationSettings,
  type ProfilePayload,
} from "../utils/profile-e2ee";
import { pickMediaUrl } from "../utils/media";
import "../css/sidebar.css";
import AvatarImage from "./AvatarImage";
import ProfilePhotoModal from "./ProfilePhotoModal";

type ProfileSummary = {
  displayName: string;
  avatarUrl?: string;
  handle?: string;
  age?: string;
  hobbies?: string;
  bio?: string;
};

type RecentLoginEntry = {
  id: number;
  label: string;
  identifier: string;
  handle?: string | null;
  avatarUrl?: string | null;
  lastUsedAt: number;
};

type VerificationMethod = "sms" | "email" | "totp";

type SettingsSection =
  | "appearance"
  | "security"
  | "privacy"
  | "notifications"
  | "storefront"
  | "time-limits"
  | "changes";

const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "appearance", label: "Background & Chat" },
  { id: "security", label: "Account & Security" },
  { id: "privacy", label: "Visibility & Discoverability" },
  { id: "notifications", label: "Sound, Vibration & Quiet Hours" },
  { id: "storefront", label: "Storefront Defaults" },
  { id: "time-limits", label: "Time Limits" },
  { id: "changes", label: "Changes & Deactivation" },
];

const SETTINGS_SECTION_ICONS: Record<SettingsSection, ReactNode> = {
  appearance: <Palette size={18} />,
  security: <Lock size={18} />,
  privacy: <EyeOff size={18} />,
  notifications: <Bell size={18} />,
  storefront: <Store size={18} />,
  "time-limits": <Timer size={18} />,
  changes: <RefreshCcw size={18} />,
};

const BIRTHDAY_MESSAGES = [
  "Happy birthday!",
  "Have an awesome birthday!",
  "Hope you have a great day!",
];

const RECENT_LOGINS_KEY = "auth:recent-logins";
const MAX_RECENT_LOGINS = 4;
const NOTIFICATION_SOURCE_FILTERS_KEY = "notifications-source-filters-v1";

type NotificationSourceKey = "friends" | "groups" | "forums";
type NotificationSourceFilters = Record<NotificationSourceKey, boolean>;

const DEFAULT_NOTIFICATION_SOURCE_FILTERS: NotificationSourceFilters = {
  friends: true,
  groups: true,
  forums: true,
};

const normalizeNotificationSourceFilters = (value: unknown): NotificationSourceFilters => {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    friends: typeof raw.friends === "boolean" ? raw.friends : true,
    groups: typeof raw.groups === "boolean" ? raw.groups : true,
    forums: typeof raw.forums === "boolean" ? raw.forums : true,
  };
};

const getNotificationSourceFiltersFromSettings = (
  settings?: NotificationSettings | null
): NotificationSourceFilters => ({
  friends: settings?.friendsNotificationsEnabled !== false,
  groups: settings?.groupsNotificationsEnabled !== false,
  forums: settings?.forumsNotificationsEnabled !== false,
});

const readStoredNotificationSourceFilters = (
  userId?: number | null
): NotificationSourceFilters | null => {
  if (typeof window === "undefined") return null;
  const currentUserId = Number(userId || 0);
  if (!Number.isFinite(currentUserId) || currentUserId <= 0) return null;
  const raw = window.localStorage.getItem(NOTIFICATION_SOURCE_FILTERS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entry = parsed?.[String(currentUserId)];
    if (!entry || typeof entry !== "object") return null;
    return normalizeNotificationSourceFilters(entry);
  } catch {
    return null;
  }
};

const writeStoredNotificationSourceFilters = (
  userId: number,
  value: NotificationSourceFilters
) => {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(NOTIFICATION_SOURCE_FILTERS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const next = {
      ...(parsed && typeof parsed === "object" ? parsed : {}),
      [String(userId)]: value,
    };
    window.localStorage.setItem(NOTIFICATION_SOURCE_FILTERS_KEY, JSON.stringify(next));
  } catch {
    // ignore local storage issues
  }
};

type SidebarProps = {
  active:
    | "dashboard"
    | "friends"
    | "me"
    | "groups"
    | "moderation"
    | "news"
    | "forums"
    | "storefront";
  settingsView?: "profile" | "settings";
  onSettingsViewChange?: (view: "profile" | "settings") => void;
  settingsSection?: SettingsSection;
  onSettingsSectionChange?: (section: SettingsSection) => void;
  groupView?: "feed" | "settings";
  onGroupViewChange?: (view: "feed" | "settings") => void;
  sidebarContent?: ReactNode;
  hideNavLinks?: boolean;
  hideBio?: boolean;
};

const trimPreviewText = (value?: string, max = 72) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return `${text.slice(0, max - 3)}...`;
};

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const isContactLikeLabel = (value: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return false;
  if (isValidEmail(trimmed)) return true;
  if (/^phone[-_\s:]*\d+$/i.test(trimmed)) return true;
  if (/^\+?\d[\d\s().-]{6,}$/.test(trimmed)) return true;
  return false;
};

const toTitleWord = (value: string) => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return trimmed.slice(0, 1).toUpperCase() + trimmed.slice(1).toLowerCase();
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

const sanitizeRecentHandle = (value?: string | null) => {
  const trimmed = String(value || "")
    .trim()
    .replace(/^@+/, "");
  if (!trimmed || isContactLikeLabel(trimmed)) return null;
  return trimmed;
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

const loadRecentLogins = (): RecentLoginEntry[] => {
  if (typeof window === "undefined") return [];
  const raw = window.localStorage.getItem(RECENT_LOGINS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length <= 0) return [];
    return parsed
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
  } catch {
    return [];
  }
};

export default function Sidebar({
  active,
  settingsView = "profile",
  onSettingsViewChange,
  settingsSection = "appearance",
  onSettingsSectionChange,
  groupView = "feed",
  onGroupViewChange,
  sidebarContent,
  hideNavLinks = false,
  hideBio = false,
}: SidebarProps) {
  const navigate = useNavigate();
  const { user, profile, login, logout, appSettings } = useAuth();
  const [showMoreProfile, setShowMoreProfile] = useState(false);
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileCommunityOpen, setMobileCommunityOpen] = useState(false);
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showSwitchProfileModal, setShowSwitchProfileModal] = useState(false);
  const [showSwitchPasswordModal, setShowSwitchPasswordModal] = useState(false);
  const [switchableProfiles, setSwitchableProfiles] = useState<RecentLoginEntry[]>([]);
  const [switchingProfileKey, setSwitchingProfileKey] = useState<string | null>(null);
  const [switchAuthProfile, setSwitchAuthProfile] = useState<RecentLoginEntry | null>(null);
  const [switchAuthPassword, setSwitchAuthPassword] = useState("");
  const [switchAuthLoading, setSwitchAuthLoading] = useState(false);
  const [switchAuthError, setSwitchAuthError] = useState<string | null>(null);
  const [switchAuthInfo, setSwitchAuthInfo] = useState<string | null>(null);
  const [switchAuthChallengeId, setSwitchAuthChallengeId] = useState<string | null>(null);
  const [switchAuthChallengeMethod, setSwitchAuthChallengeMethod] =
    useState<VerificationMethod | null>(null);
  const [switchAuthVerificationCode, setSwitchAuthVerificationCode] = useState("");
  const [switchAuthVerifying, setSwitchAuthVerifying] = useState(false);
  const [switchAuthResending, setSwitchAuthResending] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notificationSourceFilters, setNotificationSourceFilters] =
    useState<NotificationSourceFilters>(DEFAULT_NOTIFICATION_SOURCE_FILTERS);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const {
    counts,
    loading,
    refresh,
    markAllRead,
    previews,
    acceptFriendRequest,
    sendBirthdayMessage,
  } = useNotifications(
    user?.id,
    profile?.notificationSettings,
    profile?.notificationReadState,
    user?.createdAt || null
  );
  const [acceptingRequests, setAcceptingRequests] = useState<Record<string, boolean>>({});
  const [birthdaySending, setBirthdaySending] = useState<Record<string, boolean>>({});

  const normalize = (entry: any) => entry?.attributes ?? entry ?? {};

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setProfileSummary(null);
        return;
      }

      if (profile) {
        const displayName =
          profile.firstName || profile.lastName
            ? `${profile.firstName || ""} ${profile.lastName || ""}`.trim()
            : profile.handle || user.username || "Your Profile";
        setProfileSummary({
          displayName,
          handle: profile.handle || user.username || "Profile",
          avatarUrl: profile.avatarUrl,
          age: profile.age || "",
          hobbies: profile.hobbies || "",
          bio: profile.bio || "",
        });
        return;
      }

      try {
        const res = await api.get("/profiles/me?populate=avatar");
        const entry = res.data?.data;
        if (!entry) return;
        const attrs = normalize(entry);
        let payload: ProfilePayload | null = null;
        if (attrs.encryptedProfile) {
          try {
            payload = await decryptOwnProfilePayload(user.id, attrs.encryptedProfile);
          } catch {
            payload = null;
          }
        }
        if (!payload) {
          payload = buildProfilePayloadFromAttrs(attrs);
        }
        const displayName =
          payload.firstName || payload.lastName
            ? `${payload.firstName || ""} ${payload.lastName || ""}`.trim()
            : attrs.handle || user.username || "Your Profile";
        setProfileSummary({
          displayName,
          handle: attrs.handle || user.username || "Profile",
          avatarUrl: pickMediaUrl(attrs.avatar, { kind: "avatar" }),
          age: payload.age || "",
          hobbies: payload.hobbies || "",
          bio: payload.bio || "",
        });
      } catch {
        // ignore sidebar profile errors
      }
    };
    void load();
  }, [profile, user]);

  useEffect(() => {
    setShowProfileMenu(false);
    setShowNotifications(false);
    setShowSwitchProfileModal(false);
    setShowSwitchPasswordModal(false);
  }, [user]);

  useEffect(() => {
    const currentUserId = Number(user?.id || 0);
    if (!currentUserId) {
      setNotificationSourceFilters(DEFAULT_NOTIFICATION_SOURCE_FILTERS);
      return;
    }
    const stored = readStoredNotificationSourceFilters(currentUserId);
    if (stored) {
      setNotificationSourceFilters(stored);
      return;
    }
    setNotificationSourceFilters(
      getNotificationSourceFiltersFromSettings(profile?.notificationSettings)
    );
  }, [
    user?.id,
    profile?.notificationSettings?.friendsNotificationsEnabled,
    profile?.notificationSettings?.groupsNotificationsEnabled,
    profile?.notificationSettings?.forumsNotificationsEnabled,
  ]);

  // Close mobile menu when the active page changes
  useEffect(() => {
    setMenuOpen(false);
    setShowProfileMenu(false);
    setShowNotifications(false);
    setMobileCommunityOpen(false);
    setMobileAccountOpen(false);
    setShowSwitchProfileModal(false);
    setShowSwitchPasswordModal(false);
  }, [active]);

  useEffect(() => {
    if (!showNotifications) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeNotifications();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showNotifications]);

  useEffect(() => {
    if (!showProfileMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showProfileMenu]);

  useEffect(() => {
    const currentUserId = Number(user?.id || 0);
    if (!currentUserId) {
      setSwitchableProfiles([]);
      setShowSwitchProfileModal(false);
      setShowSwitchPasswordModal(false);
      return;
    }

    const syncSwitchableProfiles = () => {
      const entries = loadRecentLogins().filter((entry) => entry.id !== currentUserId);
      setSwitchableProfiles(entries);
      if (!entries.length) {
        setShowSwitchProfileModal(false);
        setShowSwitchPasswordModal(false);
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== RECENT_LOGINS_KEY) return;
      syncSwitchableProfiles();
    };

    syncSwitchableProfiles();
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [user?.id]);

  useEffect(() => {
    if (!showSwitchProfileModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowSwitchProfileModal(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showSwitchProfileModal]);

  useEffect(() => {
    if (!showSwitchPasswordModal) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeSwitchPasswordModal();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showSwitchPasswordModal]);

  const profileCard = useMemo(() => {
    if (!user) return null;
    const displayName =
      profileSummary?.displayName?.trim() ||
      profileSummary?.handle?.trim() ||
      user.username ||
      "Your Profile";
    const handle = profileSummary?.handle?.trim() || user.username || "Profile";
    return {
      displayName,
      handle,
      avatarUrl: profileSummary?.avatarUrl,
    };
  }, [profileSummary, user]);

  const nameForDisplay = profileCard?.displayName || "Me";
  const switchDeviceLabel = useMemo(() => getDefaultDeviceLabel(), []);

  const resetSwitchAuthState = () => {
    setSwitchAuthProfile(null);
    setSwitchAuthPassword("");
    setSwitchAuthLoading(false);
    setSwitchAuthError(null);
    setSwitchAuthInfo(null);
    setSwitchAuthChallengeId(null);
    setSwitchAuthChallengeMethod(null);
    setSwitchAuthVerificationCode("");
    setSwitchAuthVerifying(false);
    setSwitchAuthResending(false);
  };

  const closeSwitchPasswordModal = () => {
    setShowSwitchPasswordModal(false);
    resetSwitchAuthState();
  };

  const completeSwitchLogin = (payload: AuthResponse) => {
    if (!payload?.jwt || !payload?.user) return false;
    login(payload.user, payload.jwt, { rememberDevice: true });
    setShowSwitchProfileModal(false);
    setShowSwitchPasswordModal(false);
    setShowProfileMenu(false);
    setShowNotifications(false);
    setMenuOpen(false);
    setSwitchingProfileKey(null);
    resetSwitchAuthState();
    return true;
  };

  const applySwitchLoginStartResponse = (data: LoginStartResponse) => {
    if ("jwt" in data && data.jwt && data.user) {
      return completeSwitchLogin(data);
    }

    if ("requiresVerification" in data && data.requiresVerification) {
      setSwitchAuthChallengeId(data.challengeId);
      setSwitchAuthChallengeMethod(data.method);
      setSwitchAuthVerificationCode("");
      setSwitchAuthError(null);
      setSwitchAuthInfo(
        data.deliveryHint
          ? `Enter the ${data.method.toUpperCase()} code sent to ${data.deliveryHint}.`
          : "Enter the verification code."
      );
      return true;
    }

    if ("requiresEmailConfirmation" in data && data.requiresEmailConfirmation) {
      setSwitchAuthError("Please confirm your email before logging in.");
      return false;
    }

    return false;
  };

  const parseSwitchAuthError = (error: unknown, fallback = "Unable to switch profile.") => {
    if (!axios.isAxiosError(error)) {
      return {
        status: null as number | null,
        message: fallback,
        messageLower: fallback.toLowerCase(),
      };
    }
    const message =
      String(error.response?.data?.error?.message || error.response?.data?.message || "").trim() ||
      fallback;
    return {
      status: Number(error.response?.status || 0) || null,
      message,
      messageLower: message.toLowerCase(),
    };
  };

  const handleLogoClick = () => {
    navigate("/dashboard");
    setMenuOpen(false);
  };

  const handleProfileAction = (path: string) => {
    navigate(path);
    setShowProfileMenu(false);
    setShowNotifications(false);
    setMenuOpen(false);
  };

  const openSwitchProfileModal = () => {
    if (!switchableProfiles.length) return;
    setSwitchAuthProfile(null);
    setSwitchAuthPassword("");
    setSwitchAuthError(null);
    setSwitchAuthInfo(null);
    setSwitchAuthChallengeId(null);
    setSwitchAuthChallengeMethod(null);
    setSwitchAuthVerificationCode("");
    setShowSwitchPasswordModal(false);
    setShowSwitchProfileModal(true);
    setShowProfileMenu(false);
    setShowNotifications(false);
    setMenuOpen(false);
  };

  const handleSwitchProfileSelect = async (entry: RecentLoginEntry) => {
    if (!entry?.identifier) return;
    const normalizedIdentifier = String(entry.identifier || "").trim().toLowerCase();
    if (!normalizedIdentifier) return;
    const profileKey = `${entry.id}:${entry.identifier}`;
    setSwitchingProfileKey(profileKey);

    if (typeof window !== "undefined") {
      const existing = loadRecentLogins();
      const selected = existing.find(
        (current) =>
          current.id === entry.id &&
          String(current.identifier || "").trim().toLowerCase() ===
            normalizedIdentifier
      );
      const selectedEntry = {
        ...(selected || entry),
        identifier: normalizedIdentifier,
        lastUsedAt: Date.now(),
      };
      const selectedId = Number(selectedEntry.id || 0);
      const selectedIdentifier = String(selectedEntry.identifier || "")
        .trim()
        .toLowerCase();
      const next = [
        selectedEntry,
        ...existing.filter(
          (current) =>
            !(
              Number(current.id || 0) === selectedId &&
              String(current.identifier || "").trim().toLowerCase() ===
                selectedIdentifier
            )
        ),
      ].slice(0, MAX_RECENT_LOGINS);
      if (serializeRecentLogins(next) !== serializeRecentLogins(existing)) {
        window.localStorage.setItem(RECENT_LOGINS_KEY, serializeRecentLogins(next));
      }
    }

    try {
      setSwitchAuthError(null);
      setSwitchAuthInfo(null);
      const trustedResponse = await api.post<AuthResponse>("/auth/login/trusted", {
        identifier: normalizedIdentifier,
        deviceId: getOrCreateDeviceId(),
        deviceLabel: switchDeviceLabel,
      });
      if (completeSwitchLogin(trustedResponse.data)) {
        return;
      }
      setSwitchAuthError("Unable to switch profile.");
    } catch (error: unknown) {
      const parsed = parseSwitchAuthError(error, "Unable to switch profile.");
      const needsPassword =
        parsed.status === 401 ||
        parsed.messageLower.includes("not trusted") ||
        parsed.messageLower.includes("trusted device") ||
        parsed.messageLower.includes("invalid") ||
        parsed.messageLower.includes("password");

      setSwitchAuthProfile(entry);
      setSwitchAuthPassword("");
      setSwitchAuthChallengeId(null);
      setSwitchAuthChallengeMethod(null);
      setSwitchAuthVerificationCode("");
      setSwitchAuthError(
        needsPassword
          ? null
          : parsed.message
      );
      setSwitchAuthInfo(
        needsPassword ? "Enter your password to switch to this profile." : null
      );
      setShowSwitchPasswordModal(true);
      setShowSwitchProfileModal(false);
    } finally {
      setSwitchingProfileKey(null);
    }
  };

  const handleSwitchPasswordSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!switchAuthProfile?.identifier) return;
    if (!switchAuthPassword.trim()) {
      setSwitchAuthError("Enter your password.");
      return;
    }

    setSwitchAuthLoading(true);
    setSwitchAuthError(null);
    setSwitchAuthInfo(null);

    try {
      const response = await api.post<LoginStartResponse>("/auth/login", {
        identifier: String(switchAuthProfile.identifier || "").trim().toLowerCase(),
        password: switchAuthPassword,
        rememberDevice: true,
        deviceId: getOrCreateDeviceId(),
        deviceLabel: switchDeviceLabel,
        source: "dashboard_switch_profile",
      });

      if (!applySwitchLoginStartResponse(response.data)) {
        setSwitchAuthError("Login failed. Please try again.");
      }
    } catch (error: unknown) {
      const parsed = parseSwitchAuthError(error, "Unable to switch profile.");
      if (
        parsed.messageLower.includes("invalid identifier") ||
        parsed.messageLower.includes("invalid password")
      ) {
        setSwitchAuthError("Incorrect password. Please try again.");
      } else {
        setSwitchAuthError(parsed.message);
      }
    } finally {
      setSwitchAuthLoading(false);
    }
  };

  const handleSwitchVerifySubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!switchAuthChallengeId) {
      setSwitchAuthError("Verification expired. Enter password again.");
      return;
    }
    if (!switchAuthVerificationCode.trim()) {
      setSwitchAuthError("Enter the verification code.");
      return;
    }

    setSwitchAuthVerifying(true);
    setSwitchAuthError(null);
    setSwitchAuthInfo(null);
    try {
      const response = await api.post<AuthResponse>("/auth/login/verify", {
        challengeId: switchAuthChallengeId,
        code: switchAuthVerificationCode.trim(),
      });
      if (!completeSwitchLogin(response.data)) {
        setSwitchAuthError("Unable to verify. Please try again.");
      }
    } catch (error: unknown) {
      const parsed = parseSwitchAuthError(error, "Verification failed.");
      setSwitchAuthError(parsed.message);
    } finally {
      setSwitchAuthVerifying(false);
    }
  };

  const handleSwitchResend = async () => {
    if (!switchAuthChallengeId) return;
    if (switchAuthChallengeMethod === "totp") {
      setSwitchAuthError("Authenticator codes cannot be resent.");
      return;
    }
    setSwitchAuthResending(true);
    setSwitchAuthError(null);
    setSwitchAuthInfo(null);
    try {
      await api.post("/auth/login/resend", { challengeId: switchAuthChallengeId });
      setSwitchAuthInfo(
        switchAuthChallengeMethod === "email"
          ? "Code resent. Check your email."
          : "Code resent. Check your phone."
      );
    } catch (error: unknown) {
      const parsed = parseSwitchAuthError(error, "Unable to resend code.");
      setSwitchAuthError(parsed.message);
    } finally {
      setSwitchAuthResending(false);
    }
  };

  const closeNotifications = () => {
    setShowNotifications(false);
  };

  const toggleNotifications = () => {
    setShowNotifications((prev) => {
      const next = !prev;
      if (next) refresh();
      return next;
    });
    setShowProfileMenu(false);
    setMenuOpen(false);
  };

  const handleNotificationAction = (path: string) => {
    if (filteredNotificationTotal > 0) {
      markAllRead();
    }
    navigate(path);
    setShowProfileMenu(false);
    setShowNotifications(false);
    setMenuOpen(false);
  };

  const toggleMobileMenu = () => {
    setMenuOpen((prev) => !prev);
    setShowNotifications(false);
  };

  // prefer handle if loaded, else email
  const secondaryLine = profileCard?.handle || "Profile";
  const fallbackInitial = nameForDisplay.charAt(0).toUpperCase();
  const canToggleSettings = false;
  const isSettingsView = settingsView === "settings";
  const canSelectSettingsSection =
    canToggleSettings &&
    isSettingsView &&
    typeof onSettingsSectionChange === "function";
  const canToggleGroupSettings =
    active === "groups" && typeof onGroupViewChange === "function";
  const isGroupSettingsView = groupView === "settings";
  const isStaff = user?.appRole === "admin" || user?.appRole === "moderator";
  const newsroomEnabled = appSettings?.newsroomEnabled !== false;
  const storefrontEnabled = appSettings?.storefrontEnabled !== false;
  const showNavLinks = !hideNavLinks;
  const showBio = !hideBio;
  const isFriendsMobileMenu = active === "friends";
  const showMobileCustomContent = isFriendsMobileMenu && Boolean(sidebarContent);
  const hasCommunityLinks = true;
  const hasAccountLinks = true;
  const hasSwitchableProfiles = switchableProfiles.length > 0;

  useEffect(() => {
    if (!menuOpen || isFriendsMobileMenu) return;
    setMobileCommunityOpen(false);
    setMobileAccountOpen(false);
  }, [
    isFriendsMobileMenu,
    menuOpen,
  ]);

  const handleSettingsToggle = () => {
    if (!onSettingsViewChange) return;
    setShowProfileMenu(false);
    setShowNotifications(false);
    onSettingsViewChange(isSettingsView ? "profile" : "settings");
  };

  const handleSettingsSectionChange = (section: SettingsSection) => {
    if (!onSettingsSectionChange) return;
    setShowProfileMenu(false);
    setShowNotifications(false);
    setMenuOpen(false);
    onSettingsSectionChange(section);
  };

  const handleGroupSettingsToggle = () => {
    if (!onGroupViewChange) return;
    setShowProfileMenu(false);
    setShowNotifications(false);
    setMenuOpen(false);
    onGroupViewChange(isGroupSettingsView ? "feed" : "settings");
  };

  const birthdayPreviewText = useMemo(() => {
    if (counts.birthdays <= 0) return "";
    if (!previews.birthdays.length) return "A friend has a birthday today.";
    const [first] = previews.birthdays;
    const remaining = Math.max(0, counts.birthdays - 1);
    if (remaining > 0) {
      return `${first.displayName} and ${remaining} other friends have birthdays today.`;
    }
    return `It is ${first.displayName}'s birthday today.`;
  }, [counts.birthdays, previews.birthdays]);

  const friendPostPreviewText = useMemo(() => {
    if (counts.friendPosts <= 0) return "";
    if (!previews.friendPosts) return "New friend posts are waiting.";
    const snippet = trimPreviewText(
      previews.friendPosts.title || previews.friendPosts.content,
      64
    );
    const owner = previews.friendPosts.ownerName || "A friend";
    return snippet ? `${owner} posted "${snippet}"` : `${owner} shared a new post.`;
  }, [counts.friendPosts, previews.friendPosts]);

  const commentPreviewText = useMemo(() => {
    if (counts.comments <= 0) return "";
    if (!previews.comments) return "New comments are waiting.";
    const snippet = trimPreviewText(previews.comments.body, 64);
    const owner = previews.comments.ownerName || "Someone";
    return snippet ? `${owner} commented: "${snippet}"` : `${owner} commented on your post.`;
  }, [counts.comments, previews.comments]);

  const feedbackPreviewText = useMemo(() => {
    if (counts.feedbackRequests <= 0) return "";
    if (!previews.feedbackRequests.length) return "New feedback requests are waiting.";
    const first = previews.feedbackRequests[0];
    const snippet = trimPreviewText(first.title || first.content, 64);
    const owner = first.ownerName || "Someone";
    const audience =
      first.feedbackAudience === "public"
        ? "public feedback"
        : first.feedbackAudience === "friends"
        ? "friends feedback"
        : "feedback";
    return snippet
      ? `${owner} asked for ${audience}: "${snippet}"`
      : `${owner} asked for ${audience}.`;
  }, [counts.feedbackRequests, previews.feedbackRequests]);

  const groupUpdatePreviewText = useMemo(() => {
    if (counts.groupUpdates <= 0) return "";
    if (!previews.groupUpdates) return "New group updates are waiting.";
    const snippet = trimPreviewText(previews.groupUpdates.message, 72);
    if (snippet) return snippet;
    const actor = previews.groupUpdates.actorName;
    return actor ? `${actor} posted a group update.` : "New group update received.";
  }, [counts.groupUpdates, previews.groupUpdates]);

  const forumPreviewText = useMemo(() => {
    if (counts.forums <= 0) return "";
    if (!previews.forums) return "New forum replies are waiting.";
    const owner = previews.forums.ownerName || "Someone";
    const snippet = trimPreviewText(previews.forums.message, 72);
    const postTitle = String(previews.forums.postTitle || "").trim();
    if (snippet && postTitle) return `${owner} replied on "${postTitle}": "${snippet}"`;
    if (snippet) return `${owner} replied in forums: "${snippet}"`;
    if (postTitle) return `${owner} replied on "${postTitle}".`;
    return `${owner} replied in forums.`;
  }, [counts.forums, previews.forums]);

  const groupUpdatesTarget = "/groups";
  const forumsTarget = "/forums";

  const securityPreviewText = useMemo(() => {
    if (counts.security <= 0) return "";
    if (!previews.security) return "New security alerts are waiting.";
    const snippet = trimPreviewText(previews.security.message, 72);
    if (snippet) return snippet;
    const actor = previews.security.actorName;
    return actor ? `${actor} sent a security update.` : "New security update received.";
  }, [counts.security, previews.security]);

  const securityTarget = "/me?view=settings&section=security";

  const likesPreviewText = useMemo(() => {
    if (counts.likes <= 0) return "";
    return counts.likes === 1
      ? "1 new like on your posts."
      : `${counts.likes} new likes on your posts.`;
  }, [counts.likes]);

  const friendsNotificationTotal =
    counts.birthdays +
    counts.requests +
    counts.friendPosts +
    counts.feedbackRequests +
    counts.comments +
    counts.likes;
  const groupsNotificationTotal = counts.groupUpdates;
  const forumsNotificationTotal = counts.forums;
  const enabledSourceCount = Number(notificationSourceFilters.friends) +
    Number(notificationSourceFilters.groups) +
    Number(notificationSourceFilters.forums);
  const filteredNotificationTotal =
    (notificationSourceFilters.friends ? friendsNotificationTotal : 0) +
    (notificationSourceFilters.groups ? groupsNotificationTotal : 0) +
    (notificationSourceFilters.forums ? forumsNotificationTotal : 0) +
    counts.security;

  const persistNotificationSourceFilters = async (next: NotificationSourceFilters) => {
    const currentUserId = Number(user?.id || 0);
    if (!currentUserId) return;
    writeStoredNotificationSourceFilters(currentUserId, next);
    try {
      await api.put("/profiles/me", {
        data: {
          notificationSettings: {
            ...(profile?.notificationSettings || {}),
            friendsNotificationsEnabled: next.friends,
            groupsNotificationsEnabled: next.groups,
            forumsNotificationsEnabled: next.forums,
          },
        },
      });
    } catch (error) {
      console.warn("Unable to save notification source filters:", error);
    }
  };

  const toggleNotificationSourceFilter = (key: NotificationSourceKey) => {
    setNotificationSourceFilters((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      void persistNotificationSourceFilters(next);
      return next;
    });
  };

  const handleAcceptRequest = async (request: FriendRequestPreview) => {
    const key = String(request.id);
    if (acceptingRequests[key]) return;
    setAcceptingRequests((prev) => ({ ...prev, [key]: true }));
    const ok = await acceptFriendRequest(request);
    if (!ok) {
      console.error("Failed to accept friend request");
    }
    setAcceptingRequests((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleBirthdayMessage = async (preview: BirthdayPreview, message: string) => {
    const key = `${preview.userId}:${message}`;
    if (birthdaySending[key]) return;
    setBirthdaySending((prev) => ({ ...prev, [key]: true }));
    const ok = await sendBirthdayMessage(preview, message);
    if (!ok) {
      console.error("Failed to send birthday message");
    }
    setBirthdaySending((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const renderNotificationList = () => (
    <div className="sidebar-notification-list">
      <div className="sidebar-notification-filter-panel">
        <div className="sidebar-notification-filter-title">Source filters</div>
        <div className="sidebar-notification-filters" role="group" aria-label="Notification sources">
          <button
            type="button"
            className={`sidebar-notification-filter-chip${
              notificationSourceFilters.friends ? " is-active" : ""
            }`}
            onClick={() => toggleNotificationSourceFilter("friends")}
            aria-pressed={notificationSourceFilters.friends}
          >
            <span>Friends</span>
            <span className="sidebar-notification-filter-chip-count">{friendsNotificationTotal}</span>
          </button>
          <button
            type="button"
            className={`sidebar-notification-filter-chip${
              notificationSourceFilters.groups ? " is-active" : ""
            }`}
            onClick={() => toggleNotificationSourceFilter("groups")}
            aria-pressed={notificationSourceFilters.groups}
          >
            <span>Groups</span>
            <span className="sidebar-notification-filter-chip-count">{groupsNotificationTotal}</span>
          </button>
          <button
            type="button"
            className={`sidebar-notification-filter-chip${
              notificationSourceFilters.forums ? " is-active" : ""
            }`}
            onClick={() => toggleNotificationSourceFilter("forums")}
            aria-pressed={notificationSourceFilters.forums}
          >
            <span>Forums</span>
            <span className="sidebar-notification-filter-chip-count">{forumsNotificationTotal}</span>
          </button>
        </div>
        <div className="sidebar-notification-filter-actions">
          <button
            type="button"
            className="sidebar-notification-filter-action"
            disabled={enabledSourceCount === 3}
            onClick={() => {
              setNotificationSourceFilters(DEFAULT_NOTIFICATION_SOURCE_FILTERS);
              void persistNotificationSourceFilters(DEFAULT_NOTIFICATION_SOURCE_FILTERS);
            }}
          >
            All on
          </button>
          <button
            type="button"
            className="sidebar-notification-filter-action"
            disabled={enabledSourceCount === 0}
            onClick={() => {
              const next: NotificationSourceFilters = {
                friends: false,
                groups: false,
                forums: false,
              };
              setNotificationSourceFilters(next);
              void persistNotificationSourceFilters(next);
            }}
          >
            Turn off
          </button>
        </div>
        {enabledSourceCount === 0 && (
          <div className="sidebar-notification-status">
            Source notifications are off. Security alerts still appear.
          </div>
        )}
      </div>

      {notificationSourceFilters.friends && (
        <>
          <div className="sidebar-notification-group">
            <button
              type="button"
              className="sidebar-notification-item is-action"
              onClick={() => handleNotificationAction("/friends")}
            >
              <span>Birthdays</span>
              <span className="sidebar-notification-count">{counts.birthdays}</span>
            </button>
            {counts.birthdays > 0 && (
              <div className="sidebar-notification-preview-list">
                {previews.birthdays.length > 0 ? (
                  previews.birthdays.map((birthday) => (
                    <div key={birthday.id} className="sidebar-notification-preview">
                      <div className="sidebar-notification-preview-row">
                        <span className="sidebar-notification-preview-text">
                          {birthday.displayName} has a birthday today.
                        </span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                        {BIRTHDAY_MESSAGES.map((message) => {
                          const key = `${birthday.userId}:${message}`;
                          return (
                            <button
                              key={key}
                              type="button"
                              className="sidebar-notification-action"
                              disabled={birthdaySending[key]}
                              onClick={() => void handleBirthdayMessage(birthday, message)}
                            >
                              {birthdaySending[key] ? "Sending..." : message}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="sidebar-notification-preview">
                    <span className="sidebar-notification-preview-text">
                      {birthdayPreviewText || "A friend has a birthday today."}
                    </span>
                  </div>
                )}
                {previews.birthdays.length > 0 && counts.birthdays > previews.birthdays.length && (
                  <div className="sidebar-notification-preview-more">
                    +{counts.birthdays - previews.birthdays.length} more birthdays
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="sidebar-notification-group">
            <button
              type="button"
              className="sidebar-notification-item is-action"
              onClick={() => handleNotificationAction("/friends")}
            >
              <span>Friend requests</span>
              <span className="sidebar-notification-count">{counts.requests}</span>
            </button>
            {counts.requests > 0 && (
              <div className="sidebar-notification-preview-list">
                {previews.requests.length > 0 ? (
                  previews.requests.map((request) => {
                    const key = String(request.id);
                    return (
                      <div key={key} className="sidebar-notification-preview-row">
                        <span className="sidebar-notification-preview-text">
                          {request.requesterName} sent you a friend request.
                        </span>
                        <button
                          type="button"
                          className="btn ghost tiny"
                          disabled={acceptingRequests[key]}
                          onClick={() => void handleAcceptRequest(request)}
                        >
                          {acceptingRequests[key] ? "Accepting..." : "Accept"}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="sidebar-notification-preview">
                    <span className="sidebar-notification-preview-text">
                      You have a new friend request.
                    </span>
                  </div>
                )}
                {previews.requests.length > 0 && counts.requests > previews.requests.length && (
                  <div className="sidebar-notification-preview-more">
                    +{counts.requests - previews.requests.length} more requests
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="sidebar-notification-group">
            <button
              type="button"
              className="sidebar-notification-item is-action"
              onClick={() => handleNotificationAction("/friends")}
            >
              <span>Friend posts</span>
              <span className="sidebar-notification-count">{counts.friendPosts}</span>
            </button>
            {counts.friendPosts > 0 && friendPostPreviewText && (
              <div className="sidebar-notification-preview">
                <span className="sidebar-notification-preview-text">{friendPostPreviewText}</span>
              </div>
            )}
          </div>
          <div className="sidebar-notification-group">
            <button
              type="button"
              className="sidebar-notification-item is-action"
              onClick={() => handleNotificationAction("/dashboard")}
            >
              <span>Feedback requests</span>
              <span className="sidebar-notification-count">{counts.feedbackRequests}</span>
            </button>
            {counts.feedbackRequests > 0 && (
              <div className="sidebar-notification-preview-list">
                {previews.feedbackRequests.length > 0 ? (
                  previews.feedbackRequests.map((request) => {
                    const audience =
                      request.feedbackAudience === "public"
                        ? "Public feedback"
                        : request.feedbackAudience === "friends"
                        ? "Friends feedback"
                        : "Feedback request";
                    const snippet = trimPreviewText(request.title || request.content, 56);
                    return (
                      <button
                        key={request.id}
                        type="button"
                        className="sidebar-notification-preview-row is-action"
                        onClick={() =>
                          handleNotificationAction(`/dashboard#post-${request.postKey}`)
                        }
                      >
                        <span className="sidebar-notification-preview-text">
                          {request.ownerName} · {audience}
                          {snippet ? `: "${snippet}"` : ""}
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <div className="sidebar-notification-preview">
                    <span className="sidebar-notification-preview-text">
                      {feedbackPreviewText || "New feedback requests are waiting."}
                    </span>
                  </div>
                )}
                {previews.feedbackRequests.length > 0 &&
                  counts.feedbackRequests > previews.feedbackRequests.length && (
                    <div className="sidebar-notification-preview-more">
                      +{counts.feedbackRequests - previews.feedbackRequests.length} more requests
                    </div>
                  )}
              </div>
            )}
          </div>
          <div className="sidebar-notification-group">
            <button
              type="button"
              className="sidebar-notification-item is-action"
              onClick={() => handleNotificationAction("/dashboard")}
            >
              <span>Comments on your posts</span>
              <span className="sidebar-notification-count">{counts.comments}</span>
            </button>
            {counts.comments > 0 && commentPreviewText && (
              <div className="sidebar-notification-preview">
                <span className="sidebar-notification-preview-text">{commentPreviewText}</span>
              </div>
            )}
          </div>
          <div className="sidebar-notification-group">
            <button
              type="button"
              className="sidebar-notification-item is-action"
              onClick={() => handleNotificationAction("/dashboard")}
            >
              <span>Likes on your posts</span>
              <span className="sidebar-notification-count">{counts.likes}</span>
            </button>
            {counts.likes > 0 && likesPreviewText && (
              <div className="sidebar-notification-preview">
                <span className="sidebar-notification-preview-text">{likesPreviewText}</span>
              </div>
            )}
          </div>
        </>
      )}

      {notificationSourceFilters.groups && (
        <div className="sidebar-notification-group">
          <button
            type="button"
            className="sidebar-notification-item is-action"
            onClick={() => handleNotificationAction(groupUpdatesTarget)}
          >
            <span>Group updates</span>
            <span className="sidebar-notification-count">{counts.groupUpdates}</span>
          </button>
          {counts.groupUpdates > 0 && groupUpdatePreviewText && (
            <div className="sidebar-notification-preview">
              <span className="sidebar-notification-preview-text">{groupUpdatePreviewText}</span>
            </div>
          )}
        </div>
      )}

      {notificationSourceFilters.forums && (
        <div className="sidebar-notification-group">
          <button
            type="button"
            className="sidebar-notification-item is-action"
            onClick={() => handleNotificationAction(forumsTarget)}
          >
            <span>Forum updates</span>
            <span className="sidebar-notification-count">{counts.forums}</span>
          </button>
          {counts.forums > 0 && forumPreviewText && (
            <div className="sidebar-notification-preview">
              <span className="sidebar-notification-preview-text">{forumPreviewText}</span>
            </div>
          )}
        </div>
      )}

      <div className="sidebar-notification-group">
        <button
          type="button"
          className="sidebar-notification-item is-action"
          onClick={() => handleNotificationAction(securityTarget)}
        >
          <span>Security</span>
          <span className="sidebar-notification-count">{counts.security}</span>
        </button>
        {counts.security > 0 && securityPreviewText && (
          <div className="sidebar-notification-preview">
            <span className="sidebar-notification-preview-text">{securityPreviewText}</span>
          </div>
        )}
      </div>

      {loading && <div className="sidebar-notification-status">Refreshing...</div>}
      {!loading && filteredNotificationTotal === 0 && (
        <div className="sidebar-notification-status">All caught up.</div>
      )}
    </div>
  );

  return (
    <>
      <ProfilePhotoModal open={photoModalOpen} onClose={() => setPhotoModalOpen(false)} />
      <div className={`sidebar-shell ${menuOpen ? "open" : ""}`}>
      <div className="sidebar-topbar">
        <button className="brand" type="button" onClick={handleLogoClick} style={{ cursor: "pointer" }}>
          <span className="brand-mark" aria-hidden="true">
            <img src="/logo2.png" alt="Your Social Place Logo" />
          </span>
          <span className="brand-text">Your Social Place</span>
        </button>
        <div className="mobile-topbar-actions">
          <button
            type="button"
            className={`mobile-avatar-button ${menuOpen ? "is-open" : ""}`}
            onClick={toggleMobileMenu}
            aria-label={`Open profile menu for ${nameForDisplay}`}
          >
            {profileCard?.avatarUrl ? (
              <AvatarImage
                src={profileCard.avatarUrl}
                alt={nameForDisplay}
                className="mobile-avatar-image"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="mobile-avatar-fallback" aria-hidden="true">
                {fallbackInitial}
              </span>
            )}
          </button>
          <button
            type="button"
            className="sidebar-bell mobile-topbar-bell"
            aria-label={`Notifications (${filteredNotificationTotal})`}
            onClick={toggleNotifications}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 22a2.5 2.5 0 0 0 2.45-2H9.55A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2z"
                fill="currentColor"
              />
            </svg>
            {filteredNotificationTotal > 0 && (
              <span className="sidebar-bell-badge">
                {filteredNotificationTotal > 99 ? "99+" : filteredNotificationTotal}
              </span>
            )}
          </button>
          {menuOpen && (
            <>
              <button
                type="button"
                className="mobile-profile-menu-backdrop"
                aria-label="Close navigation menu"
                onClick={() => setMenuOpen(false)}
              />
              <div
                className={`mobile-profile-menu${
                  showMobileCustomContent ? " has-custom-content" : ""
                }`}
                role="dialog"
                aria-modal="true"
                aria-label="Mobile navigation menu"
              >
                <div className="mobile-profile-menu-header">
                  <strong className="mobile-profile-menu-title">Navigation</strong>
                  <button
                    type="button"
                    className="mobile-profile-menu-close"
                    aria-label="Close navigation menu"
                    onClick={() => setMenuOpen(false)}
                  >
                    <X size={16} />
                  </button>
                </div>
                {isFriendsMobileMenu ? (
                  <>
                  <button
                    className="mobile-profile-item"
                    type="button"
                    data-accent="dashboard"
                    onClick={() => handleProfileAction("/dashboard")}
                  >
                    <span className="sidebar-nav-icon" aria-hidden="true">
                      <LayoutDashboard size={18} />
                    </span>
                    <span>My Dashboard</span>
                  </button>
                  <button
                    className="mobile-profile-item"
                    type="button"
                    data-accent="profile-photo"
                    onClick={() => {
                      setPhotoModalOpen(true);
                      setMenuOpen(false);
                      setShowProfileMenu(false);
                    }}
                  >
                    <span className="sidebar-nav-icon" aria-hidden="true">
                      <User size={18} />
                    </span>
                    <span>
                      {profileCard?.avatarUrl ? "Edit Profile Photo" : "Add Profile Photo"}
                    </span>
                  </button>
                  <button
                    className="mobile-profile-item"
                    type="button"
                    data-accent="settings"
                    onClick={() => handleProfileAction("/me?view=settings")}
                  >
                    <span className="sidebar-nav-icon" aria-hidden="true">
                      <Settings size={18} />
                    </span>
                    <span>Account settings</span>
                  </button>
                  {sidebarContent && (
                    <>
                      <div className="mobile-profile-divider" />
                      <div className="mobile-custom-content">{sidebarContent}</div>
                    </>
                  )}
                  <div className="mobile-profile-divider" />
                  {hasSwitchableProfiles && (
                    <button
                      className="mobile-profile-item"
                      type="button"
                      data-accent="profile-switch"
                      onClick={openSwitchProfileModal}
                    >
                      <span className="sidebar-nav-icon" aria-hidden="true">
                        <RefreshCcw size={18} />
                      </span>
                      <span>Switch profile</span>
                    </button>
                  )}
                  <button
                    className="mobile-profile-item"
                    type="button"
                    data-accent="logout"
                    onClick={() => {
                      logout("user-action");
                      navigate("/login");
                      setMenuOpen(false);
                    }}
                  >
                    <span className="sidebar-nav-icon" aria-hidden="true">
                      <LogOut size={18} />
                    </span>
                    <span>Logout</span>
                  </button>
                  </>
                ) : (
                  <>
                  <button
                    className="mobile-profile-item"
                    type="button"
                    data-accent="dashboard"
                    onClick={() => handleProfileAction("/dashboard")}
                  >
                    <span className="sidebar-nav-icon" aria-hidden="true">
                      <LayoutDashboard size={18} />
                    </span>
                    <span>My Dashboard</span>
                  </button>
                  {hasCommunityLinks && (
                    <div className="mobile-profile-section">
                      <button
                        className={`mobile-profile-section-toggle${
                          mobileCommunityOpen ? " is-open" : ""
                        }`}
                        type="button"
                        onClick={() => setMobileCommunityOpen((prev) => !prev)}
                        aria-expanded={mobileCommunityOpen}
                        aria-controls="mobile-community-links"
                      >
                        <span className="mobile-profile-section-title">Community</span>
                        <span
                          className={`mobile-profile-section-chevron${
                            mobileCommunityOpen ? " is-open" : ""
                          }`}
                          aria-hidden="true"
                        >
                          <ChevronDown size={16} />
                        </span>
                      </button>
                      {mobileCommunityOpen && (
                        <div id="mobile-community-links" className="mobile-profile-section-body">
                          <button
                            className="mobile-profile-item"
                            type="button"
                            data-accent="friends"
                            onClick={() => handleProfileAction("/friends")}
                          >
                            <span className="sidebar-nav-icon" aria-hidden="true">
                              <Users size={18} />
                            </span>
                            <span>My Friends</span>
                          </button>
                          <button
                            className="mobile-profile-item"
                            type="button"
                            data-accent="groups"
                            onClick={() => handleProfileAction("/groups")}
                          >
                            <span className="sidebar-nav-icon" aria-hidden="true">
                              <UsersRound size={18} />
                            </span>
                            <span>My Groups</span>
                          </button>
                          <button
                            className="mobile-profile-item"
                            type="button"
                            data-accent="forums"
                            onClick={() => handleProfileAction("/forums")}
                          >
                            <span className="sidebar-nav-icon" aria-hidden="true">
                              <MessageSquare size={18} />
                            </span>
                            <span>Forums</span>
                          </button>
                          <button
                            className={`mobile-profile-item${
                              storefrontEnabled ? "" : " mobile-profile-item--disabled"
                            }${active === "storefront" ? " is-active" : ""}`}
                            type="button"
                            data-accent="storefront"
                            disabled={!storefrontEnabled}
                            aria-disabled={!storefrontEnabled}
                            onClick={() => {
                              if (!storefrontEnabled) return;
                              handleProfileAction("/storefront");
                            }}
                          >
                            <span className="sidebar-nav-icon" aria-hidden="true">
                              <Store size={18} />
                            </span>
                            <span>
                              {storefrontEnabled
                                ? "StoreFront"
                                : "StoreFront (Coming Soon!)"}
                            </span>
                          </button>
                          <button
                            className={`mobile-profile-item${
                              newsroomEnabled ? "" : " mobile-profile-item--disabled"
                            }`}
                            type="button"
                            data-accent="news"
                            disabled={!newsroomEnabled}
                            aria-disabled={!newsroomEnabled}
                            onClick={() => {
                              if (!newsroomEnabled) return;
                              handleProfileAction("/news");
                            }}
                          >
                            <span className="sidebar-nav-icon" aria-hidden="true">
                              <Newspaper size={18} />
                            </span>
                            <span>
                              {newsroomEnabled ? "Newsroom" : "Newsroom (Coming soon)"}
                            </span>
                          </button>
                          {isStaff && (
                            <button
                              className="mobile-profile-item"
                              type="button"
                              data-accent="moderation"
                              onClick={() => handleProfileAction("/moderation")}
                            >
                              <span className="sidebar-nav-icon" aria-hidden="true">
                                <Shield size={18} />
                              </span>
                              <span>Moderation</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {hasAccountLinks && (
                    <div className="mobile-profile-section">
                      <button
                        className={`mobile-profile-section-toggle${
                          mobileAccountOpen ? " is-open" : ""
                        }`}
                        type="button"
                        onClick={() => setMobileAccountOpen((prev) => !prev)}
                        aria-expanded={mobileAccountOpen}
                        aria-controls="mobile-account-links"
                      >
                        <span className="mobile-profile-section-title">Account</span>
                        <span
                          className={`mobile-profile-section-chevron${
                            mobileAccountOpen ? " is-open" : ""
                          }`}
                          aria-hidden="true"
                        >
                          <ChevronDown size={16} />
                        </span>
                      </button>
                      {mobileAccountOpen && (
                        <div id="mobile-account-links" className="mobile-profile-section-body">
                          <button
                            className="mobile-profile-item"
                            type="button"
                            data-accent="profile"
                            onClick={() => handleProfileAction("/me")}
                          >
                            <span className="sidebar-nav-icon" aria-hidden="true">
                              <User size={18} />
                            </span>
                            <span>My Profile</span>
                          </button>
                          <button
                            className="mobile-profile-item"
                            type="button"
                            data-accent="profile-photo"
                            onClick={() => {
                              setPhotoModalOpen(true);
                              setMenuOpen(false);
                              setShowProfileMenu(false);
                            }}
                          >
                            <span className="sidebar-nav-icon" aria-hidden="true">
                              <User size={18} />
                            </span>
                            <span>
                              {profileCard?.avatarUrl ? "Edit Profile Photo" : "Add Profile Photo"}
                            </span>
                          </button>
                          <button
                            className="mobile-profile-item"
                            type="button"
                            data-accent="settings"
                            onClick={() => handleProfileAction("/me?view=settings")}
                          >
                            <span className="sidebar-nav-icon" aria-hidden="true">
                              <Settings size={18} />
                            </span>
                            <span>Account settings</span>
                          </button>
                          {hasSwitchableProfiles && (
                            <button
                              className="mobile-profile-item"
                              type="button"
                              data-accent="profile-switch"
                              onClick={openSwitchProfileModal}
                            >
                              <span className="sidebar-nav-icon" aria-hidden="true">
                                <RefreshCcw size={18} />
                              </span>
                              <span>Switch profile</span>
                            </button>
                          )}
                          {canToggleSettings && (
                            <button
                              className="mobile-profile-item"
                              type="button"
                              data-accent="settings"
                              onClick={handleSettingsToggle}
                            >
                              <span className="sidebar-nav-icon" aria-hidden="true">
                                {isSettingsView ? (
                                  <ChevronLeft size={18} />
                                ) : (
                                  <Settings size={18} />
                                )}
                              </span>
                              <span>{isSettingsView ? "Back to Profile" : "Settings"}</span>
                            </button>
                          )}
                          {canSelectSettingsSection && (
                            <div className="mobile-settings-links">
                              {SETTINGS_SECTIONS.map((section) => (
                                <button
                                  key={section.id}
                                  className={`mobile-profile-item${
                                    settingsSection === section.id ? " is-active" : ""
                                  }`}
                                  type="button"
                                  data-accent={section.id}
                                  onClick={() => handleSettingsSectionChange(section.id)}
                                >
                                  <span className="sidebar-nav-icon" aria-hidden="true">
                                    {SETTINGS_SECTION_ICONS[section.id]}
                                  </span>
                                  <span>{section.label}</span>
                                </button>
                              ))}
                            </div>
                          )}
                          {canToggleGroupSettings && (
                            <button
                              className="mobile-profile-item"
                              type="button"
                              data-accent="group-theme"
                              onClick={handleGroupSettingsToggle}
                            >
                              <span className="sidebar-nav-icon" aria-hidden="true">
                                {isGroupSettingsView ? (
                                  <ChevronLeft size={18} />
                                ) : (
                                  <Palette size={18} />
                                )}
                              </span>
                              <span>
                                {isGroupSettingsView
                                  ? "Return to group feed"
                                  : "Group look and feel"}
                              </span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {showMobileCustomContent && (
                    <>
                      <div className="mobile-profile-divider" />
                      <div className="mobile-custom-content">{sidebarContent}</div>
                    </>
                  )}
                  <button
                    className="mobile-profile-item"
                    type="button"
                    data-accent="home"
                    onClick={() => handleProfileAction("/landing")}
                  >
                    <span className="sidebar-nav-icon" aria-hidden="true">
                      <Home size={18} />
                    </span>
                    <span>Return to Landing Page</span>
                  </button>
                  <button
                    className="mobile-profile-item"
                    type="button"
                    data-accent="logout"
                    onClick={() => {
                      logout("user-action");
                      navigate("/login");
                      setMenuOpen(false);
                    }}
                  >
                    <span className="sidebar-nav-icon" aria-hidden="true">
                      <LogOut size={18} />
                    </span>
                    <span>Logout</span>
                  </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {showNotifications && (
        <div
          className="sidebar-notification-tray"
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
        >
          <button
            type="button"
            className="sidebar-notification-tray-backdrop"
            aria-label="Close notifications"
            onClick={closeNotifications}
          />
          <div className="sidebar-notification-tray-panel">
            <div className="sidebar-notification-header sidebar-notification-tray-header">
              <div className="sidebar-notification-tray-title">
                <strong>Notifications</strong>
                <span className="sidebar-notification-tray-subtitle">
                  {filteredNotificationTotal > 0
                    ? `${filteredNotificationTotal} new updates`
                    : "All caught up"}
                </span>
              </div>
              <div className="sidebar-notification-tray-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={markAllRead}
                  disabled={filteredNotificationTotal === 0}
                >
                  Mark read
                </button>
                <button
                  type="button"
                  className="sidebar-notification-close"
                  onClick={closeNotifications}
                  aria-label="Close notifications"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M6 6 18 18M18 6 6 18"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
            {renderNotificationList()}
          </div>
        </div>
      )}

      {showSwitchProfileModal && hasSwitchableProfiles && (
        <div
          className="sidebar-switch-profile-modal-wrap"
          role="dialog"
          aria-modal="true"
          aria-label="Switch profile"
        >
          <button
            type="button"
            className="sidebar-switch-profile-backdrop"
            aria-label="Close switch profile modal"
            onClick={() => setShowSwitchProfileModal(false)}
          />
          <div className="sidebar-switch-profile-modal">
            <div className="sidebar-switch-profile-header">
              <div>
                <strong>Switch profile</strong>
                <p>Choose a saved profile to continue.</p>
              </div>
              <button
                type="button"
                className="sidebar-switch-profile-close"
                aria-label="Close switch profile modal"
                onClick={() => setShowSwitchProfileModal(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="sidebar-switch-profile-list">
              {switchableProfiles.map((entry) => {
                const profileKey = `${entry.id}:${entry.identifier}`;
                const loading = switchingProfileKey === profileKey;
                const label = String(entry.label || "").trim() || `Member ${entry.id}`;
                const handleText = String(entry.handle || "").trim();
                const fallbackInitial = label.slice(0, 1).toUpperCase() || "M";
                return (
                  <button
                    key={profileKey}
                    type="button"
                    className="sidebar-switch-profile-item"
                    data-accent="profile-switch"
                    onClick={() => handleSwitchProfileSelect(entry)}
                    disabled={loading}
                  >
                    {entry.avatarUrl ? (
                      <AvatarImage
                        src={entry.avatarUrl}
                        alt={label}
                        className="sidebar-switch-profile-avatar"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <span className="sidebar-switch-profile-avatar sidebar-switch-profile-avatar--fallback">
                        {fallbackInitial}
                      </span>
                    )}
                    <span className="sidebar-switch-profile-copy" data-i18n-skip="true">
                      <span className="sidebar-switch-profile-name">{label}</span>
                      {handleText ? (
                        <span className="sidebar-switch-profile-handle">@{handleText}</span>
                      ) : (
                        <span className="sidebar-switch-profile-handle">
                          {entry.identifier}
                        </span>
                      )}
                    </span>
                    <span className="sidebar-switch-profile-status">
                      {loading ? "Switching..." : "Switch"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {showSwitchPasswordModal && switchAuthProfile && (
        <div
          className="sidebar-switch-profile-modal-wrap"
          role="dialog"
          aria-modal="true"
          aria-label="Switch profile password"
        >
          <button
            type="button"
            className="sidebar-switch-profile-backdrop"
            aria-label="Close switch profile login"
            onClick={closeSwitchPasswordModal}
          />
          <div className="sidebar-switch-auth-modal">
            <div className="sidebar-switch-profile-header">
              <div>
                <strong>Sign in to switch profile</strong>
                <p>{String(switchAuthProfile.label || "Saved profile").trim()}</p>
              </div>
              <button
                type="button"
                className="sidebar-switch-profile-close"
                aria-label="Close switch profile login"
                onClick={closeSwitchPasswordModal}
              >
                <X size={16} />
              </button>
            </div>

            {!switchAuthChallengeId ? (
              <form className="sidebar-switch-auth-form" onSubmit={handleSwitchPasswordSubmit}>
                <label className="sidebar-switch-auth-field">
                  <span>Profile</span>
                  <input
                    type="text"
                    value={String(switchAuthProfile.identifier || "").trim()}
                    readOnly
                    autoComplete="username"
                  />
                </label>
                <label className="sidebar-switch-auth-field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={switchAuthPassword}
                    onChange={(event) => setSwitchAuthPassword(event.target.value)}
                    autoComplete="current-password"
                    placeholder="Enter password"
                  />
                </label>
                {switchAuthError && (
                  <p className="sidebar-switch-auth-message is-error">{switchAuthError}</p>
                )}
                {switchAuthInfo && (
                  <p className="sidebar-switch-auth-message is-info">{switchAuthInfo}</p>
                )}
                <div className="sidebar-switch-auth-actions">
                  <button
                    type="button"
                    className="sidebar-switch-auth-btn is-ghost"
                    onClick={closeSwitchPasswordModal}
                    disabled={switchAuthLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="sidebar-switch-auth-btn is-primary"
                    disabled={switchAuthLoading}
                  >
                    {switchAuthLoading ? "Signing in..." : "Sign in"}
                  </button>
                </div>
              </form>
            ) : (
              <form className="sidebar-switch-auth-form" onSubmit={handleSwitchVerifySubmit}>
                <label className="sidebar-switch-auth-field">
                  <span>
                    Verification code
                    {switchAuthChallengeMethod ? ` (${switchAuthChallengeMethod.toUpperCase()})` : ""}
                  </span>
                  <input
                    type="text"
                    value={switchAuthVerificationCode}
                    onChange={(event) => setSwitchAuthVerificationCode(event.target.value)}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    placeholder="Enter code"
                  />
                </label>
                {switchAuthError && (
                  <p className="sidebar-switch-auth-message is-error">{switchAuthError}</p>
                )}
                {switchAuthInfo && (
                  <p className="sidebar-switch-auth-message is-info">{switchAuthInfo}</p>
                )}
                <div className="sidebar-switch-auth-actions">
                  <button
                    type="button"
                    className="sidebar-switch-auth-btn is-ghost"
                    onClick={handleSwitchResend}
                    disabled={switchAuthResending || switchAuthChallengeMethod === "totp"}
                  >
                    {switchAuthResending ? "Resending..." : "Resend code"}
                  </button>
                  <button
                    type="submit"
                    className="sidebar-switch-auth-btn is-primary"
                    disabled={switchAuthVerifying}
                  >
                    {switchAuthVerifying ? "Verifying..." : "Verify and switch"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <aside className="dash-nav">
        <button className="brand" type="button" onClick={handleLogoClick} style={{ cursor: "pointer" }}>
          <span className="brand-mark" aria-hidden="true">
            <img src="/logo2.png" alt="" />
          </span>
          <span className="brand-text">Your Social Place</span>
        </button>
        <div className="nav-actions" style={{ flexDirection: "column", alignItems: "flex-start", gap: "8px", width: "100%" }}>
          {profileCard && (
            <div className="sidebar-profile-slot">
              <div className="sidebar-profile-row">
                <button
                  type="button"
                  className="sidebar-profile-button"
                  onClick={() => {
                    setShowProfileMenu((v) => !v);
                    setShowNotifications(false);
                  }}
                  aria-expanded={showProfileMenu}
                  aria-controls="sidebar-profile-menu"
                >
                  {profileCard.avatarUrl ? (
                    <AvatarImage
                      src={profileCard.avatarUrl}
                      alt={nameForDisplay}
                      className="avatar-octagon"
                      style={{ width: 48, height: 48, borderRadius: "50%" }}
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: "50%",
                        display: "grid",
                        placeItems: "center",
                        background: "linear-gradient(135deg, #60a5fa, #7c3aed)",
                        color: "#0b0d14",
                        fontWeight: 700,
                      }}
                    >
                      {fallbackInitial}
                    </div>
                  )}
                  <div style={{ textAlign: "left", minWidth: 0 }} data-i18n-skip="true">
                    <strong style={{ display: "block" }}>{nameForDisplay}</strong>
                    <span
                      style={{
                        fontSize: "12px",
                        color: "var(--ysp-muted-2, #9ca3af)",
                        display: "block",
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={secondaryLine}
                    >
                      {secondaryLine}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  className="sidebar-bell"
                  aria-label={`Notifications (${filteredNotificationTotal})`}
                  onClick={toggleNotifications}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M12 22a2.5 2.5 0 0 0 2.45-2H9.55A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2z"
                      fill="currentColor"
                    />
                  </svg>
                  {filteredNotificationTotal > 0 && (
                    <span className="sidebar-bell-badge">
                      {filteredNotificationTotal > 99 ? "99+" : filteredNotificationTotal}
                    </span>
                  )}
                </button>
              </div>
              {showProfileMenu && (
                <>
                  <button
                    type="button"
                    className="sidebar-profile-menu-backdrop"
                    aria-label="Close profile navigation menu"
                    onClick={() => setShowProfileMenu(false)}
                  />
                  <div
                    id="sidebar-profile-menu"
                    className="sidebar-profile-menu"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Profile navigation menu"
                  >
                    <div className="sidebar-profile-menu-header">
                      <strong>Navigation</strong>
                      <button
                        type="button"
                        className="sidebar-profile-menu-close"
                        aria-label="Close menu"
                        onClick={() => setShowProfileMenu(false)}
                      >
                        <X size={16} />
                      </button>
                    </div>
                    <button
                      className="btn ghost nav-btn sidebar-profile-menu-button"
                      type="button"
                      data-accent="home"
                      onClick={() => handleProfileAction("/landing")}
                    >
                      <span className="sidebar-nav-icon" aria-hidden="true">
                        <Home size={18} />
                      </span>
                      <span>Return to Landing Page</span>
                    </button>
                    <button
                      className="btn ghost nav-btn sidebar-profile-menu-button"
                      type="button"
                      data-accent="downloads"
                      onClick={() => handleProfileAction("/downloads")}
                    >
                      <span className="sidebar-nav-icon" aria-hidden="true">
                        <Download size={18} />
                      </span>
                      <span>Downloads</span>
                    </button>
                    <button
                      className="btn ghost nav-btn sidebar-profile-menu-button"
                      type="button"
                      data-accent="settings"
                      onClick={() => handleProfileAction("/me?view=settings")}
                    >
                      <span className="sidebar-nav-icon" aria-hidden="true">
                        <Settings size={18} />
                      </span>
                      <span>Account settings</span>
                    </button>
                    <button
                      className="btn ghost nav-btn sidebar-profile-menu-button"
                      type="button"
                      data-accent="profile-photo"
                      onClick={() => {
                        setPhotoModalOpen(true);
                        setShowProfileMenu(false);
                      }}
                    >
                      <span className="sidebar-nav-icon" aria-hidden="true">
                        <User size={18} />
                      </span>
                      <span>
                        {profileCard?.avatarUrl ? "Edit Profile Photo" : "Add Profile Photo"}
                      </span>
                    </button>
                    {hasSwitchableProfiles && (
                      <button
                        className="btn ghost nav-btn sidebar-profile-menu-button"
                        type="button"
                        data-accent="profile-switch"
                        onClick={openSwitchProfileModal}
                      >
                        <span className="sidebar-nav-icon" aria-hidden="true">
                          <RefreshCcw size={18} />
                        </span>
                        <span>Switch profile</span>
                      </button>
                    )}
                    <button
                      className="btn ghost nav-btn sidebar-profile-menu-button"
                      type="button"
                      data-accent="logout"
                      onClick={() => {
                        logout("user-action");
                        navigate("/login");
                        setShowProfileMenu(false);
                      }}
                    >
                      <span className="sidebar-nav-icon" aria-hidden="true">
                        <LogOut size={18} />
                      </span>
                      <span>Logout</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
          {profileCard && showNavLinks && (
            <div className="sidebar-nav-links">
              <button
                type="button"
                className={`btn ghost sidebar-nav-link${
                  active === "dashboard" ? " is-active" : ""
                }`}
                data-accent="dashboard"
                onClick={() => handleProfileAction("/dashboard")}
              >
                <span className="sidebar-nav-icon" aria-hidden="true">
                  <LayoutDashboard size={18} />
                </span>
                <span>My Dashboard</span>
              </button>
              <button
                type="button"
                className={`btn ghost sidebar-nav-link${
                  active === "me" ? " is-active" : ""
                }`}
                data-accent="profile"
                onClick={() => handleProfileAction("/me")}
              >
                <span className="sidebar-nav-icon" aria-hidden="true">
                  <User size={18} />
                </span>
                <span>My Profile</span>
              </button>
              <button
                type="button"
                className={`btn ghost sidebar-nav-link${
                  active === "friends" ? " is-active" : ""
                }`}
                data-accent="friends"
                onClick={() => handleProfileAction("/friends")}
              >
                <span className="sidebar-nav-icon" aria-hidden="true">
                  <Users size={18} />
                </span>
                <span>My Friends</span>
              </button>
              <button
                type="button"
                className={`btn ghost sidebar-nav-link${
                  active === "groups" ? " is-active" : ""
                }`}
                data-accent="groups"
                onClick={() => handleProfileAction("/groups")}
              >
                <span className="sidebar-nav-icon" aria-hidden="true">
                  <UsersRound size={18} />
                </span>
                <span>My Groups</span>
              </button>
              <button
                type="button"
                className={`btn ghost sidebar-nav-link${
                  active === "forums" ? " is-active" : ""
                }`}
                data-accent="forums"
                onClick={() => handleProfileAction("/forums")}
              >
                <span className="sidebar-nav-icon" aria-hidden="true">
                  <MessageSquare size={18} />
                </span>
                <span>Forums</span>
              </button>
              <button
                type="button"
                className={`btn ghost sidebar-nav-link${
                  !storefrontEnabled ? " sidebar-nav-link--disabled" : ""
                }${active === "storefront" ? " is-active" : ""}`}
                data-accent="storefront"
                disabled={!storefrontEnabled}
                aria-disabled={!storefrontEnabled}
                onClick={() => {
                  if (!storefrontEnabled) return;
                  handleProfileAction("/storefront");
                }}
              >
                <span className="sidebar-nav-icon" aria-hidden="true">
                  <Store size={18} />
                </span>
                <span>{storefrontEnabled ? "StoreFront" : "StoreFront (Coming Soon!)"}</span>
              </button>
              <button
                type="button"
                className={`btn ghost sidebar-nav-link${
                  !newsroomEnabled ? " sidebar-nav-link--disabled" : ""
                }${active === "news" ? " is-active" : ""}`}
                data-accent="news"
                disabled={!newsroomEnabled}
                aria-disabled={!newsroomEnabled}
                onClick={() => {
                  if (!newsroomEnabled) return;
                  handleProfileAction("/news");
                }}
              >
                <span className="sidebar-nav-icon" aria-hidden="true">
                  <Newspaper size={18} />
                </span>
                <span>{newsroomEnabled ? "Newsroom" : "Newsroom (Coming soon)"}</span>
              </button>
              {isStaff && (
                <button
                  type="button"
                  className={`btn ghost sidebar-nav-link${
                    active === "moderation" ? " is-active" : ""
                  }`}
                  data-accent="moderation"
                  onClick={() => handleProfileAction("/moderation")}
                >
                  <span className="sidebar-nav-icon" aria-hidden="true">
                    <Shield size={18} />
                  </span>
                  <span>Moderation</span>
                </button>
              )}
            </div>
          )}
          {canToggleSettings && (
            <button
              type="button"
              className={`btn ghost sidebar-settings-button${
                isSettingsView ? " is-active" : ""
              }`}
              data-accent="settings"
              onClick={handleSettingsToggle}
              aria-pressed={isSettingsView}
            >
              <span className="sidebar-settings-icon" aria-hidden="true">
                {isSettingsView ? (
                  <ChevronLeft size={18} />
                ) : (
                  <Settings size={18} />
                )}
              </span>
              <span>{isSettingsView ? "Back to Profile" : "Settings"}</span>
            </button>
          )}
          {canToggleGroupSettings && (
            <button
              type="button"
              className={`btn ghost sidebar-settings-button${
                isGroupSettingsView ? " is-active" : ""
              }`}
              data-accent="group-theme"
              onClick={handleGroupSettingsToggle}
              aria-pressed={isGroupSettingsView}
            >
              <span className="sidebar-settings-icon" aria-hidden="true">
                {isGroupSettingsView ? (
                  <ChevronLeft size={18} />
                ) : (
                  <Palette size={18} />
                )}
              </span>
              <span>
                {isGroupSettingsView
                  ? "Return to group feed"
                  : "Group look and feel"}
              </span>
            </button>
          )}
          {canSelectSettingsSection && (
            <div className="sidebar-settings-nav" role="navigation" aria-label="Settings sections">
              {SETTINGS_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={`sidebar-settings-link${
                    settingsSection === section.id ? " is-active" : ""
                  }`}
                  data-accent={section.id}
                  onClick={() => handleSettingsSectionChange(section.id)}
                >
                  <span className="sidebar-nav-icon" aria-hidden="true">
                    {SETTINGS_SECTION_ICONS[section.id]}
                  </span>
                  <span>{section.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        {sidebarContent && <div className="sidebar-custom-content">{sidebarContent}</div>}
        {user && showBio && (
          <div style={{ marginTop: "12px", width: "100%" }}>
            <button
              className="btn ghost biobutton"
              type="button"
              onClick={() => setShowMoreProfile((v) => !v)}
              style={{ width: "100%", marginBottom: showMoreProfile ? "8px" : 0 }}
            >
              {showMoreProfile ? "Hide details" : "Bio"}
            </button>
            {showMoreProfile && (
              <div className="bio-panel">
                <div className="bio-line"><strong>Name:</strong> {nameForDisplay}</div>
                <div className="bio-line"><strong>Age:</strong> {profileSummary?.age || "-"}</div>
                <div className="bio-line"><strong>Hobbies:</strong> {profileSummary?.hobbies || "-"}</div>
                <div className="bio-line"><strong>Bio:</strong> {profileSummary?.bio || "-"}</div>
              </div>
            )}
          </div>
        )}
      </aside>

      {menuOpen && <button className="sidebar-overlay" type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu overlay" />}
      </div>
    </>
  );
}
