import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import "../css/dashboard.css";
import "../css/profile.css";
import "../css/friends.css";
import "../css/friend-profile.css";
import "../css/media-lightbox.css";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { useVideoCall, type VideoCallInvitee } from "../context/VideoCallContext";
import api from "../api/strapi";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import FriendPostsFeed, { type FriendFeedPost } from "../components/FriendPostsFeed";
import { usePageMeta } from "../hooks/usePageMeta";
import {
  buildProfilePayloadFromAttrs,
  decryptFriendProfilePayload,
  type PrivacySettings,
  type ProfilePayload,
  type ProfileVisibility,
  type VisibilityLevel,
} from "../utils/profile-e2ee";
import { pickMediaUrl } from "../utils/media";
import {
  buildTelLink,
  extractNationalDigits,
  formatPhoneDisplay,
  normalizeDialCode,
} from "../utils/phone";

const MEDIA_PAGE_SIZE = 8;

type FriendProfile = {
  id: number | string;
  handle: string;
  userId?: number;
  firstName?: string;
  lastName?: string;
  age?: string;
  birthday?: string;
  gender?: string;
  religion?: string;
  country?: string;
  countryCode?: string;
  state?: string;
  city?: string;
  hobbies?: string;
  occupation?: string;
  bio?: string;
  phone?: string;
  phoneDialCode?: string;
  showPhoneOnProfile?: boolean;
  avatarUrl?: string;
  profileVisibility?: ProfileVisibility;
  privacySettings?: PrivacySettings;
  activityVisibility?: VisibilityLevel;
  lastSeenAt?: string;
};

type FriendRelation = {
  status?: string;
};

type UserActionEntry = {
  userId: number;
  recordId: number | string;
};

type ReportReason = "spam" | "harassment" | "hate" | "impersonation" | "other";

type FriendPost = FriendFeedPost;

type FriendMediaItem = {
  id: number | string;
  title?: string;
  caption?: string;
  order?: number;
  visibility?: "public" | "friends" | "private" | "trusted";
  kind?: "photo" | "video";
  media?: string;
  createdAt?: string;
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
  return Number.isFinite(num) ? num : null;
};
const getEntityLabel = (entry: any, fallback: string) => {
  const attrs = getEntityAttrs(entry);
  const firstName = String(attrs?.firstName || attrs?.firstname || "").trim();
  const lastName = String(attrs?.lastName || attrs?.lastname || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const handle = String(attrs?.handle || attrs?.username || "").trim();
  return fullName || handle || attrs?.email || fallback;
};

const getRecordId = (entry: any, attrs: any) =>
  entry?.id ?? entry?.documentId ?? attrs?.documentId ?? null;

const extractFirstUrl = (text: string) => {
  const match = String(text || "").match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (!match) return "";
  let url = match[0].replace(/[),.!?]+$/, "");
  if (url.startsWith("www.")) url = `https://${url}`;
  return url;
};

const isVideoUrl = (value?: string) => !!value && /\.(mp4|webm|mov|m4v|mkv)$/i.test(value);

const normalizeFriendMedia = (entry: any): FriendMediaItem => {
  const record = getEntity(entry);
  const attrs = record?.attributes ?? record ?? {};
  const mediaItem = attrs?.media ?? record?.media;
  const mediaUrl = pickMediaUrl(mediaItem, { kind: "post" });
  const orderValue = Number(attrs?.order);
  return {
    id: record?.id ?? record?.documentId ?? "",
    title: String(attrs?.title || "").trim() || undefined,
    caption: String(attrs?.caption || "").trim() || undefined,
    order: Number.isFinite(orderValue) ? orderValue : undefined,
    visibility: attrs?.visibility as FriendMediaItem["visibility"],
    kind: attrs?.kind as FriendMediaItem["kind"],
    media: mediaUrl,
    createdAt: String(attrs?.createdAt || ""),
  };
};

const sortFriendMediaItems = (items: FriendMediaItem[]) =>
  [...items].sort((a, b) => {
    const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    if (timeA !== timeB) return timeB - timeA;
    return String(a.id).localeCompare(String(b.id));
  });

const parseActionEntry = (
  rows: any[],
  relationKey: "blocked" | "muted"
): UserActionEntry | null => {
  for (const row of rows ?? []) {
    const attrs = normalize(row);
    const userId = getEntityId(attrs[relationKey]);
    const recordId = getRecordId(row, attrs);
    if (userId && recordId) {
      return { userId, recordId };
    }
  }
  return null;
};

const getErrorMessage = (err: unknown, fallback: string) => {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { error?: { message?: string }; message?: string }
      | undefined;
    return data?.error?.message || data?.message || fallback;
  }
  return fallback;
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

const resolveFriendDialCode = (profile?: FriendProfile | null) => {
  const explicit = normalizeDialCode(profile?.phoneDialCode);
  if (explicit) return explicit;
  const country = String(profile?.countryCode || "").trim().toUpperCase();
  if (country === "US" || country === "CA") return "1";
  const digits = String(profile?.phone || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return "1";
  return "";
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

const formatBirthday = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en", { month: "long", day: "numeric" }).format(date);
};

const splitList = (value?: string) =>
  (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const iconStrokeProps = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

const InfoIcon = ({ name }: { name: string }) => {
  switch (name) {
    case "location":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M12 3c-3.3 0-6 2.7-6 6 0 4.2 6 12 6 12s6-7.8 6-12c0-3.3-2.7-6-6-6z"
            {...iconStrokeProps}
          />
          <circle cx="12" cy="9" r="2.2" {...iconStrokeProps} />
        </svg>
      );
    case "birthday":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 10h16v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9z" {...iconStrokeProps} />
          <path d="M7 10V8a2 2 0 0 1 4 0v2" {...iconStrokeProps} />
          <path d="M13 10V8a2 2 0 0 1 4 0v2" {...iconStrokeProps} />
          <path d="M4 14h16" {...iconStrokeProps} />
        </svg>
      );
    case "age":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8" r="4" {...iconStrokeProps} />
          <path d="M4 20c1.6-4 14.4-4 16 0" {...iconStrokeProps} />
        </svg>
      );
    case "gender":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="9" cy="10" r="4" {...iconStrokeProps} />
          <path d="M13 6l5-5m0 0h-4m4 0v4" {...iconStrokeProps} />
          <path d="M9 14v6m-3-3h6" {...iconStrokeProps} />
        </svg>
      );
    case "religion":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3v18" {...iconStrokeProps} />
          <path d="M7 8h10" {...iconStrokeProps} />
          <path d="M6 21h12" {...iconStrokeProps} />
        </svg>
      );
    case "occupation":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="3" y="7" width="18" height="12" rx="2" {...iconStrokeProps} />
          <path d="M9 7V5h6v2" {...iconStrokeProps} />
          <path d="M3 13h18" {...iconStrokeProps} />
        </svg>
      );
    case "hobbies":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8z" {...iconStrokeProps} />
        </svg>
      );
    case "phone":
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 3h6l1 4-3 1c1 2 3 4 5 5l1-3 4 1v6c-8 0-14-6-14-14z" {...iconStrokeProps} />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" {...iconStrokeProps} />
          <path d="M12 8v4m0 4h.01" {...iconStrokeProps} />
        </svg>
      );
  }
};

export default function FriendProfilePage() {
  const { friendId } = useParams();
  const friendIdNumber = Number(friendId);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { openChat } = useChat();
  const { openCallComposer } = useVideoCall();
  const { getBackgroundStyle } = useUserPreferences();
  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState<FriendProfile | null>(null);
  const [isFriend, setIsFriend] = useState(false);
  const [blockedEntry, setBlockedEntry] = useState<UserActionEntry | null>(null);
  const [mutedEntry, setMutedEntry] = useState<UserActionEntry | null>(null);
  const [actionBusy, setActionBusy] = useState<"block" | "mute" | "report" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>("other");
  const [reportDetails, setReportDetails] = useState("");
  const [reportError, setReportError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<FriendPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [friendMedia, setFriendMedia] = useState<FriendMediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [mediaTab, setMediaTab] = useState<"all" | "photo" | "video">("all");
  const [mediaPage, setMediaPage] = useState(1);
  const [mediaLightboxOpen, setMediaLightboxOpen] = useState(false);
  const [mediaLightboxItems, setMediaLightboxItems] = useState<FriendMediaItem[]>([]);
  const [mediaLightboxIndex, setMediaLightboxIndex] = useState(0);

  const displayName = useMemo(() => {
    if (!profile) return "Friend profile";
    const name = `${profile.firstName || ""} ${profile.lastName || ""}`.trim();
    return name || `@${profile.handle}`;
  }, [profile]);

  const isBlocked = Boolean(blockedEntry);
  const isMuted = Boolean(mutedEntry);

  usePageMeta({
    title: profile ? `${displayName} | Friends` : "Friend profile | Your Social Place",
    description: profile
      ? `View ${displayName}'s profile details and shared info.`
      : "View your friend's profile details and shared info.",
  });

  useEffect(() => {
    if (!user || !Number.isFinite(friendIdNumber)) {
      setError("Unable to load this profile.");
      setLoading(false);
      return;
    }
    let active = true;
    const loadProfile = async () => {
      setLoading(true);
      setError(null);
      try {
        const relationRes = await api.get(
          `/friends?filters[$or][0][requester][id][$eq]=${user.id}` +
            `&filters[$or][0][target][id][$eq]=${friendIdNumber}` +
            `&filters[$or][1][requester][id][$eq]=${friendIdNumber}` +
            `&filters[$or][1][target][id][$eq]=${user.id}`
        );
        const relationRow = (relationRes.data?.data ?? [])[0];
        const relationAttrs = normalize(relationRow);
        const relation: FriendRelation = { status: relationAttrs.status };
        const accepted = relation.status === "accepted";
        if (active) setIsFriend(accepted);

        const profileRes = await api.get(
          `/profiles?filters[user][id][$eq]=${friendIdNumber}&populate[0]=user&populate[1]=avatar&pagination[pageSize]=1`
        );
        const row = (profileRes.data?.data ?? [])[0];
        if (!row) {
          if (active) setProfile(null);
          if (active) setError("Profile not found.");
          return;
        }
        const attrs = normalize(row);
        const friendUserId = getEntityId(attrs.user);
        if (!friendUserId) {
          if (active) setProfile(null);
          if (active) setError("Profile not found.");
          return;
        }
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
        const profileVisibility = normalizeProfileVisibility(payload.profileVisibility);
        const privacySettings = normalizePrivacySettings(payload.privacySettings);
        const activityVisibility = normalizeVisibility(payload.activityVisibility, "public");
        const showPhoneOnProfile =
          typeof attrs.showPhoneOnProfile === "boolean" ? attrs.showPhoneOnProfile : false;
        const mappedProfile: FriendProfile = {
          id: row.id ?? attrs.documentId,
          userId: friendUserId,
          handle: attrs.handle || `user-${row.id ?? attrs.documentId}`,
          firstName: payload.firstName || "",
          lastName: payload.lastName || "",
          age: payload.age || "",
          birthday: payload.birthday || "",
          gender: payload.gender || "",
          religion: payload.religion || "",
          country: payload.country || "",
          countryCode: payload.countryCode || "",
          state: payload.state || "",
          city: payload.city || "",
          hobbies: payload.hobbies || "",
          occupation: payload.occupation || "",
          bio: payload.bio || "",
          phone: payload.phone || "",
          phoneDialCode: payload.phoneDialCode || "",
          showPhoneOnProfile,
          avatarUrl: pickMediaUrl(attrs.avatar, { kind: "avatar" }),
          profileVisibility,
          privacySettings,
          activityVisibility,
          lastSeenAt: payload.lastSeenAt,
        };
        if (active) setProfile(mappedProfile);
      } catch {
        if (active) setError("Unable to load this profile.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadProfile();
    return () => {
      active = false;
    };
  }, [friendIdNumber, user]);

  useEffect(() => {
    if (!user || !Number.isFinite(friendIdNumber)) return;
    let active = true;
    const loadActions = async () => {
      setActionError(null);
      setActionNotice(null);
      setBlockedEntry(null);
      setMutedEntry(null);
      try {
        const [blockResult, muteResult] = await Promise.allSettled([
          api.get(
            `/user-blocks?filters[blocked][id][$eq]=${friendIdNumber}&populate=blocked&pagination[pageSize]=1`
          ),
          api.get(
            `/user-mutes?filters[muted][id][$eq]=${friendIdNumber}&populate=muted&pagination[pageSize]=1`
          ),
        ]);

        if (!active) return;

        if (blockResult.status === "fulfilled") {
          setBlockedEntry(
            parseActionEntry(blockResult.value.data?.data ?? [], "blocked")
          );
        }
        if (muteResult.status === "fulfilled") {
          setMutedEntry(parseActionEntry(muteResult.value.data?.data ?? [], "muted"));
        }
        if (blockResult.status === "rejected" || muteResult.status === "rejected") {
          const missing: string[] = [];
          if (blockResult.status === "rejected") missing.push("blocked users");
          if (muteResult.status === "rejected") missing.push("muted users");
          setActionError(`Unable to load ${missing.join(" and ")}.`);
        }
      } catch (err: unknown) {
        if (active) {
          setActionError(getErrorMessage(err, "Unable to load safety controls."));
        }
      }
    };

    void loadActions();
    return () => {
      active = false;
    };
  }, [friendIdNumber, user]);

  useEffect(() => {
    if (!user || !Number.isFinite(friendIdNumber)) return;
    let active = true;
    const loadPosts = async () => {
      setPostsLoading(true);
      setPostsError(null);
      try {
        const postsRes = await api.get(
          `/users-posts?filters[owner][id][$eq]=${friendIdNumber}` +
            `&populate=Users_Pictures&populate=owner&populate=feedbackTarget` +
            `&sort=createdAt:desc&pagination[pageSize]=200&publicationState=preview`
        );
        const mapped: FriendPost[] = [];
        (postsRes.data?.data ?? []).forEach((p: any) => {
          const attrs = normalize(p);
          const ownerData = getEntity(attrs.owner);
          const ownerId = getEntityId(ownerData);
          if (!ownerId || ownerId !== friendIdNumber) return;
          const imageUrl = pickMediaUrl(attrs.Users_Pictures, { kind: "post" });
          const content = attrs.Users_Content || "";
          const feedbackTargetId = getEntityId(attrs.feedbackTarget) ?? undefined;
          const feedbackTargetAttrs = getEntityAttrs(attrs.feedbackTarget);
          const feedbackTargetName = feedbackTargetId
            ? feedbackTargetAttrs?.email || `User ${feedbackTargetId}`
            : undefined;
          const linkUrl = extractFirstUrl(content);
          mapped.push({
            id: p.id ?? attrs.documentId,
            numericId: Number.isFinite(Number(p.id)) ? Number(p.id) : undefined,
            documentId: attrs.documentId ?? p.documentId,
            ownerId,
            ownerName: getEntityLabel(ownerData, `User ${ownerId}`),
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
        mapped.sort((a, b) => {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return bTime - aTime;
        });
        if (active) {
          setPosts(mapped);
        }
      } catch {
        if (active) setPostsError("Unable to load posts.");
      } finally {
        if (active) setPostsLoading(false);
      }
    };
    void loadPosts();
    return () => {
      active = false;
    };
  }, [friendIdNumber, user]);

  useEffect(() => {
    if (!user || !Number.isFinite(friendIdNumber)) return;
    let active = true;
    const loadMedia = async () => {
      setMediaLoading(true);
      setMediaError(null);
      try {
        const res = await api.get(
          `/profile-media-items?filters[owner][id][$eq]=${friendIdNumber}` +
            `&populate=media&sort=createdAt:desc&pagination[pageSize]=200`
        );
        const items = (res.data?.data ?? []).map(normalizeFriendMedia);
        if (active) {
          setFriendMedia(sortFriendMediaItems(items));
        }
      } catch {
        if (active) setMediaError("Unable to load gallery for this friend.");
      } finally {
        if (active) setMediaLoading(false);
      }
    };
    void loadMedia();
    return () => {
      active = false;
    };
  }, [friendIdNumber, user]);

  const audience: "public" | "followers" = isFriend ? "followers" : "public";
  const visibility = normalizeProfileVisibility(profile?.profileVisibility);
  const privacy = normalizePrivacySettings(profile?.privacySettings);
  const baseVisibility = visibility === "custom" ? "public" : visibility;
  const canShowBase = visibility !== "private" && canView(audience, baseVisibility);
  const canShowBio =
    visibility !== "private" &&
    canView(audience, resolveFieldVisibility(visibility, privacy, "bio", "public"));
  const canShowLocation =
    visibility !== "private" &&
    canView(audience, resolveFieldVisibility(visibility, privacy, "location", "public"));
  const canShowBirthday =
    visibility !== "private" &&
    canView(audience, resolveFieldVisibility(visibility, privacy, "birthday", "public"));
  const canShowActivity =
    visibility !== "private" &&
    canView(audience, normalizeVisibility(profile?.activityVisibility, "public"));

  const canViewPosts = isFriend && !isBlocked && !isMuted;

  const visibleMedia = friendMedia.filter((item) => {
    const visibilityValue = item.visibility || "public";
    if (visibilityValue === "public") return true;
    if (visibilityValue === "friends") return isFriend;
    return false;
  });
  const filteredMedia = visibleMedia.filter((item) => {
    const kind = item.kind || (item.media && isVideoUrl(item.media) ? "video" : "photo");
    if (mediaTab === "all") return true;
    return kind === mediaTab;
  });

  useEffect(() => {
    setMediaPage(1);
  }, [mediaTab]);

  const mediaPaging = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filteredMedia.length / MEDIA_PAGE_SIZE));
    const page = Math.min(Math.max(mediaPage, 1), totalPages);
    const startIndex = (page - 1) * MEDIA_PAGE_SIZE;
    return {
      page,
      totalPages,
      startIndex,
      items: filteredMedia.slice(startIndex, startIndex + MEDIA_PAGE_SIZE),
    };
  }, [filteredMedia, mediaPage]);

  useEffect(() => {
    if (mediaPage > mediaPaging.totalPages) {
      setMediaPage(mediaPaging.totalPages);
    }
  }, [mediaPage, mediaPaging.totalPages]);

  const activeMediaItem = mediaLightboxOpen
    ? mediaLightboxItems[mediaLightboxIndex]
    : null;

  const openMediaLightboxAt = (index: number) => {
    if (!filteredMedia.length) return;
    setMediaLightboxItems(filteredMedia);
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
        setMediaLightboxIndex((prev) => (prev + 1) % mediaLightboxItems.length);
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

  const locationLabel = useMemo(() => {
    const parts = [profile?.city, profile?.state, profile?.country].filter(Boolean);
    return parts.join(", ");
  }, [profile?.city, profile?.state, profile?.country]);

  const hobbies = useMemo(() => splitList(profile?.hobbies), [profile?.hobbies]);
  const effectivePhoneDialCode = resolveFriendDialCode(profile);
  const phoneDigitsCount = extractNationalDigits(
    profile?.phone,
    effectivePhoneDialCode
  ).length;
  const phoneDisplay = formatPhoneDisplay(profile?.phone, effectivePhoneDialCode);
  const phoneLink =
    phoneDigitsCount === 10
      ? buildTelLink(profile?.phone, effectivePhoneDialCode)
      : "";

  const infoItems = useMemo(
    () => [
      {
        id: "location",
        label: "Location",
        value: locationLabel,
        icon: "location",
        show: canShowLocation && Boolean(locationLabel),
      },
      {
        id: "birthday",
        label: "Birthday",
        value: formatBirthday(profile?.birthday),
        icon: "birthday",
        show: canShowBirthday && Boolean(profile?.birthday),
      },
      {
        id: "age",
        label: "Age",
        value: profile?.age,
        icon: "age",
        show: canShowBase && Boolean(profile?.age),
      },
      {
        id: "gender",
        label: "Gender",
        value: profile?.gender,
        icon: "gender",
        show: canShowBase && Boolean(profile?.gender),
      },
      {
        id: "religion",
        label: "Religion",
        value: profile?.religion,
        icon: "religion",
        show: canShowBase && Boolean(profile?.religion),
      },
      {
        id: "occupation",
        label: "Occupation",
        value: profile?.occupation,
        icon: "occupation",
        show: canShowBase && Boolean(profile?.occupation),
      },
      {
        id: "phone",
        label: "Phone",
        value: phoneDisplay,
        icon: "phone",
        show: canShowBase && Boolean(profile?.showPhoneOnProfile && phoneLink),
        link: phoneLink ? `tel:${phoneLink}` : undefined,
      },
    ],
    [
      canShowBase,
      canShowBirthday,
      canShowLocation,
      locationLabel,
      phoneDisplay,
      phoneLink,
      profile?.age,
      profile?.birthday,
      profile?.gender,
      profile?.occupation,
      profile?.religion,
      profile?.showPhoneOnProfile,
    ]
  );

  const visibleInfoItems = infoItems.filter((item) => item.show);

  const handleMessage = () => {
    if (!profile?.userId) return;
    if (isBlocked) {
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

  const toInvitee = (profileData: FriendProfile): VideoCallInvitee => {
    const name = `${profileData.firstName || ""} ${profileData.lastName || ""}`.trim();
    const handle = profileData.handle || "friend";
    return {
      userId: profileData.userId || 0,
      displayName: name || handle,
      handle,
      avatarUrl: profileData.avatarUrl,
    };
  };

  const handleVideoCall = () => {
    if (!profile?.userId) return;
    if (isBlocked) {
      setActionNotice("Unblock this user to start a video call.");
      return;
    }
    openCallComposer([toInvitee(profile)]);
  };

  const handleToggleBlock = async () => {
    const targetId = profile?.userId;
    if (!targetId) return;
    setActionError(null);
    setActionNotice(null);
    setActionBusy("block");
    try {
      if (blockedEntry) {
        await api.delete(`/user-blocks/${blockedEntry.recordId}`);
        setBlockedEntry(null);
        setActionNotice("User unblocked.");
      } else {
        const res = await api.post("/user-blocks", {
          data: { blocked: targetId },
        });
        const created = res.data?.data;
        const recordId = created?.id ?? created?.documentId;
        if (recordId) {
          setBlockedEntry({ userId: targetId, recordId });
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
    const targetId = profile?.userId;
    if (!targetId) return;
    setActionError(null);
    setActionNotice(null);
    setActionBusy("mute");
    try {
      if (mutedEntry) {
        await api.delete(`/user-mutes/${mutedEntry.recordId}`);
        setMutedEntry(null);
        setActionNotice("User unmuted.");
      } else {
        const res = await api.post("/user-mutes", {
          data: { muted: targetId },
        });
        const created = res.data?.data;
        const recordId = created?.id ?? created?.documentId;
        if (recordId) {
          setMutedEntry({ userId: targetId, recordId });
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
    if (!profile?.userId) return;
    setReportReason("other");
    setReportDetails("");
    setReportError(null);
    setReportOpen(true);
  };

  const handleSubmitReport = async () => {
    const targetId = profile?.userId;
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

  const avatarFallback = profile?.handle?.charAt(0)?.toUpperCase() || "?";

  return (
    <div className="dashboard-shell friend-profile-page" style={getBackgroundStyle("friends")}>
      <Sidebar active="friends" />
      <div className="main-content">
        <TopbarSearch value={query} onChange={setQuery} />
        <div className="dash-hero friend-profile-hero">
          <div className="dash-hero__text">
            <p className="eyebrow">Friends</p>
            <h1>Profile</h1>
          </div>
          <button type="button" className="btn ghost" onClick={() => navigate("/friends")}>
            Back to Friends
          </button>
        </div>

        {error && <p className="status status-error">{error}</p>}
        {loading ? (
          <p className="status">Loading profile...</p>
        ) : !profile ? (
          <p className="status">Profile not found.</p>
        ) : (
          <>
            <section className="panel profile-header-panel friend-profile-header">
              <div className="profile-header-avatar-overlay">
                {profile.avatarUrl ? (
                  <img src={profile.avatarUrl} alt={displayName} loading="lazy" />
                ) : (
                  <div className="profile-header-avatar-fallback">{avatarFallback}</div>
                )}
              </div>
              <div className="profile-header-content">
                <div className="friend-profile-avatar">
                  {profile.avatarUrl ? (
                    <img src={profile.avatarUrl} alt={displayName} loading="lazy" />
                  ) : (
                    <div className="friend-profile-avatar-fallback">{avatarFallback}</div>
                  )}
                </div>
                <div className="profile-header-meta">
                  <h2 className="profile-header-title">{displayName}</h2>
                  <span className="profile-header-handle-pill">@{profile.handle}</span>
                  {canShowActivity && (
                    <span className="friend-profile-activity">{formatLastSeen(profile.lastSeenAt)}</span>
                  )}
                </div>
                <p className="profile-header-bio">
                  {canShowBio
                    ? profile.bio || "No bio shared yet."
                    : "Bio hidden by privacy settings."}
                </p>
                <div className="profile-header-actions friend-profile-actions">
                  <button
                    type="button"
                    className="btn primary profile-header-action-button"
                    onClick={handleMessage}
                    disabled={!isFriend}
                  >
                    Message
                  </button>
                  <button
                    type="button"
                    className="btn ghost profile-header-action-button"
                    onClick={handleVideoCall}
                    disabled={!isFriend}
                  >
                    Video call
                  </button>
                </div>
              </div>
            </section>

            <div className="panel-grid friend-profile-grid">
              <section className="panel friend-profile-panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Overview</p>
                    <h3>About {profile.firstName || profile.handle}</h3>
                  </div>
                </div>
                <div className="friend-profile-stack">
                  <div className="friend-profile-bio-card">
                    <span className="friend-profile-bio-label">Bio</span>
                    <p className="friend-profile-bio-text">
                      {canShowBio
                        ? profile.bio || "No bio shared yet."
                        : "Bio hidden by privacy settings."}
                    </p>
                  </div>
                  <div className="friend-profile-bio-card">
                    <span className="friend-profile-bio-label">Hobbies</span>
                    {canShowBase && hobbies.length > 0 ? (
                      <div className="friend-profile-hobby-list">
                        {hobbies.map((hobby) => (
                          <span key={hobby} className="friend-profile-hobby-chip">
                            {hobby}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="friend-profile-bio-text">No hobbies shared yet.</p>
                    )}
                  </div>
                </div>
              </section>

              <section className="panel friend-profile-panel">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Details</p>
                    <h3>Profile details</h3>
                  </div>
                </div>
                {visibleInfoItems.length === 0 ? (
                  <p className="status">No details shared yet.</p>
                ) : (
                  <div className="friend-profile-info-grid">
                    {visibleInfoItems.map((item) => (
                      <div key={item.id} className="friend-profile-info-card">
                        <div className="friend-profile-info-icon">
                          <InfoIcon name={item.icon} />
                        </div>
                        <div className="friend-profile-info-body">
                          <span className="friend-profile-info-label">{item.label}</span>
                          {item.link ? (
                            <a
                              href={item.link}
                              className="friend-profile-info-value is-link"
                            >
                              {item.value}
                            </a>
                          ) : (
                            <span className="friend-profile-info-value">{item.value}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="panel friend-profile-panel friend-profile-safety">
                <div className="panel-header">
                  <div>
                    <p className="eyebrow">Safety</p>
                    <h3>Mute, block, or report</h3>
                    <p className="panel-sub">
                      Control who can reach you and flag concerning activity.
                    </p>
                  </div>
                </div>
                {(isBlocked || isMuted) && (
                  <div className="friend-status-row">
                    {isBlocked && <span className="friend-status-pill is-blocked">Blocked</span>}
                    {isMuted && <span className="friend-status-pill is-muted">Muted</span>}
                  </div>
                )}
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
              </section>
            </div>
            <div className="panel-grid friend-profile-grid">
              <section className="panel friend-profile-panel friend-profile-gallery">
                <div className="panel-header friend-profile-gallery-header">
                  <div>
                    <p className="eyebrow">Gallery</p>
                    <h3>Photos & Videos</h3>
                  </div>
                  <div className="friend-profile-gallery-tabs">
                    <button
                      type="button"
                      className={`friend-profile-gallery-tab${
                        mediaTab === "all" ? " is-active" : ""
                      }`}
                      onClick={() => setMediaTab("all")}
                    >
                      All
                    </button>
                    <button
                      type="button"
                      className={`friend-profile-gallery-tab${
                        mediaTab === "photo" ? " is-active" : ""
                      }`}
                      onClick={() => setMediaTab("photo")}
                    >
                      Photos
                    </button>
                    <button
                      type="button"
                      className={`friend-profile-gallery-tab${
                        mediaTab === "video" ? " is-active" : ""
                      }`}
                      onClick={() => setMediaTab("video")}
                    >
                      Videos
                    </button>
                  </div>
                </div>
                {mediaLoading && <p className="status">Loading gallery...</p>}
                {mediaError && <p className="status status-error">{mediaError}</p>}
                {!mediaLoading && !mediaError && filteredMedia.length === 0 && (
                  <p className="status">
                    {isFriend
                      ? "No shared media yet."
                      : "Add as a friend to see shared media."}
                  </p>
                )}
                {!mediaLoading && filteredMedia.length > 0 && (
                  <div className="friend-profile-gallery-grid">
                    {mediaPaging.items.map((item, index) => {
                      const absoluteIndex = mediaPaging.startIndex + index;
                      const isVideo = item.kind === "video" || isVideoUrl(item.media);
                      return (
                        <button
                          key={String(item.id)}
                          type="button"
                          className="friend-profile-gallery-card"
                          onClick={() => openMediaLightboxAt(absoluteIndex)}
                          aria-label={item.title || (isVideo ? "Open video" : "Open photo")}
                        >
                          {item.media ? (
                            <div className="friend-profile-gallery-media">
                              {isVideo ? (
                                <video
                                  src={item.media}
                                  muted
                                  playsInline
                                  preload="metadata"
                                />
                              ) : (
                                <img
                                  src={item.media}
                                  alt={item.title || "Photo"}
                                  loading="lazy"
                                  decoding="async"
                                />
                              )}
                              <span className="friend-profile-gallery-kind">
                                {isVideo ? "Video" : "Photo"}
                              </span>
                            </div>
                          ) : (
                            <div className="friend-profile-gallery-media is-empty">
                              No media
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
                {!mediaLoading && filteredMedia.length > 0 && mediaPaging.totalPages > 1 && (
                  <div className="profile-media__pagination">
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => setMediaPage((prev) => Math.max(1, prev - 1))}
                      disabled={mediaPaging.page <= 1}
                    >
                      Previous
                    </button>
                    <div className="profile-media__page-info">
                      Page {mediaPaging.page} of {mediaPaging.totalPages}
                    </div>
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() =>
                        setMediaPage((prev) =>
                          Math.min(mediaPaging.totalPages, prev + 1)
                        )
                      }
                      disabled={mediaPaging.page >= mediaPaging.totalPages}
                    >
                      Next
                    </button>
                  </div>
                )}
              </section>

              <section className="panel friend-profile-panel friend-profile-posts">
                <div className="panel-header friend-profile-posts-header">
                  <div>
                    <p className="eyebrow">Posts</p>
                    <h3>Recent posts</h3>
                  </div>
                </div>
                {!canViewPosts && (
                  <p className="status">
                    {isBlocked
                      ? "You blocked this user. Unblock to see posts."
                      : isMuted
                        ? "Muted: posts hidden."
                        : "Add as a friend to see posts."}
                  </p>
                )}
                {canViewPosts && postsLoading && <p className="status">Loading posts...</p>}
                {canViewPosts && postsError && (
                  <p className="status status-error">{postsError}</p>
                )}
                {canViewPosts && !postsLoading && !postsError && posts.length === 0 && (
                  <p className="status">No posts yet.</p>
                )}
                {canViewPosts && posts.length > 0 && !postsLoading && !postsError && (
                  <FriendPostsFeed posts={posts} onPostsChange={setPosts} />
                )}
              </section>
            </div>
          </>
        )}
      </div>

      {reportOpen && profile && (
        <div className="friend-report-overlay" role="dialog" aria-modal="true">
          <div className="friend-report-modal">
            <div className="friend-report-header">
              <div>
                <p className="eyebrow">Report</p>
                <h3>Report {displayName}</h3>
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
