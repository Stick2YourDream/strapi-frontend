// src/pages/Friends.tsx
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "../css/dashboard.css";
import "../css/friends.css";
import "../css/media-lightbox.css";
import "../css/goals-panel.css";
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
import { pickMediaUrl } from "../utils/media";

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

type FriendMediaItem = {
  id: number | string;
  title?: string;
  caption?: string;
  visibility?: "public" | "friends" | "private" | "trusted";
  kind?: "photo" | "video";
  media?: string;
  createdAt?: string;
};

type TrustedCircle = {
  id: number;
  name: string;
};

type TrustedCircleMember = {
  id: number | string;
  userId: number;
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
const faviconFor = (value: string) => {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch {
    return "";
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
const MAX_TRUSTED_CIRCLES = 5;

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

const formatPostDate = (value?: string) => {
  if (!value) return "";
  try {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(value));
  } catch {
    return value;
  }
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
  const fallbackImage = safePreview.image || faviconFor(url);
  const hasImage = Boolean(fallbackImage);
  return (
    <a
      className={`link-preview-card${compact ? " is-compact" : ""}`}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <div className="link-preview-media">
        {hasImage ? (
          <img
            src={fallbackImage}
            alt={title}
            loading="lazy"
            decoding="async"
            className={safePreview.image ? "" : "is-favicon"}
          />
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
  const [showAllPosts, setShowAllPosts] = useState(false);
  const allPostsRef = useRef<HTMLDivElement | null>(null);
  const [linkPreviews, setLinkPreviews] = useState<Record<string, LinkPreview | null>>({});
  const linkPreviewsRef = useRef(linkPreviews);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    linkPreviewsRef.current = linkPreviews;
  }, [linkPreviews]);
  const pushTrustedCircleSuccess = useCallback((message: string) => {
    setTrustedCircleSuccess(message);
    if (trustedCircleSuccessTimeoutRef.current) {
      window.clearTimeout(trustedCircleSuccessTimeoutRef.current);
    }
    trustedCircleSuccessTimeoutRef.current = window.setTimeout(() => {
      setTrustedCircleSuccess(null);
    }, 3000);
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [blockEntries, setBlockEntries] = useState<UserActionEntry[]>([]);
  const [muteEntries, setMuteEntries] = useState<UserActionEntry[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [activePost, setActivePost] = useState<FriendPost | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [trustedCircles, setTrustedCircles] = useState<TrustedCircle[]>([]);
  const [activeTrustedCircleId, setActiveTrustedCircleId] = useState<number | null>(
    null
  );
  const [trustedCircleMembersByGroup, setTrustedCircleMembersByGroup] = useState<
    Record<number, TrustedCircleMember[]>
  >({});
  const [trustedCircleLoading, setTrustedCircleLoading] = useState(false);
  const [trustedCircleBusy, setTrustedCircleBusy] = useState(false);
  const [trustedCircleError, setTrustedCircleError] = useState<string | null>(null);
  const [trustedFriendPicker, setTrustedFriendPicker] = useState("");
  const [trustedCircleName, setTrustedCircleName] = useState("");
  const [trustedCircleRename, setTrustedCircleRename] = useState("");
  const [trustedCircleRenaming, setTrustedCircleRenaming] = useState(false);
  const [trustedCircleSaving, setTrustedCircleSaving] = useState(false);
  const [trustedCircleSuccess, setTrustedCircleSuccess] = useState<string | null>(null);
  const [trustedCircleMenuOpen, setTrustedCircleMenuOpen] = useState(false);
  const [trustedCircleEditing, setTrustedCircleEditing] = useState(false);
  const [pendingTrustedAddIds, setPendingTrustedAddIds] = useState<number[]>([]);
  const [pendingTrustedRemoveIds, setPendingTrustedRemoveIds] = useState<
    Array<string | number>
  >([]);
  const [trustedCircleDeleteOpen, setTrustedCircleDeleteOpen] = useState(false);
  const [trustedCircleDeleteTarget, setTrustedCircleDeleteTarget] =
    useState<TrustedCircle | null>(null);
  const [friendPage, setFriendPage] = useState(1);
  const trustedCircleLoadRef = useRef<number | null>(null);
  const trustedCircleSuccessTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

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
  const getErrorMessage = (err: unknown, fallback: string) => {
    if (axios.isAxiosError(err)) {
      const data = err.response?.data as
        | { error?: { message?: string }; message?: string }
        | undefined;
      return data?.error?.message || data?.message || fallback;
    }
    return fallback;
  };

  const formatFriendLabel = (friend: FriendProfile) => {
    const name = `${friend.firstName || ""} ${friend.lastName || ""}`.trim();
    if (name) return name;
    if (friend.handle) return `@${friend.handle}`;
    return `Friend ${friend.userId || friend.id}`;
  };

  const showCopyToast = useCallback((message: string) => {
    setCopyToast(message);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    toastTimeoutRef.current = setTimeout(() => {
      setCopyToast(null);
    }, 2200);
  }, []);

  const copyToClipboard = useCallback(async (text: string) => {
    if (!text) return false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fallback below.
    }

    if (typeof document === "undefined") return false;
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  }, []);

  const activeTrustedCircle = useMemo(() => {
    if (!trustedCircles.length) return null;
    if (activeTrustedCircleId) {
      return trustedCircles.find((circle) => circle.id === activeTrustedCircleId) ?? null;
    }
    return trustedCircles[0];
  }, [activeTrustedCircleId, trustedCircles]);

  useEffect(() => {
    if (!activeTrustedCircle) {
      setTrustedCircleRename("");
      return;
    }
    setTrustedCircleRename(activeTrustedCircle.name);
  }, [activeTrustedCircle]);

  useEffect(() => {
    setTrustedCircleMenuOpen(false);
    setTrustedCircleEditing(false);
    setPendingTrustedAddIds([]);
    setPendingTrustedRemoveIds([]);
  }, [activeTrustedCircle?.id]);

  const trustedCircleMembers = useMemo(() => {
    if (!activeTrustedCircle?.id) return [];
    return trustedCircleMembersByGroup[activeTrustedCircle.id] ?? [];
  }, [activeTrustedCircle, trustedCircleMembersByGroup]);

  const trustedMemberIds = useMemo(
    () => new Set(trustedCircleMembers.map((member) => member.userId)),
    [trustedCircleMembers]
  );
  const pendingTrustedRemoveSet = useMemo(
    () => new Set(pendingTrustedRemoveIds),
    [pendingTrustedRemoveIds]
  );
  const canEditTrustedCircle =
    trustedCircleEditing || trustedCircleMembers.length === 0;

  const trustedFriendOptions = useMemo(() => {
    return profiles
      .filter((profile) => Number.isFinite(profile.userId ?? NaN))
      .map((profile) => ({
        id: profile.userId as number,
        label: formatFriendLabel(profile),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [profiles]);

  const pendingTrustedAddOptions = useMemo(() => {
    if (!pendingTrustedAddIds.length) return [];
    return trustedFriendOptions.filter(
      (friend) => pendingTrustedAddIds.includes(friend.id) && !trustedMemberIds.has(friend.id)
    );
  }, [pendingTrustedAddIds, trustedFriendOptions, trustedMemberIds]);

  const hasPendingTrustedChanges = useMemo(
    () =>
      pendingTrustedAddIds.some((id) => !trustedMemberIds.has(id)) ||
      pendingTrustedRemoveIds.length > 0,
    [pendingTrustedAddIds, pendingTrustedRemoveIds, trustedMemberIds]
  );

  const refreshTrustedCircleMembers = useCallback(
    async (circleId: number) => {
      const membersRes = await api.get(
        `/trusted-circle-members?filters[circle][id][$eq]=${circleId}&populate=user&pagination[pageSize]=200`
      );
      const members: TrustedCircleMember[] = (membersRes.data?.data ?? [])
        .map((entry: any) => {
          const attrs = normalize(entry);
          const userId = getEntityId(attrs.user);
          const recordId = getEntryId(entry, attrs);
          if (!userId || !recordId) return null;
          return { id: recordId, userId };
        })
        .filter(Boolean) as TrustedCircleMember[];
      setTrustedCircleMembersByGroup((prev) => ({ ...prev, [circleId]: members }));
    },
    [getEntryId, getEntityId]
  );

  const loadTrustedCircles = useCallback(
    async (force = false) => {
      if (!user) {
        setTrustedCircles([]);
        setActiveTrustedCircleId(null);
        setTrustedCircleMembersByGroup({});
        trustedCircleLoadRef.current = null;
        return;
      }
      if (!force && trustedCircleLoadRef.current === user.id) return;
      trustedCircleLoadRef.current = user.id;
      setTrustedCircleLoading(true);
      setTrustedCircleError(null);
      try {
        const circlesRes = await api.get(
          `/trusted-circles?sort=name:asc&pagination[pageSize]=${MAX_TRUSTED_CIRCLES}`
        );
        const entries = circlesRes.data?.data ?? [];
        const circles = entries
          .map((entry: any) => {
            const attrs = normalize(entry);
            const circleId = Number(entry?.id ?? attrs?.documentId ?? attrs?.id);
            if (!Number.isFinite(circleId)) return null;
            return {
              id: circleId,
              name: String(attrs?.name || "Trusted circle"),
            } as TrustedCircle;
          })
          .filter(Boolean) as TrustedCircle[];
        setTrustedCircles(circles);
        setTrustedCircleMembersByGroup((prev) => {
          const next: Record<number, TrustedCircleMember[]> = {};
          circles.forEach((circle) => {
            if (prev[circle.id]) {
              next[circle.id] = prev[circle.id];
            }
          });
          return next;
        });
        setActiveTrustedCircleId((current) => {
          if (current && circles.some((circle) => circle.id === current)) {
            return current;
          }
          return circles[0]?.id ?? null;
        });
      } catch (err) {
        setTrustedCircleError(getErrorMessage(err, "Unable to load trusted circles."));
      } finally {
        setTrustedCircleLoading(false);
      }
    },
    [getErrorMessage, user]
  );

  const createTrustedCircle = useCallback(async () => {
    if (!user) return null;
    const name = trustedCircleName.trim();
    if (!name) {
      setTrustedCircleError("Enter a name for your trusted circle.");
      return null;
    }
    if (trustedCircles.length >= MAX_TRUSTED_CIRCLES) {
      setTrustedCircleError(`You can create up to ${MAX_TRUSTED_CIRCLES} circles.`);
      return null;
    }
    setTrustedCircleBusy(true);
    setTrustedCircleError(null);
    try {
      const res = await api.post("/trusted-circles", {
        data: {
          name,
        },
      });
      const entry = res.data?.data ?? res.data;
      const attrs = normalize(entry);
      const circleId = Number(entry?.id ?? attrs?.documentId ?? attrs?.id);
      if (!Number.isFinite(circleId)) {
        setTrustedCircleError("Unable to create trusted circle.");
        return null;
      }
      const nextCircle = { id: circleId, name: String(attrs?.name || name) };
      setTrustedCircles((prev) => [...prev, nextCircle]);
      setTrustedCircleName("");
      setActiveTrustedCircleId(circleId);
      await refreshTrustedCircleMembers(circleId);
      pushTrustedCircleSuccess(`"${nextCircle.name}" created.`);
      return circleId;
    } catch (err) {
      setTrustedCircleError(getErrorMessage(err, "Unable to create trusted circle."));
      return null;
    } finally {
      setTrustedCircleBusy(false);
    }
  }, [
    getErrorMessage,
    pushTrustedCircleSuccess,
    refreshTrustedCircleMembers,
    trustedCircleName,
    trustedCircles.length,
    user,
  ]);

  const queueTrustedFriend = useCallback(
    (friendId: number) => {
      if (!Number.isFinite(friendId)) return;
      if (trustedMemberIds.has(friendId)) return;
      setTrustedCircleEditing(true);
      setPendingTrustedAddIds((prev) =>
        prev.includes(friendId) ? prev : [...prev, friendId]
      );
    },
    [trustedMemberIds]
  );

  const togglePendingRemoval = useCallback((member: TrustedCircleMember) => {
    setPendingTrustedRemoveIds((prev) =>
      prev.includes(member.id)
        ? prev.filter((id) => id !== member.id)
        : [...prev, member.id]
    );
  }, []);

  const cancelTrustedCircleEdits = useCallback(() => {
    setTrustedCircleEditing(false);
    setPendingTrustedAddIds([]);
    setPendingTrustedRemoveIds([]);
  }, []);

  const applyTrustedCircleChanges = useCallback(async () => {
    if (!activeTrustedCircle?.id) return;
    const circleId = activeTrustedCircle.id;
    const additions = pendingTrustedAddIds.filter((id) => !trustedMemberIds.has(id));
    const removals = trustedCircleMembers.filter((member) =>
      pendingTrustedRemoveSet.has(member.id)
    );
    if (!additions.length && !removals.length) {
      cancelTrustedCircleEdits();
      pushTrustedCircleSuccess("No changes to apply.");
      return;
    }
    setTrustedCircleBusy(true);
    setTrustedCircleError(null);
    try {
      await Promise.all([
        ...additions.map((friendId) =>
          api.post("/trusted-circle-members", {
            data: { circle: circleId, user: friendId },
          })
        ),
        ...removals.map((member) =>
          api.delete(`/trusted-circle-members/${member.id}`)
        ),
      ]);
      await refreshTrustedCircleMembers(circleId);
      setPendingTrustedAddIds([]);
      setPendingTrustedRemoveIds([]);
      setTrustedCircleEditing(false);
      pushTrustedCircleSuccess("Trusted circle updated.");
    } catch (err) {
      const message = getErrorMessage(err, "Unable to update trusted circle.");
      if (message.toLowerCase().includes("already in this circle")) {
        await refreshTrustedCircleMembers(circleId);
        setPendingTrustedAddIds([]);
        setPendingTrustedRemoveIds([]);
        setTrustedCircleEditing(false);
        pushTrustedCircleSuccess("Trusted circle updated.");
      } else {
        setTrustedCircleError(message);
      }
    } finally {
      setTrustedCircleBusy(false);
    }
  }, [
    activeTrustedCircle,
    cancelTrustedCircleEdits,
    getErrorMessage,
    pendingTrustedAddIds,
    pendingTrustedRemoveSet,
    pushTrustedCircleSuccess,
    refreshTrustedCircleMembers,
    trustedCircleMembers,
    trustedMemberIds,
  ]);

  const clearTrustedFriends = useCallback(async () => {
    if (!activeTrustedCircle?.id) return;
    const membersToRemove = trustedCircleMembers.filter(
      (member) => member.userId !== user?.id
    );
    if (!membersToRemove.length) return;
    setTrustedCircleBusy(true);
    setTrustedCircleError(null);
    try {
      await Promise.all(
        membersToRemove.map((member) =>
          api.delete(`/trusted-circle-members/${member.id}`)
        )
      );
      await refreshTrustedCircleMembers(activeTrustedCircle.id);
      pushTrustedCircleSuccess("Trusted circle cleared.");
    } catch (err) {
      setTrustedCircleError(getErrorMessage(err, "Unable to clear trusted circle."));
    } finally {
      setTrustedCircleBusy(false);
    }
  }, [
    getErrorMessage,
    refreshTrustedCircleMembers,
    activeTrustedCircle,
    trustedCircleMembers,
    user,
    pushTrustedCircleSuccess,
  ]);

  const handleRenameTrustedCircle = useCallback(async () => {
    if (!activeTrustedCircle?.id) return;
    const name = trustedCircleRename.trim();
    if (!name) {
      setTrustedCircleError("Enter a name for this circle.");
      return;
    }
    setTrustedCircleSaving(true);
    setTrustedCircleError(null);
    try {
      await api.put(`/trusted-circles/${activeTrustedCircle.id}`, {
        data: { name },
      });
      setTrustedCircles((prev) =>
        prev.map((circle) =>
          circle.id === activeTrustedCircle.id ? { ...circle, name } : circle
        )
      );
      setTrustedCircleRenaming(false);
      setTrustedCircleEditing(false);
      pushTrustedCircleSuccess("Trusted circle renamed.");
    } catch (err) {
      setTrustedCircleError(getErrorMessage(err, "Unable to rename circle."));
    } finally {
      setTrustedCircleSaving(false);
    }
  }, [activeTrustedCircle, getErrorMessage, pushTrustedCircleSuccess, trustedCircleRename]);

  const handleDeleteTrustedCircle = useCallback(async () => {
    if (!activeTrustedCircle?.id) return;
    setTrustedCircleSaving(true);
    setTrustedCircleError(null);
    try {
      await api.delete(`/trusted-circles/${activeTrustedCircle.id}`);
      setTrustedCircles((prev) =>
        prev.filter((circle) => circle.id !== activeTrustedCircle.id)
      );
      setTrustedCircleMembersByGroup((prev) => {
        const next = { ...prev };
        delete next[activeTrustedCircle.id];
        return next;
      });
      setActiveTrustedCircleId((current) => {
        if (current !== activeTrustedCircle.id) return current;
        const remaining = trustedCircles.filter(
          (circle) => circle.id !== activeTrustedCircle.id
        );
        return remaining[0]?.id ?? null;
      });
      setPendingTrustedAddIds([]);
      setPendingTrustedRemoveIds([]);
      setTrustedCircleEditing(false);
      setTrustedCircleDeleteOpen(false);
      setTrustedCircleDeleteTarget(null);
      pushTrustedCircleSuccess("Trusted circle deleted.");
    } catch (err) {
      setTrustedCircleError(getErrorMessage(err, "Unable to delete circle."));
    } finally {
      setTrustedCircleSaving(false);
    }
  }, [activeTrustedCircle, getErrorMessage, pushTrustedCircleSuccess, trustedCircles]);

  const getPostDescriptor = useCallback((post: FriendPost) => {
    if (post.imageUrl) return isVideoUrl(post.imageUrl) ? "with a video" : "with a picture";
    if (post.linkUrl) return "with a link";
    return "";
  }, []);

  const handleDescriptorAction = useCallback(
    async (post: FriendPost, descriptor: string) => {
      if (descriptor === "with a picture" && post.imageUrl && !isVideoUrl(post.imageUrl)) {
        if (typeof window !== "undefined" && !window.confirm("Download this picture?")) {
          return;
        }
        if (typeof document === "undefined") return;
        const link = document.createElement("a");
        link.href = post.imageUrl;
        link.download = `friend-post-${post.id}`;
        link.rel = "noreferrer";
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }

      if (descriptor === "with a link" && post.linkUrl) {
        const copied = await copyToClipboard(post.linkUrl);
        if (copied) {
          showCopyToast("Link Copied");
        } else {
          setActionNotice("Unable to copy link.");
        }
      }
    },
    [copyToClipboard, showCopyToast]
  );

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
            requesterFavorite: Boolean(attrs.requesterFavorite),
            targetFavorite: Boolean(attrs.targetFavorite),
          };
        });

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
        const linkUrls = new Set<string>();
        (postsRes.data?.data ?? []).forEach((p: any) => {
          const attrs = normalize(p);
          const ownerId = getEntityId(attrs.owner);
          if (!ownerId) return;
          const imageUrl = pickMediaUrl(attrs.Users_Pictures, { kind: "post" });
          const content = attrs.Users_Content || "";
          const feedbackTargetId = getEntityId(attrs.feedbackTarget);
          const feedbackTargetAttrs = getEntityAttrs(attrs.feedbackTarget);
          const feedbackTargetName = feedbackTargetId
            ? feedbackTargetAttrs?.email || `User ${feedbackTargetId}`
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

  useEffect(() => {
    void loadTrustedCircles();
  }, [loadTrustedCircles]);

  useEffect(() => {
    if (!activeTrustedCircle?.id) return;
    if (trustedCircleMembersByGroup[activeTrustedCircle.id]) return;
    void refreshTrustedCircleMembers(activeTrustedCircle.id);
  }, [
    activeTrustedCircle,
    refreshTrustedCircleMembers,
    trustedCircleMembersByGroup,
  ]);

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

  const trustedCircleFriendRows = useMemo(() => {
    const profileMap = new Map<number, FriendProfile>();
    profiles.forEach((profile) => {
      if (profile.userId) {
        profileMap.set(profile.userId, profile);
      }
    });
    return trustedCircleMembers
      .filter((member) => member.userId !== user?.id)
      .map((member) => ({
        member,
        profile: profileMap.get(member.userId),
      }));
  }, [profiles, trustedCircleMembers, user?.id]);

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
  const selectedFriendLabel = selectedFriend
    ? `${selectedFriend.firstName || ""} ${selectedFriend.lastName || ""}`.trim() ||
      `@${selectedFriend.handle || "friend"}`
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
  const activeDescriptor = activePost ? getPostDescriptor(activePost) : "";
  const isActiveDescriptorActionable =
    activeDescriptor === "with a picture" || activeDescriptor === "with a link";
  const activePreview = activePost?.linkUrl ? linkPreviews[activePost.linkUrl] : null;
  const activePreviewImage = activePreview?.image;
  const showActivePreviewMedia = Boolean(
    activePost && !activePost.imageUrl && activePreviewImage
  );
  const showActivePlaceholder = Boolean(
    activePost && !activePost.imageUrl && !activePreviewImage
  );
  const activeFeedbackLabel = activePost ? feedbackLabelFor(activePost) : "";
  const activeAuthorLabel = selectedFriendLabel;
  const activePostTitleId = activePost ? `friend-post-title-${activePost.id}` : undefined;

  useEffect(() => {
    setShowAllPosts(false);
  }, [isBlocked, isMuted, selectedFriendId]);

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

  const handleShowProfile = () => {
    if (!selectedFriend?.userId) return;
    navigate(`/friends/${selectedFriend.userId}`);
  };

  const handleShowAllPosts = () => {
    if (!selectedFriend?.userId || !canViewPosts) return;
    const shouldOpen = !showAllPosts;
    setShowAllPosts(shouldOpen);
    if (shouldOpen && allPostsRef.current) {
      allPostsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const closePostModal = useCallback(() => {
    setActivePost(null);
  }, []);

  const handleOpenPost = (post: FriendPost) => {
    if (!post?.id) return;
    setActivePost(post);
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

  useEffect(() => {
    if (!activePost) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActivePost(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePost]);

  useEffect(() => {
    if (!activePost) return;
    if (typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [activePost]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  const renderPostList = (posts: FriendPost[], expanded = false) => (
    <ul className={`comment-list friend-posts-list${expanded ? " is-expanded" : ""}`}>
      {posts.map((post) => {
        const feedbackLabel = feedbackLabelFor(post);
        return (
          <li
            key={post.id}
            className="comment-item friend-post-item"
            role="button"
            tabIndex={0}
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (target.closest("a")) return;
              handleOpenPost(post);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleOpenPost(post);
              }
            }}
          >
            {post.imageUrl && (
              <img
                src={post.imageUrl}
                alt={post.title}
                className="avatar"
                loading="lazy"
                decoding="async"
              />
            )}
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
    <div className="dashboard-shell friends-page" style={getBackgroundStyle("friends")}>
      <Sidebar active="friends" />

      <div className="main-content">
        <TopbarSearch value={query} onChange={setQuery} />
        <div className="dash-hero">
          <div className="dash-hero__text">
            <p className="eyebrow">Friends</p>
            <h1>Your Friends</h1>
          </div>
        </div>

        {error && <p className="status status-error">{error}</p>}

        <div className="panel-grid">
          <section className="panel">
            <div className="panel-header friend-panel-header">
              <div>
                <p className="eyebrow">Friends</p>
                <h3>Current Friends</h3>
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
                      <div className="friend-mini-row">
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
                        <div className="friend-mini-actions">
                          <button
                            className="friend-profile-btn"
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (friend.userId) {
                                navigate(`/friends/${friend.userId}`);
                              }
                            }}
                          >
                            Profile
                          </button>
                          <button
                            className={`friend-favorite-toggle${
                              friend.favorite ? " is-active" : ""
                            }`}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleToggleFavorite(friend);
                            }}
                            aria-label={
                              friend.favorite ? "Remove favorite" : "Mark as favorite"
                            }
                          >
                            <span aria-hidden="true">
                              {friend.favorite ? "★" : "☆"}
                            </span>
                          </button>
                        </div>
                      </div>
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
                    <strong>
                      {`${selectedFriend.firstName || ""} ${selectedFriend.lastName || ""}`.trim() ||
                        `@${selectedFriend.handle || "friend"}`}
                    </strong>
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
                    className={`btn ghost friend-favorite-action${
                      selectedFriend.favorite ? " is-active" : ""
                    }`}
                    type="button"
                    onClick={() => handleToggleFavorite(selectedFriend)}
                    disabled={isBlocked}
                  >
                    {selectedFriend.favorite ? "Favorite" : "Add favorite"}
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
                    {canViewPosts && selectedPosts.length > recentPosts.length && (
                      <button
                        className="btn ghost friend-posts-toggle"
                        type="button"
                        onClick={handleShowAllPosts}
                      >
                        {showAllPosts ? "Hide posts" : "Show all posts"}
                      </button>
                    )}
                  </div>
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

        <section className="panel trusted-circle-panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Trusted circles</p>
              <h3>My Trusted Groups</h3>
              <p className="panel-sub">
                Create up to {MAX_TRUSTED_CIRCLES} private circles and choose who can see
                sensitive updates.
              </p>
            </div>
            <span className="trusted-circle__count">
              {trustedCircles.length}/{MAX_TRUSTED_CIRCLES}
            </span>
          </div>
          {trustedCircleError && (
            <p className="status status-error">{trustedCircleError}</p>
          )}
          {trustedCircleSuccess && (
            <p className="status status-success">{trustedCircleSuccess}</p>
          )}
          {trustedCircleLoading ? (
            <p className="status">Loading trusted circles...</p>
          ) : (
            <>
              <div className="trusted-circle__create">
                <input
                  className="auth-input"
                  placeholder="Name your trusted circle"
                  value={trustedCircleName}
                  onChange={(event) => setTrustedCircleName(event.target.value)}
                  maxLength={40}
                  disabled={trustedCircleBusy || trustedCircles.length >= MAX_TRUSTED_CIRCLES}
                />
                <button
                  className="btn primary"
                  type="button"
                  disabled={
                    trustedCircleBusy ||
                    trustedCircles.length >= MAX_TRUSTED_CIRCLES ||
                    !trustedCircleName.trim()
                  }
                  onClick={() => void createTrustedCircle()}
                >
                  {trustedCircleBusy ? "Creating..." : "Create circle"}
                </button>
              </div>
              {trustedCircles.length === 0 ? (
                <p className="status">Create your first trusted circle to add friends.</p>
              ) : (
                <>
                  <div className="trusted-circle__tabs">
                    {trustedCircles.map((circle) => (
                      <button
                        key={circle.id}
                        type="button"
                        className={`trusted-circle__tab${
                          circle.id === activeTrustedCircle?.id ? " is-active" : ""
                        }`}
                        onClick={() => setActiveTrustedCircleId(circle.id)}
                      >
                        {circle.name}
                      </button>
                    ))}
                  </div>
                  {activeTrustedCircle && (
                    <div className="trusted-circle__editor">
                      {trustedCircleRenaming ? (
                        <>
                          <input
                            className="auth-input"
                            value={trustedCircleRename}
                            onChange={(event) =>
                              setTrustedCircleRename(event.target.value)
                            }
                            maxLength={40}
                          />
                          <div className="trusted-circle__editor-actions">
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => {
                                setTrustedCircleRenaming(false);
                                setTrustedCircleRename(activeTrustedCircle.name);
                              }}
                              disabled={trustedCircleSaving}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn primary"
                              type="button"
                              onClick={handleRenameTrustedCircle}
                              disabled={
                                trustedCircleSaving || !trustedCircleRename.trim()
                              }
                            >
                              {trustedCircleSaving ? "Saving..." : "Save name"}
                            </button>
                          </div>
                        </>
                      ) : (
                        <div className="trusted-circle__editor-row">
                          <div>
                            <p className="trusted-circle__label">Active circle</p>
                            <div className="trusted-circle__menu">
                              <button
                                className="btn ghost trusted-circle__menu-button"
                                type="button"
                                onClick={() =>
                                  setTrustedCircleMenuOpen((prev) => !prev)
                                }
                                disabled={trustedCircleSaving}
                              >
                                {activeTrustedCircle.name}
                                <span className="trusted-circle__menu-caret">▾</span>
                              </button>
                              {trustedCircleMenuOpen && (
                                <div className="trusted-circle__menu-list">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      cancelTrustedCircleEdits();
                                      setTrustedCircleRenaming(true);
                                      setTrustedCircleMenuOpen(false);
                                    }}
                                  >
                                    Rename
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setTrustedCircleEditing(true);
                                      setTrustedCircleMenuOpen(false);
                                    }}
                                  >
                                    Edit friends
                                  </button>
                                  <button
                                    type="button"
                                    className="danger"
                                    onClick={() => {
                                      setTrustedCircleMenuOpen(false);
                                      setTrustedCircleDeleteTarget(activeTrustedCircle);
                                      setTrustedCircleDeleteOpen(true);
                                    }}
                                  >
                                    Delete
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                          
                        </div>
                      )}
                    </div>
                  )}
                  <div className="goals-panel__trusted">
                    <div className="goals-panel__trusted-group">
                      <div className="goals-panel__trusted-header">
                        <h5>{activeTrustedCircle?.name || "Trusted friends"}</h5>
                        <div className="goals-panel__trusted-actions">
                          <button
                            className="btn ghost"
                            type="button"
                            disabled={trustedCircleBusy || !activeTrustedCircle?.id}
                            onClick={clearTrustedFriends}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      {trustedFriendOptions.length === 0 ? (
                        <p className="goals-empty">Add friends to build a trusted circle.</p>
                      ) : (
                        <>
                          <div className="goals-panel__trusted-picker">
                            <div className="goals-panel__select">
                              <select
                                className="auth-input goals-select"
                                value={trustedFriendPicker}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setTrustedFriendPicker(value);
                                  const nextId = Number(value);
                                  if (Number.isFinite(nextId)) {
                                    queueTrustedFriend(nextId);
                                  }
                                  setTrustedFriendPicker("");
                                }}
                                disabled={
                                  !canEditTrustedCircle ||
                                  trustedCircleBusy ||
                                  !activeTrustedCircle?.id
                                }
                              >
                                <option value="">Select a friend to trust</option>
                                {trustedFriendOptions.map((friend) => (
                                  <option
                                    key={friend.id}
                                    value={friend.id}
                                    disabled={
                                      trustedMemberIds.has(friend.id) ||
                                      friend.id === user?.id
                                    }
                                  >
                                    {friend.label}
                                  </option>
                                ))}
                              </select>
                              <span className="goals-select-caret" />
                            </div>
                          </div>
                          {canEditTrustedCircle && pendingTrustedAddOptions.length > 0 && (
                            <div className="trusted-circle__pending">
                              <p className="trusted-circle__pending-label">Pending</p>
                              <div className="trusted-circle__pending-list">
                                {pendingTrustedAddOptions.map((friend) => (
                                  <span
                                    key={friend.id}
                                    className="trusted-circle__pending-chip"
                                  >
                                    {friend.label}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {canEditTrustedCircle && (
                            <div className="trusted-circle__apply">
                              <button
                                className="btn ghost"
                                type="button"
                                onClick={cancelTrustedCircleEdits}
                                disabled={trustedCircleBusy || !trustedCircleEditing}
                              >
                                Cancel
                              </button>
                              <button
                                className="btn primary"
                                type="button"
                                onClick={() => void applyTrustedCircleChanges()}
                                disabled={!hasPendingTrustedChanges || trustedCircleBusy}
                              >
                                {trustedCircleBusy ? "Saving..." : "Apply changes"}
                              </button>
                            </div>
                          )}
                          <div className="goals-panel__trusted-list">
                            {trustedCircleFriendRows.map(({ member, profile }) => {
                              const avatarUrl = profile?.avatarUrl;
                              const label = profile
                                ? formatFriendLabel(profile)
                                : `User ${member.userId}`;
                              return (
                                <div key={member.id} className="trusted-friend-row">
                                  <button
                                    type="button"
                                    className={`trusted-friend-toggle${
                                      pendingTrustedRemoveSet.has(member.id)
                                        ? " is-remove"
                                        : " is-active"
                                    }${avatarUrl ? " has-avatar" : ""}${
                                      canEditTrustedCircle ? "" : " is-locked"
                                    }`}
                                    onClick={() => togglePendingRemoval(member)}
                                    disabled={!canEditTrustedCircle}
                                    aria-pressed={!pendingTrustedRemoveSet.has(member.id)}
                                    aria-label={
                                      pendingTrustedRemoveSet.has(member.id)
                                        ? "Marked for removal"
                                        : "Trusted friend"
                                    }
                                  >
                                    {avatarUrl ? (
                                      <img
                                        className="trusted-friend-toggle__avatar"
                                        src={avatarUrl}
                                        alt={label}
                                        loading="lazy"
                                        decoding="async"
                                      />
                                    ) : (
                                      <>
                                        <span className="trusted-friend-toggle__ring" />
                                        <span className="trusted-friend-toggle__dot" />
                                      </>
                                    )}
                                  </button>
                                  <span
                                    className={`trusted-friend-name${
                                      pendingTrustedRemoveSet.has(member.id)
                                        ? " is-muted"
                                        : ""
                                    }`}
                                  >
                                    {label}
                                  </span>
                                  {pendingTrustedRemoveSet.has(member.id) && (
                                    <span className="trusted-friend-tag">Remove</span>
                                  )}
                                </div>
                              );
                            })}
                            {trustedCircleFriendRows.length === 0 && (
                              <p className="goals-empty">No trusted friends yet.</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      </div>

      {activePost && (
        <div
          className="post-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={activePostTitleId}
          onClick={closePostModal}
        >
          <div className="post-modal__panel" onClick={(event) => event.stopPropagation()}>
            <div className="post-modal__handle" aria-hidden="true" />
            <button
              className="post-modal__close"
              type="button"
              onClick={closePostModal}
              onPointerUp={closePostModal}
              onTouchEnd={closePostModal}
              aria-label="Close post"
            >
              X
            </button>
            <div className="post-modal__scroll">
              <div className="post-modal__meta">
                <div className="post-modal__meta-left">
                  <span className="post-modal__author">{activeAuthorLabel}</span>
                  {activePost.createdAt && (
                    <span className="post-modal__time">
                      {formatPostDate(activePost.createdAt)}
                    </span>
                  )}
                </div>
                <div className="post-modal__meta-right">
                  {activeDescriptor &&
                    (isActiveDescriptorActionable ? (
                      <button
                        type="button"
                        className="post-meta-tag post-meta-tag--action"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!activePost) return;
                          void handleDescriptorAction(activePost, activeDescriptor);
                        }}
                        aria-label={
                          activeDescriptor === "with a link"
                            ? "Copy link"
                            : "Download picture"
                        }
                      >
                        {activeDescriptor}
                      </button>
                    ) : (
                      <span className="post-meta-tag">{activeDescriptor}</span>
                    ))}
                  {activeFeedbackLabel && (
                    <span className="post-feedback-tag">{activeFeedbackLabel}</span>
                  )}
                </div>
              </div>

              {activePost.imageUrl ? (
                <div className="post-media post-modal__media">
                  {isVideoUrl(activePost.imageUrl) ? (
                    <video
                      controls
                      playsInline
                      preload="metadata"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    >
                      <source src={activePost.imageUrl} />
                    </video>
                  ) : (
                    <img
                      src={activePost.imageUrl}
                      alt={activePost.title}
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </div>
              ) : showActivePreviewMedia ? (
                <div className="post-media post-modal__media link-preview-media">
                  <img
                    src={activePreviewImage}
                    alt={activePreview?.title || activePost.title}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              ) : showActivePlaceholder ? (
                <div className="post-media post-modal__media placeholder">
                  <div className="dots" />
                  <span>No image</span>
                </div>
              ) : null}

              <div className="post-modal__body">
                <h2 id={activePostTitleId}>{activePost.title}</h2>
                <p>{activePost.content}</p>
                {activePreview && !activePost.imageUrl && activePost.linkUrl && (
                  <LinkPreviewCard preview={activePreview} url={activePost.linkUrl} />
                )}
              </div>
            </div>
            <div className="post-modal__mobile-actions">
              <button
                className="post-modal__close-btn"
                type="button"
                onClick={closePostModal}
                onPointerUp={closePostModal}
                onTouchEnd={closePostModal}
              >
                Close
              </button>
              <span className="post-modal__hint">Tap outside to close</span>
            </div>
          </div>
        </div>
      )}
      {copyToast && <div className="toast success-toast">{copyToast}</div>}

      {trustedCircleDeleteOpen && trustedCircleDeleteTarget && (
        <div
          className="trusted-circle-modal__backdrop"
          role="dialog"
          aria-modal="true"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setTrustedCircleDeleteOpen(false);
              setTrustedCircleDeleteTarget(null);
            }
          }}
        >
          <div className="trusted-circle-modal">
            <h4>Delete trusted circle?</h4>
            <p>
              This will remove <strong>{trustedCircleDeleteTarget.name}</strong> and
              its member list.
            </p>
            <div className="trusted-circle-modal__actions">
              <button
                className="btn ghost"
                type="button"
                onClick={() => {
                  setTrustedCircleDeleteOpen(false);
                  setTrustedCircleDeleteTarget(null);
                }}
                disabled={trustedCircleSaving}
              >
                Cancel
              </button>
              <button
                className="btn ghost danger"
                type="button"
                onClick={() => void handleDeleteTrustedCircle()}
                disabled={trustedCircleSaving}
              >
                {trustedCircleSaving ? "Deleting..." : "Delete circle"}
              </button>
            </div>
          </div>
        </div>
      )}

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
