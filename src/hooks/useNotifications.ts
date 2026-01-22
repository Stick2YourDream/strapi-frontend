import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api/strapi";
import { ensureProfileKeyShares } from "../utils/profile-e2ee";
import notificationSoundUrl from "../assets/notificationsoundeffect.mp3";

type NotificationCounts = {
  messages: number;
  requests: number;
  friendPosts: number;
  comments: number;
  likes: number;
  groupUpdates: number;
};

export type FriendRequestPreview = {
  id: string | number;
  idNumber?: number;
  docId?: string;
  requesterId?: number;
  requesterName: string;
  createdAt?: string;
};

export type MessagePreview = {
  id: string | number;
  senderId?: number;
  senderName: string;
  body?: string;
  createdAt?: string;
};

export type FriendPostPreview = {
  id: string | number;
  ownerId?: number;
  ownerName: string;
  title?: string;
  content?: string;
  createdAt?: string;
};

export type CommentPreview = {
  id: string | number;
  ownerId?: number;
  ownerName: string;
  body?: string;
  createdAt?: string;
};

export type GroupUpdatePreview = {
  id: string | number;
  actorName?: string;
  message?: string;
  createdAt?: string;
};

export type NotificationPreviews = {
  messages: MessagePreview | null;
  requests: FriendRequestPreview[];
  friendPosts: FriendPostPreview | null;
  comments: CommentPreview | null;
  likes: { count: number } | null;
  groupUpdates: GroupUpdatePreview | null;
};

const NOTIF_LAST_SEEN_KEY = "notifications_last_seen_v1";
const NOTIF_LIKE_SNAPSHOT_KEY = "notifications_like_snapshot_v1";
const REFRESH_MS = 60000;
const MAX_PREVIEW_ITEMS = 3;

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
const getEntity = (entry: any) => entry?.data ?? entry ?? null;
const getEntityId = (entry: any) => {
  const data = getEntity(entry);
  const rawId = data?.id ?? (typeof data === "number" ? data : data?.attributes?.id);
  const num = Number(rawId);
  return Number.isFinite(num) ? num : undefined;
};
const getUserLabel = (entry: any) => {
  const data = getEntity(entry);
  const attrs = normalize(data);
  return attrs?.username || attrs?.email || attrs?.handle || "User";
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
  const [previews, setPreviews] = useState<NotificationPreviews>(() => ({
    messages: null,
    requests: [],
    friendPosts: null,
    comments: null,
    likes: null,
    groupUpdates: null,
  }));
  const [loading, setLoading] = useState(false);
  const lastSeenRef = useRef<string | null>(null);
  const likeSnapshotRef = useRef<Record<string, number> | null>(null);
  const latestLikeSnapshotRef = useRef<Record<string, number>>({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const initialLoadRef = useRef(true);
  const lastCountsRef = useRef<NotificationCounts | null>(null);

  useEffect(() => {
    if (typeof Audio === "undefined") return;
    audioRef.current = new Audio(notificationSoundUrl);
    audioRef.current.preload = "auto";
    return () => {
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    initialLoadRef.current = true;
    lastCountsRef.current = null;
  }, [userId]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      lastCountsRef.current = { ...counts };
      return;
    }
    const previous = lastCountsRef.current;
    const hasIncrease =
      previous !== null &&
      (counts.messages > previous.messages ||
        counts.requests > previous.requests ||
        counts.friendPosts > previous.friendPosts ||
        counts.comments > previous.comments ||
        counts.likes > previous.likes ||
        counts.groupUpdates > previous.groupUpdates);
    if (hasIncrease) {
      audioRef.current.currentTime = 0;
      const playPromise = audioRef.current.play();
      if (playPromise) {
        playPromise.catch(() => undefined);
      }
    }
    lastCountsRef.current = { ...counts };
  }, [counts]);

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
      setPreviews({
        messages: null,
        requests: [],
        friendPosts: null,
        comments: null,
        likes: null,
        groupUpdates: null,
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
            `&populate=requester&populate=target&sort=createdAt:desc&pagination[pageSize]=200`
        )
        .catch(() => null);

      const relations = (friendsRes?.data?.data ?? []).map((f: any) => {
        const attrs = normalize(f);
        return {
          id: f.id ?? attrs.documentId ?? attrs.id,
          idNumber: typeof f.id === "number" ? f.id : undefined,
          docId: attrs.documentId,
          status: attrs.status || "pending",
          requesterId: getEntityId(attrs.requester),
          targetId: getEntityId(attrs.target),
          requesterName: getUserLabel(attrs.requester),
          targetName: getUserLabel(attrs.target),
          createdAt: attrs.createdAt,
        };
      });

      const pendingRequests = relations.filter(
        (f: any) => f.status === "pending" && f.targetId === currentUserId
      );
      const pendingRequestCount = pendingRequests.length;
      const requestPreviews = pendingRequests
        .slice(0, MAX_PREVIEW_ITEMS)
        .map((f: any) => ({
          id: f.id,
          idNumber: f.idNumber,
          docId: f.docId,
          requesterId: f.requesterId,
          requesterName: f.requesterName || "User",
          createdAt: f.createdAt,
        }));

      const acceptedFriendIds = relations
        .filter((f: any) => f.status === "accepted")
        .map((f: any) => (f.requesterId === currentUserId ? f.targetId : f.requesterId))
        .filter(Boolean);

      const messagesRes = await api
        .get(
          `/messages?filters[recipient][id][$eq]=${currentUserId}` +
            `${afterFilter}&populate=sender&sort=createdAt:desc&pagination[pageSize]=50`
        )
        .catch(() => null);
      const messages = messagesRes?.data?.data ?? [];
      const messageCount = messages.length ?? 0;
      const messagePreview: MessagePreview | null = messages.length
        ? (() => {
            const first = messages[0];
            const attrs = normalize(first);
            return {
              id: first.id ?? attrs.documentId ?? attrs.id ?? "message",
              senderId: getEntityId(attrs.sender),
              senderName: getUserLabel(attrs.sender),
              body: attrs.body,
              createdAt: attrs.createdAt,
            };
          })()
        : null;

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
      let commentPreview: CommentPreview | null = null;
      if (myPostIds.length) {
        const commentFilter = myPostIds
          .map((id: number, index: number) => `filters[target_id][$in][${index}]=${id}`)
          .join("&");
        const commentsRes = await api
          .get(
            `/comments?filters[target_type][$eq]=user` +
              `&${commentFilter}${afterFilter}&populate=owner&sort=createdAt:desc&pagination[pageSize]=50`
          )
          .catch(() => null);
        const comments = commentsRes?.data?.data ?? [];
        commentCount = comments.length ?? 0;
        commentPreview = comments.length
          ? (() => {
              const first = comments[0];
              const attrs = normalize(first);
              return {
                id: first.id ?? attrs.documentId ?? attrs.id ?? "comment",
                ownerId: getEntityId(attrs.owner),
                ownerName: getUserLabel(attrs.owner),
                body: attrs.body,
                createdAt: attrs.createdAt,
              };
            })()
          : null;
      }

      let friendPostCount = 0;
      let friendPostPreview: FriendPostPreview | null = null;
      if (acceptedFriendIds.length) {
        const friendFilter = acceptedFriendIds
          .map((id: number, index: number) => `filters[owner][id][$in][${index}]=${id}`)
          .join("&");
        const postsRes = await api
          .get(
            `/users-posts?${friendFilter}` +
              `${afterFilter}&populate=owner&sort=createdAt:desc&pagination[pageSize]=50`
          )
          .catch(() => null);
        const posts = postsRes?.data?.data ?? [];
        friendPostCount = posts.length ?? 0;
        friendPostPreview = posts.length
          ? (() => {
              const first = posts[0];
              const attrs = normalize(first);
              return {
                id: first.id ?? attrs.documentId ?? attrs.id ?? "post",
                ownerId: getEntityId(attrs.owner),
                ownerName: getUserLabel(attrs.owner),
                title: attrs.Title || attrs.title,
                content: attrs.Users_Content || attrs.content,
                createdAt: attrs.createdAt,
              };
            })()
          : null;
      }

      const groupUpdatesRes = await api
        .get(
          `/group-notifications?` +
            `filters[recipient][id][$eq]=${currentUserId}` +
            `${afterFilter}&populate=actor&populate=group&sort=createdAt:desc&pagination[pageSize]=50`
        )
        .catch(() => null);
      const groupUpdates = groupUpdatesRes?.data?.data ?? [];
      const groupUpdateCount = groupUpdates.length ?? 0;
      const groupUpdatePreview: GroupUpdatePreview | null = groupUpdates.length
        ? (() => {
            const first = groupUpdates[0];
            const attrs = normalize(first);
            return {
              id: first.id ?? attrs.documentId ?? attrs.id ?? "group-update",
              actorName: getUserLabel(attrs.actor),
              message: attrs.message,
              createdAt: attrs.createdAt,
            };
          })()
        : null;

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
        requests: pendingRequestCount,
        friendPosts: friendPostCount,
        comments: commentCount,
        likes: likeCount,
        groupUpdates: groupUpdateCount,
      });
      setPreviews({
        messages: messagePreview,
        requests: requestPreviews,
        friendPosts: friendPostPreview,
        comments: commentPreview,
        likes: likeCount > 0 ? { count: likeCount } : null,
        groupUpdates: groupUpdatePreview,
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
    setPreviews((prev) => ({
      ...prev,
      messages: null,
      friendPosts: null,
      comments: null,
      likes: null,
      groupUpdates: null,
    }));
  }, [userId]);

  const acceptFriendRequest = useCallback(
    async (request: FriendRequestPreview) => {
      if (!request?.id) return false;
      try {
        const targetDoc = request.docId ?? (typeof request.id === "string" ? request.id : null);
        const targetNum =
          request.idNumber ?? (typeof request.id === "number" ? request.id : null);

        let updated = false;
        const payload = { data: { status: "accepted", locale: "en" } };

        if (targetNum) {
          try {
            await api.put(`/friends/${targetNum}`, payload);
            updated = true;
          } catch (err: any) {
            if (!(err?.response?.status === 404)) throw err;
          }
        }
        if (!updated && targetDoc) {
          await api.put(`/friends/${targetDoc}?locale=en`, payload);
          updated = true;
        }
        if (!updated) throw new Error("Update failed");

        if (request.requesterId && userId) {
          try {
            await ensureProfileKeyShares(Number(userId), [request.requesterId]);
          } catch {
            // ignore profile share errors
          }
        }
        await refresh();
        return true;
      } catch {
        return false;
      }
    },
    [refresh]
  );

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

  return { counts, total, loading, refresh, markAllRead, previews, acceptFriendRequest };
};
