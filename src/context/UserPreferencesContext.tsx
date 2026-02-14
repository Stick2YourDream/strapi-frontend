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

export type PageKey =
  | "dashboard"
  | "profile"
  | "friends"
  | "forums"
  | "groups"
  | "news"
  | "storefront";

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
    groups: {},
    news: {},
    storefront: {},
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

type Rgb = { r: number; g: number; b: number };

const FALLBACK_BG_RGB: Rgb = { r: 11, g: 13, b: 20 }; // #0b0d14

const parseHexToRgb = (value: string): Rgb | null => {
  const hex = (value || "").trim().replace("#", "");
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(hex)) return null;
  const full =
    hex.length === 3
      ? `${hex[0]}${hex[0]}${hex[1]}${hex[1]}${hex[2]}${hex[2]}`
      : hex;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return { r, g, b };
};

const parseRgbFuncToRgb = (value: string): Rgb | null => {
  const trimmed = (value || "").trim();
  // rgb(255, 255, 255) / rgba(255, 255, 255, 0.5)
  const match = trimmed.match(
    /^rgba?\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})(?:\s*,\s*([0-9.]+)\s*)?\)$/i
  );
  if (!match) return null;
  const r = Number(match[1]);
  const g = Number(match[2]);
  const b = Number(match[3]);
  if (![r, g, b].every((n) => Number.isFinite(n))) return null;
  return {
    r: Math.min(255, Math.max(0, Math.round(r))),
    g: Math.min(255, Math.max(0, Math.round(g))),
    b: Math.min(255, Math.max(0, Math.round(b))),
  };
};

const parseColorToRgb = (value?: string): Rgb | null => {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(trimmed)) {
    return parseHexToRgb(trimmed);
  }
  if (trimmed.toLowerCase().startsWith("rgb")) {
    return parseRgbFuncToRgb(trimmed);
  }
  return null;
};

const blendRgb = (fg: Rgb, bg: Rgb, alpha: number): Rgb => {
  const a = clamp(alpha, 0, 1);
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
  };
};

const averageRgb = (a: Rgb, b: Rgb): Rgb => ({
  r: Math.round((a.r + b.r) / 2),
  g: Math.round((a.g + b.g) / 2),
  b: Math.round((a.b + b.b) / 2),
});

const relativeLuminance = (rgb: Rgb) => {
  const toLinear = (c: number) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  const r = toLinear(rgb.r);
  const g = toLinear(rgb.g);
  const b = toLinear(rgb.b);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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

      // Auto-contrast text + UI tokens based on the user's selected background.
      // Images without a gradient overlay always use a dark overlay, so keep the dark UI.
      let isLightTheme = false;
      if (image && !hasGradient) {
        isLightTheme = false;
      } else {
        const baseRgb = (() => {
          const parsed = parseColorToRgb(color);
          if (!parsed) return FALLBACK_BG_RGB;
          return blendRgb(parsed, FALLBACK_BG_RGB, colorOpacity);
        })();

        const finalRgb = (() => {
          if (!hasGradient) return baseRgb;
          const startRgb =
            parseColorToRgb(gradientStart) ?? parseHexToRgb("#2563eb") ?? baseRgb;
          const endRgb =
            parseColorToRgb(gradientEnd) ?? parseHexToRgb("#22d3ee") ?? baseRgb;
          const avg = averageRgb(startRgb, endRgb);
          return blendRgb(avg, baseRgb, gradientOpacity);
        })();

        isLightTheme = relativeLuminance(finalRgb) >= 0.62;
      }

      style.colorScheme = isLightTheme ? "light" : "dark";

      const themeVars: Record<string, string> = {
        "--ysp-fg": isLightTheme ? "#0b0d14" : "#e9ecf5",
        "--ysp-muted": isLightTheme ? "rgba(15, 23, 42, 0.72)" : "#c7cede",
        "--ysp-muted-2": isLightTheme ? "rgba(15, 23, 42, 0.55)" : "#9aa5bb",
        "--ysp-icon": isLightTheme ? "rgba(15, 23, 42, 0.72)" : "rgba(148, 163, 184, 0.95)",
        "--ysp-border": isLightTheme ? "rgba(2, 6, 23, 0.14)" : "rgba(255, 255, 255, 0.14)",
        "--ysp-border-strong": isLightTheme
          ? "rgba(2, 6, 23, 0.24)"
          : "rgba(255, 255, 255, 0.26)",
        "--ysp-hover-bg": isLightTheme ? "rgba(2, 6, 23, 0.06)" : "rgba(255, 255, 255, 0.06)",
        "--ysp-panel-bg": isLightTheme ? "rgba(2, 6, 23, 0.04)" : "rgba(255, 255, 255, 0.05)",
        "--ysp-panel-border": isLightTheme
          ? "rgba(2, 6, 23, 0.12)"
          : "rgba(255, 255, 255, 0.08)",
        "--ysp-panel-shadow": isLightTheme
          ? "0 16px 32px rgba(2, 6, 23, 0.12)"
          : "0 16px 32px rgba(0, 0, 0, 0.35)",
        "--ysp-input-bg": isLightTheme
          ? "rgba(255, 255, 255, 0.72)"
          : "rgba(255, 255, 255, 0.04)",
        "--ysp-input-border": isLightTheme
          ? "rgba(2, 6, 23, 0.12)"
          : "rgba(255, 255, 255, 0.12)",
        "--ysp-input-fg": isLightTheme ? "#0b0d14" : "#e9ecf5",
        "--ysp-input-placeholder": isLightTheme ? "rgba(15, 23, 42, 0.45)" : "#9aa5bb",
        "--ysp-ghost-bg": isLightTheme ? "rgba(2, 6, 23, 0.06)" : "rgba(255, 255, 255, 0.08)",
        "--ysp-ghost-border": isLightTheme
          ? "rgba(2, 6, 23, 0.12)"
          : "rgba(255, 255, 255, 0.12)",
        "--dashboard-composer-bg": isLightTheme
          ? "linear-gradient(140deg, rgba(255, 255, 255, 0.78), rgba(241, 245, 249, 0.94))"
          : "linear-gradient(140deg, rgba(18, 26, 42, 0.8), rgba(8, 12, 22, 0.9))",
        "--dashboard-composer-border": isLightTheme
          ? "1px solid rgba(2, 6, 23, 0.12)"
          : "1px solid rgba(255, 255, 255, 0.1)",
        "--ysp-surface-1-bg": isLightTheme
          ? "rgba(255, 255, 255, 0.65)"
          : "rgba(8, 12, 20, 0.5)",
        "--ysp-surface-1-border": isLightTheme
          ? "rgba(2, 6, 23, 0.12)"
          : "rgba(255, 255, 255, 0.08)",
        "--ysp-popover-bg": isLightTheme
          ? "linear-gradient(155deg, rgba(255, 255, 255, 0.9), rgba(241, 245, 249, 0.96))"
          : "linear-gradient(155deg, rgba(20, 27, 52, 0.98), rgba(8, 10, 20, 0.98))",
        "--ysp-popover-border": isLightTheme
          ? "rgba(2, 6, 23, 0.12)"
          : "rgba(148, 163, 184, 0.22)",
      };

      Object.assign(style as Record<string, unknown>, themeVars);

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
