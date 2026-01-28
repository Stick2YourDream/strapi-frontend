import { createContext, useContext, useState, useEffect } from "react";
import api from "../api/strapi";
import {
  buildProfilePayloadFromAttrs,
  decryptOwnProfilePayload,
  encryptProfilePayload,
  ensureUserKeyOnServer,
  PROFILE_PII_CLEAR_FIELDS,
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
  fetchKeyBackup,
  hasLocalKeyMaterial,
  restoreKeyBackup,
} from "../utils/key-backup";

interface User {
  id: number;
  email: string;
  appRole?: "user" | "moderator" | "admin";
}

const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");
const normalizeMediaEntry = (entry: any) => entry?.attributes ?? entry ?? {};
const pickMediaUrl = (mediaField: any): string | undefined => {
  if (!mediaField) return undefined;
  const candidate =
    (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ??
    (Array.isArray(mediaField) ? mediaField[0] : mediaField);
  if (!candidate) return undefined;
  const attrs = normalizeMediaEntry(candidate);
  let url =
    attrs.url ||
    attrs.formats?.large?.url ||
    attrs.formats?.medium?.url ||
    attrs.formats?.small?.url ||
    attrs.formats?.thumbnail?.url;
  if (!url) return undefined;
  return url.startsWith("/") ? `${apiBase}${url}` : url;
};

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
  backgrounds?: Record<string, { color?: string; image?: string }>;
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
  login: (user: User, token: string) => void;
  updateUser: (user: User) => void;
  logout: () => void;
  refreshProfile: () => Promise<void>;
  refreshAppSettings: () => Promise<void>;
  refreshKeyBackup: () => Promise<void>;
  createKeyBackup: (passphrase: string) => Promise<void>;
  restoreKeyBackup: (passphrase: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
    const storedUser = localStorage.getItem("user");
    const storedToken = localStorage.getItem("token");
    const expiresAt = localStorage.getItem("expiresAt");

    if (storedUser && storedToken && expiresAt) {
      if (new Date().getTime() < parseInt(expiresAt)) {
        setUser(JSON.parse(storedUser));
      } else {
        localStorage.removeItem("user");
        localStorage.removeItem("token");
        localStorage.removeItem("expiresAt");
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

      const avatarUrl = pickMediaUrl(attrs.avatar);
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
    if (!user) return;
    setKeyBackupLoading(true);
    setKeyBackupError(null);
    try {
      await createKeyBackup(user.id, passphrase);
      setKeyBackupStatus("ready");
    } catch (error) {
      console.warn("Unable to create key backup:", error);
      setKeyBackupError("Unable to create key backup.");
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
    const expiresAt = localStorage.getItem("expiresAt");
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

  const login = (userData: User, token: string) => {
    setUser(userData);
    setProfileLoading(true);
    localStorage.setItem("user", JSON.stringify(userData));
    localStorage.setItem("token", token);
    // 24-hour session window
    const expiresAt = new Date().getTime() + 24 * 60 * 60 * 1000;
    localStorage.setItem("expiresAt", expiresAt.toString());
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
    createKeyBackup: async () => undefined,
    restoreKeyBackup: async () => false,
  };
  return <AuthContext.Provider value={emptyAuth}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
