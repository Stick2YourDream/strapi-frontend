import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api from "../api/strapi";
import {
  decryptFriendProfilePayload,
  ensureProfileKeyShares,
  type NotificationSettings,
  type PrivacySettings,
  type ProfileVisibility,
  type VisibilityLevel,
} from "../utils/profile-e2ee";
import notificationSoundUrl from "../assets/notificationsoundeffect.mp3";
import { syncPushSubscription } from "../utils/push-notifications";

type NotificationCounts = {
  messages: number;
  requests: number;
  birthdays: number;
  friendPosts: number;
  feedbackRequests: number;
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

export type FeedbackRequestPreview = {
  id: string | number;
  postKey: string;
  ownerId?: number;
  ownerName: string;
  title?: string;
  content?: string;
  feedbackAudience?: string;
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

export type BirthdayPreview = {
  id: string;
  userId: number;
  handle?: string;
  displayName: string;
  birthday: string;
};

export type NotificationPreviews = {
  messages: MessagePreview | null;
  requests: FriendRequestPreview[];
  birthdays: BirthdayPreview[];
  friendPosts: FriendPostPreview | null;
  feedbackRequests: FeedbackRequestPreview[];
  comments: CommentPreview | null;
  likes: { count: number } | null;
  groupUpdates: GroupUpdatePreview | null;
};

const NOTIF_LAST_SEEN_KEY = "notifications_last_seen_v1";
const NOTIF_LIKE_SNAPSHOT_KEY = "notifications_like_snapshot_v1";
const NOTIF_BIRTHDAY_SEEN_KEY = "notifications_birthdays_seen_v1";
const REFRESH_MS = 60000;
const MAX_PREVIEW_ITEMS = 3;
let lastPushUserId: number | null = null;
let lastPushEnabled = false;

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
  const firstName = String(attrs?.firstName || attrs?.firstname || "").trim();
  const lastName = String(attrs?.lastName || attrs?.lastname || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || attrs?.handle || attrs?.email || "User";
};
const getProfileLabel = (entry: any) => {
  const attrs = normalize(entry);
  const firstName = String(attrs?.firstName || attrs?.firstname || "").trim();
  const lastName = String(attrs?.lastName || attrs?.lastname || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const userAttrs = normalize(getEntity(attrs.user));
  return fullName || attrs?.handle || userAttrs?.email || "User";
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

const getBirthdaySeen = (userId: number) => {
  if (typeof window === "undefined") return {};
  const raw = safeParseJson(localStorage.getItem(NOTIF_BIRTHDAY_SEEN_KEY));
  if (!raw || typeof raw !== "object") return {};
  const entry = (raw as Record<string, Record<string, string>>)[String(userId)];
  return entry && typeof entry === "object" ? entry : {};
};

const setBirthdaySeen = (userId: number, seen: Record<string, string>) => {
  if (typeof window === "undefined") return;
  const raw = safeParseJson(localStorage.getItem(NOTIF_BIRTHDAY_SEEN_KEY));
  const base = raw && typeof raw === "object" ? raw : {};
  const next = {
    ...(base as Record<string, Record<string, string>>),
    [String(userId)]: seen,
  };
  localStorage.setItem(NOTIF_BIRTHDAY_SEEN_KEY, JSON.stringify(next));
};

const DEFAULT_PRIVACY_SETTINGS: Required<PrivacySettings> = {
  bio: "public",
  links: "public",
  location: "public",
  birthday: "public",
  followers: "public",
  following: "public",
  activity: "public",
};

const normalizeVisibility = (value: unknown, fallback: VisibilityLevel): VisibilityLevel => {
  if (value === "public" || value === "followers" || value === "private") return value;
  return fallback;
};

const normalizeProfileVisibility = (value: unknown): ProfileVisibility => {
  if (value === "public" || value === "followers" || value === "private" || value === "custom") {
    return value;
  }
  return "public";
};

const normalizePrivacySettings = (
  settings?: PrivacySettings | null
): Required<PrivacySettings> => ({
  bio: normalizeVisibility(settings?.bio, DEFAULT_PRIVACY_SETTINGS.bio),
  links: normalizeVisibility(settings?.links, DEFAULT_PRIVACY_SETTINGS.links),
  location: normalizeVisibility(settings?.location, DEFAULT_PRIVACY_SETTINGS.location),
  birthday: normalizeVisibility(settings?.birthday, DEFAULT_PRIVACY_SETTINGS.birthday),
  followers: normalizeVisibility(settings?.followers, DEFAULT_PRIVACY_SETTINGS.followers),
  following: normalizeVisibility(settings?.following, DEFAULT_PRIVACY_SETTINGS.following),
  activity: normalizeVisibility(settings?.activity, DEFAULT_PRIVACY_SETTINGS.activity),
});

const resolveFieldVisibility = (
  profileVisibility: ProfileVisibility,
  privacySettings: PrivacySettings,
  field: keyof PrivacySettings,
  fallback: VisibilityLevel
) => {
  if (profileVisibility === "custom") {
    return normalizeVisibility(privacySettings[field], fallback);
  }
  return normalizeVisibility(profileVisibility, fallback);
};

const canView = (audience: "public" | "followers", visibility: VisibilityLevel) => {
  if (visibility === "public") return true;
  if (visibility === "followers") return audience === "followers";
  return false;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

const getLocalDateKey = (date = new Date()) =>
  `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const getLocalMonthDayKey = (date = new Date()) =>
  `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const normalizeBirthdayDate = (value?: string) => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const datePart = raw.split("T")[0];
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`;
};

const getBirthdayMonthDayKey = (value?: string) => {
  const normalized = normalizeBirthdayDate(value);
  if (!normalized) return "";
  const [, month, day] = normalized.split("-");
  return month && day ? `${month}-${day}` : "";
};

const isBirthdayToday = (value?: string, today = new Date()) => {
  const birthdayKey = getBirthdayMonthDayKey(value);
  if (!birthdayKey) return false;
  return birthdayKey === getLocalMonthDayKey(today);
};

const getBirthdayToken = (friendId: number, todayKey: string) => `${friendId}:${todayKey}`;

export const useNotifications = (
  userId?: number | null,
  settings?: NotificationSettings
) => {
  const normalizeTime = (value?: string) => {
    if (!value) return null;
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
    return { hours, minutes };
  };

  const isWithinQuietHours = (settings?: NotificationSettings) => {
    if (!settings?.quietHoursStart || !settings?.quietHoursEnd) return false;
    const start = normalizeTime(settings.quietHoursStart);
    const end = normalizeTime(settings.quietHoursEnd);
    if (!start || !end) return false;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const startMinutes = start.hours * 60 + start.minutes;
    const endMinutes = end.hours * 60 + end.minutes;
    if (startMinutes === endMinutes) return false;
    if (startMinutes < endMinutes) {
      return currentMinutes >= startMinutes && currentMinutes < endMinutes;
    }
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  };
  const [counts, setCounts] = useState<NotificationCounts>({
    messages: 0,
    requests: 0,
    birthdays: 0,
    friendPosts: 0,
    feedbackRequests: 0,
    comments: 0,
    likes: 0,
    groupUpdates: 0,
  });
  const [previews, setPreviews] = useState<NotificationPreviews>(() => ({
    messages: null,
    requests: [],
    birthdays: [],
    friendPosts: null,
    feedbackRequests: [],
    comments: null,
    likes: null,
    groupUpdates: null,
  }));
  const [loading, setLoading] = useState(false);
  const lastSeenRef = useRef<string | null>(null);
  const likeSnapshotRef = useRef<Record<string, number> | null>(null);
  const latestLikeSnapshotRef = useRef<Record<string, number>>({});
  const birthdaySeenRef = useRef<Record<string, string>>({});
  const birthdayTokensRef = useRef<string[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const initialLoadRef = useRef(true);
  const lastCountsRef = useRef<NotificationCounts | null>(null);
  const profileNameCacheRef = useRef<Record<number, string>>({});

  useEffect(() => {
    if (!userId || !settings?.pushEnabled) {
      if (!settings?.pushEnabled) lastPushEnabled = false;
      if (!userId) lastPushUserId = null;
      return;
    }
    if (lastPushUserId === userId && lastPushEnabled) return;
    lastPushUserId = userId;
    lastPushEnabled = true;
    void syncPushSubscription({ enable: true, requestPermission: false });
  }, [userId, settings?.pushEnabled]);

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
        counts.birthdays > previous.birthdays ||
        counts.friendPosts > previous.friendPosts ||
        counts.feedbackRequests > previous.feedbackRequests ||
        counts.comments > previous.comments ||
        counts.likes > previous.likes ||
        counts.groupUpdates > previous.groupUpdates);
    const dndActive = Boolean(settings?.dndEnabled) || isWithinQuietHours(settings);
    const soundEnabled = settings?.soundEnabled !== false;
    const vibrationEnabled = settings?.vibrationEnabled !== false;
    if (hasIncrease && !dndActive) {
      if (soundEnabled) {
      audioRef.current.currentTime = 0;
      const playPromise = audioRef.current.play();
      if (playPromise) {
        playPromise.catch(() => undefined);
      }
      }
      if (vibrationEnabled && typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate(180);
      }
    }
    lastCountsRef.current = { ...counts };
  }, [counts, settings]);

  const refresh = useCallback(async () => {
    if (!userId || !Number.isFinite(Number(userId))) {
      setCounts({
        messages: 0,
        requests: 0,
        birthdays: 0,
        friendPosts: 0,
        feedbackRequests: 0,
        comments: 0,
        likes: 0,
        groupUpdates: 0,
      });
      setPreviews({
        messages: null,
        requests: [],
        birthdays: [],
        friendPosts: null,
        feedbackRequests: [],
        comments: null,
        likes: null,
        groupUpdates: null,
      });
      return;
    }

    const currentUserId = Number(userId);
    setLoading(true);

    try {
      const today = new Date();
      const todayKey = getLocalDateKey(today);
      birthdaySeenRef.current = getBirthdaySeen(currentUserId);
      const birthdaySeen = birthdaySeenRef.current;
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
          requesterFavorite: Boolean(attrs.requesterFavorite),
          targetFavorite: Boolean(attrs.targetFavorite),
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
      const favoriteFriendIds = relations
        .filter(
          (f: any) =>
            f.status === "accepted" &&
            ((f.requesterId === currentUserId && f.requesterFavorite) ||
              (f.targetId === currentUserId && f.targetFavorite))
        )
        .map((f: any) => (f.requesterId === currentUserId ? f.targetId : f.requesterId))
        .filter(Boolean);
      const favoriteSet = new Set(favoriteFriendIds as number[]);

      let birthdayCount = 0;
      let birthdayPreviews: BirthdayPreview[] = [];
      birthdayTokensRef.current = [];
      if (acceptedFriendIds.length) {
        const friendFilter = acceptedFriendIds
          .map((id: number, index: number) => `filters[user][id][$in][${index}]=${id}`)
          .join("&");
        const profilesRes = await api
          .get(
            `/profiles?${friendFilter}` +
              `&populate=user&pagination[pageSize]=${acceptedFriendIds.length}`
          )
          .catch(() => null);
        const profileEntries = profilesRes?.data?.data ?? [];
        const birthdayMatches: BirthdayPreview[] = [];
        for (const entry of profileEntries) {
          const attrs = normalize(entry);
          const friendId = getEntityId(attrs.user);
          if (!friendId || friendId === currentUserId) continue;
          const encryptedProfile = String(attrs.encryptedProfile || "");
          let payload: Record<string, unknown> | null = null;
          if (encryptedProfile) {
            try {
              payload = await decryptFriendProfilePayload(
                friendId,
                currentUserId,
                encryptedProfile
              );
            } catch {
              payload = null;
            }
          }
          const birthdayValue = normalizeBirthdayDate(
            String(payload?.birthday || attrs.birthday || "")
          );
          if (!birthdayValue || !isBirthdayToday(birthdayValue, today)) continue;
          const profileVisibility = normalizeProfileVisibility(
            payload?.profileVisibility ?? attrs.profileVisibility
          );
          const privacySettings = normalizePrivacySettings(
            (payload?.privacySettings as PrivacySettings | undefined) ??
              (attrs.privacySettings as PrivacySettings | undefined)
          );
          const birthdayVisibility = resolveFieldVisibility(
            profileVisibility,
            privacySettings,
            "birthday",
            "public"
          );
          if (!canView("followers", birthdayVisibility)) continue;
          const firstName = String(payload?.firstName || "").trim();
          const lastName = String(payload?.lastName || "").trim();
          const fullName = `${firstName} ${lastName}`.trim();
          const handle = String(attrs.handle || "").trim() || undefined;
          const fallbackName = handle
            ? handle.replace(/^@/, "")
            : getUserLabel(attrs.user) || "Your friend";
          birthdayMatches.push({
            id: String(friendId),
            userId: friendId,
            handle,
            displayName: fullName || fallbackName,
            birthday: birthdayValue,
          });
        }

        const unseen = birthdayMatches
          .map((entry) => {
            const token = getBirthdayToken(entry.userId, todayKey);
            return { entry, token };
          })
          .filter(({ token }) => !birthdaySeen[token]);

        birthdayTokensRef.current = unseen.map(({ token }) => token);
        birthdayCount = unseen.length;
        birthdayPreviews = unseen.slice(0, MAX_PREVIEW_ITEMS).map(({ entry }) => entry);
      }

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
        if (comments.length) {
          const first = comments[0];
          const attrs = normalize(first);
          const ownerId = getEntityId(attrs.owner);
          let ownerName = getUserLabel(attrs.owner);
          if (ownerId) {
            const cachedName = profileNameCacheRef.current[ownerId];
            if (cachedName) {
              ownerName = cachedName;
            } else {
              const profileRes = await api
                .get(
                  `/profiles?filters[user][id][$eq]=${ownerId}` +
                    `&populate=user&pagination[pageSize]=1`
                )
                .catch(() => null);
              const profileEntry = profileRes?.data?.data?.[0];
              if (profileEntry) {
                const label = getProfileLabel(profileEntry);
                if (label) {
                  profileNameCacheRef.current[ownerId] = label;
                  ownerName = label;
                }
              }
            }
          }
          commentPreview = {
            id: first.id ?? attrs.documentId ?? attrs.id ?? "comment",
            ownerId,
            ownerName,
            body: attrs.body,
            createdAt: attrs.createdAt,
          };
        } else {
          commentPreview = null;
        }
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
        if (posts.length) {
          const sorted = [...posts].sort((a: any, b: any) => {
            const aAttrs = normalize(a);
            const bAttrs = normalize(b);
            const aOwner = getEntityId(aAttrs.owner);
            const bOwner = getEntityId(bAttrs.owner);
            const aFav = Boolean(aOwner && favoriteSet.has(aOwner));
            const bFav = Boolean(bOwner && favoriteSet.has(bOwner));
            if (aFav !== bFav) return aFav ? -1 : 1;
            const aTime = aAttrs.createdAt ? new Date(aAttrs.createdAt).getTime() : 0;
            const bTime = bAttrs.createdAt ? new Date(bAttrs.createdAt).getTime() : 0;
            return bTime - aTime;
          });
          const first = sorted[0];
          const attrs = normalize(first);
          const ownerId = getEntityId(attrs.owner);
          let ownerName = getUserLabel(attrs.owner);
          if (ownerId) {
            const cachedName = profileNameCacheRef.current[ownerId];
            if (cachedName) {
              ownerName = cachedName;
            } else {
              const profileRes = await api
                .get(
                  `/profiles?filters[user][id][$eq]=${ownerId}` +
                    `&populate=user&pagination[pageSize]=1`
                )
                .catch(() => null);
              const profileEntry = profileRes?.data?.data?.[0];
              if (profileEntry) {
                const label = getProfileLabel(profileEntry);
                if (label) {
                  profileNameCacheRef.current[ownerId] = label;
                  ownerName = label;
                }
              }
            }
          }
          friendPostPreview = {
            id: first.id ?? attrs.documentId ?? attrs.id ?? "post",
            ownerId,
            ownerName,
            title: attrs.Title || attrs.title,
            content: attrs.Users_Content || attrs.content,
            createdAt: attrs.createdAt,
          };
        }
      }

      let feedbackCount = 0;
      let feedbackRequests: FeedbackRequestPreview[] = [];
      const feedbackEntries: any[] = [];
      const feedbackOwnerIds = new Set<number>();
      const collectFeedbackEntries = (entries: any[]) => {
        entries.forEach((entry) => {
          const attrs = normalize(entry);
          const postKey = String(entry?.id ?? attrs?.documentId ?? attrs?.id ?? "");
          if (!postKey) return;
          if (feedbackEntries.some((item) => String(item?.id ?? "") === postKey)) return;
          feedbackEntries.push(entry);
        });
      };

      const publicFeedbackRes = await api
        .get(
          `/users-posts?filters[feedbackAudience][$eq]=public` +
            `${afterFilter}&populate=owner&sort=createdAt:desc&pagination[pageSize]=50`
        )
        .catch(() => null);
      collectFeedbackEntries(publicFeedbackRes?.data?.data ?? []);

      if (acceptedFriendIds.length) {
        const friendFeedbackFilter = acceptedFriendIds
          .map((id: number, index: number) => `filters[owner][id][$in][${index}]=${id}`)
          .join("&");
        const friendsFeedbackRes = await api
          .get(
            `/users-posts?${friendFeedbackFilter}` +
              `&filters[feedbackAudience][$eq]=friends${afterFilter}` +
              `&populate=owner&sort=createdAt:desc&pagination[pageSize]=50`
          )
          .catch(() => null);
        collectFeedbackEntries(friendsFeedbackRes?.data?.data ?? []);
      }

      const specificFeedbackRes = await api
        .get(
          `/users-posts?filters[feedbackAudience][$eq]=specific` +
            `&filters[feedbackTarget][id][$eq]=${currentUserId}` +
            `${afterFilter}&populate=owner&populate=feedbackTarget&sort=createdAt:desc` +
            `&pagination[pageSize]=50`
        )
        .catch(() => null);
      collectFeedbackEntries(specificFeedbackRes?.data?.data ?? []);

      feedbackEntries.forEach((entry) => {
        const attrs = normalize(entry);
        const ownerId = getEntityId(attrs.owner);
        if (ownerId === currentUserId) return;
        if (ownerId) feedbackOwnerIds.add(ownerId);
      });

      const missingOwnerIds = Array.from(feedbackOwnerIds).filter(
        (id) => !profileNameCacheRef.current[id]
      );
      if (missingOwnerIds.length) {
        const ownerFilter = missingOwnerIds
          .map((id: number, index: number) => `filters[user][id][$in][${index}]=${id}`)
          .join("&");
        const profileRes = await api
          .get(
            `/profiles?${ownerFilter}&populate=user&pagination[pageSize]=${missingOwnerIds.length}`
          )
          .catch(() => null);
        (profileRes?.data?.data ?? []).forEach((entry: any) => {
          const label = getProfileLabel(entry);
          const attrs = normalize(entry);
          const userData = attrs.user?.data ?? attrs.user;
          const rawId = userData?.id ?? userData?.data?.id;
          const numeric = Number(rawId);
          if (label && Number.isFinite(numeric)) {
            profileNameCacheRef.current[numeric] = label;
          }
        });
      }

      feedbackRequests = feedbackEntries
        .map((entry: any) => {
          const attrs = normalize(entry);
          const postKey = String(entry?.id ?? attrs?.documentId ?? attrs?.id ?? "");
          if (!postKey) return null;
          const ownerId = getEntityId(attrs.owner);
          if (ownerId === currentUserId) return null;
          const ownerName =
            (ownerId && profileNameCacheRef.current[ownerId]) || getUserLabel(attrs.owner);
          const title = attrs.Title || attrs.title;
          const content = attrs.Users_Content || attrs.content;
          return {
            id: postKey,
            postKey,
            ownerId,
            ownerName: ownerName || "Someone",
            title,
            content,
            feedbackAudience: attrs.feedbackAudience || undefined,
            createdAt: attrs.createdAt,
          } as FeedbackRequestPreview;
        })
        .filter(Boolean) as FeedbackRequestPreview[];

      feedbackRequests.sort((a, b) => {
        const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return bTime - aTime;
      });
      feedbackCount = feedbackRequests.length;

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
        birthdays: birthdayCount,
        friendPosts: friendPostCount,
        feedbackRequests: feedbackCount,
        comments: commentCount,
        likes: likeCount,
        groupUpdates: groupUpdateCount,
      });
      setPreviews({
        messages: messagePreview,
        requests: requestPreviews,
        birthdays: birthdayPreviews,
        friendPosts: friendPostPreview,
        feedbackRequests: feedbackRequests.slice(0, MAX_PREVIEW_ITEMS),
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
    birthdaySeenRef.current = getBirthdaySeen(Number(userId));
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
    const birthdaySeen = { ...birthdaySeenRef.current };
    birthdayTokensRef.current.forEach((token) => {
      birthdaySeen[token] = iso;
    });
    birthdaySeenRef.current = birthdaySeen;
    setBirthdaySeen(Number(userId), birthdaySeen);
    setCounts((prev) => ({
      ...prev,
      messages: 0,
      birthdays: 0,
      friendPosts: 0,
      feedbackRequests: 0,
      comments: 0,
      likes: 0,
      groupUpdates: 0,
    }));
    setPreviews((prev) => ({
      ...prev,
      messages: null,
      birthdays: [],
      friendPosts: null,
      feedbackRequests: [],
      comments: null,
      likes: null,
      groupUpdates: null,
    }));
  }, [userId]);

  const sendBirthdayMessage = useCallback(
    async (preview: BirthdayPreview, message: string) => {
      if (!userId || !Number.isFinite(Number(userId))) return false;
      if (!preview?.userId || !Number.isFinite(preview.userId)) return false;
      const body = String(message || "").trim();
      if (!body) return false;
      try {
        await api.post("/messages", {
          data: {
            body,
            recipient: Number(preview.userId),
          },
        });
        const iso = new Date().toISOString();
        const todayKey = getLocalDateKey();
        const token = getBirthdayToken(Number(preview.userId), todayKey);
        const seen = { ...birthdaySeenRef.current, [token]: iso };
        birthdaySeenRef.current = seen;
        setBirthdaySeen(Number(userId), seen);
        birthdayTokensRef.current = birthdayTokensRef.current.filter((entry) => entry !== token);
        await refresh();
        return true;
      } catch (error) {
        console.warn("Unable to send birthday message:", error);
        return false;
      }
    },
    [refresh, userId]
  );

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
    [refresh, userId]
  );

  const total = useMemo(
    () =>
      counts.messages +
      counts.requests +
      counts.birthdays +
      counts.friendPosts +
      counts.feedbackRequests +
      counts.comments +
      counts.likes +
      counts.groupUpdates,
    [
      counts.birthdays,
      counts.comments,
      counts.feedbackRequests,
      counts.friendPosts,
      counts.groupUpdates,
      counts.likes,
      counts.messages,
      counts.requests,
    ]
  );

  return {
    counts,
    total,
    loading,
    refresh,
    markAllRead,
    previews,
    acceptFriendRequest,
    sendBirthdayMessage,
  };
};
