import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useAuth } from "./AuthContext";
import api from "../api/strapi";

export type PageKey = "dashboard" | "profile" | "friends";

type BackgroundPrefs = {
  color?: string;
  image?: string;
};

type ChatPrefs = {
  width: number;
  height: number;
  minimizedWidth: number;
  minimizedHeight: number;
  fontSize: number;
};

type UserPreferences = {
  backgrounds: Record<PageKey, BackgroundPrefs>;
  chat: ChatPrefs;
};

type UserPreferencesContextValue = {
  preferences: UserPreferences;
  setBackground: (page: PageKey, updates: Partial<BackgroundPrefs>) => void;
  setBackgroundAll: (updates: Partial<BackgroundPrefs>) => void;
  resetBackground: (page: PageKey) => void;
  resetBackgroundAll: () => void;
  setChatPrefs: (updates: Partial<ChatPrefs>) => void;
  getBackgroundStyle: (page: PageKey) => CSSProperties | undefined;
};

const DEFAULT_PREFERENCES: UserPreferences = {
  backgrounds: {
    dashboard: {},
    profile: {},
    friends: {},
  },
  chat: {
    width: 360,
    height: 520,
    minimizedWidth: 260,
    minimizedHeight: 72,
    fontSize: 14,
  },
};

const STORAGE_KEY = "user_preferences_v1";
const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");

const normalizeImage = (value?: string) => {
  if (value === undefined) return undefined;
  if (value === "") return "";
  if (value.startsWith("data:") || value.startsWith("http")) return value;
  if (value.startsWith("/")) return `${apiBase}${value}`;
  return value;
};

const stripApiBase = (value?: string) => {
  if (!value || !apiBase) return value;
  return value.startsWith(apiBase) ? value.slice(apiBase.length) || "/" : value;
};

const safeParseJson = (value: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const mergeBackgrounds = (
  current: Record<PageKey, BackgroundPrefs>,
  incoming: any
): Record<PageKey, BackgroundPrefs> => {
  const next: Record<PageKey, BackgroundPrefs> = { ...current };
  (["dashboard", "profile", "friends"] as PageKey[]).forEach((page) => {
    const entry = incoming?.[page];
    if (entry && typeof entry === "object") {
      const color = typeof entry.color === "string" ? entry.color : undefined;
      const image = typeof entry.image === "string" ? normalizeImage(entry.image) : undefined;
      next[page] = {
        ...current[page],
        ...(color !== undefined ? { color } : {}),
        ...(image !== undefined ? { image } : {}),
      };
    }
  });
  return next;
};

const UserPreferencesContext = createContext<UserPreferencesContextValue | undefined>(undefined);

export const UserPreferencesProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);
  const readyRef = useRef(false);
  const saveTimeoutRef = useRef<number | null>(null);

  const storageKey = user?.id ? `${STORAGE_KEY}_${user.id}` : STORAGE_KEY;

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    readyRef.current = false;
    const raw = safeParseJson(localStorage.getItem(storageKey));
    if (raw && typeof raw === "object") {
      const next = {
        ...DEFAULT_PREFERENCES,
        ...(raw as Partial<UserPreferences>),
        backgrounds: mergeBackgrounds(
          DEFAULT_PREFERENCES.backgrounds,
          (raw as Partial<UserPreferences>).backgrounds || {}
        ),
        chat: {
          ...DEFAULT_PREFERENCES.chat,
          ...((raw as Partial<UserPreferences>).chat || {}),
        },
      };
      setPreferences(next);
    } else {
      setPreferences(DEFAULT_PREFERENCES);
    }

    const loadRemote = async () => {
      if (!user?.id) {
        if (active) readyRef.current = true;
        return;
      }
      try {
        const res = await api.get("/profiles/me");
        const data = res.data?.data;
        const attrs = data?.attributes ?? data ?? {};
        if (attrs?.backgrounds && typeof attrs.backgrounds === "object") {
          setPreferences((prev) => ({
            ...prev,
            backgrounds: mergeBackgrounds(prev.backgrounds, attrs.backgrounds),
          }));
        }
      } catch {
        // ignore load errors
      } finally {
        if (active) readyRef.current = true;
      }
    };
    void loadRemote();

    return () => {
      active = false;
    };
  }, [storageKey, user?.id]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(storageKey, JSON.stringify(preferences));
  }, [preferences, storageKey]);

  const saveBackgrounds = useCallback(
    async (backgrounds: Record<PageKey, BackgroundPrefs>) => {
      if (!user?.id) return;
      const payload: Record<PageKey, BackgroundPrefs> = { ...backgrounds };
      (Object.keys(payload) as PageKey[]).forEach((page) => {
        const image = payload[page]?.image;
        if (typeof image === "string") {
          payload[page] = {
            ...payload[page],
            image: stripApiBase(image),
          };
        }
      });
      try {
        await api.put("/profiles/me", { data: { backgrounds: payload } });
      } catch {
        // ignore save errors
      }
    },
    [user?.id]
  );

  useEffect(() => {
    if (!user?.id || !readyRef.current) return;
    if (saveTimeoutRef.current) {
      window.clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = window.setTimeout(() => {
      void saveBackgrounds(preferences.backgrounds);
    }, 600);
    return () => {
      if (saveTimeoutRef.current) {
        window.clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [preferences.backgrounds, saveBackgrounds, user?.id]);

  const setBackground = useCallback((page: PageKey, updates: Partial<BackgroundPrefs>) => {
    const image =
      updates.image !== undefined ? normalizeImage(updates.image) : undefined;
    const nextUpdates = image !== undefined ? { ...updates, image } : updates;
    setPreferences((prev) => ({
      ...prev,
      backgrounds: {
        ...prev.backgrounds,
        [page]: {
          ...prev.backgrounds[page],
          ...nextUpdates,
        },
      },
    }));
  }, []);

  const setBackgroundAll = useCallback((updates: Partial<BackgroundPrefs>) => {
    const image =
      updates.image !== undefined ? normalizeImage(updates.image) : undefined;
    const nextUpdates = image !== undefined ? { ...updates, image } : updates;
    setPreferences((prev) => {
      const nextBackgrounds = { ...prev.backgrounds };
      (Object.keys(nextBackgrounds) as PageKey[]).forEach((page) => {
        nextBackgrounds[page] = {
          ...nextBackgrounds[page],
          ...nextUpdates,
        };
      });
      return {
        ...prev,
        backgrounds: nextBackgrounds,
      };
    });
  }, []);

  const resetBackground = useCallback((page: PageKey) => {
    setPreferences((prev) => ({
      ...prev,
      backgrounds: {
        ...prev.backgrounds,
        [page]: {},
      },
    }));
  }, []);

  const resetBackgroundAll = useCallback(() => {
    setPreferences((prev) => ({
      ...prev,
      backgrounds: { ...DEFAULT_PREFERENCES.backgrounds },
    }));
  }, []);

  const setChatPrefs = useCallback((updates: Partial<ChatPrefs>) => {
    setPreferences((prev) => ({
      ...prev,
      chat: {
        ...prev.chat,
        ...updates,
      },
    }));
  }, []);

  const getBackgroundStyle = useCallback(
    (page: PageKey) => {
      const bg = preferences.backgrounds[page];
      const color = (bg?.color || "").trim();
      const image = (normalizeImage(bg?.image || "") || "").trim();
      if (!color && !image) return undefined;

      const overlay =
        "linear-gradient(120deg, rgba(7, 9, 17, 0.65), rgba(7, 9, 17, 0.92))";
      const imageLayer = image ? `url(\"${image}\")` : "none";
      const backgroundImage = image ? `${overlay}, ${imageLayer}` : "none";

      const style: CSSProperties = {
        backgroundColor: color || "#0b0d14",
        backgroundImage,
        backgroundSize: image ? "cover" : undefined,
        backgroundPosition: image ? "center" : undefined,
        backgroundRepeat: image ? "no-repeat" : undefined,
        backgroundAttachment: image ? "fixed" : undefined,
      };
      return style;
    },
    [preferences.backgrounds]
  );

  const value = useMemo(
    () => ({
      preferences,
      setBackground,
      setBackgroundAll,
      resetBackground,
      resetBackgroundAll,
      setChatPrefs,
      getBackgroundStyle,
    }),
    [
      getBackgroundStyle,
      preferences,
      resetBackground,
      resetBackgroundAll,
      setBackground,
      setBackgroundAll,
      setChatPrefs,
    ]
  );

  return <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>;
};

export const useUserPreferences = () => {
  const context = useContext(UserPreferencesContext);
  if (!context) throw new Error("useUserPreferences must be used within UserPreferencesProvider");
  return context;
};
