import { useEffect, useRef, useState } from "react";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import {
  DEFAULT_TIME_LIMIT_MINUTES,
  normalizeTimeLimitSettings,
} from "../utils/time-limits";
import "../css/time-limits.css";

type TimeLimitNotice = {
  message: string;
  tone?: "warning" | "critical";
};

type TimeLimitState = {
  startedAt: number;
  durationMinutes: number;
  warned10?: boolean;
  warned1?: boolean;
};

const COOLDOWN_MINUTES = 10;
const STORAGE_PREFIX = "ysp-time-limit";

const getStorageKey = (userId: number) => `${STORAGE_PREFIX}:${userId}`;

const loadState = (userId: number): TimeLimitState | null => {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(getStorageKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const startedAt = Number(parsed.startedAt || 0);
    const durationMinutes = Number(parsed.durationMinutes || 0);
    if (!Number.isFinite(startedAt) || !Number.isFinite(durationMinutes)) return null;
    return {
      startedAt,
      durationMinutes,
      warned10: Boolean(parsed.warned10),
      warned1: Boolean(parsed.warned1),
    };
  } catch {
    return null;
  }
};

const saveState = (userId: number, state: TimeLimitState) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getStorageKey(userId), JSON.stringify(state));
};

const clearState = (userId: number) => {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getStorageKey(userId));
};

const minutesToMs = (minutes: number) => minutes * 60 * 1000;

export default function TimeLimitManager() {
  const { user, profile, logout } = useAuth();
  const [notice, setNotice] = useState<TimeLimitNotice | null>(null);
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastUserIdRef = useRef<number | null>(null);

  const clearSessionTimers = () => {
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current = [];
  };

  const clearNoticeTimer = () => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
  };

  const showNotice = (message: string, tone: TimeLimitNotice["tone"] = "warning") => {
    setNotice({ message, tone });
    clearNoticeTimer();
    noticeTimerRef.current = setTimeout(() => {
      setNotice(null);
      noticeTimerRef.current = null;
    }, 6000);
  };

  const triggerTimeout = async (durationMinutes: number) => {
    if (!user) return;
    const cooldownUntil = new Date(Date.now() + minutesToMs(COOLDOWN_MINUTES)).toISOString();
    const nextSettings = {
      enabled: true,
      durationMinutes,
      cooldownUntil,
    };
    try {
      await api.put("/profiles/me", {
        data: {
          timeLimitSettings: nextSettings,
        },
      });
    } catch (error) {
      console.warn("Unable to sync time limit cooldown:", error);
    } finally {
      clearState(user.id);
      logout("time-limit");
    }
  };

  useEffect(() => {
    if (!user) return;
    if (lastUserIdRef.current && lastUserIdRef.current !== user.id) {
      clearState(lastUserIdRef.current);
    }
    lastUserIdRef.current = user.id;
  }, [user?.id]);

  useEffect(() => {
    clearSessionTimers();
    if (!user || !profile) {
      setNotice(null);
      clearNoticeTimer();
      return;
    }
    const settings = normalizeTimeLimitSettings(profile.timeLimitSettings);
    if (!settings.enabled) {
      clearState(user.id);
      setNotice(null);
      clearNoticeTimer();
      return;
    }
    const durationMinutes = settings.durationMinutes || DEFAULT_TIME_LIMIT_MINUTES;
    const now = Date.now();
    let state = loadState(user.id);

    if (!state || state.durationMinutes !== durationMinutes) {
      state = {
        startedAt: now,
        durationMinutes,
        warned10: false,
        warned1: false,
      };
      saveState(user.id, state);
    }

    const endAt = state.startedAt + minutesToMs(durationMinutes);
    const timeLeft = endAt - now;
    if (timeLeft <= 0) {
      void triggerTimeout(durationMinutes);
      return;
    }

    const warn10At = endAt - minutesToMs(10);
    const warn1At = endAt - minutesToMs(1);

    if (!state.warned10 && timeLeft <= minutesToMs(10) && timeLeft > minutesToMs(1)) {
      showNotice("10 minutes left in this session. Wrap up what you need.");
      state.warned10 = true;
      saveState(user.id, state);
    } else if (!state.warned10 && warn10At > now) {
      timersRef.current.push(
        setTimeout(() => {
          showNotice("10 minutes left in this session. Wrap up what you need.");
          const latest = loadState(user.id) || state;
          saveState(user.id, { ...latest, warned10: true });
        }, warn10At - now)
      );
    }

    if (!state.warned1 && timeLeft <= minutesToMs(1) && timeLeft > 0) {
      showNotice("1 minute left. We’ll log you out soon.", "critical");
      state.warned1 = true;
      saveState(user.id, state);
    } else if (!state.warned1 && warn1At > now) {
      timersRef.current.push(
        setTimeout(() => {
          showNotice("1 minute left. We’ll log you out soon.", "critical");
          const latest = loadState(user.id) || state;
          saveState(user.id, { ...latest, warned1: true });
        }, warn1At - now)
      );
    }

    timersRef.current.push(
      setTimeout(() => {
        void triggerTimeout(durationMinutes);
      }, timeLeft)
    );

    return () => clearSessionTimers();
  }, [
    user?.id,
    profile?.timeLimitSettings?.enabled,
    profile?.timeLimitSettings?.durationMinutes,
    logout,
  ]);

  useEffect(
    () => () => {
      clearSessionTimers();
      clearNoticeTimer();
    },
    []
  );

  if (!notice) return null;

  return (
    <div className={`time-limit-toast${notice.tone ? ` is-${notice.tone}` : ""}`}>
      <strong>Time limit</strong>
      <span>{notice.message}</span>
    </div>
  );
}
