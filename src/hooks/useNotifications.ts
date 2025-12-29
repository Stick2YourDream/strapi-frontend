import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api/strapi";

type NotificationCounts = {
  messages: number;
  requests: number;
  friendPosts: number;
  comments: number;
  likes: number;
  groupUpdates: number;
};

const NOTIF_LAST_SEEN_KEY = "notifications_last_seen_v1";
const NOTIF_LIKE_SNAPSHOT_KEY = "notifications_like_snapshot_v1";
const REFRESH_MS = 60000;

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
const getEntity = (entry: any) => entry?.data ?? entry ?? null;
const getEntityId = (entry: any) => {
  const data = getEntity(entry);
  const rawId = data?.id ?? (typeof data === "number" ? data : data?.attributes?.id);
  const num = Number(rawId);
  return Number.isFinite(num) ? num : undefined;
};

const safeParseJson = (value: string | null) => {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const getLastSeen = (userId: number) => {
  if (typeof window === "undefined") return null;
  const raw = safeParseJson(localStorage.getItem(NOTIF_LAST_SEEN_KEY));
  if (!raw || typeof raw !== "object") return null;
  const entry = (raw as Record<string, string>)[String(userId)];
  return entry ? String(entry) : null;
};

const setLastSeen = (userId: number, iso: string) => {
  if (typeof window === "undefined") return;
  const raw = safeParseJson(localStorage.getItem(NOTIF_LAST_SEEN_KEY));
  const base = raw && typeof raw === "object" ? raw : {};
  const next = { ...(base as Record<string, string>), [String(userId)]: iso };
  localStorage.setItem(NOTIF_LAST_SEEN_KEY, JSON.stringify(next));
};

const getLikeSnapshot = (userId: number) => {
  if (typeof window === "undefined") return null;
  const raw = safeParseJson(localStorage.getItem(NOTIF_LIKE_SNAPSHOT_KEY));
  if (!raw || typeof raw !== "object") return null;
  const entry = (raw as Record<string, Record<string, number>>)[String(userId)];
  return entry && typeof entry === "object" ? entry : null;
};

const setLikeSnapshot = (userId: number, snapshot: Record<string, number>) => {
  if (typeof window === "undefined") return;
  const raw = safeParseJson(localStorage.getItem(NOTIF_LIKE_SNAPSHOT_KEY));
  const base = raw && typeof raw === "object" ? raw : {};
  const next = { ...(base as Record<string, Record<string, number>>), [String(userId)]: snapshot };
  localStorage.setItem(NOTIF_LIKE_SNAPSHOT_KEY, JSON.stringify(next));
};

export const useNotifications = (userId?: number | null) => {
  const [counts, setCounts] = useState<NotificationCounts>({
    messages: 0,
    requests: 0,
    friendPosts: 0,
    comments: 0,
    likes: 0,
    groupUpdates: 0,
  });
  const [loading, setLoading] = useState(false);
  const lastSeenRef = useRef<string | null>(null);
  const likeSnapshotRef = useRef<Record<string, number> | null>(null);
  const latestLikeSnapshotRef = useRef<Record<string, number>>({});

  const refresh = useCallback(async () => {
    if (!userId || !Number.isFinite(Number(userId))) {
      setCounts({
        messages: 0,
        requests: 0,
        friendPosts: 0,
        comments: 0,
        likes: 0,
        groupUpdates: 0,
      });
      return;
    }

    const currentUserId = Number(userId);
    setLoading(true);

    try {
      const lastSeenIso = lastSeenRef.current;
      const afterFilter = lastSeenIso
        ? `&filters[createdAt][$gt]=${encodeURIComponent(lastSeenIso)}`
        : "";

      const friendsRes = await api
        .get(
          `/friends?filters[$or][0][requester][id][$eq]=${currentUserId}` +
            `&filters[$or][1][target][id][$eq]=${currentUserId}` +
            `&populate=requester&populate=target&pagination[pageSize]=200`
        )
        .catch(() => null);

      const relations = (friendsRes?.data?.data ?? []).map((f: any) => {
        const attrs = normalize(f);
        return {
          status: attrs.status || "pending",
          requesterId: getEntityId(attrs.requester),
          targetId: getEntityId(attrs.target),
        };
      });

      const pendingRequests = relations.filter(
        (f: any) => f.status === "pending" && f.targetId === currentUserId
      ).length;

      const acceptedFriendIds = relations
        .filter((f: any) => f.status === "accepted")
        .map((f: any) => (f.requesterId === currentUserId ? f.targetId : f.requesterId))
        .filter(Boolean);

      const messagesRes = await api
        .get(
          `/messages?filters[recipient][id][$eq]=${currentUserId}` +
            `${afterFilter}&sort=createdAt:desc&pagination[pageSize]=50`
        )
        .catch(() => null);
      const messageCount = messagesRes?.data?.data?.length ?? 0;

      const myPostsRes = await api
        .get(
          `/users-posts?filters[owner][id][$eq]=${currentUserId}` +
            `&fields[0]=likes&sort=createdAt:desc&pagination[pageSize]=200`
        )
        .catch(() => null);
      const myPosts = (myPostsRes?.data?.data ?? [])
        .map((p: any) => {
          const attrs = normalize(p);
          return { id: p.id ?? attrs.documentId, likes: Number(attrs.likes ?? 0) };
        })
        .filter((p: any) => p.id !== undefined && p.id !== null);
      const myPostIds = myPosts
        .map((p: any) => Number(p.id))
        .filter((id: number) => Number.isFinite(id));

      let commentCount = 0;
      if (myPostIds.length) {
        const commentFilter = myPostIds
          .map((id: number, index: number) => `filters[target_id][$in][${index}]=${id}`)
          .join("&");
        const commentsRes = await api
          .get(
            `/comments?filters[target_type][$eq]=user` +
              `&${commentFilter}${afterFilter}&sort=createdAt:desc&pagination[pageSize]=50`
          )
          .catch(() => null);
        commentCount = commentsRes?.data?.data?.length ?? 0;
      }

      let friendPostCount = 0;
      if (acceptedFriendIds.length) {
        const friendFilter = acceptedFriendIds
          .map((id: number, index: number) => `filters[owner][id][$in][${index}]=${id}`)
          .join("&");
        const postsRes = await api
          .get(
            `/users-posts?${friendFilter}` +
              `${afterFilter}&sort=createdAt:desc&pagination[pageSize]=50`
          )
          .catch(() => null);
        friendPostCount = postsRes?.data?.data?.length ?? 0;
      }

      const groupUpdatesRes = await api
        .get(
          `/group-notifications?` +
            `filters[recipient][id][$eq]=${currentUserId}` +
            `${afterFilter}&sort=createdAt:desc&pagination[pageSize]=50`
        )
        .catch(() => null);
      const groupUpdateCount = groupUpdatesRes?.data?.data?.length ?? 0;

      const prevSnapshot = likeSnapshotRef.current || {};
      let likeCount = 0;
      const nextSnapshot: Record<string, number> = {};
      myPosts.forEach((post: any) => {
        const key = String(post.id);
        const likes = Number(post.likes || 0);
        nextSnapshot[key] = likes;
        const prev = Number(prevSnapshot[key] || 0);
        if (likes > prev) likeCount += likes - prev;
      });
      latestLikeSnapshotRef.current = nextSnapshot;

      setCounts({
        messages: messageCount,
        requests: pendingRequests,
        friendPosts: friendPostCount,
        comments: commentCount,
        likes: likeCount,
        groupUpdates: groupUpdateCount,
      });
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!userId || !Number.isFinite(Number(userId))) return;
    lastSeenRef.current = getLastSeen(Number(userId));
    likeSnapshotRef.current = getLikeSnapshot(Number(userId));
    refresh();

    const interval = window.setInterval(refresh, REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [refresh, userId]);

  const markAllRead = useCallback(() => {
    if (!userId || !Number.isFinite(Number(userId))) return;
    const iso = new Date().toISOString();
    lastSeenRef.current = iso;
    setLastSeen(Number(userId), iso);
    likeSnapshotRef.current = latestLikeSnapshotRef.current;
    setLikeSnapshot(Number(userId), latestLikeSnapshotRef.current);
    setCounts((prev) => ({
      ...prev,
      messages: 0,
      friendPosts: 0,
      comments: 0,
      likes: 0,
      groupUpdates: 0,
    }));
  }, [userId]);

  const total = useMemo(
    () =>
      counts.messages +
      counts.requests +
      counts.friendPosts +
      counts.comments +
      counts.likes +
      counts.groupUpdates,
    [
      counts.comments,
      counts.friendPosts,
      counts.groupUpdates,
      counts.likes,
      counts.messages,
      counts.requests,
    ]
  );

  return { counts, total, loading, refresh, markAllRead };
};
