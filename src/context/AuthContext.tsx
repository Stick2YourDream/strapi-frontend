import { createContext, useContext, useState, useEffect } from "react";
import api from "../api/strapi";
import {
  buildProfilePayloadFromAttrs,
  decryptOwnProfilePayload,
  encryptProfilePayload,
  ensureUserKeyOnServer,
  PROFILE_PII_CLEAR_FIELDS,
  type ProfilePayload,
} from "../utils/profile-e2ee";

interface User {
  id: number;
  username: string;
  email: string;
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
  backgrounds?: Record<string, { color?: string; image?: string }>;
}

interface AuthContextType {
  user: User | null;
  profile: ProfileSummary | null;
  profileLoading: boolean;
  login: (user: User, token: string) => void;
  logout: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true); // Track if auth is initializing
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

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
      const res = await api.get("/profiles/me");
      const data = res.data?.data;
      const attrs = data?.attributes ?? data ?? null;
      if (!attrs) {
        setProfile(null);
        return;
      }

      let payload: ProfilePayload | null = null;
      if (attrs.encryptedProfile) {
        try {
          payload = await decryptOwnProfilePayload(user.id, attrs.encryptedProfile);
        } catch (error) {
          console.warn("Unable to decrypt profile payload:", error);
        }
      }

      if (!payload) {
        payload = buildProfilePayloadFromAttrs(attrs);
        if (Object.values(payload).some((value) => value)) {
          try {
            const encryptedProfile = await encryptProfilePayload(user.id, payload);
            await api.put("/profiles/me", {
              data: {
                encryptedProfile,
                profileKeyVersion: 1,
                ...PROFILE_PII_CLEAR_FIELDS,
              },
            });
          } catch (error) {
            console.warn("Unable to migrate profile encryption:", error);
          }
        }
      }

      const onboardingComplete =
        typeof payload?.onboardingComplete === "boolean"
          ? payload.onboardingComplete
          : typeof attrs.onboardingComplete === "boolean"
          ? attrs.onboardingComplete
          : true;

      setProfile({ ...payload, onboardingComplete });
    } catch {
      setProfile(null);
    } finally {
      setProfileLoading(false);
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
    if (!user) return;
    void ensureUserKeyOnServer();
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
    console.info("Auth: login success", { id: userData.id, username: userData.username });
  };

  const logout = () => {
    setUser(null);
    setProfile(null);
    setProfileLoading(false);
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    localStorage.removeItem("expiresAt");
    console.info("Auth: logout success");
  };

  return (
    <AuthContext.Provider
      value={{ user, profile, profileLoading, login, logout, refreshProfile }}
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
    login: () => undefined,
    logout: () => undefined,
    refreshProfile: async () => undefined,
  };
  return <AuthContext.Provider value={emptyAuth}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
