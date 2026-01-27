// src/pages/Me.tsx
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import "../css/dashboard.css";
import "../css/profile.css";
import { useAuth } from "../context/AuthContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import api from "../api/strapi";
import axios from "axios";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import ReactionPicker from "../components/ReactionPicker";
import { HOBBY_OPTIONS } from "./me_hobbies";
import { RELIGION_OPTIONS } from "./me_religions";
import { usePageMeta } from "../hooks/usePageMeta";
import {
  buildProfilePayloadFromAttrs,
  decryptOwnProfilePayload,
  encryptProfilePayload,
  ensureProfileKeyShares,
  PROFILE_PII_CLEAR_FIELDS,
  type NotificationSettings,
  type PrivacySettings,
  type ProfileVisibility,
  type ProfilePayload,
  type VisibilityLevel,
} from "../utils/profile-e2ee";
import { sanitizePostText } from "../utils/emoji";
import { getOrCreateDeviceId } from "../utils/device-id";
import {
  approveDeviceKeyRequest,
  listDeviceKeyRequests,
  rejectDeviceKeyRequest,
  type DeviceKeyRequest,
} from "../utils/device-approval";
import { syncPushSubscription, type PushSyncStatus } from "../utils/push-notifications";
import { formatPostUpdateLabel } from "../utils/time";

type VerificationMethod = "email" | "sms";
type TwoFactorMethod = "email" | "sms" | "totp";
const SETTINGS_SECTION_IDS = [
  "appearance",
  "security",
  "privacy",
  "notifications",
  "changes",
] as const;

type SettingsSection = (typeof SETTINGS_SECTION_IDS)[number];

const isSettingsSection = (value: string | null): value is SettingsSection =>
  Boolean(value) && SETTINGS_SECTION_IDS.includes(value as SettingsSection);

type Profile = {
  firstName: string;
  lastName: string;
  age: string;
  birthday: string;
  gender: string;
  religion: string;
  country: string;
  countryCode: string;
  state: string;
  stateCode: string;
  city: string;
  hobbies: string;
  occupation: string;
  bio: string;
  phone?: string;
  preferredVerificationMethod: VerificationMethod;
  showPhoneOnProfile: boolean;
  profileVisibility: ProfileVisibility;
  privacySettings: PrivacySettings;
  searchIndexingEnabled: boolean;
  externalIndexingEnabled: boolean;
  activityVisibility: VisibilityLevel;
  notificationSettings: NotificationSettings;
  handle?: string;
  avatarUrl?: string;
  onboardingComplete?: boolean;
};

type LocationOption = {
  name: string;
  code: string;
  countryCode?: string;
};

type MediaPost = {
  id: number | string;
  documentId?: number | string;
  text: string;
  media?: string;
  createdAt?: string;
  feedbackAudience?: string;
  feedbackTargetId?: number;
  feedbackTargetName?: string;
  likes?: number;
  shares?: number;
  visibility?: string;
};

type CommentItem = {
  id: number | string;
  body: string;
  owner?: string;
  ownerId?: number | string;
};

type FriendOption = {
  id: number;
  label: string;
};

type TrustedDevice = {
  tokenHash: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  expiresAt: number;
  isCurrent?: boolean;
};

type RegistrationLocks = {
  firstName?: boolean;
  lastName?: boolean;
  age?: boolean;
  birthday?: boolean;
  phone?: boolean;
  country?: boolean;
  state?: boolean;
  city?: boolean;
};

type AccountStatus = {
  deactivatedAt?: string | null;
  deactivatedUntil?: string | null;
  emailChangeAvailableAt?: string | null;
  emailCooldownDays?: number;
  deactivationDays?: number;
};

type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
};

const slug = (s: string) =>
  (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

const AGE_OPTIONS = Array.from({ length: 103 }, (_, index) => String(18 + index));
const TIME_OPTIONS = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2);
  const minutes = index % 2 === 0 ? 0 : 30;
  const value = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  const label = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(1970, 0, 1, hours, minutes));
  return { value, label };
});

const normalizeHobby = (value: string) => value.trim().replace(/\s+/g, " ");
const hobbyKey = (value: string) => normalizeHobby(value).toLowerCase();
const parseHobbies = (value: string) => {
  const seen = new Set<string>();
  return (value || "")
    .split(/[,;\n]+/)
    .map((entry) => normalizeHobby(entry))
    .filter((entry) => {
      if (!entry) return false;
      const key = hobbyKey(entry);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const normalizeLocation = (value: string) => value.trim().toLowerCase();
const matchByName = <T extends { name: string }>(list: T[], value: string) =>
  list.find((item) => normalizeLocation(item.name) === normalizeLocation(value));

const phoneDigits = (value?: string) => (value || "").replace(/\D/g, "").slice(0, 10);
const formatPhone = (value?: string) => {
  const digits = phoneDigits(value);
  if (!digits) return "";
  if (digits.length <= 3) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
};

const normalizeRegistrationLocks = (value: any): RegistrationLocks | null => {
  if (!value || typeof value !== "object") return null;
  return {
    firstName: Boolean(value.firstName),
    lastName: Boolean(value.lastName),
    age: Boolean(value.age),
    birthday: Boolean(value.birthday),
    phone: Boolean(value.phone),
    country: Boolean(value.country),
    state: Boolean(value.state),
    city: Boolean(value.city),
  };
};

const normalizeBirthdayInput = (value?: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const datePart = raw.split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toISOString().slice(0, 10);
};

const formatBirthday = (value?: string) => {
  const normalized = normalizeBirthdayInput(value);
  if (!normalized) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (!match) return normalized;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(utcDate.getTime())) return value;
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(utcDate);
};

const formatDeviceDate = (value?: number) => {
  if (!value) return "Unknown";
  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value));
  } catch {
    return "Unknown";
  }
};

const getTodayInput = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const PREVIEW_DEBOUNCE_MS = 450;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_UPLOAD_LABEL = "1 GB";
const extractFirstUrl = (text: string) => {
  const match = text.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (!match) return "";
  let url = match[0].replace(/[),.!?]+$/, "");
  if (url.startsWith("www.")) url = `https://${url}`;
  return url;
};
const hostnameFor = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
};
const isYoutubeUrl = (value: string) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes("youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
};
const isVideoUrl = (value?: string) => !!value && /\.(mp4|webm|mov|m4v|mkv)$/i.test(value);
const isVideoFile = (file: File) => {
  if (file.type && file.type.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|m4v|mkv)$/i.test(file.name);
};
const mediaDescriptor = (mediaUrl?: string, hasLink?: boolean) => {
  if (mediaUrl) return isVideoUrl(mediaUrl) ? "with a video" : "with a picture";
  if (hasLink) return "with a link";
  return "";
};
const feedbackLabelFor = (post: MediaPost) => {
  const audience = post.feedbackAudience;
  if (!audience || audience === "none") return "";
  if (audience === "public") return "Feedback: Public";
  if (audience === "friends") return "Feedback: Friends";
  if (audience === "specific") {
    return `Feedback: ${post.feedbackTargetName || "A friend"}`;
  }
  return "";
};

const LinkPreviewCard = ({
  preview,
  url,
  compact = false,
}: {
  preview: LinkPreview;
  url: string;
  compact?: boolean;
}) => {
  const title = preview.title || preview.siteName || hostnameFor(url);
  const meta = preview.siteName || hostnameFor(url);
  const showBadge = preview.type === "video" || isYoutubeUrl(url);
  return (
    <a
      className={`link-preview-card${compact ? " is-compact" : ""}`}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <div className="link-preview-media">
        {preview.image ? (
          <img src={preview.image} alt={title} loading="lazy" />
        ) : (
          <div className="link-preview-placeholder">LINK</div>
        )}
        {showBadge && <span className="link-preview-badge">Video</span>}
      </div>
      <div className="link-preview-body">
        <p className="link-preview-title">{title}</p>
        {preview.description && (
          <p className="link-preview-desc">{preview.description}</p>
        )}
        <span className="link-preview-url">{meta}</span>
      </div>
    </a>
  );
};

const CHAT_PRESETS = [
  { id: "small", label: "Small", width: 320, height: 440 },
  { id: "medium", label: "Medium", width: 360, height: 520 },
  { id: "large", label: "Large", width: 420, height: 600 },
  { id: "xlarge", label: "X-Large", width: 480, height: 680 },
] as const;

const DEFAULT_PRIVACY_SETTINGS: Required<PrivacySettings> = {
  bio: "public",
  links: "public",
  location: "public",
  birthday: "public",
  followers: "public",
  following: "public",
  activity: "public",
};

const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  dndEnabled: false,
  quietHoursStart: "",
  quietHoursEnd: "",
  soundEnabled: true,
  vibrationEnabled: true,
  pushEnabled: false,
  newsEnabled: true,
};

const normalizeVisibility = (value: any, fallback: VisibilityLevel): VisibilityLevel => {
  if (value === "public" || value === "followers" || value === "private") {
    return value;
  }
  return fallback;
};

const normalizeProfileVisibility = (value: any): ProfileVisibility => {
  if (
    value === "public" ||
    value === "followers" ||
    value === "private" ||
    value === "custom"
  ) {
    return value;
  }
  return "public";
};

const normalizePrivacySettings = (
  settings?: PrivacySettings | null
): Required<PrivacySettings> => ({
  bio: normalizeVisibility(settings?.bio, DEFAULT_PRIVACY_SETTINGS.bio),
  links: normalizeVisibility(settings?.links, DEFAULT_PRIVACY_SETTINGS.links),
  location: normalizeVisibility(settings?.location, DEFAULT_PRIVACY_SETTINGS.location),
  birthday: normalizeVisibility(settings?.birthday, DEFAULT_PRIVACY_SETTINGS.birthday),
  followers: normalizeVisibility(settings?.followers, DEFAULT_PRIVACY_SETTINGS.followers),
  following: normalizeVisibility(settings?.following, DEFAULT_PRIVACY_SETTINGS.following),
  activity: normalizeVisibility(settings?.activity, DEFAULT_PRIVACY_SETTINGS.activity),
});

const normalizeNotificationSettings = (settings?: NotificationSettings | null) => ({
  dndEnabled: Boolean(settings?.dndEnabled),
  quietHoursStart: settings?.quietHoursStart || "",
  quietHoursEnd: settings?.quietHoursEnd || "",
  soundEnabled: settings?.soundEnabled !== false,
  vibrationEnabled: settings?.vibrationEnabled !== false,
  pushEnabled: Boolean(settings?.pushEnabled),
  newsEnabled: settings?.newsEnabled !== false,
});

const resolveFieldVisibility = (
  profileVisibility: ProfileVisibility,
  privacySettings: PrivacySettings,
  field: keyof PrivacySettings,
  fallback: VisibilityLevel
) => {
  if (profileVisibility === "custom") {
    return normalizeVisibility(privacySettings[field], fallback);
  }
  return normalizeVisibility(profileVisibility, fallback);
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export default function Me() {
  const { user, refreshProfile, logout, updateUser } = useAuth();
  const { preferences, setBackgroundAll, resetBackgroundAll, setChatPrefs, getBackgroundStyle } =
    useUserPreferences();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  usePageMeta({
    title: "My Profile | Your Social Place",
    description:
      "Complete your Your Social Place profile to connect with friends who share your goals, location, and interests.",
    type: "profile",
    robots: "noindex, nofollow",
  });
  const todayInput = useMemo(() => getTodayInput(), []);

  const [profile, setProfile] = useState<Profile>({
    firstName: "",
    lastName: "",
    age: "",
    birthday: "",
    gender: "",
    religion: "",
    country: "",
    countryCode: "",
    state: "",
    stateCode: "",
    city: "",
    hobbies: "",
    occupation: "",
    bio: "",
    phone: "",
    preferredVerificationMethod: "email",
    showPhoneOnProfile: false,
    profileVisibility: "public",
    privacySettings: DEFAULT_PRIVACY_SETTINGS,
    searchIndexingEnabled: true,
    externalIndexingEnabled: false,
    activityVisibility: "public",
    notificationSettings: DEFAULT_NOTIFICATION_SETTINGS,
    handle: "",
  });

  const profileSnapshotRef = useRef<Profile | null>(null);
  const profilePayloadRef = useRef<ProfilePayload | null>(null);
  const registrationLocksRef = useRef<RegistrationLocks>({});
  const hobbySnapshotRef = useRef<string[]>([]);
  const hobbyBlurTimeoutRef = useRef<number | null>(null);
  const profileIdRef = useRef<string | number | null>(null);
  const handleFixAttemptedRef = useRef(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [posts, setPosts] = useState<MediaPost[]>([]);
  const [postComments, setPostComments] = useState<Record<string, CommentItem[]>>({});
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [openCommentsFor, setOpenCommentsFor] = useState<Record<string, boolean>>({});
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [shareMenuFor, setShareMenuFor] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [successModal, setSuccessModal] = useState<string | null>(null);
  const [editing, setEditing] = useState(true);
  const [settingsView, setSettingsView] = useState<"profile" | "settings">("profile");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("appearance");
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [settingsTriggerWidth, setSettingsTriggerWidth] = useState<number | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sectionParam = searchParams.get("section");
    const viewParam = searchParams.get("view");
    if (viewParam === "settings") {
      setSettingsView("settings");
    }
    if (isSettingsSection(sectionParam)) {
      setSettingsSection(sectionParam);
      setSettingsView("settings");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [searchParams]);
  const [hobbyInput, setHobbyInput] = useState("");
  const [hobbyList, setHobbyList] = useState<string[]>([]);
  const [activeHobbyPicker, setActiveHobbyPicker] = useState<
    "onboarding" | "profile" | null
  >(null);
  const [postContent, setPostContent] = useState("");
  const [postFile, setPostFile] = useState<File | null>(null);
  const [postFilePreviewUrl, setPostFilePreviewUrl] = useState<string | null>(null);
  const [postSubmitting, setPostSubmitting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);
  const [postVisibility, setPostVisibility] = useState("friends");
  const [feedbackAudience, setFeedbackAudience] = useState("none");
  const [feedbackTargetId, setFeedbackTargetId] = useState<number | null>(null);
  const [friendOptions, setFriendOptions] = useState<FriendOption[]>([]);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deletePostTarget, setDeletePostTarget] = useState<MediaPost | null>(null);
  const [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null);
  const [linkPreviewLoading, setLinkPreviewLoading] = useState(false);
  const [linkPreviewError, setLinkPreviewError] = useState<string | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, LinkPreview | null>>({});
  const [countryOptions, setCountryOptions] = useState<LocationOption[]>([]);
  const [stateOptions, setStateOptions] = useState<LocationOption[]>([]);
  const [cityOptions, setCityOptions] = useState<LocationOption[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const [appearanceUploading, setAppearanceUploading] = useState(false);
  const [appearanceCollapsed, setAppearanceCollapsed] = useState(true);
  const [trustedDevices, setTrustedDevices] = useState<TrustedDevice[]>([]);
  const [trustedLoading, setTrustedLoading] = useState(false);
  const [trustedError, setTrustedError] = useState<string | null>(null);
  const [trustedSuccess, setTrustedSuccess] = useState<string | null>(null);
  const [currentDeviceTrusted, setCurrentDeviceTrusted] = useState<boolean | null>(null);
  const [deviceKeyRequests, setDeviceKeyRequests] = useState<DeviceKeyRequest[]>([]);
  const [deviceKeyRequestsLoading, setDeviceKeyRequestsLoading] = useState(false);
  const [deviceKeyRequestsError, setDeviceKeyRequestsError] = useState<string | null>(
    null
  );
  const [deviceKeyRequestsBlockedNote, setDeviceKeyRequestsBlockedNote] = useState<
    string | null
  >(null);
  const [deviceKeyRequestsSuccess, setDeviceKeyRequestsSuccess] = useState<
    string | null
  >(null);
  const [loginPhone, setLoginPhone] = useState("");
  const [phoneChangeChallengeId, setPhoneChangeChallengeId] = useState<string | null>(null);
  const [phoneChangeCode, setPhoneChangeCode] = useState("");
  const [phoneChangeHint, setPhoneChangeHint] = useState<string | null>(null);
  const [phoneChangeSending, setPhoneChangeSending] = useState(false);
  const [phoneChangeVerifying, setPhoneChangeVerifying] = useState(false);
  const [phoneChangeError, setPhoneChangeError] = useState<string | null>(null);
  const [phoneChangeSuccess, setPhoneChangeSuccess] = useState<string | null>(null);
  const [passwordResetLoading, setPasswordResetLoading] = useState(false);
  const [passwordResetError, setPasswordResetError] = useState<string | null>(null);
  const [passwordResetSuccess, setPasswordResetSuccess] = useState<string | null>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>("email");
  const [twoFactorHasAuthenticator, setTwoFactorHasAuthenticator] = useState(false);
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);
  const [twoFactorError, setTwoFactorError] = useState<string | null>(null);
  const [twoFactorSuccess, setTwoFactorSuccess] = useState<string | null>(null);
  const [phoneVerified, setPhoneVerified] = useState<boolean | null>(null);
  const [totpSetup, setTotpSetup] = useState<{
    otpauthUrl: string;
    qrCodeDataUrl: string;
  } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpSetupLoading, setTotpSetupLoading] = useState(false);
  const [totpVerifyLoading, setTotpVerifyLoading] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushSyncStatus | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);
  const [privacySaving, setPrivacySaving] = useState(false);
  const [privacyError, setPrivacyError] = useState<string | null>(null);
  const [privacySuccess, setPrivacySuccess] = useState<string | null>(null);
  const [notificationSaving, setNotificationSaving] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [notificationSuccess, setNotificationSuccess] = useState<string | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [accountStatusLoading, setAccountStatusLoading] = useState(false);
  const [accountStatusError, setAccountStatusError] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [emailChangeLoading, setEmailChangeLoading] = useState(false);
  const [emailChangeError, setEmailChangeError] = useState<string | null>(null);
  const [emailChangeSuccess, setEmailChangeSuccess] = useState<string | null>(null);
  const [deactivateLoading, setDeactivateLoading] = useState(false);
  const [deactivateError, setDeactivateError] = useState<string | null>(null);
  const [deactivateSuccess, setDeactivateSuccess] = useState<string | null>(null);
  const [deactivateReason, setDeactivateReason] = useState("");
  const [reactivateLoading, setReactivateLoading] = useState(false);
  const [reactivateError, setReactivateError] = useState<string | null>(null);
  const [reactivateSuccess, setReactivateSuccess] = useState<string | null>(null);
  const [previewAudience, setPreviewAudience] = useState<
    "me" | "public" | "followers"
  >("me");
  const isSettingsView = settingsView === "settings";
  const postFileIsVideo = postFile ? isVideoFile(postFile) : false;

  useEffect(() => {
    if (!postFile) {
      setPostFilePreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(postFile);
    setPostFilePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [postFile]);
  const pushEnabled = Boolean(profile.notificationSettings.pushEnabled);
  const pushBlockedByPhone = phoneVerified !== true && !pushEnabled;
  const phoneVerificationLabel = useMemo(() => {
    if (phoneVerified === null) {
      return "Checking phone verification status…";
    }
    if (phoneVerified) {
      return null;
    }
    return "Verify your phone number in Account Security to enable push notifications.";
  }, [phoneVerified]);
  const pushStatusLabel = useMemo(() => {
    if (!pushEnabled) {
      return "Push notifications are off.";
    }
    if (pushStatus === "enabled") {
      return "Push notifications are enabled.";
    }
    if (pushStatus === "prompt") {
      return "Allow notifications in your browser to finish enabling.";
    }
    if (pushStatus === "denied") {
      return "Push notifications are blocked in your browser settings.";
    }
    if (pushStatus === "unsupported") {
      return "Push notifications are not supported on this device.";
    }
    return null;
  }, [pushEnabled, pushStatus]);

  const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");
  const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
  const getEntity = (entry: any) => entry?.data ?? entry ?? null;
  const getEntityId = (entry: any) => {
    const data = getEntity(entry);
    if (typeof data === "number") return Number.isFinite(data) ? data : undefined;
    if (typeof data === "string") {
      const parsed = Number(data);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    const rawId = data?.id ?? data?.attributes?.id;
    const num = Number(rawId);
    return Number.isFinite(num) ? num : undefined;
  };
  const getEntityLabel = (entry: any, fallback: string) => {
    const attrs = normalize(getEntity(entry));
    const firstName = String(attrs?.firstName || attrs?.firstname || "").trim();
    const lastName = String(attrs?.lastName || attrs?.lastname || "").trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const handle = String(attrs?.handle || attrs?.username || "").trim();
    return fullName || handle || attrs?.email || fallback;
  };
  const mapComments = (rows: any[]): Record<string, CommentItem[]> => {
    const next: Record<string, CommentItem[]> = {};
    rows.forEach((entry) => {
      const attrs = normalize(entry);
      const targetId = attrs.target_id ?? entry?.target_id;
      if (targetId === undefined || targetId === null) return;
      const key = String(targetId);
      const ownerEntry = getEntity(attrs.owner ?? entry?.owner);
      const ownerId = getEntityId(ownerEntry);
      const ownerLabel = getEntityLabel(ownerEntry, "User");
      const commentId = entry?.id ?? attrs?.documentId ?? attrs?.id ?? String(targetId);
      const body = String(attrs.body ?? entry?.body ?? "").trim();
      if (!body) return;
      (next[key] = next[key] || []).push({
        id: commentId,
        body,
        owner: ownerLabel,
        ownerId,
      });
    });
    return next;
  };
  const fetchCommentsForPostIds = async (postIds: Array<string | number>) => {
    if (!postIds.length) return {};
    const idFilter = postIds
      .map(
        (id, index) => `filters[target_id][$in][${index}]=${encodeURIComponent(String(id))}`
      )
      .join("&");
    const typeFilter =
      "filters[target_type][$in][0]=user&filters[target_type][$in][1]=users-post";
    const res = await api.get(
      `/comments?${typeFilter}&${idFilter}&populate=owner&pagination[pageSize]=200`
    );
    return mapComments(res.data?.data ?? []);
  };
  const updatePostMetric = (postKey: string, field: "likes" | "shares", value: number) => {
    setPosts((prev) =>
      prev.map((post) =>
        String(post.id) === postKey ? { ...post, [field]: value } : post
      )
    );
  };
  const updatePostVisibility = async (post: MediaPost, nextVisibility: string) => {
    const visibility = String(nextVisibility || "").trim();
    if (!visibility) return;
    const attempts: string[] = [];
    if (post.documentId) attempts.push(`/users-posts/${post.documentId}`);
    const idNumber = typeof post.id === "number" ? post.id : Number(post.id);
    if (Number.isFinite(idNumber)) attempts.push(`/users-posts/${idNumber}`);
    attempts.push(`/users-posts/${post.id}`);

    for (const url of attempts) {
      try {
        await api.put(url, { data: { visibility } });
        setPosts((prev) =>
          prev.map((entry) =>
            String(entry.id) === String(post.id) ? { ...entry, visibility } : entry
          )
        );
        setPostError(null);
        return;
      } catch (err) {
        if (url === attempts[attempts.length - 1]) {
          console.error("Update post visibility failed", err);
        }
      }
    }
    setPostError("Failed to update post visibility.");
  };
  const buildShareUrl = (postKey: string) => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}${window.location.pathname}#post-${postKey}`;
  };
  const pushShareNotice = (postKey: string, message: string) => {
    setShareNotice((prev) => ({ ...prev, [postKey]: message }));
    window.setTimeout(() => {
      setShareNotice((prev) => {
        if (!prev[postKey]) return prev;
        const next = { ...prev };
        delete next[postKey];
        return next;
      });
    }, 2400);
  };
  const trackShare = async (post: MediaPost, postKey: string) => {
    try {
      const res = await api.post(`/users-posts/${post.id}/share`);
      const nextShares = Number(res.data?.data?.shares) || Number(post.shares ?? 0) + 1;
      updatePostMetric(postKey, "shares", nextShares);
    } catch (err) {
      console.error("Share tracking failed", err);
      pushShareNotice(postKey, "Unable to update share count.");
    }
  };
  const handleCopyShare = async (post: MediaPost, postKey: string, shareUrl: string) => {
    if (!shareUrl) {
      pushShareNotice(postKey, "Unable to copy link.");
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      pushShareNotice(postKey, "Link copied.");
      await trackShare(post, postKey);
    } catch (err) {
      console.error("Copy link failed", err);
      pushShareNotice(postKey, "Unable to copy link.");
    }
  };
  const handleNativeShare = async (
    post: MediaPost,
    postKey: string,
    shareUrl: string,
    shareText: string
  ) => {
    if (!navigator.share) {
      pushShareNotice(postKey, "Sharing is not available here.");
      return;
    }
    try {
      await navigator.share({ url: shareUrl, text: shareText });
      pushShareNotice(postKey, "Shared.");
      await trackShare(post, postKey);
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      console.error("Share failed", err);
      pushShareNotice(postKey, "Unable to share.");
    }
  };
  const handleReaction = async (post: MediaPost, postKey: string, emoji: string) => {
    try {
      const res = await api.post(`/users-posts/${post.id}/react`, { emoji });
      const payload = res.data?.data;
      const nextLikes = Number(payload?.likes) || Number(post.likes ?? 0) + 1;
      updatePostMetric(postKey, "likes", nextLikes);
      if (payload?.alreadyReacted) {
        pushShareNotice(
          postKey,
          payload?.updated ? `Reaction updated ${emoji}` : "You already reacted."
        );
      } else {
        pushShareNotice(postKey, `You reacted ${emoji}`);
      }
    } catch (err) {
      console.error("Reaction failed", err);
      pushShareNotice(postKey, "Unable to react right now.");
    }
  };
  const refreshCommentsForPost = async (postId: string | number) => {
    try {
      const updates = await fetchCommentsForPostIds([postId]);
      setPostComments((prev) => ({ ...prev, ...updates }));
    } catch (err) {
      console.error("Failed to refresh comments", err);
    }
  };
  const toggleComments = (postKey: string) => {
    setOpenCommentsFor((prev) => ({ ...prev, [postKey]: !prev[postKey] }));
    setReactionPickerFor(null);
    setShareMenuFor(null);
  };
  const toggleReactionPicker = (postKey: string) => {
    setReactionPickerFor((prev) => (prev === postKey ? null : postKey));
    setShareMenuFor(null);
  };
  const toggleShareMenu = (postKey: string) => {
    setShareMenuFor((prev) => (prev === postKey ? null : postKey));
    setReactionPickerFor(null);
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".post-action-group")) return;
      setReactionPickerFor(null);
      setShareMenuFor(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);
  const currentBackground = preferences.backgrounds.dashboard;
  const appearanceColor = currentBackground.color || "#0b0d14";

  const handleBackgroundColor = (value: string) => {
    setAppearanceError(null);
    setBackgroundAll({ color: value });
  };

  const handleBackgroundImage = async (file?: File | null) => {
    setAppearanceError(null);
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setAppearanceError("Background image is too large. Keep it under 4MB.");
      return;
    }
    setAppearanceUploading(true);
    try {
      const fd = new FormData();
      fd.append("files", file);
      const uploadRes = await api.post("/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const uploaded = uploadRes.data?.[0];
      const url = uploaded?.url;
      if (!url) {
        setAppearanceError("Upload failed. Please try again.");
        return;
      }
      const resolvedUrl = url.startsWith("/") ? `${apiBase}${url}` : url;
      setBackgroundAll({ image: resolvedUrl });
    } catch {
      setAppearanceError("Unable to upload the background image.");
    } finally {
      setAppearanceUploading(false);
    }
  };

  const clearBackgroundImage = () => {
    setBackgroundAll({ image: "" });
  };

  const resetBackgroundSettings = () => {
    resetBackgroundAll();
  };

  const resetChatSettings = () => {
    setChatPrefs({
      width: 360,
      height: 520,
      minimizedWidth: 260,
      minimizedHeight: 72,
      fontSize: 14,
    });
  };

  const fetchTrustedDevices = async () => {
    const deviceId = getOrCreateDeviceId();
    const res = await api.get("/auth/trusted-devices", { params: { deviceId } });
    return (res.data?.devices ?? []) as TrustedDevice[];
  };

  const loadTrustedDevices = async () => {
    if (!user) return;
    setTrustedLoading(true);
    setTrustedError(null);
    setTrustedSuccess(null);
    setCurrentDeviceTrusted(null);
    setDeviceKeyRequestsBlockedNote(null);
    try {
      const devices = await fetchTrustedDevices();
      setTrustedDevices(devices);
      const isTrusted = devices.some((device) => device.isCurrent);
      setCurrentDeviceTrusted(isTrusted);
      if (isTrusted) {
        setDeviceKeyRequestsBlockedNote(null);
      } else {
        setDeviceKeyRequestsBlockedNote(
          "Trust this device to manage approval requests. Use Remember device when you sign in."
        );
        setDeviceKeyRequestsError(null);
        setDeviceKeyRequestsSuccess(null);
        setDeviceKeyRequests([]);
      }
    } catch {
      setTrustedError("Unable to load trusted devices.");
    } finally {
      setTrustedLoading(false);
    }
  };

  const loadDeviceKeyRequests = async () => {
    if (!user) return;
    if (currentDeviceTrusted !== true) {
      setDeviceKeyRequests([]);
      setDeviceKeyRequestsError(null);
      setDeviceKeyRequestsSuccess(null);
      setDeviceKeyRequestsBlockedNote(
        currentDeviceTrusted === null
          ? "Checking whether this device is trusted…"
          : "Trust this device to manage approval requests. Use Remember device when you sign in."
      );
      return;
    }
    setDeviceKeyRequestsLoading(true);
    setDeviceKeyRequestsError(null);
    setDeviceKeyRequestsSuccess(null);
    setDeviceKeyRequestsBlockedNote(null);
    try {
      const requests = await listDeviceKeyRequests();
      setDeviceKeyRequests(requests);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to load device approval requests.";
        setDeviceKeyRequestsError(String(msg));
      } else {
        setDeviceKeyRequestsError("Unable to load device approval requests.");
      }
    } finally {
      setDeviceKeyRequestsLoading(false);
    }
  };

  const handleRevokeDevice = async (tokenHash: string) => {
    setTrustedError(null);
    setTrustedSuccess(null);
    try {
      await api.post("/auth/trusted-devices/revoke", { tokenHash });
      setTrustedSuccess("Device removed.");
      await loadTrustedDevices();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to remove device.";
        setTrustedError(String(msg));
      } else {
        setTrustedError("Unable to remove device.");
      }
    }
  };

  const handleRevokeOtherDevices = async () => {
    setTrustedError(null);
    setTrustedSuccess(null);
    setTrustedLoading(true);
    try {
      const devices = await fetchTrustedDevices();
      const otherDevices = devices.filter((device) => !device.isCurrent);
      if (!otherDevices.length) {
        setTrustedSuccess("No other devices to sign out.");
        setTrustedDevices(devices);
        setCurrentDeviceTrusted(devices.some((device) => device.isCurrent));
        return;
      }
      await Promise.all(
        otherDevices.map((device) =>
          api.post("/auth/trusted-devices/revoke", { tokenHash: device.tokenHash })
        )
      );
      setTrustedSuccess("Signed out of other devices.");
      await loadTrustedDevices();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to sign out other devices.";
        setTrustedError(String(msg));
      } else {
        setTrustedError("Unable to sign out other devices.");
      }
    } finally {
      setTrustedLoading(false);
    }
  };

  const handleApproveDeviceKeyRequest = async (request: DeviceKeyRequest) => {
    if (!user) return;
    setDeviceKeyRequestsError(null);
    setDeviceKeyRequestsSuccess(null);
    try {
      await approveDeviceKeyRequest(user.id, request);
      setDeviceKeyRequestsSuccess("Device approved.");
      await loadDeviceKeyRequests();
      await loadTrustedDevices();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to approve device.";
        setDeviceKeyRequestsError(String(msg));
      } else {
        setDeviceKeyRequestsError("Unable to approve device.");
      }
    }
  };

  const handleRejectDeviceKeyRequest = async (requestId: string) => {
    setDeviceKeyRequestsError(null);
    setDeviceKeyRequestsSuccess(null);
    try {
      await rejectDeviceKeyRequest(requestId);
      setDeviceKeyRequestsSuccess("Request dismissed.");
      await loadDeviceKeyRequests();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to dismiss request.";
        setDeviceKeyRequestsError(String(msg));
      } else {
        setDeviceKeyRequestsError("Unable to dismiss request.");
      }
    }
  };

  const loadAccountStatus = async () => {
    if (!user) return;
    setAccountStatusLoading(true);
    setAccountStatusError(null);
    try {
      const res = await api.get("/account/status");
      const data = res.data ?? {};
      const status: AccountStatus = {
        deactivatedAt: data.deactivatedAt ?? null,
        deactivatedUntil: data.deactivatedUntil ?? null,
        emailChangeAvailableAt: data.emailChangeAvailableAt ?? null,
        emailCooldownDays: data.emailCooldownDays ?? undefined,
        deactivationDays: data.deactivationDays ?? data.accountDeactivationDays ?? undefined,
      };
      setAccountStatus(status);
      if (data.user?.id) {
        updateUser(data.user);
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to load account status.";
        setAccountStatusError(String(msg));
      } else {
        setAccountStatusError("Unable to load account status.");
      }
    } finally {
      setAccountStatusLoading(false);
    }
  };

  const persistProfileSettings = async (nextProfile: Profile) => {
    if (!user) return;
    const normalizedProfileVisibility = normalizeProfileVisibility(
      nextProfile.profileVisibility
    );
    const normalizedPrivacySettings = normalizePrivacySettings(nextProfile.privacySettings);
    const normalizedNotificationSettings = normalizeNotificationSettings(
      nextProfile.notificationSettings
    );
    const normalizedActivityVisibility = normalizeVisibility(
      nextProfile.activityVisibility,
      "public"
    );
    const searchIndexingEnabled =
      typeof nextProfile.searchIndexingEnabled === "boolean"
        ? nextProfile.searchIndexingEnabled
        : true;
    const externalIndexingEnabled = Boolean(nextProfile.externalIndexingEnabled);
    const basePayload =
      profilePayloadRef.current ||
      buildProfilePayloadFromAttrs({
        ...nextProfile,
        onboardingComplete: nextProfile.onboardingComplete,
      });
    const updatedPayload: ProfilePayload = {
      ...basePayload,
      profileVisibility: normalizedProfileVisibility,
      privacySettings: normalizedPrivacySettings,
      searchIndexingEnabled,
      externalIndexingEnabled,
      activityVisibility: normalizedActivityVisibility,
      notificationSettings: normalizedNotificationSettings,
    };
    const encryptedProfile = await encryptProfilePayload(user.id, updatedPayload);
    await api.put("/profiles/me", {
      data: {
        encryptedProfile,
        profileKeyVersion: 1,
        profileVisibility: normalizedProfileVisibility,
        privacySettings: normalizedPrivacySettings,
        searchIndexingEnabled,
        externalIndexingEnabled,
        activityVisibility: normalizedActivityVisibility,
        notificationSettings: normalizedNotificationSettings,
        showPhoneOnProfile: nextProfile.showPhoneOnProfile,
      },
    });
    profilePayloadRef.current = updatedPayload;
    setProfile((prev) => ({
      ...prev,
      profileVisibility: normalizedProfileVisibility,
      privacySettings: normalizedPrivacySettings,
      searchIndexingEnabled,
      externalIndexingEnabled,
      activityVisibility: normalizedActivityVisibility,
      notificationSettings: normalizedNotificationSettings,
      showPhoneOnProfile: nextProfile.showPhoneOnProfile,
    }));
    if (profileSnapshotRef.current) {
      profileSnapshotRef.current = {
        ...profileSnapshotRef.current,
        profileVisibility: normalizedProfileVisibility,
        privacySettings: normalizedPrivacySettings,
        searchIndexingEnabled,
        externalIndexingEnabled,
        activityVisibility: normalizedActivityVisibility,
        notificationSettings: normalizedNotificationSettings,
        showPhoneOnProfile: nextProfile.showPhoneOnProfile,
      };
    }
    void refreshProfile();
  };

  const handleSavePrivacySettings = async () => {
    setPrivacyError(null);
    setPrivacySuccess(null);
    setPrivacySaving(true);
    try {
      await persistProfileSettings(profile);
      setPrivacySuccess("Privacy settings saved.");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to save privacy settings.";
        setPrivacyError(String(msg));
      } else {
        setPrivacyError("Unable to save privacy settings.");
      }
    } finally {
      setPrivacySaving(false);
    }
  };

  const handleSaveNotificationSettings = async () => {
    setNotificationError(null);
    setNotificationSuccess(null);
    setPushError(null);
    setNotificationSaving(true);
    try {
      if (pushEnabled && phoneVerified !== true) {
        setPushError(
          phoneVerified === null
            ? "Checking phone verification status. Try again in a moment."
            : "Verify your phone number before enabling push notifications."
        );
        setNotificationSaving(false);
        return;
      }
      await persistProfileSettings(profile);
      const pushResult = await syncPushSubscription({
        enable: Boolean(profile.notificationSettings.pushEnabled),
        requestPermission: true,
      });
      setPushStatus(pushResult.status);
      if (pushResult.status === "error") {
        setPushError(pushResult.error || "Unable to enable push notifications.");
      }
      if (pushResult.status === "denied") {
        setPushError("Push notifications are blocked in your browser.");
      }
      if (pushResult.status === "unsupported") {
        setPushError("Push notifications are not supported on this device.");
      }
      setNotificationSuccess("Notification settings saved.");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to save notification settings.";
        setNotificationError(String(msg));
      } else {
        setNotificationError("Unable to save notification settings.");
      }
    } finally {
      setNotificationSaving(false);
    }
  };

  const updatePrivacySetting = (field: keyof PrivacySettings, value: VisibilityLevel) => {
    setProfile((prev) => ({
      ...prev,
      privacySettings: {
        ...prev.privacySettings,
        [field]: value,
      },
    }));
  };

  const handleEmailChange = async () => {
    const nextEmail = emailDraft.trim().toLowerCase();
    if (!nextEmail) {
      setEmailChangeError("Email address is required.");
      return;
    }
    setEmailChangeError(null);
    setEmailChangeSuccess(null);
    setEmailChangeLoading(true);
    try {
      const res = await api.post("/account/change/email", {
        email: nextEmail,
      });
      const data = res.data ?? {};
      if (data.user?.id) {
        updateUser(data.user);
        setEmailDraft(data.user.email || nextEmail);
      }
      const message = data.requiresConfirmation
        ? "Email updated. Check your inbox to confirm."
        : "Email updated.";
      setEmailChangeSuccess(message);
      void loadAccountStatus();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to update email.";
        setEmailChangeError(String(msg));
      } else {
        setEmailChangeError("Unable to update email.");
      }
    } finally {
      setEmailChangeLoading(false);
    }
  };

  const handleDeactivateAccount = async () => {
    if (!user) return;
    setDeactivateError(null);
    setDeactivateSuccess(null);
    setDeactivateLoading(true);
    try {
      const res = await api.post("/account/deactivate", {
        reason: deactivateReason.trim() || undefined,
      });
      const data = res.data ?? {};
      setDeactivateSuccess("Account deactivated.");
      setAccountStatus((prev) => ({
        ...prev,
        deactivatedAt: data.deactivatedAt ?? prev?.deactivatedAt ?? null,
        deactivatedUntil: data.deactivatedUntil ?? prev?.deactivatedUntil ?? null,
      }));
      void refreshProfile();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to deactivate account.";
        setDeactivateError(String(msg));
      } else {
        setDeactivateError("Unable to deactivate account.");
      }
    } finally {
      setDeactivateLoading(false);
    }
  };

  const handleReactivateAccount = async () => {
    if (!user) return;
    setReactivateError(null);
    setReactivateSuccess(null);
    setReactivateLoading(true);
    try {
      await api.post("/account/reactivate");
      setReactivateSuccess("Account reactivated.");
      setAccountStatus((prev) => ({
        ...prev,
        deactivatedAt: null,
        deactivatedUntil: null,
      }));
      void refreshProfile();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to reactivate account.";
        setReactivateError(String(msg));
      } else {
        setReactivateError("Unable to reactivate account.");
      }
    } finally {
      setReactivateLoading(false);
    }
  };

  const resetPhoneChange = () => {
    setPhoneChangeChallengeId(null);
    setPhoneChangeCode("");
    setPhoneChangeHint(null);
    setPhoneChangeError(null);
  };

  const handleStartPhoneChange = async () => {
    if (!loginPhone.trim()) {
      setPhoneChangeError("Phone number is required.");
      return;
    }
    setPhoneChangeError(null);
    setPhoneChangeSuccess(null);
    setPhoneChangeSending(true);
    try {
      const res = await api.post("/auth/phone/change/start", {
        phoneNumber: loginPhone.trim(),
      });
      setPhoneChangeChallengeId(res.data?.challengeId || null);
      setPhoneChangeHint(res.data?.phoneMasked || null);
      setPhoneChangeSuccess("Code sent. Check your phone.");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to send SMS code.";
        setPhoneChangeError(String(msg));
      } else {
        setPhoneChangeError("Unable to send SMS code.");
      }
    } finally {
      setPhoneChangeSending(false);
    }
  };

  const handleVerifyPhoneChange = async () => {
    if (!phoneChangeChallengeId) {
      setPhoneChangeError("Verification expired. Try again.");
      return;
    }
    if (!phoneChangeCode.trim()) {
      setPhoneChangeError("Enter the verification code.");
      return;
    }
    setPhoneChangeError(null);
    setPhoneChangeSuccess(null);
    setPhoneChangeVerifying(true);
    try {
      await api.post("/auth/phone/change/verify", {
        challengeId: phoneChangeChallengeId,
        code: phoneChangeCode.trim(),
      });
      const updatedPhone = phoneDigits(loginPhone);
      if (updatedPhone && user?.id) {
        try {
          const current = await fetchMyProfileByUser();
          if (current) {
            const attrs = normalize(current);
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
            const nextPayload: ProfilePayload = {
              ...payload,
              phone: updatedPhone,
            };
            const encryptedProfile = await encryptProfilePayload(user.id, nextPayload);
            const nextLocks: RegistrationLocks = {
              ...registrationLocksRef.current,
              phone: true,
            };
            await api.put("/profiles/me", {
              data: {
                encryptedProfile,
                profileKeyVersion: 1,
                registrationLocked: nextLocks,
                ...PROFILE_PII_CLEAR_FIELDS,
              },
            });
            profilePayloadRef.current = nextPayload;
            registrationLocksRef.current = nextLocks;
            setProfile((prev) => ({ ...prev, phone: formatPhone(updatedPhone) }));
          }
        } catch {
          // ignore profile sync failures
        }
      }
      resetPhoneChange();
      setPhoneVerified(true);
      setPhoneChangeSuccess("Phone number updated.");
      setLoginPhone("");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to verify phone number.";
        setPhoneChangeError(String(msg));
      } else {
        setPhoneChangeError("Unable to verify phone number.");
      }
    } finally {
      setPhoneChangeVerifying(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!user?.email) {
      setPasswordResetError("Email address not available.");
      return;
    }
    setPasswordResetError(null);
    setPasswordResetSuccess(null);
    setPasswordResetLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: user.email });
      setPasswordResetSuccess("Reset email sent. Check your inbox.");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to send reset email.";
        setPasswordResetError(String(msg));
      } else {
        setPasswordResetError("Unable to send reset email.");
      }
    } finally {
      setPasswordResetLoading(false);
    }
  };

  const loadTwoFactorStatus = async () => {
    if (!user?.id) return;
    setTwoFactorLoading(true);
    setTwoFactorError(null);
    try {
      const res = await api.get("/auth/2fa/status");
      const data = res.data ?? {};
      const method =
        data.method === "sms" || data.method === "email" || data.method === "totp"
          ? data.method
          : "email";
      setTwoFactorEnabled(Boolean(data.enabled));
      setTwoFactorMethod(method);
      setTwoFactorHasAuthenticator(Boolean(data.hasAuthenticator));
      setPhoneVerified(Boolean(data.phoneVerified));
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to load two-factor status.";
        setTwoFactorError(String(msg));
      } else {
        setTwoFactorError("Unable to load two-factor status.");
      }
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleTwoFactorSave = async () => {
    if (!user?.id) return;
    setTwoFactorError(null);
    setTwoFactorSuccess(null);
    setTwoFactorLoading(true);
    try {
      if (!twoFactorEnabled) {
        await api.post("/auth/2fa/disable");
        if (twoFactorMethod === "sms" || twoFactorMethod === "email") {
          setProfile((prev) => ({
            ...prev,
            preferredVerificationMethod: twoFactorMethod,
          }));
          await api.put("/profiles/me", {
            data: { preferredVerificationMethod: twoFactorMethod },
          });
        }
        setTwoFactorSuccess("Two-factor authentication disabled.");
        return;
      }
      if (twoFactorMethod === "totp" && !twoFactorHasAuthenticator) {
        setTwoFactorError("Set up your authenticator app first.");
        return;
      }
      await api.post("/auth/2fa/enable", { method: twoFactorMethod });
      if (twoFactorMethod === "sms" || twoFactorMethod === "email") {
        setProfile((prev) => ({
          ...prev,
          preferredVerificationMethod: twoFactorMethod,
        }));
        await api.put("/profiles/me", {
          data: { preferredVerificationMethod: twoFactorMethod },
        });
      }
      setTwoFactorSuccess("Two-factor authentication updated.");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to update two-factor settings.";
        setTwoFactorError(String(msg));
      } else {
        setTwoFactorError("Unable to update two-factor settings.");
      }
    } finally {
      setTwoFactorLoading(false);
    }
  };

  const handleTotpSetup = async () => {
    setTwoFactorError(null);
    setTwoFactorSuccess(null);
    setTotpSetupLoading(true);
    try {
      const res = await api.post("/auth/2fa/totp/setup");
      const data = res.data ?? {};
      if (!data.qrCodeDataUrl || !data.otpauthUrl) {
        setTwoFactorError("Unable to start authenticator setup.");
        return;
      }
      setTotpSetup({
        qrCodeDataUrl: data.qrCodeDataUrl,
        otpauthUrl: data.otpauthUrl,
      });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to start authenticator setup.";
        setTwoFactorError(String(msg));
      } else {
        setTwoFactorError("Unable to start authenticator setup.");
      }
    } finally {
      setTotpSetupLoading(false);
    }
  };

  const handleTotpVerify = async () => {
    if (!totpCode.trim()) {
      setTwoFactorError("Enter the verification code.");
      return;
    }
    setTwoFactorError(null);
    setTwoFactorSuccess(null);
    setTotpVerifyLoading(true);
    try {
      await api.post("/auth/2fa/totp/verify", { code: totpCode.trim() });
      setTwoFactorEnabled(true);
      setTwoFactorMethod("totp");
      setTwoFactorHasAuthenticator(true);
      setTotpSetup(null);
      setTotpCode("");
      setTwoFactorSuccess("Authenticator app linked. Two-factor is enabled.");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to verify authenticator code.";
        setTwoFactorError(String(msg));
      } else {
        setTwoFactorError("Unable to verify authenticator code.");
      }
    } finally {
      setTotpVerifyLoading(false);
    }
  };

  const activeChatPreset = useMemo(() => {
    return CHAT_PRESETS.find(
      (preset) =>
        preset.width === preferences.chat.width &&
        preset.height === preferences.chat.height
    );
  }, [preferences.chat.height, preferences.chat.width]);

  // Stable unique handle: name/email + numeric user id.
  const lockedUniqueHandle = useMemo(() => {
    if (!user) return "";
    const base =
      slug(`${profile.firstName} ${profile.lastName}`) ||
      slug(user.email || "user");
    return `${base || "user"}-${user.id}`;
  }, [profile.firstName, profile.lastName, user]);

  useEffect(() => {
    if (feedbackAudience !== "specific") {
      setFeedbackTargetId(null);
      return;
    }
    if (!friendOptions.length) {
      setFeedbackTargetId(null);
      return;
    }
    if (feedbackTargetId && friendOptions.some((option) => option.id === feedbackTargetId)) {
      return;
    }
    setFeedbackTargetId(friendOptions[0].id);
  }, [feedbackAudience, feedbackTargetId, friendOptions]);

  const pickMediaUrl = (mediaField: any): string | undefined => {
    if (!mediaField) return undefined;

    const candidate =
      (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ??
      (Array.isArray(mediaField) ? mediaField[0] : mediaField);

    if (!candidate) return undefined;

    const attrs = normalize(candidate);
    const url =
      attrs.url ||
      attrs.formats?.large?.url ||
      attrs.formats?.medium?.url ||
      attrs.formats?.small?.url ||
      attrs.formats?.thumbnail?.url;

    if (!url) return undefined;
    return url.startsWith("/") ? `${apiBase}${url}` : url;
  };

  const handleCountryChange = (value: string) => {
    const match = value ? matchByName(countryOptions, value) : undefined;
    setProfile((prev) => ({
      ...prev,
      country: value,
      countryCode: match?.code || "",
      state: "",
      stateCode: "",
      city: "",
    }));
    setStateOptions([]);
    setCityOptions([]);
  };

  const handleStateChange = (value: string) => {
    const match = value ? matchByName(stateOptions, value) : undefined;
    setProfile((prev) => ({
      ...prev,
      state: value,
      stateCode: match?.code || "",
      city: "",
    }));
    setCityOptions([]);
  };

  const handleCityChange = (value: string) => {
    setProfile((prev) => ({ ...prev, city: value }));
  };

  useEffect(() => {
    let active = true;
    const loadCountries = async () => {
      try {
        const res = await api.get("/locations/countries");
        const list = (res.data?.data ?? []).map(
          (country: { name?: string; code?: string; isoCode?: string }) => ({
            name: country.name,
            code: country.code || country.isoCode || "",
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
        });
        const ordered =
          usIndex > 0
            ? [list[usIndex], ...list.slice(0, usIndex), ...list.slice(usIndex + 1)]
            : list;
        if (active) {
          setCountryOptions(ordered);
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
    if (!countryOptions.length) return;
    setProfile((prev) => {
      if (prev.countryCode || !prev.country) return prev;
      const match = matchByName(countryOptions, prev.country);
      return match ? { ...prev, countryCode: match.code } : prev;
    });
  }, [countryOptions]);

  useEffect(() => {
    const countryCode = profile.countryCode;
    if (!countryCode) {
      setStateOptions([]);
      setCityOptions([]);
      return;
    }

    let active = true;
    const loadStates = async () => {
      try {
        const res = await api.get("/locations/states", {
          params: { country: countryCode },
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
  }, [profile.countryCode]);

  useEffect(() => {
    if (!stateOptions.length) return;
    setProfile((prev) => {
      if (prev.stateCode || !prev.state) return prev;
      const match = matchByName(stateOptions, prev.state);
      return match ? { ...prev, stateCode: match.code } : prev;
    });
  }, [stateOptions]);

  useEffect(() => {
    const countryCode = profile.countryCode;
    if (!countryCode) {
      setCityOptions([]);
      return;
    }
    const needsState = stateOptions.length > 0;
    if (needsState && !profile.stateCode) {
      setCityOptions([]);
      return;
    }

    let active = true;
    const loadCities = async () => {
      try {
        const res = await api.get("/locations/cities", {
          params: {
            country: countryCode,
            state: profile.stateCode || undefined,
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
  }, [profile.countryCode, profile.stateCode, stateOptions.length]);

  useEffect(() => {
    if (onboardingActive) setOnboardingStep(0);
  }, [onboardingActive]);

  useEffect(() => {
    if (!user || loading) return;
    if (handleFixAttemptedRef.current) return;
    if (!profileIdRef.current || !lockedUniqueHandle) return;
    const currentHandle = (profile.handle || "").trim().toLowerCase();
    if (currentHandle && currentHandle !== "user") return;
    handleFixAttemptedRef.current = true;
    api
      .put("/profiles/me", { data: { handle: lockedUniqueHandle, locale: "en" } })
      .then((res) => {
        const updated = res.data?.data;
        if (updated) {
          void setProfileFromEntry(updated);
        } else {
          setProfile((prev) => ({ ...prev, handle: lockedUniqueHandle }));
        }
      })
      .catch(() => {
        handleFixAttemptedRef.current = false;
      });
  }, [loading, lockedUniqueHandle, profile.handle, user]);

const setProfileFromEntry = async (entry: any) => {
    if (!entry) return;
    const attrs = normalize(entry);
    profileIdRef.current = entry?.documentId ?? entry?.id ?? null;

    const basePayload = buildProfilePayloadFromAttrs(attrs);
    let payload: ProfilePayload | null = null;
    if (attrs.encryptedProfile && user?.id) {
      try {
        payload = await decryptOwnProfilePayload(user.id, attrs.encryptedProfile);
      } catch {
        payload = null;
      }
    }
    if (payload) {
      payload = { ...basePayload, ...payload };
    } else {
      payload = basePayload;
    }
    profilePayloadRef.current = payload;
    const explicitLocks = normalizeRegistrationLocks(attrs.registrationLocked) || {};
    const normalizedBirthday = normalizeBirthdayInput(payload.birthday);
    const hasBirthdayValue = Boolean(String(normalizedBirthday || "").trim());
    const derivedLocks: RegistrationLocks = {
      firstName: Boolean(String(payload.firstName || "").trim()),
      lastName: Boolean(String(payload.lastName || "").trim()),
      age: Boolean(String(payload.age || "").trim()),
      birthday: hasBirthdayValue,
      phone: Boolean(String(payload.phone || "").trim()),
    };
    const mergedLocks: RegistrationLocks = { ...derivedLocks, ...explicitLocks };
    // If the birthday value is missing, do not keep it locked.
    if (!hasBirthdayValue) mergedLocks.birthday = false;
    registrationLocksRef.current = mergedLocks;

    const parsedHobbies = parseHobbies(payload.hobbies || "");
    const preferredRaw = String(attrs.preferredVerificationMethod || "")
      .trim()
      .toLowerCase();
    const preferredVerificationMethod: VerificationMethod =
      preferredRaw === "sms" ? "sms" : "email";
    const showPhoneOnProfile =
      typeof attrs.showPhoneOnProfile === "boolean" ? attrs.showPhoneOnProfile : false;
    setHobbyList(parsedHobbies);

    const onboardingComplete =
      typeof payload.onboardingComplete === "boolean"
        ? payload.onboardingComplete
        : typeof attrs.onboardingComplete === "boolean"
        ? attrs.onboardingComplete
        : true;
    const profileVisibility = normalizeProfileVisibility(payload.profileVisibility);
    const privacySettings = normalizePrivacySettings(payload.privacySettings);
    const searchIndexingEnabled =
      typeof payload.searchIndexingEnabled === "boolean"
        ? payload.searchIndexingEnabled
        : true;
    const externalIndexingEnabled =
      typeof payload.externalIndexingEnabled === "boolean"
        ? payload.externalIndexingEnabled
        : false;
    const activityVisibility = normalizeVisibility(payload.activityVisibility, "public");
    const notificationSettings = normalizeNotificationSettings(
      payload.notificationSettings
    );
    const nextProfile: Profile = {
      firstName: payload.firstName || "",
      lastName: payload.lastName || "",
      age: payload.age || "",
      birthday: normalizedBirthday,
      gender: payload.gender || "",
      religion: payload.religion || "",
      country: payload.country || "",
      countryCode: payload.countryCode || "",
      state: payload.state || "",
      stateCode: payload.stateCode || "",
      city: payload.city || "",
      hobbies: parsedHobbies.join(", "),
      occupation: payload.occupation || "",
      bio: payload.bio || "",
      phone: formatPhone(payload.phone || ""),
      preferredVerificationMethod,
      showPhoneOnProfile,
      profileVisibility,
      privacySettings,
      searchIndexingEnabled,
      externalIndexingEnabled,
      activityVisibility,
      notificationSettings,
      handle: attrs.handle || "",
      avatarUrl: pickMediaUrl(attrs.avatar),
      onboardingComplete,
    };
    setProfile(nextProfile);
    profileSnapshotRef.current = nextProfile;
    hobbySnapshotRef.current = parsedHobbies;
    setOnboardingActive(!onboardingComplete);
  };

  const fetchMyProfileByUser = async () => {
    if (!user) return null;
    const res = await api.get(`/profiles/me?populate=avatar`);
    return res.data?.data ?? null;
  };

  // ✅ fallback: if the old profile wasn’t linked to user, we still find it by unique handle
  const fetchMyProfileByHandle = async (handle?: string) => {
    const target = (handle || "").trim() || lockedUniqueHandle;
    if (!target) return null;
    const res = await api.get(
      `/profiles?filters[handle][$eq]=${encodeURIComponent(target)}&populate=avatar&sort=updatedAt:desc&pagination[pageSize]=1`
    );
    return res.data?.data?.[0] ?? null;
  };

  const fetchMyProfileByHandlePrefix = async (prefix?: string) => {
    const target = (prefix || "").trim() || lockedUniqueHandle;
    if (!target) return null;
    const res = await api.get(
      `/profiles?filters[handle][$startsWith]=${encodeURIComponent(target)}&populate=avatar&sort=updatedAt:desc&pagination[pageSize]=1`
    );
    return res.data?.data?.[0] ?? null;
  };

  const fetchMyProfile = async () => {
    const byUser = await fetchMyProfileByUser();
    if (byUser) return byUser;
    const candidates = [profile.handle, lockedUniqueHandle].filter(
      (value) => value && value.toLowerCase() !== "user"
    ) as string[];
    for (const handle of candidates) {
      const byHandle = await fetchMyProfileByHandle(handle);
      if (byHandle) return byHandle;
    }
    for (const prefix of candidates) {
      const byPrefix = await fetchMyProfileByHandlePrefix(prefix);
      if (byPrefix) return byPrefix;
    }
    return null;
  };

  const fetchMyPosts = async (): Promise<MediaPost[]> => {
    if (!user) return [];

    const postsRes = await api.get(
      `/users-posts?filters[owner][id][$eq]=${user.id}&populate=Users_Pictures&populate=feedbackTarget&sort=createdAt:desc`
    );

    const mappedPosts: MediaPost[] = (postsRes.data?.data ?? []).map((p: any) => {
      const attrs = normalize(p);
      const pic = pickMediaUrl(attrs.Users_Pictures);
      const feedbackTargetData = getEntity(attrs.feedbackTarget);
      const feedbackTargetId = getEntityId(feedbackTargetData);
      const feedbackTargetName = feedbackTargetId
        ? getEntityLabel(feedbackTargetData, `User ${feedbackTargetId}`)
        : undefined;
      const postId =
        p?.id ??
        attrs?.id ??
        p?.documentId ??
        attrs?.documentId ??
        String(attrs?.Users_Content || "");
      return {
        id: postId,
        documentId: p?.documentId ?? attrs?.documentId,
        text: attrs.Users_Content || "",
        media: pic,
        createdAt: attrs.createdAt || attrs.created_at,
        feedbackAudience: attrs.feedbackAudience || undefined,
        feedbackTargetId,
        feedbackTargetName,
        likes: Number(attrs.likes ?? 0),
        shares: Number(attrs.shares ?? 0),
        visibility: attrs.visibility || undefined,
      };
    });

    setPosts(mappedPosts);
    if (mappedPosts.length) {
      try {
        const commentsMap = await fetchCommentsForPostIds(
          mappedPosts.map((post) => post.id)
        );
        setPostComments(commentsMap);
      } catch (err) {
        console.error("Failed to load post comments", err);
        setPostComments({});
      }
    } else {
      setPostComments({});
    }
    return mappedPosts;
  };

  const fetchLinkPreview = async (
    url: string,
    options?: { silent?: boolean }
  ): Promise<LinkPreview | null> => {
    if (!url) return null;
    if (previewCache[url] !== undefined) return previewCache[url];

    if (!options?.silent) {
      setLinkPreviewLoading(true);
      setLinkPreviewError(null);
    }

    try {
      const res = await api.get("/link-preview", { params: { url } });
      const data = res.data?.data;
      const preview = data?.url
        ? {
            url: data.url,
            title: data.title,
            description: data.description,
            image: data.image,
            siteName: data.siteName,
            type: data.type,
          }
        : null;
      setPreviewCache((prev) => ({ ...prev, [url]: preview }));
      return preview;
    } catch {
      setPreviewCache((prev) => ({ ...prev, [url]: null }));
      if (!options?.silent) {
        setLinkPreviewError("Unable to load link preview.");
      }
      return null;
    } finally {
      if (!options?.silent) {
        setLinkPreviewLoading(false);
      }
    }
  };

  const createPost = async () => {
    if (!user) return;
    const content = postContent.trim();
    if (!content && !postFile) {
      setPostError("Add a message or a photo/video to post.");
      return;
    }
    if (feedbackAudience === "specific" && !feedbackTargetId) {
      setPostError("Choose a friend for a specific feedback request.");
      return;
    }
    if (postFile && postFile.size > MAX_UPLOAD_BYTES) {
      setPostError(`Media files must be under ${MAX_UPLOAD_LABEL}.`);
      return;
    }

    setPostError(null);
    setPostSubmitting(true);
    try {
      let uploadedId: number | undefined;

      if (postFile) {
        const fd = new FormData();
        fd.append("files", postFile);
        const uploadRes = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        uploadedId = uploadRes.data?.[0]?.id;
      }

      await api.post("/users-posts", {
        data: {
          Title: content.slice(0, 80) || "Post",
          Users_Content: content,
          owner: user.id,
          Users_Pictures: uploadedId ? [uploadedId] : undefined,
          visibility: postVisibility,
          feedbackAudience,
          feedbackTarget: feedbackAudience === "specific" ? feedbackTargetId : undefined,
        },
      });

      setPostContent("");
      setPostFile(null);
      setLinkPreview(null);
      setLinkPreviewError(null);
      setFeedbackAudience("none");
      setFeedbackTargetId(null);
      await fetchMyPosts();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Failed to create post.";
        setPostError(String(msg));
      } else {
        setPostError("Failed to create post.");
      }
    } finally {
      setPostSubmitting(false);
    }
  };

  const deletePost = async (post: MediaPost) => {
    setPostError(null);
    try {
      const idNumber = typeof post.id === "number" ? post.id : Number(post.id);
      const docId = post.documentId ?? (typeof post.id === "string" ? post.id : null);
      const attempts: string[] = [];
      if (docId) attempts.push(`/users-posts/${docId}?locale=en`);
      if (Number.isFinite(idNumber)) attempts.push(`/users-posts/${idNumber}`);

      let removed = false;
      for (const path of attempts) {
        try {
          await api.delete(path);
          removed = true;
          break;
        } catch (err: any) {
          if (!(err?.response?.status === 404)) throw err;
        }
      }

      if (!removed) throw new Error("Delete failed");

      const updatedPosts = await fetchMyPosts();
      const stillThere = updatedPosts.some((p) => {
        if (docId && String(p.documentId) === String(docId)) return true;
        if (Number.isFinite(idNumber) && String(p.id) === String(idNumber)) return true;
        return false;
      });
      if (stillThere) {
        setPostError("Delete failed to persist. Please try again.");
      }
    } catch (err) {
      console.error("Delete post failed", err);
      setPostError("Failed to delete post.");
    } finally {
      setDeletePostTarget(null);
    }
  };

  const updateHobbies = (next: string[]) => {
    setHobbyList(next);
    setProfile((prev) => ({ ...prev, hobbies: next.join(", ") }));
  };

  const addHobbyValue = (value: string) => {
    const candidate = normalizeHobby(value);
    if (!candidate) return;
    const match = HOBBY_OPTIONS.find((hobby) => hobbyKey(hobby) === hobbyKey(candidate));
    if (!match) return;
    if (hobbyList.some((hobby) => hobbyKey(hobby) === hobbyKey(match))) {
      setHobbyInput("");
      return;
    }
    const next = [...hobbyList, match];
    updateHobbies(next);
    setHobbyInput("");
  };

  const addHobby = () => {
    addHobbyValue(hobbyInput);
  };

  const removeHobby = (target: string) => {
    const key = hobbyKey(target);
    const next = hobbyList.filter((hobby) => hobbyKey(hobby) !== key);
    updateHobbies(next);
  };

  const openHobbyPicker = (target: "onboarding" | "profile") => {
    if (hobbyBlurTimeoutRef.current) {
      window.clearTimeout(hobbyBlurTimeoutRef.current);
    }
    setActiveHobbyPicker(target);
  };

  const closeHobbyPicker = () => {
    if (hobbyBlurTimeoutRef.current) {
      window.clearTimeout(hobbyBlurTimeoutRef.current);
    }
    hobbyBlurTimeoutRef.current = window.setTimeout(() => {
      setActiveHobbyPicker(null);
    }, 120);
  };

  const hobbySuggestions = useMemo(() => {
    const term = hobbyInput.trim().toLowerCase();
    const selected = new Set(hobbyList.map((hobby) => hobbyKey(hobby)));
    const matches = HOBBY_OPTIONS.filter((hobby) => {
      if (selected.has(hobbyKey(hobby))) return false;
      return term ? hobby.toLowerCase().includes(term) : true;
    });
    return matches.slice(0, 12);
  }, [hobbyInput, hobbyList]);

  const renderHobbyPicker = (target: "onboarding" | "profile") => (
    <label className="profile-field">
      <span className="profile-field-label">Hobbies</span>
      <div className="hobby-picker">
        <div className="hobby-input-row">
          <div className="hobby-input-wrap">
            <input
              className="auth-input"
              placeholder="Search hobbies"
              value={hobbyInput}
              onChange={(e) => setHobbyInput(e.target.value)}
              onFocus={() => openHobbyPicker(target)}
              onBlur={closeHobbyPicker}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addHobby();
                }
              }}
            />
            {activeHobbyPicker === target && (
              <div className="hobby-dropdown">
                {hobbySuggestions.length ? (
                  hobbySuggestions.map((hobby) => (
                    <button
                      key={hobby}
                      className="hobby-option"
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        addHobbyValue(hobby);
                        openHobbyPicker(target);
                      }}
                    >
                      {hobby}
                    </button>
                  ))
                ) : (
                  <div className="hobby-option is-empty">No matches</div>
                )}
              </div>
            )}
          </div>
          <button className="btn ghost" type="button" onClick={addHobby}>
            Add
          </button>
        </div>
        {hobbyList.length ? (
          <ul className="profile-list">
            {hobbyList.map((hobby) => (
              <li key={hobby} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span>{hobby}</span>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => removeHobby(hobby)}
                    style={{ padding: "2px 10px", fontSize: 12 }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: "8px 0 0", color: "#9ca3af" }}>
            No hobbies added yet.
          </p>
        )}
        <small style={{ color: "#9ca3af" }}>
          Choose from the suggestions and add one hobby at a time.
        </small>
      </div>
    </label>
  );

  const onboardingSteps = ["Basics", "Beliefs & Interests", "Location", "About you"];
  const hasBasics =
    profile.firstName.trim() &&
    profile.lastName.trim() &&
    profile.age &&
    profile.gender;
  const hasBeliefs = profile.religion.trim() && hobbyList.length > 0;
  const needsState = stateOptions.length > 0;
  const hasState = needsState ? Boolean(profile.state || profile.stateCode) : true;
  const hasLocation =
    profile.country.trim() && profile.countryCode && hasState && profile.city.trim();
  const canFinishOnboarding = Boolean(hasBasics && hasBeliefs && hasLocation);

  const handleOnboardingNext = async () => {
    setOnboardingError(null);
    if (onboardingStep === 0 && !hasBasics) {
      setOnboardingError(
        "Please add your name, age, and gender to continue."
      );
      return;
    }
    if (onboardingStep === 1 && !hasBeliefs) {
      setOnboardingError("Select a religion and add at least one hobby to continue.");
      return;
    }
    if (onboardingStep === 2 && !hasLocation) {
      setOnboardingError("Choose your country, region, and city to continue.");
      return;
    }

    if (onboardingStep < onboardingSteps.length - 1) {
      setOnboardingStep((prev) => prev + 1);
      return;
    }

    if (!canFinishOnboarding) {
      setOnboardingError("Finish the required steps before completing setup.");
      return;
    }

    await saveProfile({ onboardingComplete: true });
  };

  const registrationLocks = registrationLocksRef.current;
  const isFirstNameLocked = Boolean(registrationLocks.firstName);
  const isLastNameLocked = Boolean(registrationLocks.lastName);
  const isAgeLocked = Boolean(registrationLocks.age);
  const isBirthdayLocked = Boolean(registrationLocks.birthday);
  const isPhoneLocked = Boolean(registrationLocks.phone);
  const isCountryLocked = false;
  const isStateLocked = false;
  const isCityLocked = false;
  const isLocationLocked = isCountryLocked || isStateLocked || isCityLocked;

  useEffect(() => {
    let active = true;

    const loadFriends = async () => {
      if (!user) {
        if (active) setFriendOptions([]);
        return;
      }
      try {
        const friendsRes = await api.get(
          `/friends?filters[$or][0][requester][id][$eq]=${user.id}` +
            `&filters[$or][1][target][id][$eq]=${user.id}` +
            `&populate=requester&populate=target`
        );
        const optionMap = new Map<number, FriendOption>();
        (friendsRes.data?.data ?? []).forEach((entry: any) => {
          const attrs = normalize(entry);
          const status = attrs.status || "pending";
          if (status !== "accepted") return;
          const requesterId = getEntityId(attrs.requester);
          const targetId = getEntityId(attrs.target);
          const otherId = requesterId === user.id ? targetId : requesterId;
          const otherUser = requesterId === user.id ? attrs.target : attrs.requester;
          if (!otherId) return;
          optionMap.set(otherId, {
            id: otherId,
            label: getEntityLabel(otherUser, `User ${otherId}`),
          });
        });
        const options = Array.from(optionMap.values()).sort((a, b) =>
          a.label.localeCompare(b.label)
        );
        if (active) setFriendOptions(options);
      } catch {
        if (active) setFriendOptions([]);
      }
    };

    loadFriends();
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      setLoading(true);
      setError(null);
      setSuccess(null);

      try {
        const mine = await fetchMyProfile();

        if (!mine) {
          setHobbyList([]);
          setProfile({
            firstName: "",
            lastName: "",
            age: "",
            birthday: "",
            gender: "",
            religion: "",
            country: "",
            countryCode: "",
            state: "",
            stateCode: "",
            city: "",
            hobbies: "",
            occupation: "",
            bio: "",
            phone: "",
            preferredVerificationMethod: "email",
            showPhoneOnProfile: false,
            profileVisibility: "public",
            privacySettings: DEFAULT_PRIVACY_SETTINGS,
            searchIndexingEnabled: true,
            externalIndexingEnabled: false,
            activityVisibility: "public",
            notificationSettings: DEFAULT_NOTIFICATION_SETTINGS,
            handle: lockedUniqueHandle, // show the locked handle even if empty profile
            onboardingComplete: false,
          });
          setOnboardingActive(true);
          setOnboardingStep(0);
          setEditing(true);
          await fetchMyPosts();
          return;
        }

        await setProfileFromEntry(mine);
        setEditing(false);
        await fetchMyPosts();
      } catch {
        setError("Failed to load profile");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user?.id, lockedUniqueHandle]);

  useEffect(() => {
    if (!user) return;
    void loadTrustedDevices();
  }, [user?.id]);

  useEffect(() => {
    if (!user || currentDeviceTrusted !== true) return;
    void loadDeviceKeyRequests();
  }, [user?.id, currentDeviceTrusted]);

  useEffect(() => {
    if (!user) return;
    setEmailDraft(user.email || "");
  }, [user?.id, user?.email]);

  useEffect(() => {
    if (!user || !isSettingsView) return;
    void loadAccountStatus();
  }, [user?.id, isSettingsView]);

  useEffect(() => {
    if (!user || !isSettingsView) return;
    void loadTwoFactorStatus();
  }, [user?.id, isSettingsView]);

  useEffect(() => {
    const url = extractFirstUrl(postContent);
    if (!url) {
      setLinkPreview(null);
      setLinkPreviewError(null);
      setLinkPreviewLoading(false);
      return;
    }

    setLinkPreviewError(null);
    if (linkPreview?.url === url) return;
    const cached = previewCache[url];
    if (cached !== undefined) {
      setLinkPreview(cached);
      return;
    }

    let active = true;
    const handle = setTimeout(() => {
      fetchLinkPreview(url).then((preview) => {
        if (!active) return;
        setLinkPreview(preview);
      });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [postContent, linkPreview?.url, previewCache]);

  useEffect(() => {
    const urls = Array.from(
      new Set(
        posts
          .map((post) => extractFirstUrl(post.text))
          .filter((url) => url)
      )
    );

    if (!urls.length) return;
    urls.forEach((url) => {
      if (previewCache[url] !== undefined) return;
      void fetchLinkPreview(url, { silent: true });
    });
  }, [posts, previewCache]);

  const saveProfile = async (override?: Partial<Profile>) => {
    if (!user) return;

    const mergedProfile = override ? { ...profile, ...override } : profile;
    if (override) setProfile(mergedProfile);

    setError(null);
    setErrorModal(null);
    setSuccess(null);
    setSuccessModal(null);

    try {
      const rawFirstName = mergedProfile.firstName.trim();
      const rawLastName = mergedProfile.lastName.trim();
      const rawAge = String(mergedProfile.age || "").trim();
      const normalizedHandle = (mergedProfile.handle || "").trim();
      const baseHandle =
        normalizedHandle && normalizedHandle.toLowerCase() !== "user"
          ? normalizedHandle
        : lockedUniqueHandle;
      const buildUniqueHandle = () =>
        `${baseHandle}-${user.id}-${Math.floor(1000 + Math.random() * 9000)}`;

      const phoneClean = phoneDigits(mergedProfile.phone);

      let avatarId: number | undefined;
      let uploadedAvatarUrl: string | undefined;

      if (avatarFile) {
        const fd = new FormData();
        fd.append("files", avatarFile);

        const uploadRes = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });

        avatarId = uploadRes.data?.[0]?.id;
        uploadedAvatarUrl = pickMediaUrl(uploadRes.data?.[0]);
      }

      const onboardingComplete =
        typeof mergedProfile.onboardingComplete === "boolean"
          ? mergedProfile.onboardingComplete
          : true;

      let existingPayload: ProfilePayload | null = null;
      try {
        const current = await fetchMyProfileByUser();
        if (current) {
          const attrs = normalize(current);
          if (attrs.encryptedProfile && user.id) {
            try {
              existingPayload = await decryptOwnProfilePayload(
                user.id,
                attrs.encryptedProfile
              );
            } catch {
              existingPayload = null;
            }
          }
          if (!existingPayload) {
            existingPayload = buildProfilePayloadFromAttrs(attrs);
          }
        }
      } catch {
        existingPayload = null;
      }
      if (!existingPayload) {
        existingPayload = profilePayloadRef.current || {};
      }

      const registrationLocks = registrationLocksRef.current;
      const resolveLockedValue = (
        locked: boolean | undefined,
        existing: string | undefined,
        fallback: string
      ) => {
        if (!locked) return fallback;
        const existingValue = String(existing || "").trim();
        return existingValue ? existingValue : fallback;
      };
      const lockFirstName = Boolean(registrationLocks.firstName);
      const lockLastName = Boolean(registrationLocks.lastName);
      const lockAge = Boolean(registrationLocks.age);
      const lockBirthday = Boolean(registrationLocks.birthday);
      const lockPhone = Boolean(registrationLocks.phone);
      const lockCountry = false;
      const lockState = false;
      const lockCity = false;
      const existingFirstName = String(existingPayload.firstName || "");
      const existingLastName = String(existingPayload.lastName || "");
      const existingAge = String(existingPayload.age || "");
      const existingCountry = String(existingPayload.country || "");
      const existingCountryCode = String(existingPayload.countryCode || "");
      const existingState = String(existingPayload.state || "");
      const existingStateCode = String(existingPayload.stateCode || "");
      const existingCity = String(existingPayload.city || "");
      const existingBirthday = normalizeBirthdayInput(existingPayload.birthday);
      const existingPhone = String(existingPayload.phone || "");

      const effectiveFirstName = lockFirstName ? existingFirstName : rawFirstName;
      const effectiveLastName = lockLastName ? existingLastName : rawLastName;
      const safeFirst = effectiveFirstName;
      const publicFirstName = effectiveFirstName;
      const publicLastName = effectiveLastName;
      const effectiveAge = resolveLockedValue(lockAge, existingAge, rawAge);
      const effectiveBirthday = resolveLockedValue(
        lockBirthday,
        existingBirthday,
        mergedProfile.birthday || ""
      );
      const normalizedBirthday = normalizeBirthdayInput(effectiveBirthday);
      const effectivePhone = resolveLockedValue(lockPhone, existingPhone, phoneClean || "");
      const normalizedProfileVisibility = normalizeProfileVisibility(
        mergedProfile.profileVisibility
      );
      const normalizedPrivacySettings = normalizePrivacySettings(
        mergedProfile.privacySettings
      );
      const normalizedNotificationSettings = normalizeNotificationSettings(
        mergedProfile.notificationSettings
      );
      const normalizedActivityVisibility = normalizeVisibility(
        mergedProfile.activityVisibility,
        "public"
      );
      const normalizedSearchIndexingEnabled =
        typeof mergedProfile.searchIndexingEnabled === "boolean"
          ? mergedProfile.searchIndexingEnabled
          : true;
      const normalizedExternalIndexingEnabled = Boolean(
        mergedProfile.externalIndexingEnabled
      );

      const nextPayload: ProfilePayload = {
        ...existingPayload,
        firstName: safeFirst,
        lastName: effectiveLastName,
        age: effectiveAge,
        birthday: normalizedBirthday,
        gender: mergedProfile.gender,
        religion: mergedProfile.religion,
        country: resolveLockedValue(
          lockCountry,
          existingCountry,
          mergedProfile.country
        ),
        countryCode: resolveLockedValue(
          lockCountry,
          existingCountryCode,
          mergedProfile.countryCode
        ),
        state: resolveLockedValue(
          lockState,
          existingState,
          mergedProfile.state
        ),
        stateCode: resolveLockedValue(
          lockState,
          existingStateCode,
          mergedProfile.stateCode
        ),
        city: resolveLockedValue(
          lockCity,
          existingCity,
          mergedProfile.city
        ),
        hobbies: mergedProfile.hobbies,
        occupation: mergedProfile.occupation,
        bio: mergedProfile.bio,
        phone: effectivePhone,
        profileVisibility: normalizedProfileVisibility,
        privacySettings: normalizedPrivacySettings,
        searchIndexingEnabled: normalizedSearchIndexingEnabled,
        externalIndexingEnabled: normalizedExternalIndexingEnabled,
        activityVisibility: normalizedActivityVisibility,
        notificationSettings: normalizedNotificationSettings,
        onboardingComplete,
      };

      const nextLocks: RegistrationLocks = { ...registrationLocks };
      if (!nextLocks.firstName && rawFirstName) nextLocks.firstName = true;
      if (!nextLocks.lastName && rawLastName) nextLocks.lastName = true;
      if (!nextLocks.age && rawAge) nextLocks.age = true;
      if (!nextLocks.birthday && normalizedBirthday.trim()) nextLocks.birthday = true;
      if (!nextLocks.phone && phoneClean) nextLocks.phone = true;
      nextLocks.country = false;
      nextLocks.state = false;
      nextLocks.city = false;

      const encryptedProfile = await encryptProfilePayload(user.id, nextPayload);

      const buildPayload = (handleValue: string) => {
        const data: any = {
          encryptedProfile,
          profileKeyVersion: 1,
          firstName: publicFirstName,
          lastName: publicLastName,
          age: nextPayload.age,
          religion: nextPayload.religion,
          hobbies: nextPayload.hobbies,
          occupation: nextPayload.occupation,
          bio: nextPayload.bio,
          country: nextPayload.country,
          countryCode: nextPayload.countryCode,
          state: nextPayload.state,
          stateCode: nextPayload.stateCode,
          city: nextPayload.city,
          handle: handleValue,
          locale: "en",
          user: user.id,
          registrationLocked: nextLocks,
          preferredVerificationMethod: mergedProfile.preferredVerificationMethod,
          showPhoneOnProfile: mergedProfile.showPhoneOnProfile,
          profileVisibility: normalizedProfileVisibility,
          privacySettings: normalizedPrivacySettings,
          searchIndexingEnabled: normalizedSearchIndexingEnabled,
          externalIndexingEnabled: normalizedExternalIndexingEnabled,
          activityVisibility: normalizedActivityVisibility,
          notificationSettings: normalizedNotificationSettings,
          ...PROFILE_PII_CLEAR_FIELDS,
        };
        if (avatarId) data.avatar = avatarId;
        return data;
      };

      let payload = buildPayload(baseHandle);

      const isHandleUniqueError = (err: any) => {
        if (!axios.isAxiosError(err)) return false;
        const msg = String(
          err.response?.data?.error?.message || err.response?.data?.message || ""
        ).toLowerCase();
        const errors = (err.response?.data?.error?.details?.errors ?? []) as any[];
        const handleErr = errors?.find((e: any) => (e?.path ?? []).includes("handle"));
        return msg.includes("unique") && (msg.includes("handle") || handleErr);
      };

      const doSave = async () => {
        const res = await api.put("/profiles/me", { data: payload });
        return res.data?.data ?? null;
      };

      let saved: any = null;
      try {
        saved = await doSave();
      } catch (e) {
        if (isHandleUniqueError(e)) {
          payload = buildPayload(buildUniqueHandle());
          saved = await doSave();
          setProfile((prev) => ({ ...prev, handle: payload.handle }));
        } else {
          throw e;
        }
      }

      if (uploadedAvatarUrl) {
        setProfile((prev) => ({ ...prev, avatarUrl: uploadedAvatarUrl }));
      }

      const refreshed = await fetchMyProfileByUser();
      if (refreshed) {
        await setProfileFromEntry(refreshed);
      } else if (saved) {
        await setProfileFromEntry(saved);
      } else {
        throw new Error("Save succeeded but no profile found");
      }

      registrationLocksRef.current = nextLocks;
      void refreshProfile();
      if (friendOptions.length) {
        void ensureProfileKeyShares(
          user.id,
          friendOptions.map((option) => option.id)
        );
      }

      setSuccess("Profile saved successfully.");
      setSuccessModal("Profile saved successfully.");
      setEditing(false);
    } catch (e) {
      if (axios.isAxiosError(e)) {
        const msg =
          e.response?.data?.error?.message ||
          e.response?.data?.message ||
          "Failed to save profile";
        setError(String(msg));
        setErrorModal(String(msg));
      } else {
        setError("Failed to save profile");
        setErrorModal("Failed to save profile. Please try again.");
      }
    }
  };

  const cancelEdit = () => {
    if (profileSnapshotRef.current) {
      setProfile(profileSnapshotRef.current);
      setHobbyList([...hobbySnapshotRef.current]);
    }
    setAvatarFile(null);
    setHobbyInput("");
    setError(null);
    setErrorModal(null);
    setEditing(false);
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    setDeleteAccountError(null);
    setDeletingAccount(true);
    try {
      await api.post("/account/delete", { confirm: "delete" });
      setDeleteAccountOpen(false);
      logout();
      navigate("/");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Failed to delete profile.";
        setDeleteAccountError(String(msg));
      } else {
        setDeleteAccountError("Failed to delete profile.");
      }
    } finally {
      setDeletingAccount(false);
    }
  };

  if (!user) return null;

  const displayName =
    (profile.firstName || profile.lastName
      ? `${profile.firstName || ""} ${profile.lastName || ""}`.trim()
      : user.email) || "Member";
  const displayHandle =
    profile.handle && profile.handle.toLowerCase() !== "user"
      ? profile.handle
      : lockedUniqueHandle;
  const avatarImg = profile.avatarUrl;
  const initials =
    displayName
      ?.split(" ")
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "ME";
  const phoneLink = phoneDigits(profile.phone);
  const phoneDisplay = formatPhone(profile.phone);
  const canDial = phoneLink.length === 10;
  const hobbiesDisplay = parseHobbies(profile.hobbies || "");
  const stateLabel = profile.countryCode === "US" ? "State" : "Province/Region";
  const locationDisplay = [profile.city, profile.state, profile.country]
    .filter(Boolean)
    .join(", ");
  const birthdayDisplay = formatBirthday(profile.birthday);
  const previewVisibility = normalizeProfileVisibility(profile.profileVisibility);
  const previewPrivacy = normalizePrivacySettings(profile.privacySettings);
  const previewAudienceLabel =
    previewAudience === "me"
      ? "You"
      : previewAudience === "followers"
      ? "Followers"
      : "Public";
  const previewAudienceScope: "public" | "followers" =
    previewAudience === "followers" ? "followers" : "public";
  const previewActivityVisibility = normalizeVisibility(
    profile.activityVisibility,
    "public"
  );
  const canPreviewField = (field: keyof PrivacySettings) => {
    if (previewAudience === "me") return true;
    if (previewVisibility === "private") return false;
    const visibility =
      field === "activity"
        ? previewActivityVisibility
        : resolveFieldVisibility(previewVisibility, previewPrivacy, field, "public");
    return visibility === "public"
      ? true
      : visibility === "followers"
      ? previewAudienceScope === "followers"
      : false;
  };
  const previewBio = canPreviewField("bio")
    ? profile.bio || "-"
    : "Hidden";
  const previewLocation = canPreviewField("location")
    ? locationDisplay || "-"
    : "Hidden";
  const previewBirthday = canPreviewField("birthday")
    ? birthdayDisplay || "-"
    : "Hidden";
  const previewLinks = canPreviewField("links") ? "Visible" : "Hidden";
  const previewFollowers = canPreviewField("followers") ? "Visible" : "Hidden";
  const previewFollowing = canPreviewField("following") ? "Visible" : "Hidden";
  const previewActivity = canPreviewField("activity")
    ? "Active now / last seen"
    : "Hidden";
  const emailCooldownAt = accountStatus?.emailChangeAvailableAt ?? null;
  const emailCooldownActive =
    Boolean(emailCooldownAt) && new Date(emailCooldownAt as string).getTime() > Date.now();
  const emailAvailabilityLabel = emailCooldownActive
    ? formatDateTime(emailCooldownAt)
    : "now";
  const deactivationEndsLabel = accountStatus?.deactivatedUntil
    ? formatDateTime(accountStatus.deactivatedUntil)
    : "Not scheduled";
  const deactivationDays = accountStatus?.deactivationDays ?? 30;
  const isCustomVisibility = profile.profileVisibility === "custom";
  const isDeactivated =
    Boolean(accountStatus?.deactivatedUntil) &&
    new Date(accountStatus?.deactivatedUntil as string).getTime() > Date.now();
  const leftInfo = [
    ["First Name", profile.firstName],
    ["Last Name", profile.lastName],
    ["Age", profile.age],
    ["Birthday", birthdayDisplay],
    ["Religion", profile.religion],
    ["Gender", profile.gender],
  ] as const;
  const phoneInfo: Array<[string, string | undefined]> = profile.showPhoneOnProfile
    ? [["Phone", profile.phone]]
    : [];
  const rightInfo: Array<[string, string | undefined]> = [
    ["Handle", displayHandle],
    ...phoneInfo,
    ["Location", locationDisplay],
    ["Country", profile.country],
    [stateLabel, profile.state],
    ["City", profile.city],
    ["Hobbies", profile.hobbies],
    ["Occupation", profile.occupation],
    ["Bio", profile.bio],
  ];

  const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
    { id: "appearance", label: "Background & Chat" },
    { id: "security", label: "Account & Security" },
    { id: "privacy", label: "Visibility & Discoverability" },
    { id: "notifications", label: "Sound, Vibration & Quiet Hours" },
    { id: "changes", label: "Changes & Deactivation" },
  ];
  const settingsSelectValue: SettingsSection | "profile" = isSettingsView
    ? settingsSection
    : "profile";
  const settingsMenuLabel =
    settingsSelectValue === "profile"
      ? "Profile"
      : SETTINGS_SECTIONS.find((section) => section.id === settingsSection)?.label ||
        "Settings";
  const settingsMenuStyle: CSSProperties | undefined = settingsTriggerWidth
    ? ({ "--settings-trigger-width": `${settingsTriggerWidth}px` } as CSSProperties)
    : undefined;
  const handleSettingsSelectChange = (value: SettingsSection | "profile") => {
    if (value === "profile") {
      setSettingsView("profile");
      setSettingsMenuOpen(false);
      setEditing(false);
      return;
    }
    setSettingsSection(value);
    setSettingsView("settings");
    setSettingsMenuOpen(false);
    setEditing(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const toggleSettingsMenu = () => {
    setSettingsMenuOpen((prev) => !prev);
  };
  const syncSettingsTriggerWidth = () => {
    const nextWidth = settingsTriggerRef.current?.offsetWidth;
    if (nextWidth && nextWidth !== settingsTriggerWidth) {
      setSettingsTriggerWidth(nextWidth);
    }
  };
  useEffect(() => {
    if (typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(syncSettingsTriggerWidth);
    return () => window.cancelAnimationFrame(frame);
  }, [settingsMenuOpen, settingsMenuLabel]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => syncSettingsTriggerWidth();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  useEffect(() => {
    if (!settingsMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!settingsMenuRef.current) return;
      if (target instanceof Node && settingsMenuRef.current.contains(target)) return;
      setSettingsMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [settingsMenuOpen]);
  const renderProfileHeader = () => (
    <div className="panel-grid" style={{ marginBottom: "16px" }}>
      <section className="panel profile-header-panel">
        <div className="profile-header-avatar-overlay" aria-hidden="true">
          {avatarImg ? (
            <img src={avatarImg} alt="" loading="lazy" />
          ) : (
            <span className="profile-header-avatar-fallback">{initials}</span>
          )}
        </div>

        <div className="profile-header-content">
          <div className="profile-header-meta">
            <h2 className="profile-header-title">{displayName}</h2>
            <span className="profile-header-handle-pill">@{displayHandle}</span>
          </div>
          <p className="profile-header-bio">
            {profile.bio || "Share a quick bio to help friends recognize you."}
          </p>
          <div className="profile-header-actions">
            <button
              className="btn primary profile-header-action-button"
              type="button"
              onClick={() => {
                setSettingsMenuOpen(false);
                setSettingsView("profile");
                setEditing(true);
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Edit Profile
            </button>
            <div className="profile-settings-dropdown" ref={settingsMenuRef} style={settingsMenuStyle}>
              <button
                ref={settingsTriggerRef}
                className={`btn primary profile-header-action-button profile-settings-trigger${
                  settingsMenuOpen ? " is-open" : ""
                }`}
                type="button"
                aria-haspopup="menu"
                aria-expanded={settingsMenuOpen}
                aria-label={`Settings menu. Current section: ${settingsMenuLabel}.`}
                title={`Current section: ${settingsMenuLabel}`}
                onClick={toggleSettingsMenu}
              >
                <span className="profile-settings-trigger-label">Settings:</span>
                <span
                  className={`profile-settings-trigger-caret${
                    settingsMenuOpen ? " is-open" : ""
                  }`}
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 16 16" focusable="false" aria-hidden="true">
                    <path
                      d="M4 6.5 8 10l4-3.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.9"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
              {settingsMenuOpen && (
                <div className="profile-settings-menu" role="menu" aria-label="Settings sections">
                  <button
                    type="button"
                    role="menuitem"
                    className={`profile-settings-item${
                      settingsSelectValue === "profile" ? " is-active" : ""
                    }`}
                    onClick={() => handleSettingsSelectChange("profile")}
                  >
                    <span>Profile overview</span>
                    {settingsSelectValue === "profile" && (
                      <span className="profile-settings-item-tag">Current</span>
                    )}
                  </button>
                  <div className="profile-settings-menu-divider" />
                  {SETTINGS_SECTIONS.map((section) => {
                    const isActive = settingsSelectValue === section.id;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        role="menuitem"
                        className={`profile-settings-item${isActive ? " is-active" : ""}`}
                        onClick={() => handleSettingsSelectChange(section.id)}
                      >
                        <span>{section.label}</span>
                        {isActive && (
                          <span className="profile-settings-item-tag">Current</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
  const renderInfoCard = (label: string, value?: string) => (
    <div className="profile-card" key={label}>
      <p className="profile-card-label">{label}</p>
      {label === "Phone" ? (
        <p className="profile-card-value">
          {phoneLink ? (
            canDial ? (
              <a
                href={`tel:${phoneLink}`}
                style={{ color: "inherit", textDecoration: "underline" }}
              >
                {phoneDisplay || value}
              </a>
            ) : (
              phoneDisplay || value
            )
          ) : (
            "-"
          )}
        </p>
      ) : label === "Hobbies" ? (
        hobbiesDisplay.length ? (
          <ul className="profile-list">
            {hobbiesDisplay.map((hobby) => (
              <li key={hobby}>{hobby}</li>
            ))}
          </ul>
        ) : (
          <p className="profile-card-value">-</p>
        )
      ) : (
        <p className="profile-card-value">{value || "-"}</p>
      )}
    </div>
  );

  const onboardingTitle = onboardingSteps[onboardingStep] || "Profile setup";
  const renderOnboardingStep = () => {
    switch (onboardingStep) {
      case 0:
        return (
          <div className="onboarding-fields">
            <label className="profile-field">
              <span className="profile-field-label">First Name</span>
              <input
                className="auth-input"
                maxLength={64}
                value={profile.firstName}
                onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
                disabled={isFirstNameLocked}
              />
              {isFirstNameLocked && (
                <small className="profile-lock-note">
                  Locked after setup. Contact support to update.
                </small>
              )}
            </label>
            <label className="profile-field">
              <span className="profile-field-label">Last Name</span>
              <input
                className="auth-input"
                maxLength={64}
                value={profile.lastName}
                onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
                disabled={isLastNameLocked}
              />
              {isLastNameLocked && (
                <small className="profile-lock-note">
                  Locked after setup. Contact support to update.
                </small>
              )}
            </label>
            <label className="profile-field">
              <span className="profile-field-label">Age</span>
              <select
                className="auth-input"
                value={profile.age}
                onChange={(e) => setProfile({ ...profile, age: e.target.value })}
                disabled={isAgeLocked}
              >
                <option value="">Select age</option>
                {AGE_OPTIONS.map((age) => (
                  <option key={age} value={age}>
                    {age}
                  </option>
                ))}
              </select>
              {isAgeLocked && (
                <small className="profile-lock-note">
                  Locked after setup. Contact support to update.
                </small>
              )}
            </label>
            <label className="profile-field">
              <span className="profile-field-label">Birthday</span>
              <input
                className="auth-input"
                type="date"
                max={todayInput}
                value={profile.birthday}
                onChange={(e) => setProfile({ ...profile, birthday: e.target.value })}
                disabled={isBirthdayLocked}
              />
              {isBirthdayLocked && (
                <small className="profile-lock-note">
                  Set during registration. Contact support to update.
                </small>
              )}
            </label>
            <label className="profile-field">
              <span className="profile-field-label">Gender</span>
              <select
                className="auth-input"
                value={profile.gender}
                onChange={(e) => setProfile({ ...profile, gender: e.target.value })}
              >
                <option value="">Select gender</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
              </select>
            </label>
          </div>
        );
      case 1:
        return (
          <div className="onboarding-fields">
            <label className="profile-field">
              <span className="profile-field-label">Religion</span>
              <select
                className="auth-input"
                value={profile.religion}
                onChange={(e) => setProfile({ ...profile, religion: e.target.value })}
              >
                <option value="">Select religion</option>
                {RELIGION_OPTIONS.map((religion) => (
                  <option key={religion} value={religion}>
                    {religion}
                  </option>
                ))}
              </select>
            </label>
            {renderHobbyPicker("onboarding")}
          </div>
        );
      case 2:
        return (
          <div className="onboarding-fields">
            <label className="profile-field">
              <span className="profile-field-label">Country</span>
              <select
                className="auth-input"
                value={profile.country}
                onChange={(e) => handleCountryChange(e.target.value)}
                disabled={isCountryLocked}
              >
                <option value="">Select country</option>
                {countryOptions.map((country) => (
                  <option key={country.code || country.name} value={country.name}>
                    {country.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="profile-field">
              <span className="profile-field-label">{stateLabel}</span>
              <select
                className="auth-input"
                value={profile.state}
                onChange={(e) => handleStateChange(e.target.value)}
                disabled={
                  isStateLocked ||
                  isCountryLocked ||
                  !profile.countryCode ||
                  !stateOptions.length
                }
              >
                <option value="">
                  {!profile.countryCode
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
            </label>
            <label className="profile-field">
              <span className="profile-field-label">City</span>
              <select
                className="auth-input"
                value={profile.city}
                onChange={(e) => handleCityChange(e.target.value)}
                disabled={
                  isCityLocked ||
                  isCountryLocked ||
                  !profile.countryCode ||
                  (stateOptions.length > 0 && !profile.stateCode)
                }
              >
                <option value="">
                  {!profile.countryCode
                    ? "Select country first"
                    : needsState && !profile.stateCode
                    ? `Select ${stateLabel.toLowerCase()} first`
                    : "Select city"}
                </option>
                {cityOptions.map((city) => (
                  <option key={city.code || city.name} value={city.name}>
                    {city.name}
                  </option>
                ))}
              </select>
            </label>
            {isLocationLocked && (
              <p className="profile-lock-note">
                Location set during registration is locked. Contact support to update.
              </p>
            )}
            {locationError && <p className="profile-location-error">{locationError}</p>}
          </div>
        );
      default:
        return (
          <div className="onboarding-fields">
            <label className="profile-field">
              <span className="profile-field-label">Occupation</span>
              <input
                className="auth-input"
                maxLength={64}
                value={profile.occupation}
                onChange={(e) => setProfile({ ...profile, occupation: e.target.value })}
              />
            </label>
            <label className="profile-field">
              <span className="profile-field-label">Bio</span>
              <textarea
                className="auth-input"
                value={profile.bio}
                onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                maxLength={500}
                rows={3}
              />
              <small style={{ color: "#9ca3af" }}>
                {profile.bio.length}/500 characters
              </small>
            </label>
            <label className="profile-field">
              <span className="profile-field-label">Phone</span>
              <input
                className="auth-input"
                type="tel"
                maxLength={14}
                placeholder="(555) 123-4567"
                value={profile.phone || ""}
                onChange={(e) => setProfile({ ...profile, phone: formatPhone(e.target.value) })}
                disabled={isPhoneLocked}
              />
              {isPhoneLocked && (
                <small className="profile-lock-note">
                  Set during registration. Use Login phone number settings to update.
                </small>
              )}
            </label>
          </div>
        );
    }
  };

  return (
    <div className="dashboard-shell" style={getBackgroundStyle("profile")}>
      {errorModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#101018",
              padding: "24px",
              borderRadius: "12px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
              maxWidth: "420px",
              width: "90%",
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "#fff" }}>Something went wrong</h3>
            <p style={{ margin: "0 0 16px", color: "#d1d1d6" }}>{errorModal}</p>
            <div style={{ textAlign: "right" }}>
              <button className="btn primary" type="button" onClick={() => setErrorModal(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {successModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#0f172a",
              padding: "24px",
              borderRadius: "12px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
              maxWidth: "420px",
              width: "90%",
              border: "1px solid rgba(16, 185, 129, 0.4)",
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "#34d399" }}>Success</h3>
            <p style={{ margin: "0 0 16px", color: "#d1fae5" }}>{successModal}</p>
            <div style={{ textAlign: "right" }}>
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  setSuccessModal(null);
                  setSuccess(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteAccountOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#0f172a",
              padding: "24px",
              borderRadius: "12px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
              maxWidth: "520px",
              width: "90%",
              border: "1px solid rgba(248, 113, 113, 0.35)",
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "#f87171" }}>Delete Your Profile</h3>
            <p style={{ margin: "0 0 16px", color: "#e5e7eb" }}>
              Are you sure you want to delete your entire profile, you will loose access to Your
              Social Place and all of your personal data that you have posted on Your Social Place.
              Once deleted, it cannot be undone, so make sure this is what you really want.
            </p>
            {deleteAccountError && (
              <p style={{ margin: "0 0 12px", color: "#fecaca" }}>{deleteAccountError}</p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                className="btn ghost"
                type="button"
                disabled={deletingAccount}
                onClick={() => setDeleteAccountOpen(false)}
              >
                Cancel
              </button>
              <button
                className="profile-delete-button"
                type="button"
                disabled={deletingAccount}
                onClick={() => void handleDeleteAccount()}
              >
                Yes, Delete My Profile
              </button>
            </div>
          </div>
        </div>
      )}

      {deletePostTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#0f172a",
              padding: "24px",
              borderRadius: "12px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
              maxWidth: "420px",
              width: "90%",
              border: "1px solid rgba(248, 113, 113, 0.35)",
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "#f87171" }}>
              Are You Sure You Want To Delete This Post
            </h3>
            <p style={{ margin: "0 0 16px", color: "#e5e7eb" }}>
              This action cannot be undone.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
              <button
                className="btn ghost"
                type="button"
                onClick={() => setDeletePostTarget(null)}
              >
                No, Do Not Delete
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  if (deletePostTarget) {
                    void deletePost(deletePostTarget);
                  }
                }}
              >
                Yes, I'm Sure
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingAccount && (
        <div className="profile-delete-overlay">
          <div className="profile-delete-modal">
            <div className="profile-delete-spinner" aria-hidden="true" />
            <p>Profile Deletion in Progress</p>
          </div>
        </div>
      )}

      {onboardingActive && (
        <div className="onboarding-overlay">
          <div className="onboarding-card">
            <div className="onboarding-header">
              <div>
                <p className="eyebrow">Getting started</p>
                <h3>Complete your profile</h3>
                <p className="onboarding-sub">This step-by-step guide appears once.</p>
              </div>
              <div className="onboarding-progress">
                Step {onboardingStep + 1} of {onboardingSteps.length}
              </div>
            </div>
            <h4 className="onboarding-title">{onboardingTitle}</h4>
            {renderOnboardingStep()}
            {onboardingError && <p className="status status-error">{onboardingError}</p>}
            <div className="onboarding-actions">
              {onboardingStep > 0 && (
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setOnboardingStep((prev) => Math.max(prev - 1, 0))}
                >
                  Back
                </button>
              )}
              <button
                className="btn primary"
                type="button"
                onClick={handleOnboardingNext}
                disabled={
                  onboardingStep === onboardingSteps.length - 1 && !canFinishOnboarding
                }
              >
                {onboardingStep === onboardingSteps.length - 1 ? "Finish setup" : "Next"}
              </button>
            </div>
          </div>
        </div>
      )}

      <Sidebar
        active="me"
        settingsView={settingsView}
        onSettingsViewChange={setSettingsView}
        settingsSection={settingsSection}
        onSettingsSectionChange={setSettingsSection}
      />

        <div className="main-content profile-content">
          <TopbarSearch />
          {renderProfileHeader()}
          {isSettingsView && settingsSection === "appearance" && (
          <div className="panel-grid profile-appearance-row">
          <section className="panel profile-settings-panel profile-appearance-panel">
            <div className="profile-appearance-header">
              <div>
                <p className="eyebrow">Style</p>
                <h4>Background &amp; Chat</h4>
                <p className="profile-appearance-sub">
                  Update the background for dashboard, friends, and profile in one place.
                </p>
              </div>
              <button
                className="btn ghost profile-appearance-toggle"
                type="button"
                onClick={() => setAppearanceCollapsed((prev) => !prev)}
              >
                {appearanceCollapsed ? "Expand" : "Minimize"}
              </button>
            </div>

            {!appearanceCollapsed && (
              <div className="profile-appearance-body">
                <div className="profile-appearance-grid">
                  <label className="profile-field">
                    <span className="profile-field-label">Background color</span>
                    <div className="appearance-color-row">
                      <input
                        type="color"
                        value={appearanceColor}
                        onChange={(e) => handleBackgroundColor(e.target.value)}
                        aria-label="Background color"
                      />
                      <input
                        className="auth-input"
                        value={currentBackground.color || ""}
                        placeholder="#0b0d14"
                        onChange={(e) => {
                          const next = e.target.value.trim();
                          setBackgroundAll({ color: next });
                        }}
                      />
                    </div>
                    <small className="profile-appearance-sub">
                      Leave blank to use the default gradient.
                    </small>
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Background image</span>
                    <input
                      type="file"
                      className="auth-input"
                      accept="image/*"
                      onChange={(e) => handleBackgroundImage(e.target.files?.[0] || null)}
                    />
                    {currentBackground.image && (
                      <div className="appearance-preview">
                        <img src={currentBackground.image} alt="Background preview" />
                      </div>
                    )}
                    <div className="appearance-actions">
                      <button className="btn ghost" type="button" onClick={clearBackgroundImage}>
                        Remove image
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={resetBackgroundSettings}
                      >
                        Reset background
                      </button>
                    </div>
                    {appearanceUploading && (
                      <small className="profile-appearance-sub">Uploading image...</small>
                    )}
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Chat text size</span>
                    <input
                      className="appearance-range"
                      type="range"
                      min={12}
                      max={20}
                      step={1}
                      value={preferences.chat.fontSize}
                      onChange={(e) =>
                        setChatPrefs({ fontSize: Number(e.target.value) })
                      }
                    />
                    <small className="profile-appearance-sub">
                      Current size: {preferences.chat.fontSize}px
                    </small>
                  </label>

                  <div className="profile-field">
                    <span className="profile-field-label">Chat size</span>
                    <p className="profile-appearance-sub">
                      Choose a preset size for the chat window.
                    </p>
                    <div className="chat-size-presets">
                      {CHAT_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          className={`btn ghost chat-size-preset${
                            activeChatPreset?.id === preset.id ? " is-active" : ""
                          }`}
                          type="button"
                          onClick={() =>
                            setChatPrefs({ width: preset.width, height: preset.height })
                          }
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                    <button className="btn ghost" type="button" onClick={resetChatSettings}>
                      Reset to default
                    </button>
                  </div>
                </div>

                {appearanceError && (
                  <p className="profile-location-error">{appearanceError}</p>
                )}
              </div>
            )}
          </section>
        </div>
          )}
        {/* <div className="dash-hero">
          <div className="dash-hero__text">
            <p className="eyebrow">Profile</p>
            <p className="subhead">A clean snapshot of you, with quick actions and easy editing.</p>
          </div>
        </div> */}

        {loading && <p className="status">Loading profile…</p>}
        {error && <p className="status status-error">{error}</p>}
        {success && <p className="status status-success">{success}</p>}

        {!isSettingsView && (
        <div className="panel-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">About</p>
                <h3>Your Info</h3>
              </div>
            </div>

            {editing ? (
              <>
                <div className="profile-columns">
                  <div className="profile-column">
                  <label className="profile-field">
                    <span className="profile-field-label">First Name</span>
                    <input
                      className="auth-input"
                      maxLength={64}
                      value={profile.firstName}
                      onChange={(e) => setProfile({ ...profile, firstName: e.target.value })}
                      disabled={isFirstNameLocked}
                    />
                    {isFirstNameLocked && (
                      <small className="profile-lock-note">
                        Locked after setup. Contact support to update.
                      </small>
                    )}
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Last Name</span>
                    <input
                      className="auth-input"
                      maxLength={64}
                      value={profile.lastName}
                      onChange={(e) => setProfile({ ...profile, lastName: e.target.value })}
                      disabled={isLastNameLocked}
                    />
                    {isLastNameLocked && (
                      <small className="profile-lock-note">
                        Locked after setup. Contact support to update.
                      </small>
                    )}
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Age</span>
                    <select
                      className="auth-input"
                      value={profile.age}
                      onChange={(e) => setProfile({ ...profile, age: e.target.value })}
                      disabled={isAgeLocked}
                    >
                      <option value="">Select age</option>
                      {AGE_OPTIONS.map((age) => (
                        <option key={age} value={age}>
                          {age}
                        </option>
                      ))}
                    </select>
                    {isAgeLocked && (
                      <small className="profile-lock-note">
                        Locked after setup. Contact support to update.
                      </small>
                    )}
                  </label>
                  <label className="profile-field">
                    <span className="profile-field-label">Birthday</span>
                    <input
                      className="auth-input"
                      type="date"
                      max={todayInput}
                      value={profile.birthday}
                      onChange={(e) => setProfile({ ...profile, birthday: e.target.value })}
                      disabled={isBirthdayLocked}
                    />
                    {isBirthdayLocked && (
                      <small className="profile-lock-note">
                        Set during registration. Contact support to update.
                      </small>
                    )}
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Religion</span>
                    <select
                      className="auth-input"
                      value={profile.religion}
                      onChange={(e) => setProfile({ ...profile, religion: e.target.value })}
                    >
                      <option value="">Select religion</option>
                      {RELIGION_OPTIONS.map((religion) => (
                        <option key={religion} value={religion}>
                          {religion}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Gender</span>
                    <select
                      className="auth-input"
                      value={profile.gender}
                      onChange={(e) => setProfile({ ...profile, gender: e.target.value })}
                    >
                      <option value="">Select gender</option>
                      <option value="Male">Male</option>
                      <option value="Female">Female</option>
                    </select>
                  </label>
                </div>

                <div className="profile-column">
                  <label className="profile-field">
                    <span className="profile-field-label">Handle</span>
                    <input
                      className="auth-input"
                      value={lockedUniqueHandle}
                      readOnly
                      disabled
                      tabIndex={-1}
                      onFocus={(e) => e.target.blur()}
                      style={{ pointerEvents: "none", userSelect: "none", opacity: 0.7 }}
                    />
                    <small style={{ color: "#9ca3af" }}>
                      Locked + unique (name/email + user id).
                    </small>
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Phone</span>
                    <input
                      className="auth-input"
                      type="tel"
                      maxLength={14}
                      placeholder="(555) 123-4567"
                      value={profile.phone || ""}
                      onChange={(e) => setProfile({ ...profile, phone: formatPhone(e.target.value) })}
                      disabled={isPhoneLocked}
                    />
                    {isPhoneLocked && (
                      <small className="profile-lock-note">
                        Set during registration. Use Login phone number settings to update.
                      </small>
                    )}
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Country</span>
                    <select
                      className="auth-input"
                      value={profile.country}
                      onChange={(e) => handleCountryChange(e.target.value)}
                      disabled={isCountryLocked}
                    >
                      <option value="">Select country</option>
                      {countryOptions.map((country) => (
                        <option key={country.code || country.name} value={country.name}>
                          {country.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">{stateLabel}</span>
                    <select
                      className="auth-input"
                      value={profile.state}
                      onChange={(e) => handleStateChange(e.target.value)}
                      disabled={
                        isStateLocked ||
                        isCountryLocked ||
                        !profile.countryCode ||
                        !stateOptions.length
                      }
                    >
                      <option value="">
                        {!profile.countryCode
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
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">City</span>
                    <select
                      className="auth-input"
                      value={profile.city}
                      onChange={(e) => handleCityChange(e.target.value)}
                      disabled={
                        isCityLocked ||
                        isCountryLocked ||
                        !profile.countryCode ||
                        (stateOptions.length > 0 && !profile.stateCode)
                      }
                    >
                      <option value="">
                        {!profile.countryCode
                          ? "Select country first"
                          : needsState && !profile.stateCode
                          ? `Select ${stateLabel.toLowerCase()} first`
                          : "Select city"}
                      </option>
                      {cityOptions.map((city) => (
                        <option key={city.code || city.name} value={city.name}>
                          {city.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  {isLocationLocked && (
                    <p className="profile-lock-note">
                      Location set during registration is locked. Contact support to update.
                    </p>
                  )}
                  {locationError && (
                    <p className="profile-location-error">{locationError}</p>
                  )}

                  {renderHobbyPicker("profile")}

                  <label className="profile-field">
                    <span className="profile-field-label">Occupation</span>
                    <input
                      className="auth-input"
                      maxLength={64}
                      value={profile.occupation}
                      onChange={(e) => setProfile({ ...profile, occupation: e.target.value })}
                    />
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Bio</span>
                    <textarea
                      className="auth-input"
                      value={profile.bio}
                      onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                      maxLength={500}
                      rows={3}
                    />
                    <small style={{ color: "#9ca3af" }}>
                      {profile.bio.length}/500 characters
                    </small>
                  </label>

                  <label className="profile-field">
                    <span className="profile-field-label">Avatar</span>
                    <input
                      type="file"
                      className="auth-input"
                      accept="image/*"
                      onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
                    />
                  </label>

                  <div className="profile-actions">
                    <button className="btn ghost" type="button" onClick={cancelEdit}>
                      Cancel
                    </button>
                    <button className="btn primary" type="button" onClick={() => saveProfile()}>
                      Save Profile
                    </button>
                  </div>
                  <div className="profile-delete-zone">
                    <p className="profile-delete-note">
                      Deleting your profile removes your account, posts, and all related data.
                    </p>
                    <button
                      className="profile-delete-button"
                      type="button"
                      onClick={() => {
                        setDeleteAccountError(null);
                        setDeleteAccountOpen(true);
                      }}
                    >
                      Delete Your Profile
                    </button>
                  </div>
                </div>
              </div>

              </>
            ) : (
              <div className="profile-columns">
                <div className="profile-column">
                  {leftInfo.map(([label, value]) => renderInfoCard(label, value))}
                </div>
                <div className="profile-column">
                  {rightInfo.map(([label, value]) => renderInfoCard(label, value))}
                </div>
              </div>
            )}
          </section>
        </div>
        )}

        {isSettingsView && settingsSection === "security" && (
        <div className="panel-grid">
          <section className="panel profile-settings-panel security-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Security</p>
                <h3>Account Security</h3>
                <p className="panel-sub">
                  Choose how you verify and manage trusted devices.
                </p>
              </div>
            </div>

            <div className="security-grid">
              <div className="security-card">
                <h4>Password reset</h4>
                <p className="security-muted">
                  We will email a reset link to {user.email}.
                </p>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={handlePasswordReset}
                  disabled={passwordResetLoading}
                >
                  {passwordResetLoading ? "Sending..." : "Send reset email"}
                </button>
                {passwordResetError && (
                  <p className="status status-error">{passwordResetError}</p>
                )}
                {passwordResetSuccess && (
                  <p className="status status-success">{passwordResetSuccess}</p>
                )}
              </div>

              <div className="security-card">
                <h4>Two-factor authentication</h4>
                <p className="security-muted">
                  Add a second step at login. Trusted devices can skip verification.
                </p>
                <div className="security-row">
                  <label className="profile-check">
                    <input
                      type="checkbox"
                      checked={twoFactorEnabled}
                      onChange={(e) => setTwoFactorEnabled(e.target.checked)}
                    />
                    <span>Enable 2FA</span>
                  </label>
                </div>
                <div className="security-row">
                  <select
                    className="auth-input"
                    value={twoFactorMethod}
                    onChange={(e) =>
                      setTwoFactorMethod(e.target.value as TwoFactorMethod)
                    }
                  >
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                    <option value="totp">Authenticator app</option>
                  </select>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleTwoFactorSave}
                    disabled={twoFactorLoading}
                  >
                    {twoFactorLoading ? "Saving..." : "Save"}
                  </button>
                </div>
                {twoFactorMethod === "totp" && (
                  <div className="totp-setup">
                    {!twoFactorHasAuthenticator && !totpSetup && (
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={handleTotpSetup}
                        disabled={totpSetupLoading}
                      >
                        {totpSetupLoading ? "Starting..." : "Set up authenticator"}
                      </button>
                    )}
                    {twoFactorHasAuthenticator && !totpSetup && (
                      <p className="security-muted">
                        Authenticator app linked. You can re-scan to rotate the QR if needed.
                      </p>
                    )}
                    {totpSetup && (
                      <div className="totp-panel">
                        <img
                          src={totpSetup.qrCodeDataUrl}
                          alt="Authenticator QR code"
                          className="totp-qr"
                        />
                        <div className="totp-entry">
                          <label className="profile-field">
                            <span className="profile-field-label">Verification code</span>
                            <input
                              className="auth-input"
                              type="text"
                              inputMode="numeric"
                              placeholder="123456"
                              value={totpCode}
                              onChange={(e) => setTotpCode(e.target.value)}
                            />
                          </label>
                          <button
                            className="btn primary"
                            type="button"
                            onClick={handleTotpVerify}
                            disabled={totpVerifyLoading}
                          >
                            {totpVerifyLoading ? "Verifying..." : "Verify code"}
                          </button>
                        </div>
                        <p className="security-muted">
                          If you can’t scan, open your authenticator and use the setup link above.
                        </p>
                      </div>
                    )}
                  </div>
                )}
                {twoFactorError && (
                  <p className="status status-error">{twoFactorError}</p>
                )}
                {twoFactorSuccess && (
                  <p className="status status-success">{twoFactorSuccess}</p>
                )}
              </div>

              <div className="security-card">
                <h4>Login phone number</h4>
                <p className="security-muted">
                  Update the number used for SMS verification.
                </p>
                {!phoneChangeChallengeId ? (
                  <>
                    <div className="security-row">
                      <input
                        className="auth-input"
                        type="tel"
                        placeholder="+1 555 555 1234"
                        value={loginPhone}
                        onChange={(e) => setLoginPhone(e.target.value)}
                      />
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={handleStartPhoneChange}
                        disabled={phoneChangeSending}
                      >
                        {phoneChangeSending ? "Sending..." : "Send code"}
                      </button>
                    </div>
                    <p className="security-muted">
                      Include your country code (for example, +1).
                    </p>
                    {phoneChangeHint && (
                      <p className="security-muted">Sent to {phoneChangeHint}.</p>
                    )}
                  </>
                ) : (
                  <>
                    <div className="security-row">
                      <input
                        className="auth-input"
                        type="text"
                        inputMode="numeric"
                        placeholder="Enter code"
                        value={phoneChangeCode}
                        onChange={(e) => setPhoneChangeCode(e.target.value)}
                      />
                      <button
                        className="btn primary"
                        type="button"
                        onClick={handleVerifyPhoneChange}
                        disabled={phoneChangeVerifying}
                      >
                        {phoneChangeVerifying ? "Verifying..." : "Verify"}
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => {
                          resetPhoneChange();
                          setPhoneChangeSuccess(null);
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                    {phoneChangeHint && (
                      <p className="security-muted">Sent to {phoneChangeHint}.</p>
                    )}
                  </>
                )}
                {phoneChangeError && (
                  <p className="status status-error">{phoneChangeError}</p>
                )}
                {phoneChangeSuccess && (
                  <p className="status status-success">{phoneChangeSuccess}</p>
                )}
              </div>

              <div className="security-card security-card-wide">
                <h4>Trusted devices</h4>
                <p className="security-muted">
                  Devices remembered for up to 30 days.
                </p>
                <div className="security-actions">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={loadTrustedDevices}
                    disabled={trustedLoading}
                  >
                    {trustedLoading ? "Refreshing..." : "Refresh list"}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleRevokeOtherDevices}
                    disabled={trustedLoading || !trustedDevices.length}
                  >
                    Sign out other devices
                  </button>
                </div>
                {trustedError && <p className="status status-error">{trustedError}</p>}
                {trustedSuccess && (
                  <p className="status status-success">{trustedSuccess}</p>
                )}
                <div className="trusted-request-header">
                  <h5>Device approval requests</h5>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={loadDeviceKeyRequests}
                    disabled={deviceKeyRequestsLoading || currentDeviceTrusted !== true}
                  >
                    {deviceKeyRequestsLoading ? "Refreshing..." : "Refresh requests"}
                  </button>
                </div>
                {currentDeviceTrusted === true && deviceKeyRequestsError && (
                  <p className="status status-error">{deviceKeyRequestsError}</p>
                )}
                {deviceKeyRequestsSuccess && (
                  <p className="status status-success">{deviceKeyRequestsSuccess}</p>
                )}
                {currentDeviceTrusted !== true && deviceKeyRequestsBlockedNote && (
                  <p className="security-muted">{deviceKeyRequestsBlockedNote}</p>
                )}
                <div className="trusted-device-list trusted-request-list">
                  {currentDeviceTrusted === true && deviceKeyRequests.length ? (
                    deviceKeyRequests.map((request) => (
                      <div className="trusted-device-card" key={request.id}>
                        <div>
                          <p className="trusted-device-label">
                            {request.deviceLabel || "New device"}
                          </p>
                          <p className="trusted-device-meta">
                            Requested {formatDeviceDate(request.createdAt)} | Expires{" "}
                            {formatDeviceDate(request.expiresAt)}
                          </p>
                        </div>
                        <div className="trusted-device-actions">
                          <button
                            className="btn primary"
                            type="button"
                            onClick={() => handleApproveDeviceKeyRequest(request)}
                            disabled={deviceKeyRequestsLoading}
                          >
                            Approve
                          </button>
                          <button
                            className="btn ghost"
                            type="button"
                            onClick={() => handleRejectDeviceKeyRequest(request.id)}
                            disabled={deviceKeyRequestsLoading}
                          >
                            Reject
                          </button>
                        </div>
                      </div>
                    ))
                  ) : currentDeviceTrusted === true ? (
                    <p className="security-muted">No pending device requests.</p>
                  ) : null}
                </div>
                <div className="trusted-device-list">
                  {trustedDevices.length ? (
                    trustedDevices.map((device) => (
                      <div
                        className={`trusted-device-card${
                          device.isCurrent ? " is-current" : ""
                        }`}
                        key={device.tokenHash}
                      >
                        <div>
                          <p className="trusted-device-label">
                            {device.label || "Unknown device"}
                          </p>
                          <p className="trusted-device-meta">
                            Last used {formatDeviceDate(device.lastUsedAt || device.createdAt)} |{" "}
                            Expires {formatDeviceDate(device.expiresAt)}
                          </p>
                        </div>
                        <div className="trusted-device-actions">
                          {device.isCurrent ? (
                            <span className="trusted-device-pill">Current</span>
                          ) : (
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => handleRevokeDevice(device.tokenHash)}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="security-muted">No trusted devices saved.</p>
                  )}
                </div>
              </div>
            </div>
          </section>
        </div>
        )}

        {isSettingsView && settingsSection === "privacy" && (
        <div className="panel-grid">
          <section className="panel profile-settings-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Privacy</p>
                <h3>Visibility &amp; Discoverability</h3>
                <p className="panel-sub">
                  Control who can see your profile and how it appears in search.
                </p>
              </div>
            </div>

            <div className="security-grid">
              <div className="security-card">
                <h4>Profile visibility</h4>
                <p className="security-muted">
                  Choose an overall visibility or set custom rules below.
                </p>
                <select
                  className="auth-input compact-select compact-select-inline"
                  value={profile.profileVisibility}
                  onChange={(e) => {
                    const nextVisibility = e.target.value as ProfileVisibility;
                    setProfile((prev) => ({
                      ...prev,
                      profileVisibility: nextVisibility,
                      externalIndexingEnabled:
                        nextVisibility === "public" ? prev.externalIndexingEnabled : false,
                    }));
                  }}
                >
                  <option value="public">Public</option>
                  <option value="followers">Followers</option>
                  <option value="private">Private</option>
                  <option value="custom">Custom</option>
                </select>
                <div className="profile-check">
                  <input
                    type="checkbox"
                    checked={profile.searchIndexingEnabled}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setProfile((prev) => ({
                        ...prev,
                        searchIndexingEnabled: enabled,
                        externalIndexingEnabled: enabled
                          ? prev.externalIndexingEnabled
                          : false,
                      }));
                    }}
                  />
                  <span>Allow my profile to appear in platform search</span>
                </div>
                <div className="profile-check">
                  <input
                    type="checkbox"
                    checked={profile.externalIndexingEnabled}
                    onChange={(e) =>
                      setProfile((prev) => ({
                        ...prev,
                        externalIndexingEnabled: e.target.checked,
                      }))
                    }
                    disabled={
                      profile.profileVisibility !== "public" ||
                      !profile.searchIndexingEnabled
                    }
                  />
                  <span>Allow search engines to index my public profile</span>
                </div>
                {profile.profileVisibility !== "public" && (
                  <p className="security-muted">
                    External indexing is only available for public profiles.
                  </p>
                )}
              </div>

              <div className="security-card">
                <h4>Who can see</h4>
                <p className="security-muted">
                  Fine-tune visibility for key profile sections.
                </p>
                <div className="privacy-grid">
                  <label className="profile-field compact-field">
                    <span className="profile-field-label">Bio</span>
                    <select
                      className="auth-input compact-select"
                      value={profile.privacySettings.bio || "public"}
                      onChange={(e) =>
                        updatePrivacySetting(
                          "bio",
                          e.target.value as VisibilityLevel
                        )
                      }
                      disabled={!isCustomVisibility}
                    >
                      <option value="public">Public</option>
                      <option value="followers">Followers</option>
                      <option value="private">Private</option>
                    </select>
                  </label>
                  <label className="profile-field compact-field">
                    <span className="profile-field-label">Links</span>
                    <select
                      className="auth-input compact-select"
                      value={profile.privacySettings.links || "public"}
                      onChange={(e) =>
                        updatePrivacySetting(
                          "links",
                          e.target.value as VisibilityLevel
                        )
                      }
                      disabled={!isCustomVisibility}
                    >
                      <option value="public">Public</option>
                      <option value="followers">Followers</option>
                      <option value="private">Private</option>
                    </select>
                  </label>
                  <label className="profile-field compact-field">
                    <span className="profile-field-label">Location</span>
                    <select
                      className="auth-input compact-select"
                      value={profile.privacySettings.location || "public"}
                      onChange={(e) =>
                        updatePrivacySetting(
                          "location",
                          e.target.value as VisibilityLevel
                        )
                      }
                      disabled={!isCustomVisibility}
                    >
                      <option value="public">Public</option>
                      <option value="followers">Followers</option>
                      <option value="private">Private</option>
                    </select>
                  </label>
                  <label className="profile-field compact-field">
                    <span className="profile-field-label">Birthday</span>
                    <select
                      className="auth-input compact-select"
                      value={profile.privacySettings.birthday || "public"}
                      onChange={(e) =>
                        updatePrivacySetting(
                          "birthday",
                          e.target.value as VisibilityLevel
                        )
                      }
                      disabled={!isCustomVisibility}
                    >
                      <option value="public">Public</option>
                      <option value="followers">Followers</option>
                      <option value="private">Private</option>
                    </select>
                  </label>
                  <label className="profile-field compact-field">
                    <span className="profile-field-label">Followers list</span>
                    <select
                      className="auth-input compact-select"
                      value={profile.privacySettings.followers || "public"}
                      onChange={(e) =>
                        updatePrivacySetting(
                          "followers",
                          e.target.value as VisibilityLevel
                        )
                      }
                      disabled={!isCustomVisibility}
                    >
                      <option value="public">Public</option>
                      <option value="followers">Followers</option>
                      <option value="private">Private</option>
                    </select>
                  </label>
                  <label className="profile-field compact-field">
                    <span className="profile-field-label">Following list</span>
                    <select
                      className="auth-input compact-select"
                      value={profile.privacySettings.following || "public"}
                      onChange={(e) =>
                        updatePrivacySetting(
                          "following",
                          e.target.value as VisibilityLevel
                        )
                      }
                      disabled={!isCustomVisibility}
                    >
                      <option value="public">Public</option>
                      <option value="followers">Followers</option>
                      <option value="private">Private</option>
                    </select>
                  </label>
                </div>
                <div className="profile-check">
                  <input
                    type="checkbox"
                    checked={profile.showPhoneOnProfile}
                    onChange={(e) =>
                      setProfile({ ...profile, showPhoneOnProfile: e.target.checked })
                    }
                  />
                  <span>Show my phone number to friends</span>
                </div>
                <p className="security-muted">
                  Your phone stays private unless you enable this.
                </p>
                {!isCustomVisibility && (
                  <p className="security-muted">
                    Switch profile visibility to Custom to edit field-by-field.
                  </p>
                )}
              </div>

              <div className="security-card">
                <h4>Activity status</h4>
                <p className="security-muted">
                  Controls who can see “active now” or “last seen.”
                </p>
                <select
                  className="auth-input compact-select compact-select-inline"
                  value={profile.activityVisibility}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      activityVisibility: e.target.value as VisibilityLevel,
                    })
                  }
                >
                  <option value="public">Public</option>
                  <option value="followers">Followers</option>
                  <option value="private">Private</option>
                </select>
                {profile.profileVisibility === "private" && (
                  <p className="security-muted">
                    Activity status is hidden while your profile is private.
                  </p>
                )}
              </div>

              <div className="security-card security-card-wide">
                <h4>Profile preview</h4>
                <p className="security-muted">
                  Preview what others see based on your current settings.
                </p>
                <div className="preview-toggle-group">
                  {["me", "public", "followers"].map((option) => (
                    <button
                      key={option}
                      type="button"
                      className={`preview-toggle${
                        previewAudience === option ? " is-active" : ""
                      }`}
                      onClick={() =>
                        setPreviewAudience(
                          option as "me" | "public" | "followers"
                        )
                      }
                    >
                      {option === "me"
                        ? "Me"
                        : option === "followers"
                        ? "Followers"
                        : "Public"}
                    </button>
                  ))}
                </div>
                <div className="profile-preview-card">
                  <p className="profile-preview-title">
                    Previewing as {previewAudienceLabel}
                  </p>
                  <div className="profile-preview-row">
                    <span className="profile-preview-label">Bio</span>
                    <span className="profile-preview-value">{previewBio}</span>
                  </div>
                  <div className="profile-preview-row">
                    <span className="profile-preview-label">Location</span>
                    <span className="profile-preview-value">{previewLocation}</span>
                  </div>
                  <div className="profile-preview-row">
                    <span className="profile-preview-label">Birthday</span>
                    <span className="profile-preview-value">{previewBirthday}</span>
                  </div>
                  <div className="profile-preview-row">
                    <span className="profile-preview-label">Links</span>
                    <span className="profile-preview-value">{previewLinks}</span>
                  </div>
                  <div className="profile-preview-row">
                    <span className="profile-preview-label">Followers list</span>
                    <span className="profile-preview-value">{previewFollowers}</span>
                  </div>
                  <div className="profile-preview-row">
                    <span className="profile-preview-label">Following list</span>
                    <span className="profile-preview-value">{previewFollowing}</span>
                  </div>
                  <div className="profile-preview-row">
                    <span className="profile-preview-label">Activity</span>
                    <span className="profile-preview-value">{previewActivity}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="settings-actions">
              <button
                className="btn ghost"
                type="button"
                onClick={handleSavePrivacySettings}
                disabled={privacySaving}
              >
                {privacySaving ? "Saving..." : "Save privacy settings"}
              </button>
            </div>
            {privacyError && <p className="status status-error">{privacyError}</p>}
            {privacySuccess && (
              <p className="status status-success">{privacySuccess}</p>
            )}
          </section>
        </div>
        )}

        {isSettingsView && settingsSection === "notifications" && (
        <div className="panel-grid">
          <section className="panel profile-settings-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Notifications</p>
                <h3>Sound, Vibration &amp; Quiet Hours</h3>
                <p className="panel-sub">
                  Configure alerts for messages and friend activity.
                </p>
              </div>
            </div>

            <div className="security-grid">
              <div className="security-card">
                <h4>Do Not Disturb</h4>
                <p className="security-muted">
                  Silence notifications during quiet hours or when DND is enabled.
                </p>
                <div className="profile-check">
                  <input
                    type="checkbox"
                    checked={Boolean(profile.notificationSettings.dndEnabled)}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        notificationSettings: {
                          ...profile.notificationSettings,
                          dndEnabled: e.target.checked,
                        },
                      })
                    }
                  />
                  <span>Enable Do Not Disturb</span>
                </div>
                <div className="privacy-grid">
                  <label className="profile-field">
                    <span className="profile-field-label">Quiet hours start</span>
                    <select
                      className="auth-input"
                      value={profile.notificationSettings.quietHoursStart || ""}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          notificationSettings: {
                            ...profile.notificationSettings,
                            quietHoursStart: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="">No quiet hours</option>
                      {TIME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="profile-field">
                    <span className="profile-field-label">Quiet hours end</span>
                    <select
                      className="auth-input"
                      value={profile.notificationSettings.quietHoursEnd || ""}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          notificationSettings: {
                            ...profile.notificationSettings,
                            quietHoursEnd: e.target.value,
                          },
                        })
                      }
                    >
                      <option value="">No quiet hours</option>
                      {TIME_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="security-card">
                <h4>Sound &amp; vibration</h4>
                <p className="security-muted">
                  Toggle audio cues and vibration feedback (mobile).
                </p>
                <div className="profile-check">
                  <input
                    type="checkbox"
                    checked={profile.notificationSettings.soundEnabled !== false}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        notificationSettings: {
                          ...profile.notificationSettings,
                          soundEnabled: e.target.checked,
                        },
                      })
                    }
                  />
                  <span>Play notification sounds</span>
                </div>
                <div className="profile-check">
                  <input
                    type="checkbox"
                    checked={profile.notificationSettings.vibrationEnabled !== false}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        notificationSettings: {
                          ...profile.notificationSettings,
                          vibrationEnabled: e.target.checked,
                        },
                      })
                    }
                  />
                  <span>Vibrate on alerts (mobile)</span>
                </div>
              </div>

              <div className="security-card">
                <h4>Push notifications</h4>
                <p className="security-muted">
                  Receive native alerts even when the app is closed.
                </p>
                <div className="profile-check">
                  <input
                    type="checkbox"
                    checked={pushEnabled}
                    disabled={pushBlockedByPhone}
                    onChange={(e) => {
                      const nextChecked = e.target.checked;
                      if (nextChecked && pushBlockedByPhone) {
                        setPushError(
                          "Verify your phone number before enabling push notifications."
                        );
                        return;
                      }
                      setPushError(null);
                      setProfile({
                        ...profile,
                        notificationSettings: {
                          ...profile.notificationSettings,
                          pushEnabled: nextChecked,
                        },
                      });
                    }}
                  />
                  <span>Enable push notifications</span>
                </div>
                {pushBlockedByPhone && phoneVerificationLabel && (
                  <p className={phoneVerified === null ? "security-muted" : "status status-error"}>
                    {phoneVerificationLabel}
                  </p>
                )}
                {pushStatusLabel && <p className="security-muted">{pushStatusLabel}</p>}
                {pushError && <p className="status status-error">{pushError}</p>}
              </div>

              <div className="security-card">
                <h4>Dashboard news</h4>
                <p className="security-muted">
                  Control whether the Newsroom feed appears on your dashboard.
                </p>
                <div className="profile-check">
                  <input
                    type="checkbox"
                    checked={profile.notificationSettings.newsEnabled !== false}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        notificationSettings: {
                          ...profile.notificationSettings,
                          newsEnabled: e.target.checked,
                        },
                      })
                    }
                  />
                  <span>Show Newsroom on my dashboard</span>
                </div>
              </div>
            </div>

            <div className="settings-actions">
              <button
                className="btn ghost"
                type="button"
                onClick={handleSaveNotificationSettings}
                disabled={notificationSaving}
              >
                {notificationSaving ? "Saving..." : "Save notification settings"}
              </button>
            </div>
            {notificationError && (
              <p className="status status-error">{notificationError}</p>
            )}
            {notificationSuccess && (
              <p className="status status-success">{notificationSuccess}</p>
            )}
          </section>
        </div>
        )}

        {isSettingsView && settingsSection === "changes" && (
        <div className="panel-grid">
          <section className="panel profile-settings-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Account</p>
                <h3>Changes &amp; Deactivation</h3>
                <p className="panel-sub">
                  Sensitive changes are rate-limited and logged for support review.
                </p>
              </div>
            </div>

            {accountStatusLoading && <p className="status">Loading account status…</p>}
            {accountStatusError && (
              <p className="status status-error">{accountStatusError}</p>
            )}

            <div className="security-grid">
              <div className="security-card">
                <h4>Email address</h4>
                <p className="security-muted">
                  You can change this every {accountStatus?.emailCooldownDays ?? 30} days.
                  Next change: {emailAvailabilityLabel}.
                </p>
                <div className="security-row">
                  <input
                    className="auth-input"
                    type="email"
                    value={emailDraft}
                    onChange={(e) => setEmailDraft(e.target.value)}
                    placeholder="New email"
                  />
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleEmailChange}
                    disabled={emailChangeLoading || emailCooldownActive}
                  >
                    {emailChangeLoading ? "Saving..." : "Update"}
                  </button>
                </div>
                {emailCooldownActive && (
                  <p className="security-muted">
                    Email change available {formatDateTime(emailCooldownAt)}.
                  </p>
                )}
                {emailChangeError && (
                  <p className="status status-error">{emailChangeError}</p>
                )}
                {emailChangeSuccess && (
                  <p className="status status-success">{emailChangeSuccess}</p>
                )}
              </div>

              <div className="security-card security-card-wide">
                <h4>Deactivate vs. delete</h4>
                <p className="security-muted">
                  Deactivation hides your profile and removes it from search for up to {deactivationDays} days.
                  Deleting removes your account and data permanently.
                </p>
                <div className="privacy-grid">
                  <label className="profile-field">
                    <span className="profile-field-label">Reason (optional)</span>
                    <input
                      className="auth-input"
                      value={deactivateReason}
                      onChange={(e) => setDeactivateReason(e.target.value)}
                      placeholder="Taking a break"
                    />
                  </label>
                </div>
                <div className="security-actions">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleDeactivateAccount}
                    disabled={deactivateLoading || isDeactivated}
                  >
                    {deactivateLoading ? "Deactivating..." : "Deactivate account"}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleReactivateAccount}
                    disabled={reactivateLoading || !isDeactivated}
                  >
                    {reactivateLoading ? "Reactivating..." : "Reactivate"}
                  </button>
                  <button
                    className="profile-delete-button"
                    type="button"
                    onClick={() => {
                      setDeleteAccountError(null);
                      setDeleteAccountOpen(true);
                    }}
                  >
                    Delete account
                  </button>
                </div>
                <p className="security-muted">
                  Deactivation ends {deactivationEndsLabel}.
                </p>
                {deactivateError && (
                  <p className="status status-error">{deactivateError}</p>
                )}
                {deactivateSuccess && (
                  <p className="status status-success">{deactivateSuccess}</p>
                )}
                {reactivateError && (
                  <p className="status status-error">{reactivateError}</p>
                )}
                {reactivateSuccess && (
                  <p className="status status-success">{reactivateSuccess}</p>
                )}
              </div>
            </div>
          </section>
        </div>
        )}

        {!isSettingsView && (
        <div className="panel-grid">
          <section className="panel post-composer">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Share</p>
                <h3>New Post</h3>
                <p className="panel-sub">
                  Share With Our Community!
                </p>
              </div>
            </div>

            <div className="post-composer__top">
              <div className="post-composer__avatar">
                {avatarImg ? (
                  <img src={avatarImg} alt={displayName} />
                ) : (
                  <span>{initials}</span>
                )}
              </div>
              <div className="post-composer__input">
                <textarea
                  className="auth-input"
                  placeholder="What's on your mind?"
                  value={postContent}
                  onChange={(e) => {
                    setPostContent(e.target.value);
                    setPostError(null);
                  }}
                  rows={4}
                />
                {linkPreviewLoading && (
                  <span className="post-composer__hint">Loading preview...</span>
                )}
              </div>
            </div>

            {linkPreview && (
              <LinkPreviewCard
                preview={linkPreview}
                url={linkPreview.url || extractFirstUrl(postContent)}
              />
            )}
            {linkPreviewError && <p className="status status-error">{linkPreviewError}</p>}
            {postFilePreviewUrl && (
              <div className="post-composer__media-preview">
                {postFileIsVideo ? (
                  <video controls muted playsInline preload="metadata">
                    <source src={postFilePreviewUrl} />
                  </video>
                ) : (
                  <img src={postFilePreviewUrl} alt="Upload preview" />
                )}
              </div>
            )}

            <div className="post-composer__feedback">
              <span className="post-feedback-label">Post visibility</span>
              <div className="post-feedback-row">
                <select
                  className="auth-input post-feedback-select"
                  value={postVisibility}
                  onChange={(e) => {
                    setPostVisibility(e.target.value);
                    setPostError(null);
                  }}
                >
                  <option value="public">Public</option>
                  <option value="friends">Friends</option>
                  <option value="private">Private</option>
                </select>
              </div>
            </div>

            <div className="post-composer__feedback">
              <span className="post-feedback-label">Request feedback</span>
              <div className="post-feedback-row">
                <select
                  className="auth-input post-feedback-select"
                  value={feedbackAudience}
                  onChange={(e) => {
                    setFeedbackAudience(e.target.value);
                    setPostError(null);
                  }}
                >
                  <option value="none">No feedback request</option>
                  <option value="public">Public feedback</option>
                  <option value="friends">Friends only</option>
                  <option value="specific">Specific friend</option>
                </select>
                {feedbackAudience === "specific" && (
                  <select
                    className="auth-input post-feedback-select"
                    value={feedbackTargetId ?? ""}
                    onChange={(e) => {
                      const nextId = Number(e.target.value);
                      setFeedbackTargetId(Number.isFinite(nextId) ? nextId : null);
                      setPostError(null);
                    }}
                    disabled={!friendOptions.length}
                  >
                    <option value="">Select a friend</option>
                    {friendOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              {feedbackAudience === "specific" && friendOptions.length === 0 && (
                <p className="post-feedback-note">
                  Add a friend first to request feedback from a specific person.
                </p>
              )}
            </div>

            <div className="post-composer__actions">
              <div className="post-composer__tools">
                <label className="post-composer__tool">
                  <input
                    type="file"
                    accept="image/*,video/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      if (file && file.size > MAX_UPLOAD_BYTES) {
                        setPostError(`Media files must be under ${MAX_UPLOAD_LABEL}.`);
                        e.target.value = "";
                        setPostFile(null);
                        return;
                      }
                      setPostFile(file);
                      setPostError(null);
                    }}
                  />
                  <span>{postFile ? "Change media" : "Add photo/video"}</span>
                </label>
                <span className="post-composer__file">
                  {postFile ? postFile.name : "No media selected"}
                </span>
                {postFile && (
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => setPostFile(null)}
                  >
                    Remove
                  </button>
                )}
              </div>
              <button
                className="btn primary"
                type="button"
                onClick={createPost}
                disabled={postSubmitting}
              >
                {postSubmitting ? "Posting..." : "Post"}
              </button>
            </div>

            {postError && <p className="status status-error">{postError}</p>}
          </section>
        </div>
        )}

        {!isSettingsView && (
        <div className="posts-grid">
          {posts.map((p) => {
            const postUrl = extractFirstUrl(p.text);
            const preview = postUrl ? previewCache[postUrl] : undefined;
            const hasLink = Boolean(postUrl);
            const descriptor = mediaDescriptor(p.media, hasLink);
            const canDelete = Boolean(p.id ?? p.documentId);
            const feedbackLabel = feedbackLabelFor(p);
            const postKey = String(p.id);
            const comments = postComments[postKey] ?? [];
            const isCommentsOpen = Boolean(openCommentsFor[postKey]);
            const showReactionPicker = reactionPickerFor === postKey;
            const showShareMenu = shareMenuFor === postKey;
            const shareUrl = buildShareUrl(postKey);
            const shareText = p.text
              ? `${displayName}: ${p.text.slice(0, 80)}`
              : `${displayName} posted an update.`;
            const encodedUrl = encodeURIComponent(shareUrl);
            const encodedText = encodeURIComponent(shareText);
            const likesCount = Number(p.likes ?? 0);
            const sharesCount = Number(p.shares ?? 0);
            const commentsCount = comments.length;
            const currentVisibility = p.visibility || "friends";

            return (
              <article
                key={String(p.id)}
                id={`post-${postKey}`}
                className={`post-card${
                  showReactionPicker || showShareMenu ? " is-popover-open" : ""
                }`}
              >
                <div className="post-meta-bar">
                  <span className="post-meta-name">{displayName}</span>
                  <span className="post-meta-text">
                    {formatPostUpdateLabel(p.createdAt)}
                  </span>
                  {descriptor && <span className="post-meta-tag">{descriptor}</span>}
                  {feedbackLabel && <span className="post-feedback-tag">{feedbackLabel}</span>}
                  <select
                    className="auth-input post-feedback-select post-visibility-select"
                    value={currentVisibility}
                    onChange={(e) => void updatePostVisibility(p, e.target.value)}
                  >
                    <option value="public">Public</option>
                    <option value="friends">Friends</option>
                    <option value="private">Private</option>
                  </select>
                  {canDelete && (
                    <button
                      className="btn ghost post-delete"
                      type="button"
                      onClick={() => setDeletePostTarget(p)}
                    >
                      Delete
                    </button>
                  )}
                </div>

                {p.media ? (
                  <div className="post-media">
                    {isVideoUrl(p.media) ? (
                      <video controls style={{ width: "100%", height: "100%", objectFit: "cover" }}>
                        <source src={p.media} />
                      </video>
                    ) : (
                      <img src={p.media} alt={p.text} loading="lazy" />
                    )}
                  </div>
                ) : preview?.image ? (
                  <div className="post-media link-preview-media">
                    <img
                      src={preview.image}
                      alt={preview.title || displayName}
                      loading="lazy"
                    />
                  </div>
                ) : null}

                <div className="post-body">
                  <h3>{displayName}</h3>
                  <p>{p.text}</p>
                  {preview && !p.media && (
                    <LinkPreviewCard preview={preview} url={preview.url || postUrl} compact />
                  )}
                  <div className="post-actions">
                    <div className="post-action-counts">
                      <span className="post-action-count">
                        <span className="post-action-count-icon" aria-hidden="true">
                          👍
                        </span>
                        {likesCount}
                      </span>
                      <span className="post-action-count">
                        <span className="post-action-count-icon" aria-hidden="true">
                          💬
                        </span>
                        {commentsCount}
                      </span>
                      <span className="post-action-count">
                        <span className="post-action-count-icon" aria-hidden="true">
                          ↗
                        </span>
                        {sharesCount}
                      </span>
                    </div>
                    <div className="post-action-bar">
                    <div className="post-action-group">
                      <button
                        className="post-action-btn"
                        type="button"
                        aria-pressed={showReactionPicker}
                        onClick={() => toggleReactionPicker(postKey)}
                      >
                        <span className="post-action-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24">
                            <path d="M2 10.5A1.5 1.5 0 0 1 3.5 9h1A1.5 1.5 0 0 1 6 10.5v9A1.5 1.5 0 0 1 4.5 21h-1A1.5 1.5 0 0 1 2 19.5v-9Z" />
                            <path d="M6 10.333V5a3 3 0 0 1 3-3h.5a.5.5 0 0 1 .5.5V8h4.65a2.5 2.5 0 0 1 2.453 2.98l-1.2 6A2.5 2.5 0 0 1 13.452 19H8a2 2 0 0 1-2-2v-6.667Z" />
                          </svg>
                        </span>
                        <span>Like</span>
                      </button>
                      {showReactionPicker && (
                        <div className="post-action-popover">
                          <ReactionPicker
                            onPick={(emoji) => {
                              setReactionPickerFor(null);
                              void handleReaction(p, postKey, emoji);
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="post-action-group">
                      <button
                        className="post-action-btn"
                        type="button"
                        aria-pressed={isCommentsOpen}
                        onClick={() => toggleComments(postKey)}
                      >
                        <span className="post-action-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24">
                            <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2Z" />
                          </svg>
                        </span>
                        <span>Comment</span>
                      </button>
                    </div>
                    <div className="post-action-group">
                      <button
                        className="post-action-btn"
                        type="button"
                        aria-pressed={showShareMenu}
                        onClick={() => toggleShareMenu(postKey)}
                      >
                        <span className="post-action-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24">
                            <path d="M14 3 21 10 14 17v-4h-4a4 4 0 0 0-4 4v4H4v-4a6 6 0 0 1 6-6h4V3Z" />
                          </svg>
                        </span>
                        <span>Share</span>
                      </button>
                      {showShareMenu && (
                        <div className="post-action-popover is-wide">
                          <div className="post-share-grid">
                            <button
                              className="post-share-btn"
                              type="button"
                              onClick={() => handleCopyShare(p, postKey, shareUrl)}
                            >
                              Copy link
                            </button>
                            {typeof navigator !== "undefined" &&
                              typeof navigator.share === "function" && (
                                <button
                                  className="post-share-btn"
                                  type="button"
                                  onClick={() =>
                                    handleNativeShare(p, postKey, shareUrl, shareText)
                                  }
                                >
                                  Share...
                                </button>
                              )}
                            <a
                              className="post-share-link"
                              href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
                              onClick={() => void trackShare(p, postKey)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Facebook
                            </a>
                            <a
                              className="post-share-link"
                              href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`}
                              onClick={() => void trackShare(p, postKey)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              X
                            </a>
                            <a
                              className="post-share-link"
                              href={`https://www.linkedin.com/shareArticle?mini=true&url=${encodedUrl}&title=${encodedText}`}
                              onClick={() => void trackShare(p, postKey)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              LinkedIn
                            </a>
                            <a
                              className="post-share-link"
                              href={`https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`}
                              onClick={() => void trackShare(p, postKey)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Reddit
                            </a>
                            <a
                              className="post-share-link"
                              href={`https://wa.me/?text=${encodedText}%20${encodedUrl}`}
                              onClick={() => void trackShare(p, postKey)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              WhatsApp
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  </div>
                  {shareNotice[postKey] && (
                    <p className="post-action-notice">{shareNotice[postKey]}</p>
                  )}
                  {isCommentsOpen && (
                    <div className="comments">
                      <p className="eyebrow">Comments</p>
                      {comments.length > 0 ? (
                        <ul className="comment-list">
                          {comments.map((c) => (
                            <li key={c.id} className="comment-item">
                              <div className="comment-author">{c.owner || "User"}</div>
                              <div className="comment-body">{c.body}</div>
                              {user?.id === c.ownerId && (
                                <button
                                  className="btn ghost comment-delete"
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await api.delete(`/comments/${c.id}`);
                                      setPostComments((prev) => ({
                                        ...prev,
                                        [postKey]: (prev[postKey] || []).filter(
                                          (comment) => comment.id !== c.id
                                        ),
                                      }));
                                    } catch (err) {
                                      console.error("Delete comment failed", err);
                                      setPostError("Failed to delete comment.");
                                    }
                                  }}
                                >
                                  Delete
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="status">No comments yet.</p>
                      )}
                      <div className="comment-form">
                        <input
                          className="auth-input"
                          placeholder="Add a comment..."
                          value={commentInputs[postKey] || ""}
                          onChange={(e) =>
                            setCommentInputs((prev) => ({
                              ...prev,
                              [postKey]: sanitizePostText(e.target.value),
                            }))
                          }
                        />
                        <button
                          className="btn primary"
                          type="button"
                          disabled={!commentInputs[postKey]?.trim()}
                          onClick={async () => {
                            const body = (commentInputs[postKey] || "").trim();
                            if (!body) return;
                            try {
                              await api.post("/comments", {
                                data: {
                                  body,
                                  target_type: "user",
                                  target_id: p.id,
                                },
                              });
                              await refreshCommentsForPost(p.id);
                              setCommentInputs((prev) => ({ ...prev, [postKey]: "" }));
                            } catch (err) {
                              console.error("Add comment failed", err);
                              setPostError("Failed to add comment.");
                            }
                          }}
                        >
                          Comment
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        )}
      </div>
    </div>
  );
}
