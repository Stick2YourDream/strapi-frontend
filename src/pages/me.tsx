// src/pages/Me.tsx
import {
  type CSSProperties,
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import "../css/dashboard.css";
import "../css/profile.css";
import "../css/friends.css";
import "../css/media-lightbox.css";
import "../css/goals-panel.css";
import { useAuth } from "../context/AuthContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import api from "../api/strapi";
import axios from "axios";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import LanguageMenu from "../components/LanguageMenu";
import LinkPreviewCard from "../components/LinkPreviewCard";
import ProfilePhotoModal from "../components/ProfilePhotoModal";
import PopupModal from "../components/PopupModal";
import { HOBBY_OPTIONS } from "./me_hobbies";
import { RELIGION_OPTIONS } from "./me_religions";
import { usePageMeta } from "../hooks/usePageMeta";
import { useNewsPreference } from "../hooks/useNewsPreference";
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
import {
  DEFAULT_TIME_LIMIT_MINUTES,
  TIME_LIMIT_OPTIONS,
  normalizeTimeLimitSettings,
  type TimeLimitSettings,
} from "../utils/time-limits";
import { pickMediaUrl } from "../utils/media";
import { sanitizePostText } from "../utils/emoji";
import { getOrCreateDeviceId } from "../utils/device-id";
import {
  detectDesktopOs,
  downloadBlob,
  exportProfileArchive,
  getExportInstructions,
} from "../utils/profile-export";
import {
  approveDeviceKeyRequest,
  listDeviceKeyRequests,
  rejectDeviceKeyRequest,
  type DeviceKeyRequest,
} from "../utils/device-approval";
import { syncPushSubscription, type PushSyncStatus } from "../utils/push-notifications";
import { formatPostUpdateLabel } from "../utils/time";
import {
  buildTelLink,
  extractNationalDigits,
  formatPhoneDisplay,
  formatPhoneInput,
  normalizeDialCode,
} from "../utils/phone";

type VerificationMethod = "email" | "sms";
type TwoFactorMethod = "email" | "sms" | "totp";
const SETTINGS_SECTION_IDS = [
  "appearance",
  "security",
  "privacy",
  "notifications",
  "storefront",
  "time-limits",
  "language",
  "changes",
] as const;

type SettingsSection = (typeof SETTINGS_SECTION_IDS)[number];

const isSettingsSection = (value: string | null): value is SettingsSection =>
  Boolean(value) && SETTINGS_SECTION_IDS.includes(value as SettingsSection);

const SECURITY_QUESTION_OPTIONS = [
  "What was the name of your first pet?",
  "What city were you born in?",
  "What is the last name of a favorite teacher?",
  "What was your first car?",
  "What is your mother's maiden name?",
  "What street did you grow up on?",
  "What was the name of your elementary school?",
] as const;

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
  phoneDialCode?: string;
  preferredVerificationMethod: VerificationMethod;
  showPhoneOnProfile: boolean;
  profileVisibility: ProfileVisibility;
  privacySettings: PrivacySettings;
  searchIndexingEnabled: boolean;
  externalIndexingEnabled: boolean;
  activityVisibility: VisibilityLevel;
  notificationSettings: NotificationSettings;
  timeLimitSettings: TimeLimitSettings;
  storefrontDefaultLocation: string;
  storefrontDefaultRadiusMiles: string;
  handle?: string;
  avatarUrl?: string;
  onboardingComplete?: boolean;
};

type LocationOption = {
  name: string;
  code: string;
  countryCode?: string;
  phoneCode?: string;
};

type ReactionCounts = {
  thumbsUp: number;
  heart: number;
};

type MediaPost = {
  id: number | string;
  documentId?: number | string;
  numericId?: number;
  text: string;
  media?: string;
  createdAt?: string;
  feedbackAudience?: string;
  feedbackTargetId?: number;
  feedbackTargetName?: string;
  likes?: number;
  reactionCounts?: ReactionCounts;
  myReaction?: string | null;
  shares?: number;
  visibility?: string;
  trustedCircleId?: number;
  trustedCircleName?: string;
};

type CommentItem = {
  id: number | string;
  numericId?: number;
  documentId?: string;
  body: string;
  owner?: string;
  ownerId?: number | string;
  createdAt?: string;
};

type FriendOption = {
  id: number;
  label: string;
  avatarUrl?: string;
};

type TrustedCircleOption = {
  id: number;
  name: string;
};

type TrustedCircle = {
  id: number;
  name: string;
};

type TrustedCircleMember = {
  id: number | string;
  userId: number;
};

type GoalsState = {
  selectedGoals: string[];
  customGoals: string[];
  achievedGoals: string[];
  trustedFriendIds: number[];
  reminder: "daily" | "weekly" | "off";
  trustedCircleIds: number[];
  checkIns: unknown[];
};

type PrivacyEditState = {
  profile: boolean;
  fields: boolean;
  activity: boolean;
  reminders: boolean;
  news: boolean;
  preview: boolean;
};

type VisibilityOption = {
  value: "public" | "friends" | "trusted" | "private";
  label: string;
  hint: string;
  disabled?: boolean;
};

type ProfileMediaItem = {
  id: number | string;
  documentId?: string;
  title?: string;
  caption?: string;
  folder?: string;
  order?: number;
  visibility?: "public" | "friends" | "private" | "trusted";
  kind?: "photo" | "video";
  media?: string;
  createdAt?: string;
  ownerId?: number;
  trustedCircleId?: number;
  trustedCircleName?: string;
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
  ageVerified?: boolean;
  ageVerifiedAt?: string | null;
  ageVerificationRequired?: boolean;
  ageVerificationDueAt?: string | null;
  ageVerificationOverdue?: boolean;
  ageVerificationDaysRemaining?: number | null;
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

const MAX_HOBBIES = 15;
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

const parseStorefrontLocation = (value: string) => {
  const parts = String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return { city: "", state: "" };
  }
  if (parts.length === 1) {
    return { city: "", state: parts[0] };
  }
  const state = parts[parts.length - 1];
  const city = parts.slice(0, -1).join(", ");
  return { city, state };
};

const formatStorefrontLocation = (city: string, state: string) =>
  [String(city || "").trim(), String(state || "").trim()].filter(Boolean).join(", ");

const STOREFRONT_RADIUS_OPTIONS = [
  { value: "25", label: "<25 miles" },
  { value: "100", label: "25-100 miles" },
  { value: "150", label: ">100 miles" },
];

const normalizeReactionCounts = (value: unknown, fallbackLikes?: number): ReactionCounts => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const thumbsRaw = record.thumbsUp ?? record.thumbs_up;
  const heartRaw = record.heart;
  const thumbsUp = Number(thumbsRaw);
  const heart = Number(heartRaw);
  const hasCounts = Number.isFinite(thumbsUp) || Number.isFinite(heart);
  return {
    thumbsUp: Number.isFinite(thumbsUp)
      ? thumbsUp
      : hasCounts
      ? 0
      : Number(fallbackLikes ?? 0),
    heart: Number.isFinite(heart) ? heart : 0,
  };
};

const normalizeReactionValue = (value: unknown): string | null => {
  const trimmed = String(value || "").trim();
  if (trimmed === "👍" || trimmed === "❤️") return trimmed;
  return null;
};

const resolveDialCodeForCountry = (
  countryCode: string,
  countryName: string,
  options: LocationOption[]
) => {
  if (!options.length) return "";
  const matchByCode = options.find(
    (option) => option.code && option.code.toUpperCase() === countryCode.toUpperCase()
  );
  const matchByCountry = !matchByCode ? matchByName(options, countryName) : null;
  const phoneCode = matchByCode?.phoneCode || matchByCountry?.phoneCode || "";
  return normalizeDialCode(phoneCode);
};

const deriveDialCodeFromPhone = (
  digits: string,
  options: LocationOption[],
  fallback: string
) => {
  if (!digits) return fallback;
  const codes = options
    .map((option) => normalizeDialCode(option.phoneCode || ""))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const match = codes.find((code) => digits.startsWith(code));
  return match || fallback;
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

const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_UPLOAD_LABEL = "1 GB";
const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_LABEL = "100 MB";
const MAX_TRUSTED_CIRCLES = 5;
const MAX_COMMENT_MEDIA_FILES = 4;
const IMAGE_EXT_REGEX = /\.(?:png|jpe?g|webp|gif|bmp|avif)(?:\?|#|$)/i;
const RELATIVE_UPLOAD_REGEX = /\/uploads\/[^\s)]+/g;
const extractFirstUrl = (text: string) => {
  const match = text.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (!match) return "";
  let url = match[0].replace(/[),.!?]+$/, "");
  if (url.startsWith("www.")) url = `https://${url}`;
  return url;
};
const extractImageUrls = (text: string) => {
  const safeText = String(text || "");
  if (!safeText) return [];
  const urls = new Set<string>();
  const matches = safeText.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/gi) ?? [];
  matches.forEach((raw) => {
    const cleaned = raw.replace(/[),.!?]+$/, "");
    const href = cleaned.startsWith("www.") ? `https://${cleaned}` : cleaned;
    if (IMAGE_EXT_REGEX.test(href) || IMAGE_EXT_REGEX.test(raw)) {
      urls.add(href);
    }
  });
  const relativeMatches = safeText.match(RELATIVE_UPLOAD_REGEX) ?? [];
  relativeMatches.forEach((raw) => {
    if (IMAGE_EXT_REGEX.test(raw)) {
      urls.add(raw);
    }
  });
  return Array.from(urls);
};
const stripImageUrls = (text: string, urls: string[]) => {
  let cleaned = String(text || "");
  urls.forEach((url) => {
    cleaned = cleaned.replace(url, "");
  });
  return cleaned.replace(/\s{2,}/g, " ").trim();
};
const isYoutubeUrl = (value: string) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes("youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
};
const isVideoUrl = (value?: string) =>
  !!value && /\.(mp4|webm|mov|m4v|mkv)$/i.test(value);
const isImageFile = (file: File) => {
  if (file.type && file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|tiff?|svg|heic|heif)$/i.test(file.name);
};
const isPreviewableUrl = (value?: string) =>
  !!value && (isYoutubeUrl(value) || isVideoUrl(value));
const isVideoFile = (file: File) => {
  if (file.type && file.type.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|m4v|mkv)$/i.test(file.name);
};
const mediaDescriptor = (mediaUrl?: string, hasLink?: boolean) => {
  if (mediaUrl) return isVideoUrl(mediaUrl) ? "with a video" : "with a picture";
  if (hasLink) return "with a link";
  return "";
};
const MEDIA_PAGE_SIZE = 8;
const MEDIA_FOLDER_ALL = "all";
const MEDIA_FOLDER_UNSORTED = "__unsorted__";
const normalizeFolderName = (value?: string | null) => String(value || "").trim();
const MEDIA_FOLDER_STORAGE_PREFIX = "ysp_media_folders_v1";
const isReservedMediaFolder = (value: string) => {
  const normalized = normalizeFolderName(value).toLowerCase();
  return normalized === MEDIA_FOLDER_ALL || normalized === MEDIA_FOLDER_UNSORTED;
};
const sanitizeFolderList = (folders: string[]) => {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  folders.forEach((entry) => {
    const normalized = normalizeFolderName(entry);
    if (!normalized || isReservedMediaFolder(normalized)) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    cleaned.push(normalized);
  });
  return cleaned;
};

const mergeFolderLists = (current: string[], incoming: string[]) => {
  const merged = [...current];
  incoming.forEach((entry) => {
    const normalized = normalizeFolderName(entry);
    if (!normalized || isReservedMediaFolder(normalized)) return;
    if (merged.some((folder) => folder.toLowerCase() === normalized.toLowerCase()))
      return;
    merged.push(normalized);
  });
  return merged;
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

const normalizeProfileMedia = (entry: any): ProfileMediaItem => {
  const record = entry?.data ?? entry ?? {};
  const attrs = record?.attributes ?? record ?? {};
  const mediaItem = attrs?.media ?? record?.media;
  const mediaUrl = pickMediaUrl(mediaItem, { kind: "post" });
  const trustedCircle = attrs?.trustedCircle ?? record?.trustedCircle;
  const trustedCircleRecord = trustedCircle?.data ?? trustedCircle ?? null;
  const orderValue = Number(attrs?.order);
  return {
    id: record?.id ?? record?.documentId ?? "",
    documentId: record?.documentId ?? attrs?.documentId,
    title: String(attrs?.title || "").trim() || undefined,
    caption: String(attrs?.caption || "").trim() || undefined,
    folder: String(attrs?.folder || "").trim() || undefined,
    order: Number.isFinite(orderValue) ? orderValue : undefined,
    visibility: attrs?.visibility as ProfileMediaItem["visibility"],
    kind: attrs?.kind as ProfileMediaItem["kind"],
    media: mediaUrl,
    createdAt: String(attrs?.createdAt || ""),
    ownerId: Number(attrs?.owner?.id ?? attrs?.owner ?? 0) || undefined,
    trustedCircleId:
      Number(trustedCircleRecord?.id ?? trustedCircleRecord?.documentId ?? 0) || undefined,
    trustedCircleName: String(trustedCircleRecord?.attributes?.name || "").trim() || undefined,
  };
};

const parseMediaOrder = (value?: number | null) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

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

const DEFAULT_TIME_LIMIT_SETTINGS: TimeLimitSettings = {
  enabled: false,
  durationMinutes: DEFAULT_TIME_LIMIT_MINUTES,
  cooldownUntil: null,
};

const goalsStorageKeyFor = (userId?: number | null) =>
  userId ? `ysp-goals-${userId}` : "ysp-goals-guest";

const loadGoalsState = (key: string): GoalsState => {
  if (typeof window === "undefined") {
    return {
      selectedGoals: [],
      customGoals: [],
      achievedGoals: [],
      trustedFriendIds: [],
      reminder: "weekly",
      trustedCircleIds: [],
      checkIns: [],
    };
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return {
      selectedGoals: [],
      customGoals: [],
      achievedGoals: [],
      trustedFriendIds: [],
      reminder: "weekly",
      trustedCircleIds: [],
      checkIns: [],
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<
      GoalsState & { trustedGroupIds?: number[] }
    > | null;
    return {
      selectedGoals: parsed?.selectedGoals ?? [],
      customGoals: parsed?.customGoals ?? [],
      achievedGoals: parsed?.achievedGoals ?? [],
      trustedFriendIds: parsed?.trustedFriendIds ?? [],
      reminder: parsed?.reminder ?? "weekly",
      trustedCircleIds: parsed?.trustedCircleIds ?? parsed?.trustedGroupIds ?? [],
      checkIns: parsed?.checkIns ?? [],
    };
  } catch {
    return {
      selectedGoals: [],
      customGoals: [],
      achievedGoals: [],
      trustedFriendIds: [],
      reminder: "weekly",
      trustedCircleIds: [],
      checkIns: [],
    };
  }
};

const saveGoalsState = (key: string, state: GoalsState) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(state));
  window.dispatchEvent(new Event("ysp-goals-updated"));
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

const visibilityLabelFor = (value?: string) => {
  if (value === "public") return "Public";
  if (value === "followers") return "Followers";
  if (value === "private") return "Private";
  if (value === "custom") return "Custom";
  return "Unknown";
};

const reminderLabelFor = (value: GoalsState["reminder"]) => {
  if (value === "daily") return "Daily";
  if (value === "weekly") return "Weekly";
  return "Off";
};

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
  const location = useLocation();
  const {
    user,
    keyBackupStatus,
    refreshProfile,
    refreshKeyBackup,
    logout,
    updateUser,
  } = useAuth();
  const mediaFolderStorageKey = user?.id
    ? `${MEDIA_FOLDER_STORAGE_PREFIX}_${user.id}`
    : null;
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
  const { setPreference: setNewsPreference } = useNewsPreference(user?.id);
  const goalsStorageKey = useMemo(
    () => goalsStorageKeyFor(user?.id ?? null),
    [user?.id]
  );
  const [goalReminder, setGoalReminder] = useState<GoalsState["reminder"]>(() =>
    loadGoalsState(goalsStorageKey).reminder
  );
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
    phoneDialCode: "",
    preferredVerificationMethod: "email",
    showPhoneOnProfile: false,
    profileVisibility: "public",
    privacySettings: DEFAULT_PRIVACY_SETTINGS,
    searchIndexingEnabled: true,
    externalIndexingEnabled: false,
    activityVisibility: "public",
    notificationSettings: DEFAULT_NOTIFICATION_SETTINGS,
    timeLimitSettings: DEFAULT_TIME_LIMIT_SETTINGS,
    storefrontDefaultLocation: "",
    storefrontDefaultRadiusMiles: "",
    handle: "",
  });

  const profileSnapshotRef = useRef<Profile | null>(null);
  const profilePayloadRef = useRef<ProfilePayload | null>(null);
  const registrationLocksRef = useRef<RegistrationLocks>({});
  const hobbySnapshotRef = useRef<string[]>([]);
  const profileIdRef = useRef<string | number | null>(null);
  const handleFixAttemptedRef = useRef(false);
  const phoneRepairAttemptedRef = useRef(false);
  const mediaFoldersLoadedRef = useRef(false);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreviewUrl, setAvatarPreviewUrl] = useState<string | null>(null);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [posts, setPosts] = useState<MediaPost[]>([]);
  const [profileMedia, setProfileMedia] = useState<ProfileMediaItem[]>([]);
  const [profileMediaLoading, setProfileMediaLoading] = useState(false);
  const [profileMediaError, setProfileMediaError] = useState<string | null>(null);
  const [profileDecryptFailed, setProfileDecryptFailed] = useState(false);
  const [mediaTab, setMediaTab] = useState<"all" | "photo" | "video">("all");
  const [mediaFolderFilter, setMediaFolderFilter] = useState<string>(MEDIA_FOLDER_ALL);
  const [mediaPage, setMediaPage] = useState(1);
  const [mediaFolders, setMediaFolders] = useState<string[]>([]);
  const [mediaNewFolderOpen, setMediaNewFolderOpen] = useState(false);
  const [mediaNewFolderName, setMediaNewFolderName] = useState("");
  const [mediaFolderError, setMediaFolderError] = useState<string | null>(null);
  const [mediaDragOverFolder, setMediaDragOverFolder] = useState<string | null>(null);
  const [mediaDraggingId, setMediaDraggingId] = useState<string | null>(null);
  const [mediaDragOverId, setMediaDragOverId] = useState<string | null>(null);
  const [mediaLightboxOpen, setMediaLightboxOpen] = useState(false);
  const [mediaLightboxItems, setMediaLightboxItems] = useState<ProfileMediaItem[]>([]);
  const [mediaLightboxIndex, setMediaLightboxIndex] = useState(0);
  const [mediaMenuFor, setMediaMenuFor] = useState<string | null>(null);
  const [mediaVisibilityModalItem, setMediaVisibilityModalItem] =
    useState<ProfileMediaItem | null>(null);
  const [mediaEditModalItem, setMediaEditModalItem] =
    useState<ProfileMediaItem | null>(null);
  const [mediaMoveModalItem, setMediaMoveModalItem] =
    useState<ProfileMediaItem | null>(null);
  const [mediaMoveFolderOpen, setMediaMoveFolderOpen] = useState(false);
  const [mediaMoveFolderName, setMediaMoveFolderName] = useState("");
  const [mediaMoveFolderError, setMediaMoveFolderError] = useState<string | null>(
    null
  );
  const [mediaDeleteTarget, setMediaDeleteTarget] =
    useState<ProfileMediaItem | null>(null);
  const [editingMediaId, setEditingMediaId] = useState<string | null>(null);
  const [mediaEditTitle, setMediaEditTitle] = useState("");
  const [mediaEditCaption, setMediaEditCaption] = useState("");
  const [mediaEditFolder, setMediaEditFolder] = useState("");
  const [mediaEditSaving, setMediaEditSaving] = useState(false);
  const [mediaDragActive, setMediaDragActive] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaFilePreview, setMediaFilePreview] = useState<string | null>(null);
  const [mediaTitle, setMediaTitle] = useState("");
  const [mediaCaption, setMediaCaption] = useState("");
  const [mediaFolder, setMediaFolder] = useState("");
  const [mediaVisibility, setMediaVisibility] = useState<
    "public" | "friends" | "private" | "trusted"
  >("friends");
  const [mediaTrustedCircleId, setMediaTrustedCircleId] = useState<string | number>("");
  const [mediaSubmitting, setMediaSubmitting] = useState(false);
  const [trustedCircleOptions, setTrustedCircleOptions] = useState<
    TrustedCircleOption[]
  >([]);
  const [trustedCircles, setTrustedCircles] = useState<TrustedCircle[]>([]);
  const [activeTrustedCircleId, setActiveTrustedCircleId] = useState<number | null>(
    null
  );
  const [trustedCircleMembersByGroup, setTrustedCircleMembersByGroup] = useState<
    Record<number, TrustedCircleMember[]>
  >({});
  const [trustedCircleLoading, setTrustedCircleLoading] = useState(false);
  const [trustedCircleBusy, setTrustedCircleBusy] = useState(false);
  const [trustedCircleError, setTrustedCircleError] = useState<string | null>(null);
  const [trustedFriendPicker, setTrustedFriendPicker] = useState("");
  const [trustedCircleName, setTrustedCircleName] = useState("");
  const [trustedCircleRename, setTrustedCircleRename] = useState("");
  const [trustedCircleRenaming, setTrustedCircleRenaming] = useState(false);
  const [trustedCircleSaving, setTrustedCircleSaving] = useState(false);
  const [trustedCircleSuccess, setTrustedCircleSuccess] = useState<string | null>(
    null
  );
  const [trustedCircleMenuOpen, setTrustedCircleMenuOpen] = useState(false);
  const [trustedCircleEditing, setTrustedCircleEditing] = useState(false);
  const [pendingTrustedAddIds, setPendingTrustedAddIds] = useState<number[]>([]);
  const [pendingTrustedRemoveIds, setPendingTrustedRemoveIds] = useState<
    Array<string | number>
  >([]);
  const [trustedCircleDeleteOpen, setTrustedCircleDeleteOpen] = useState(false);
  const [trustedCircleDeleteTarget, setTrustedCircleDeleteTarget] =
    useState<TrustedCircle | null>(null);
  const trustedCircleLoadRef = useRef<number | null>(null);
  const trustedCircleSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const [postComments, setPostComments] = useState<Record<string, CommentItem[]>>({});
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [commentEdits, setCommentEdits] = useState<Record<string, string>>({});
  const [commentMediaFiles, setCommentMediaFiles] = useState<Record<string, File[]>>({});
  const [commentMediaPreviews, setCommentMediaPreviews] = useState<
    Record<string, string[]>
  >({});
  const commentPreviewRef = useRef<Record<string, string[]>>({});
  const [editingComments, setEditingComments] = useState<Record<string, boolean>>({});
  const [commentMenuOpen, setCommentMenuOpen] = useState<Record<string, boolean>>({});
  const [openCommentsFor, setOpenCommentsFor] = useState<Record<string, boolean>>({});
  const [shareMenuFor, setShareMenuFor] = useState<string | null>(null);
  const [postMenuFor, setPostMenuFor] = useState<string | null>(null);
  const [visibilityModalPost, setVisibilityModalPost] = useState<MediaPost | null>(
    null
  );
  const [editPostModalPost, setEditPostModalPost] = useState<MediaPost | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostText, setEditPostText] = useState("");
  const [postEditing, setPostEditing] = useState<Record<string, boolean>>({});
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
  const [privacyEdits, setPrivacyEdits] = useState<PrivacyEditState>({
    profile: false,
    fields: false,
    activity: false,
    reminders: false,
    news: false,
    preview: false,
  });
  const dashboardNewsEnabled = profile.notificationSettings.newsEnabled !== false;

  useEffect(() => {
    setGoalReminder(loadGoalsState(goalsStorageKey).reminder);
  }, [goalsStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSync = () => setGoalReminder(loadGoalsState(goalsStorageKey).reminder);
    window.addEventListener("ysp-goals-updated", handleSync);
    return () => window.removeEventListener("ysp-goals-updated", handleSync);
  }, [goalsStorageKey]);

  useEffect(() => {
    commentPreviewRef.current = commentMediaPreviews;
  }, [commentMediaPreviews]);

  useEffect(() => {
    return () => {
      if (typeof URL === "undefined") return;
      Object.values(commentPreviewRef.current)
        .flat()
        .forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sectionParam = searchParams.get("section");
    const viewParam = searchParams.get("view");
    if (viewParam === "settings") {
      setSettingsView("settings");
      setProfileView("overview");
    } else if (viewParam === "content") {
      setSettingsView("profile");
      setProfileView("content");
    } else {
      setSettingsView("profile");
      setProfileView("overview");
    }
    if (isSettingsSection(sectionParam)) {
      setSettingsSection(sectionParam);
      setSettingsView("settings");
      setProfileView("overview");
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, [searchParams]);
  useEffect(() => {
    return () => {
      if (trustedCircleSuccessTimeoutRef.current) {
        window.clearTimeout(trustedCircleSuccessTimeoutRef.current);
      }
    };
  }, []);
  const [hobbyInput, setHobbyInput] = useState("");
  const [hobbyList, setHobbyList] = useState<string[]>([]);
  const [activeHobbyModal, setActiveHobbyModal] = useState<
    "onboarding" | "profile" | null
  >(null);
  const [hobbyError, setHobbyError] = useState<string | null>(null);
  const [friendOptions, setFriendOptions] = useState<FriendOption[]>([]);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);
  const [deleteAccountError, setDeleteAccountError] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deletePostTarget, setDeletePostTarget] = useState<MediaPost | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, LinkPreview | null>>({});
  const [countryOptions, setCountryOptions] = useState<LocationOption[]>([]);
  const [stateOptions, setStateOptions] = useState<LocationOption[]>([]);
  const [cityOptions, setCityOptions] = useState<LocationOption[]>([]);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [storefrontStateOptions, setStorefrontStateOptions] = useState<
    LocationOption[]
  >([]);
  const [storefrontCityOptions, setStorefrontCityOptions] = useState<LocationOption[]>(
    []
  );
  const [storefrontLocationState, setStorefrontLocationState] = useState("");
  const [storefrontLocationStateCode, setStorefrontLocationStateCode] = useState("");
  const [storefrontLocationCity, setStorefrontLocationCity] = useState("");
  const [storefrontLocationError, setStorefrontLocationError] = useState<string | null>(
    null
  );
  const [onboardingActive, setOnboardingActive] = useState(false);
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [onboardingError, setOnboardingError] = useState<string | null>(null);
  const [appearanceError, setAppearanceError] = useState<string | null>(null);
  const [appearanceUploading, setAppearanceUploading] = useState(false);
  const [appearanceCollapsed, setAppearanceCollapsed] = useState(true);
  const [storefrontSettingsSaving, setStorefrontSettingsSaving] = useState(false);
  const [storefrontSettingsError, setStorefrontSettingsError] = useState<string | null>(
    null
  );
  const [storefrontSettingsSuccess, setStorefrontSettingsSuccess] = useState<
    string | null
  >(null);
  const [profileInfoOpen, setProfileInfoOpen] = useState(false);
  const [profileView, setProfileView] = useState<"overview" | "content">("overview");
  const [contentGalleryOpen, setContentGalleryOpen] = useState(false);
  const [contentPostsOpen, setContentPostsOpen] = useState(false);
  const [trustedCirclesOpen, setTrustedCirclesOpen] = useState(false);
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
  const [securityQuestions, setSecurityQuestions] = useState([
    { question: "", answer: "" },
    { question: "", answer: "" },
    { question: "", answer: "" },
  ]);
  const [securityQuestionsSavedAt, setSecurityQuestionsSavedAt] = useState<
    string | null
  >(null);
  const [securityQuestionsLoading, setSecurityQuestionsLoading] = useState(false);
  const [securityQuestionsSaving, setSecurityQuestionsSaving] = useState(false);
  const [securityQuestionsError, setSecurityQuestionsError] = useState<string | null>(
    null
  );
  const [securityQuestionsSuccess, setSecurityQuestionsSuccess] = useState<
    string | null
  >(null);
  const [passwordResetLoading, setPasswordResetLoading] = useState(false);
  const [passwordResetError, setPasswordResetError] = useState<string | null>(null);
  const [passwordResetSuccess, setPasswordResetSuccess] = useState<string | null>(null);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>("email");
  const [twoFactorHasAuthenticator, setTwoFactorHasAuthenticator] = useState(false);
  const [twoFactorLoading, setTwoFactorLoading] = useState(false);
  const [twoFactorResetting, setTwoFactorResetting] = useState(false);
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
  const [timeLimitSaving, setTimeLimitSaving] = useState(false);
  const [timeLimitError, setTimeLimitError] = useState<string | null>(null);
  const [timeLimitSuccess, setTimeLimitSuccess] = useState<string | null>(null);
  const [accountStatus, setAccountStatus] = useState<AccountStatus | null>(null);
  const [accountStatusLoading, setAccountStatusLoading] = useState(false);
  const [accountStatusError, setAccountStatusError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportSuccess, setExportSuccess] = useState<string | null>(null);
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
  const isPostsPage = location.pathname === "/my-posts";
  const isGalleryPage = location.pathname === "/my-gallery";

  useEffect(() => {
    if (profileView !== "content" || isPostsPage || isGalleryPage) return;
    setContentGalleryOpen(false);
    setContentPostsOpen(false);
  }, [profileView, isPostsPage, isGalleryPage]);

  useEffect(() => {
    if (!isPostsPage) return;
    setSettingsView("profile");
    setProfileView("content");
    setContentGalleryOpen(false);
    setContentPostsOpen(true);
  }, [isPostsPage]);
  useEffect(() => {
    if (!isGalleryPage) return;
    setSettingsView("profile");
    setProfileView("content");
    setContentGalleryOpen(true);
    setContentPostsOpen(false);
  }, [isGalleryPage]);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    setSecurityQuestionsLoading(true);
    setSecurityQuestionsError(null);
    setSecurityQuestionsSuccess(null);
    api
      .get("/auth/security-questions")
      .then((res) => {
        if (!active) return;
        const questions = Array.isArray(res.data?.questions)
          ? res.data.questions.filter(Boolean).slice(0, 3)
          : [];
        setSecurityQuestions(buildSecurityQuestionState(questions));
        setSecurityQuestionsSavedAt(res.data?.setAt || null);
      })
      .catch(() => {
        if (!active) return;
        setSecurityQuestionsError("Unable to load security questions.");
      })
      .finally(() => {
        if (!active) return;
        setSecurityQuestionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    if (mediaMoveModalItem) return;
    setMediaMoveFolderOpen(false);
    setMediaMoveFolderName("");
    setMediaMoveFolderError(null);
  }, [mediaMoveModalItem]);
  const mediaFileIsVideo = mediaFile ? isVideoFile(mediaFile) : false;

  const handleMediaFileSelection = (file: File | null) => {
    if (!file) {
      setMediaFile(null);
      return;
    }
    const isVideo = isVideoFile(file);
    const isImage = isImageFile(file);
    if (!isVideo && !isImage) {
      setProfileMediaError("Upload an image or video file.");
      setMediaFile(null);
      return;
    }
    const maxBytes = isVideo ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
    const maxLabel = isVideo ? MAX_VIDEO_UPLOAD_LABEL : MAX_UPLOAD_LABEL;
    if (file.size > maxBytes) {
      setProfileMediaError(`Media files must be under ${maxLabel}.`);
      setMediaFile(null);
      return;
    }
    setMediaFile(file);
    setProfileMediaError(null);
  };

  useEffect(() => {
    mediaFoldersLoadedRef.current = false;
    if (!mediaFolderStorageKey || typeof window === "undefined") {
      setMediaFolders([]);
      mediaFoldersLoadedRef.current = true;
      return;
    }
    const raw = window.localStorage.getItem(mediaFolderStorageKey);
    if (!raw) {
      setMediaFolders([]);
      mediaFoldersLoadedRef.current = true;
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setMediaFolders(sanitizeFolderList(parsed.map(String)));
      } else {
        setMediaFolders([]);
      }
    } catch {
      setMediaFolders([]);
    } finally {
      mediaFoldersLoadedRef.current = true;
    }
  }, [mediaFolderStorageKey]);

  useEffect(() => {
    if (!mediaFolderStorageKey || typeof window === "undefined") return;
    if (!mediaFoldersLoadedRef.current) return;
    window.localStorage.setItem(mediaFolderStorageKey, JSON.stringify(mediaFolders));
  }, [mediaFolderStorageKey, mediaFolders]);

  const mediaFolderOptions = useMemo(() => {
    const values = new Set<string>();
    sanitizeFolderList(mediaFolders).forEach((folder) => values.add(folder));
    profileMedia.forEach((item) => {
      const folder = normalizeFolderName(item.folder);
      if (folder && !isReservedMediaFolder(folder)) values.add(folder);
    });
    const activeFolder = normalizeFolderName(mediaFolderFilter);
    if (activeFolder && !isReservedMediaFolder(activeFolder)) {
      values.add(activeFolder);
    }
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [mediaFolderFilter, mediaFolders, profileMedia]);

  const mediaFolderCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let total = 0;
    let unsorted = 0;
    profileMedia.forEach((item) => {
      if (mediaTab !== "all") {
        const kind =
          item.kind || (item.media && isVideoUrl(item.media) ? "video" : "photo");
        if (kind !== mediaTab) return;
      }
      total += 1;
      const folder = normalizeFolderName(item.folder);
      if (folder) {
        counts.set(folder, (counts.get(folder) || 0) + 1);
      } else {
        unsorted += 1;
      }
    });
    return { counts, total, unsorted };
  }, [mediaTab, profileMedia]);

  const handleCreateMediaFolder = () => {
    const nextFolder = normalizeFolderName(mediaNewFolderName);
    if (!nextFolder) {
      setMediaFolderError("Enter a folder name.");
      return;
    }
    if (isReservedMediaFolder(nextFolder)) {
      setMediaFolderError("Choose a different folder name.");
      return;
    }
    const existing = mediaFolderOptions.find(
      (folder) => folder.toLowerCase() === nextFolder.toLowerCase()
    );
    if (!existing) {
      setMediaFolders((prev) =>
        prev.some((folder) => folder.toLowerCase() === nextFolder.toLowerCase())
          ? prev
          : [...prev, nextFolder]
      );
    }
    setMediaFolderFilter(existing || nextFolder);
    setMediaNewFolderName("");
    setMediaNewFolderOpen(false);
    setMediaFolderError(null);
  };

  const cancelMediaFolderCreate = () => {
    setMediaNewFolderName("");
    setMediaNewFolderOpen(false);
    setMediaFolderError(null);
  };

  const closeMediaMoveModal = () => {
    setMediaMoveModalItem(null);
    setMediaMoveFolderOpen(false);
    setMediaMoveFolderName("");
    setMediaMoveFolderError(null);
  };

  const cancelMediaMoveFolderCreate = () => {
    setMediaMoveFolderName("");
    setMediaMoveFolderOpen(false);
    setMediaMoveFolderError(null);
  };

  const handleMoveToNewFolder = () => {
    if (!mediaMoveModalItem) return;
    const nextFolder = normalizeFolderName(mediaMoveFolderName);
    if (!nextFolder) {
      setMediaMoveFolderError("Enter a folder name.");
      return;
    }
    if (isReservedMediaFolder(nextFolder)) {
      setMediaMoveFolderError("Choose a different folder name.");
      return;
    }
    const existing = mediaFolderOptions.find(
      (folder) => folder.toLowerCase() === nextFolder.toLowerCase()
    );
    if (!existing) {
      setMediaFolders((prev) =>
        prev.some((folder) => folder.toLowerCase() === nextFolder.toLowerCase())
          ? prev
          : [...prev, nextFolder]
      );
    }
    const targetFolder = existing || nextFolder;
    setMediaFolderFilter(targetFolder);
    const item = mediaMoveModalItem;
    closeMediaMoveModal();
    void updateMediaFolder(item, targetFolder);
  };

  const handleMediaDragStart = (
    event: DragEvent<HTMLElement>,
    item: ProfileMediaItem
  ) => {
    if (!item.id) return;
    const key = String(item.id);
    event.dataTransfer.setData("text/plain", key);
    event.dataTransfer.setData("application/x-ysp-media-id", key);
    event.dataTransfer.effectAllowed = "move";
    setMediaDraggingId(key);
  };

  const handleMediaDragEnd = () => {
    setMediaDraggingId(null);
    setMediaDragOverFolder(null);
    setMediaDragOverId(null);
  };

  const handleFolderDragOver = (
    event: DragEvent<HTMLElement>,
    folderKey: string
  ) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setMediaDragOverFolder(folderKey);
    setMediaDragOverId(null);
  };

  const handleFolderDragLeave = (folderKey: string) => {
    setMediaDragOverFolder((prev) => (prev === folderKey ? null : prev));
  };

  const handleFolderDrop = async (
    event: DragEvent<HTMLElement>,
    folderKey: string
  ) => {
    event.preventDefault();
    setMediaDragOverFolder(null);
    setMediaDragOverId(null);
    const draggedId =
      event.dataTransfer.getData("application/x-ysp-media-id") ||
      event.dataTransfer.getData("text/plain");
    if (!draggedId) return;
    const item = profileMedia.find(
      (entry) =>
        String(entry.id) === draggedId ||
        (entry.documentId && String(entry.documentId) === draggedId)
    );
    if (!item) return;
    const nextFolder =
      folderKey === MEDIA_FOLDER_UNSORTED ? null : normalizeFolderName(folderKey);
    await updateMediaFolder(item, nextFolder);
  };

  const handleMediaCardDragOver = (
    event: DragEvent<HTMLElement>,
    targetId: string
  ) => {
    if (!mediaDraggingId || mediaDraggingId === targetId) return;
    const sourceItem = profileMedia.find(
      (item) =>
        String(item.id) === mediaDraggingId ||
        (item.documentId && String(item.documentId) === mediaDraggingId)
    );
    const targetItem = profileMedia.find(
      (item) =>
        String(item.id) === targetId ||
        (item.documentId && String(item.documentId) === targetId)
    );
    if (!sourceItem || !targetItem) return;
    const sourceFolder = normalizeFolderName(sourceItem.folder);
    const targetFolder = normalizeFolderName(targetItem.folder);
    if (sourceFolder !== targetFolder) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setMediaDragOverFolder(null);
    setMediaDragOverId(targetId);
  };

  const handleMediaCardDragLeave = (targetId: string) => {
    setMediaDragOverId((prev) => (prev === targetId ? null : prev));
  };

  const handleMediaCardDrop = async (
    event: DragEvent<HTMLElement>,
    targetId: string
  ) => {
    event.preventDefault();
    const draggedId =
      event.dataTransfer.getData("application/x-ysp-media-id") ||
      event.dataTransfer.getData("text/plain");
    setMediaDragOverId(null);
    if (!draggedId || draggedId === targetId) return;
    const sourceItem = profileMedia.find(
      (item) =>
        String(item.id) === draggedId ||
        (item.documentId && String(item.documentId) === draggedId)
    );
    const targetItem = profileMedia.find(
      (item) =>
        String(item.id) === targetId ||
        (item.documentId && String(item.documentId) === targetId)
    );
    if (!sourceItem || !targetItem) return;
    const sourceFolder = normalizeFolderName(sourceItem.folder);
    const targetFolder = normalizeFolderName(targetItem.folder);
    if (sourceFolder !== targetFolder) return;
    await reorderMediaItems(draggedId, targetId);
  };

  const filteredMedia = useMemo(() => {
    let items = profileMedia;
    if (mediaTab !== "all") {
      items = items.filter((item) => {
        const kind = item.kind || (item.media && isVideoUrl(item.media) ? "video" : "photo");
        return kind === mediaTab;
      });
    }
    if (
      mediaFolderFilter !== MEDIA_FOLDER_ALL &&
      mediaFolderFilter !== MEDIA_FOLDER_UNSORTED
    ) {
      items = items.filter((item) => {
        const folder = normalizeFolderName(item.folder);
        return folder === mediaFolderFilter;
      });
    }
    const sorted = [...items].sort((a, b) => {
      if (mediaFolderFilter !== MEDIA_FOLDER_ALL) {
        const orderA = parseMediaOrder(a.order);
        const orderB = parseMediaOrder(b.order);
        if (orderA !== null && orderB !== null && orderA !== orderB) {
          return orderA - orderB;
        }
        if (orderA !== null && orderB === null) return -1;
        if (orderA === null && orderB !== null) return 1;
      }
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (timeA !== timeB) return timeB - timeA;
      return String(a.id).localeCompare(String(b.id));
    });
    return sorted;
  }, [mediaTab, mediaFolderFilter, profileMedia]);

  useEffect(() => {
    setMediaPage(1);
  }, [mediaTab, mediaFolderFilter]);

  useEffect(() => {
    if (mediaFolderFilter === MEDIA_FOLDER_UNSORTED) {
      setMediaFolderFilter(MEDIA_FOLDER_ALL);
    }
  }, [mediaFolderFilter]);

  const mediaPaging = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filteredMedia.length / MEDIA_PAGE_SIZE));
    const page = Math.min(Math.max(mediaPage, 1), totalPages);
    const startIndex = (page - 1) * MEDIA_PAGE_SIZE;
    return {
      page,
      totalPages,
      startIndex,
      items: filteredMedia.slice(startIndex, startIndex + MEDIA_PAGE_SIZE),
    };
  }, [filteredMedia, mediaPage]);

  useEffect(() => {
    if (mediaPage > mediaPaging.totalPages) {
      setMediaPage(mediaPaging.totalPages);
    }
  }, [mediaPage, mediaPaging.totalPages]);
  const activeMediaItem = mediaLightboxOpen
    ? mediaLightboxItems[mediaLightboxIndex]
    : null;

  const openMediaLightboxAt = (index: number) => {
    if (!filteredMedia.length) return;
    setMediaLightboxItems(filteredMedia);
    setMediaLightboxIndex(index);
    setMediaLightboxOpen(true);
  };

  const closeMediaLightbox = () => {
    setMediaLightboxOpen(false);
  };

  useEffect(() => {
    if (!mediaLightboxOpen) return;
    if (mediaLightboxItems.length === 0) return;
    if (mediaLightboxIndex >= mediaLightboxItems.length) {
      setMediaLightboxIndex(0);
    }
  }, [mediaLightboxIndex, mediaLightboxItems.length, mediaLightboxOpen]);

  useEffect(() => {
    if (!mediaLightboxOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMediaLightboxOpen(false);
        return;
      }
      if (mediaLightboxItems.length < 2) return;
      if (event.key === "ArrowRight") {
        setMediaLightboxIndex((prev) =>
          (prev + 1) % mediaLightboxItems.length
        );
      }
      if (event.key === "ArrowLeft") {
        setMediaLightboxIndex((prev) =>
          (prev - 1 + mediaLightboxItems.length) % mediaLightboxItems.length
        );
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mediaLightboxItems.length, mediaLightboxOpen]);

  useEffect(() => {
    if (!mediaLightboxOpen || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mediaLightboxOpen]);

  useEffect(() => {
    if (!mediaFile) {
      setMediaFilePreview(null);
      return;
    }
    const objectUrl = URL.createObjectURL(mediaFile);
    setMediaFilePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [mediaFile]);

  useEffect(() => {
    if (mediaVisibility !== "trusted") {
      setMediaTrustedCircleId("");
    }
  }, [mediaVisibility]);
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

  const ageVerificationDueAt =
    user?.ageVerificationDueAt ?? accountStatus?.ageVerificationDueAt ?? null;
  const ageVerificationOverdue =
    user?.ageVerificationOverdue ?? accountStatus?.ageVerificationOverdue ?? false;
  const ageVerificationDaysRemaining =
    user?.ageVerificationDaysRemaining ??
    accountStatus?.ageVerificationDaysRemaining ??
    (ageVerificationDueAt
      ? Math.max(
          0,
          Math.ceil((new Date(ageVerificationDueAt).getTime() - Date.now()) / 86400000)
        )
      : null);
  const ageVerified =
    user?.ageVerified === true || accountStatus?.ageVerified === true;

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
  const getEntryId = (entry: any, attrs?: any) =>
    entry?.id ?? attrs?.documentId ?? entry?.documentId ?? attrs?.id;
  const getEntityLabel = (entry: any, fallback: string) => {
    const attrs = normalize(getEntity(entry));
    const firstName = String(attrs?.firstName || attrs?.firstname || "").trim();
    const lastName = String(attrs?.lastName || attrs?.lastname || "").trim();
    const fullName = `${firstName} ${lastName}`.trim();
    const handle = String(attrs?.handle || attrs?.username || "").trim();
    return fullName || handle || attrs?.email || fallback;
  };
  const getErrorMessage = (err: unknown, fallback: string) => {
    if (axios.isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { message?: string }; message?: string }
        | undefined;
      return data?.error?.message || data?.message || fallback;
    }
    return fallback;
  };
  const pushTrustedCircleSuccess = (message: string) => {
    setTrustedCircleSuccess(message);
    if (trustedCircleSuccessTimeoutRef.current) {
      window.clearTimeout(trustedCircleSuccessTimeoutRef.current);
    }
    trustedCircleSuccessTimeoutRef.current = window.setTimeout(() => {
      setTrustedCircleSuccess(null);
    }, 3000);
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
      const rawId = entry?.id ?? attrs?.id;
      const numericId = Number(rawId);
      const documentId = attrs?.documentId ?? entry?.documentId;
      const commentId = rawId ?? documentId ?? String(targetId);
      const body = String(attrs.body ?? entry?.body ?? "").trim();
      const createdAt = String(attrs.createdAt ?? entry?.createdAt ?? "");
      if (!body) return;
      (next[key] = next[key] || []).push({
        id: commentId,
        numericId: Number.isFinite(numericId) ? numericId : undefined,
        documentId,
        body,
        owner: ownerLabel,
        ownerId,
        createdAt: createdAt || undefined,
      });
    });
    return next;
  };
  const activeTrustedCircle = useMemo(() => {
    if (!trustedCircles.length) return null;
    if (activeTrustedCircleId) {
      return trustedCircles.find((circle) => circle.id === activeTrustedCircleId) ?? null;
    }
    return trustedCircles[0];
  }, [activeTrustedCircleId, trustedCircles]);

  useEffect(() => {
    if (!activeTrustedCircle) {
      setTrustedCircleRename("");
      return;
    }
    setTrustedCircleRename(activeTrustedCircle.name);
  }, [activeTrustedCircle]);

  useEffect(() => {
    setTrustedCircleMenuOpen(false);
    setTrustedCircleEditing(false);
    setPendingTrustedAddIds([]);
    setPendingTrustedRemoveIds([]);
  }, [activeTrustedCircle?.id]);

  const trustedCircleMembers = useMemo(() => {
    if (!activeTrustedCircle?.id) return [];
    return trustedCircleMembersByGroup[activeTrustedCircle.id] ?? [];
  }, [activeTrustedCircle, trustedCircleMembersByGroup]);

  const trustedMemberIds = useMemo(
    () => new Set(trustedCircleMembers.map((member) => member.userId)),
    [trustedCircleMembers]
  );
  const pendingTrustedRemoveSet = useMemo(
    () => new Set(pendingTrustedRemoveIds),
    [pendingTrustedRemoveIds]
  );
  const canEditTrustedCircle =
    trustedCircleEditing || trustedCircleMembers.length === 0;

  const trustedFriendOptions = useMemo(
    () =>
      [...friendOptions].sort((a, b) => a.label.localeCompare(b.label)),
    [friendOptions]
  );

  const pendingTrustedAddOptions = useMemo(() => {
    if (!pendingTrustedAddIds.length) return [];
    return trustedFriendOptions.filter(
      (friend) =>
        pendingTrustedAddIds.includes(friend.id) &&
        !trustedMemberIds.has(friend.id)
    );
  }, [pendingTrustedAddIds, trustedFriendOptions, trustedMemberIds]);

  const hasPendingTrustedChanges = useMemo(
    () =>
      pendingTrustedAddIds.some((id) => !trustedMemberIds.has(id)) ||
      pendingTrustedRemoveIds.length > 0,
    [pendingTrustedAddIds, pendingTrustedRemoveIds, trustedMemberIds]
  );

  const trustedCircleFriendRows = useMemo(
    () =>
      trustedCircleMembers
        .filter((member) => member.userId !== user?.id)
        .map((member) => {
          const friend = trustedFriendOptions.find(
            (option) => option.id === member.userId
          );
          return {
            member,
            label: friend?.label || `User ${member.userId}`,
            avatarUrl: friend?.avatarUrl,
          };
        }),
    [trustedCircleMembers, trustedFriendOptions, user?.id]
  );
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
  const updatePostReactions = (
    postKey: string,
    reactionCounts: ReactionCounts,
    myReaction: string | null
  ) => {
    setPosts((prev) =>
      prev.map((post) =>
        String(post.id) === postKey ? { ...post, reactionCounts, myReaction } : post
      )
    );
  };
  const updatePostVisibility = async (post: MediaPost, nextVisibility: string) => {
    const visibility = String(nextVisibility || "").trim();
    if (!visibility) return;
    const payload: Record<string, unknown> = { visibility };
    if (visibility === "trusted") {
      const groupId = post.trustedCircleId ?? trustedCircleOptions[0]?.id;
      if (!groupId) {
        setError("Select a trusted circle before saving.");
        return;
      }
      payload.trustedCircle = groupId;
    } else {
      payload.trustedCircle = null;
    }
    const attempts: string[] = [];
    if (post.documentId) attempts.push(`/users-posts/${post.documentId}`);
    const idNumber = typeof post.id === "number" ? post.id : Number(post.id);
    if (Number.isFinite(idNumber)) attempts.push(`/users-posts/${idNumber}`);
    attempts.push(`/users-posts/${post.id}`);

    for (const url of attempts) {
      try {
        await api.put(url, { data: payload });
        setPosts((prev) =>
          prev.map((entry) =>
            String(entry.id) === String(post.id)
              ? {
                  ...entry,
                  visibility,
                  trustedCircleId:
                    visibility === "trusted"
                      ? (payload.trustedCircle as number)
                      : undefined,
                  trustedCircleName:
                    visibility === "trusted"
                      ? trustedCircleOptions.find(
                          (group) => group.id === payload.trustedCircle
                        )?.name
                      : undefined,
                }
              : entry
          )
        );
        setError(null);
        return;
      } catch (err) {
        if (url === attempts[attempts.length - 1]) {
          console.error("Update post visibility failed", err);
        }
      }
    }
    setError("Failed to update post visibility.");
  };
  const buildShareUrl = (postKey: string) => {
    if (typeof window === "undefined") return "";
    const fallbackOrigin = String(import.meta.env.VITE_PUBLIC_SITE_URL || "").trim();
    const origin = window.location.origin;
    const base = origin.startsWith("http") ? origin : fallbackOrigin;
    if (!base) return "";
    const path = window.location.pathname?.startsWith("/")
      ? window.location.pathname
      : "/dashboard";
    return `${base}${path}#post-${postKey}`;
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
  const updateCommentBody = async (
    comment: CommentItem,
    postKey: string,
    nextBody: string
  ) => {
    const trimmed = nextBody.trim();
    if (!trimmed) {
      setError("Comment cannot be empty.");
      return false;
    }
    setError(null);
    const numericId =
      comment.numericId ?? (typeof comment.id === "number" ? comment.id : Number(comment.id));
    const attempts: string[] = [];
    if (comment.documentId) {
      attempts.push(`/comments/${comment.documentId}`);
    }
    if (Number.isFinite(numericId)) {
      attempts.push(`/comments/${numericId}`);
    }
    attempts.push(`/comments/${comment.id}`);

    let updated = false;
    for (const path of attempts) {
      try {
        await api.put(path, { data: { body: trimmed } });
        updated = true;
        break;
      } catch (err: unknown) {
        if (axios.isAxiosError(err) && err.response?.status === 404) {
          continue;
        }
        throw err;
      }
    }

    if (!updated) {
      setError("Failed to update comment.");
      return false;
    }

    const matchIds = new Set<string>();
    matchIds.add(String(comment.id));
    if (comment.documentId) {
      matchIds.add(String(comment.documentId));
    }
    if (Number.isFinite(numericId)) {
      matchIds.add(String(numericId));
    }

    setPostComments((prev) => {
      const list = prev[postKey] ?? [];
      return {
        ...prev,
        [postKey]: list.map((entry) =>
          matchIds.has(String(entry.id)) ||
          (entry.documentId && matchIds.has(String(entry.documentId))) ||
          (entry.numericId !== undefined && matchIds.has(String(entry.numericId)))
            ? { ...entry, body: trimmed }
            : entry
        ),
      };
    });
    setSuccess("Comment updated.");
    window.setTimeout(() => setSuccess(null), 2600);
    return true;
  };
  const handleReaction = async (post: MediaPost, postKey: string, emoji: string) => {
    try {
      const res = await api.post(`/users-posts/${post.id}/react`, { emoji });
      const payload = res.data?.data;
      const payloadLikes = Number(payload?.likes);
      const nextLikes = Number.isFinite(payloadLikes)
        ? payloadLikes
        : Number(post.likes ?? 0) + 1;
      if (Number.isFinite(payloadLikes)) {
        updatePostMetric(postKey, "likes", nextLikes);
      }
      const counts = normalizeReactionCounts(payload?.reactionCounts, nextLikes);
      const reactionValue = normalizeReactionValue(payload?.myReaction ?? emoji);
      updatePostReactions(postKey, counts, reactionValue);
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
    setShareMenuFor(null);
    setPostMenuFor(null);
    setVisibilityModalPost(null);
    setEditPostModalPost(null);
  };

  const clearCommentAttachments = (commentKey: string) => {
    setCommentMediaFiles((prev) => {
      if (!(commentKey in prev)) return prev;
      const next = { ...prev };
      delete next[commentKey];
      return next;
    });
    setCommentMediaPreviews((prev) => {
      if (!(commentKey in prev)) return prev;
      const next = { ...prev };
      const urls = next[commentKey] || [];
      if (typeof URL !== "undefined") {
        urls.forEach((url) => URL.revokeObjectURL(url));
      }
      delete next[commentKey];
      return next;
    });
  };

  const handleCommentFilesChange = (commentKey: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const selected = Array.from(files).filter((file) => isImageFile(file));
    if (selected.length === 0) {
      setError("Only image files are allowed for comments.");
      return;
    }
    const limited = selected.slice(0, MAX_COMMENT_MEDIA_FILES);
    if (selected.length > MAX_COMMENT_MEDIA_FILES) {
      setError(`You can upload up to ${MAX_COMMENT_MEDIA_FILES} images per comment.`);
    }
    for (const file of limited) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`Images must be under ${MAX_UPLOAD_LABEL}.`);
        return;
      }
    }
    setCommentMediaFiles((prev) => ({ ...prev, [commentKey]: limited }));
    setCommentMediaPreviews((prev) => {
      const next = { ...prev };
      const urls = next[commentKey] || [];
      if (typeof URL !== "undefined") {
        urls.forEach((url) => URL.revokeObjectURL(url));
      }
      next[commentKey] = limited.map((file) => URL.createObjectURL(file));
      return next;
    });
  };

  const removeCommentAttachment = (commentKey: string, index: number) => {
    setCommentMediaFiles((prev) => {
      const current = prev[commentKey];
      if (!current) return prev;
      const nextFiles = current.filter((_, idx) => idx !== index);
      const next = { ...prev };
      if (nextFiles.length) {
        next[commentKey] = nextFiles;
      } else {
        delete next[commentKey];
      }
      return next;
    });
    setCommentMediaPreviews((prev) => {
      const current = prev[commentKey];
      if (!current) return prev;
      const nextUrls = current.filter((_, idx) => idx !== index);
      if (typeof URL !== "undefined" && current[index]) {
        URL.revokeObjectURL(current[index]);
      }
      const next = { ...prev };
      if (nextUrls.length) {
        next[commentKey] = nextUrls;
      } else {
        delete next[commentKey];
      }
      return next;
    });
  };
  const toggleShareMenu = (postKey: string) => {
    setShareMenuFor((prev) => (prev === postKey ? null : postKey));
    setPostMenuFor(null);
    setVisibilityModalPost(null);
    setEditPostModalPost(null);
  };
  const togglePostMenu = (postKey: string) => {
    setPostMenuFor((prev) => (prev === postKey ? null : postKey));
    setShareMenuFor(null);
    setVisibilityModalPost(null);
    setEditPostModalPost(null);
  };
  const toggleMediaMenu = (mediaKey: string) => {
    setMediaMenuFor((prev) => (prev === mediaKey ? null : mediaKey));
    setPostMenuFor(null);
    setShareMenuFor(null);
  };

  const cancelPostEdit = () => {
    setEditingPostId(null);
    setEditPostText("");
  };

  const cancelMediaEdit = () => {
    setEditingMediaId(null);
    setMediaEditTitle("");
    setMediaEditCaption("");
    setMediaEditFolder("");
  };

  const savePostEdit = async (post: MediaPost) => {
    if (!user) {
      setError("Please log in to edit posts.");
      return;
    }
    const postKey = String(post.id);
    const nextText = sanitizePostText(editPostText).trim();
    if (!nextText) {
      setError("Add a message to update your post.");
      return;
    }
    if (nextText === post.text) {
      cancelPostEdit();
      return;
    }
    setPostEditing((prev) => ({ ...prev, [postKey]: true }));
    setError(null);
    try {
      const attempts: string[] = [];
      const idNumber = typeof post.id === "number" ? post.id : Number(post.id);
      const docId = post.documentId ?? (typeof post.id === "string" ? post.id : null);
      if (docId) attempts.push(`/users-posts/${docId}`);
      if (Number.isFinite(idNumber)) attempts.push(`/users-posts/${idNumber}`);
      const uniqueAttempts = Array.from(new Set(attempts));

      let updated = false;
      for (const path of uniqueAttempts) {
        try {
          await api.put(path, { data: { Users_Content: nextText } });
          updated = true;
          break;
        } catch (err: unknown) {
          if (axios.isAxiosError(err) && err.response?.status === 404) {
            continue;
          }
          throw err;
        }
      }

      if (!updated) {
        setError("Failed to update post.");
        return;
      }

      setPosts((prev) =>
        prev.map((entry) =>
          String(entry.id) === postKey ? { ...entry, text: nextText } : entry
        )
      );
      cancelPostEdit();
    } catch (err: unknown) {
      const msg = axios.isAxiosError(err)
        ? err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Failed to update post."
        : "Failed to update post.";
      setError(String(msg));
    } finally {
      setPostEditing((prev) => ({ ...prev, [postKey]: false }));
    }
  };

  const saveMediaEdit = async (item: ProfileMediaItem) => {
    if (!item.id) return;
    const nextTitle = mediaEditTitle.trim();
    const nextCaption = mediaEditCaption.trim();
    const nextFolder = normalizeFolderName(mediaEditFolder);
    if (nextFolder && isReservedMediaFolder(nextFolder)) {
      setProfileMediaError("Choose a different folder name.");
      return;
    }
    const currentTitle = String(item.title || "").trim();
    const currentCaption = String(item.caption || "").trim();
    const currentFolder = normalizeFolderName(item.folder);
    if (
      nextTitle === currentTitle &&
      nextCaption === currentCaption &&
      nextFolder === currentFolder
    ) {
      cancelMediaEdit();
      return;
    }
    setMediaEditSaving(true);
    setProfileMediaError(null);
    const payload = {
      title: nextTitle || null,
      caption: nextCaption || null,
      folder: nextFolder || null,
    };
    try {
      const attempts: string[] = [];
      if (item.documentId) attempts.push(`/profile-media-items/${item.documentId}`);
      const numericId = typeof item.id === "number" ? item.id : Number(item.id);
      if (Number.isFinite(numericId)) attempts.push(`/profile-media-items/${numericId}`);
      attempts.push(`/profile-media-items/${item.id}`);

      let updated = false;
      for (const path of attempts) {
        try {
          await api.put(path, { data: payload });
          updated = true;
          break;
        } catch (err: any) {
          if (err?.response?.status === 404) continue;
          throw err;
        }
      }

      if (!updated) {
        setProfileMediaError("Unable to update media details.");
        return;
      }

      setProfileMedia((prev) =>
        prev.map((entry) =>
          String(entry.id) === String(item.id) ||
          (item.documentId && String(entry.documentId) === String(item.documentId))
            ? {
                ...entry,
                title: nextTitle || undefined,
                caption: nextCaption || undefined,
                folder: nextFolder || undefined,
              }
            : entry
        )
      );
      if (nextFolder) {
        setMediaFolders((prev) =>
          prev.some((folder) => folder.toLowerCase() === nextFolder.toLowerCase())
            ? prev
            : [...prev, nextFolder]
        );
      }
      cancelMediaEdit();
    } catch {
      setProfileMediaError("Unable to update media details.");
    } finally {
      setMediaEditSaving(false);
    }
  };

  const updateMediaFolder = async (
    item: ProfileMediaItem,
    nextFolder: string | null
  ) => {
    if (!item.id) return;
    const normalized = normalizeFolderName(nextFolder);
    const current = normalizeFolderName(item.folder);
    if (normalized === current) return;
    if (normalized && isReservedMediaFolder(normalized)) {
      setProfileMediaError("Choose a different folder name.");
      return;
    }
    setProfileMediaError(null);
    const targetFolder = normalized || "";
    const maxOrder = profileMedia.reduce((acc, entry) => {
      if (
        String(entry.id) === String(item.id) ||
        (item.documentId && String(entry.documentId) === String(item.documentId))
      ) {
        return acc;
      }
      const entryFolder = normalizeFolderName(entry.folder);
      if (entryFolder !== targetFolder) return acc;
      const entryOrder = parseMediaOrder(entry.order);
      return entryOrder !== null && entryOrder > acc ? entryOrder : acc;
    }, 0);
    const nextOrder = maxOrder + 1;
    const payload = { folder: normalized || null, order: nextOrder };
    try {
      const attempts: string[] = [];
      if (item.documentId) attempts.push(`/profile-media-items/${item.documentId}`);
      const numericId = typeof item.id === "number" ? item.id : Number(item.id);
      if (Number.isFinite(numericId)) attempts.push(`/profile-media-items/${numericId}`);
      attempts.push(`/profile-media-items/${item.id}`);

      let updated = false;
      for (const path of attempts) {
        try {
          await api.put(path, { data: payload });
          updated = true;
          break;
        } catch (err: any) {
          if (err?.response?.status === 404) continue;
          throw err;
        }
      }

      if (!updated) {
        setProfileMediaError("Unable to move media item.");
        return;
      }

      setProfileMedia((prev) => {
        const targetFolder = normalized || "";
        const maxOrder = prev.reduce((acc, entry) => {
          if (
            String(entry.id) === String(item.id) ||
            (item.documentId && String(entry.documentId) === String(item.documentId))
          ) {
            return acc;
          }
          const entryFolder = normalizeFolderName(entry.folder);
          if (entryFolder !== targetFolder) return acc;
          const entryOrder = parseMediaOrder(entry.order);
          return entryOrder !== null && entryOrder > acc ? entryOrder : acc;
        }, 0);
        const nextOrder = maxOrder + 1;
        return prev.map((entry) =>
          String(entry.id) === String(item.id) ||
          (item.documentId && String(entry.documentId) === String(item.documentId))
            ? { ...entry, folder: normalized || undefined, order: nextOrder }
            : entry
        );
      });
      if (normalized) {
        setMediaFolders((prev) =>
          prev.some((folder) => folder.toLowerCase() === normalized.toLowerCase())
            ? prev
            : [...prev, normalized]
        );
      }
    } catch {
      setProfileMediaError("Unable to move media item.");
    }
  };

  const updateMediaOrder = async (item: ProfileMediaItem, order: number) => {
    if (!item.id) return;
    const nextOrder = Number.isFinite(order) ? Math.max(0, Math.floor(order)) : null;
    if (nextOrder === null) return;
    const payload = { order: nextOrder };
    try {
      const attempts: string[] = [];
      if (item.documentId) attempts.push(`/profile-media-items/${item.documentId}`);
      const numericId = typeof item.id === "number" ? item.id : Number(item.id);
      if (Number.isFinite(numericId)) attempts.push(`/profile-media-items/${numericId}`);
      attempts.push(`/profile-media-items/${item.id}`);

      for (const path of attempts) {
        try {
          await api.put(path, { data: payload });
          return;
        } catch (err: any) {
          if (err?.response?.status === 404) continue;
          throw err;
        }
      }
    } catch {
      throw new Error("Unable to reorder media.");
    }
  };

  const reorderMediaItems = async (sourceId: string, targetId: string) => {
    const sourceItem = profileMedia.find(
      (item) =>
        String(item.id) === sourceId ||
        (item.documentId && String(item.documentId) === sourceId)
    );
    const targetItem = profileMedia.find(
      (item) =>
        String(item.id) === targetId ||
        (item.documentId && String(item.documentId) === targetId)
    );
    if (!sourceItem || !targetItem) return;
    const sourceFolder = normalizeFolderName(sourceItem.folder);
    const targetFolder = normalizeFolderName(targetItem.folder);
    if (sourceFolder !== targetFolder) return;

    const scopedItems = filteredMedia.filter(
      (item) => normalizeFolderName(item.folder) === sourceFolder
    );
    const sourceIndex = scopedItems.findIndex((item) => String(item.id) === sourceId);
    const targetIndex = scopedItems.findIndex((item) => String(item.id) === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextFiltered = [...scopedItems];
    const [moved] = nextFiltered.splice(sourceIndex, 1);
    nextFiltered.splice(targetIndex, 0, moved);

    const orderMap = new Map<string, number>();
    nextFiltered.forEach((item, index) => {
      orderMap.set(String(item.id), index + 1);
    });

    const changed: ProfileMediaItem[] = [];
    const nextProfileMedia = profileMedia.map((item) => {
      const key = String(item.id);
      if (!orderMap.has(key)) return item;
      const nextOrder = orderMap.get(key) ?? item.order;
      if (item.order === nextOrder) return item;
      const updated = { ...item, order: nextOrder };
      changed.push(updated);
      return updated;
    });

    if (!changed.length) return;
    setProfileMedia(nextProfileMedia);

    try {
      for (const item of changed) {
        await updateMediaOrder(item, item.order || 0);
      }
    } catch {
      setProfileMedia(profileMedia);
      setProfileMediaError("Unable to reorder media.");
    }
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(".post-action-group") ||
        target.closest(".post-menu-wrapper")
      )
        return;
      setShareMenuFor(null);
      setPostMenuFor(null);
      setMediaMenuFor(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);
  const currentBackground = preferences.backgrounds.dashboard;
  const appearanceColor = currentBackground.color || "#0b0d14";
  const appearanceColorOpacity =
    typeof currentBackground.colorOpacity === "number" &&
    Number.isFinite(currentBackground.colorOpacity)
      ? currentBackground.colorOpacity
      : 1;
  const appearanceGradientStart = currentBackground.gradientStart || "#2563eb";
  const appearanceGradientEnd = currentBackground.gradientEnd || "#22d3ee";
  const appearanceGradientAngle =
    typeof currentBackground.gradientAngle === "number" &&
    Number.isFinite(currentBackground.gradientAngle)
      ? currentBackground.gradientAngle
      : 135;
  const appearanceGradientOpacity =
    typeof currentBackground.gradientOpacity === "number" &&
    Number.isFinite(currentBackground.gradientOpacity)
      ? currentBackground.gradientOpacity
      : 0.75;
  const appearanceGradientEnabled = Boolean(
    currentBackground.gradientStart || currentBackground.gradientEnd
  );

  const handleBackgroundColor = (value: string) => {
    setAppearanceError(null);
    setBackgroundAll({ color: value });
  };

  const handleBackgroundColorOpacity = (value: number) => {
    const next = Math.min(1, Math.max(0, value));
    const nextColor = currentBackground.color || "#0b0d14";
    setBackgroundAll({ colorOpacity: next, color: nextColor });
  };

  const toggleGradient = (enabled: boolean) => {
    if (enabled) {
      setBackgroundAll({
        gradientStart: appearanceGradientStart || "#2563eb",
        gradientEnd: appearanceGradientEnd || "#22d3ee",
        gradientAngle: Number.isFinite(appearanceGradientAngle)
          ? appearanceGradientAngle
          : 135,
      });
      return;
    }
    setBackgroundAll({
      gradientStart: "",
      gradientEnd: "",
      gradientAngle: 135,
    });
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
      const uploadRes = await api.post("/upload", fd);
      const uploaded = uploadRes.data?.[0];
      const uploadId = Number(uploaded?.id);
      let url = pickMediaUrl(uploaded, { kind: "cover" });
      if (Number.isFinite(uploadId)) {
        try {
          const refreshed = await api.get(`/upload/files/${uploadId}`);
          url = pickMediaUrl(refreshed.data, { kind: "cover" }) || url;
        } catch {
          // Keep initial URL if refresh lookup fails.
        }
      }
      if (!url) {
        setAppearanceError("Upload failed. Please try again.");
        return;
      }
      setBackgroundAll({ image: url });
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
        ageVerified: data.user?.ageVerified ?? undefined,
        ageVerifiedAt: data.user?.ageVerifiedAt ?? null,
        ageVerificationRequired: data.user?.ageVerificationRequired ?? undefined,
        ageVerificationDueAt: data.user?.ageVerificationDueAt ?? null,
        ageVerificationOverdue: data.user?.ageVerificationOverdue ?? undefined,
        ageVerificationDaysRemaining: data.user?.ageVerificationDaysRemaining ?? null,
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
    const normalizedTimeLimitSettings = normalizeTimeLimitSettings(
      nextProfile.timeLimitSettings
    );
    const normalizedStorefrontLocation = String(
      nextProfile.storefrontDefaultLocation || ""
    ).trim();
    const storefrontRadiusNumeric = Number(nextProfile.storefrontDefaultRadiusMiles);
    const normalizedStorefrontRadius =
      Number.isFinite(storefrontRadiusNumeric) && storefrontRadiusNumeric > 0
        ? Math.round(storefrontRadiusNumeric)
        : null;
    const normalizedActivityVisibility = normalizeVisibility(
      nextProfile.activityVisibility,
      "public"
    );
    const searchIndexingEnabled =
      typeof nextProfile.searchIndexingEnabled === "boolean"
        ? nextProfile.searchIndexingEnabled
        : true;
    const externalIndexingEnabled = Boolean(nextProfile.externalIndexingEnabled);
    const resolvedPhoneDialCode = normalizeDialCode(
      nextProfile.phoneDialCode ||
        resolveDialCodeForCountry(
          nextProfile.countryCode || "",
          nextProfile.country || "",
          countryOptions
        )
    );
    const normalizedPhone = extractNationalDigits(
      nextProfile.phone || "",
      resolvedPhoneDialCode
    );
    const basePayload =
      profilePayloadRef.current ||
      buildProfilePayloadFromAttrs({
        ...nextProfile,
        onboardingComplete: nextProfile.onboardingComplete,
      });
    const updatedPayload: ProfilePayload = {
      ...basePayload,
      phone: normalizedPhone,
      phoneDialCode: resolvedPhoneDialCode,
      profileVisibility: normalizedProfileVisibility,
      privacySettings: normalizedPrivacySettings,
      searchIndexingEnabled,
      externalIndexingEnabled,
      activityVisibility: normalizedActivityVisibility,
      notificationSettings: normalizedNotificationSettings,
      storefrontDefaultLocation: normalizedStorefrontLocation,
      storefrontDefaultRadiusMiles:
        normalizedStorefrontRadius === null ? undefined : normalizedStorefrontRadius,
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
        timeLimitSettings: normalizedTimeLimitSettings,
        showPhoneOnProfile: nextProfile.showPhoneOnProfile,
        phone: normalizedPhone,
        storefrontDefaultLocation: normalizedStorefrontLocation,
        storefrontDefaultRadiusMiles: normalizedStorefrontRadius,
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
      timeLimitSettings: normalizedTimeLimitSettings,
      showPhoneOnProfile: nextProfile.showPhoneOnProfile,
      storefrontDefaultLocation: normalizedStorefrontLocation,
      storefrontDefaultRadiusMiles:
        normalizedStorefrontRadius === null ? "" : String(normalizedStorefrontRadius),
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
        timeLimitSettings: normalizedTimeLimitSettings,
        showPhoneOnProfile: nextProfile.showPhoneOnProfile,
        storefrontDefaultLocation: normalizedStorefrontLocation,
        storefrontDefaultRadiusMiles:
          normalizedStorefrontRadius === null ? "" : String(normalizedStorefrontRadius),
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
      setNewsPreference(profile.notificationSettings.newsEnabled !== false);
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

  const handleSaveTimeLimitSettings = async () => {
    setTimeLimitError(null);
    setTimeLimitSuccess(null);
    setTimeLimitSaving(true);
    try {
      await persistProfileSettings(profile);
      setTimeLimitSuccess("Time limit settings saved.");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to save time limit settings.";
        setTimeLimitError(String(msg));
      } else {
        setTimeLimitError("Unable to save time limit settings.");
      }
    } finally {
      setTimeLimitSaving(false);
    }
  };

  const handleSaveStorefrontSettings = async () => {
    setStorefrontSettingsError(null);
    setStorefrontSettingsSuccess(null);
    setStorefrontSettingsSaving(true);
    try {
      const radiusRaw = String(profile.storefrontDefaultRadiusMiles || "").trim();
      const radiusNumber = Number(radiusRaw);
      if (radiusRaw && (!Number.isFinite(radiusNumber) || radiusNumber <= 0)) {
        setStorefrontSettingsError("Radius must be a positive number.");
        setStorefrontSettingsSaving(false);
        return;
      }
      const normalizedProfile: Profile = {
        ...profile,
        storefrontDefaultLocation: String(profile.storefrontDefaultLocation || "").trim(),
        storefrontDefaultRadiusMiles: radiusRaw
          ? String(Math.round(radiusNumber))
          : "",
      };
      setProfile(normalizedProfile);
      await persistProfileSettings(normalizedProfile);
      setStorefrontSettingsSuccess("StoreFront defaults saved.");
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to save StoreFront defaults.";
        setStorefrontSettingsError(String(msg));
      } else {
        setStorefrontSettingsError("Unable to save StoreFront defaults.");
      }
    } finally {
      setStorefrontSettingsSaving(false);
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

  const togglePrivacyEdit = (key: keyof PrivacyEditState) => {
    setPrivacyEdits((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleGoalReminderSetting = (value: GoalsState["reminder"]) => {
    setGoalReminder(value);
    const nextState: GoalsState = {
      ...loadGoalsState(goalsStorageKey),
      reminder: value,
    };
    saveGoalsState(goalsStorageKey, nextState);
  };

  const handleDashboardNewsToggle = (enabled: boolean) => {
    setProfile((prev) => ({
      ...prev,
      notificationSettings: {
        ...prev.notificationSettings,
        newsEnabled: enabled,
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

  const handleExportProfile = async () => {
    if (!user?.id) return;
    setExportError(null);
    setExportSuccess(null);
    setExportLoading(true);
    try {
      const os = detectDesktopOs();
      const { blob, filename } = await exportProfileArchive({ userId: user.id, os });
      downloadBlob(blob, filename);
      setExportSuccess(`Export ready. ${getExportInstructions(os)}`);
    } catch (err) {
      console.error("Profile export failed", err);
      setExportError("Unable to export your profile right now. Please try again.");
    } finally {
      setExportLoading(false);
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

  const buildSecurityQuestionState = (questions: string[] = []) => [
    { question: questions[0] || "", answer: "" },
    { question: questions[1] || "", answer: "" },
    { question: questions[2] || "", answer: "" },
  ];

  const updateSecurityQuestion = (
    index: number,
    field: "question" | "answer",
    value: string
  ) => {
    setSecurityQuestions((prev) =>
      prev.map((entry, idx) =>
        idx === index ? { ...entry, [field]: value } : entry
      )
    );
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
      const resolvedPhoneDialCode = normalizeDialCode(
        profile.phoneDialCode ||
          resolveDialCodeForCountry(
            profile.countryCode || "",
            profile.country || "",
            countryOptions
          )
      );
      const updatedPhone = extractNationalDigits(
        loginPhone,
        resolvedPhoneDialCode
      );
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
            const nextPhoneDialCode =
              resolvedPhoneDialCode || normalizeDialCode(payload.phoneDialCode || "");
            const nextPayload: ProfilePayload = {
              ...payload,
              phone: updatedPhone,
              phoneDialCode: nextPhoneDialCode,
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
            setProfile((prev) => ({
              ...prev,
              phone: formatPhoneInput(updatedPhone, nextPhoneDialCode),
              phoneDialCode: nextPhoneDialCode || prev.phoneDialCode,
            }));
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

  const handleSaveSecurityQuestions = async () => {
    setSecurityQuestionsError(null);
    setSecurityQuestionsSuccess(null);
    const trimmed = securityQuestions.map((entry) => ({
      question: entry.question.trim(),
      answer: entry.answer.trim(),
    }));
    const hasAny = trimmed.some((entry) => entry.question || entry.answer);
    if (hasAny) {
      if (trimmed.some((entry) => !entry.question || !entry.answer)) {
        setSecurityQuestionsError("Please answer all three security questions.");
        return;
      }
      const unique = new Set(trimmed.map((entry) => entry.question.toLowerCase()));
      if (unique.size !== trimmed.length) {
        setSecurityQuestionsError("Please choose three different security questions.");
        return;
      }
    }
    setSecurityQuestionsSaving(true);
    try {
      const payload = hasAny ? trimmed : [];
      const res = await api.post("/auth/security-questions", {
        securityQuestions: payload,
      });
      setSecurityQuestionsSavedAt(res.data?.setAt || null);
      setSecurityQuestionsSuccess(
        hasAny ? "Security questions saved." : "Security questions cleared."
      );
      if (!hasAny) {
        setSecurityQuestions(buildSecurityQuestionState([]));
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to save security questions.";
        setSecurityQuestionsError(String(msg));
      } else {
        setSecurityQuestionsError("Unable to save security questions.");
      }
    } finally {
      setSecurityQuestionsSaving(false);
    }
  };

  const handleClearSecurityQuestions = () => {
    setSecurityQuestions(buildSecurityQuestionState([]));
    setSecurityQuestionsSuccess(null);
    setSecurityQuestionsError(null);
  };

  const isPhonePlaceholderAccount = String(user?.email || "")
    .trim()
    .toLowerCase()
    .endsWith("@phone.yoursocialplace.local");

  const handlePasswordReset = async () => {
    setPasswordResetError(null);
    setPasswordResetSuccess(null);
    setPasswordResetLoading(true);
    try {
      if (isPhonePlaceholderAccount) {
        await api.post("/auth/password-reset/sms");
        setPasswordResetSuccess("Reset link sent to your phone number.");
      } else {
        if (!user?.email) {
          setPasswordResetError("Email address not available.");
          return;
        }
        await api.post("/auth/forgot-password", { email: user.email });
        setPasswordResetSuccess("Reset email sent. Check your inbox.");
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          (isPhonePlaceholderAccount
            ? "Unable to send password reset link to your phone number."
            : "Unable to send reset email.");
        setPasswordResetError(String(msg));
      } else {
        setPasswordResetError(
          isPhonePlaceholderAccount
            ? "Unable to send password reset link to your phone number."
            : "Unable to send reset email."
        );
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
      if (data.totpSecretInvalid) {
        setTwoFactorError(
          "Your authenticator setup needs to be reset. Click Reset 2FA to re-enroll."
        );
      }
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

  const handleTwoFactorReset = async () => {
    if (!user?.id) return;
    if (typeof window !== "undefined") {
      const confirmed = window.confirm(
        "Reset two-factor authentication? This clears your current 2FA setup so you can re-enroll."
      );
      if (!confirmed) return;
    }
    setTwoFactorError(null);
    setTwoFactorSuccess(null);
    setTwoFactorResetting(true);
    try {
      await api.post("/auth/2fa/reset");
      setTwoFactorEnabled(false);
      setTwoFactorMethod("totp");
      setTwoFactorHasAuthenticator(false);
      setTotpSetup(null);
      setTotpCode("");
      const started = await handleTotpSetup();
      if (started) {
        setTwoFactorSuccess("Two-factor reset. Scan the QR code to re-enroll.");
      }
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to reset two-factor.";
        setTwoFactorError(String(msg));
      } else {
        setTwoFactorError("Unable to reset two-factor.");
      }
    } finally {
      setTwoFactorResetting(false);
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
        return false;
      }
      setTotpSetup({
        qrCodeDataUrl: data.qrCodeDataUrl,
        otpauthUrl: data.otpauthUrl,
      });
      return true;
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
      return false;
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
        const msgLower = String(msg).toLowerCase();
        if (msgLower.includes("no pending authenticator setup")) {
          setTwoFactorError("Setup expired. Starting a new authenticator setup.");
          setTotpSetup(null);
          setTotpCode("");
          setTwoFactorHasAuthenticator(false);
          const started = await handleTotpSetup();
          if (started) {
            setTwoFactorSuccess("New setup started. Scan the QR and enter the code.");
          }
          return;
        }
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
    if (!avatarFile) {
      setAvatarPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(avatarFile);
    setAvatarPreviewUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [avatarFile]);

  const handleCountryChange = (value: string) => {
    const match = value ? matchByName(countryOptions, value) : undefined;
    setProfile((prev) => ({
      ...prev,
      country: value,
      countryCode: match?.code || "",
      phoneDialCode: prev.phoneDialCode || normalizeDialCode(match?.phoneCode || ""),
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

  const handleStorefrontStateChange = (value: string) => {
    if (!value) {
      setStorefrontLocationState("");
      setStorefrontLocationStateCode("");
      setStorefrontLocationCity("");
      setStorefrontCityOptions([]);
      setProfile((prev) => ({
        ...prev,
        storefrontDefaultLocation: "",
      }));
      return;
    }
    const match = storefrontStateOptions.find((option) => option.code === value);
    const stateName = match?.name || value;
    const stateCode = match?.code || value;
    setStorefrontLocationState(stateName);
    setStorefrontLocationStateCode(stateCode);
    setStorefrontLocationCity("");
    setStorefrontCityOptions([]);
    setProfile((prev) => ({
      ...prev,
      storefrontDefaultLocation: formatStorefrontLocation("", stateName),
    }));
  };

  const handleStorefrontCityChange = (value: string) => {
    setStorefrontLocationCity(value);
    setProfile((prev) => ({
      ...prev,
      storefrontDefaultLocation: formatStorefrontLocation(
        value,
        storefrontLocationState
      ),
    }));
  };

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
    if (!countryOptions.length) return;
    setProfile((prev) => {
      if (prev.phoneDialCode) return prev;
      const dialCode = resolveDialCodeForCountry(
        prev.countryCode || "",
        prev.country || "",
        countryOptions
      );
      if (!dialCode) return prev;
      return { ...prev, phoneDialCode: dialCode };
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
    const parsed = parseStorefrontLocation(profile.storefrontDefaultLocation || "");
    setStorefrontLocationState(parsed.state);
    setStorefrontLocationCity(parsed.city);
  }, [profile.storefrontDefaultLocation]);

  useEffect(() => {
    let active = true;
    const loadStorefrontStates = async () => {
      try {
        const res = await api.get("/locations/states", {
          params: { country: "US" },
        });
        const list = (res.data?.data ?? []).map((state: any) => ({
          name: state.name,
          code: state.code || state.isoCode || "",
          countryCode: state.countryCode,
        }));
        if (active) {
          setStorefrontStateOptions(list);
          setStorefrontLocationError(null);
        }
      } catch {
        if (active) setStorefrontLocationError("Unable to load states.");
      }
    };
    loadStorefrontStates();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!storefrontLocationState) {
      setStorefrontLocationStateCode("");
      return;
    }
    const match =
      matchByName(storefrontStateOptions, storefrontLocationState) ||
      storefrontStateOptions.find(
        (option) =>
          option.code &&
          option.code.toLowerCase() === storefrontLocationState.toLowerCase()
      );
    const nextCode = match?.code || storefrontLocationStateCode;
    if (nextCode && nextCode !== storefrontLocationStateCode) {
      setStorefrontLocationStateCode(nextCode);
    }
    if (match?.name && match.name !== storefrontLocationState) {
      setStorefrontLocationState(match.name);
    }
  }, [storefrontLocationState, storefrontLocationStateCode, storefrontStateOptions]);

  useEffect(() => {
    if (!storefrontLocationStateCode) {
      setStorefrontCityOptions([]);
      return;
    }
    let active = true;
    const loadStorefrontCities = async () => {
      try {
        const res = await api.get("/locations/cities", {
          params: { country: "US", state: storefrontLocationStateCode },
        });
        const list = (res.data?.data ?? []).map((city: any) => ({
          name: city.name,
          code: city.name,
        }));
        if (active) {
          setStorefrontCityOptions(list);
          setStorefrontLocationError(null);
        }
      } catch {
        if (active) setStorefrontLocationError("Unable to load cities.");
      }
    };
    loadStorefrontCities();
    return () => {
      active = false;
    };
  }, [storefrontLocationStateCode]);

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

  useEffect(() => {
    if (!user || !countryOptions.length) return;
    if (phoneRepairAttemptedRef.current) return;
    const fallbackDialCode = resolveDialCodeForCountry(
      profile.countryCode || "",
      profile.country || "",
      countryOptions
    );
    const effectiveDialCode = fallbackDialCode || normalizeDialCode(profile.phoneDialCode);
    const currentDigits = extractNationalDigits(
      profile.phone,
      effectiveDialCode
    ).length;
    if (currentDigits >= 10) return;
    phoneRepairAttemptedRef.current = true;
    api
      .get("/auth/phone/me")
      .then((res) => {
        const rawPhone = String(res.data?.phoneNumber || "").trim();
        const rawDigits = normalizeDialCode(rawPhone);
        if (!rawDigits) return;
        const dialCode = deriveDialCodeFromPhone(
          rawDigits,
          countryOptions,
          effectiveDialCode
        );
        if (!dialCode) return;
        const national = rawDigits.startsWith(dialCode)
          ? rawDigits.slice(dialCode.length)
          : rawDigits.slice(-10);
        applyPhoneRepair(national, dialCode);
        void syncPhoneFromLogin(national, dialCode);
      })
      .catch(() => {
        phoneRepairAttemptedRef.current = false;
      });
  }, [
    countryOptions,
    profile.country,
    profile.countryCode,
    profile.phone,
    profile.phoneDialCode,
    user,
  ]);

  const setProfileFromEntry = async (entry: any) => {
    if (!entry) return;
    const attrs = normalize(entry);
    profileIdRef.current = entry?.documentId ?? entry?.id ?? null;

    const basePayload = buildProfilePayloadFromAttrs(attrs);
    let payload: ProfilePayload | null = null;
    const hasEncryptedProfile = Boolean(attrs.encryptedProfile);
    if (hasEncryptedProfile && user?.id) {
      try {
        payload = await decryptOwnProfilePayload(user.id, attrs.encryptedProfile);
        setProfileDecryptFailed(false);
      } catch {
        payload = null;
        setProfileDecryptFailed(true);
      }
    } else {
      setProfileDecryptFailed(false);
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
    const timeLimitSettings = normalizeTimeLimitSettings(attrs.timeLimitSettings);
    const storefrontDefaultLocation = String(
      payload.storefrontDefaultLocation ?? attrs.storefrontDefaultLocation ?? ""
    ).trim();
    const storefrontRadiusValue =
      payload.storefrontDefaultRadiusMiles ?? attrs.storefrontDefaultRadiusMiles;
    const storefrontDefaultRadiusMiles = Number.isFinite(Number(storefrontRadiusValue))
      ? String(Math.max(0, Number(storefrontRadiusValue)))
      : "";
    const phoneDialCode = normalizeDialCode(payload.phoneDialCode || "");
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
      phone: formatPhoneInput(payload.phone || "", phoneDialCode),
      phoneDialCode,
      preferredVerificationMethod,
      showPhoneOnProfile,
      profileVisibility,
      privacySettings,
      searchIndexingEnabled,
      externalIndexingEnabled,
      activityVisibility,
      notificationSettings,
      timeLimitSettings,
      storefrontDefaultLocation,
      storefrontDefaultRadiusMiles,
      handle: attrs.handle || "",
      avatarUrl: pickMediaUrl(attrs.avatar, { kind: "avatar" }),
      onboardingComplete,
    };
    setProfile(nextProfile);
    profileSnapshotRef.current = nextProfile;
    hobbySnapshotRef.current = parsedHobbies;
    setOnboardingActive(!onboardingComplete);
  };

  const applyPhoneRepair = (nationalDigits: string, dialCode: string) => {
    const cleaned = extractNationalDigits(nationalDigits, dialCode);
    if (cleaned.length < 10) return;
    const formatted = formatPhoneInput(cleaned, dialCode);
    setProfile((prev) => ({
      ...prev,
      phone: formatted,
      phoneDialCode: dialCode,
    }));
    if (profileSnapshotRef.current) {
      profileSnapshotRef.current = {
        ...profileSnapshotRef.current,
        phone: formatted,
        phoneDialCode: dialCode,
      };
    }
  };

  const syncPhoneFromLogin = async (nationalDigits: string, dialCode: string) => {
    if (!user) return;
    const cleaned = extractNationalDigits(nationalDigits, dialCode);
    if (cleaned.length < 10) return;
    const basePayload =
      profilePayloadRef.current ||
      buildProfilePayloadFromAttrs({
        ...profile,
        phone: cleaned,
        phoneDialCode: dialCode,
      });
    const updatedPayload: ProfilePayload = {
      ...basePayload,
      phone: cleaned,
      phoneDialCode: dialCode,
    };
    const encryptedProfile = await encryptProfilePayload(user.id, updatedPayload);
    await api.put("/profiles/me", {
      data: {
        encryptedProfile,
        profileKeyVersion: 1,
        phone: cleaned,
        showPhoneOnProfile: profile.showPhoneOnProfile,
      },
    });
    profilePayloadRef.current = updatedPayload;
    if (profileSnapshotRef.current) {
      profileSnapshotRef.current = {
        ...profileSnapshotRef.current,
        phone: formatPhoneInput(cleaned, dialCode),
        phoneDialCode: dialCode,
      };
    }
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
      `/users-posts?filters[owner][id][$eq]=${user.id}&populate=Users_Pictures&populate=feedbackTarget&populate=trustedCircle&sort=createdAt:desc`
    );

    const mappedPosts: MediaPost[] = (postsRes.data?.data ?? []).map((p: any) => {
      const attrs = normalize(p);
      const pic = pickMediaUrl(attrs.Users_Pictures, { kind: "post" });
      const feedbackTargetData = getEntity(attrs.feedbackTarget);
      const feedbackTargetId = getEntityId(feedbackTargetData);
      const feedbackTargetName = feedbackTargetId
        ? getEntityLabel(feedbackTargetData, `User ${feedbackTargetId}`)
        : undefined;
      const trustedCircleData = getEntity(attrs.trustedCircle);
      const trustedCircleId = getEntityId(trustedCircleData);
      const trustedCircleName = trustedCircleId
        ? getEntityLabel(trustedCircleData, `Circle ${trustedCircleId}`)
        : undefined;
      const postId =
        p?.id ??
        attrs?.id ??
        p?.documentId ??
        attrs?.documentId ??
        String(attrs?.Users_Content || "");
      const numericId = Number(p?.id ?? attrs?.id);
      const likes = Number(attrs.likes ?? 0);
      const reactionCounts = normalizeReactionCounts(attrs.reactionCounts, likes);
      const myReaction = normalizeReactionValue(attrs.myReaction ?? p?.myReaction);
      return {
        id: postId,
        numericId: Number.isFinite(numericId) ? numericId : undefined,
        documentId: p?.documentId ?? attrs?.documentId,
        text: attrs.Users_Content || "",
        media: pic,
        createdAt: attrs.createdAt || attrs.created_at,
        feedbackAudience: attrs.feedbackAudience || undefined,
        feedbackTargetId,
        feedbackTargetName,
        likes,
        reactionCounts,
        myReaction,
        shares: Number(attrs.shares ?? 0),
        visibility: attrs.visibility || undefined,
        trustedCircleId,
        trustedCircleName,
      };
    });

    setPosts(mappedPosts);
    if (mappedPosts.length) {
      try {
        const commentsMap = await fetchCommentsForPostIds(
          mappedPosts.map((post) => post.numericId ?? post.id)
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

  const fetchProfileMedia = async (): Promise<ProfileMediaItem[]> => {
    if (!user) return [];
    setProfileMediaLoading(true);
    setProfileMediaError(null);
    try {
      const res = await api.get(
        `/profile-media-items?filters[owner][id][$eq]=${user.id}&populate=media&populate=trustedCircle&sort=createdAt:desc&pagination[pageSize]=200`
      );
      const items: ProfileMediaItem[] = (res.data?.data ?? []).map(
        normalizeProfileMedia
      );
      setProfileMedia(items);
      const foldersFromItems = sanitizeFolderList(
        items
          .map((item) => normalizeFolderName(item.folder))
          .filter((folder) => folder && !isReservedMediaFolder(folder)) as string[]
      );
      if (foldersFromItems.length) {
        setMediaFolders((prev) => mergeFolderLists(prev, foldersFromItems));
      }
      return items;
    } catch (err) {
      setProfileMediaError("Unable to load your media gallery.");
      return [];
    } finally {
      setProfileMediaLoading(false);
    }
  };

  const refreshTrustedCircleMembers = useCallback(
    async (circleId: number) => {
      const membersRes = await api.get(
        `/trusted-circle-members?filters[circle][id][$eq]=${circleId}&populate=user&pagination[pageSize]=200`
      );
      const members: TrustedCircleMember[] = (membersRes.data?.data ?? [])
        .map((entry: any) => {
          const attrs = normalize(entry);
          const userId = getEntityId(attrs.user);
          const recordId = getEntryId(entry, attrs);
          if (!userId || !recordId) return null;
          return { id: recordId, userId };
        })
        .filter(Boolean) as TrustedCircleMember[];
      setTrustedCircleMembersByGroup((prev) => ({ ...prev, [circleId]: members }));
    },
    [getEntryId, getEntityId]
  );

  const loadTrustedCircles = useCallback(
    async (force = false) => {
      if (!user) {
        setTrustedCircles([]);
        setActiveTrustedCircleId(null);
        setTrustedCircleMembersByGroup({});
        trustedCircleLoadRef.current = null;
        return;
      }
      if (!force && trustedCircleLoadRef.current === user.id) return;
      trustedCircleLoadRef.current = user.id;
      setTrustedCircleLoading(true);
      setTrustedCircleError(null);
      try {
        const circlesRes = await api.get(
          `/trusted-circles?sort=name:asc&pagination[pageSize]=${MAX_TRUSTED_CIRCLES}`
        );
        const entries = circlesRes.data?.data ?? [];
        const circles = entries
          .map((entry: any) => {
            const attrs = normalize(entry);
            const circleId = Number(entry?.id ?? attrs?.documentId ?? attrs?.id);
            if (!Number.isFinite(circleId)) return null;
            return {
              id: circleId,
              name: String(attrs?.name || "Trusted circle"),
            } as TrustedCircle;
          })
          .filter(Boolean) as TrustedCircle[];
        setTrustedCircles(circles);
        setTrustedCircleMembersByGroup((prev) => {
          const next: Record<number, TrustedCircleMember[]> = {};
          circles.forEach((circle) => {
            if (prev[circle.id]) {
              next[circle.id] = prev[circle.id];
            }
          });
          return next;
        });
        setActiveTrustedCircleId((current) => {
          if (current && circles.some((circle) => circle.id === current)) {
            return current;
          }
          return circles[0]?.id ?? null;
        });
      } catch (err) {
        setTrustedCircleError(getErrorMessage(err, "Unable to load trusted circles."));
      } finally {
        setTrustedCircleLoading(false);
      }
    },
    [getErrorMessage, user]
  );

  useEffect(() => {
    setTrustedCircleOptions(
      trustedCircles.map((circle) => ({ id: circle.id, name: circle.name }))
    );
  }, [trustedCircles]);

  useEffect(() => {
    if (!activeTrustedCircle?.id) return;
    if (trustedCircleMembersByGroup[activeTrustedCircle.id]) return;
    void refreshTrustedCircleMembers(activeTrustedCircle.id);
  }, [activeTrustedCircle?.id, refreshTrustedCircleMembers, trustedCircleMembersByGroup]);

  const createTrustedCircle = useCallback(async () => {
    if (!user) return null;
    const name = trustedCircleName.trim();
    if (!name) {
      setTrustedCircleError("Enter a name for your trusted circle.");
      return null;
    }
    if (trustedCircles.length >= MAX_TRUSTED_CIRCLES) {
      setTrustedCircleError(`You can create up to ${MAX_TRUSTED_CIRCLES} circles.`);
      return null;
    }
    setTrustedCircleBusy(true);
    setTrustedCircleError(null);
    try {
      const res = await api.post("/trusted-circles", {
        data: {
          name,
        },
      });
      const entry = res.data?.data ?? res.data;
      const attrs = normalize(entry);
      const circleId = Number(entry?.id ?? attrs?.documentId ?? attrs?.id);
      if (!Number.isFinite(circleId)) {
        setTrustedCircleError("Unable to create trusted circle.");
        return null;
      }
      const nextCircle = { id: circleId, name: String(attrs?.name || name) };
      setTrustedCircles((prev) => [...prev, nextCircle]);
      setTrustedCircleName("");
      setActiveTrustedCircleId(circleId);
      await refreshTrustedCircleMembers(circleId);
      pushTrustedCircleSuccess(`"${nextCircle.name}" created.`);
      return circleId;
    } catch (err) {
      setTrustedCircleError(getErrorMessage(err, "Unable to create trusted circle."));
      return null;
    } finally {
      setTrustedCircleBusy(false);
    }
  }, [
    getErrorMessage,
    pushTrustedCircleSuccess,
    refreshTrustedCircleMembers,
    trustedCircleName,
    trustedCircles.length,
    user,
  ]);

  const queueTrustedFriend = useCallback(
    (friendId: number) => {
      if (!Number.isFinite(friendId)) return;
      if (trustedMemberIds.has(friendId)) return;
      setTrustedCircleEditing(true);
      setPendingTrustedAddIds((prev) =>
        prev.includes(friendId) ? prev : [...prev, friendId]
      );
    },
    [trustedMemberIds]
  );

  const togglePendingRemoval = useCallback((member: TrustedCircleMember) => {
    setPendingTrustedRemoveIds((prev) =>
      prev.includes(member.id)
        ? prev.filter((id) => id !== member.id)
        : [...prev, member.id]
    );
  }, []);

  const cancelTrustedCircleEdits = useCallback(() => {
    setTrustedCircleEditing(false);
    setPendingTrustedAddIds([]);
    setPendingTrustedRemoveIds([]);
  }, []);

  const applyTrustedCircleChanges = useCallback(async () => {
    if (!activeTrustedCircle?.id) return;
    const circleId = activeTrustedCircle.id;
    const additions = pendingTrustedAddIds.filter((id) => !trustedMemberIds.has(id));
    const removals = trustedCircleMembers.filter((member) =>
      pendingTrustedRemoveSet.has(member.id)
    );
    if (!additions.length && !removals.length) {
      cancelTrustedCircleEdits();
      pushTrustedCircleSuccess("No changes to apply.");
      return;
    }
    setTrustedCircleBusy(true);
    setTrustedCircleError(null);
    try {
      await Promise.all([
        ...additions.map((friendId) =>
          api.post("/trusted-circle-members", {
            data: { circle: circleId, user: friendId },
          })
        ),
        ...removals.map((member) =>
          api.delete(`/trusted-circle-members/${member.id}`)
        ),
      ]);
      await refreshTrustedCircleMembers(circleId);
      setPendingTrustedAddIds([]);
      setPendingTrustedRemoveIds([]);
      setTrustedCircleEditing(false);
      pushTrustedCircleSuccess("Trusted circle updated.");
    } catch (err) {
      const message = getErrorMessage(err, "Unable to update trusted circle.");
      if (message.toLowerCase().includes("already in this circle")) {
        await refreshTrustedCircleMembers(circleId);
        setPendingTrustedAddIds([]);
        setPendingTrustedRemoveIds([]);
        setTrustedCircleEditing(false);
        pushTrustedCircleSuccess("Trusted circle updated.");
      } else {
        setTrustedCircleError(message);
      }
    } finally {
      setTrustedCircleBusy(false);
    }
  }, [
    activeTrustedCircle,
    cancelTrustedCircleEdits,
    getErrorMessage,
    pendingTrustedAddIds,
    pendingTrustedRemoveSet,
    pushTrustedCircleSuccess,
    refreshTrustedCircleMembers,
    trustedCircleMembers,
    trustedMemberIds,
  ]);

  const clearTrustedFriends = useCallback(async () => {
    if (!activeTrustedCircle?.id) return;
    const membersToRemove = trustedCircleMembers.filter(
      (member) => member.userId !== user?.id
    );
    if (!membersToRemove.length) return;
    setTrustedCircleBusy(true);
    setTrustedCircleError(null);
    try {
      await Promise.all(
        membersToRemove.map((member) =>
          api.delete(`/trusted-circle-members/${member.id}`)
        )
      );
      await refreshTrustedCircleMembers(activeTrustedCircle.id);
      pushTrustedCircleSuccess("Trusted circle cleared.");
    } catch (err) {
      setTrustedCircleError(getErrorMessage(err, "Unable to clear trusted circle."));
    } finally {
      setTrustedCircleBusy(false);
    }
  }, [
    getErrorMessage,
    refreshTrustedCircleMembers,
    activeTrustedCircle,
    trustedCircleMembers,
    user,
    pushTrustedCircleSuccess,
  ]);

  const handleRenameTrustedCircle = useCallback(async () => {
    if (!activeTrustedCircle?.id) return;
    const name = trustedCircleRename.trim();
    if (!name) {
      setTrustedCircleError("Enter a name for this circle.");
      return;
    }
    setTrustedCircleSaving(true);
    setTrustedCircleError(null);
    try {
      await api.put(`/trusted-circles/${activeTrustedCircle.id}`, {
        data: { name },
      });
      setTrustedCircles((prev) =>
        prev.map((circle) =>
          circle.id === activeTrustedCircle.id ? { ...circle, name } : circle
        )
      );
      setTrustedCircleRenaming(false);
      setTrustedCircleEditing(false);
      pushTrustedCircleSuccess("Trusted circle renamed.");
    } catch (err) {
      setTrustedCircleError(getErrorMessage(err, "Unable to rename circle."));
    } finally {
      setTrustedCircleSaving(false);
    }
  }, [activeTrustedCircle, getErrorMessage, pushTrustedCircleSuccess, trustedCircleRename]);

  const handleDeleteTrustedCircle = useCallback(async () => {
    if (!activeTrustedCircle?.id) return;
    setTrustedCircleSaving(true);
    setTrustedCircleError(null);
    try {
      await api.delete(`/trusted-circles/${activeTrustedCircle.id}`);
      setTrustedCircles((prev) =>
        prev.filter((circle) => circle.id !== activeTrustedCircle.id)
      );
      setTrustedCircleMembersByGroup((prev) => {
        const next = { ...prev };
        delete next[activeTrustedCircle.id];
        return next;
      });
      setActiveTrustedCircleId((current) => {
        if (current !== activeTrustedCircle.id) return current;
        const remaining = trustedCircles.filter(
          (circle) => circle.id !== activeTrustedCircle.id
        );
        return remaining[0]?.id ?? null;
      });
      setPendingTrustedAddIds([]);
      setPendingTrustedRemoveIds([]);
      setTrustedCircleEditing(false);
      setTrustedCircleDeleteOpen(false);
      setTrustedCircleDeleteTarget(null);
      pushTrustedCircleSuccess("Trusted circle deleted.");
    } catch (err) {
      setTrustedCircleError(getErrorMessage(err, "Unable to delete circle."));
    } finally {
      setTrustedCircleSaving(false);
    }
  }, [activeTrustedCircle, getErrorMessage, pushTrustedCircleSuccess, trustedCircles]);

  const fetchLinkPreview = async (url: string): Promise<LinkPreview | null> => {
    if (!url) return null;
    if (previewCache[url] !== undefined) return previewCache[url];

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
      return null;
    }
  };

  const createMediaItem = async () => {
    if (!user) return;
    if (!mediaFile) {
      setProfileMediaError("Select a photo or video to upload.");
      return;
    }
    const isVideo = isVideoFile(mediaFile);
    const maxBytes = isVideo ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
    const maxLabel = isVideo ? MAX_VIDEO_UPLOAD_LABEL : MAX_UPLOAD_LABEL;
    if (mediaFile.size > maxBytes) {
      setProfileMediaError(`Media files must be under ${maxLabel}.`);
      return;
    }
    if (mediaVisibility === "trusted" && !mediaTrustedCircleId) {
      setProfileMediaError("Choose a trusted circle for this media.");
      return;
    }
    const normalizedFolder = normalizeFolderName(mediaFolder);
    if (normalizedFolder && isReservedMediaFolder(normalizedFolder)) {
      setProfileMediaError("Choose a different folder name.");
      return;
    }

    setProfileMediaError(null);
    setMediaSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("files", mediaFile);
      const uploadRes = await api.post("/upload", fd);
      const uploadedId = uploadRes.data?.[0]?.id;
      if (!uploadedId) {
        setProfileMediaError("Media upload failed.");
        return;
      }
      const nextOrder =
        profileMedia.reduce((acc, entry) => {
          const entryFolder = normalizeFolderName(entry.folder);
          if (entryFolder !== (normalizedFolder || "")) return acc;
          const entryOrder = parseMediaOrder(entry.order);
          return entryOrder !== null && entryOrder > acc ? entryOrder : acc;
        }, 0) + 1;
      await api.post("/profile-media-items", {
        data: {
          title: mediaTitle.trim() || null,
          caption: mediaCaption.trim() || null,
          folder: normalizedFolder || null,
          visibility: mediaVisibility,
          kind: isVideo ? "video" : "photo",
          order: nextOrder,
          media: uploadedId,
          trustedCircle:
            mediaVisibility === "trusted" && mediaTrustedCircleId
              ? Number(mediaTrustedCircleId)
              : null,
        },
      });
      if (normalizedFolder && !isReservedMediaFolder(normalizedFolder)) {
        setMediaFolders((prev) =>
          prev.some((folder) => folder.toLowerCase() === normalizedFolder.toLowerCase())
            ? prev
            : [...prev, normalizedFolder]
        );
      }
      setMediaTitle("");
      setMediaCaption("");
      setMediaFolder("");
      setMediaFile(null);
      setMediaVisibility("friends");
      setMediaTrustedCircleId("");
      await fetchProfileMedia();
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Unable to upload media.";
        setProfileMediaError(String(msg));
      } else {
        setProfileMediaError("Unable to upload media.");
      }
    } finally {
      setMediaSubmitting(false);
    }
  };

  const updateMediaVisibility = async (
    item: ProfileMediaItem,
    nextVisibility: ProfileMediaItem["visibility"]
  ) => {
    if (!item.id) return;
    setProfileMediaError(null);
    const payload: Record<string, unknown> = { visibility: nextVisibility };
    if (nextVisibility === "trusted") {
      const fallbackGroup = trustedCircleOptions[0]?.id;
      const groupId = item.trustedCircleId || fallbackGroup;
      if (!groupId) {
        setProfileMediaError("Select a trusted circle before saving.");
        return;
      }
      payload.trustedCircle = groupId;
    } else {
      payload.trustedCircle = null;
    }

    try {
      const attempts: string[] = [];
      if (item.documentId) attempts.push(`/profile-media-items/${item.documentId}`);
      const numericId = typeof item.id === "number" ? item.id : Number(item.id);
      if (Number.isFinite(numericId)) attempts.push(`/profile-media-items/${numericId}`);
      attempts.push(`/profile-media-items/${item.id}`);

      let updated = false;
      for (const path of attempts) {
        try {
          await api.put(path, { data: payload });
          updated = true;
          break;
        } catch (err: any) {
          if (err?.response?.status === 404) continue;
          throw err;
        }
      }

      if (!updated) {
        setProfileMediaError("Unable to update media visibility.");
        return;
      }

      setProfileMedia((prev) =>
        prev.map((entry) =>
          String(entry.id) === String(item.id) ||
          (item.documentId && String(entry.documentId) === String(item.documentId))
            ? {
                ...entry,
                visibility: nextVisibility,
                trustedCircleId:
                  nextVisibility === "trusted"
                    ? (payload.trustedCircle as number)
                    : undefined,
                trustedCircleName:
                  nextVisibility === "trusted"
                    ? trustedCircleOptions.find(
                        (group) => group.id === (payload.trustedCircle as number)
                      )?.name
                    : undefined,
              }
            : entry
        )
      );
    } catch {
      setProfileMediaError("Unable to update media visibility.");
    }
  };

  const deleteMediaItem = async (item: ProfileMediaItem) => {
    if (!item.id) return;
    setProfileMediaError(null);
    const numericId = typeof item.id === "number" ? item.id : Number(item.id);
    const docId = item.documentId;
    const matchesItem = (entry: ProfileMediaItem) => {
      if (docId && String(entry.documentId) === String(docId)) return true;
      if (Number.isFinite(numericId) && String(entry.id) === String(numericId)) {
        return true;
      }
      return String(entry.id) === String(item.id);
    };
    try {
      const attempts: string[] = [];
      if (docId) attempts.push(`/profile-media-items/${docId}`);
      if (Number.isFinite(numericId)) attempts.push(`/profile-media-items/${numericId}`);
      attempts.push(`/profile-media-items/${item.id}`);

      let removed = false;
      for (const path of attempts) {
        try {
          await api.delete(path);
          removed = true;
          break;
        } catch (err: any) {
          if (err?.response?.status === 404) continue;
          throw err;
        }
      }

      if (!removed) {
        setProfileMediaError("Unable to delete media item.");
        return;
      }

      setProfileMedia((prev) =>
        prev.filter((entry) => !matchesItem(entry))
      );
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      if (status && status >= 500) {
        try {
          const refreshed = await fetchProfileMedia();
          const stillThere = refreshed.some((entry) => matchesItem(entry));
          if (!stillThere) {
            return;
          }
        } catch {
          // fall through to error message
        }
      }
      setProfileMediaError("Unable to delete media item.");
    }
  };

  const deletePost = async (post: MediaPost) => {
    setError(null);
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
        setError("Delete failed to persist. Please try again.");
      }
    } catch (err) {
      console.error("Delete post failed", err);
      setError("Failed to delete post.");
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
    if (hobbyList.length >= MAX_HOBBIES) {
      setHobbyError(`You can add up to ${MAX_HOBBIES} hobbies.`);
      setHobbyInput("");
      return;
    }
    const next = [...hobbyList, match];
    updateHobbies(next);
    setHobbyInput("");
    setHobbyError(null);
  };

  const addHobby = () => {
    addHobbyValue(hobbyInput);
  };

  const removeHobby = (target: string) => {
    const key = hobbyKey(target);
    const next = hobbyList.filter((hobby) => hobbyKey(hobby) !== key);
    updateHobbies(next);
    setHobbyError(null);
  };

  const toggleHobbyValue = (value: string) => {
    const key = hobbyKey(value);
    if (hobbyList.some((hobby) => hobbyKey(hobby) === key)) {
      removeHobby(value);
      return;
    }
    addHobbyValue(value);
  };

  const openHobbyModal = (target: "onboarding" | "profile") => {
    setActiveHobbyModal(target);
    setHobbyInput("");
    setHobbyError(null);
  };

  const closeHobbyModal = () => {
    setActiveHobbyModal(null);
    setHobbyInput("");
    setHobbyError(null);
  };

  const hobbySuggestions = useMemo(() => {
    const term = hobbyInput.trim().toLowerCase();
    const selected = new Set(hobbyList.map((hobby) => hobbyKey(hobby)));
    const matches = HOBBY_OPTIONS.filter((hobby) => {
      if (selected.has(hobbyKey(hobby))) return false;
      return term ? hobby.toLowerCase().includes(term) : true;
    });
    return matches.slice(0, 24);
  }, [hobbyInput, hobbyList]);

  const renderHobbyPicker = (target: "onboarding" | "profile") => (
    <label className="profile-field">
      <span className="profile-field-label">Hobbies</span>
      <div className="hobby-picker">
        <button
          className="btn ghost"
          type="button"
          onClick={() => openHobbyModal(target)}
        >
          {hobbyList.length
            ? `Edit hobbies (${hobbyList.length}/${MAX_HOBBIES})`
            : "Add hobbies"}
        </button>
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
          Choose up to {MAX_HOBBIES} hobbies.
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
          const otherAttrs = normalize(getEntity(otherUser));
          const avatarUrl = pickMediaUrl(otherAttrs?.avatar, { kind: "avatar" });
          optionMap.set(otherId, {
            id: otherId,
            label: getEntityLabel(otherUser, `User ${otherId}`),
            avatarUrl,
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
            storefrontDefaultLocation: "",
            storefrontDefaultRadiusMiles: "",
            timeLimitSettings: DEFAULT_TIME_LIMIT_SETTINGS,
            handle: lockedUniqueHandle, // show the locked handle even if empty profile
            onboardingComplete: false,
          });
          setOnboardingActive(true);
          setOnboardingStep(0);
          setEditing(true);
          await fetchMyPosts();
          await fetchProfileMedia();
          await loadTrustedCircles(true);
          return;
        }

        await setProfileFromEntry(mine);
        setEditing(false);
        await fetchMyPosts();
        await fetchProfileMedia();
        await loadTrustedCircles(true);
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
      void fetchLinkPreview(url);
    });
  }, [posts, previewCache]);

  useEffect(() => {
    const urls = new Set<string>();
    Object.values(postComments).forEach((commentList) => {
      commentList.forEach((comment) => {
        const url = extractFirstUrl(comment.body);
        if (!isPreviewableUrl(url)) return;
        if (previewCache[url] !== undefined) return;
        urls.add(url);
      });
    });
    if (!urls.size) return;
    urls.forEach((url) => {
      void fetchLinkPreview(url);
    });
  }, [postComments, previewCache]);

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

      const resolvedPhoneDialCode = normalizeDialCode(
        mergedProfile.phoneDialCode ||
          resolveDialCodeForCountry(
            mergedProfile.countryCode || "",
            mergedProfile.country || "",
            countryOptions
          )
      );
      const phoneClean = extractNationalDigits(
        mergedProfile.phone,
        resolvedPhoneDialCode
      );

      let avatarId: number | undefined;
      let uploadedAvatarUrl: string | undefined;

      if (avatarFile) {
        const fd = new FormData();
        fd.append("files", avatarFile);

        const uploadRes = await api.post("/upload", fd);

        avatarId = uploadRes.data?.[0]?.id;
        uploadedAvatarUrl = pickMediaUrl(uploadRes.data?.[0], { kind: "avatar" });
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
      const existingPhoneDialCode = String(existingPayload.phoneDialCode || "");

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
      const effectivePhoneDialCode = resolveLockedValue(
        lockPhone,
        existingPhoneDialCode,
        resolvedPhoneDialCode
      );
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
      const normalizedStorefrontLocation = String(
        mergedProfile.storefrontDefaultLocation || ""
      ).trim();
      const storefrontRadiusNumeric = Number(mergedProfile.storefrontDefaultRadiusMiles);
      const normalizedStorefrontRadius =
        Number.isFinite(storefrontRadiusNumeric) && storefrontRadiusNumeric > 0
          ? Math.round(storefrontRadiusNumeric)
          : undefined;

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
        phoneDialCode: effectivePhoneDialCode,
        profileVisibility: normalizedProfileVisibility,
        privacySettings: normalizedPrivacySettings,
        searchIndexingEnabled: normalizedSearchIndexingEnabled,
        externalIndexingEnabled: normalizedExternalIndexingEnabled,
        activityVisibility: normalizedActivityVisibility,
        notificationSettings: normalizedNotificationSettings,
        storefrontDefaultLocation: normalizedStorefrontLocation,
        storefrontDefaultRadiusMiles: normalizedStorefrontRadius,
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
            birthday: normalizedBirthday || null,
            gender: nextPayload.gender,
            religion: nextPayload.religion,
            hobbies: nextPayload.hobbies,
            occupation: nextPayload.occupation,
            bio: nextPayload.bio,
            country: nextPayload.country,
            countryCode: nextPayload.countryCode,
            state: nextPayload.state,
            stateCode: nextPayload.stateCode,
            city: nextPayload.city,
            phone: effectivePhone,
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
            storefrontDefaultLocation: normalizedStorefrontLocation,
            storefrontDefaultRadiusMiles: normalizedStorefrontRadius ?? null,
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
      setAvatarFile(null);
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

  const dialCodeOptions = useMemo(
    () =>
      countryOptions
        .map((country) => {
          const dial = normalizeDialCode(country.phoneCode || "");
          if (!dial) return null;
          return { value: dial, label: `+${dial} ${country.name}` };
        })
        .filter((entry): entry is { value: string; label: string } => Boolean(entry)),
    [countryOptions]
  );

  if (!user) return null;

  const handleOpenKeyBackup = () => {
    refreshKeyBackup();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("key-backup:open"));
    }
  };

  const displayName =
    (profile.firstName || profile.lastName
      ? `${profile.firstName || ""} ${profile.lastName || ""}`.trim()
      : user.email) || "Member";
  const displayHandle =
    profile.handle && profile.handle.toLowerCase() !== "user"
      ? profile.handle
      : lockedUniqueHandle;
  const avatarImg = avatarPreviewUrl || profile.avatarUrl;
  const initials =
    displayName
      ?.split(" ")
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "ME";
  const effectivePhoneDialCode = normalizeDialCode(
    profile.phoneDialCode ||
      resolveDialCodeForCountry(
        profile.countryCode || "",
        profile.country || "",
        countryOptions
      )
  );
  const phoneDigitsCount = extractNationalDigits(
    profile.phone,
    effectivePhoneDialCode
  ).length;
  const phoneLink = buildTelLink(profile.phone, effectivePhoneDialCode);
  const phoneDisplay = formatPhoneDisplay(profile.phone, effectivePhoneDialCode);
  const canDial = phoneDigitsCount === 10;
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
  const isCustomVisibility = profile.profileVisibility === "custom";
  const profileVisibilitySummary = useMemo(() => {
    const summary = [
      `Visibility: ${visibilityLabelFor(profile.profileVisibility)}`,
      `Search: ${profile.searchIndexingEnabled ? "On" : "Off"}`,
    ];
    if (profile.profileVisibility === "public") {
      summary.push(`External: ${profile.externalIndexingEnabled ? "On" : "Off"}`);
    }
    return summary;
  }, [
    profile.profileVisibility,
    profile.searchIndexingEnabled,
    profile.externalIndexingEnabled,
  ]);
  const whoCanSeeSummary = useMemo(() => {
    if (!isCustomVisibility) {
      return [
        "Using profile visibility for all fields",
        `Phone: ${profile.showPhoneOnProfile ? "On" : "Off"}`,
      ];
    }
    return [
      `Bio: ${visibilityLabelFor(profile.privacySettings.bio)}`,
      `Links: ${visibilityLabelFor(profile.privacySettings.links)}`,
      `Location: ${visibilityLabelFor(profile.privacySettings.location)}`,
      `Birthday: ${visibilityLabelFor(profile.privacySettings.birthday)}`,
      `Followers: ${visibilityLabelFor(profile.privacySettings.followers)}`,
      `Following: ${visibilityLabelFor(profile.privacySettings.following)}`,
      `Phone: ${profile.showPhoneOnProfile ? "On" : "Off"}`,
    ];
  }, [isCustomVisibility, profile.privacySettings, profile.showPhoneOnProfile]);
  const activitySummary = useMemo(
    () => [`Visible to: ${visibilityLabelFor(profile.activityVisibility)}`],
    [profile.activityVisibility]
  );
  const reminderSummary = useMemo(
    () => [`Reminders: ${reminderLabelFor(goalReminder)}`],
    [goalReminder]
  );
  const newsSummary = useMemo(
    () => [dashboardNewsEnabled ? "Newsroom: On" : "Newsroom: Off"],
    [dashboardNewsEnabled]
  );
  const previewSummary = useMemo(
    () => [`Previewing as ${previewAudienceLabel}`],
    [previewAudienceLabel]
  );
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
  const isDeactivated =
    Boolean(accountStatus?.deactivatedUntil) &&
    new Date(accountStatus?.deactivatedUntil as string).getTime() > Date.now();
  const exportOs = useMemo(() => detectDesktopOs(), []);
  const exportHint = useMemo(() => getExportInstructions(exportOs), [exportOs]);
  const leftInfo = [
    ["First Name", profile.firstName],
    ["Last Name", profile.lastName],
    ["Age", profile.age],
    ["Birthday", birthdayDisplay],
    ["Religion", profile.religion],
    ["Gender", profile.gender],
  ] as const;
  const phoneInfo: Array<[string, string | undefined]> = profile.showPhoneOnProfile
    ? [["Phone", phoneDisplay || profile.phone]]
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
  const hasVisibleProfileData = Boolean(
    String(profile.firstName || "").trim() ||
      String(profile.lastName || "").trim() ||
      String(profile.age || "").trim() ||
      String(profile.birthday || "").trim() ||
      String(profile.religion || "").trim() ||
      String(profile.gender || "").trim() ||
      String(profile.phone || "").trim() ||
      String(profile.country || "").trim() ||
      String(profile.state || "").trim() ||
      String(profile.city || "").trim() ||
      String(profile.hobbies || "").trim() ||
      String(profile.occupation || "").trim() ||
      String(profile.bio || "").trim()
  );
  const showProfileKeyWarning =
    (profileDecryptFailed || keyBackupStatus === "needs-restore") &&
    !hasVisibleProfileData;

  const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
    { id: "appearance", label: "Background & Chat" },
    { id: "security", label: "Account & Security" },
    { id: "privacy", label: "Visibility & Discoverability" },
    { id: "notifications", label: "Sound, Vibration & Quiet Hours" },
    { id: "storefront", label: "StoreFront Defaults" },
    { id: "time-limits", label: "Time Limits" },
    { id: "language", label: "Language Options" },
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
      setProfileView("overview");
      setSettingsMenuOpen(false);
      setEditing(false);
      navigate("/me");
      return;
    }
    setSettingsSection(value);
    setSettingsView("settings");
    setProfileView("overview");
    setSettingsMenuOpen(false);
    setEditing(false);
    navigate(`/me?view=settings&section=${value}`);
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
      {showProfileKeyWarning && (
        <section className="panel profile-key-warning">
          <div className="profile-key-warning-inner">
            <div>
              <p className="profile-key-warning-title">Unlock your profile</p>
              <p className="profile-key-warning-text">
                Your profile data is encrypted and can’t be unlocked on this device yet.
                Restore your key backup to load your details.
              </p>
            </div>
            <div className="profile-key-warning-actions">
              <button className="btn primary" type="button" onClick={handleOpenKeyBackup}>
                Restore profile
              </button>
              <button
                className="btn ghost"
                type="button"
                onClick={refreshKeyBackup}
              >
                Refresh
              </button>
            </div>
          </div>
        </section>
      )}
      <section className="panel profile-header-panel">
        <div className="profile-header-avatar-overlay" aria-hidden="true">
          {avatarImg ? (
            <img src={avatarImg} alt="" loading="lazy" decoding="async" />
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
                setProfileInfoOpen(true);
                setProfileView("overview");
                navigate("/me");
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
            <button
              className="btn ghost profile-header-action-button"
              type="button"
              onClick={() => {
                setSettingsMenuOpen(false);
                setProfileView("overview");
                navigate(isGalleryPage ? "/me" : "/my-gallery");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              {isGalleryPage ? "Back to Profile" : "My Gallery"}
            </button>
            <button
              className="btn ghost profile-header-action-button"
              type="button"
              onClick={() => {
                setSettingsMenuOpen(false);
                setProfileView("overview");
                navigate(isPostsPage ? "/me" : "/my-posts");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              {isPostsPage ? "Back to Profile" : "My Posts"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
  const iconStrokeProps = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  const ProfileInfoIcon = ({ label }: { label: string }) => {
    switch (label) {
      case "First Name":
      case "Last Name":
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="8" r="4" {...iconStrokeProps} />
            <path d="M4 20c1.6-4 14.4-4 16 0" {...iconStrokeProps} />
          </svg>
        );
      case "Handle":
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M8 12h8" {...iconStrokeProps} />
            <path d="M6 7h6a4 4 0 0 1 0 8H6" {...iconStrokeProps} />
            <path d="M18 17h-6a4 4 0 0 1 0-8h6" {...iconStrokeProps} />
          </svg>
        );
      case "Age":
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="8" r="4" {...iconStrokeProps} />
            <path d="M4 20c1.6-4 14.4-4 16 0" {...iconStrokeProps} />
          </svg>
        );
      case "Birthday":
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 10h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9z" {...iconStrokeProps} />
            <path d="M7 10V8a2 2 0 0 1 4 0v2" {...iconStrokeProps} />
            <path d="M13 10V8a2 2 0 0 1 4 0v2" {...iconStrokeProps} />
            <path d="M4 14h16" {...iconStrokeProps} />
          </svg>
        );
      case "Religion":
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 3v18" {...iconStrokeProps} />
            <path d="M7 8h10" {...iconStrokeProps} />
            <path d="M6 21h12" {...iconStrokeProps} />
          </svg>
        );
      case "Gender":
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="9" cy="10" r="4" {...iconStrokeProps} />
            <path d="M13 6l5-5m0 0h-4m4 0v4" {...iconStrokeProps} />
            <path d="M9 14v6m-3-3h6" {...iconStrokeProps} />
          </svg>
        );
      case "Phone":
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 3h6l1 4-3 1c1 2 3 4 5 5l1-3 4 1v6c-8 0-14-6-14-14z" {...iconStrokeProps} />
          </svg>
        );
      case "Location":
      case "Country":
      case "State":
      case "City":
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3c-3.3 0-6 2.7-6 6 0 4.2 6 12 6 12s6-7.8 6-12c0-3.3-2.7-6-6-6z"
              {...iconStrokeProps}
            />
            <circle cx="12" cy="9" r="2.2" {...iconStrokeProps} />
          </svg>
        );
      case "Hobbies":
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z"
              {...iconStrokeProps}
            />
          </svg>
        );
      case "Occupation":
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <rect x="3" y="7" width="18" height="12" rx="2" {...iconStrokeProps} />
            <path d="M9 7V5h6v2" {...iconStrokeProps} />
            <path d="M3 13h18" {...iconStrokeProps} />
          </svg>
        );
      case "Bio":
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M4 12h12M4 18h8" {...iconStrokeProps} />
          </svg>
        );
      default:
        return (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" {...iconStrokeProps} />
            <path d="M12 8v4m0 4h.01" {...iconStrokeProps} />
          </svg>
        );
    }
  };

  const renderInfoCard = (label: string, value?: string) => (
    <div className="profile-card" key={label}>
      <div className="profile-card-icon">
        <ProfileInfoIcon label={label} />
      </div>
      <div className="profile-card-content">
        <p className="profile-card-label">{label}</p>
        {label === "Phone" ? (
          <p className="profile-card-value">
            {phoneLink ? (
              canDial ? (
                <a href={`tel:${phoneLink}`} className="profile-card-link">
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
              <div className="profile-phone-row">
                <select
                  className="auth-input profile-phone-code"
                  value={effectivePhoneDialCode}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      phoneDialCode: normalizeDialCode(e.target.value),
                    })
                  }
                  disabled={isPhoneLocked}
                >
                  <option value="">Code</option>
                  {dialCodeOptions.map((option) => (
                    <option key={`${option.value}-${option.label}`} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <input
                  className="auth-input profile-phone-number"
                  type="tel"
                  maxLength={14}
                  placeholder="(555) 123-4567"
                  value={profile.phone || ""}
                  onChange={(e) =>
                    setProfile({
                      ...profile,
                      phone: formatPhoneInput(e.target.value, effectivePhoneDialCode),
                    })
                  }
                  disabled={isPhoneLocked}
                />
              </div>
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
      <ProfilePhotoModal
        open={photoModalOpen}
        onClose={() => setPhotoModalOpen(false)}
      />
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

      <PopupModal
        open={activeHobbyModal !== null}
        title="Choose hobbies"
        onClose={closeHobbyModal}
        bodyClassName="comment-modal-body"
      >
        <div className="hobby-modal">
          <div className="hobby-modal__summary">
            <span>
              {hobbyList.length}/{MAX_HOBBIES} selected
            </span>
            <button
              className="btn ghost"
              type="button"
              onClick={() => updateHobbies([])}
              disabled={!hobbyList.length}
            >
              Clear all
            </button>
          </div>
          <div className="hobby-modal__search">
            <input
              className="auth-input"
              placeholder="Search hobbies"
              value={hobbyInput}
              onChange={(e) => setHobbyInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addHobby();
                }
              }}
            />
          </div>
          {hobbyError && <p className="status status-error">{hobbyError}</p>}
          <div className="hobby-modal__list">
            {hobbySuggestions.length ? (
              hobbySuggestions.map((hobby) => {
                const isSelected = hobbyList.some(
                  (entry) => hobbyKey(entry) === hobbyKey(hobby)
                );
                return (
                  <button
                    key={hobby}
                    className={`hobby-option${isSelected ? " is-selected" : ""}`}
                    type="button"
                    onClick={() => toggleHobbyValue(hobby)}
                    disabled={!isSelected && hobbyList.length >= MAX_HOBBIES}
                  >
                    <span>{hobby}</span>
                    <span className="hobby-option__state">
                      {isSelected ? "Added" : "Add"}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="hobby-option is-empty">No matches</div>
            )}
          </div>
          {hobbyList.length > 0 && (
            <div className="hobby-modal__selected">
              {hobbyList.map((hobby) => (
                <button
                  key={hobby}
                  type="button"
                  className="hobby-chip"
                  onClick={() => removeHobby(hobby)}
                >
                  <span>{hobby}</span>
                  <span aria-hidden="true">✕</span>
                </button>
              ))}
            </div>
          )}
          <div className="hobby-modal__actions">
            <button className="btn primary" type="button" onClick={closeHobbyModal}>
              Done
            </button>
          </div>
        </div>
      </PopupModal>

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

      {visibilityModalPost &&
        (() => {
          const activePost = visibilityModalPost;
          if (!activePost) return null;
          const currentVisibility = activePost.visibility || "friends";
          const trustedCircleName =
            activePost.trustedCircleName ||
            trustedCircleOptions.find(
              (group) => group.id === activePost.trustedCircleId
            )?.name ||
            trustedCircleOptions[0]?.name ||
            "Trusted Circle";
          const hasTrustedCircle = Boolean(
            activePost.trustedCircleId || trustedCircleOptions.length
          );
          const visibilityOptions: VisibilityOption[] = [
            {
              value: "public",
              label: "Public",
              hint: "Anyone can see this post.",
            },
            {
              value: "friends",
              label: "Friends",
              hint: "Only friends can see this post.",
            },
            {
              value: "trusted",
              label: "Trusted Circle",
              hint: hasTrustedCircle
                ? `Only ${trustedCircleName} can see this post.`
                : "Create a trusted circle to use this.",
              disabled: !hasTrustedCircle,
            },
            {
              value: "private",
              label: "Private",
              hint: "Only you can see this post.",
            },
          ];

          return (
            <div
              className="post-action-overlay"
              role="dialog"
              aria-modal="true"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setVisibilityModalPost(null);
                }
              }}
            >
              <div className="post-action-modal">
                <div className="post-action-modal__header">
                  <div>
                    <p className="post-action-modal__eyebrow">Visibility</p>
                    <h3 className="post-action-modal__title">Set visibility</h3>
                  </div>
                  <button
                    className="post-action-modal__close"
                    type="button"
                    onClick={() => setVisibilityModalPost(null)}
                    aria-label="Close visibility modal"
                  >
                    X
                  </button>
                </div>
                <div className="post-action-options">
                  {visibilityOptions.map((option) => {
                    const isActive = currentVisibility === option.value;
                    return (
                      <button
                        key={option.value}
                        className={`post-action-option${
                          isActive ? " is-active" : ""
                        }`}
                        type="button"
                        aria-pressed={isActive}
                        disabled={option.disabled}
                        onClick={() => {
                          if (!activePost) return;
                          setVisibilityModalPost(null);
                          void updatePostVisibility(activePost, option.value);
                        }}
                      >
                        <span className="post-action-option__title">{option.label}</span>
                        <span className="post-action-option__hint">{option.hint}</span>
                      </button>
                    );
                  })}
                </div>
                {currentVisibility === "trusted" && trustedCircleOptions.length > 0 && (
                  <label className="profile-media__modal-select">
                    <span>Trusted circle</span>
                    <select
                      className="auth-input profile-media__select"
                      value={
                        activePost.trustedCircleId ?? trustedCircleOptions[0]?.id ?? ""
                      }
                      onChange={(event) => {
                        const nextId = event.target.value ? Number(event.target.value) : "";
                        if (!nextId) return;
                        const nextName = trustedCircleOptions.find(
                          (group) => group.id === Number(nextId)
                        )?.name;
                        setVisibilityModalPost((prev) =>
                          prev
                            ? {
                                ...prev,
                                trustedCircleId: Number(nextId),
                                trustedCircleName: nextName,
                              }
                            : prev
                        );
                        void updatePostVisibility(
                          {
                            ...activePost,
                            trustedCircleId: Number(nextId),
                            trustedCircleName: nextName,
                          },
                          "trusted"
                        );
                      }}
                    >
                      {trustedCircleOptions.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            </div>
          );
        })()}

      {editPostModalPost && (
        <div
          className="post-action-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setEditPostModalPost(null);
            }
          }}
        >
          <div className="post-action-modal">
            <div className="post-action-modal__header">
              <div>
                <p className="post-action-modal__eyebrow">Post options</p>
                <h3 className="post-action-modal__title">Edit post</h3>
              </div>
              <button
                className="post-action-modal__close"
                type="button"
                onClick={() => setEditPostModalPost(null)}
                aria-label="Close edit post modal"
              >
                X
              </button>
            </div>
            <div className="post-action-options">
              <button
                className="post-action-option"
                type="button"
                onClick={() => {
                  const postKey = String(editPostModalPost.id);
                  setEditingPostId(postKey);
                  setEditPostText(sanitizePostText(editPostModalPost.text));
                  setEditPostModalPost(null);
                }}
              >
                <span className="post-action-option__title">Edit post</span>
                <span className="post-action-option__hint">
                  Update the text for this post.
                </span>
              </button>
              <button
                className="post-action-option is-danger"
                type="button"
                onClick={() => {
                  setEditPostModalPost(null);
                  setDeletePostTarget(editPostModalPost);
                }}
              >
                <span className="post-action-option__title">Delete post</span>
                <span className="post-action-option__hint">
                  Remove this post permanently.
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {mediaVisibilityModalItem &&
        (() => {
          const activeItem = mediaVisibilityModalItem;
          if (!activeItem) return null;
          const currentVisibility = activeItem.visibility || "friends";
          const trustedCircleName =
            activeItem.trustedCircleName ||
            trustedCircleOptions.find(
              (group) => group.id === activeItem.trustedCircleId
            )?.name ||
            trustedCircleOptions[0]?.name ||
            "Trusted Circle";
          const hasTrustedCircle = Boolean(
            activeItem.trustedCircleId || trustedCircleOptions.length
          );
          const visibilityOptions: VisibilityOption[] = [
            {
              value: "public",
              label: "Public",
              hint: "Anyone can see this media.",
            },
            {
              value: "friends",
              label: "Friends",
              hint: "Only friends can see this media.",
            },
            {
              value: "trusted",
              label: "Trusted Circle",
              hint: hasTrustedCircle
                ? `Only ${trustedCircleName} can see this media.`
                : "Create a trusted circle to use this.",
              disabled: !hasTrustedCircle,
            },
            {
              value: "private",
              label: "Private",
              hint: "Only you can see this media.",
            },
          ];

          return (
            <div
              className="post-action-overlay"
              role="dialog"
              aria-modal="true"
              onClick={(event) => {
                if (event.target === event.currentTarget) {
                  setMediaVisibilityModalItem(null);
                }
              }}
            >
              <div className="post-action-modal">
                <div className="post-action-modal__header">
                  <div>
                    <p className="post-action-modal__eyebrow">Visibility</p>
                    <h3 className="post-action-modal__title">Set visibility</h3>
                  </div>
                  <button
                    className="post-action-modal__close"
                    type="button"
                    onClick={() => setMediaVisibilityModalItem(null)}
                    aria-label="Close visibility modal"
                  >
                    X
                  </button>
                </div>
                <div className="post-action-options">
                  {visibilityOptions.map((option) => {
                    const isActive = currentVisibility === option.value;
                    return (
                      <button
                        key={option.value}
                        className={`post-action-option${
                          isActive ? " is-active" : ""
                        }`}
                        type="button"
                        aria-pressed={isActive}
                        disabled={option.disabled}
                        onClick={() => {
                          if (!activeItem) return;
                          setMediaVisibilityModalItem(null);
                          void updateMediaVisibility(
                            activeItem,
                            option.value
                          );
                        }}
                      >
                        <span className="post-action-option__title">{option.label}</span>
                        <span className="post-action-option__hint">{option.hint}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })()}

      {mediaEditModalItem && (
        <div
          className="post-action-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setMediaEditModalItem(null);
            }
          }}
        >
          <div className="post-action-modal">
            <div className="post-action-modal__header">
              <div>
                <p className="post-action-modal__eyebrow">Media options</p>
                <h3 className="post-action-modal__title">Edit media</h3>
              </div>
              <button
                className="post-action-modal__close"
                type="button"
                onClick={() => setMediaEditModalItem(null)}
                aria-label="Close edit media modal"
              >
                X
              </button>
            </div>
            <div className="post-action-options">
              <button
                className="post-action-option"
                type="button"
                onClick={() => {
                  const mediaKey = String(mediaEditModalItem.id);
                  setEditingMediaId(mediaKey);
                  setMediaEditTitle(mediaEditModalItem.title || "");
                  setMediaEditCaption(mediaEditModalItem.caption || "");
                  setMediaEditFolder(mediaEditModalItem.folder || "");
                  setMediaEditModalItem(null);
                }}
              >
                <span className="post-action-option__title">Edit details</span>
                <span className="post-action-option__hint">
                  Update the title or caption.
                </span>
              </button>
              <button
                className="post-action-option"
                type="button"
                onClick={() => {
                  setMediaMoveModalItem(mediaEditModalItem);
                  setMediaEditModalItem(null);
                }}
              >
                <span className="post-action-option__title">Move to folder</span>
                <span className="post-action-option__hint">
                  Choose or create a folder for this media.
                </span>
              </button>
              <button
                className="post-action-option is-danger"
                type="button"
                onClick={() => {
                  setMediaEditModalItem(null);
                  setMediaDeleteTarget(mediaEditModalItem);
                }}
              >
                <span className="post-action-option__title">Delete media</span>
                <span className="post-action-option__hint">
                  Remove this media permanently.
                </span>
              </button>
            </div>
          </div>
        </div>
      )}

      {mediaMoveModalItem && (
        <div
          className="post-action-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeMediaMoveModal();
            }
          }}
        >
          <div className="post-action-modal">
            <div className="post-action-modal__header">
              <div>
                <p className="post-action-modal__eyebrow">Folders</p>
                <h3 className="post-action-modal__title">Move to folder</h3>
              </div>
              <button
                className="post-action-modal__close"
                type="button"
                onClick={closeMediaMoveModal}
                aria-label="Close move to folder modal"
              >
                X
              </button>
            </div>
            <div className="post-action-options">
              <button
                className="post-action-option"
                type="button"
                disabled={mediaMoveFolderOpen}
                onClick={() => {
                  setMediaMoveFolderOpen(true);
                  setMediaMoveFolderError(null);
                }}
              >
                <span className="post-action-option__title">New folder</span>
                <span className="post-action-option__hint">
                  Create a folder and move this media.
                </span>
              </button>
              {mediaMoveFolderOpen && (
                <div className="profile-media__folder-create">
                  <input
                    className="auth-input"
                    placeholder="Folder name"
                    autoFocus
                    value={mediaMoveFolderName}
                    onChange={(event) => {
                      setMediaMoveFolderName(event.target.value);
                      if (mediaMoveFolderError) setMediaMoveFolderError(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleMoveToNewFolder();
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        cancelMediaMoveFolderCreate();
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn primary"
                    onClick={handleMoveToNewFolder}
                  >
                    Create & move
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={cancelMediaMoveFolderCreate}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {mediaMoveFolderError && (
                <p className="status status-error">{mediaMoveFolderError}</p>
              )}
              <button
                className="post-action-option"
                type="button"
                onClick={() => {
                  if (!mediaMoveModalItem) return;
                  const item = mediaMoveModalItem;
                  closeMediaMoveModal();
                  void updateMediaFolder(item, null);
                }}
              >
                <span className="post-action-option__title">Remove from folder</span>
                <span className="post-action-option__hint">Keep it in all media.</span>
              </button>
              {mediaFolderOptions.map((folder) => (
                <button
                  key={folder}
                  className="post-action-option"
                  type="button"
                  onClick={() => {
                    if (!mediaMoveModalItem) return;
                    const item = mediaMoveModalItem;
                    closeMediaMoveModal();
                    void updateMediaFolder(item, folder);
                  }}
                >
                  <span className="post-action-option__title">{folder}</span>
                  <span className="post-action-option__hint">
                    Move into this folder.
                  </span>
                </button>
              ))}
              {mediaFolderOptions.length === 0 && !mediaMoveFolderOpen && (
                <p className="status">
                  No folders yet. Create one here to get started.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {mediaDeleteTarget && (
        <div
          className="post-action-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setMediaDeleteTarget(null);
            }
          }}
        >
          <div className="post-action-modal is-danger">
            <div className="post-action-modal__header">
              <div>
                <p className="post-action-modal__eyebrow">Confirm</p>
                <h3 className="post-action-modal__title">
                  Are you sure you want to delete this
                </h3>
              </div>
              <button
                className="post-action-modal__close"
                type="button"
                onClick={() => setMediaDeleteTarget(null)}
                aria-label="Close delete confirmation"
              >
                X
              </button>
            </div>
            <p className="post-action-confirm">
              This action cannot be undone.
            </p>
            <div className="post-action-footer">
              <button
                className="btn ghost"
                type="button"
                onClick={() => setMediaDeleteTarget(null)}
              >
                No, Do Not Delete
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  if (mediaDeleteTarget) {
                    void deleteMediaItem(mediaDeleteTarget);
                    setMediaDeleteTarget(null);
                  }
                }}
              >
                Yes, I'm Sure
              </button>
            </div>
          </div>
        </div>
      )}

      {deletePostTarget && (
        <div
          className="post-action-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setDeletePostTarget(null);
            }
          }}
        >
          <div className="post-action-modal is-danger">
            <div className="post-action-modal__header">
              <div>
                <p className="post-action-modal__eyebrow">Confirm</p>
                <h3 className="post-action-modal__title">
                  Are you sure you want to delete this
                </h3>
              </div>
              <button
                className="post-action-modal__close"
                type="button"
                onClick={() => setDeletePostTarget(null)}
                aria-label="Close delete confirmation"
              >
                X
              </button>
            </div>
            <p className="post-action-confirm">
              This action cannot be undone.
            </p>
            <div className="post-action-footer">
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
        onSettingsViewChange={(nextView) => {
          setSettingsView(nextView);
          if (nextView === "settings") {
            setProfileView("overview");
          }
        }}
        settingsSection={settingsSection}
        onSettingsSectionChange={(section) => {
          setSettingsSection(section);
          setSettingsView("settings");
          setProfileView("overview");
        }}
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
                  Update the background for dashboard, friends, profile, and news in one place.
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
                    <span className="profile-field-label">Background color opacity</span>
                    <input
                      className="appearance-range"
                      type="range"
                      min={0.1}
                      max={1}
                      step={0.05}
                      value={appearanceColorOpacity}
                      onChange={(e) =>
                        handleBackgroundColorOpacity(Number(e.target.value))
                      }
                    />
                    <small className="profile-appearance-sub">
                      Current opacity: {Math.round(appearanceColorOpacity * 100)}%
                    </small>
                  </label>

                  <div className="profile-field">
                    <span className="profile-field-label">Background gradient</span>
                    <label className="profile-check appearance-gradient-toggle">
                      <input
                        type="checkbox"
                        checked={appearanceGradientEnabled}
                        onChange={(e) => toggleGradient(e.target.checked)}
                      />
                      <span className="profile-check__track" aria-hidden="true">
                        <span className="profile-check__thumb" />
                      </span>
                      <span className="profile-check__label">Enable gradient overlay</span>
                    </label>
                    {appearanceGradientEnabled && (
                      <div className="appearance-gradient-grid">
                        <div>
                          <span className="profile-field-label">Gradient start</span>
                          <div className="appearance-color-row">
                            <input
                              type="color"
                              value={appearanceGradientStart}
                              onChange={(e) =>
                                setBackgroundAll({ gradientStart: e.target.value })
                              }
                              aria-label="Gradient start color"
                            />
                            <input
                              className="auth-input"
                              value={currentBackground.gradientStart || ""}
                              placeholder="#2563eb"
                              onChange={(e) =>
                                setBackgroundAll({
                                  gradientStart: e.target.value.trim(),
                                })
                              }
                            />
                          </div>
                        </div>
                        <div>
                          <span className="profile-field-label">Gradient end</span>
                          <div className="appearance-color-row">
                            <input
                              type="color"
                              value={appearanceGradientEnd}
                              onChange={(e) =>
                                setBackgroundAll({ gradientEnd: e.target.value })
                              }
                              aria-label="Gradient end color"
                            />
                            <input
                              className="auth-input"
                              value={currentBackground.gradientEnd || ""}
                              placeholder="#22d3ee"
                              onChange={(e) =>
                                setBackgroundAll({
                                  gradientEnd: e.target.value.trim(),
                                })
                              }
                            />
                          </div>
                        </div>
                        <label className="profile-field">
                          <span className="profile-field-label">Gradient angle</span>
                          <input
                            className="appearance-range"
                            type="range"
                            min={0}
                            max={360}
                            step={1}
                            value={appearanceGradientAngle}
                            onChange={(e) =>
                              setBackgroundAll({
                                gradientAngle: Number(e.target.value),
                              })
                            }
                          />
                          <small className="profile-appearance-sub">
                            {appearanceGradientAngle}°
                          </small>
                        </label>
                        <label className="profile-field">
                          <span className="profile-field-label">Gradient opacity</span>
                          <input
                            className="appearance-range"
                            type="range"
                            min={0.1}
                            max={1}
                            step={0.05}
                            value={appearanceGradientOpacity}
                            onChange={(e) =>
                              setBackgroundAll({
                                gradientOpacity: Number(e.target.value),
                              })
                            }
                          />
                          <small className="profile-appearance-sub">
                            {Math.round(appearanceGradientOpacity * 100)}%
                          </small>
                        </label>
                      </div>
                    )}
                  </div>

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

        {!isSettingsView && !isPostsPage && !isGalleryPage && (
        <div className="panel-grid">
          <section className="panel">
            <div
              className={`panel-header profile-info-header${
                profileInfoOpen ? "" : " is-collapsed"
              }`}
            >
              <button
                className="profile-info-toggle"
                type="button"
                onClick={() => setProfileInfoOpen((prev) => !prev)}
                aria-expanded={profileInfoOpen}
                aria-controls="profile-info-content"
              >
                <h3>Your Profile</h3>
                <span
                  className={`profile-info-chevron${profileInfoOpen ? " is-open" : ""}`}
                  aria-hidden="true"
                >
                  <svg viewBox="0 0 20 20">
                    <path
                      d="M5 7.5 10 12.5 15 7.5"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
            </div>

            {profileInfoOpen && (
            <div id="profile-info-content">
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
                    <div className="profile-phone-row">
                      <select
                        className="auth-input profile-phone-code"
                        value={effectivePhoneDialCode}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            phoneDialCode: normalizeDialCode(e.target.value),
                          })
                        }
                        disabled={isPhoneLocked}
                      >
                        <option value="">Code</option>
                        {dialCodeOptions.map((option) => (
                          <option key={`${option.value}-${option.label}`} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <input
                        className="auth-input profile-phone-number"
                        type="tel"
                        maxLength={14}
                        placeholder="(555) 123-4567"
                        value={profile.phone || ""}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            phone: formatPhoneInput(e.target.value, effectivePhoneDialCode),
                          })
                        }
                        disabled={isPhoneLocked}
                      />
                    </div>
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
                    <button
                      className="btn primary profile-avatar-editor-button"
                      type="button"
                      onClick={() => setPhotoModalOpen(true)}
                    >
                      {profile.avatarUrl ? "Edit Profile Photo" : "Add Profile Photo"}
                    </button>
                    <small className="profile-avatar-helper">
                      Use the photo studio to crop, enhance, and schedule your avatars.
                    </small>
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
            </div>
            )}
          </section>
          <section className="panel trusted-circle-panel">
            <div
              className={`panel-header profile-info-header${
                trustedCirclesOpen ? "" : " is-collapsed"
              }`}
            >
              <button
                type="button"
                className="profile-info-toggle"
                onClick={() => setTrustedCirclesOpen((prev) => !prev)}
                aria-expanded={trustedCirclesOpen}
              >
                <h3>My Trusted Circles</h3>
                <span className="trusted-circle__meta">
                  <span className="trusted-circle__count">
                    {trustedCircles.length}/{MAX_TRUSTED_CIRCLES}
                  </span>
                  <span
                    className={`profile-info-chevron${
                      trustedCirclesOpen ? " is-open" : ""
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
                </span>
              </button>
            </div>
            {trustedCirclesOpen && (
              <>
                {trustedCircleError && (
                  <p className="status status-error">{trustedCircleError}</p>
                )}
                {trustedCircleSuccess && (
                  <p className="status status-success">{trustedCircleSuccess}</p>
                )}
                {trustedCircleLoading ? (
                  <p className="status">Loading trusted circles...</p>
                ) : (
                  <>
                    <div className="trusted-circle__create">
                      <input
                        className="auth-input"
                        placeholder="Name your trusted circle"
                        value={trustedCircleName}
                        onChange={(event) => setTrustedCircleName(event.target.value)}
                        maxLength={40}
                        disabled={
                          trustedCircleBusy ||
                          trustedCircles.length >= MAX_TRUSTED_CIRCLES
                        }
                      />
                      <button
                        className="btn primary"
                        type="button"
                        disabled={
                          trustedCircleBusy ||
                          trustedCircles.length >= MAX_TRUSTED_CIRCLES ||
                          !trustedCircleName.trim()
                        }
                        onClick={() => void createTrustedCircle()}
                      >
                        {trustedCircleBusy ? "Creating..." : "Create circle"}
                      </button>
                    </div>
                    {trustedCircles.length === 0 ? (
                      <p className="status">
                        Create your first trusted circle to add friends.
                      </p>
                    ) : (
                      <>
                        <div className="trusted-circle__tabs">
                          {trustedCircles.map((circle) => (
                            <button
                              key={circle.id}
                              type="button"
                              className={`trusted-circle__tab${
                                circle.id === activeTrustedCircle?.id ? " is-active" : ""
                              }`}
                              onClick={() => setActiveTrustedCircleId(circle.id)}
                            >
                              {circle.name}
                            </button>
                          ))}
                        </div>
                        {activeTrustedCircle && (
                          <div className="trusted-circle__editor">
                            {trustedCircleRenaming ? (
                              <>
                                <input
                                  className="auth-input"
                                  value={trustedCircleRename}
                                  onChange={(event) =>
                                    setTrustedCircleRename(event.target.value)
                                  }
                                  maxLength={40}
                                />
                                <div className="trusted-circle__editor-actions">
                                  <button
                                    className="btn ghost"
                                    type="button"
                                    onClick={() => {
                                      setTrustedCircleRenaming(false);
                                      setTrustedCircleRename(activeTrustedCircle.name);
                                    }}
                                    disabled={trustedCircleSaving}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    className="btn primary"
                                    type="button"
                                    onClick={handleRenameTrustedCircle}
                                    disabled={
                                      trustedCircleSaving || !trustedCircleRename.trim()
                                    }
                                  >
                                    {trustedCircleSaving ? "Saving..." : "Save name"}
                                  </button>
                                </div>
                              </>
                            ) : (
                              <div className="trusted-circle__editor-row">
                                <div>
                                  <p className="trusted-circle__label">Active circle</p>
                                  <div className="trusted-circle__menu">
                                    <button
                                      className="btn ghost trusted-circle__menu-button"
                                      type="button"
                                      onClick={() =>
                                        setTrustedCircleMenuOpen((prev) => !prev)
                                      }
                                      disabled={trustedCircleSaving}
                                    >
                                      {activeTrustedCircle.name}
                                      <span className="trusted-circle__menu-caret">▾</span>
                                    </button>
                                    {trustedCircleMenuOpen && (
                                      <div className="trusted-circle__menu-list">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            cancelTrustedCircleEdits();
                                            setTrustedCircleRenaming(true);
                                            setTrustedCircleMenuOpen(false);
                                          }}
                                        >
                                          Rename
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setTrustedCircleEditing(true);
                                            setTrustedCircleMenuOpen(false);
                                          }}
                                        >
                                          Edit friends
                                        </button>
                                        <button
                                          type="button"
                                          className="danger"
                                          onClick={() => {
                                            setTrustedCircleMenuOpen(false);
                                            setTrustedCircleDeleteTarget(activeTrustedCircle);
                                            setTrustedCircleDeleteOpen(true);
                                          }}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="goals-panel__trusted">
                          <div className="goals-panel__trusted-group">
                            <div className="goals-panel__trusted-header">
                              <h5>{activeTrustedCircle?.name || "Trusted friends"}</h5>
                              <div className="goals-panel__trusted-actions">
                                <button
                                  className="btn ghost"
                                  type="button"
                                  disabled={
                                    trustedCircleBusy || !activeTrustedCircle?.id
                                  }
                                  onClick={clearTrustedFriends}
                                >
                                  Clear
                                </button>
                              </div>
                            </div>
                            {trustedFriendOptions.length === 0 ? (
                              <p className="goals-empty">
                                Add friends to build a trusted circle.
                              </p>
                            ) : (
                              <>
                                <div className="goals-panel__trusted-picker">
                                  <div className="goals-panel__select">
                                    <select
                                      className="auth-input goals-select"
                                      value={trustedFriendPicker}
                                      onChange={(event) => {
                                        const value = event.target.value;
                                        setTrustedFriendPicker(value);
                                        const nextId = Number(value);
                                        if (Number.isFinite(nextId)) {
                                          queueTrustedFriend(nextId);
                                        }
                                        setTrustedFriendPicker("");
                                      }}
                                      disabled={
                                        !canEditTrustedCircle ||
                                        trustedCircleBusy ||
                                        !activeTrustedCircle?.id
                                      }
                                    >
                                      <option value="">Select a friend to trust</option>
                                      {trustedFriendOptions.map((friend) => (
                                        <option
                                          key={friend.id}
                                          value={friend.id}
                                          disabled={
                                            trustedMemberIds.has(friend.id) ||
                                            friend.id === user?.id
                                          }
                                        >
                                          {friend.label}
                                        </option>
                                      ))}
                                    </select>
                                    <span className="goals-select-caret" />
                                  </div>
                                </div>
                                {canEditTrustedCircle && pendingTrustedAddOptions.length > 0 && (
                                  <div className="trusted-circle__pending">
                                    <p className="trusted-circle__pending-label">Pending</p>
                                    <div className="trusted-circle__pending-list">
                                      {pendingTrustedAddOptions.map((friend) => (
                                        <span
                                          key={friend.id}
                                          className="trusted-circle__pending-chip"
                                        >
                                          {friend.label}
                                        </span>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {canEditTrustedCircle && (
                                  <div className="trusted-circle__apply">
                                    <button
                                      className="btn ghost"
                                      type="button"
                                      onClick={cancelTrustedCircleEdits}
                                      disabled={
                                        trustedCircleBusy || !trustedCircleEditing
                                      }
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      className="btn primary"
                                      type="button"
                                      onClick={() => void applyTrustedCircleChanges()}
                                      disabled={!hasPendingTrustedChanges || trustedCircleBusy}
                                    >
                                      {trustedCircleBusy ? "Saving..." : "Apply changes"}
                                    </button>
                                  </div>
                                )}
                                <div className="goals-panel__trusted-list">
                                  {trustedCircleFriendRows.map((row) => {
                                    const avatarUrl = row.avatarUrl;
                                    return (
                                      <div key={row.member.id} className="trusted-friend-row">
                                        <button
                                          type="button"
                                          className={`trusted-friend-toggle${
                                            pendingTrustedRemoveSet.has(row.member.id)
                                              ? " is-remove"
                                              : " is-active"
                                          }${avatarUrl ? " has-avatar" : ""}${
                                            canEditTrustedCircle ? "" : " is-locked"
                                          }`}
                                          onClick={() => togglePendingRemoval(row.member)}
                                          disabled={!canEditTrustedCircle}
                                          aria-pressed={
                                            !pendingTrustedRemoveSet.has(row.member.id)
                                          }
                                          aria-label={
                                            pendingTrustedRemoveSet.has(row.member.id)
                                              ? "Marked for removal"
                                              : "Trusted friend"
                                          }
                                        >
                                          {avatarUrl ? (
                                            <img
                                              className="trusted-friend-toggle__avatar"
                                              src={avatarUrl}
                                              alt={row.label}
                                              loading="lazy"
                                              decoding="async"
                                            />
                                          ) : (
                                            <>
                                              <span className="trusted-friend-toggle__ring" />
                                              <span className="trusted-friend-toggle__dot" />
                                            </>
                                          )}
                                        </button>
                                        <span
                                          className={`trusted-friend-name${
                                            pendingTrustedRemoveSet.has(row.member.id)
                                              ? " is-muted"
                                              : ""
                                          }`}
                                        >
                                          {row.label}
                                        </span>
                                        {pendingTrustedRemoveSet.has(row.member.id) && (
                                          <span className="trusted-friend-tag">Remove</span>
                                        )}
                                      </div>
                                    );
                                  })}
                                  {trustedCircleFriendRows.length === 0 && (
                                    <p className="goals-empty">No trusted friends yet.</p>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </div>
                      </>
                    )}
                  </>
                )}
              </>
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

            <div className="security-grid security-grid--quad">
              <div className="security-card">
                <h4>Password reset</h4>
                <p className="security-muted">
                  {isPhonePlaceholderAccount
                    ? "We will send a password reset link to your phone number."
                    : "We will email a reset link to your email address."}
                </p>
                <button
                  className="btn ghost"
                  type="button"
                  onClick={handlePasswordReset}
                  disabled={passwordResetLoading}
                >
                  {passwordResetLoading
                    ? "Sending..."
                    : isPhonePlaceholderAccount
                    ? "Send reset link"
                    : "Send reset email"}
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
                    <span className="profile-check__track" aria-hidden="true">
                      <span className="profile-check__thumb" />
                    </span>
                    <span className="profile-check__label">Enable 2FA</span>
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
                <div className="security-row">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleTwoFactorReset}
                    disabled={twoFactorResetting || twoFactorLoading}
                  >
                    {twoFactorResetting ? "Resetting..." : "Reset 2FA"}
                  </button>
                  <p className="security-muted">
                    Use this if your authenticator is out of sync. We will re-enroll you.
                  </p>
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

              <div className="security-card">
                <h4>Age verification</h4>
                <p className="security-muted">
                  Verify your age within 1 week of account creation to keep your account
                  active.
                </p>
                {ageVerified ? (
                  <p className="status status-success">Age verified.</p>
                ) : ageVerificationOverdue ? (
                  <p className="status status-error">
                    Verification overdue. Please verify now to unlock your account.
                  </p>
                ) : (
                  <p className="status status-warning">
                    Verification required{ageVerificationDaysRemaining !== null
                      ? ` (${ageVerificationDaysRemaining} day${
                          ageVerificationDaysRemaining === 1 ? "" : "s"
                        } left)`
                      : ""}.
                  </p>
                )}
                {!ageVerified && (
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => navigate("/me?section=security&ageVerify=1")}
                  >
                    Verify now
                  </button>
                )}
                {ageVerificationDueAt && !ageVerified && (
                  <p className="security-muted">
                    Verification due {formatDateTime(ageVerificationDueAt)}.
                  </p>
                )}
                {ageVerified && user?.ageVerifiedAt && (
                  <p className="security-muted">
                    Verified {formatDateTime(user.ageVerifiedAt)}.
                  </p>
                )}
              </div>

              <div className="security-card">
                <h4>Security questions (optional)</h4>
                <p className="security-muted">
                  Add three questions for support to verify your identity if your account is
                  locked. Answers are never shown, so re-enter them to update.
                </p>
                {securityQuestionsLoading ? (
                  <p className="security-muted">Loading security questions…</p>
                ) : (
                  <div className="security-questions security-questions--stack">
                    {securityQuestions.map((entry, index) => (
                      <div className="security-question-row" key={`security-${index}`}>
                        <select
                          className="auth-input"
                          value={entry.question}
                          onChange={(event) =>
                            updateSecurityQuestion(index, "question", event.target.value)
                          }
                        >
                          <option value="">Select a question</option>
                          {SECURITY_QUESTION_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                        <input
                          className="auth-input"
                          type="text"
                          placeholder="Answer"
                          value={entry.answer}
                          onChange={(event) =>
                            updateSecurityQuestion(index, "answer", event.target.value)
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
                <div className="security-actions">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleClearSecurityQuestions}
                    disabled={securityQuestionsSaving}
                  >
                    Clear
                  </button>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={handleSaveSecurityQuestions}
                    disabled={securityQuestionsSaving || securityQuestionsLoading}
                  >
                    {securityQuestionsSaving ? "Saving..." : "Save"}
                  </button>
                </div>
                {securityQuestionsSavedAt && (
                  <p className="security-muted">
                    Last updated {formatDateTime(securityQuestionsSavedAt)}.
                  </p>
                )}
                {securityQuestionsError && (
                  <p className="status status-error">{securityQuestionsError}</p>
                )}
                {securityQuestionsSuccess && (
                  <p className="status status-success">{securityQuestionsSuccess}</p>
                )}
              </div>
            </div>

            <div className="security-grid security-grid--stack">
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
          <section className="panel profile-settings-panel profile-settings-panel--privacy">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Privacy</p>
                <h3>Visibility &amp; Discoverability</h3>
                <p className="panel-sub">
                  Control who can see your profile and how it appears in search.
                </p>
              </div>
            </div>

            <div className="security-grid security-grid--notifications">
              <div className="security-card">
                <div className="security-card__header">
                  <span className="security-card__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path
                        d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <circle cx="12" cy="12" r="3.2" fill="currentColor" />
                    </svg>
                  </span>
                  <div className="security-card__header-content">
                    <div className="security-card__title-row">
                      <h4>Profile visibility</h4>
                      <button
                        className="security-card__edit"
                        type="button"
                        onClick={() => togglePrivacyEdit("profile")}
                        aria-expanded={privacyEdits.profile}
                        aria-controls="privacy-profile-body"
                      >
                        {privacyEdits.profile ? "Done" : "Edit"}
                      </button>
                    </div>
                    <p className="security-muted">
                      Choose an overall visibility or set custom rules below.
                    </p>
                  </div>
                </div>
                <div className="security-card__summary">
                  {profileVisibilitySummary.map((item) => (
                    <span key={item} className="security-summary-chip">
                      {item}
                    </span>
                  ))}
                </div>
                {privacyEdits.profile && (
                  <div className="security-card__body" id="privacy-profile-body">
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
                <label className="profile-check">
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
                  <span className="profile-check__track" aria-hidden="true">
                    <span className="profile-check__thumb" />
                  </span>
                  <span className="profile-check__label">
                    Allow my profile to appear in platform search
                  </span>
                </label>
                <label className="profile-check">
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
                  <span className="profile-check__track" aria-hidden="true">
                    <span className="profile-check__thumb" />
                  </span>
                  <span className="profile-check__label">
                    Allow search engines to index my public profile
                  </span>
                </label>
                {profile.profileVisibility !== "public" && (
                  <p className="security-muted">
                    External indexing is only available for public profiles.
                  </p>
                )}
                  </div>
                )}
              </div>

              <div className="security-card">
                <div className="security-card__header">
                  <span className="security-card__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path
                        d="M16 11a4 4 0 1 0-8 0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M4 21a8 8 0 0 1 16 0"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                      <path
                        d="M18.5 9.5a3 3 0 1 0-3-3"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.4"
                      />
                    </svg>
                  </span>
                  <div className="security-card__header-content">
                    <div className="security-card__title-row">
                      <h4>Who can see</h4>
                      <button
                        className="security-card__edit"
                        type="button"
                        onClick={() => togglePrivacyEdit("fields")}
                        aria-expanded={privacyEdits.fields}
                        aria-controls="privacy-fields-body"
                      >
                        {privacyEdits.fields ? "Done" : "Edit"}
                      </button>
                    </div>
                    <p className="security-muted">
                      Fine-tune visibility for key profile sections.
                    </p>
                  </div>
                </div>
                <div className="security-card__summary">
                  {whoCanSeeSummary.map((item) => (
                    <span key={item} className="security-summary-chip">
                      {item}
                    </span>
                  ))}
                </div>
                {privacyEdits.fields && (
                  <div className="security-card__body" id="privacy-fields-body">
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
                <label className="profile-check">
                  <input
                    type="checkbox"
                    checked={profile.showPhoneOnProfile}
                    onChange={(e) =>
                      setProfile({ ...profile, showPhoneOnProfile: e.target.checked })
                    }
                  />
                  <span className="profile-check__track" aria-hidden="true">
                    <span className="profile-check__thumb" />
                  </span>
                  <span className="profile-check__label">
                    Show my phone number to friends
                  </span>
                </label>
                <p className="security-muted">
                  Your phone stays private unless you enable this.
                </p>
                {!isCustomVisibility && (
                  <p className="security-muted">
                    Switch profile visibility to Custom to edit field-by-field.
                  </p>
                )}
                  </div>
                )}
              </div>

              <div className="security-card">
                <div className="security-card__header">
                  <span className="security-card__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <circle
                        cx="12"
                        cy="12"
                        r="8.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M12 7.5v5l3 2"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                  <div className="security-card__header-content">
                    <div className="security-card__title-row">
                      <h4>Activity status</h4>
                      <button
                        className="security-card__edit"
                        type="button"
                        onClick={() => togglePrivacyEdit("activity")}
                        aria-expanded={privacyEdits.activity}
                        aria-controls="privacy-activity-body"
                      >
                        {privacyEdits.activity ? "Done" : "Edit"}
                      </button>
                    </div>
                    <p className="security-muted">
                      Controls who can see “active now” or “last seen.”
                    </p>
                  </div>
                </div>
                <div className="security-card__summary">
                  {activitySummary.map((item) => (
                    <span key={item} className="security-summary-chip">
                      {item}
                    </span>
                  ))}
                </div>
                {privacyEdits.activity && (
                  <div className="security-card__body" id="privacy-activity-body">
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
                )}
              </div>

              <div className="security-card">
                <div className="security-card__header">
                  <span className="security-card__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path
                        d="M12 3.5c4 0 7.2 3.2 7.2 7.2v3.6l1.4 2.7H3.4l1.4-2.7v-3.6c0-4 3.2-7.2 7.2-7.2Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M9.2 19.6c.4 1.1 1.5 1.9 2.8 1.9s2.4-.8 2.8-1.9"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <div className="security-card__header-content">
                    <div className="security-card__title-row">
                      <h4>Goal reminders</h4>
                      <button
                        className="security-card__edit"
                        type="button"
                        onClick={() => togglePrivacyEdit("reminders")}
                        aria-expanded={privacyEdits.reminders}
                        aria-controls="privacy-reminders-body"
                      >
                        {privacyEdits.reminders ? "Done" : "Edit"}
                      </button>
                    </div>
                    <p className="security-muted">
                      Choose how often we remind you about your goals.
                    </p>
                  </div>
                </div>
                <div className="security-card__summary">
                  {reminderSummary.map((item) => (
                    <span key={item} className="security-summary-chip">
                      {item}
                    </span>
                  ))}
                </div>
                {privacyEdits.reminders && (
                  <div className="security-card__body" id="privacy-reminders-body">
                    <select
                      className="auth-input compact-select compact-select-inline"
                      value={goalReminder}
                      onChange={(e) =>
                        handleGoalReminderSetting(
                          e.target.value as GoalsState["reminder"]
                        )
                      }
                    >
                      <option value="daily">Daily reminder</option>
                      <option value="weekly">Weekly recap</option>
                      <option value="off">No reminders</option>
                    </select>
                  </div>
                )}
              </div>

              <div className="security-card">
                <div className="security-card__header">
                  <span className="security-card__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path
                        d="M4 6h16v12H4z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M8 6v12M4 10h16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                    </svg>
                  </span>
                  <div className="security-card__header-content">
                    <div className="security-card__title-row">
                      <h4>Dashboard news</h4>
                      <button
                        className="security-card__edit"
                        type="button"
                        onClick={() => togglePrivacyEdit("news")}
                        aria-expanded={privacyEdits.news}
                        aria-controls="privacy-news-body"
                      >
                        {privacyEdits.news ? "Done" : "Edit"}
                      </button>
                    </div>
                    <p className="security-muted">
                      Control whether Newsroom appears on your dashboard.
                    </p>
                  </div>
                </div>
                <div className="security-card__summary">
                  {newsSummary.map((item) => (
                    <span key={item} className="security-summary-chip">
                      {item}
                    </span>
                  ))}
                </div>
                {privacyEdits.news && (
                  <div className="security-card__body" id="privacy-news-body">
                    <label className="profile-check">
                      <input
                        type="checkbox"
                        checked={dashboardNewsEnabled}
                        onChange={(e) => handleDashboardNewsToggle(e.target.checked)}
                      />
                      <span className="profile-check__track" aria-hidden="true">
                        <span className="profile-check__thumb" />
                      </span>
                      <span className="profile-check__label">
                        Show Newsroom on my dashboard
                      </span>
                    </label>
                  </div>
                )}
              </div>

              <div className="security-card security-card-wide">
                <div className="security-card__header">
                  <span className="security-card__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path
                        d="M4 6h16v10H4z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                      />
                      <path
                        d="M9 20h6M12 16v4"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                  <div className="security-card__header-content">
                    <div className="security-card__title-row">
                      <h4>Profile preview</h4>
                      <button
                        className="security-card__edit"
                        type="button"
                        onClick={() => togglePrivacyEdit("preview")}
                        aria-expanded={privacyEdits.preview}
                        aria-controls="privacy-preview-body"
                      >
                        {privacyEdits.preview ? "Done" : "Edit"}
                      </button>
                    </div>
                    <p className="security-muted">
                      Preview what others see based on your current settings.
                    </p>
                  </div>
                </div>
                <div className="security-card__summary">
                  {previewSummary.map((item) => (
                    <span key={item} className="security-summary-chip">
                      {item}
                    </span>
                  ))}
                </div>
                {privacyEdits.preview && (
                  <div className="security-card__body" id="privacy-preview-body">
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
                )}
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
                <label className="profile-check">
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
                  <span className="profile-check__track" aria-hidden="true">
                    <span className="profile-check__thumb" />
                  </span>
                  <span className="profile-check__label">Enable Do Not Disturb</span>
                </label>
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
                <label className="profile-check">
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
                  <span className="profile-check__track" aria-hidden="true">
                    <span className="profile-check__thumb" />
                  </span>
                  <span className="profile-check__label">Play notification sounds</span>
                </label>
                <label className="profile-check">
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
                  <span className="profile-check__track" aria-hidden="true">
                    <span className="profile-check__thumb" />
                  </span>
                  <span className="profile-check__label">
                    Vibrate on alerts (mobile)
                  </span>
                </label>
              </div>

              <div className="security-card">
                <h4>Push notifications</h4>
                <p className="security-muted">
                  Receive native alerts even when the app is closed.
                </p>
                <label className="profile-check">
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
                  <span className="profile-check__track" aria-hidden="true">
                    <span className="profile-check__thumb" />
                  </span>
                  <span className="profile-check__label">Enable push notifications</span>
                </label>
                {pushBlockedByPhone && phoneVerificationLabel && (
                  <p className={phoneVerified === null ? "security-muted" : "status status-error"}>
                    {phoneVerificationLabel}
                  </p>
                )}
                {pushStatusLabel && <p className="security-muted">{pushStatusLabel}</p>}
                {pushError && <p className="status status-error">{pushError}</p>}
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

        {isSettingsView && settingsSection === "storefront" && (
        <div className="panel-grid">
          <section className="panel profile-settings-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">StoreFront</p>
                <h3>Default Location</h3>
                <p className="panel-sub">
                  Set a default location and radius to prefill StoreFront filters.
                </p>
              </div>
            </div>

            <div className="security-grid">
              <div className="security-card security-card-wide">
                <h4>Search defaults</h4>
                <p className="security-muted">
                  This only affects your StoreFront filters, not what others see.
                </p>
                <div className="security-row">
                  <label className="profile-field">
                    <span className="profile-field-label">State</span>
                    <select
                      className="auth-input"
                      value={storefrontLocationStateCode || ""}
                      onChange={(event) => handleStorefrontStateChange(event.target.value)}
                    >
                      <option value="">Select a state</option>
                      {storefrontLocationState &&
                        !storefrontStateOptions.some(
                          (state) =>
                            state.code === storefrontLocationStateCode ||
                            state.name.toLowerCase() ===
                              storefrontLocationState.toLowerCase()
                        ) && (
                          <option value={storefrontLocationStateCode || storefrontLocationState}>
                            {storefrontLocationState}
                          </option>
                        )}
                      {storefrontStateOptions.map((state) => (
                        <option key={state.code || state.name} value={state.code || state.name}>
                          {state.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="profile-field">
                    <span className="profile-field-label">City</span>
                    <select
                      className="auth-input"
                      value={storefrontLocationCity}
                      onChange={(event) => handleStorefrontCityChange(event.target.value)}
                      disabled={!storefrontLocationStateCode || storefrontCityOptions.length === 0}
                    >
                      <option value="">Select a city</option>
                      {storefrontLocationCity &&
                        !storefrontCityOptions.some(
                          (city) =>
                            city.name.toLowerCase() === storefrontLocationCity.toLowerCase()
                        ) && (
                          <option value={storefrontLocationCity}>
                            {storefrontLocationCity}
                          </option>
                        )}
                      {storefrontCityOptions.map((city) => (
                        <option key={city.code || city.name} value={city.name}>
                          {city.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                {storefrontLocationError && (
                  <p className="profile-location-error">{storefrontLocationError}</p>
                )}
                <div className="security-row">
                  <label className="profile-field">
                    <span className="profile-field-label">Radius (miles)</span>
                    <select
                      className="auth-input"
                      value={
                        STOREFRONT_RADIUS_OPTIONS.some(
                          (option) => option.value === profile.storefrontDefaultRadiusMiles
                        )
                          ? profile.storefrontDefaultRadiusMiles
                          : ""
                      }
                      onChange={(event) =>
                        setProfile({
                          ...profile,
                          storefrontDefaultRadiusMiles: event.target.value,
                        })
                      }
                    >
                      <option value="">Select a radius</option>
                      {STOREFRONT_RADIUS_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="security-muted">
                  The radius is stored and prefilled but not used to actually filter listings yet
                  because listings only have a text location string (no lat/long). If you want
                  true radius filtering, I can add geocoding + distance checks.
                </p>
              </div>
            </div>

            <div className="settings-actions">
              <button
                className="btn ghost"
                type="button"
                onClick={handleSaveStorefrontSettings}
                disabled={storefrontSettingsSaving}
              >
                {storefrontSettingsSaving ? "Saving..." : "Save StoreFront defaults"}
              </button>
            </div>
            {storefrontSettingsError && (
              <p className="status status-error">{storefrontSettingsError}</p>
            )}
            {storefrontSettingsSuccess && (
              <p className="status status-success">{storefrontSettingsSuccess}</p>
            )}
          </section>
        </div>
        )}

        {isSettingsView && settingsSection === "time-limits" && (
        <div className="panel-grid">
          <section className="panel profile-settings-panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Discipline</p>
                <h3>Time Limits</h3>
                <p className="panel-sub">
                  Set a session timer to stay focused. We’ll warn you at 10 minutes and
                  1 minute left, then sign you out and start a 10-minute cooldown.
                </p>
              </div>
            </div>

            <div className="security-grid">
              <div className="security-card">
                <h4>Session timer</h4>
                <p className="security-muted">
                  Choose how long you want each session to last.
                </p>
                <label className="profile-check">
                  <input
                    type="checkbox"
                    checked={Boolean(profile.timeLimitSettings.enabled)}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        timeLimitSettings: {
                          ...profile.timeLimitSettings,
                          enabled: e.target.checked,
                        },
                      })
                    }
                  />
                  <span className="profile-check__track" aria-hidden="true">
                    <span className="profile-check__thumb" />
                  </span>
                  <span className="profile-check__label">Enable time limits</span>
                </label>
                <div className="security-row">
                  <select
                    className="auth-input"
                    value={
                      profile.timeLimitSettings.durationMinutes ??
                      DEFAULT_TIME_LIMIT_MINUTES
                    }
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        timeLimitSettings: {
                          ...profile.timeLimitSettings,
                          durationMinutes: Number(e.target.value),
                        },
                      })
                    }
                    disabled={!profile.timeLimitSettings.enabled}
                  >
                    {TIME_LIMIT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <span className="security-muted">Cooldown: 10 minutes</span>
                </div>
                <p className="security-muted">
                  You’ll get a heads-up at 10 minutes and 1 minute remaining.
                </p>
              </div>
            </div>

            <div className="settings-actions">
              <button
                className="btn ghost"
                type="button"
                onClick={handleSaveTimeLimitSettings}
                disabled={timeLimitSaving}
              >
                {timeLimitSaving ? "Saving..." : "Save time limit settings"}
              </button>
            </div>
            {timeLimitError && <p className="status status-error">{timeLimitError}</p>}
            {timeLimitSuccess && (
              <p className="status status-success">{timeLimitSuccess}</p>
            )}
          </section>
        </div>
        )}

        {isSettingsView && settingsSection === "language" && (
        <div className="panel-grid">
          <section className="panel profile-settings-panel profile-settings-panel--language">
            <div className="panel-header profile-language-header">
              <div className="profile-language-copy">
                <p className="eyebrow">Language</p>
                <h3>Language Options</h3>
                <p className="panel-sub">
                  Choose the language you want to use across the app.
                </p>
              </div>
              <div className="profile-language-control">
                <LanguageMenu inline />
              </div>
            </div>
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

              <div className="security-card">
                <h4>Export profile data</h4>
                <p className="security-muted">
                  Download your profile, photos, and videos as a zip archive. {exportHint}
                </p>
                <div className="security-actions">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleExportProfile}
                    disabled={exportLoading}
                  >
                    {exportLoading ? "Preparing..." : "Download export"}
                  </button>
                </div>
                {exportError && <p className="status status-error">{exportError}</p>}
                {exportSuccess && (
                  <p className="status status-success">{exportSuccess}</p>
                )}
              </div>

              <div className="security-card security-card-wide">
                <h4>Deactivate vs. delete</h4>
                <p className="security-muted">
                  Deactivation hides your profile and removes it from search for up to{" "}
                  {deactivationDays} days. Deleting removes your account and data permanently.
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

        {!isSettingsView && isGalleryPage && (
        <div className="profile-content-grid">
        <section className="panel profile-media">
          <div
            className={`panel-header profile-media__header profile-section-header${
              contentGalleryOpen ? "" : " is-collapsed"
            }`}
          >
            <button
              type="button"
              className="profile-section-toggle"
              onClick={() => setContentGalleryOpen((prev) => !prev)}
              aria-expanded={contentGalleryOpen}
            >
              <div>
                <p className="eyebrow">Gallery</p>
                <h3>My Photos and Videos</h3>
                <p className="panel-sub">
                  Curate your moments and choose who can see them.
                </p>
              </div>
              <span
                className={`profile-section-chevron${
                  contentGalleryOpen ? " is-open" : ""
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
            {contentGalleryOpen && (
              <div className="profile-media__tabs">
                <button
                  type="button"
                  className={`profile-media__tab${mediaTab === "all" ? " is-active" : ""}`}
                  onClick={() => setMediaTab("all")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`profile-media__tab${mediaTab === "photo" ? " is-active" : ""}`}
                  onClick={() => setMediaTab("photo")}
                >
                  Photos
                </button>
                <button
                  type="button"
                  className={`profile-media__tab${mediaTab === "video" ? " is-active" : ""}`}
                  onClick={() => setMediaTab("video")}
                >
                  Videos
                </button>
              </div>
            )}
            {contentGalleryOpen && (
              <div className="profile-media__filters">
                <label className="profile-media__filter">
                  <span>Folder</span>
                  <select
                    className="auth-input profile-media__select"
                    value={mediaFolderFilter}
                    onChange={(event) => setMediaFolderFilter(event.target.value)}
                  >
                    <option value={MEDIA_FOLDER_ALL}>All folders</option>
                    {mediaFolderOptions.map((folder) => (
                      <option key={folder} value={folder}>
                        {folder}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="profile-media__filter-meta">
                  {filteredMedia.length} item{filteredMedia.length === 1 ? "" : "s"}
                </div>
              </div>
            )}
          </div>

          {contentGalleryOpen && (
            <>
              <datalist id="media-folder-options">
                {mediaFolderOptions.map((folder) => (
                  <option key={folder} value={folder} />
                ))}
              </datalist>
              <div className="profile-media__composer">
                <div
                  className={`profile-media__preview${
                    mediaDragActive ? " is-dragover" : ""
                  }`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    setMediaDragActive(true);
                  }}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setMediaDragActive(true);
                  }}
                  onDragLeave={() => setMediaDragActive(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setMediaDragActive(false);
                    const file = event.dataTransfer.files?.[0] || null;
                    handleMediaFileSelection(file);
                  }}
                >
                  {mediaFilePreview ? (
                    mediaFileIsVideo ? (
                      <video controls muted playsInline preload="metadata">
                        <source src={mediaFilePreview} />
                      </video>
                    ) : (
                      <img src={mediaFilePreview} alt="Media preview" />
                    )
                  ) : (
                    <div className="profile-media__placeholder">
                      {mediaDragActive
                        ? "Drop your photo or video to preview."
                        : "Drag and drop a photo or video, or select one to preview."}
                    </div>
                  )}
                </div>
                <div className="profile-media__fields">
                  <div className="profile-media__row">
                    <input
                      className="auth-input"
                      placeholder="Title (optional)"
                      value={mediaTitle}
                      onChange={(e) => setMediaTitle(e.target.value)}
                    />
                    <input
                      className="auth-input"
                      placeholder="Folder (optional)"
                      value={mediaFolder}
                      onChange={(e) => setMediaFolder(e.target.value)}
                      list="media-folder-options"
                    />
                    <select
                      className="auth-input profile-media__select"
                      value={mediaVisibility}
                      onChange={(e) =>
                        setMediaVisibility(
                          e.target.value as "public" | "friends" | "private" | "trusted"
                        )
                      }
                    >
                      <option value="public">Public</option>
                      <option value="friends">Friends</option>
                      <option value="private">Private</option>
                      <option value="trusted">Trusted Circle</option>
                    </select>
                  </div>
                  {mediaVisibility === "trusted" && (
                    <div className="profile-media__row">
                      <select
                        className="auth-input profile-media__select"
                        value={mediaTrustedCircleId}
                        onChange={(e) =>
                          setMediaTrustedCircleId(e.target.value ? Number(e.target.value) : "")
                        }
                      >
                        <option value="">Select a trusted circle</option>
                        {trustedCircleOptions.map((group) => (
                          <option key={group.id} value={group.id}>
                            {group.name}
                          </option>
                        ))}
                      </select>
                      {trustedCircleOptions.length === 0 && (
                        <span className="post-composer__hint">
                          Create a trusted circle in My Trusted Circles to use this.
                        </span>
                      )}
                    </div>
                  )}
                  <textarea
                    className="auth-input profile-media__caption"
                    placeholder="Caption (optional)"
                    value={mediaCaption}
                    onChange={(e) => setMediaCaption(e.target.value)}
                    rows={3}
                  />
                  <div className="profile-media__actions">
                    <label className="post-composer__tool">
                      <input
                        type="file"
                        accept="image/*,video/*"
                        onChange={(e) => {
                          const file = e.target.files?.[0] || null;
                          handleMediaFileSelection(file);
                        }}
                      />
                      <span>{mediaFile ? "Change media" : "Choose media"}</span>
                    </label>
                    <span className="profile-media__file">
                      {mediaFile ? mediaFile.name : "No media selected"}
                    </span>
                    {mediaFile && (
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => setMediaFile(null)}
                      >
                        Remove
                      </button>
                    )}
                    {mediaFile && (
                      <button
                        className="btn primary"
                        type="button"
                        onClick={createMediaItem}
                        disabled={mediaSubmitting}
                      >
                        {mediaSubmitting ? "Uploading..." : "Add to gallery"}
                      </button>
                    )}
                  </div>
                  {profileMediaError && (
                    <p className="status status-error">{profileMediaError}</p>
                  )}
                </div>
              </div>

              <div className="profile-media__folders">
                <div className="profile-media__folder-toolbar">
                  <p className="profile-media__folder-hint">
                    Double-click a folder to open it. Drag media onto a folder to move it.
                  </p>
                  <button
                    type="button"
                    className="btn ghost profile-media__folder-btn"
                    onClick={() => {
                      setMediaNewFolderOpen(true);
                      setMediaFolderError(null);
                    }}
                    disabled={mediaNewFolderOpen}
                  >
                    New folder
                  </button>
                </div>
                {mediaNewFolderOpen && (
                  <div className="profile-media__folder-create">
                    <input
                      className="auth-input"
                      placeholder="Folder name"
                      autoFocus
                      value={mediaNewFolderName}
                      onChange={(event) => {
                        setMediaNewFolderName(event.target.value);
                        if (mediaFolderError) setMediaFolderError(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleCreateMediaFolder();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelMediaFolderCreate();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn primary"
                      onClick={handleCreateMediaFolder}
                    >
                      Create
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={cancelMediaFolderCreate}
                    >
                      Cancel
                    </button>
                  </div>
                )}
                <div className="profile-media__folder-grid">
                  <button
                    type="button"
                    className={`profile-media__folder-card${
                      mediaFolderFilter === MEDIA_FOLDER_ALL ? " is-active" : ""
                    }`}
                    onClick={() => setMediaFolderFilter(MEDIA_FOLDER_ALL)}
                    onDoubleClick={() => setMediaFolderFilter(MEDIA_FOLDER_ALL)}
                  >
                    <span className="profile-media__folder-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24">
                        <path
                          d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <span className="profile-media__folder-name">All media</span>
                    <span className="profile-media__folder-count">
                      {mediaFolderCounts.total} item
                      {mediaFolderCounts.total === 1 ? "" : "s"}
                    </span>
                  </button>
                  {mediaFolderOptions.map((folder) => {
                    const count = mediaFolderCounts.counts.get(folder) ?? 0;
                    const isActive = mediaFolderFilter === folder;
                    const isDrop = mediaDragOverFolder === folder;
                    return (
                      <button
                        key={folder}
                        type="button"
                        title={folder}
                        className={`profile-media__folder-card${
                          isActive ? " is-active" : ""
                        }${isDrop ? " is-drop" : ""}`}
                        onClick={() => setMediaFolderFilter(folder)}
                        onDoubleClick={() => setMediaFolderFilter(folder)}
                        onDragOver={(event) => handleFolderDragOver(event, folder)}
                        onDragLeave={() => handleFolderDragLeave(folder)}
                        onDrop={(event) => void handleFolderDrop(event, folder)}
                      >
                        <span className="profile-media__folder-icon" aria-hidden="true">
                          <svg viewBox="0 0 24 24">
                            <path
                              d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                        <span className="profile-media__folder-name">{folder}</span>
                        <span className="profile-media__folder-count">
                          {count} item{count === 1 ? "" : "s"}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {mediaFolderError && (
                  <p className="status status-error">{mediaFolderError}</p>
                )}
              </div>

              {profileMediaLoading && <p className="status">Loading gallery...</p>}
              {!profileMediaLoading && filteredMedia.length === 0 && (
                <p className="status">No gallery items yet.</p>
              )}
              {!profileMediaLoading && filteredMedia.length > 0 && (
                <div className="profile-media__grid">
                  {mediaPaging.items.map((item, index) => {
                    const absoluteIndex = mediaPaging.startIndex + index;
                    const isVideo = item.kind === "video" || isVideoUrl(item.media);
                    const mediaKey = String(item.id);
                    const showMediaMenu = mediaMenuFor === mediaKey;
                    const isEditingMedia = editingMediaId === mediaKey;
                    return (
                      <article
                        key={String(item.id)}
                        className={`profile-media__card${
                          showMediaMenu ? " is-popover-open" : ""
                        }${mediaDraggingId === mediaKey ? " is-dragging" : ""}${
                          mediaDragOverId === mediaKey ? " is-drop-target" : ""
                        }`}
                        draggable={!isEditingMedia}
                        onDragStart={(event) => handleMediaDragStart(event, item)}
                        onDragEnd={handleMediaDragEnd}
                        onDragOver={(event) => handleMediaCardDragOver(event, mediaKey)}
                        onDragLeave={() => handleMediaCardDragLeave(mediaKey)}
                        onDrop={(event) => void handleMediaCardDrop(event, mediaKey)}
                      >
                        <div
                          className={`profile-media__asset${
                            item.media ? " is-interactive" : ""
                          }`}
                          role={item.media ? "button" : undefined}
                          tabIndex={item.media ? 0 : undefined}
                          onClick={(event) => {
                            if (!item.media) return;
                            const target = event.target as HTMLElement;
                            if (target.closest("button, a, input, select, textarea")) {
                              return;
                            }
                            if (
                              isVideo &&
                              target.tagName &&
                              target.tagName.toLowerCase() === "video"
                            ) {
                              return;
                            }
                            openMediaLightboxAt(absoluteIndex);
                          }}
                          onKeyDown={(event) => {
                            if (!item.media) return;
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openMediaLightboxAt(absoluteIndex);
                            }
                          }}
                          aria-label="Open media preview"
                        >
                          <div className="profile-media__overlay">
                            {item.media && (
                              <div className="post-menu-wrapper post-menu-wrapper--media">
                                <button
                                  className="post-menu-trigger"
                                  type="button"
                                  aria-haspopup="menu"
                                  aria-expanded={showMediaMenu}
                                  aria-label="Open media options"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    toggleMediaMenu(mediaKey);
                                  }}
                                >
                                  <svg viewBox="0 0 24 24" aria-hidden="true">
                                    <circle cx="5" cy="12" r="2" />
                                    <circle cx="12" cy="12" r="2" />
                                    <circle cx="19" cy="12" r="2" />
                                  </svg>
                                </button>
                                {showMediaMenu && (
                                  <div className="post-menu" role="menu">
                                    <button
                                      className="post-menu-item"
                                      type="button"
                                      role="menuitem"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setMediaMenuFor(null);
                                        openMediaLightboxAt(absoluteIndex);
                                      }}
                                    >
                                      View Fullscreen
                                    </button>
                                    {item.folder && (
                                      <button
                                        className="post-menu-item"
                                        type="button"
                                        role="menuitem"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          setMediaMenuFor(null);
                                          void updateMediaFolder(item, null);
                                        }}
                                      >
                                        Remove from folder
                                      </button>
                                    )}
                                    <button
                                      className="post-menu-item"
                                      type="button"
                                      role="menuitem"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setMediaMenuFor(null);
                                        setMediaVisibilityModalItem(item);
                                      }}
                                    >
                                      Set Visibility
                                    </button>
                                    <button
                                      className="post-menu-item"
                                      type="button"
                                      role="menuitem"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setMediaMenuFor(null);
                                        setMediaEditModalItem(item);
                                      }}
                                    >
                                      Edit
                                    </button>
                                  </div>
                                )}
                              </div>
                            )}
                            <span className="profile-media__badge">
                              {item.visibility || "friends"}
                            </span>
                          </div>
                          {item.media ? (
                            isVideo ? (
                              <video controls preload="metadata" draggable={false}>
                                <source src={item.media} />
                              </video>
                            ) : (
                              <img
                                src={item.media}
                                alt={item.title || "Photo"}
                                draggable={false}
                              />
                            )
                          ) : (
                            <div className="profile-media__placeholder">No media</div>
                          )}
                        </div>
                        <div className="profile-media__meta">
                          {isEditingMedia ? (
                            <div className="profile-media__edit">
                              <input
                                className="auth-input"
                                placeholder="Title (optional)"
                                value={mediaEditTitle}
                                onChange={(event) => setMediaEditTitle(event.target.value)}
                              />
                              <input
                                className="auth-input"
                                placeholder="Folder (optional)"
                                value={mediaEditFolder}
                                onChange={(event) => setMediaEditFolder(event.target.value)}
                                list="media-folder-options"
                              />
                              <textarea
                                className="auth-input"
                                rows={3}
                                placeholder="Caption (optional)"
                                value={mediaEditCaption}
                                onChange={(event) => setMediaEditCaption(event.target.value)}
                              />
                              <div className="profile-media__edit-actions">
                                <button
                                  className="btn ghost"
                                  type="button"
                                  onClick={cancelMediaEdit}
                                  disabled={mediaEditSaving}
                                >
                                  Cancel
                                </button>
                                <button
                                  className="btn primary"
                                  type="button"
                                  onClick={() => void saveMediaEdit(item)}
                                  disabled={mediaEditSaving}
                                >
                                  {mediaEditSaving ? "Saving..." : "Save changes"}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="profile-media__title-row">
                                <strong>
                                  {item.title || (isVideo ? "Video" : "Photo")}
                                </strong>
                                {item.createdAt && (
                                  <span>{formatPostUpdateLabel(item.createdAt)}</span>
                                )}
                              </div>
                              {item.folder && (
                                <span className="profile-media__folder-tag">
                                  {item.folder}
                                </span>
                              )}
                              {item.caption && (
                                <p className="profile-media__caption-text">
                                  {item.caption}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
              {!profileMediaLoading && filteredMedia.length > 0 && mediaPaging.totalPages > 1 && (
                <div className="profile-media__pagination">
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() => setMediaPage((prev) => Math.max(1, prev - 1))}
                    disabled={mediaPaging.page <= 1}
                  >
                    Previous
                  </button>
                  <div className="profile-media__page-info">
                    Page {mediaPaging.page} of {mediaPaging.totalPages}
                  </div>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={() =>
                      setMediaPage((prev) =>
                        Math.min(mediaPaging.totalPages, prev + 1)
                      )
                    }
                    disabled={mediaPaging.page >= mediaPaging.totalPages}
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </section>
        </div>
        )}

        {!isSettingsView && isPostsPage && (
        <div className="profile-content-grid">
        <section className="panel profile-posts-panel">
          <div
            className={`panel-header profile-posts__header profile-section-header${
              contentPostsOpen ? "" : " is-collapsed"
            }`}
          >
            <button
              type="button"
              className="profile-section-toggle"
              onClick={() => setContentPostsOpen((prev) => !prev)}
              aria-expanded={contentPostsOpen}
            >
              <div>
                <p className="eyebrow">Posts</p>
                <h3>My Posts</h3>
                <p className="panel-sub">Review, edit, and manage your updates.</p>
              </div>
              <span
                className={`profile-section-chevron${
                  contentPostsOpen ? " is-open" : ""
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
          </div>
          {contentPostsOpen && (posts.length === 0 ? (
            <p className="status">No posts yet.</p>
          ) : (
          <div className="posts-grid">
          {posts.map((p) => {
            const postUrl = extractFirstUrl(p.text);
            const preview = postUrl ? previewCache[postUrl] : undefined;
            const hasLink = Boolean(postUrl);
            const descriptor = mediaDescriptor(p.media, hasLink);
            const canDelete = Boolean(p.id ?? p.documentId);
            const feedbackLabel = feedbackLabelFor(p);
            const postKey = String(p.id);
            const commentKey = String(p.numericId ?? p.id);
            const comments = postComments[commentKey] ?? [];
            const isCommentsOpen = Boolean(openCommentsFor[commentKey]);
            const commentAttachmentPreviews = commentMediaPreviews[commentKey] ?? [];
            const commentAttachmentFiles = commentMediaFiles[commentKey] ?? [];
            const closeCommentModal = () => {
              clearCommentAttachments(commentKey);
              setOpenCommentsFor((prev) => ({ ...prev, [commentKey]: false }));
            };
            const showShareMenu = shareMenuFor === postKey;
            const showPostMenu = postMenuFor === postKey;
            const shareUrl = buildShareUrl(postKey);
            const shareText = p.text
              ? `${displayName}: ${p.text.slice(0, 80)}`
              : `${displayName} posted an update.`;
            const encodedUrl = encodeURIComponent(shareUrl);
            const encodedText = encodeURIComponent(shareText);
            const likesCount = Number(p.likes ?? 0);
            const reactionCounts = normalizeReactionCounts(p.reactionCounts, likesCount);
            const thumbsUpCount = reactionCounts.thumbsUp;
            const heartCount = reactionCounts.heart;
            const myReaction = normalizeReactionValue(p.myReaction);
            const sharesCount = Number(p.shares ?? 0);
            const commentsCount = comments.length;
            const isEditingPost = editingPostId === postKey;
            const isSavingPost = Boolean(postEditing[postKey]);

            return (
              <article
                key={String(p.id)}
                id={`post-${postKey}`}
                className={`post-card${
                  showShareMenu || showPostMenu ? " is-popover-open" : ""
                }`}
              >
                <div className="post-meta-bar">
                  <span className="post-meta-name">{displayName}</span>
                  <span className="post-meta-text">
                    {formatPostUpdateLabel(p.createdAt)}
                  </span>
                  {descriptor && <span className="post-meta-tag">{descriptor}</span>}
                  {feedbackLabel && (
                    <span className="post-feedback-tag">{feedbackLabel}</span>
                  )}
                </div>

                {canDelete && !isEditingPost && !p.media && !preview?.image && (
                  <div className="post-menu-wrapper">
                    <button
                      className="post-menu-trigger"
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={showPostMenu}
                      aria-label="Open post options"
                      onClick={(event) => {
                        event.stopPropagation();
                        togglePostMenu(postKey);
                      }}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <circle cx="5" cy="12" r="2" />
                        <circle cx="12" cy="12" r="2" />
                        <circle cx="19" cy="12" r="2" />
                      </svg>
                    </button>
                    {showPostMenu && (
                      <div className="post-menu" role="menu">
                        <button
                          className="post-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPostMenuFor(null);
                            setVisibilityModalPost(p);
                          }}
                        >
                          Set visibility
                        </button>
                        <button
                          className="post-menu-item"
                          type="button"
                          role="menuitem"
                          onClick={(event) => {
                            event.stopPropagation();
                            setPostMenuFor(null);
                            setEditPostModalPost(p);
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {p.media ? (
                  <div className="post-media">
                    {canDelete && !isEditingPost && (
                      <div className="post-menu-wrapper post-menu-wrapper--media">
                        <button
                          className="post-menu-trigger"
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={showPostMenu}
                          aria-label="Open post options"
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePostMenu(postKey);
                          }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="5" cy="12" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="19" cy="12" r="2" />
                          </svg>
                        </button>
                        {showPostMenu && (
                          <div className="post-menu" role="menu">
                            <button
                              className="post-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={(event) => {
                                event.stopPropagation();
                                setPostMenuFor(null);
                                setVisibilityModalPost(p);
                              }}
                            >
                              Set visibility
                            </button>
                            <button
                              className="post-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={(event) => {
                                event.stopPropagation();
                                setPostMenuFor(null);
                                setEditPostModalPost(p);
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="post-media__asset">
                      {isVideoUrl(p.media) ? (
                        <video controls style={{ width: "100%", height: "100%", objectFit: "cover" }}>
                          <source src={p.media} />
                        </video>
                      ) : (
                        <img src={p.media} alt={p.text} loading="lazy" />
                      )}
                    </div>
                  </div>
                ) : preview?.image && !isYoutubeUrl(postUrl) ? (
                  <div className="post-media link-preview-media">
                    {canDelete && !isEditingPost && (
                      <div className="post-menu-wrapper post-menu-wrapper--media">
                        <button
                          className="post-menu-trigger"
                          type="button"
                          aria-haspopup="menu"
                          aria-expanded={showPostMenu}
                          aria-label="Open post options"
                          onClick={(event) => {
                            event.stopPropagation();
                            togglePostMenu(postKey);
                          }}
                        >
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <circle cx="5" cy="12" r="2" />
                            <circle cx="12" cy="12" r="2" />
                            <circle cx="19" cy="12" r="2" />
                          </svg>
                        </button>
                        {showPostMenu && (
                          <div className="post-menu" role="menu">
                            <button
                              className="post-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={(event) => {
                                event.stopPropagation();
                                setPostMenuFor(null);
                                setVisibilityModalPost(p);
                              }}
                            >
                              Set visibility
                            </button>
                            <button
                              className="post-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={(event) => {
                                event.stopPropagation();
                                setPostMenuFor(null);
                                setEditPostModalPost(p);
                              }}
                            >
                              Edit
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="post-media__asset">
                      <img
                        src={preview.image}
                        alt={preview.title || displayName}
                        loading="lazy"
                      />
                    </div>
                  </div>
                ) : null}

                <div className="post-body">
                  {isEditingPost ? (
                    <div className="post-edit">
                      <textarea
                        className="auth-input post-edit-body"
                        rows={4}
                        value={editPostText}
                        onChange={(event) =>
                          setEditPostText(sanitizePostText(event.target.value))
                        }
                        placeholder="Update your post"
                      />
                      <div className="post-edit-actions">
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={cancelPostEdit}
                          disabled={isSavingPost}
                        >
                          Cancel
                        </button>
                        <button
                          className="btn primary"
                          type="button"
                          onClick={() => void savePostEdit(p)}
                          disabled={isSavingPost}
                        >
                          {isSavingPost ? "Saving..." : "Save changes"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h3>{displayName}</h3>
                      <p>{p.text}</p>
                      {preview && !p.media && (
                        <LinkPreviewCard
                          preview={preview}
                          url={preview.url || postUrl}
                          compact
                        />
                      )}
                    </>
                  )}
                  <div className="post-actions">
                    <div className="post-action-counts">
                      <span
                        className={`post-action-count${
                          myReaction === "👍" ? " is-selected" : ""
                        }`}
                      >
                        <span className="post-action-count-icon" aria-hidden="true">
                          👍
                        </span>
                        {thumbsUpCount}
                      </span>
                      <span
                        className={`post-action-count${
                          myReaction === "❤️" ? " is-selected" : ""
                        }`}
                      >
                        <span className="post-action-count-icon" aria-hidden="true">
                          ❤️
                        </span>
                        {heartCount}
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
                        className={`post-action-btn${
                          myReaction === "👍" ? " is-reacted" : ""
                        }`}
                        type="button"
                        aria-pressed={myReaction === "👍"}
                        onClick={() => void handleReaction(p, postKey, "👍")}
                      >
                        <span className="post-action-icon" aria-hidden="true">
                          👍
                        </span>
                        <span>Like</span>
                      </button>
                    </div>
                      <div className="post-action-group">
                        <button
                        className={`post-action-btn${
                          myReaction === "❤️" ? " is-reacted" : ""
                        }`}
                        type="button"
                        aria-pressed={myReaction === "❤️"}
                        onClick={() => void handleReaction(p, postKey, "❤️")}
                      >
                        <span className="post-action-icon" aria-hidden="true">
                          ❤️
                        </span>
                        <span>Heart</span>
                      </button>
                    </div>
                    <div className="post-action-group">
                      <button
                        className="post-action-btn"
                        type="button"
                        aria-pressed={isCommentsOpen}
                        onClick={() => toggleComments(commentKey)}
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
                              className="post-share-btn is-icon"
                              type="button"
                              onClick={() => handleCopyShare(p, postKey, shareUrl)}
                              aria-label="Copy link"
                            >
                              <span className="post-share-icon" aria-hidden="true">
                                🔗
                              </span>
                              <span className="post-share-label">Copy link</span>
                            </button>
                            {typeof navigator !== "undefined" &&
                              typeof navigator.share === "function" && (
                                <button
                                  className="post-share-btn is-icon"
                                  type="button"
                                  onClick={() =>
                                    handleNativeShare(p, postKey, shareUrl, shareText)
                                  }
                                  aria-label="Share"
                                >
                                  <span className="post-share-icon" aria-hidden="true">
                                    📤
                                  </span>
                                  <span className="post-share-label">Share</span>
                                </button>
                              )}
                            <a
                              className="post-share-link is-icon post-share-link--facebook"
                              href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`}
                              onClick={() => void trackShare(p, postKey)}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Share to Facebook"
                            >
                              <span className="post-share-icon" aria-hidden="true">
                                f
                              </span>
                              <span className="post-share-label">Facebook</span>
                            </a>
                            <a
                              className="post-share-link is-icon post-share-link--x"
                              href={`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`}
                              onClick={() => void trackShare(p, postKey)}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Share to X"
                            >
                              <span className="post-share-icon" aria-hidden="true">
                                X
                              </span>
                              <span className="post-share-label">X</span>
                            </a>
                            <a
                              className="post-share-link is-icon post-share-link--linkedin"
                              href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`}
                              onClick={() => void trackShare(p, postKey)}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Share to LinkedIn"
                            >
                              <span className="post-share-icon" aria-hidden="true">
                                in
                              </span>
                              <span className="post-share-label">LinkedIn</span>
                            </a>
                            <a
                              className="post-share-link is-icon post-share-link--reddit"
                              href={`https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`}
                              onClick={() => void trackShare(p, postKey)}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Share to Reddit"
                            >
                              <span className="post-share-icon" aria-hidden="true">
                                r
                              </span>
                              <span className="post-share-label">Reddit</span>
                            </a>
                            <a
                              className="post-share-link is-icon post-share-link--whatsapp"
                              href={`https://wa.me/?text=${encodedText}%20${encodedUrl}`}
                              onClick={() => void trackShare(p, postKey)}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Share to WhatsApp"
                            >
                              <span className="post-share-icon" aria-hidden="true">
                                🟢
                              </span>
                              <span className="post-share-label">WhatsApp</span>
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
                    <PopupModal
                      open={isCommentsOpen}
                      title="Comments"
                      onClose={closeCommentModal}
                      className="comment-modal"
                      bodyClassName="comment-modal-body"
                    >
                    <div className="comments comments--modal">
                      <p className="eyebrow">Comments</p>
                      {comments.length > 0 ? (
                        <ul className="comment-list">
                          {comments.map((c) => {
                            const commentIdKey = String(c.documentId ?? c.numericId ?? c.id);
                            const isEditing = Boolean(editingComments[commentIdKey]);
                            const editValue = commentEdits[commentIdKey] ?? c.body;
                            const imageUrls = extractImageUrls(c.body);
                            const cleanedBody = stripImageUrls(c.body, imageUrls);
                            const displayBody =
                              cleanedBody || (imageUrls.length ? "" : c.body);
                            return (
                            <li key={c.id} className="comment-item">
                              <div className="comment-author">{c.owner || "User"}</div>
                              {isEditing ? (
                                <div className="comment-edit">
                                  <textarea
                                    className="auth-input comment-edit-input"
                                    value={editValue}
                                    onChange={(event) =>
                                      setCommentEdits((prev) => ({
                                        ...prev,
                                        [commentIdKey]: sanitizePostText(event.target.value),
                                      }))
                                    }
                                  />
                                  <div className="comment-edit-actions">
                                    <button
                                      className="btn ghost"
                                      type="button"
                                      onClick={() => {
                                        setEditingComments((prev) => {
                                          const next = { ...prev };
                                          delete next[commentIdKey];
                                          return next;
                                        });
                                        setCommentEdits((prev) => {
                                          const next = { ...prev };
                                          delete next[commentIdKey];
                                          return next;
                                        });
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      className="btn primary"
                                      type="button"
                                      onClick={async () => {
                                        try {
                                          const updated = await updateCommentBody(
                                            c,
                                            commentKey,
                                            editValue
                                          );
                                          if (!updated) return;
                                          setEditingComments((prev) => {
                                            const next = { ...prev };
                                            delete next[commentIdKey];
                                            return next;
                                          });
                                          setCommentEdits((prev) => {
                                            const next = { ...prev };
                                            delete next[commentIdKey];
                                            return next;
                                          });
                                        } catch (err: unknown) {
                                          const msg = axios.isAxiosError(err)
                                            ? err.response?.data?.error?.message ||
                                              err.response?.data?.message ||
                                              "Failed to update comment."
                                            : "Failed to update comment.";
                                          setError(String(msg));
                                        }
                                      }}
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="comment-body">{displayBody}</div>
                              )}
                              {!isEditing && imageUrls.length > 0 && (
                                <div className="comment-images">
                                  {imageUrls.map((url, index) => {
                                    const resolved =
                                      pickMediaUrl(url, { kind: "post" }) || url;
                                    return (
                                      <img
                                        key={`${commentIdKey}-${index}`}
                                        src={resolved}
                                        alt="Comment attachment"
                                        loading="lazy"
                                        decoding="async"
                                      />
                                    );
                                  })}
                                </div>
                              )}
                              {(() => {
                                const commentUrl = extractFirstUrl(cleanedBody);
                                if (!isPreviewableUrl(commentUrl)) return null;
                                const preview = previewCache[commentUrl];
                                if (!preview) return null;
                                return (
                                  <div className="comment-preview">
                                    <LinkPreviewCard
                                      preview={preview}
                                      url={preview.url || commentUrl}
                                      compact
                                    />
                                  </div>
                                );
                              })()}
                              {user?.id === c.ownerId && (
                                <div className="comment-menu">
                                  <button
                                    className="comment-menu-button"
                                    type="button"
                                    aria-label="Comment actions"
                                    aria-haspopup="menu"
                                    aria-expanded={Boolean(commentMenuOpen[commentIdKey])}
                                    onClick={() =>
                                      setCommentMenuOpen((prev) => ({
                                        ...prev,
                                        [commentIdKey]: !prev[commentIdKey],
                                      }))
                                    }
                                  >
                                    <span className="comment-menu-dots" aria-hidden="true">
                                      ⋯
                                    </span>
                                  </button>
                                  {commentMenuOpen[commentIdKey] && (
                                    <div className="comment-menu-panel" role="menu">
                                      <button
                                        className="comment-menu-item"
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          setEditingComments((prev) => ({
                                            ...prev,
                                            [commentIdKey]: true,
                                          }));
                                          setCommentEdits((prev) => ({
                                            ...prev,
                                            [commentIdKey]: c.body,
                                          }));
                                          setCommentMenuOpen((prev) => ({
                                            ...prev,
                                            [commentIdKey]: false,
                                          }));
                                        }}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        className="comment-menu-item is-danger"
                                        type="button"
                                        role="menuitem"
                                        onClick={async () => {
                                          setCommentMenuOpen((prev) => ({
                                            ...prev,
                                            [commentIdKey]: false,
                                          }));
                                          const numericId =
                                            c.numericId ??
                                            (typeof c.id === "number" ? c.id : Number(c.id));
                                          const removeIds = new Set<string>();
                                          removeIds.add(String(c.id));
                                          if (c.documentId) {
                                            removeIds.add(String(c.documentId));
                                          }
                                          if (Number.isFinite(numericId)) {
                                            removeIds.add(String(numericId));
                                          }
                                          try {
                                            setError(null);
                                            const attempts: string[] = [];
                                            if (c.documentId) {
                                              attempts.push(`/comments/${c.documentId}`);
                                            }
                                            if (Number.isFinite(numericId)) {
                                              attempts.push(`/comments/${numericId}`);
                                            }
                                            attempts.push(`/comments/${c.id}`);

                                            let removed = false;
                                            for (const path of attempts) {
                                              try {
                                                await api.delete(path);
                                                removed = true;
                                                break;
                                              } catch (err) {
                                                if (
                                                  axios.isAxiosError(err) &&
                                                  err.response?.status === 404
                                                ) {
                                                  continue;
                                                }
                                                throw err;
                                              }
                                            }

                                            if (!removed) {
                                              setError("Failed to delete comment.");
                                              return;
                                            }

                                            setPostComments((prev) => ({
                                              ...prev,
                                              [commentKey]: (prev[commentKey] || []).filter(
                                                (comment) => {
                                                  if (removeIds.has(String(comment.id))) {
                                                    return false;
                                                  }
                                                  if (
                                                    comment.documentId &&
                                                    removeIds.has(String(comment.documentId))
                                                  ) {
                                                    return false;
                                                  }
                                                  if (
                                                    Number.isFinite(comment.numericId) &&
                                                    removeIds.has(String(comment.numericId))
                                                  ) {
                                                    return false;
                                                  }
                                                  return true;
                                                }
                                              ),
                                            }));

                                            try {
                                              const refreshed = await fetchCommentsForPostIds([
                                                commentKey,
                                              ]);
                                              if (Object.keys(refreshed).length) {
                                                setPostComments((prev) => ({
                                                  ...prev,
                                                  ...refreshed,
                                                }));
                                              }
                                            } catch (err) {
                                              console.warn(
                                                "Comment refresh failed after delete",
                                                err
                                              );
                                            }
                                          } catch (err) {
                                            const status = axios.isAxiosError(err)
                                              ? err.response?.status
                                              : undefined;
                                            if (status && status >= 500) {
                                              try {
                                                const refreshed = await fetchCommentsForPostIds([
                                                  commentKey,
                                                ]);
                                                let stillThere = true;
                                                setPostComments((prev) => {
                                                  const refreshedList = refreshed[commentKey];
                                                  const nextList = Array.isArray(refreshedList)
                                                    ? refreshedList
                                                    : (prev[commentKey] || []).filter(
                                                        (comment) => {
                                                          if (
                                                            removeIds.has(String(comment.id))
                                                          ) {
                                                            return false;
                                                          }
                                                          if (
                                                            comment.documentId &&
                                                            removeIds.has(
                                                              String(comment.documentId)
                                                            )
                                                          ) {
                                                            return false;
                                                          }
                                                          if (
                                                            Number.isFinite(
                                                              comment.numericId
                                                            ) &&
                                                            removeIds.has(
                                                              String(comment.numericId)
                                                            )
                                                          ) {
                                                            return false;
                                                          }
                                                          return true;
                                                        }
                                                      );
                                                  stillThere = nextList.some((comment) => {
                                                    if (removeIds.has(String(comment.id))) {
                                                      return true;
                                                    }
                                                    if (
                                                      comment.documentId &&
                                                      removeIds.has(String(comment.documentId))
                                                    ) {
                                                      return true;
                                                    }
                                                    if (
                                                      Number.isFinite(comment.numericId) &&
                                                      removeIds.has(String(comment.numericId))
                                                    ) {
                                                      return true;
                                                    }
                                                    return false;
                                                  });
                                                  return {
                                                    ...prev,
                                                    ...refreshed,
                                                    [commentKey]: nextList,
                                                  };
                                                });
                                                if (!stillThere) {
                                                  return;
                                                }
                                              } catch {
                                                // fall through to error message
                                              }
                                            }
                                            console.error("Delete comment failed", err);
                                            setError("Failed to delete comment.");
                                          }
                                        }}
                                      >
                                        Delete
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </li>
                          );
                          })}
                        </ul>
                      ) : (
                        <p className="status">No comments yet.</p>
                      )}
                      <div className="comment-form">
                        <div className="comment-form-row">
                          <input
                            className="auth-input"
                            placeholder="Add a comment..."
                            value={commentInputs[commentKey] || ""}
                            onChange={(e) =>
                              setCommentInputs((prev) => ({
                                ...prev,
                                [commentKey]: sanitizePostText(e.target.value),
                              }))
                            }
                          />
                          <button
                            className="btn primary"
                            type="button"
                            disabled={
                              !commentInputs[commentKey]?.trim() &&
                              commentAttachmentFiles.length === 0
                            }
                            onClick={async () => {
                              const body = (commentInputs[commentKey] || "").trim();
                              if (!body && commentAttachmentFiles.length === 0) return;
                              try {
                                let attachmentUrls: string[] = [];
                                if (commentAttachmentFiles.length > 0) {
                                  const fd = new FormData();
                                  commentAttachmentFiles.forEach((file) =>
                                    fd.append("files", file)
                                  );
                                  const uploadRes = await api.post("/upload", fd);
                                  attachmentUrls = (uploadRes.data ?? [])
                                    .map((item: { url?: string }) => item?.url)
                                    .filter(
                                      (url: string | undefined): url is string =>
                                        Boolean(url)
                                    );
                                }
                                const combinedBody = [body, ...attachmentUrls]
                                  .filter(Boolean)
                                  .join("\n");
                                if (!combinedBody.trim()) return;
                                await api.post("/comments", {
                                  data: {
                                    body: combinedBody,
                                    target_type: "user",
                                    target_id: p.numericId ?? p.id,
                                  },
                                });
                                await refreshCommentsForPost(p.numericId ?? p.id);
                                setCommentInputs((prev) => ({
                                  ...prev,
                                  [commentKey]: "",
                                }));
                                clearCommentAttachments(commentKey);
                              } catch (err) {
                                console.error("Add comment failed", err);
                                if (axios.isAxiosError(err)) {
                                  const msg =
                                    err.response?.data?.error?.message ||
                                    err.response?.data?.message ||
                                    "Failed to add comment.";
                                  setError(String(msg));
                                } else {
                                  setError("Failed to add comment.");
                                }
                              }
                            }}
                          >
                            Comment
                          </button>
                        </div>
                        <div className="comment-attachments">
                          <label className="comment-upload">
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              onChange={(e) => {
                                handleCommentFilesChange(commentKey, e.target.files);
                                e.target.value = "";
                              }}
                            />
                            <span>
                              {commentAttachmentFiles.length
                                ? "Change photos"
                                : "Add photos"}
                            </span>
                          </label>
                          {commentAttachmentPreviews.length > 0 && (
                            <div className="comment-attachment-list">
                              {commentAttachmentPreviews.map((url, index) => (
                                <div
                                  key={`${commentKey}-attachment-${index}`}
                                  className="comment-attachment"
                                >
                                  <img
                                    src={url}
                                    alt="New attachment preview"
                                    loading="lazy"
                                    decoding="async"
                                  />
                                  <button
                                    type="button"
                                    className="comment-attachment-remove"
                                    aria-label="Remove photo"
                                    onClick={() =>
                                      removeCommentAttachment(commentKey, index)
                                    }
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </PopupModal>
                </div>
              </article>
            );
          })}
          </div>
          ))}
        </section>
        </div>
        )}
      </div>

      {trustedCircleDeleteOpen && trustedCircleDeleteTarget && (
        <div className="trusted-circle-modal__backdrop">
          <div className="trusted-circle-modal">
            <h4>Delete trusted circle?</h4>
            <p>
              This will remove <strong>{trustedCircleDeleteTarget.name}</strong> and
              all members in the circle. Posts or media shared to this circle will
              become private.
            </p>
            <div className="trusted-circle-modal__actions">
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  setTrustedCircleDeleteOpen(false);
                  setTrustedCircleDeleteTarget(null);
                }}
                disabled={trustedCircleSaving}
              >
                Cancel
              </button>
              <button
                className="btn ghost danger"
                type="button"
                onClick={handleDeleteTrustedCircle}
                disabled={trustedCircleSaving}
              >
                {trustedCircleSaving ? "Deleting..." : "Delete circle"}
              </button>
            </div>
          </div>
        </div>
      )}

      {mediaLightboxOpen && activeMediaItem && (
        <div
          className="media-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeMediaLightbox();
            }
          }}
        >
          <div className="media-lightbox__dialog">
            <div className="media-lightbox__media">
              {activeMediaItem.media ? (
                activeMediaItem.kind === "video" ||
                isVideoUrl(activeMediaItem.media) ? (
                  <video controls autoPlay>
                    <source src={activeMediaItem.media} />
                  </video>
                ) : (
                  <img
                    src={activeMediaItem.media}
                    alt={activeMediaItem.title || "Photo"}
                  />
                )
              ) : (
                <div className="profile-media__placeholder">No media</div>
              )}
              {mediaLightboxItems.length > 1 && (
                <>
                  <button
                    className="media-lightbox__nav media-lightbox__nav--prev"
                    type="button"
                    onClick={() =>
                      setMediaLightboxIndex((prev) =>
                        (prev - 1 + mediaLightboxItems.length) %
                        mediaLightboxItems.length
                      )
                    }
                    aria-label="Previous media"
                  >
                    {"<"}
                  </button>
                  <button
                    className="media-lightbox__nav media-lightbox__nav--next"
                    type="button"
                    onClick={() =>
                      setMediaLightboxIndex((prev) =>
                        (prev + 1) % mediaLightboxItems.length
                      )
                    }
                    aria-label="Next media"
                  >
                    {">"}
                  </button>
                  <div className="media-lightbox__counter">
                    {mediaLightboxIndex + 1} / {mediaLightboxItems.length}
                  </div>
                </>
              )}
            </div>
            <div className="media-lightbox__details">
              <div className="media-lightbox__header">
                <div>
                  <p className="media-lightbox__eyebrow">
                    {activeMediaItem.kind === "video" ||
                    isVideoUrl(activeMediaItem.media)
                      ? "Video"
                      : "Photo"}
                  </p>
                  <h3 className="media-lightbox__title">
                    {activeMediaItem.title ||
                      (activeMediaItem.kind === "video" ? "Video" : "Photo")}
                  </h3>
                </div>
                <button
                  className="media-lightbox__close"
                  type="button"
                  onClick={closeMediaLightbox}
                >
                  Close
                </button>
              </div>
              {activeMediaItem.caption ? (
                <p className="media-lightbox__caption">{activeMediaItem.caption}</p>
              ) : (
                <p className="media-lightbox__caption is-muted">
                  No description yet.
                </p>
              )}
              <div className="media-lightbox__meta">
                <span className="media-lightbox__tag">
                  {activeMediaItem.visibility || "friends"}
                </span>
                {normalizeFolderName(activeMediaItem.folder) && (
                  <span className="media-lightbox__tag">
                    {normalizeFolderName(activeMediaItem.folder)}
                  </span>
                )}
                {activeMediaItem.createdAt && (
                  <span className="media-lightbox__tag">
                    {formatPostUpdateLabel(activeMediaItem.createdAt)}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
