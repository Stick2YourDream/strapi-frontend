import { useCallback, useEffect, useMemo, useState } from "react";

type ImpactStats = {
  encouragements: number;
  supportReplies: number;
  checkIns: number;
  supportRequests: number;
};

const defaultStats: ImpactStats = {
  encouragements: 0,
  supportReplies: 0,
  checkIns: 0,
  supportRequests: 0,
};

const storageKeyFor = (userId?: number | null) =>
  userId ? `ysp-impact-${userId}` : "ysp-impact-guest";

const parseStats = (raw: string | null): ImpactStats => {
  if (!raw) return { ...defaultStats };
  try {
    const parsed = JSON.parse(raw) as Partial<ImpactStats> | null;
    return {
      encouragements: Number(parsed?.encouragements) || 0,
      supportReplies: Number(parsed?.supportReplies) || 0,
      checkIns: Number(parsed?.checkIns) || 0,
      supportRequests: Number(parsed?.supportRequests) || 0,
    };
  } catch {
    return { ...defaultStats };
  }
};

export const useImpactStats = (userId?: number | null) => {
  const storageKey = useMemo(() => storageKeyFor(userId), [userId]);
  const [stats, setStats] = useState<ImpactStats>(defaultStats);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setStats(parseStats(window.localStorage.getItem(storageKey)));
  }, [storageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey, JSON.stringify(stats));
  }, [stats, storageKey]);

  const bumpStat = useCallback((key: keyof ImpactStats, amount = 1) => {
    setStats((prev) => ({
      ...prev,
      [key]: Math.max(0, (prev[key] ?? 0) + amount),
    }));
  }, []);

  return { stats, bumpStat, setStats };
};

export type { ImpactStats };
