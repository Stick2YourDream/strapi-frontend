// src/pages/Friends.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/dashboard.css";
import "../css/friends.css";
import "../css/media-lightbox.css";
import { LayoutDashboard } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { useVideoCall, type VideoCallInvitee } from "../context/VideoCallContext";
import api from "../api/strapi";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import { usePageMeta } from "../hooks/usePageMeta";
import FriendPostsFeed, { type FriendFeedPost } from "../components/FriendPostsFeed";
import {
  buildProfilePayloadFromAttrs,
  decryptFriendProfilePayload,
  ensureProfileKeyShares,
  type PrivacySettings,
  type ProfilePayload,
  type ProfileVisibility,
  type VisibilityLevel,
} from "../utils/profile-e2ee";
import { pickMediaUrl } from "../utils/media";

type FriendPost = FriendFeedPost;

type FriendMediaItem = {
  id: number | string;
  title?: string;
  caption?: string;
  visibility?: "public" | "friends" | "private" | "trusted";
  kind?: "photo" | "video";
  media?: string;
  createdAt?: string;
};

type FriendProfile = {
  id: number | string;
  handle: string;
  bio?: string;
  userId?: number;
  firstName?: string;
  lastName?: string;
  age?: string;
  birthday?: string;
  gender?: string;
  religion?: string;
  hobbies?: string;
  country?: string;
  state?: string;
  city?: string;
  occupation?: string;
  phone?: string;
  showPhoneOnProfile?: boolean;
  avatarUrl?: string;
  profileVisibility?: ProfileVisibility;
  privacySettings?: PrivacySettings;
  activityVisibility?: VisibilityLevel;
  lastSeenAt?: string;
  favorite?: boolean;
  relationId?: string | number;
  relationDocId?: string;
  relationIdNumber?: number;
  relationRequesterId?: number;
  relationTargetId?: number;
};

type FriendRelation = {
  id: number | string;
  idNumber?: number;
  docId?: string;
  requesterId?: number;
  targetId?: number;
  status: "pending" | "accepted" | "blocked" | string;
  requesterFavorite?: boolean;
  targetFavorite?: boolean;
};

type UserActionEntry = {
  userId: number;
  recordId: number | string;
};

type FriendRequestItem = {
  id: string | number;
  idNumber?: number;
  docId?: string;
  requesterId?: number;
  requesterName: string;
  requesterHandle?: string;
  requesterAvatarUrl?: string;
  targetId?: number;
  targetName: string;
  targetHandle?: string;
  targetAvatarUrl?: string;
  createdAt?: string;
};

const extractFirstUrl = (text: string) => {
  const match = String(text || "").match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (!match) return "";
  let url = match[0].replace(/[),.!?]+$/, "");
  if (url.startsWith("www.")) url = `https://${url}`;
  return url;
};

const isVideoUrl = (value?: string) => !!value && /\.(mp4|webm|mov)$/i.test(value);

const normalizeFriendSearch = (value: string) =>
  value.trim().replace(/@+/g, "").replace(/\s+/g, " ").toLowerCase();

const DEFAULT_PRIVACY_SETTINGS: Required<PrivacySettings> = {
  bio: "public",
  links: "public",
  location: "public",
  birthday: "public",
  followers: "public",
  following: "public",
  activity: "public",
};

const normalizeVisibility = (value: any, fallback: VisibilityLevel): VisibilityLevel => {
  if (value === "public" || value === "followers" || value === "private") {
    return value;
  }
  return fallback;
};

const normalizeProfileVisibility = (value: any): ProfileVisibility => {
  if (
    value === "public" ||
    value === "followers" ||
    value === "private" ||
    value === "custom"
  ) {
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

const FRIENDS_PAGE_SIZE = 10;

const formatLastSeen = (value?: string) => {
  if (!value) return "Last seen recently";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "Last seen recently";
  const diff = Date.now() - time;
  if (diff < 60_000) return "Active just now";
  if (diff < 3_600_000) return `Last seen ${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `Last seen ${Math.floor(diff / 3_600_000)}h ago`;
  const days = Math.floor(diff / 86_400_000);
  if (days < 7) return `Last seen ${days}d ago`;
  return `Last seen ${new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(time)
  )}`;
};

export default function Friends() {
  const { user } = useAuth();
  const { openChat } = useChat();
  const { openCallComposer, onlineUserIds, setPresenceTargets } = useVideoCall();
  const { getBackgroundStyle } = useUserPreferences();
  const navigate = useNavigate();
  usePageMeta({
    title: "Friends | Your Social Place",
    description:
      "Find supportive friends, send messages, and discover new connections based on shared location, hobbies, and faith.",
    type: "website",
    robots: "noindex, nofollow",
  });

  const [query, setQuery] = useState("");
  const [friendQuery, setFriendQuery] = useState("");
  const [profiles, setProfiles] = useState<FriendProfile[]>([]);
  const [postsByOwner, setPostsByOwner] = useState<Record<number, FriendPost[]>>({});
  const [friendMedia, setFriendMedia] = useState<FriendMediaItem[]>([]);
  const [friendMediaLoading, setFriendMediaLoading] = useState(false);
  const [friendMediaError, setFriendMediaError] = useState<string | null>(null);
  const [friendMediaTab, setFriendMediaTab] = useState<"all" | "photo" | "video">(
    "all"
  );
  const [mediaLightboxOpen, setMediaLightboxOpen] = useState(false);
  const [mediaLightboxItems, setMediaLightboxItems] = useState<FriendMediaItem[]>([]);
  const [mediaLightboxIndex, setMediaLightboxIndex] = useState(0);
  const [selectedFriendId, setSelectedFriendId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockEntries, setBlockEntries] = useState<UserActionEntry[]>([]);
  const [muteEntries, setMuteEntries] = useState<UserActionEntry[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [friendPage, setFriendPage] = useState(1);
  const [incomingRequests, setIncomingRequests] = useState<FriendRequestItem[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<FriendRequestItem[]>([]);
  const [requestsLoading, setRequestsLoading] = useState(false);
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [requestNotice, setRequestNotice] = useState<string | null>(null);
  const [requestActionBusy, setRequestActionBusy] = useState<Record<string, boolean>>({});
  const [refreshToken, setRefreshToken] = useState(0);

  const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
  const getEntity = (entry: any) => entry?.data ?? entry ?? null;
  const getEntityAttrs = (entry: any) => {
    const data = getEntity(entry);
    return data?.attributes ?? data ?? {};
  };
  const getEntityId = (entry: any) => {
    const data = getEntity(entry);
    const rawId = data?.id ?? (typeof data === "number" ? data : data?.attributes?.id);
    const num = Number(rawId);
    return Number.isFinite(num) ? num : undefined;
  };
  const getEntryId = (entry: any, attrs: any) =>
    entry?.id ?? attrs?.documentId ?? entry?.documentId;
  const getUserDisplayName = (entry: any) => {
    const attrs = getEntityAttrs(entry);
    const firstName = String(attrs?.firstName || attrs?.firstname || "").trim();
    const lastName = String(attrs?.lastName || attrs?.lastname || "").trim();
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) return fullName;
    const handle = String(attrs?.handle || "").trim();
    if (handle) return handle;
    const username = String(attrs?.username || "").trim();
    if (username) return username;
    const email = String(attrs?.email || "").trim();
    if (email) return email.split("@")[0];
    return "User";
  };
  const getUserHandle = (entry: any) => {
    const attrs = getEntityAttrs(entry);
    const handle = String(attrs?.handle || "").trim();
    if (handle) return handle;
    const username = String(attrs?.username || "").trim();
    if (username) return username;
    return "";
  };
  const normalizeFriendMedia = (entry: any): FriendMediaItem => {
    const record = getEntity(entry);
    const attrs = record?.attributes ?? record ?? {};
    const mediaItem = attrs?.media ?? record?.media;
    const mediaUrl = pickMediaUrl(mediaItem, { kind: "post" });
    return {
      id: record?.id ?? record?.documentId ?? "",
      title: String(attrs?.title || "").trim() || undefined,
      caption: String(attrs?.caption || "").trim() || undefined,
      visibility: attrs?.visibility as FriendMediaItem["visibility"],
      kind: attrs?.kind as FriendMediaItem["kind"],
      media: mediaUrl,
      createdAt: String(attrs?.createdAt || ""),
    };
  };
  const parseActionEntries = (
    rows: any[],
    relationKey: "blocked" | "muted"
  ): UserActionEntry[] =>
    rows
      .map((entry) => {
        const attrs = normalize(entry);
        const userId = getEntityId(attrs[relationKey]);
        const recordId = getEntryId(entry, attrs);
        if (!userId || !recordId) return null;
        return { userId, recordId };
      })
      .filter(Boolean) as UserActionEntry[];

  // Load current friends and their posts
  useEffect(() => {
    const load = async () => {
      if (!user) {
        setIncomingRequests([]);
        setOutgoingRequests([]);
        setRequestsLoading(false);
        setRequestsError(null);
        setLoading(false);
        return;
      }
      setLoading(true);
      setRequestsLoading(true);
      setError(null);
      setActionError(null);
      setRequestsError(null);
      setActionNotice(null);
      try {
        const [blockResult, muteResult] = await Promise.allSettled([
          api.get("/user-blocks?populate=blocked&pagination[pageSize]=200"),
          api.get("/user-mutes?populate=muted&pagination[pageSize]=200"),
        ]);

        if (blockResult.status === "fulfilled") {
          setBlockEntries(parseActionEntries(blockResult.value.data?.data ?? [], "blocked"));
        }
        if (muteResult.status === "fulfilled") {
          setMuteEntries(parseActionEntries(muteResult.value.data?.data ?? [], "muted"));
        }
        if (blockResult.status === "rejected" || muteResult.status === "rejected") {
          const missing: string[] = [];
          if (blockResult.status === "rejected") missing.push("blocked users");
          if (muteResult.status === "rejected") missing.push("muted users");
          setActionError(`Unable to load ${missing.join(" and ")}.`);
        }

        const friendsRes = await api.get(
          `/friends?filters[$or][0][requester][id][$eq]=${user.id}&filters[$or][1][target][id][$eq]=${user.id}&populate=requester&populate=target`
        );
        const friendRows = friendsRes.data?.data ?? [];
        const mappedFriends: FriendRelation[] = friendRows.map((f: any) => {
          const attrs = normalize(f);
          return {
            id: f.id ?? attrs.documentId,
            idNumber: f.id ?? undefined,
            docId: attrs.documentId,
            requesterId: getEntityId(attrs.requester),
            targetId: getEntityId(attrs.target),
            status: attrs.status || "pending",
            requesterFavorite: Boolean(attrs.requesterFavorite),
            targetFavorite: Boolean(attrs.targetFavorite),
          };
        });
        const mappedRequests: FriendRequestItem[] = friendRows
          .map((f: any) => {
            const attrs = normalize(f);
            const status = String(attrs.status || "pending");
            if (status !== "pending") return null;
            const requesterId = getEntityId(attrs.requester);
            const targetId = getEntityId(attrs.target);
            const rowId = f.id ?? attrs.documentId;
            if (!rowId) return null;
            const requesterAttrs = getEntityAttrs(attrs.requester);
            const targetAttrs = getEntityAttrs(attrs.target);
            return {
              id: rowId,
              idNumber: typeof f.id === "number" ? f.id : undefined,
              docId: typeof attrs.documentId === "string" ? attrs.documentId : undefined,
              requesterId,
              requesterName: getUserDisplayName(attrs.requester),
              requesterHandle: getUserHandle(attrs.requester),
              requesterAvatarUrl: pickMediaUrl(requesterAttrs?.avatar, { kind: "avatar" }),
              targetId,
              targetName: getUserDisplayName(attrs.target),
              targetHandle: getUserHandle(attrs.target),
              targetAvatarUrl: pickMediaUrl(targetAttrs?.avatar, { kind: "avatar" }),
              createdAt: String(attrs.createdAt || ""),
            } satisfies FriendRequestItem;
          })
          .filter(Boolean) as FriendRequestItem[];
        setIncomingRequests(
          mappedRequests.filter((request) => request.targetId === user.id)
        );
        setOutgoingRequests(
          mappedRequests.filter((request) => request.requesterId === user.id)
        );

        const acceptedIds = new Set<number>();
        const relationByUserId = new Map<number, FriendRelation>();
        mappedFriends.forEach((relation) => {
          if (relation.status !== "accepted") return;
          const otherId =
            relation.requesterId === user.id ? relation.targetId : relation.requesterId;
          if (otherId) {
            acceptedIds.add(otherId);
            relationByUserId.set(otherId, relation);
          }
        });

        const friendIds = Array.from(acceptedIds);
        if (!friendIds.length) {
          setProfiles([]);
          setPostsByOwner({});
          return;
        }

        const friendFilter = friendIds
          .map((id, index) => `filters[user][id][$in][${index}]=${id}`)
          .join("&");
        await ensureProfileKeyShares(user.id, friendIds);

        const profilesRes = await api.get(
          `/profiles?${friendFilter}&populate[0]=user&populate[1]=avatar&pagination[pageSize]=200`
        );
        const mappedProfiles = await Promise.all(
          (profilesRes.data?.data ?? []).map(async (p: any) => {
            const attrs = normalize(p);
            const friendUserId = getEntityId(attrs.user);
            if (!friendUserId) return null;
            let payload: ProfilePayload | null = null;
            if (attrs.encryptedProfile) {
              try {
                payload = await decryptFriendProfilePayload(
                  friendUserId,
                  user.id,
                  attrs.encryptedProfile
                );
              } catch {
                payload = null;
              }
            }
            const basePayload = buildProfilePayloadFromAttrs(attrs);
            if (payload) {
              payload = { ...basePayload, ...payload };
            } else {
              payload = basePayload;
            }
            const profileVisibility = normalizeProfileVisibility(
              payload.profileVisibility
            );
            const privacySettings = normalizePrivacySettings(payload.privacySettings);
            const activityVisibility = normalizeVisibility(
              payload.activityVisibility,
              "public"
            );
            const showPhoneOnProfile =
              typeof attrs.showPhoneOnProfile === "boolean" ? attrs.showPhoneOnProfile : false;
            const relation = relationByUserId.get(friendUserId);
            const isFavorite =
              relation?.requesterId === user.id
                ? Boolean(relation?.requesterFavorite)
                : Boolean(relation?.targetFavorite);
            return {
              id: p.id ?? attrs.documentId,
              userId: friendUserId,
              firstName: payload.firstName || "",
              lastName: payload.lastName || "",
              age: payload.age || "",
              birthday: payload.birthday || "",
              gender: payload.gender || "",
              religion: payload.religion || "",
              country: payload.country || "",
              state: payload.state || "",
              city: payload.city || "",
              hobbies: payload.hobbies || "",
              occupation: payload.occupation || "",
              phone: payload.phone || "",
              showPhoneOnProfile,
              handle: attrs.handle || `user-${p.id ?? attrs.documentId}`,
              bio: payload.bio || "",
              avatarUrl: pickMediaUrl(attrs.avatar, { kind: "avatar" }),
              profileVisibility,
              privacySettings,
              activityVisibility,
              lastSeenAt: payload.lastSeenAt,
              favorite: isFavorite,
              relationId: relation?.id,
              relationDocId: relation?.docId,
              relationIdNumber: relation?.idNumber,
              relationRequesterId: relation?.requesterId,
              relationTargetId: relation?.targetId,
            } as FriendProfile;
          })
        );
        setProfiles(mappedProfiles.filter(Boolean) as FriendProfile[]);

        const ownerFilter = friendIds
          .map((id, index) => `filters[owner][id][$in][${index}]=${id}`)
          .join("&");
        const postsRes = await api.get(
          `/users-posts?${ownerFilter}&populate=Users_Pictures&populate=owner&populate=feedbackTarget&sort=createdAt:desc&pagination[pageSize]=200&publicationState=preview`
        );
        const grouped: Record<number, FriendPost[]> = {};
        (postsRes.data?.data ?? []).forEach((p: any) => {
          const attrs = normalize(p);
          const ownerData = getEntity(attrs.owner);
          const ownerId = getEntityId(ownerData);
          if (!ownerId) return;
          const imageUrl = pickMediaUrl(attrs.Users_Pictures, { kind: "post" });
          const content = attrs.Users_Content || "";
          const feedbackTargetId = getEntityId(attrs.feedbackTarget);
          const feedbackTargetAttrs = getEntityAttrs(attrs.feedbackTarget);
          const feedbackTargetName = feedbackTargetId
            ? feedbackTargetAttrs?.email || `User ${feedbackTargetId}`
            : undefined;
          const linkUrl = extractFirstUrl(content);
          (grouped[ownerId] = grouped[ownerId] || []).push({
            id: p.id ?? attrs.documentId,
            numericId: Number.isFinite(Number(p.id)) ? Number(p.id) : undefined,
            documentId: attrs.documentId ?? p.documentId,
            ownerId,
            ownerName: getUserDisplayName(ownerData),
            title: attrs.Title || "Untitled",
            content,
            imageUrl,
            createdAt: attrs.createdAt,
            linkUrl: linkUrl || undefined,
            feedbackAudience: attrs.feedbackAudience || undefined,
            feedbackTargetId,
            feedbackTargetName,
            likes: Number(attrs.likes ?? 0),
            reactionCounts: attrs.reactionCounts,
            myReaction: attrs.myReaction ?? null,
            shares: Number(attrs.shares ?? 0),
            visibility: attrs.visibility || undefined,
          });
        });
        Object.values(grouped).forEach((list) => {
          list.sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bTime - aTime;
          });
        });
        setPostsByOwner(grouped);
      } catch {
        setError("Failed to load friends.");
      } finally {
        setLoading(false);
        setRequestsLoading(false);
      }
    };
    load();
  }, [refreshToken, user]);

  const presenceIds = useMemo(
    () =>
      Array.from(
        new Set(
          profiles
            .map((profile) => profile.userId)
            .filter((id): id is number => Number.isFinite(id))
        )
      ),
    [profiles]
  );

  useEffect(() => {
    setPresenceTargets(presenceIds);
  }, [presenceIds, setPresenceTargets]);

  const filteredFriends = useMemo(() => {
    const q = normalizeFriendSearch(friendQuery);
    const base = q
      ? profiles.filter((friend) => {
          const handle = normalizeFriendSearch(friend.handle || "");
          const first = normalizeFriendSearch(friend.firstName || "");
          const last = normalizeFriendSearch(friend.lastName || "");
          const full = normalizeFriendSearch(
            `${friend.firstName || ""} ${friend.lastName || ""}`
          );
          return (
            handle.includes(q) ||
            first.includes(q) ||
            last.includes(q) ||
            full.includes(q)
          );
        })
      : profiles;
    return [...base].sort((a, b) => {
      const aFav = Boolean(a.favorite);
      const bFav = Boolean(b.favorite);
      if (aFav !== bFav) return aFav ? -1 : 1;
      const aName =
        `${a.firstName || ""} ${a.lastName || ""}`.trim() ||
        a.handle ||
        "";
      const bName =
        `${b.firstName || ""} ${b.lastName || ""}`.trim() ||
        b.handle ||
        "";
      return aName.localeCompare(bName);
    });
  }, [profiles, friendQuery]);

  const totalFriendPages = Math.max(
    1,
    Math.ceil(filteredFriends.length / FRIENDS_PAGE_SIZE)
  );
  const pagedFriends = useMemo(() => {
    const start = (friendPage - 1) * FRIENDS_PAGE_SIZE;
    return filteredFriends.slice(start, start + FRIENDS_PAGE_SIZE);
  }, [filteredFriends, friendPage]);

  useEffect(() => {
    setFriendPage(1);
  }, [friendQuery]);

  useEffect(() => {
    if (friendPage > totalFriendPages) {
      setFriendPage(totalFriendPages);
    }
  }, [friendPage, totalFriendPages]);

  useEffect(() => {
    if (!filteredFriends.length) {
      setSelectedFriendId(null);
      return;
    }
    const hasSelected = filteredFriends.some((friend) => friend.userId === selectedFriendId);
    if (!hasSelected) {
      setSelectedFriendId(filteredFriends[0].userId ?? null);
    }
  }, [filteredFriends, selectedFriendId]);

  useEffect(() => {
    setActionNotice(null);
  }, [selectedFriendId]);

  const selectedFriend = useMemo(() => {
    if (!selectedFriendId) return null;
    return profiles.find((profile) => profile.userId === selectedFriendId) || null;
  }, [profiles, selectedFriendId]);
  const filteredFriendMedia = useMemo(() => {
    if (friendMediaTab === "all") return friendMedia;
    return friendMedia.filter((item) => {
      const kind = item.kind || (item.media && isVideoUrl(item.media) ? "video" : "photo");
      return kind === friendMediaTab;
    });
  }, [friendMedia, friendMediaTab]);
  const activeMediaItem = mediaLightboxOpen
    ? mediaLightboxItems[mediaLightboxIndex]
    : null;

  const openMediaLightboxAt = (index: number) => {
    if (!filteredFriendMedia.length) return;
    setMediaLightboxItems(filteredFriendMedia);
    setMediaLightboxIndex(index);
    setMediaLightboxOpen(true);
  };

  const closeMediaLightbox = () => {
    setMediaLightboxOpen(false);
  };

  useEffect(() => {
    if (!mediaLightboxOpen) return;
    if (mediaLightboxItems.length === 0) return;
    if (mediaLightboxIndex >= mediaLightboxItems.length) {
      setMediaLightboxIndex(0);
    }
  }, [mediaLightboxIndex, mediaLightboxItems.length, mediaLightboxOpen]);

  useEffect(() => {
    if (!mediaLightboxOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMediaLightboxOpen(false);
        return;
      }
      if (mediaLightboxItems.length < 2) return;
      if (event.key === "ArrowRight") {
        setMediaLightboxIndex((prev) =>
          (prev + 1) % mediaLightboxItems.length
        );
      }
      if (event.key === "ArrowLeft") {
        setMediaLightboxIndex((prev) =>
          (prev - 1 + mediaLightboxItems.length) % mediaLightboxItems.length
        );
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mediaLightboxItems.length, mediaLightboxOpen]);

  useEffect(() => {
    if (!mediaLightboxOpen || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mediaLightboxOpen]);
  const selectedVisibility = normalizeProfileVisibility(
    selectedFriend?.profileVisibility
  );
  const selectedPrivacy = normalizePrivacySettings(selectedFriend?.privacySettings);
  const selectedAudience: "public" | "followers" = "followers";
  const selectedBioVisibility = resolveFieldVisibility(
    selectedVisibility,
    selectedPrivacy,
    "bio",
    "public"
  );
  const canShowSelectedBio =
    selectedVisibility !== "private" && canView(selectedAudience, selectedBioVisibility);
  const selectedActivityVisibility = normalizeVisibility(
    selectedFriend?.activityVisibility,
    "public"
  );
  const canShowSelectedActivity =
    selectedVisibility !== "private" &&
    canView(selectedAudience, selectedActivityVisibility);
  const selectedOnline = selectedFriend?.userId
    ? onlineUserIds.has(selectedFriend.userId)
    : false;
  const selectedActivityLabel = selectedOnline
    ? "Active now"
    : formatLastSeen(selectedFriend?.lastSeenAt);

  const selectedPosts =
    selectedFriend?.userId && postsByOwner[selectedFriend.userId]
      ? postsByOwner[selectedFriend.userId]
      : [];
  const blockedEntry = selectedFriend?.userId
    ? blockEntries.find((entry) => entry.userId === selectedFriend.userId) || null
    : null;
  const mutedEntry = selectedFriend?.userId
    ? muteEntries.find((entry) => entry.userId === selectedFriend.userId) || null
    : null;
  const isBlocked = Boolean(blockedEntry);
  const isMuted = Boolean(mutedEntry);
  const canViewPosts = !isBlocked && !isMuted;

  const renderAvatar = (profile?: FriendProfile, size = 44) => {
    const handle = profile?.handle || "User";
    const isOnline = profile?.userId ? onlineUserIds.has(profile.userId) : false;
    const profileVisibility = normalizeProfileVisibility(profile?.profileVisibility);
    const activityVisibility = normalizeVisibility(profile?.activityVisibility, "public");
    const canShowActivity =
      profileVisibility !== "private" && canView("followers", activityVisibility);
    const statusLabel = isOnline ? "Active now" : "Offline";
    const avatar = profile?.avatarUrl ? (
      <img
        src={profile.avatarUrl}
        alt={handle}
        className="friend-avatar"
        style={{ width: size, height: size }}
        loading="lazy"
        decoding="async"
      />
    ) : (
      <div
        className="friend-avatar fallback"
        aria-hidden="true"
        style={{ width: size, height: size }}
      >
        {handle.charAt(0).toUpperCase()}
      </div>
    );
    return (
      <span className="presence-avatar" style={{ width: size, height: size }}>
        {avatar}
        {canShowActivity && (
          <span
            className={`presence-dot ${isOnline ? "is-online" : "is-offline"}`}
            title={statusLabel}
            aria-label={statusLabel}
          />
        )}
      </span>
    );
  };

  const toInvitee = (profile: FriendProfile): VideoCallInvitee => {
    const name = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
    const handle = profile.handle || "friend";
    return {
      userId: profile.userId || 0,
      displayName: name || handle,
      handle,
      avatarUrl: profile.avatarUrl,
    };
  };

  const isUserBlocked = (userId?: number) =>
    typeof userId === "number" &&
    blockEntries.some((entry) => entry.userId === userId);

  const handleOpenChat = (profile: FriendProfile) => {
    if (!profile.userId) return;
    if (isUserBlocked(profile.userId)) {
      setActionNotice("Unblock this user to start a chat.");
      return;
    }
    openChat({
      userId: profile.userId,
      handle: profile.handle,
      firstName: profile.firstName,
      lastName: profile.lastName,
      avatarUrl: profile.avatarUrl,
    });
  };

  const handleSelectFriend = (profile: FriendProfile) => {
    if (!profile.userId) return;
    setSelectedFriendId(profile.userId);
  };

  const handleVideoCall = (profile: FriendProfile) => {
    if (!profile.userId) return;
    if (isUserBlocked(profile.userId)) {
      setActionNotice("Unblock this user to start a video call.");
      return;
    }
    openCallComposer([toInvitee(profile)]);
  };

  const handleToggleFavorite = async (profile: FriendProfile) => {
    if (!profile.userId || !user) return;
    const isRequester = profile.relationRequesterId === user.id;
    const isTarget = profile.relationTargetId === user.id;
    if (!isRequester && !isTarget) return;
    const nextFavorite = !profile.favorite;
    const payload = {
      data: {
        ...(isRequester ? { requesterFavorite: nextFavorite } : {}),
        ...(isTarget ? { targetFavorite: nextFavorite } : {}),
      },
    };
    const attempts: string[] = [];
    if (profile.relationIdNumber) attempts.push(`/friends/${profile.relationIdNumber}`);
    if (profile.relationDocId) attempts.push(`/friends/${profile.relationDocId}?locale=en`);
    if (!attempts.length && profile.relationId) attempts.push(`/friends/${profile.relationId}`);
    if (!attempts.length) return;
    setActionError(null);
    setActionNotice(null);
    try {
      let updated = false;
      for (const path of attempts) {
        try {
          await api.put(path, payload);
          updated = true;
          break;
        } catch (err: any) {
          if (err?.response?.status !== 404) throw err;
        }
      }
      if (!updated) throw new Error("Update failed");
      setProfiles((prev) =>
        prev.map((entry) =>
          entry.userId === profile.userId
            ? { ...entry, favorite: nextFavorite }
            : entry
        )
      );
      setActionNotice(nextFavorite ? "Favorite added." : "Favorite removed.");
    } catch {
      setActionError("Unable to update favorite.");
    }
  };

  const friendRequestActionKey = (prefix: string, request: FriendRequestItem) =>
    `${prefix}-${String(request.id)}`;

  const getFriendRequestUpdateTargets = (request: FriendRequestItem) => {
    const attempts: string[] = [];
    if (request.idNumber) attempts.push(`/friends/${request.idNumber}`);
    if (request.docId) attempts.push(`/friends/${request.docId}?locale=en`);
    if (!attempts.length && request.id) attempts.push(`/friends/${request.id}`);
    return attempts;
  };

  const clearFriendRequestBusy = (key: string) => {
    setRequestActionBusy((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const handleAcceptRequest = async (request: FriendRequestItem) => {
    if (!user) return;
    const key = friendRequestActionKey("accept", request);
    if (requestActionBusy[key]) return;
    setRequestActionBusy((prev) => ({ ...prev, [key]: true }));
    setRequestsError(null);
    setRequestNotice(null);
    try {
      const payload = { data: { status: "accepted", locale: "en" } };
      const attempts = getFriendRequestUpdateTargets(request);
      if (!attempts.length) throw new Error("Missing request target");
      let updated = false;
      for (const path of attempts) {
        try {
          await api.put(path, payload);
          updated = true;
          break;
        } catch (err: any) {
          if (err?.response?.status !== 404) throw err;
        }
      }
      if (!updated) throw new Error("Update failed");
      if (request.requesterId) {
        try {
          await ensureProfileKeyShares(user.id, [request.requesterId]);
        } catch {
          // ignore key-share errors here
        }
      }
      setRequestNotice(`${request.requesterName} is now your friend.`);
      setRefreshToken((prev) => prev + 1);
    } catch {
      setRequestsError("Unable to accept friend request.");
    } finally {
      clearFriendRequestBusy(key);
    }
  };

  const handleRemoveRequest = async (
    request: FriendRequestItem,
    direction: "incoming" | "outgoing"
  ) => {
    const key = friendRequestActionKey(`remove-${direction}`, request);
    if (requestActionBusy[key]) return;
    setRequestActionBusy((prev) => ({ ...prev, [key]: true }));
    setRequestsError(null);
    setRequestNotice(null);
    try {
      const attempts = getFriendRequestUpdateTargets(request);
      if (!attempts.length) throw new Error("Missing request target");
      let removed = false;
      for (const path of attempts) {
        try {
          await api.delete(path);
          removed = true;
          break;
        } catch (err: any) {
          if (err?.response?.status !== 404) throw err;
        }
      }
      if (!removed) throw new Error("Delete failed");
      setRequestNotice(
        direction === "incoming" ? "Friend request declined." : "Friend request canceled."
      );
      setRefreshToken((prev) => prev + 1);
    } catch {
      setRequestsError(
        direction === "incoming"
          ? "Unable to decline friend request."
          : "Unable to cancel friend request."
      );
    } finally {
      clearFriendRequestBusy(key);
    }
  };

  const renderRequestAvatar = (name: string, avatarUrl?: string) => {
    if (avatarUrl) {
      return (
        <img
          src={avatarUrl}
          alt={name}
          className="friend-request-avatar"
          loading="lazy"
          decoding="async"
        />
      );
    }
    const initial = (name || "U").trim().charAt(0).toUpperCase() || "U";
    return (
      <div className="friend-request-avatar fallback" aria-hidden="true">
        {initial}
      </div>
    );
  };

  const handleShowProfile = () => {
    if (!selectedFriend?.userId) return;
    navigate(`/friends/${selectedFriend.userId}`);
  };

  useEffect(() => {
    const loadMedia = async () => {
      if (!selectedFriend?.userId) {
        setFriendMedia([]);
        return;
      }
      setFriendMediaLoading(true);
      setFriendMediaError(null);
      try {
        const res = await api.get(
          `/profile-media-items?filters[owner][id][$eq]=${selectedFriend.userId}` +
            `&populate=media&sort=createdAt:desc&pagination[pageSize]=200`
        );
        const items = (res.data?.data ?? []).map(normalizeFriendMedia);
        setFriendMedia(items);
      } catch {
        setFriendMediaError("Unable to load gallery for this friend.");
      } finally {
        setFriendMediaLoading(false);
      }
    };

    void loadMedia();
  }, [selectedFriend?.userId]);

  const renderSidebarContent = () => (
    <div className="friends-sidebar">
      <button
        className="btn ghost sidebar-nav-link friends-sidebar-dashboard"
        type="button"
        data-accent="dashboard"
        onClick={() => navigate("/dashboard")}
      >
        <span className="sidebar-nav-icon" aria-hidden="true">
          <LayoutDashboard size={18} />
        </span>
        <span>My Dashboard</span>
      </button>
      <section className="panel friends-sidebar-panel">
        <div className="panel-header friend-panel-header">
          <div>
            <p className="eyebrow">Friends</p>
          </div>
        </div>
        {!loading && profiles.length > 0 && (
          <div className="friend-search">
            <label className="friend-search-label" htmlFor="friend-search-input">
              Search Friends
            </label>
            <input
              id="friend-search-input"
              className="friend-search-input"
              type="search"
              value={friendQuery}
              onChange={(e) => setFriendQuery(e.target.value)}
              placeholder="Find Your Friends"
            />
          </div>
        )}
        {loading ? (
          <p className="status">Loading friends...</p>
        ) : profiles.length === 0 ? (
          <p className="status">No friends yet.</p>
        ) : filteredFriends.length === 0 ? (
          <p className="status">No friends match your search.</p>
        ) : (
          <>
            <ul className="friend-mini-list">
              {pagedFriends.map((friend) => {
                const name = `${friend.firstName || ""} ${friend.lastName || ""}`.trim();
                const handle = friend.handle || "friend";
                const displayName = name || handle;
                const isActive = friend.userId === selectedFriendId;
                return (
                  <li key={friend.id} className="friend-mini-item">
                    <button
                      className={`friend-mini-button${isActive ? " is-active" : ""}`}
                      type="button"
                      onClick={() => handleSelectFriend(friend)}
                    >
                      {renderAvatar(friend, 32)}
                      <span className="friend-mini-meta">
                        <span className="friend-mini-name">{displayName}</span>
                        {name && handle ? (
                          <span className="friend-mini-tag">@{handle}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {totalFriendPages > 1 && (
              <div className="friend-pagination">
                <button
                  className="friend-page-btn"
                  type="button"
                  onClick={() => setFriendPage((prev) => Math.max(1, prev - 1))}
                  disabled={friendPage <= 1}
                >
                  Prev
                </button>
                {Array.from({ length: totalFriendPages }, (_, index) => index + 1).map(
                  (page) => (
                    <button
                      key={page}
                      className={`friend-page-btn${
                        page === friendPage ? " is-active" : ""
                      }`}
                      type="button"
                      onClick={() => setFriendPage(page)}
                    >
                      {page}
                    </button>
                  )
                )}
                <button
                  className="friend-page-btn"
                  type="button"
                  onClick={() =>
                    setFriendPage((prev) => Math.min(totalFriendPages, prev + 1))
                  }
                  disabled={friendPage >= totalFriendPages}
                >
                  Next
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );

  return (
    <div className="dashboard-shell friends-page" style={getBackgroundStyle("friends")}>
      <Sidebar
        active="friends"
        hideNavLinks
        hideBio
        sidebarContent={renderSidebarContent()}
      />

      <div className="main-content">
        <TopbarSearch value={query} onChange={setQuery} />

        {error && <p className="status status-error">{error}</p>}
        <section className="panel friend-requests-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Connections</p>
              <h3>Friend Requests</h3>
            </div>
          </div>
          {requestsError && <p className="status status-error">{requestsError}</p>}
          {requestNotice && <p className="status">{requestNotice}</p>}
          {requestsLoading ? (
            <p className="status">Loading friend requests...</p>
          ) : incomingRequests.length === 0 && outgoingRequests.length === 0 ? (
            <p className="status">No pending friend requests.</p>
          ) : (
            <div className="friend-requests-sections">
              {incomingRequests.length > 0 && (
                <section className="friend-requests-group">
                  <h4>Incoming</h4>
                  <ul className="friend-requests-list">
                    {incomingRequests.map((request) => {
                      const acceptKey = friendRequestActionKey("accept", request);
                      const removeKey = friendRequestActionKey("remove-incoming", request);
                      const accepting = Boolean(requestActionBusy[acceptKey]);
                      const removing = Boolean(requestActionBusy[removeKey]);
                      const busy = accepting || removing;
                      return (
                        <li key={`incoming-${String(request.id)}`} className="friend-request-item">
                          <div className="friend-request-main">
                            {renderRequestAvatar(
                              request.requesterName,
                              request.requesterAvatarUrl
                            )}
                            <div className="friend-request-meta">
                              <strong>{request.requesterName}</strong>
                              {request.requesterHandle ? (
                                <span>@{request.requesterHandle}</span>
                              ) : null}
                            </div>
                          </div>
                          <div className="friend-request-actions">
                            <button
                              type="button"
                              className="btn primary tiny"
                              onClick={() => void handleAcceptRequest(request)}
                              disabled={busy}
                            >
                              {accepting ? "Accepting..." : "Accept"}
                            </button>
                            <button
                              type="button"
                              className="btn ghost tiny"
                              onClick={() => void handleRemoveRequest(request, "incoming")}
                              disabled={busy}
                            >
                              {removing ? "Declining..." : "Decline"}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              {outgoingRequests.length > 0 && (
                <section className="friend-requests-group">
                  <h4>Outgoing</h4>
                  <ul className="friend-requests-list">
                    {outgoingRequests.map((request) => {
                      const removeKey = friendRequestActionKey("remove-outgoing", request);
                      const removing = Boolean(requestActionBusy[removeKey]);
                      return (
                        <li key={`outgoing-${String(request.id)}`} className="friend-request-item">
                          <div className="friend-request-main">
                            {renderRequestAvatar(
                              request.targetName,
                              request.targetAvatarUrl
                            )}
                            <div className="friend-request-meta">
                              <strong>{request.targetName}</strong>
                              {request.targetHandle ? (
                                <span>@{request.targetHandle}</span>
                              ) : null}
                            </div>
                          </div>
                          <div className="friend-request-actions">
                            <button
                              type="button"
                              className="btn ghost tiny"
                              onClick={() => void handleRemoveRequest(request, "outgoing")}
                              disabled={removing}
                            >
                              {removing ? "Canceling..." : "Cancel"}
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
            </div>
          )}
        </section>

        <div className="friends-spotlight-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Spotlight</p>
                <h3>Friend Activity</h3>
              </div>
            </div>
            {!selectedFriend ? (
              <p className="status">Select a friend to see their recent posts.</p>
            ) : (
              <div className="friend-detail">
                <div className="friend-header">
                  {renderAvatar(selectedFriend, 48)}
                  <div className="friend-header-meta">
                    <div className="friend-header-title">
                      <strong>
                        {`${selectedFriend.firstName || ""} ${selectedFriend.lastName || ""}`.trim() ||
                          `@${selectedFriend.handle || "friend"}`}
                      </strong>
                      <button
                        className={`friend-favorite-star${
                          selectedFriend.favorite ? " is-active" : ""
                        }`}
                        type="button"
                        onClick={() => handleToggleFavorite(selectedFriend)}
                        aria-label={
                          selectedFriend.favorite
                            ? "Remove favorite"
                            : "Mark as favorite"
                        }
                        title={
                          selectedFriend.favorite
                            ? "Remove favorite"
                            : "Mark as favorite"
                        }
                        disabled={isBlocked}
                      >
                        <span aria-hidden="true">
                          {selectedFriend.favorite ? "★" : "☆"}
                        </span>
                      </button>
                    </div>
                    <span className="friend-name">
                      @{selectedFriend.handle || "friend"}
                    </span>
                    {canShowSelectedActivity && (
                      <span className="friend-activity">{selectedActivityLabel}</span>
                    )}
                    {(isBlocked || isMuted) && (
                      <div className="friend-status-row">
                        {isBlocked && <span className="friend-status-pill is-blocked">Blocked</span>}
                        {isMuted && <span className="friend-status-pill is-muted">Muted</span>}
                      </div>
                    )}
                  </div>
                </div>
                <p className="comment-body">
                  {canShowSelectedBio
                    ? selectedFriend.bio || "No bio yet."
                    : "Bio hidden by privacy settings."}
                </p>
                <div className="friend-detail-actions">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => handleOpenChat(selectedFriend)}
                    disabled={isBlocked}
                  >
                    Message
                  </button>
                  <button
                    className="btn ghost friend-video-call"
                    type="button"
                    onClick={() => handleVideoCall(selectedFriend)}
                    disabled={isBlocked}
                  >
                    Video call
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleShowProfile}
                    disabled={!selectedFriend?.userId}
                  >
                    Show Profile
                  </button>
                </div>
                <div className="friend-media">
                  <div className="friend-media__header">
                    <h4>Gallery</h4>
                    <div className="friend-media__tabs">
                      <button
                        type="button"
                        className={`friend-media__tab${
                          friendMediaTab === "all" ? " is-active" : ""
                        }`}
                        onClick={() => setFriendMediaTab("all")}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        className={`friend-media__tab${
                          friendMediaTab === "photo" ? " is-active" : ""
                        }`}
                        onClick={() => setFriendMediaTab("photo")}
                      >
                        Photos
                      </button>
                      <button
                        type="button"
                        className={`friend-media__tab${
                          friendMediaTab === "video" ? " is-active" : ""
                        }`}
                        onClick={() => setFriendMediaTab("video")}
                      >
                        Videos
                      </button>
                    </div>
                  </div>
                  {friendMediaLoading && (
                    <p className="status">Loading gallery...</p>
                  )}
                  {friendMediaError && (
                    <p className="status status-error">{friendMediaError}</p>
                  )}
                  {!friendMediaLoading && filteredFriendMedia.length === 0 && (
                    <p className="status">No gallery items yet.</p>
                  )}
                  {!friendMediaLoading && filteredFriendMedia.length > 0 && (
                    <div className="friend-media__grid">
                      {filteredFriendMedia.map((item, index) => {
                        const isVideo = item.kind === "video" || isVideoUrl(item.media);
                        return (
                          <article key={String(item.id)} className="friend-media__card">
                            <div
                              className={`friend-media__asset${
                                item.media ? " is-interactive" : ""
                              }`}
                              role={item.media ? "button" : undefined}
                              tabIndex={item.media ? 0 : undefined}
                              onClick={(event) => {
                                if (!item.media) return;
                                const target = event.target as HTMLElement;
                                if (
                                  target.closest("button, a, input, select, textarea")
                                ) {
                                  return;
                                }
                                if (
                                  isVideo &&
                                  target.tagName &&
                                  target.tagName.toLowerCase() === "video"
                                ) {
                                  return;
                                }
                                openMediaLightboxAt(index);
                              }}
                              onKeyDown={(event) => {
                                if (!item.media) return;
                                if (event.key === "Enter" || event.key === " ") {
                                  event.preventDefault();
                                  openMediaLightboxAt(index);
                                }
                              }}
                              aria-label="Open media preview"
                            >
                              {item.media ? (
                                isVideo ? (
                                  <video controls preload="metadata">
                                    <source src={item.media} />
                                  </video>
                                ) : (
                                  <img src={item.media} alt={item.title || "Photo"} />
                                )
                              ) : (
                                <div className="friend-media__placeholder">No media</div>
                              )}
                              {item.media && (
                                <button
                                  className="media-lightbox__open"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    openMediaLightboxAt(index);
                                  }}
                                >
                                  View
                                </button>
                              )}
                            </div>
                            <div className="friend-media__meta">
                              <strong>{item.title || (isVideo ? "Video" : "Photo")}</strong>
                              {item.caption && <p>{item.caption}</p>}
                              {item.createdAt && (
                                <span>
                                  {new Date(item.createdAt).toLocaleDateString()}
                                </span>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
                {actionError && <p className="status status-error">{actionError}</p>}
                {actionNotice && <p className="status">{actionNotice}</p>}
                <div className="comments">
                  <div className="friend-posts-header">
                    <p className="eyebrow">Most recent posts</p>
                  </div>
                  {!canViewPosts ? (
                    <p className="status">
                      {isBlocked
                        ? "You blocked this user. Unblock to see posts."
                        : "Muted: posts hidden."}
                    </p>
                  ) : selectedPosts.length ? (
                    <FriendPostsFeed
                      key={selectedFriend?.userId ?? "friend-posts"}
                      posts={selectedPosts}
                      onPostsChange={(updater) => {
                        const userId = selectedFriend?.userId;
                        if (!userId) return;
                        setPostsByOwner((prev) => ({
                          ...prev,
                          [userId]:
                            typeof updater === "function"
                              ? updater(prev[userId] ?? [])
                              : updater,
                        }));
                      }}
                    />
                  ) : (
                    <p className="status">No posts yet.</p>
                  )}
                </div>
                </div>
              )}
          </section>
        </div>

      </div>

      {mediaLightboxOpen && activeMediaItem && (
        <div
          className="media-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeMediaLightbox();
            }
          }}
        >
          <div className="media-lightbox__dialog">
            <div className="media-lightbox__media">
              {activeMediaItem.media ? (
                activeMediaItem.kind === "video" ||
                isVideoUrl(activeMediaItem.media) ? (
                  <video controls autoPlay>
                    <source src={activeMediaItem.media} />
                  </video>
                ) : (
                  <img
                    src={activeMediaItem.media}
                    alt={activeMediaItem.title || "Photo"}
                  />
                )
              ) : (
                <div className="friend-media__placeholder">No media</div>
              )}
              {mediaLightboxItems.length > 1 && (
                <>
                  <button
                    className="media-lightbox__nav media-lightbox__nav--prev"
                    type="button"
                    onClick={() =>
                      setMediaLightboxIndex((prev) =>
                        (prev - 1 + mediaLightboxItems.length) %
                        mediaLightboxItems.length
                      )
                    }
                    aria-label="Previous media"
                  >
                    {"<"}
                  </button>
                  <button
                    className="media-lightbox__nav media-lightbox__nav--next"
                    type="button"
                    onClick={() =>
                      setMediaLightboxIndex((prev) =>
                        (prev + 1) % mediaLightboxItems.length
                      )
                    }
                    aria-label="Next media"
                  >
                    {">"}
                  </button>
                  <div className="media-lightbox__counter">
                    {mediaLightboxIndex + 1} / {mediaLightboxItems.length}
                  </div>
                </>
              )}
            </div>
            <div className="media-lightbox__details">
              <div className="media-lightbox__header">
                <div>
                  <p className="media-lightbox__eyebrow">
                    {activeMediaItem.kind === "video" ||
                    isVideoUrl(activeMediaItem.media)
                      ? "Video"
                      : "Photo"}
                  </p>
                  <h3 className="media-lightbox__title">
                    {activeMediaItem.title ||
                      (activeMediaItem.kind === "video" ? "Video" : "Photo")}
                  </h3>
                </div>
                <button
                  className="media-lightbox__close"
                  type="button"
                  onClick={closeMediaLightbox}
                >
                  Close
                </button>
              </div>
              {activeMediaItem.caption ? (
                <p className="media-lightbox__caption">{activeMediaItem.caption}</p>
              ) : (
                <p className="media-lightbox__caption is-muted">
                  No description yet.
                </p>
              )}
              <div className="media-lightbox__meta">
                {activeMediaItem.visibility && (
                  <span className="media-lightbox__tag">
                    {activeMediaItem.visibility}
                  </span>
                )}
                {activeMediaItem.createdAt && (
                  <span className="media-lightbox__tag">
                    {new Date(activeMediaItem.createdAt).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
