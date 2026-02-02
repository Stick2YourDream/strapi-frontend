import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useAuth } from "./AuthContext";
import api from "../api/strapi";
import {
  buildProfilePayloadFromAttrs,
  decryptOwnProfilePayload,
  encryptProfilePayload,
  PROFILE_PII_CLEAR_FIELDS,
} from "../utils/profile-e2ee";

export type PageKey = "dashboard" | "profile" | "friends" | "forums" | "news";

type BackgroundPrefs = {
  color?: string;
  colorOpacity?: number;
  image?: string;
  gradientStart?: string;
  gradientEnd?: string;
  gradientAngle?: number;
  gradientOpacity?: number;
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
    forums: {},
    news: {},
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

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

const hexToRgba = (value: string, alpha: number) => {
  const hex = (value || "").replace("#", "");
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return value;
};

const applyOpacityToColor = (value: string, alpha: number) => {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith("rgb") || lowered.startsWith("hsl")) {
    return trimmed;
  }
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    return hexToRgba(trimmed, alpha);
  }
  return trimmed;
};

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
  (Object.keys(current) as PageKey[]).forEach((page) => {
    const entry = incoming?.[page];
    if (entry && typeof entry === "object") {
      const color = typeof entry.color === "string" ? entry.color : undefined;
      const image = typeof entry.image === "string" ? normalizeImage(entry.image) : undefined;
      const colorOpacity =
        typeof entry.colorOpacity === "number" && Number.isFinite(entry.colorOpacity)
          ? clamp(entry.colorOpacity)
          : undefined;
      const gradientStart =
        typeof entry.gradientStart === "string" ? entry.gradientStart : undefined;
      const gradientEnd =
        typeof entry.gradientEnd === "string" ? entry.gradientEnd : undefined;
      const gradientAngle =
        typeof entry.gradientAngle === "number" && Number.isFinite(entry.gradientAngle)
          ? entry.gradientAngle
          : undefined;
      const gradientOpacity =
        typeof entry.gradientOpacity === "number" && Number.isFinite(entry.gradientOpacity)
          ? clamp(entry.gradientOpacity)
          : undefined;
      next[page] = {
        ...current[page],
        ...(color !== undefined ? { color } : {}),
        ...(colorOpacity !== undefined ? { colorOpacity } : {}),
        ...(image !== undefined ? { image } : {}),
        ...(gradientStart !== undefined ? { gradientStart } : {}),
        ...(gradientEnd !== undefined ? { gradientEnd } : {}),
        ...(gradientAngle !== undefined ? { gradientAngle } : {}),
        ...(gradientOpacity !== undefined ? { gradientOpacity } : {}),
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
        if (attrs?.encryptedProfile) {
          try {
            const payload = await decryptOwnProfilePayload(user.id, attrs.encryptedProfile);
            if (payload?.backgrounds && typeof payload.backgrounds === "object") {
              setPreferences((prev) => ({
                ...prev,
                backgrounds: mergeBackgrounds(prev.backgrounds, payload.backgrounds),
              }));
            }
          } catch {
            // ignore decrypt failures
          }
        } else if (attrs?.backgrounds && typeof attrs.backgrounds === "object") {
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
        const res = await api.get("/profiles/me");
        const data = res.data?.data;
        const attrs = data?.attributes ?? data ?? {};
        const existingPayload = attrs?.encryptedProfile
          ? await decryptOwnProfilePayload(user.id, attrs.encryptedProfile)
          : buildProfilePayloadFromAttrs(attrs);
        const nextPayload = {
          ...existingPayload,
          backgrounds: payload,
        };
        const encryptedProfile = await encryptProfilePayload(user.id, nextPayload);
        await api.put("/profiles/me", {
          data: {
            encryptedProfile,
            profileKeyVersion: 1,
            ...PROFILE_PII_CLEAR_FIELDS,
          },
        });
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
      const hasGradient = Boolean(bg?.gradientStart || bg?.gradientEnd);
      if (!color && !image && !hasGradient) return undefined;

      const colorOpacity = clamp(
        typeof bg?.colorOpacity === "number" ? bg.colorOpacity : 1
      );
      const gradientOpacity = clamp(
        typeof bg?.gradientOpacity === "number" ? bg.gradientOpacity : 0.75
      );
      const gradientStart = (bg?.gradientStart || "#2563eb").trim();
      const gradientEnd = (bg?.gradientEnd || "#22d3ee").trim();
      const gradientAngle =
        typeof bg?.gradientAngle === "number" && Number.isFinite(bg.gradientAngle)
          ? bg.gradientAngle
          : 135;

      const overlay = hasGradient
        ? `linear-gradient(${gradientAngle}deg, ${applyOpacityToColor(
            gradientStart || "#2563eb",
            gradientOpacity
          )}, ${applyOpacityToColor(gradientEnd || "#22d3ee", gradientOpacity)})`
        : image
        ? "linear-gradient(120deg, rgba(7, 9, 17, 0.65), rgba(7, 9, 17, 0.92))"
        : "";

      const imageLayer = image ? `url(\"${image}\")` : "";
      const backgroundImage = image
        ? overlay
          ? `${overlay}, ${imageLayer}`
          : imageLayer
        : overlay || "none";

      const style: CSSProperties = {
        backgroundColor: color
          ? applyOpacityToColor(color, colorOpacity)
          : "#0b0d14",
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
