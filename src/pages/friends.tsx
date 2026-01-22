// src/pages/Friends.tsx
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import axios from "axios";
import "../css/dashboard.css";
import "../css/friends.css";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { useVideoCall, type VideoCallInvitee } from "../context/VideoCallContext";
import api from "../api/strapi";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import { usePageMeta } from "../hooks/usePageMeta";
import {
  buildProfilePayloadFromAttrs,
  decryptFriendProfilePayload,
  ensureProfileKeyShares,
  type PrivacySettings,
  type ProfilePayload,
  type ProfileVisibility,
  type VisibilityLevel,
} from "../utils/profile-e2ee";

type FriendPost = {
  id: number | string;
  title: string;
  content: string;
  imageUrl?: string;
  createdAt?: string;
  linkUrl?: string;
  feedbackAudience?: string;
  feedbackTargetId?: number;
  feedbackTargetName?: string;
};

type FriendProfile = {
  id: number | string;
  handle: string;
  bio?: string;
  userId?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  religion?: string;
  hobbies?: string;
  country?: string;
  state?: string;
  city?: string;
  avatarUrl?: string;
  profileVisibility?: ProfileVisibility;
  privacySettings?: PrivacySettings;
  activityVisibility?: VisibilityLevel;
  lastSeenAt?: string;
};

type FriendRelation = {
  id: number | string;
  idNumber?: number;
  docId?: string;
  requesterId?: number;
  targetId?: number;
  status: "pending" | "accepted" | "blocked" | string;
};

type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
};

type UserActionEntry = {
  userId: number;
  recordId: number | string;
};

type ReportReason = "spam" | "harassment" | "hate" | "impersonation" | "other";

const extractFirstUrl = (text: string) => {
  const match = String(text || "").match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (!match) return "";
  let url = match[0].replace(/[),.!?]+$/, "");
  if (url.startsWith("www.")) url = `https://${url}`;
  return url;
};

const hostnameFor = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
};

const isYoutubeUrl = (value: string) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes("youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
};

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

const LinkPreviewCard = ({
  preview,
  url,
  compact = false,
}: {
  preview?: LinkPreview | null;
  url: string;
  compact?: boolean;
}) => {
  const safePreview: LinkPreview =
    preview ?? { url, title: hostnameFor(url), siteName: hostnameFor(url) };
  const title =
    safePreview.title || safePreview.siteName || hostnameFor(url);
  const meta = safePreview.siteName || hostnameFor(url);
  const showBadge = safePreview.type === "video" || isYoutubeUrl(url);
  return (
    <a
      className={`link-preview-card${compact ? " is-compact" : ""}`}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <div className="link-preview-media">
        {safePreview.image ? (
          <img src={safePreview.image} alt={title} loading="lazy" />
        ) : (
          <div className="link-preview-placeholder">LINK</div>
        )}
        {showBadge && <span className="link-preview-badge">Video</span>}
      </div>
      <div className="link-preview-body">
        <p className="link-preview-title">{title}</p>
        {safePreview.description && (
          <p className="link-preview-desc">{safePreview.description}</p>
        )}
        <span className="link-preview-url">{meta}</span>
      </div>
    </a>
  );
};

const feedbackLabelFor = (post: FriendPost) => {
  const audience = post.feedbackAudience;
  if (!audience || audience === "none") return "";
  if (audience === "public") return "Feedback: Public";
  if (audience === "friends") return "Feedback: Friends";
  if (audience === "specific") {
    return `Feedback: ${post.feedbackTargetName || "You"}`;
  }
  return "";
};

export default function Friends() {
  const { user } = useAuth();
  const { openChat } = useChat();
  const { openCallComposer, onlineUserIds, setPresenceTargets } = useVideoCall();
  const { getBackgroundStyle } = useUserPreferences();
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
  const [selectedFriendId, setSelectedFriendId] = useState<number | null>(null);
  const [showAllPosts, setShowAllPosts] = useState(false);
  const allPostsRef = useRef<HTMLDivElement | null>(null);
  const [linkPreviews, setLinkPreviews] = useState<Record<string, LinkPreview | null>>({});
  const linkPreviewsRef = useRef(linkPreviews);

  useEffect(() => {
    linkPreviewsRef.current = linkPreviews;
  }, [linkPreviews]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockEntries, setBlockEntries] = useState<UserActionEntry[]>([]);
  const [muteEntries, setMuteEntries] = useState<UserActionEntry[]>([]);
  const [actionBusy, setActionBusy] = useState<"block" | "mute" | "report" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("other");
  const [reportDetails, setReportDetails] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);

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
  const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");
  const pickMediaUrl = (mediaField: any): string | undefined => {
    if (!mediaField) return undefined;
    const candidate =
      (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ??
      (Array.isArray(mediaField) ? mediaField[0] : mediaField);
    if (!candidate) return undefined;
    const attrs = normalize(candidate);
    let url =
      attrs.url ||
      attrs.formats?.large?.url ||
      attrs.formats?.medium?.url ||
      attrs.formats?.small?.url ||
      attrs.formats?.thumbnail?.url;
    if (!url) return undefined;
    return url.startsWith("/") ? `${apiBase}${url}` : url;
  };
  const getEntryId = (entry: any, attrs: any) =>
    entry?.id ?? attrs?.documentId ?? entry?.documentId;
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
  const getErrorMessage = (err: unknown, fallback: string) => {
    if (axios.isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { message?: string }; message?: string }
        | undefined;
      return data?.error?.message || data?.message || fallback;
    }
    return fallback;
  };

  const fetchLinkPreview = useCallback(async (url: string) => {
    if (!url) return;
    if (linkPreviewsRef.current[url] !== undefined) return;
    try {
      const res = await api.get("/link-preview", { params: { url } });
      const data = res.data?.data;
      const preview = data?.url
        ? {
            url: data.url,
            title: data.title,
            description: data.description,
            image: data.image,
            siteName: data.siteName,
            type: data.type,
          }
        : null;
      setLinkPreviews((prev) =>
        prev[url] !== undefined ? prev : { ...prev, [url]: preview }
      );
    } catch {
      setLinkPreviews((prev) =>
        prev[url] !== undefined ? prev : { ...prev, [url]: null }
      );
    }
  }, []);

  // Load current friends and their posts
  useEffect(() => {
    const load = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      setActionError(null);
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
        const mappedFriends: FriendRelation[] = (friendsRes.data?.data ?? []).map((f: any) => {
          const attrs = normalize(f);
          return {
            id: f.id ?? attrs.documentId,
            idNumber: f.id ?? undefined,
            docId: attrs.documentId,
            requesterId: getEntityId(attrs.requester),
            targetId: getEntityId(attrs.target),
            status: attrs.status || "pending",
          };
        });

        const acceptedIds = new Set<number>();
        mappedFriends.forEach((relation) => {
          if (relation.status !== "accepted") return;
          const otherId =
            relation.requesterId === user.id ? relation.targetId : relation.requesterId;
          if (otherId) acceptedIds.add(otherId);
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
            const userAttrs = getEntityAttrs(attrs.user);
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
            return {
              id: p.id ?? attrs.documentId,
              userId: friendUserId,
              username: userAttrs?.username,
              firstName: payload.firstName || "",
              lastName: payload.lastName || "",
              handle: attrs.handle || userAttrs?.username || `user-${p.id ?? attrs.documentId}`,
              bio: payload.bio || "",
              avatarUrl: pickMediaUrl(attrs.avatar),
              profileVisibility,
              privacySettings,
              activityVisibility,
              lastSeenAt: payload.lastSeenAt,
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
        const linkUrls = new Set<string>();
        (postsRes.data?.data ?? []).forEach((p: any) => {
          const attrs = normalize(p);
          const ownerId = getEntityId(attrs.owner);
          if (!ownerId) return;
          const imageUrl = pickMediaUrl(attrs.Users_Pictures);
          const content = attrs.Users_Content || "";
          const feedbackTargetId = getEntityId(attrs.feedbackTarget);
          const feedbackTargetAttrs = getEntityAttrs(attrs.feedbackTarget);
          const feedbackTargetName = feedbackTargetId
            ? feedbackTargetAttrs?.username ||
              feedbackTargetAttrs?.email ||
              `User ${feedbackTargetId}`
            : undefined;
          const linkUrl = extractFirstUrl(content);
          if (linkUrl) linkUrls.add(linkUrl);
          (grouped[ownerId] = grouped[ownerId] || []).push({
            id: p.id ?? attrs.documentId,
            title: attrs.Title || "Untitled",
            content,
            imageUrl,
            createdAt: attrs.createdAt,
            linkUrl: linkUrl || undefined,
            feedbackAudience: attrs.feedbackAudience || undefined,
            feedbackTargetId,
            feedbackTargetName,
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
        linkUrls.forEach((url) => {
          void fetchLinkPreview(url);
        });
      } catch {
        setError("Failed to load friends.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fetchLinkPreview, user]);

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
    if (!q) return profiles;
    return profiles.filter((friend) => {
      const handle = normalizeFriendSearch(friend.handle || friend.username || "");
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
    });
  }, [profiles, friendQuery]);

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
    setReportError(null);
    setReportOpen(false);
  }, [selectedFriendId]);

  const selectedFriend = useMemo(() => {
    if (!selectedFriendId) return null;
    return profiles.find((profile) => profile.userId === selectedFriendId) || null;
  }, [profiles, selectedFriendId]);
  const selectedFriendLabel = selectedFriend
    ? `${selectedFriend.firstName || ""} ${selectedFriend.lastName || ""}`.trim() ||
      `@${selectedFriend.handle || selectedFriend.username || "friend"}`
    : "this user";
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
  const visiblePosts = canViewPosts ? selectedPosts : [];
  const recentPosts = visiblePosts.slice(0, 3);

  useEffect(() => {
    setShowAllPosts(false);
  }, [isBlocked, isMuted, selectedFriendId]);

  const renderAvatar = (profile?: FriendProfile, size = 44) => {
    const handle = profile?.handle || profile?.username || "User";
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
    const handle = profile.handle || profile.username || "friend";
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

  const handleShowAllPosts = () => {
    if (!selectedFriend?.userId || !canViewPosts) return;
    setShowAllPosts(true);
    if (allPostsRef.current) {
      allPostsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const handleToggleBlock = async () => {
    const targetId = selectedFriend?.userId;
    if (!targetId) return;
    setActionError(null);
    setActionNotice(null);
    setActionBusy("block");
    try {
      if (blockedEntry) {
        await api.delete(`/user-blocks/${blockedEntry.recordId}`);
        setBlockEntries((prev) => prev.filter((entry) => entry.userId !== targetId));
        setActionNotice("User unblocked.");
      } else {
        const res = await api.post("/user-blocks", {
          data: { blocked: targetId },
        });
        const created = res.data?.data;
        const recordId = created?.id ?? created?.documentId;
        if (recordId) {
          setBlockEntries((prev) => [...prev, { userId: targetId, recordId }]);
        }
        setActionNotice("User blocked.");
      }
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, "Failed to update block."));
    } finally {
      setActionBusy(null);
    }
  };

  const handleToggleMute = async () => {
    const targetId = selectedFriend?.userId;
    if (!targetId) return;
    setActionError(null);
    setActionNotice(null);
    setActionBusy("mute");
    try {
      if (mutedEntry) {
        await api.delete(`/user-mutes/${mutedEntry.recordId}`);
        setMuteEntries((prev) => prev.filter((entry) => entry.userId !== targetId));
        setActionNotice("User unmuted.");
      } else {
        const res = await api.post("/user-mutes", {
          data: { muted: targetId },
        });
        const created = res.data?.data;
        const recordId = created?.id ?? created?.documentId;
        if (recordId) {
          setMuteEntries((prev) => [...prev, { userId: targetId, recordId }]);
        }
        setActionNotice("User muted.");
      }
    } catch (err: unknown) {
      setActionError(getErrorMessage(err, "Failed to update mute."));
    } finally {
      setActionBusy(null);
    }
  };

  const handleOpenReport = () => {
    if (!selectedFriend?.userId) return;
    setReportReason("other");
    setReportDetails("");
    setReportError(null);
    setReportOpen(true);
  };

  const handleSubmitReport = async () => {
    const targetId = selectedFriend?.userId;
    if (!targetId) return;
    setReportError(null);
    setActionBusy("report");
    try {
      await api.post("/reports", {
        data: {
          targetType: "user",
          targetId: String(targetId),
          reason: reportReason,
          details: reportDetails.trim(),
        },
      });
      setReportOpen(false);
      setReportDetails("");
      setReportReason("other");
      setActionNotice("Report submitted.");
    } catch (err: unknown) {
      setReportError(getErrorMessage(err, "Failed to submit report."));
    } finally {
      setActionBusy(null);
    }
  };

  const renderPostList = (posts: FriendPost[], expanded = false) => (
    <ul className={`comment-list friend-posts-list${expanded ? " is-expanded" : ""}`}>
      {posts.map((post) => {
        const feedbackLabel = feedbackLabelFor(post);
        return (
          <li key={post.id} className="comment-item">
            {post.imageUrl && <img src={post.imageUrl} alt={post.title} className="avatar" />}
            <div className="comment-body">
              <div className="friend-post-title">
                <strong>{post.title}</strong>
                {feedbackLabel && <span className="post-feedback-tag">{feedbackLabel}</span>}
              </div>
              <p>{post.content}</p>
              {post.linkUrl && (
                <div className="friend-link-preview">
                  <LinkPreviewCard preview={linkPreviews[post.linkUrl]} url={post.linkUrl} compact />
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );

  return (
    <div className="dashboard-shell" style={getBackgroundStyle("friends")}>
      <Sidebar active="friends" />

      <div className="main-content">
        <TopbarSearch value={query} onChange={setQuery} />
        <div className="dash-hero">
          <div className="dash-hero__text">
            <p className="eyebrow">Friends</p>
            <h1>Your friends</h1>
            <p className="subhead">
              Pick a friend to preview their latest posts and send a message.
            </p>
          </div>
        </div>

        {error && <p className="status status-error">{error}</p>}

        <div className="panel-grid">
          <section className="panel">
            <div className="panel-header friend-panel-header">
              <div>
                <p className="eyebrow">Friends</p>
                <h3>Current friends</h3>
              </div>
              {!loading && profiles.length > 0 && (
                <button
                  className="btn ghost friend-video-call"
                  type="button"
                  onClick={() => openCallComposer()}
                >
                  Start video call
                </button>
              )}
            </div>
            {!loading && profiles.length > 0 && (
              <div className="friend-search">
                <label className="friend-search-label" htmlFor="friend-search-input">
                  Search friends
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
              <ul className="friend-mini-list">
                {filteredFriends.map((friend) => {
                  const name = `${friend.firstName || ""} ${friend.lastName || ""}`.trim();
                  const handle = friend.handle || friend.username || "friend";
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
                          <span className="friend-mini-name">
                            {displayName}
                            {name && handle ? (
                              <span className="friend-mini-tag">@{handle}</span>
                            ) : null}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Spotlight</p>
                <h3>Friend activity</h3>
              </div>
            </div>
            {!selectedFriend ? (
              <p className="status">Select a friend to see their recent posts.</p>
            ) : (
              <div className="friend-detail">
                <div className="friend-header">
                  {renderAvatar(selectedFriend, 48)}
                  <div className="friend-header-meta">
                    <strong>
                      {`${selectedFriend.firstName || ""} ${selectedFriend.lastName || ""}`.trim() ||
                        `@${selectedFriend.handle || selectedFriend.username || "friend"}`}
                    </strong>
                    <span className="friend-name">
                      @{selectedFriend.handle || selectedFriend.username || "friend"}
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
                    onClick={handleShowAllPosts}
                    disabled={!selectedPosts.length || !canViewPosts}
                  >
                    See All
                  </button>
                </div>
                <div className="friend-safety-actions">
                  <button
                    className="btn ghost friend-action-muted"
                    type="button"
                    onClick={handleToggleMute}
                    disabled={actionBusy === "mute"}
                  >
                    {isMuted ? "Unmute" : "Mute"}
                  </button>
                  <button
                    className="btn ghost friend-action-danger"
                    type="button"
                    onClick={handleToggleBlock}
                    disabled={actionBusy === "block"}
                  >
                    {isBlocked ? "Unblock" : "Block"}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleOpenReport}
                    disabled={actionBusy === "report"}
                  >
                    Report
                  </button>
                </div>
                {actionError && <p className="status status-error">{actionError}</p>}
                {actionNotice && <p className="status">{actionNotice}</p>}
                <div className="comments">
                  <p className="eyebrow">Most recent posts</p>
                  {!canViewPosts ? (
                    <p className="status">
                      {isBlocked
                        ? "You blocked this user. Unblock to see posts."
                        : "Muted: posts hidden."}
                    </p>
                  ) : recentPosts.length ? (
                    renderPostList(recentPosts)
                  ) : (
                    <p className="status">No posts yet.</p>
                  )}
                </div>
                {showAllPosts && canViewPosts && (
                  <div className="comments" ref={allPostsRef}>
                    <p className="eyebrow">All posts</p>
                    {selectedPosts.length ? renderPostList(selectedPosts, true) : (
                      <p className="status">No posts yet.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

      {reportOpen && selectedFriend && (
        <div className="friend-report-overlay" role="dialog" aria-modal="true">
          <div className="friend-report-modal">
            <div className="friend-report-header">
              <div>
                <p className="eyebrow">Report</p>
                <h3>Report {selectedFriendLabel}</h3>
                <p className="friend-report-sub">
                  Help us keep the community safe by sharing the reason.
                </p>
              </div>
              <button
                className="friend-report-close"
                type="button"
                onClick={() => setReportOpen(false)}
                aria-label="Close report"
              >
                Close
              </button>
            </div>
            <div className="friend-report-body">
              <label className="friend-report-label" htmlFor="report-reason">
                Reason
              </label>
              <select
                id="report-reason"
                className="auth-input"
                value={reportReason}
                onChange={(e) => setReportReason(e.target.value as ReportReason)}
              >
                <option value="spam">Spam</option>
                <option value="harassment">Harassment</option>
                <option value="hate">Hate</option>
                <option value="impersonation">Impersonation</option>
                <option value="other">Other</option>
              </select>
              <label className="friend-report-label" htmlFor="report-details">
                Details (optional)
              </label>
              <textarea
                id="report-details"
                className="auth-input friend-report-textarea"
                rows={4}
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value)}
                placeholder="Share context that helps reviewers."
              />
              {reportError && <p className="status status-error">{reportError}</p>}
            </div>
            <div className="friend-report-actions">
              <button
                className="btn ghost"
                type="button"
                onClick={() => setReportOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn primary"
                type="button"
                onClick={handleSubmitReport}
                disabled={actionBusy === "report"}
              >
                {actionBusy === "report" ? "Sending..." : "Submit report"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
