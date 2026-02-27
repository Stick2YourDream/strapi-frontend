import { createContext, useContext, useState, useEffect, useRef } from "react";
import api, { setAuthToken } from "../api/strapi";
import {
  buildProfilePayloadFromAttrs,
  decryptOwnProfilePayload,
  encryptProfilePayload,
  deleteProfileKeyShares,
  ensureUserKeyOnServer,
  PROFILE_PII_CLEAR_FIELDS,
  resetSelfProfileKey,
  type NotificationReadState,
  type NotificationSettings,
  type PrivacySettings,
  type ProfilePayload,
  type ProfileVisibility,
  type VisibilityLevel,
} from "../utils/profile-e2ee";
import {
  normalizeTimeLimitSettings,
  type TimeLimitSettings,
} from "../utils/time-limits";
import { getOrCreateProfileKey } from "../utils/crypto";
import {
  createKeyBackup,
  deleteKeyBackup,
  fetchKeyBackup,
  hasLocalKeyMaterial,
  restoreKeyBackup,
} from "../utils/key-backup";
import { resetEncryptedProfileOnServer } from "../utils/crypto-recovery";
import { pickMediaUrl } from "../utils/media";

interface User {
  id: number;
  email: string;
  username?: string;
  appRole?: "user" | "moderator" | "admin";
  blocked?: boolean;
  deactivationReason?: string | null;
  createdAt?: string | null;
  ageVerified?: boolean;
  ageVerifiedAt?: string | null;
  ageVerificationRequired?: boolean;
  ageVerificationDueAt?: string | null;
  ageVerificationOverdue?: boolean;
  ageVerificationDaysRemaining?: number | null;
  ageVerificationDobMismatchAt?: string | null;
  ageVerificationDobMismatchDueAt?: string | null;
  ageVerificationDobMismatchOverdue?: boolean;
  ageVerificationDobMismatchDaysRemaining?: number | null;
}


interface ProfileSummary {
  id?: number | string;
  onboardingComplete?: boolean;
  intent?: string;
  firstName?: string;
  lastName?: string;
  age?: string;
  birthday?: string;
  gender?: string;
  religion?: string;
  hobbies?: string;
  occupation?: string;
  bio?: string;
  phone?: string;
  country?: string;
  countryCode?: string;
  state?: string;
  stateCode?: string;
  city?: string;
  handle?: string;
  avatarUrl?: string;
  backgrounds?: Record<
    string,
    {
      color?: string;
      colorOpacity?: number;
      image?: string;
      gradientStart?: string;
      gradientEnd?: string;
      gradientAngle?: number;
      gradientOpacity?: number;
    }
  >;
  profileVisibility?: ProfileVisibility;
  privacySettings?: PrivacySettings;
  searchIndexingEnabled?: boolean;
  externalIndexingEnabled?: boolean;
  activityVisibility?: VisibilityLevel;
  notificationSettings?: NotificationSettings;
  notificationReadState?: NotificationReadState;
  mediaFolders?: string[];
  timeLimitSettings?: TimeLimitSettings;
  storefrontDefaultLocation?: string;
  storefrontDefaultRadiusMiles?: number;
  lastSeenAt?: string;
  avatarSchedule?: Record<
    string,
    {
      id?: number;
      url?: string;
      updatedAt?: string;
    }
  >;
}

interface AppSettings {
  newsroomEnabled: boolean;
  storefrontEnabled: boolean;
}

interface AuthContextType {
  user: User | null;
  profile: ProfileSummary | null;
  profileLoading: boolean;
  appSettings: AppSettings;
  authReady: boolean;
  sessionActive: boolean;
  sessionStartedAt: number | null;
  sessionExpiresAt: number | null;
  keyBackupStatus: "unknown" | "ready" | "needs-setup" | "needs-restore";
  keyBackupLoading: boolean;
  keyBackupError: string | null;
  login: (user: User, token: string, options?: { rememberDevice?: boolean }) => void;
  updateUser: (user: User) => void;
  logout: (reason?: string) => void;
  refreshProfile: () => Promise<void>;
  refreshAppSettings: () => Promise<void>;
  refreshKeyBackup: () => Promise<void>;
  createKeyBackup: (passphrase: string) => Promise<boolean>;
  restoreKeyBackup: (passphrase: string) => Promise<boolean>;
  resetEncryptedProfile: (options?: {
    recoveryToken?: string;
    recoveryCode?: string;
  }) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const stripBearer = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === "null" || lowered === "undefined") return null;
  return lowered.startsWith("bearer ")
    ? trimmed.slice(7).trim()
    : trimmed;
};

const parseJwtPayload = (token: string | null) => {
  const clean = stripBearer(token);
  if (!clean || typeof clean !== "string") return null;
  const parts = clean.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  try {
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
};

const parseJwtExpiry = (token: string | null) => {
  const decoded = parseJwtPayload(token);
  const rawExp = decoded?.exp;
  if (typeof rawExp === "number") {
    return rawExp > 10_000_000_000 ? rawExp : rawExp * 1000;
  }
  if (typeof rawExp === "string") {
    const parsed = Number(rawExp);
    if (Number.isFinite(parsed)) {
      return parsed > 10_000_000_000 ? parsed : parsed * 1000;
    }
  }
  return null;
};

const parseJwtIssuedAt = (token: string | null) => {
  const decoded = parseJwtPayload(token);
  const rawIat = decoded?.iat;
  if (typeof rawIat === "number") {
    return rawIat > 10_000_000_000 ? rawIat : rawIat * 1000;
  }
  if (typeof rawIat === "string") {
    const parsed = Number(rawIat);
    if (Number.isFinite(parsed)) {
      return parsed > 10_000_000_000 ? parsed : parsed * 1000;
    }
  }
  return null;
};

const parseJwtUserId = (token: string | null) => {
  const decoded = parseJwtPayload(token);
  const rawId = decoded?.id ?? decoded?.userId ?? decoded?.sub;
  const parsed = Number(rawId);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const normalizeTokenValue = (value: string | null | undefined) => {
  return stripBearer(value);
};

const safeGetItem = (storage: Storage | null | undefined, key: string) => {
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
};

const trySetItem = (storage: Storage | null | undefined, key: string, value: string) => {
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
};

const normalizeBirthdayValue = (value?: string) => {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const datePart = raw.split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const normalizePhoneValue = (value?: string) => {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length < 10) return null;
  return digits.slice(-10);
};

const normalizeRadiusValue = (value?: string | number | null) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
};

const normalizeMediaFolders = (value: unknown) => {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  const folders: string[] = [];
  value.forEach((entry) => {
    const name = String(entry || "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    folders.push(name);
  });
  return folders;
};

const LOGOUT_MESSAGE_KEY = "auth:logout-message";
const TIME_LIMIT_STORAGE_PREFIX = "ysp-time-limit";

const pickLogoutMessage = (reason?: string) => {
  const generalMessages = [
    "Thanks for showing up today. Keep shining and come back whenever you’re ready.",
    "Nice work today. Take a breather and we’ll see you soon.",
    "You made progress. Step away for a moment and come back refreshed.",
    "Great effort. Take care of yourself and we’ll be here when you return.",
  ];
  const timeLimitMessages = [
    "Time’s up for this session. You did great — take a break and we’ll see you soon.",
    "Great focus. We logged you out so you can recharge.",
    "Nice work staying on track. Take a pause and come back strong.",
  ];
  const pool = reason === "time-limit" ? timeLimitMessages : generalMessages;
  return pool[Math.floor(Math.random() * pool.length)];
};

const storeLogoutMessage = (reason?: string) => {
  if (typeof window === "undefined") return;
  if (reason !== "user-action" && reason !== "time-limit") return;
  try {
    window.localStorage.setItem(LOGOUT_MESSAGE_KEY, pickLogoutMessage(reason));
  } catch {
    // ignore storage errors
  }
};

const clearTimeLimitStorage = (userId: number) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${TIME_LIMIT_STORAGE_PREFIX}:${userId}`);
  } catch {
    // ignore storage errors
  }
};

type AuthSnapshot = {
  userRaw?: string;
  userId?: string;
  token?: string;
  expiresAt?: string;
  rememberDevice?: string;
};

const persistAuthSnapshot = (storage: Storage, snapshot: AuthSnapshot) => {
  let ok = true;
  if (snapshot.userRaw !== undefined) {
    ok = trySetItem(storage, "user", snapshot.userRaw) && ok;
  }
  if (snapshot.userId !== undefined) {
    ok = trySetItem(storage, "userId", snapshot.userId) && ok;
  }
  if (snapshot.token !== undefined) {
    ok = trySetItem(storage, "token", snapshot.token) && ok;
  }
  if (snapshot.expiresAt !== undefined) {
    ok = trySetItem(storage, "expiresAt", snapshot.expiresAt) && ok;
  }
  if (snapshot.rememberDevice !== undefined) {
    ok = trySetItem(storage, "rememberDevice", snapshot.rememberDevice) && ok;
  }
  return ok;
};

const parseStoredUser = (raw: string | null, storage?: Storage | null) => {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lowered = trimmed.toLowerCase();
  if (lowered === "null" || lowered === "undefined") {
    try {
      storage?.removeItem("user");
    } catch {
      // ignore storage errors
    }
    return null;
  }
  try {
    return JSON.parse(raw) as User;
  } catch {
    try {
      storage?.removeItem("user");
    } catch {
      // ignore storage errors
    }
    return null;
  }
};

const resolveEffectiveExpiry = (
  requestedExpiresAt: number | null,
  tokenExpiresAt: number | null,
  now: number
) => {
  const minSkewMs = 60_000;
  const tokenLooksValid =
    Number.isFinite(tokenExpiresAt as number) &&
    (tokenExpiresAt as number) > now + minSkewMs;
  if (tokenLooksValid && Number.isFinite(requestedExpiresAt as number)) {
    return Math.min(requestedExpiresAt as number, tokenExpiresAt as number);
  }
  if (tokenLooksValid) return tokenExpiresAt as number;
  if (Number.isFinite(requestedExpiresAt as number)) return requestedExpiresAt as number;
  return Number.isFinite(tokenExpiresAt as number) ? (tokenExpiresAt as number) : null;
};

const normalizeExpiry = (value: number | null) => {
  if (!Number.isFinite(value as number)) return null;
  const numeric = value as number;
  if (numeric <= 0) return null;
  // If stored as seconds (legacy), convert to ms.
  if (numeric > 0 && numeric < 10_000_000_000) {
    return numeric * 1000;
  }
  return numeric;
};

const parseStoredUserId = (local: Storage, session: Storage) => {
  const raw =
    safeGetItem(local, "userId") ||
    safeGetItem(session, "userId");
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true); // Track if auth is initializing
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>({
    newsroomEnabled: true,
    storefrontEnabled: true,
  });
  const [authReady, setAuthReady] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const [keyBackupStatus, setKeyBackupStatus] =
    useState<AuthContextType["keyBackupStatus"]>("unknown");
  const [keyBackupLoading, setKeyBackupLoading] = useState(false);
  const [keyBackupError, setKeyBackupError] = useState<string | null>(null);
  const [profileSynced, setProfileSynced] = useState(false);
  const lastLoginAtRef = useRef<number | null>(null);
  const hasEncryptedProfileRef = useRef<boolean | null>(null);
  const profileDecryptFailedRef = useRef(false);
  const lastGoodProfileRef = useRef<ProfileSummary | null>(null);

  useEffect(() => {
    let active = true;

    const hydrate = async () => {
      const now = Date.now();
      const localToken = normalizeTokenValue(safeGetItem(window.localStorage, "token"));
      const sessionToken = normalizeTokenValue(safeGetItem(window.sessionStorage, "token"));
      const storedToken = localToken || sessionToken;
      const storedUserId = parseStoredUserId(window.localStorage, window.sessionStorage);

      const localUserRaw = safeGetItem(window.localStorage, "user");
      const sessionUserRaw = safeGetItem(window.sessionStorage, "user");
      let storedUser = parseStoredUser(localUserRaw, window.localStorage);
      if (!storedUser && sessionUserRaw) {
        storedUser = parseStoredUser(sessionUserRaw, window.sessionStorage);
      }

      const expiresAtRaw =
        safeGetItem(window.localStorage, "expiresAt") ||
        safeGetItem(window.sessionStorage, "expiresAt");
      const rememberFlag =
        safeGetItem(window.localStorage, "rememberDevice") ||
        safeGetItem(window.sessionStorage, "rememberDevice");
      const rememberDevice = rememberFlag === "1" || rememberFlag === "true";

      if (storedToken) {
        const storedExpiresAt = normalizeExpiry(Number(expiresAtRaw));
        const validStoredExpiresAt =
          storedExpiresAt && storedExpiresAt > now ? storedExpiresAt : null;
        const tokenExpiresAt = parseJwtExpiry(storedToken);
        const fallbackSessionDays = rememberDevice ? 30 : 1;
        const requestedExpiresAt = now + fallbackSessionDays * 24 * 60 * 60 * 1000;
        const effectiveExpiresAt = resolveEffectiveExpiry(
          Number.isFinite(validStoredExpiresAt as number)
            ? (validStoredExpiresAt as number)
            : requestedExpiresAt,
          tokenExpiresAt,
          now
        );
        const effectiveExpiry =
          Number.isFinite(effectiveExpiresAt as number) ? (effectiveExpiresAt as number) : null;
        const fallbackExpiry = now + 2 * 60 * 60 * 1000;
        const resolvedExpiry = effectiveExpiry || fallbackExpiry;

        if (!effectiveExpiry || now < effectiveExpiry) {
          const issuedAt = parseJwtIssuedAt(storedToken) || now;
          if (active) {
            setSessionActive(true);
            setSessionExpiresAt(resolvedExpiry);
            setSessionStartedAt(issuedAt);
          }
          lastLoginAtRef.current = issuedAt;
          sessionStorage.setItem("auth:last-login-at", String(issuedAt));
          const baseSnapshot: AuthSnapshot = {
            token: storedToken,
            expiresAt: resolvedExpiry.toString(),
            rememberDevice: rememberDevice ? "1" : "0",
          };
          persistAuthSnapshot(window.localStorage, baseSnapshot);
          persistAuthSnapshot(window.sessionStorage, baseSnapshot);
          setAuthToken(storedToken);

          const tokenUserId = parseJwtUserId(storedToken);
          const fallbackId = storedUserId ?? tokenUserId;
          const hasFallback = typeof fallbackId === "number" && fallbackId > 0;

          if (storedUser) {
            const userSnapshot: AuthSnapshot = {
              userRaw: JSON.stringify(storedUser),
              userId: String(storedUser.id),
            };
            persistAuthSnapshot(window.localStorage, userSnapshot);
            persistAuthSnapshot(window.sessionStorage, userSnapshot);
            if (active) {
              setUser(storedUser);
            }
          } else if (hasFallback && active) {
            const fallbackUser: User = {
              id: fallbackId,
              email: "",
            };
            const userSnapshot: AuthSnapshot = {
              userRaw: JSON.stringify(fallbackUser),
              userId: String(fallbackId),
            };
            persistAuthSnapshot(window.localStorage, userSnapshot);
            persistAuthSnapshot(window.sessionStorage, userSnapshot);
            setUser(fallbackUser);
          }

          if (!storedUser) {
            try {
              const res = await api.get("/account/status");
              const payload = res.data?.user || res.data || {};
              const recovered: User = {
                id: Number(payload.id),
                email: String(payload.email || ""),
                username: payload.username || undefined,
                appRole: payload.appRole || undefined,
                blocked: payload.blocked === true,
                deactivationReason: payload.deactivationReason || null,
                ageVerified: payload.ageVerified ?? undefined,
                ageVerifiedAt: payload.ageVerifiedAt ?? null,
                ageVerificationRequired: payload.ageVerificationRequired ?? undefined,
                ageVerificationDueAt: payload.ageVerificationDueAt ?? null,
                ageVerificationOverdue: payload.ageVerificationOverdue ?? undefined,
                ageVerificationDaysRemaining: payload.ageVerificationDaysRemaining ?? null,
                ageVerificationDobMismatchAt:
                  payload.ageVerificationDobMismatchAt ?? null,
                ageVerificationDobMismatchDueAt:
                  payload.ageVerificationDobMismatchDueAt ?? null,
                ageVerificationDobMismatchOverdue:
                  payload.ageVerificationDobMismatchOverdue ?? undefined,
                ageVerificationDobMismatchDaysRemaining:
                  payload.ageVerificationDobMismatchDaysRemaining ?? null,
              };
              if (Number.isFinite(recovered.id)) {
                const userSnapshot: AuthSnapshot = {
                  userRaw: JSON.stringify(recovered),
                  userId: String(recovered.id),
                };
                persistAuthSnapshot(window.localStorage, userSnapshot);
                persistAuthSnapshot(window.sessionStorage, userSnapshot);
                if (active) {
                  setUser(recovered);
                }
              }
            } catch (error) {
              if (active && !hasFallback) {
                console.warn("Auth: unable to restore user from token.", error);
              } else if (!storedUser) {
                console.warn("Auth: recovered user from token due to /account/status failure.", error);
              }
            }
          }
        } else {
          if (active) {
            setSessionActive(false);
            setSessionExpiresAt(null);
            setUser(null);
          }
          localStorage.removeItem("user");
          localStorage.removeItem("token");
          localStorage.removeItem("expiresAt");
          localStorage.removeItem("rememberDevice");
          localStorage.removeItem("userId");
          sessionStorage.removeItem("user");
          sessionStorage.removeItem("token");
          sessionStorage.removeItem("expiresAt");
          sessionStorage.removeItem("rememberDevice");
          sessionStorage.removeItem("userId");
          setAuthToken(null);
        }
      } else {
        if (active) {
          setSessionActive(false);
          setSessionExpiresAt(null);
          setUser(null);
        }
        localStorage.removeItem("user");
        localStorage.removeItem("token");
        localStorage.removeItem("expiresAt");
        localStorage.removeItem("rememberDevice");
        localStorage.removeItem("userId");
        sessionStorage.removeItem("user");
        sessionStorage.removeItem("token");
        sessionStorage.removeItem("expiresAt");
        sessionStorage.removeItem("rememberDevice");
        sessionStorage.removeItem("userId");
        setAuthToken(null);
      }

      if (active) {
        setLoading(false);
        setAuthReady(true);
      }
    };

    void hydrate();

    return () => {
      active = false;
    };
  }, []);

  const refreshProfile = async () => {
    if (!user) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    setProfileSynced(false);
    profileDecryptFailedRef.current = false;
    const previousProfile = lastGoodProfileRef.current || profile;
    try {
      const res = await api.get("/profiles/me?populate=avatar");
      const data = res.data?.data;
      const attrs = data?.attributes ?? data ?? null;
      if (!attrs) {
        setProfile(null);
        hasEncryptedProfileRef.current = null;
        profileDecryptFailedRef.current = false;
        lastGoodProfileRef.current = null;
        return;
      }

      const hasEncryptedProfile = Boolean(attrs.encryptedProfile);
      hasEncryptedProfileRef.current = hasEncryptedProfile;
      const basePayload = buildProfilePayloadFromAttrs(attrs);
      let payload: ProfilePayload | null = null;
      if (attrs.encryptedProfile) {
        try {
          payload = await decryptOwnProfilePayload(user.id, attrs.encryptedProfile);
        } catch (error) {
          profileDecryptFailedRef.current = true;
          console.warn("Unable to decrypt profile payload:", error);
        }
      }

      if (payload) {
        payload = { ...basePayload, ...payload };
      } else {
        payload = basePayload;
        if (!hasEncryptedProfile && Object.values(payload).some((value) => value)) {
          try {
            const normalizedBirthday = normalizeBirthdayValue(payload.birthday);
            const normalizedPhone = normalizePhoneValue(payload.phone);
            const normalizedRadius = normalizeRadiusValue(payload.storefrontDefaultRadiusMiles);
            const encryptedProfile = await encryptProfilePayload(user.id, payload);
            await api.put("/profiles/me", {
              data: {
                encryptedProfile,
                profileKeyVersion: 1,
                firstName: payload.firstName || "",
                lastName: payload.lastName || "",
                age: payload.age || "",
                birthday: normalizedBirthday,
                gender: payload.gender || "",
                religion: payload.religion || "",
                hobbies: payload.hobbies || "",
                occupation: payload.occupation || "",
                bio: payload.bio || "",
                country: payload.country || "",
                countryCode: payload.countryCode || "",
                state: payload.state || "",
                stateCode: payload.stateCode || "",
                city: payload.city || "",
                phone: normalizedPhone,
                ...PROFILE_PII_CLEAR_FIELDS,
                storefrontDefaultLocation: payload.storefrontDefaultLocation || "",
                storefrontDefaultRadiusMiles: normalizedRadius,
              },
            });
          } catch (error) {
            console.warn("Unable to migrate profile encryption:", error);
          }
        }
      }

      const publicFirstName = String(attrs.firstName || "").trim();
      const publicLastName = String(attrs.lastName || "").trim();
      const payloadFirstName = String(payload?.firstName || "").trim();
      const payloadLastName = String(payload?.lastName || "").trim();
      const nameUpdate: Record<string, string> = {};
      if (payloadFirstName && payloadFirstName !== publicFirstName) {
        nameUpdate.firstName = payloadFirstName;
      }
      if (payloadLastName && payloadLastName !== publicLastName) {
        nameUpdate.lastName = payloadLastName;
      }
      if (Object.keys(nameUpdate).length > 0) {
        try {
          await api.put("/profiles/me", { data: nameUpdate });
        } catch (error) {
          console.warn("Unable to sync public name fields:", error);
        }
      }

      const normalizedPublicBirthday = normalizeBirthdayValue(payload?.birthday);
      const normalizedPublicPhone = normalizePhoneValue(payload?.phone);
      const normalizedPublicRadius = normalizeRadiusValue(
        payload?.storefrontDefaultRadiusMiles ?? null
      );
      const publicFields = {
        age: payload?.age || "",
        birthday: normalizedPublicBirthday,
        gender: payload?.gender || "",
        religion: payload?.religion || "",
        hobbies: payload?.hobbies || "",
        occupation: payload?.occupation || "",
        bio: payload?.bio || "",
        country: payload?.country || "",
        countryCode: payload?.countryCode || "",
        state: payload?.state || "",
        stateCode: payload?.stateCode || "",
        city: payload?.city || "",
        phone: normalizedPublicPhone,
        storefrontDefaultLocation: payload?.storefrontDefaultLocation || "",
        storefrontDefaultRadiusMiles: normalizedPublicRadius,
      };
      const changedPublicFields: Record<string, any> = {};
      Object.entries(publicFields).forEach(([key, value]) => {
        const current = attrs?.[key];
        const currentComparable = current ?? "";
        const nextComparable = value ?? "";
        if (String(currentComparable) !== String(nextComparable)) {
          changedPublicFields[key] = value;
        }
      });
      if (Object.keys(changedPublicFields).length > 0) {
        try {
          await api.put("/profiles/me", { data: changedPublicFields });
        } catch (error) {
          console.warn("Unable to sync public profile fields:", error);
        }
      }

      const onboardingComplete =
        typeof payload?.onboardingComplete === "boolean"
          ? payload.onboardingComplete
          : typeof attrs.onboardingComplete === "boolean"
          ? attrs.onboardingComplete
          : true;

      const resolveScheduledAvatarUrl = () => {
        const schedule = attrs?.avatarSchedule;
        if (!schedule || typeof schedule !== "object") return undefined;
        const dayIndex = new Date().getDay();
        const dayKeys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
        const dayKey = dayKeys[dayIndex] || "mon";
        const entry = (schedule as Record<string, any>)[dayKey];
        if (!entry) return undefined;
        const entryUrl = typeof entry === "string" ? entry : entry?.url;
        if (!entryUrl) return undefined;
        return pickMediaUrl({ url: entryUrl }, { kind: "avatar" });
      };

      const scheduledAvatarUrl = resolveScheduledAvatarUrl();
      const avatarUrl =
        scheduledAvatarUrl || pickMediaUrl(attrs.avatar, { kind: "avatar" });
      const handle = attrs.handle || undefined;
      const notificationReadState = attrs?.notificationReadState || undefined;
      const timeLimitSettings = normalizeTimeLimitSettings(attrs?.timeLimitSettings);
      const mergedPayload =
        profileDecryptFailedRef.current && lastGoodProfileRef.current
          ? { ...lastGoodProfileRef.current, ...payload }
          : payload;
      const nextProfile = {
        ...mergedPayload,
        onboardingComplete,
        avatarUrl,
        handle,
        notificationReadState,
        mediaFolders: normalizeMediaFolders(attrs?.mediaFolders),
        timeLimitSettings,
        storefrontDefaultLocation: payload?.storefrontDefaultLocation || "",
        storefrontDefaultRadiusMiles:
          typeof payload?.storefrontDefaultRadiusMiles === "number"
            ? payload.storefrontDefaultRadiusMiles
            : payload?.storefrontDefaultRadiusMiles
            ? Number(payload.storefrontDefaultRadiusMiles)
            : undefined,
        avatarSchedule: attrs?.avatarSchedule || undefined,
      };
      setProfile(nextProfile);
      lastGoodProfileRef.current = nextProfile;
    } catch {
      if (previousProfile) {
        setProfile(previousProfile);
      } else {
        setProfile(null);
      }
    } finally {
      setProfileLoading(false);
      setProfileSynced(true);
    }
  };

  const refreshAppSettings = async () => {
    if (!user) {
      setAppSettings({ newsroomEnabled: true, storefrontEnabled: true });
      return;
    }
    try {
      const res = await api.get("/moderation/settings");
      const data = res.data?.data;
      setAppSettings({
        newsroomEnabled: data?.newsroomEnabled !== false,
        storefrontEnabled: data?.storefrontEnabled !== false,
      });
    } catch {
      // keep the existing settings if the request fails
    }
  };

  const refreshKeyBackup = async () => {
    if (!user) {
      setKeyBackupStatus("unknown");
      setKeyBackupError(null);
      return;
    }
    setKeyBackupLoading(true);
    setKeyBackupError(null);
    try {
      const [hasLocal, backup] = await Promise.all([
        hasLocalKeyMaterial(user.id),
        fetchKeyBackup().catch(() => null),
      ]);
      const backupExists = Boolean(backup?.encryptedPayload);
      const encryptedProfileFlag = hasEncryptedProfileRef.current;
      if (encryptedProfileFlag === null) {
        setKeyBackupStatus("unknown");
        return;
      }
      const hasEncryptedProfile = encryptedProfileFlag === true;
      const decryptFailed = profileDecryptFailedRef.current === true;
      if (decryptFailed) {
        setKeyBackupStatus("needs-restore");
        setKeyBackupError(null);
        return;
      }
      if (hasLocal) {
        await ensureUserKeyOnServer();
        setKeyBackupStatus("ready");
      } else if (backupExists || hasEncryptedProfile) {
        setKeyBackupStatus("needs-restore");
        setKeyBackupError(null);
      } else {
        await ensureUserKeyOnServer();
        await getOrCreateProfileKey(user.id);
        setKeyBackupStatus("ready");
      }
    } catch (error) {
      console.warn("Unable to check key backup status:", error);
      setKeyBackupError("Unable to check key backup status.");
    } finally {
      setKeyBackupLoading(false);
    }
  };

  const createKeyBackupWithPassphrase = async (passphrase: string) => {
    if (!user) return false;
    setKeyBackupLoading(true);
    setKeyBackupError(null);
    try {
      await createKeyBackup(user.id, passphrase);
      setKeyBackupStatus("ready");
      return true;
    } catch (error) {
      console.warn("Unable to create key backup:", error);
      setKeyBackupError("Unable to create key backup.");
      return false;
    } finally {
      setKeyBackupLoading(false);
    }
  };

  const restoreKeyBackupWithPassphrase = async (passphrase: string) => {
    if (!user) return false;
    setKeyBackupLoading(true);
    setKeyBackupError(null);
    try {
      await restoreKeyBackup(user.id, passphrase);
      const hasLocal = await hasLocalKeyMaterial(user.id);
      if (!hasLocal) {
        setKeyBackupError(
          "Unable to persist keys in this browser. Check storage settings and try again."
        );
        setKeyBackupStatus("needs-restore");
        return false;
      }
      await ensureUserKeyOnServer();
      await refreshProfile();
      if (profileDecryptFailedRef.current) {
        setKeyBackupError(
          "Backup does not match the current encrypted profile. Request device approval or reset encrypted profile."
        );
        setKeyBackupStatus("needs-restore");
        return false;
      }
      setKeyBackupStatus("ready");
      return true;
    } catch (error) {
      console.warn("Unable to restore key backup:", error);
      setKeyBackupError("Unable to restore key backup. Check your passphrase.");
      return false;
    } finally {
      setKeyBackupLoading(false);
    }
  };

  const resetEncryptedProfile = async (options?: {
    recoveryToken?: string;
    recoveryCode?: string;
  }) => {
    if (!user) return false;
    setKeyBackupLoading(true);
    setKeyBackupError(null);
    try {
      if (options?.recoveryToken || options?.recoveryCode) {
        await resetEncryptedProfileOnServer({
          token: options.recoveryToken,
          recoveryCode: options.recoveryCode,
        });
      } else {
        await Promise.all([deleteKeyBackup().catch(() => undefined), deleteProfileKeyShares()]);
      }
      await resetSelfProfileKey(user.id);
      const res = await api.get("/profiles/me");
      const attrs = res.data?.data?.attributes ?? res.data?.data ?? {};
      const basePayload = buildProfilePayloadFromAttrs(attrs);
      const encryptedProfile = await encryptProfilePayload(user.id, basePayload);
      await api.put("/profiles/me", {
        data: {
          encryptedProfile,
          profileKeyVersion: 1,
          ...PROFILE_PII_CLEAR_FIELDS,
        },
      });
      await ensureUserKeyOnServer();
      await refreshProfile();
      await refreshKeyBackup();
      return true;
    } catch (error) {
      console.warn("Unable to reset encrypted profile:", error);
      setKeyBackupError("Unable to reset encrypted profile.");
      return false;
    } finally {
      setKeyBackupLoading(false);
    }
  };

  useEffect(() => {
    if (!user) {
      setProfile(null);
      setProfileLoading(false);
      setProfileSynced(false);
      hasEncryptedProfileRef.current = null;
      return;
    }
    setProfileLoading(true);
    setProfileSynced(false);
    void refreshProfile();
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      setAppSettings({ newsroomEnabled: true, storefrontEnabled: true });
      return;
    }
    void refreshAppSettings();
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      setKeyBackupStatus("unknown");
      setKeyBackupError(null);
      return;
    }
    if (!profileSynced) return;
    void refreshKeyBackup();
  }, [profileSynced, user?.id]);

  // Auto-logout when the session window expires
  useEffect(() => {
    if (!user) return;
    const now = Date.now();
    const storedToken =
      normalizeTokenValue(safeGetItem(window.localStorage, "token")) ||
      normalizeTokenValue(safeGetItem(window.sessionStorage, "token"));
    if (!storedToken) return;
    const expiresAt =
      safeGetItem(window.localStorage, "expiresAt") ||
      safeGetItem(window.sessionStorage, "expiresAt");
    const rememberFlag =
      safeGetItem(window.localStorage, "rememberDevice") ||
      safeGetItem(window.sessionStorage, "rememberDevice");
    const rememberDevice = rememberFlag === "1" || rememberFlag === "true";

    const normalizedExpiresAt = normalizeExpiry(Number(expiresAt));
    const validStoredExpiresAt =
      normalizedExpiresAt && normalizedExpiresAt > now ? normalizedExpiresAt : null;
    const tokenExpiresAt = parseJwtExpiry(storedToken);
    const requestedExpiresAt =
      now + (rememberDevice ? 30 : 1) * 24 * 60 * 60 * 1000;
    const effectiveExpiresAt = resolveEffectiveExpiry(
      Number.isFinite(validStoredExpiresAt as number)
        ? (validStoredExpiresAt as number)
        : requestedExpiresAt,
      tokenExpiresAt,
      now
    );
    if (!Number.isFinite(effectiveExpiresAt as number)) return;

    const timeLeft = (effectiveExpiresAt as number) - now;
    if (!Number.isFinite(timeLeft)) {
      console.warn("Auth expiry is invalid; skipping auto-logout.");
      return;
    }
    if (timeLeft <= 0) {
      const graceMs = 5 * 60 * 1000;
      console.warn("Auth expiry already passed; applying grace window.", { timeLeft });
      const timer = setTimeout(() => {
        logout("session-expired");
      }, graceMs);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      logout("session-expired");
    }, timeLeft);

    return () => clearTimeout(timer);
  }, [user]);

  const login = (userData: User, token: string, options?: { rememberDevice?: boolean }) => {
    setUser(userData);
    setProfileLoading(true);
    setSessionActive(true);
    const snapshot: AuthSnapshot = {
      userRaw: JSON.stringify(userData),
      userId: String(userData.id),
      token: normalizeTokenValue(token) || token,
      rememberDevice: options?.rememberDevice ? "1" : "0",
    };
    persistAuthSnapshot(window.localStorage, snapshot);
    persistAuthSnapshot(window.sessionStorage, snapshot);
    setAuthToken(token);
    // 30 days when remembered, otherwise 24 hours.
    const sessionDays = options?.rememberDevice ? 30 : 1;
    const now = Date.now();
    const issuedAt = parseJwtIssuedAt(token) || now;
    lastLoginAtRef.current = issuedAt;
    sessionStorage.setItem("auth:last-login-at", String(issuedAt));
    setSessionStartedAt(issuedAt);
    const requestedExpiresAt = now + sessionDays * 24 * 60 * 60 * 1000;
    const tokenExpiresAt = parseJwtExpiry(token);
    const effectiveExpiresAt = resolveEffectiveExpiry(
      requestedExpiresAt,
      tokenExpiresAt,
      now
    );
    const minExpiry = now + 5 * 60 * 1000;
    const effectiveExpiry =
      Number.isFinite(effectiveExpiresAt as number)
        ? (effectiveExpiresAt as number)
        : requestedExpiresAt;
    const finalExpiry =
      effectiveExpiry > minExpiry ? effectiveExpiry : requestedExpiresAt;
    if (tokenExpiresAt && tokenExpiresAt <= now + 60_000) {
      console.warn("Auth token expiry is in the past or too soon; using session expiry.", {
        tokenExpiresAt,
        now,
      });
    }
    setSessionExpiresAt(finalExpiry);
    setAuthReady(true);
    const expirySnapshot: AuthSnapshot = {
      expiresAt: finalExpiry.toString(),
    };
    persistAuthSnapshot(window.localStorage, expirySnapshot);
    persistAuthSnapshot(window.sessionStorage, expirySnapshot);
    console.info("Auth: login success", { id: userData.id, email: userData.email });
  };

  const updateUser = (userData: User) => {
    const merged: User = {
      ...(user || {}),
      ...userData,
      appRole: userData.appRole ?? user?.appRole,
    };
    setUser(merged);
    const snapshot: AuthSnapshot = {
      userRaw: JSON.stringify(merged),
      userId: String(merged.id),
    };
    persistAuthSnapshot(window.localStorage, snapshot);
    persistAuthSnapshot(window.sessionStorage, snapshot);
  };

  const logout = (reason?: string) => {
    const now = Date.now();
    const lastLoginAt = lastLoginAtRef.current;
    const sinceLoginMs =
      Number.isFinite(lastLoginAt as number) && lastLoginAt
        ? now - lastLoginAt
        : null;
    const authDebug =
      typeof window !== "undefined" &&
      (window.location.search.includes("authDebug=1") ||
        window.localStorage.getItem("authDebug") === "1");
    if (reason !== "user-action" && sinceLoginMs !== null && sinceLoginMs < 120_000) {
      if (authDebug) {
        console.warn("Auth: logout ignored due to recent login.", {
          reason,
          sinceLoginMs,
        });
        console.trace("Auth logout ignored stack");
      }
      return;
    }
    if (authDebug) {
      console.warn("Auth: logout requested", { reason, sinceLoginMs });
      console.trace("Auth logout stack");
    }
    if (user?.id) {
      clearTimeLimitStorage(user.id);
    }
    storeLogoutMessage(reason);
    setUser(null);
    setProfile(null);
    setProfileLoading(false);
    setSessionActive(false);
    setSessionStartedAt(null);
    setSessionExpiresAt(null);
    setKeyBackupStatus("unknown");
    setKeyBackupLoading(false);
    setKeyBackupError(null);
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    localStorage.removeItem("expiresAt");
    localStorage.removeItem("rememberDevice");
    localStorage.removeItem("userId");
    sessionStorage.removeItem("user");
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("expiresAt");
    sessionStorage.removeItem("rememberDevice");
    sessionStorage.removeItem("userId");
    setAuthToken(null);
    console.info("Auth: logout success");
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        profileLoading,
        appSettings,
        authReady,
        sessionActive,
        sessionStartedAt,
        sessionExpiresAt,
        keyBackupStatus,
        keyBackupLoading,
        keyBackupError,
        login,
        updateUser,
        logout,
        refreshProfile,
        refreshAppSettings,
        refreshKeyBackup,
        createKeyBackup: createKeyBackupWithPassphrase,
        restoreKeyBackup: restoreKeyBackupWithPassphrase,
        resetEncryptedProfile,
      }}
    >
      {/* Prevent rendering children until auth state is loaded */}
      {!loading && children}
    </AuthContext.Provider>
  );
};

export const StaticAuthProvider = ({ children }: { children: React.ReactNode }) => {
    const emptyAuth: AuthContextType = {
      user: null,
      profile: null,
      profileLoading: false,
      appSettings: { newsroomEnabled: true, storefrontEnabled: true },
      authReady: true,
      sessionActive: false,
      sessionStartedAt: null,
      sessionExpiresAt: null,
      keyBackupStatus: "unknown",
      keyBackupLoading: false,
      keyBackupError: null,
      login: () => undefined,
      updateUser: () => undefined,
      logout: () => undefined,
      refreshProfile: async () => undefined,
      refreshAppSettings: async () => undefined,
      refreshKeyBackup: async () => undefined,
      createKeyBackup: async () => false,
      restoreKeyBackup: async () => false,
      resetEncryptedProfile: async () => false,
    };
  return <AuthContext.Provider value={emptyAuth}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
