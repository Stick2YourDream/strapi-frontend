import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext";

export type FriendGroup = {
  id: string;
  name: string;
  memberIds: number[];
  createdAt: string;
};

const STORAGE_PREFIX = "video-call-groups";

const safeParse = (value: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeGroup = (entry: any): FriendGroup | null => {
  if (!entry || typeof entry !== "object") return null;
  const id = String(entry.id || "").trim();
  const name = String(entry.name || "").trim() || "New group";
  const createdAt = String(entry.createdAt || new Date().toISOString());
  const memberIds = Array.isArray(entry.memberIds)
    ? entry.memberIds
        .map((item: unknown) => Number(item))
        .filter((id: number) => Number.isFinite(id))
    : [];
  if (!id) return null;
  return { id, name, memberIds: Array.from(new Set(memberIds)), createdAt };
};

const buildId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

export const useFriendGroups = () => {
  const { user } = useAuth();
  const userId = user?.id;
  const storageKey = useMemo(
    () => `${STORAGE_PREFIX}:${userId ?? "anon"}`,
    [userId]
  );
  const [groups, setGroups] = useState<FriendGroup[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!userId) {
      setGroups([]);
      return;
    }
    const raw = safeParse(localStorage.getItem(storageKey));
    if (!raw || !Array.isArray(raw)) {
      setGroups([]);
      return;
    }
    const normalized = raw.map(normalizeGroup).filter(Boolean) as FriendGroup[];
    normalized.sort((a, b) => a.name.localeCompare(b.name));
    setGroups(normalized);
  }, [storageKey, userId]);

  const persist = useCallback(
    (next: FriendGroup[]) => {
      setGroups(next);
      if (typeof window === "undefined" || !userId) return;
      localStorage.setItem(storageKey, JSON.stringify(next));
    },
    [storageKey, userId]
  );

  const createGroup = useCallback(
    (name = "New group") => {
      const next: FriendGroup = {
        id: buildId(),
        name: name.trim() || "New group",
        memberIds: [],
        createdAt: new Date().toISOString(),
      };
      const updated = [...groups, next].sort((a, b) => a.name.localeCompare(b.name));
      persist(updated);
      return next;
    },
    [groups, persist]
  );

  const updateGroup = useCallback(
    (id: string, updater: (group: FriendGroup) => FriendGroup) => {
      const updated = groups
        .map((group) => (group.id === id ? updater(group) : group))
        .filter(Boolean) as FriendGroup[];
      updated.sort((a, b) => a.name.localeCompare(b.name));
      persist(updated);
    },
    [groups, persist]
  );

  const renameGroup = useCallback(
    (id: string, name: string) => {
      updateGroup(id, (group) => ({ ...group, name: name.trim() || "New group" }));
    },
    [updateGroup]
  );

  const toggleMember = useCallback(
    (id: string, memberId: number) => {
      updateGroup(id, (group) => {
        const has = group.memberIds.includes(memberId);
        const nextMembers = has
          ? group.memberIds.filter((entry) => entry !== memberId)
          : [...group.memberIds, memberId];
        return { ...group, memberIds: Array.from(new Set(nextMembers)) };
      });
    },
    [updateGroup]
  );

  const setMembers = useCallback(
    (id: string, memberIds: number[]) => {
      const next = Array.from(
        new Set(memberIds.map((entry) => Number(entry)).filter((id) => Number.isFinite(id)))
      );
      updateGroup(id, (group) => ({ ...group, memberIds: next }));
    },
    [updateGroup]
  );

  const removeGroup = useCallback(
    (id: string) => {
      const next = groups.filter((group) => group.id !== id);
      persist(next);
    },
    [groups, persist]
  );

  return {
    groups,
    createGroup,
    renameGroup,
    toggleMember,
    setMembers,
    removeGroup,
  };
};
