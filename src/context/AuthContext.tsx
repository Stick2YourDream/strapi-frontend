import { createContext, useContext, useState, useEffect } from "react";
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
  lastSeenAt?: string;
}

interface AppSettings {
  newsroomEnabled: boolean;
}

interface AuthContextType {
  user: User | null;
  profile: ProfileSummary | null;
  profileLoading: boolean;
  appSettings: AppSettings;
  keyBackupStatus: "unknown" | "ready" | "needs-setup" | "needs-restore";
  keyBackupLoading: boolean;
  keyBackupError: string | null;
  login: (user: User, token: string, options?: { rememberDevice?: boolean }) => void;
  updateUser: (user: User) => void;
  logout: () => void;
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

const parseJwtExpiry = (token: string | null) => {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  try {
    const decoded = JSON.parse(atob(padded));
    if (typeof decoded?.exp === "number") {
      return decoded.exp * 1000;
    }
  } catch {
    return null;
  }
  return null;
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

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true); // Track if auth is initializing
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings>({ newsroomEnabled: true });
  const [keyBackupStatus, setKeyBackupStatus] =
    useState<AuthContextType["keyBackupStatus"]>("unknown");
  const [keyBackupLoading, setKeyBackupLoading] = useState(false);
  const [keyBackupError, setKeyBackupError] = useState<string | null>(null);

  useEffect(() => {
    const storedUser =
      localStorage.getItem("user") || sessionStorage.getItem("user");
    const storedToken =
      localStorage.getItem("token") || sessionStorage.getItem("token");
    const expiresAt =
      localStorage.getItem("expiresAt") || sessionStorage.getItem("expiresAt");

    if (storedUser && storedToken && expiresAt) {
      const now = Date.now();
      const storedExpiresAt = Number(expiresAt);
      const tokenExpiresAt = parseJwtExpiry(storedToken);
      const effectiveExpiresAt = resolveEffectiveExpiry(
        Number.isFinite(storedExpiresAt) ? storedExpiresAt : null,
        tokenExpiresAt,
        now
      );

      if (Number.isFinite(effectiveExpiresAt) && now < (effectiveExpiresAt as number)) {
        if (effectiveExpiresAt !== storedExpiresAt) {
          localStorage.setItem("expiresAt", effectiveExpiresAt.toString());
          sessionStorage.setItem("expiresAt", effectiveExpiresAt.toString());
        }
        setAuthToken(storedToken);
        setUser(JSON.parse(storedUser));
      } else {
        localStorage.removeItem("user");
        localStorage.removeItem("token");
        localStorage.removeItem("expiresAt");
        sessionStorage.removeItem("user");
        sessionStorage.removeItem("token");
        sessionStorage.removeItem("expiresAt");
        setAuthToken(null);
      }
    }

    setLoading(false); // Finished checking localStorage
  }, []);

  const refreshProfile = async () => {
    if (!user) {
      setProfile(null);
      return;
    }
    setProfileLoading(true);
    try {
      const res = await api.get("/profiles/me?populate=avatar");
      const data = res.data?.data;
      const attrs = data?.attributes ?? data ?? null;
      if (!attrs) {
        setProfile(null);
        return;
      }

      const basePayload = buildProfilePayloadFromAttrs(attrs);
      let payload: ProfilePayload | null = null;
      if (attrs.encryptedProfile) {
        try {
          payload = await decryptOwnProfilePayload(user.id, attrs.encryptedProfile);
        } catch (error) {
          console.warn("Unable to decrypt profile payload:", error);
        }
      }

      if (payload) {
        payload = { ...basePayload, ...payload };
      } else {
        payload = basePayload;
        if (Object.values(payload).some((value) => value)) {
          try {
            const encryptedProfile = await encryptProfilePayload(user.id, payload);
            await api.put("/profiles/me", {
              data: {
                encryptedProfile,
                profileKeyVersion: 1,
                firstName: payload.firstName || "",
                lastName: payload.lastName || "",
                age: payload.age || "",
                religion: payload.religion || "",
                hobbies: payload.hobbies || "",
                occupation: payload.occupation || "",
                bio: payload.bio || "",
                country: payload.country || "",
                countryCode: payload.countryCode || "",
                state: payload.state || "",
                stateCode: payload.stateCode || "",
                city: payload.city || "",
                ...PROFILE_PII_CLEAR_FIELDS,
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

      const publicFields = {
        age: payload?.age || "",
        religion: payload?.religion || "",
        hobbies: payload?.hobbies || "",
        occupation: payload?.occupation || "",
        bio: payload?.bio || "",
        country: payload?.country || "",
        countryCode: payload?.countryCode || "",
        state: payload?.state || "",
        stateCode: payload?.stateCode || "",
        city: payload?.city || "",
      };
      const needsPublicUpdate = Object.entries(publicFields).some(
        ([key, value]) => String(attrs?.[key] || "") !== String(value || "")
      );
      if (needsPublicUpdate) {
        try {
          await api.put("/profiles/me", { data: publicFields });
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

      const avatarUrl = pickMediaUrl(attrs.avatar, { kind: "avatar" });
      const handle = attrs.handle || undefined;
      const notificationReadState = attrs?.notificationReadState || undefined;
      setProfile({ ...payload, onboardingComplete, avatarUrl, handle, notificationReadState });
    } catch {
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  };

  const refreshAppSettings = async () => {
    if (!user) {
      setAppSettings({ newsroomEnabled: true });
      return;
    }
    try {
      const res = await api.get("/moderation/settings");
      const data = res.data?.data;
      setAppSettings({
        newsroomEnabled: data?.newsroomEnabled !== false,
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
      if (hasLocal) {
        await ensureUserKeyOnServer();
        setKeyBackupStatus(backupExists ? "ready" : "needs-setup");
      } else if (backupExists) {
        setKeyBackupStatus("needs-restore");
      } else {
        await ensureUserKeyOnServer();
        await getOrCreateProfileKey(user.id);
        setKeyBackupStatus("needs-setup");
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
      await ensureUserKeyOnServer();
      await refreshProfile();
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
      return;
    }
    setProfileLoading(true);
    void refreshProfile();
  }, [user?.id]);

  useEffect(() => {
    if (!user) {
      setAppSettings({ newsroomEnabled: true });
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
    void refreshKeyBackup();
  }, [user?.id]);

  // Auto-logout when the session window expires
  useEffect(() => {
    const expiresAt =
      localStorage.getItem("expiresAt") || sessionStorage.getItem("expiresAt");
    if (!user || !expiresAt) return;

    const timeLeft = parseInt(expiresAt) - new Date().getTime();
    if (timeLeft <= 0) {
      logout();
      return;
    }

    const timer = setTimeout(() => {
      logout();
    }, timeLeft);

    return () => clearTimeout(timer);
  }, [user]);

  const login = (userData: User, token: string, options?: { rememberDevice?: boolean }) => {
    setUser(userData);
    setProfileLoading(true);
    localStorage.setItem("user", JSON.stringify(userData));
    localStorage.setItem("token", token);
    sessionStorage.setItem("user", JSON.stringify(userData));
    sessionStorage.setItem("token", token);
    setAuthToken(token);
    // 30 days when remembered, otherwise 24 hours.
    const sessionDays = options?.rememberDevice ? 30 : 1;
    const now = Date.now();
    const requestedExpiresAt = now + sessionDays * 24 * 60 * 60 * 1000;
    const tokenExpiresAt = parseJwtExpiry(token);
    const effectiveExpiresAt = resolveEffectiveExpiry(
      requestedExpiresAt,
      tokenExpiresAt,
      now
    );
    if (tokenExpiresAt && tokenExpiresAt <= now + 60_000) {
      console.warn("Auth token expiry is in the past or too soon; using session expiry.", {
        tokenExpiresAt,
        now,
      });
    }
    localStorage.setItem("expiresAt", effectiveExpiresAt.toString());
    sessionStorage.setItem("expiresAt", effectiveExpiresAt.toString());
    console.info("Auth: login success", { id: userData.id, email: userData.email });
  };

  const updateUser = (userData: User) => {
    setUser(userData);
    localStorage.setItem("user", JSON.stringify(userData));
  };

  const logout = () => {
    setUser(null);
    setProfile(null);
    setProfileLoading(false);
    setKeyBackupStatus("unknown");
    setKeyBackupLoading(false);
    setKeyBackupError(null);
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    localStorage.removeItem("expiresAt");
    sessionStorage.removeItem("user");
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("expiresAt");
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
      appSettings: { newsroomEnabled: true },
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
      resetEncryptedProfile: async (_options) => false,
    };
  return <AuthContext.Provider value={emptyAuth}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
