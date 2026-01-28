// src/pages/Dashboard.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/strapi";
import axios from "axios";
import "../css/dashboard.css";
import { useAuth } from "../context/AuthContext";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import { usePageMeta } from "../hooks/usePageMeta";
import { useUserPreferences } from "../context/UserPreferencesContext";
import type { SignalTag } from "../constants/signalTags";
import { sanitizePostText } from "../utils/emoji";
import ReactionPicker from "../components/ReactionPicker";
import { formatPostUpdateLabel } from "../utils/time";
import { pickMediaUrl } from "../utils/media";
// import NewsWidget from "../components/NewsWidget";
import "../css/news-widget.css";

type CommentItem = {
  id: string | number;
  body: string;
  owner?: string;
  ownerId?: string | number;
};

type NormalizedPost = {
  id: string | number;
  title: string;
  content: string;
  imageUrl?: string;
  createdAt?: string;
  source: "user" | "group" | "admin";
  ownerName?: string;
  ownerId?: number;
  likes?: number;
  shares?: number;
  comments: CommentItem[];
  groupName?: string;
  groupId?: number;
  signalTag?: SignalTag;
  feedbackAudience?: string;
  feedbackTargetId?: number;
  feedbackTargetName?: string;
  visibility?: string;
};

type PostFilter = "all" | "admin" | "friends" | "private" | "public";

type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
};

type FriendOption = {
  id: number;
  label: string;
};

type UnknownRecord = Record<string, unknown>;

type PostsState = {
  user: unknown[];
  group: unknown[];
  comments: unknown[];
  admin: unknown[];
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;
const asRecord = (value: unknown): UnknownRecord => (isRecord(value) ? value : {});
const getString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
const normalize = (entry: unknown): UnknownRecord => {
  if (!isRecord(entry)) return {};
  const attrs = entry.attributes;
  return isRecord(attrs) ? attrs : entry;
};
const getEntity = (entry: unknown): unknown => {
  if (!isRecord(entry)) return entry ?? null;
  if ("data" in entry) {
    return entry.data ?? null;
  }
  return entry;
};
const getEntityId = (entry: unknown) => {
  const data = getEntity(entry);
  if (typeof data === "number") return Number.isFinite(data) ? data : undefined;
  if (typeof data === "string") {
    const num = Number(data);
    return Number.isFinite(num) ? num : undefined;
  }
  if (isRecord(data)) {
    const rawId = data.id ?? (isRecord(data.attributes) ? data.attributes.id : undefined);
    const num = Number(rawId);
    return Number.isFinite(num) ? num : undefined;
  }
  return undefined;
};
const getOwnerName = (owner: unknown, fallback: string) => {
  const ownerAttrs = normalize(getEntity(owner)) as {
    email?: string;
  };
  return getString(ownerAttrs.email) ?? (typeof owner === "string" ? owner : fallback);
};
const cleanNameFallback = (value?: string) => {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.includes("@")) return text.split("@")[0];
  return text;
};
const firstNameFromLabel = (value?: string) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.split(/\s+/)[0] || "";
};

const PREVIEW_DEBOUNCE_MS = 450;
const PREVIEW_MAX_CONCURRENT = 3;
const POSTS_PAGE_SIZE = 20;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_UPLOAD_LABEL = "1 GB";
const extractFirstUrl = (text: string) => {
  const match = text.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
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
const isVideoUrl = (value?: string) => !!value && /\.(mp4|webm|mov|m4v|mkv)$/i.test(value);
const isVideoFile = (file: File) => {
  if (file.type && file.type.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|m4v|mkv)$/i.test(file.name);
};
const mediaDescriptor = (mediaUrl?: string, hasLink?: boolean) => {
  if (mediaUrl) return isVideoUrl(mediaUrl) ? "with a video" : "with a picture";
  if (hasLink) return "with a link";
  return "";
};
const buildIdFilter = (field: string, ids: number[]) =>
  ids.map((id, index) => `filters[${field}][id][$in][${index}]=${id}`).join("&");
const buildOrIdFilter = (groupIndex: number, field: string, ids: number[]) =>
  ids
    .map(
      (id, index) =>
        `filters[$or][${groupIndex}][${field}][id][$in][${index}]=${id}`
    )
    .join("&");
const buildUserPostsQuery = (ownerIds: number[]) => {
  const parts: string[] = [];
  let groupIndex = 0;
  if (ownerIds.length) {
    parts.push(buildOrIdFilter(groupIndex, "owner", ownerIds));
    groupIndex += 1;
  }
  parts.push(`filters[$or][${groupIndex}][visibility][$eq]=public`);
  groupIndex += 1;
  parts.push(`filters[$or][${groupIndex}][feedbackAudience][$eq]=public`);
  return `${parts.join("&")}&includeDemo=true`;
};
const getPostKey = (entry: unknown) => {
  const record = asRecord(entry);
  const rawId = record.id ?? record.documentId;
  return rawId === undefined ? "" : String(rawId);
};
const mergePostLists = (prev: unknown[], next: unknown[]) => {
  if (!next.length) return prev;
  const seen = new Set(prev.map((entry) => getPostKey(entry)).filter(Boolean));
  const merged = [...prev];
  next.forEach((entry) => {
    const key = getPostKey(entry);
    if (key && seen.has(key)) return;
    merged.push(entry);
    if (key) seen.add(key);
  });
  return merged;
};
const feedbackLabelFor = (post: NormalizedPost) => {
  const audience = post.feedbackAudience;
  if (!audience || audience === "none") return "";
  if (audience === "public") return "Feedback: Public";
  if (audience === "friends") return "Feedback: Friends";
  if (audience === "specific") {
    return `Feedback: ${post.feedbackTargetName || "A friend"}`;
  }
  return "";
};
const sortByCreatedAtDesc = (items: NormalizedPost[]) =>
  [...items].sort((a, b) => {
    const aParsed = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bParsed = b.createdAt ? Date.parse(b.createdAt) : 0;
    const aTime = Number.isNaN(aParsed) ? 0 : aParsed;
    const bTime = Number.isNaN(bParsed) ? 0 : bParsed;
    return bTime - aTime;
  });

const MOTIVATIONAL_PHRASES = [
  "Small steps today build the momentum you want tomorrow.",
  "Show up for yourself and the win will follow.",
  "Progress over perfection, always.",
  "Keep going. Your future self is already grateful.",
  "Consistency beats intensity. You have this.",
  "One focused action can change your whole day.",
  "You do not need to be perfect, just present.",
  "Start where you are and make the next right move.",
  "A calm mind creates strong progress.",
  "Choose progress, even if it is tiny.",
  "Your effort today is the seed of tomorrow.",
  "Keep the promise you made to yourself.",
  "You are closer than you think.",
  "One step forward is still forward.",
  "Little wins stack into big wins.",
  "You are building something that matters.",
  "Your pace is valid. Keep moving.",
  "Focus on what you can do in the next 10 minutes.",
  "Consistency turns dreams into plans.",
  "Take the next small action and breathe.",
  "Momentum loves a simple start.",
  "Be proud of showing up today.",
  "Quiet effort makes loud results.",
  "You can do hard things, one step at a time.",
  "Your future is shaped by what you do today.",
  "Choose progress over pressure.",
  "The habit is the win.",
  "Stay curious, stay kind, keep going.",
  "You are not behind. You are building.",
  "Your small action is still brave.",
  "Today counts, even if it feels ordinary.",
  "Make it simple. Then make it happen.",
  "Keep your focus narrow and your hope wide.",
  "You have what you need to begin.",
  "Your effort is already a success.",
  "Strong days start with one clear choice.",
  "Your goals want your attention, not your stress.",
  "One honest step beats ten perfect plans.",
  "You are doing better than you think.",
  "Keep your energy for what matters most.",
  "Be steady, be kind, be consistent.",
  "Your progress is real. Keep showing up.",
  "Let today be the day you move forward.",
  "Do the next doable thing.",
  "You are allowed to grow at your speed.",
  "Small moves, big direction.",
  "Every rep makes you stronger.",
  "Your momentum is building right now.",
  "Focus on the process and the results will follow.",
  "You are a builder. Keep building.",
  "You are stronger than your last excuse.",
  "Start small. Finish proud.",
  "Choose action over doubt.",
  "Your future self says thank you.",
  "Keep your eyes on the next step.",
  "Discipline is a gift you give yourself.",
  "You can reset and restart any time.",
  "Consistency is your superpower.",
  "Your effort is the plan.",
  "Do it imperfectly, do it today.",
  "Keep going, your growth is showing.",
  "One brave step changes everything.",
  "You are not alone in the work.",
  "Focus, breathe, move forward.",
  "You are creating your own momentum.",
  "The smallest step still moves you ahead.",
  "Your courage is in the try.",
  "Be the friend you need today.",
  "Progress loves patience.",
  "Let your actions speak louder than your doubts.",
  "Simple and steady beats rushed and messy.",
  "You are building trust with yourself.",
  "Your best effort today is enough.",
  "You have the power to choose a better next step.",
  "Keep your goals close and your worries far.",
  "You can do one more small thing.",
  "Your growth is worth the time.",
  "Show up. Breathe. Begin.",
  "You are building a life you believe in.",
  "Do the work, keep the faith.",
  "One good choice can set the tone for the day.",
  "You are capable of steady progress.",
  "Take the next step, then the next.",
  "You do not have to rush. Just continue.",
  "Your progress is proof of your strength.",
  "Keep your eyes on what you can control.",
  "Today is a fresh chance to try.",
  "Make it simple, make it consistent.",
  "You are doing the right kind of hard work.",
  "Your effort is building real change.",
  "Trust the process and keep your focus.",
  "You are allowed to be a work in progress.",
  "One focused hour beats a scattered day.",
  "You are capable of more than you feel today.",
  "Keep the routine, keep the dream.",
  "Progress is built in the quiet moments.",
  "Your dedication is paying off.",
  "Choose a small win right now.",
  "You are making steady forward motion.",
  "Do not quit. Adjust and continue.",
  "Your consistency is your edge.",
  "You are doing something meaningful today.",
  "Keep going. Your momentum is real.",
];

const LinkPreviewCard = ({
  preview,
  url,
  compact = false,
}: {
  preview: LinkPreview;
  url: string;
  compact?: boolean;
}) => {
  const title = preview.title || preview.siteName || hostnameFor(url);
  const meta = preview.siteName || hostnameFor(url);
  const showBadge = preview.type === "video" || isYoutubeUrl(url);
  return (
    <a
      className={`link-preview-card${compact ? " is-compact" : ""}`}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <div className="link-preview-media">
        {preview.image ? (
          <img src={preview.image} alt={title} loading="lazy" />
        ) : (
          <div className="link-preview-placeholder">LINK</div>
        )}
        {showBadge && <span className="link-preview-badge">Video</span>}
      </div>
      <div className="link-preview-body">
        <p className="link-preview-title">{title}</p>
        {preview.description && (
          <p className="link-preview-desc">{preview.description}</p>
        )}
        <span className="link-preview-url">{meta}</span>
      </div>
    </a>
  );
};

export default function Dashboard() {
  const [posts, setPosts] = useState<PostsState>({
    user: [],
    group: [],
    comments: [],
    admin: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formContent, setFormContent] = useState("");
  const [formFile, setFormFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [postVisibility, setPostVisibility] = useState("friends");
  const [feedbackAudience, setFeedbackAudience] = useState("none");
  const [feedbackTargetId, setFeedbackTargetId] = useState<number | null>(null);
  const [postFilter, setPostFilter] = useState<PostFilter>("all");
  const [friendOptions, setFriendOptions] = useState<FriendOption[]>([]);
  const [friendIds, setFriendIds] = useState<number[]>([]);
  const [, setFavoriteFriendIds] = useState<number[]>([]);
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [commentInputs, setCommentInputs] = useState<Record<string | number, string>>({});
  const [openCommentsFor, setOpenCommentsFor] = useState<Record<string | number, boolean>>(
    {}
  );
  const [reactionPickerFor, setReactionPickerFor] = useState<string | number | null>(null);
  const [shareMenuFor, setShareMenuFor] = useState<string | number | null>(null);
  const [shareNotice, setShareNotice] = useState<Record<string | number, string>>({});
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [activePostKey, setActivePostKey] = useState<string | null>(null);
  const [formFilePreviewUrl, setFormFilePreviewUrl] = useState<string | null>(null);
  const [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null);
  const [linkPreviewLoading, setLinkPreviewLoading] = useState(false);
  const [linkPreviewError, setLinkPreviewError] = useState<string | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, LinkPreview | null>>({});
  const previewQueueRef = useRef<string[]>([]);
  const previewInFlightRef = useRef(0);
  const previewPendingRef = useRef<Set<string>>(new Set());
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [profileNameMap, setProfileNameMap] = useState<Record<number, string>>({});
  const [userPostsPage, setUserPostsPage] = useState(1);
  const [groupPostsPage, setGroupPostsPage] = useState(1);
  const [hasMoreUserPosts, setHasMoreUserPosts] = useState(true);
  const [hasMoreGroupPosts, setHasMoreGroupPosts] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const loadIdRef = useRef(0);
  const [showGoToTop, setShowGoToTop] = useState(false);
  const hashFetchRef = useRef<string | null>(null);

  const navigate = useNavigate();
  const location = useLocation();
  const hashHandledRef = useRef<string | null>(null);
  const { user, profile } = useAuth();
  const { getBackgroundStyle } = useUserPreferences();
  usePageMeta({
    title: "Dashboard | Your Social Place",
    description:
      "Share updates, celebrate wins, and stay accountable with your your social place community.",
    type: "website",
    robots: "noindex, nofollow",
  });
  const nameFromProfile = `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim();
  const userLabel = nameFromProfile || user?.email || "Friend";
  const userInitial = userLabel.charAt(0).toUpperCase();
  const userId = user?.id;
  const formFileIsVideo = formFile ? isVideoFile(formFile) : false;

  useEffect(() => {
    if (!formFile) {
      setFormFilePreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(formFile);
    setFormFilePreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [formFile]);

  useEffect(() => {
    if (feedbackAudience !== "specific") {
      setFeedbackTargetId(null);
      return;
    }
    if (!friendOptions.length) {
      setFeedbackTargetId(null);
      return;
    }
    if (feedbackTargetId && friendOptions.some((option) => option.id === feedbackTargetId)) {
      return;
    }
    setFeedbackTargetId(friendOptions[0].id);
  }, [feedbackAudience, feedbackTargetId, friendOptions]);

  useEffect(() => {
    let active = true;

    const loadAvatar = async () => {
      if (!user) {
        setProfileAvatarUrl(null);
        return;
      }
      try {
        const res = await api.get(`/profiles?filters[user][id][$eq]=${user.id}&populate=avatar`);
        const entry = res.data?.data?.[0];
        const avatarUrl = entry
          ? pickMediaUrl(normalize(entry).avatar, { kind: "avatar" })
          : undefined;
        if (active) setProfileAvatarUrl(avatarUrl || null);
      } catch {
        if (active) setProfileAvatarUrl(null);
      }
    };

    loadAvatar();
    return () => {
      active = false;
    };
  }, [user]);


  const reloadPosts = useCallback(
    async (options?: { silent?: boolean }) => {
      const loadId = ++loadIdRef.current;
      if (!options?.silent) {
        setLoading(true);
      }
      setError(null);

      const token = localStorage.getItem("token");
      if (!token) {
        if (!options?.silent) {
          setLoading(false);
        }
        navigate("/login");
        return;
      }

      try {
        if (!userId) {
          if (!options?.silent) {
            setLoading(false);
          }
          return;
        }

        const friendsRes = await api.get(
          `/friends?filters[$or][0][requester][id][$eq]=${userId}` +
            `&filters[$or][1][target][id][$eq]=${userId}` +
            `&populate=requester&populate=target`
        );

        if (loadId !== loadIdRef.current) return;

        const acceptedIds = new Set<number>();
        const favoriteIds = new Set<number>();
        const friendOptionMap = new Map<number, FriendOption>();
        (friendsRes.data?.data ?? []).forEach((entry: unknown) => {
          const attrs = normalize(entry) as {
            status?: string;
            requester?: unknown;
            target?: unknown;
            requesterFavorite?: boolean;
            targetFavorite?: boolean;
          };
          const status = getString(attrs.status) ?? "pending";
          if (status !== "accepted") return;
          const requesterId = getEntityId(attrs.requester);
          const targetId = getEntityId(attrs.target);
          const otherId = requesterId === userId ? targetId : requesterId;
          const otherUser = requesterId === userId ? attrs.target : attrs.requester;
          if (otherId) {
            acceptedIds.add(otherId);
            const isRequester = requesterId === userId;
            const isFavorite = isRequester
              ? Boolean(attrs.requesterFavorite)
              : Boolean(attrs.targetFavorite);
            if (isFavorite) {
              favoriteIds.add(otherId);
            }
            friendOptionMap.set(otherId, {
              id: otherId,
              label: getOwnerName(otherUser, `User ${otherId}`),
            });
          }
        });
        const nextFriendIds = Array.from(acceptedIds);
        setFriendIds(nextFriendIds);
        setFavoriteFriendIds(Array.from(favoriteIds));
        const nextFriendOptions = Array.from(friendOptionMap.values()).sort((a, b) =>
          a.label.localeCompare(b.label)
        );
        setFriendOptions(nextFriendOptions);

        const groupMembersRes = await api.get(
          `/group-members?filters[user][id][$eq]=${userId}&populate=group&pagination[pageSize]=200`
        );
        const memberGroups: number[] = (groupMembersRes.data?.data ?? [])
          .map((entry: unknown) => {
            const attrs = normalize(entry) as { group?: unknown };
            return getEntityId(attrs.group);
          })
          .filter((id: unknown): id is number => typeof id === "number" && Number.isFinite(id));
        setGroupIds(memberGroups);

        const userFilterIds = Array.from(new Set([userId, ...nextFriendIds]));
        const userQuery = buildUserPostsQuery(userFilterIds);
        const groupFilter = memberGroups.length ? buildIdFilter("group", memberGroups) : "";

        const [adminRes, userRes, groupRes, commentsRes] = await Promise.all([
          api.get(`/posts?populate=Pictures&pagination[pageSize]=${POSTS_PAGE_SIZE}`),
          api.get(
            `/users-posts?${userQuery}&populate=Users_Pictures&populate=owner&populate=feedbackTarget` +
              `&sort=createdAt:desc&pagination[pageSize]=${POSTS_PAGE_SIZE}&pagination[page]=1`
          ),
          memberGroups.length
            ? api.get(
                `/group-posts?${groupFilter}&populate=media&populate=owner&populate=group` +
                  `&sort=createdAt:desc&pagination[pageSize]=${POSTS_PAGE_SIZE}&pagination[page]=1`
              )
            : Promise.resolve({ data: { data: [], meta: {} } }),
          api.get("/comments?populate=owner"),
        ]);

        if (loadId !== loadIdRef.current) return;

        const allComments = commentsRes.data?.data ?? [];
        const userPostsData = userRes.data?.data ?? [];
        const groupPostsData = groupRes.data?.data ?? [];
        const profileIds = new Set<number>();
        const addProfileId = (id?: number) => {
          if (typeof id === "number" && Number.isFinite(id)) {
            profileIds.add(id);
          }
        };
        const collectOwnerId = (owner: unknown) => {
          const ownerId = getEntityId(owner);
          if (ownerId) profileIds.add(ownerId);
        };
        addProfileId(userId);
        nextFriendIds.forEach((id) => addProfileId(id));

        userPostsData.forEach((entry: unknown) => {
          const attrs = normalize(entry) as {
            owner?: unknown;
            feedbackTarget?: unknown;
          };
          collectOwnerId(attrs.owner ?? asRecord(entry).owner);
          collectOwnerId(attrs.feedbackTarget);
        });

        groupPostsData.forEach((entry: unknown) => {
          const attrs = normalize(entry) as { owner?: unknown };
          collectOwnerId(attrs.owner ?? asRecord(entry).owner);
        });

        allComments.forEach((entry: unknown) => {
          const record = asRecord(entry);
          const attrs = asRecord(record.attributes);
          collectOwnerId(attrs.owner ?? record.owner);
        });

        let nextNameMap: Record<number, string> = {};
        if (userId && nameFromProfile) {
          nextNameMap[userId] = nameFromProfile;
        }

        if (profileIds.size > 0) {
          const profileFilter = Array.from(profileIds)
            .map((id, index) => `filters[user][id][$in][${index}]=${id}`)
            .join("&");
          try {
            const profilesRes = await api.get(
              `/profiles?${profileFilter}&populate=user&pagination[pageSize]=200`
            );
            (profilesRes.data?.data ?? []).forEach((entry: unknown) => {
              const attrs = normalize(entry) as {
                firstName?: string;
                lastName?: string;
                firstname?: string;
                lastname?: string;
                handle?: string;
                user?: unknown;
              };
              const userAttrs = normalize(getEntity(attrs.user)) as { email?: string };
              const profileUserId = getEntityId(attrs.user);
              if (!profileUserId) return;
              const firstName = String(attrs.firstName || attrs.firstname || "").trim();
              const lastName = String(attrs.lastName || attrs.lastname || "").trim();
              const fullName = `${firstName} ${lastName}`.trim();
              const fallback = String(attrs.handle || userAttrs.email || "").trim();
              const label = fullName || fallback;
              if (label) {
                nextNameMap[profileUserId] = label;
              }
            });
          } catch {
            // ignore profile name mapping failures
          }
        }

        const userPagination = userRes.data?.meta?.pagination;
        const groupPagination = groupRes.data?.meta?.pagination;
        setUserPostsPage(1);
        setGroupPostsPage(1);
        setHasMoreUserPosts(
          userPagination
            ? userPagination.page < userPagination.pageCount
            : userPostsData.length >= POSTS_PAGE_SIZE
        );
        setHasMoreGroupPosts(
          memberGroups.length
            ? groupPagination
              ? groupPagination.page < groupPagination.pageCount
              : groupPostsData.length >= POSTS_PAGE_SIZE
            : false
        );

        setProfileNameMap(nextNameMap);
        setPosts({
          user: userPostsData,
          group: groupPostsData,
          comments: allComments,
          admin: adminRes.data?.data ?? [],
        });
      } catch (err: unknown) {
        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          const data = err.response?.data as
            | { error?: { message?: string }; message?: string }
            | undefined;
          const msg =
            data?.error?.message || data?.message || "Failed to load posts";

          if (status === 401) {
            setError(
              `401 Unauthorized. Token still in storage: ${
                !!localStorage.getItem("token")
              }. Message: ${msg}`
            );
            return;
          }

          if (status === 403) {
            setError(
              "403 Forbidden: Enable Authenticated role permissions for Posts (find/findOne) in Strapi."
            );
            return;
          }

          setError(msg);
        } else {
          setError("Failed to load posts");
        }
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [nameFromProfile, navigate, userId]
  );

  useEffect(() => {
    void reloadPosts();
  }, [reloadPosts]);

  const loadMorePosts = useCallback(async () => {
    if (isLoadingMore) return;
    if (!hasMoreUserPosts && !hasMoreGroupPosts) return;
    if (!userId) return;

    const userFilterIds = Array.from(new Set([userId, ...friendIds]));
    const shouldLoadUser = hasMoreUserPosts;
    const shouldLoadGroup = hasMoreGroupPosts && groupIds.length > 0;
    if (!shouldLoadUser && !shouldLoadGroup) return;

    setIsLoadingMore(true);
    const loadId = loadIdRef.current;
    try {
      const nextUserPage = shouldLoadUser ? userPostsPage + 1 : userPostsPage;
      const nextGroupPage = shouldLoadGroup ? groupPostsPage + 1 : groupPostsPage;
      const userQuery = buildUserPostsQuery(userFilterIds);
      const groupFilter = shouldLoadGroup ? buildIdFilter("group", groupIds) : "";

      const [userRes, groupRes] = await Promise.all([
        shouldLoadUser
          ? api.get(
              `/users-posts?${userQuery}&populate=Users_Pictures&populate=owner&populate=feedbackTarget` +
                `&sort=createdAt:desc&pagination[pageSize]=${POSTS_PAGE_SIZE}&pagination[page]=${nextUserPage}`
            )
          : Promise.resolve({ data: { data: [], meta: {} } }),
        shouldLoadGroup
          ? api.get(
              `/group-posts?${groupFilter}&populate=media&populate=owner&populate=group` +
                `&sort=createdAt:desc&pagination[pageSize]=${POSTS_PAGE_SIZE}&pagination[page]=${nextGroupPage}`
            )
          : Promise.resolve({ data: { data: [], meta: {} } }),
      ]);

      if (loadId !== loadIdRef.current) return;

      const userPostsData = userRes.data?.data ?? [];
      const groupPostsData = groupRes.data?.data ?? [];

      if (shouldLoadUser) {
        const userPagination = userRes.data?.meta?.pagination;
        setUserPostsPage(nextUserPage);
        setHasMoreUserPosts(
          userPagination
            ? userPagination.page < userPagination.pageCount
            : userPostsData.length >= POSTS_PAGE_SIZE
        );
      }
      if (shouldLoadGroup) {
        const groupPagination = groupRes.data?.meta?.pagination;
        setGroupPostsPage(nextGroupPage);
        setHasMoreGroupPosts(
          groupPagination
            ? groupPagination.page < groupPagination.pageCount
            : groupPostsData.length >= POSTS_PAGE_SIZE
        );
      }

      if (userPostsData.length || groupPostsData.length) {
        setPosts((prev) => ({
          ...prev,
          user: shouldLoadUser ? mergePostLists(prev.user, userPostsData) : prev.user,
          group: shouldLoadGroup ? mergePostLists(prev.group, groupPostsData) : prev.group,
        }));
      }
    } catch (err) {
      console.error("Load more posts failed", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [
    friendIds,
    groupIds,
    hasMoreGroupPosts,
    hasMoreUserPosts,
    isLoadingMore,
    userId,
    userPostsPage,
    groupPostsPage,
  ]);

  useEffect(() => {
    const node = loadMoreRef.current;
    if (!node) return;
    if (!hasMoreUserPosts && !hasMoreGroupPosts) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMorePosts();
        }
      },
      { rootMargin: "240px" }
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [hasMoreGroupPosts, hasMoreUserPosts, loadMorePosts]);

  const fetchLinkPreview = useCallback(
    async (url: string, options?: { silent?: boolean }): Promise<LinkPreview | null> => {
      if (!url) return null;
      if (previewCache[url] !== undefined) return previewCache[url];

      if (!options?.silent) {
        setLinkPreviewLoading(true);
        setLinkPreviewError(null);
      }

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
        setPreviewCache((prev) => ({ ...prev, [url]: preview }));
        return preview;
      } catch {
        setPreviewCache((prev) => ({ ...prev, [url]: null }));
        if (!options?.silent) {
          setLinkPreviewError("Unable to load link preview.");
        }
        return null;
      } finally {
        if (!options?.silent) {
          setLinkPreviewLoading(false);
        }
      }
    },
    [previewCache]
  );

  const processPreviewQueue = useCallback(() => {
    if (previewInFlightRef.current >= PREVIEW_MAX_CONCURRENT) return;
    const queue = previewQueueRef.current;

    while (queue.length && previewInFlightRef.current < PREVIEW_MAX_CONCURRENT) {
      const nextUrl = queue.shift();
      if (!nextUrl) break;
      if (previewCache[nextUrl] !== undefined) {
        previewPendingRef.current.delete(nextUrl);
        continue;
      }

      previewInFlightRef.current += 1;
      void fetchLinkPreview(nextUrl, { silent: true }).finally(() => {
        previewInFlightRef.current = Math.max(0, previewInFlightRef.current - 1);
        previewPendingRef.current.delete(nextUrl);
        processPreviewQueue();
      });
    }
  }, [fetchLinkPreview, previewCache]);

  const enqueuePreview = useCallback(
    (url: string) => {
      if (!url) return;
      if (previewCache[url] !== undefined) return;
      if (previewPendingRef.current.has(url)) return;

      previewPendingRef.current.add(url);
      previewQueueRef.current.push(url);
      processPreviewQueue();
    },
    [previewCache, processPreviewQueue]
  );

  const categorizedPosts = useMemo(() => {
    const allComments = posts.comments ?? [];
    const resolveOwnerName = (ownerId?: number, fallback?: string) => {
      const mapped = ownerId ? profileNameMap[ownerId] : undefined;
      const base = mapped || cleanNameFallback(fallback) || fallback || "";
      const firstName = firstNameFromLabel(base);
      return firstName || base || "User";
    };

    const normalizeUserPost = (post: unknown): NormalizedPost => {
      const attributes = normalize(post) as {
        Title?: string;
        title?: string;
        Users_Content?: string;
        content?: string;
        Users_Pictures?: unknown;
        pictures?: unknown;
        owner?: unknown;
        createdAt?: string;
        signalTag?: SignalTag;
        feedbackAudience?: string;
        feedbackTarget?: unknown;
        likes?: number;
        shares?: number;
        visibility?: string;
      };
      const title = getString(attributes.Title) ?? getString(attributes.title) ?? "Untitled";
      const content =
        getString(attributes.Users_Content) ?? getString(attributes.content) ?? "";

      const picturesRaw = getEntity(attributes.Users_Pictures) ?? getEntity(attributes.pictures);
      const mediaItem = Array.isArray(picturesRaw) ? picturesRaw[0] : picturesRaw;
      const imageUrl = pickMediaUrl(mediaItem, { kind: "post" });

      const postRecord = asRecord(post);
      const rawPostId = postRecord.id ?? postRecord.documentId;
      const targetIdStr = rawPostId === undefined ? "" : String(rawPostId);
      const matchedComments = allComments
        .filter((comment) => {
          const commentRecord = asRecord(comment);
          const targetType = String(commentRecord.target_type ?? "").toLowerCase();
          const targetId =
            commentRecord.target_id === undefined ? "" : String(commentRecord.target_id);
          return (
            (targetType === "user" || targetType === "users-post") &&
            targetId === targetIdStr
          );
        })
        .map((comment) => {
          const commentRecord = asRecord(comment);
          const commentAttrs = asRecord(commentRecord.attributes);
          const ownerSource = commentAttrs.owner ?? commentRecord.owner;
          const commentId =
            typeof commentRecord.id === "string" || typeof commentRecord.id === "number"
              ? commentRecord.id
              : String(commentRecord.id ?? "");
          return {
            id: commentId,
            body: getString(commentRecord.body) ?? "",
            owner: resolveOwnerName(
              getEntityId(ownerSource),
              getOwnerName(ownerSource, "User")
            ),
            ownerId: getEntityId(ownerSource),
          };
        });

      const ownerData = getEntity(attributes.owner);
      const ownerAttrs = normalize(ownerData) as { email?: string };
      const ownerId = getEntityId(ownerData);
      const ownerName = resolveOwnerName(ownerId, getString(ownerAttrs.email) ?? "User");
      const visibility = getString(attributes.visibility);
      const feedbackTargetData = getEntity(attributes.feedbackTarget);
      const feedbackTargetAttrs = normalize(feedbackTargetData) as {
        email?: string;
      };
      const feedbackTargetId = getEntityId(feedbackTargetData);
      const feedbackTargetName = feedbackTargetId
        ? resolveOwnerName(
            feedbackTargetId,
            getString(feedbackTargetAttrs.email) ?? `User ${feedbackTargetId}`
          )
        : undefined;
      const postId =
        typeof rawPostId === "string" || typeof rawPostId === "number" ? rawPostId : title;
      const likes = Number(attributes.likes ?? 0);
      const shares = Number(attributes.shares ?? 0);

      return {
        id: postId,
        title,
        content,
        imageUrl,
        createdAt: getString(attributes.createdAt),
        source: "user",
        ownerName,
        ownerId,
        likes,
        shares,
        comments: matchedComments,
        visibility,
        signalTag: attributes.signalTag || "check-in",
        feedbackAudience: getString(attributes.feedbackAudience),
        feedbackTargetId,
        feedbackTargetName,
      };
    };

    const normalizeGroupPost = (post: unknown): NormalizedPost => {
      const attributes = normalize(post) as {
        title?: string;
        Title?: string;
        body?: string;
        content?: string;
        media?: unknown;
        owner?: unknown;
        group?: unknown;
        createdAt?: string;
        signalTag?: SignalTag;
        likes?: number;
        shares?: number;
      };
      const title =
        getString(attributes.title) ?? getString(attributes.Title) ?? "Group update";
      const content = getString(attributes.body) ?? getString(attributes.content) ?? "";
      const mediaItem = getEntity(attributes.media);
      const imageUrl = pickMediaUrl(mediaItem, { kind: "post" });

      const ownerData = getEntity(attributes.owner);
      const ownerAttrs = normalize(ownerData) as { email?: string };
      const ownerId = getEntityId(ownerData);
      const ownerName = resolveOwnerName(ownerId, getString(ownerAttrs.email) ?? "Member");
      const groupData = getEntity(attributes.group);
      const groupAttrs = normalize(groupData) as { name?: string };
      const groupName = getString(groupAttrs.name) ?? "Group";
      const groupId = getEntityId(groupData);
      const postRecord = asRecord(post);
      const rawPostId = postRecord.id ?? postRecord.documentId;
      const postId =
        typeof rawPostId === "string" || typeof rawPostId === "number" ? rawPostId : title;
      const targetIdStr = rawPostId === undefined ? "" : String(rawPostId);
      const matchedComments = allComments
        .filter((comment) => {
          const commentRecord = asRecord(comment);
          const targetType = String(commentRecord.target_type ?? "").toLowerCase();
          const targetId =
            commentRecord.target_id === undefined ? "" : String(commentRecord.target_id);
          return (
            (targetType === "group-post" || targetType === "group") &&
            targetId === targetIdStr
          );
        })
        .map((comment) => {
          const commentRecord = asRecord(comment);
          const commentAttrs = asRecord(commentRecord.attributes);
          const ownerSource = commentAttrs.owner ?? commentRecord.owner;
          const commentId =
            typeof commentRecord.id === "string" || typeof commentRecord.id === "number"
              ? commentRecord.id
              : String(commentRecord.id ?? "");
          return {
            id: commentId,
            body: getString(commentRecord.body) ?? "",
            owner: resolveOwnerName(
              getEntityId(ownerSource),
              getOwnerName(ownerSource, "User")
            ),
            ownerId: getEntityId(ownerSource),
          };
        });

      return {
        id: postId,
        title,
        content,
        imageUrl,
        createdAt: getString(attributes.createdAt),
        source: "group",
        ownerName,
        ownerId,
        likes: Number(attributes.likes ?? 0),
        shares: Number(attributes.shares ?? 0),
        comments: matchedComments,
        groupName,
        groupId,
        signalTag: attributes.signalTag || "check-in",
      };
    };

    const normalizeAdminPost = (post: unknown): NormalizedPost => {
      const attributes = normalize(post) as {
        Title?: string;
        Posts_Content?: string;
        Pictures?: unknown;
        createdAt?: string;
        likes?: number;
        shares?: number;
      };
      const title = getString(attributes.Title) ?? "Announcement";
      const content = getString(attributes.Posts_Content) ?? "";

      const picturesRaw = getEntity(attributes.Pictures);
      const mediaItem = Array.isArray(picturesRaw) ? picturesRaw[0] : picturesRaw;
      const imageUrl = pickMediaUrl(mediaItem, { kind: "post" });

      const postRecord = asRecord(post);
      const rawPostId = postRecord.id ?? postRecord.documentId;
      const targetIdStr = rawPostId === undefined ? "" : String(rawPostId);
      const matchedComments = allComments
        .filter((comment) => {
          const commentRecord = asRecord(comment);
          const targetType = String(commentRecord.target_type ?? "").toLowerCase();
          const targetId =
            commentRecord.target_id === undefined ? "" : String(commentRecord.target_id);
          return targetType === "admin" && targetId === targetIdStr;
        })
        .map((comment) => {
          const commentRecord = asRecord(comment);
          const commentAttrs = asRecord(commentRecord.attributes);
          const ownerSource = commentAttrs.owner ?? commentRecord.owner;
          const commentId =
            typeof commentRecord.id === "string" || typeof commentRecord.id === "number"
              ? commentRecord.id
              : String(commentRecord.id ?? "");
          return {
            id: commentId,
            body: getString(commentRecord.body) ?? "",
            owner: resolveOwnerName(
              getEntityId(ownerSource),
              getOwnerName(ownerSource, "User")
            ),
            ownerId: getEntityId(ownerSource),
          };
        });

      const postId =
        typeof rawPostId === "string" || typeof rawPostId === "number" ? rawPostId : title;

      return {
        id: postId,
        title,
        content,
        imageUrl,
        createdAt: getString(attributes.createdAt),
        source: "admin",
        ownerName: "Your Social Place",
        likes: Number(attributes.likes ?? 0),
        shares: Number(attributes.shares ?? 0),
        comments: matchedComments,
        signalTag: "check-in",
      };
    };

    const userPosts = posts.user.map((post) => normalizeUserPost(post));
    const groupPosts = posts.group.map((post) => normalizeGroupPost(post));
    const adminPosts = posts.admin.map((post) => normalizeAdminPost(post));
    const friendSet = new Set(friendIds);
    const currentUserId = typeof userId === "number" ? userId : undefined;
    const friendPosts: NormalizedPost[] = [];
    const privatePosts: NormalizedPost[] = [];
    const publicPosts: NormalizedPost[] = [];

    userPosts.forEach((post) => {
      const ownerId = post.ownerId;
      const isSelf = currentUserId && ownerId === currentUserId;
      const isFriend = ownerId && friendSet.has(ownerId);
      const visibility = post.visibility;
      const feedbackAudience = post.feedbackAudience;
      const isPublic = visibility === "public" || feedbackAudience === "public";
      const isPrivate = visibility === "private";
      const isFriendScoped =
        isSelf ||
        isFriend ||
        feedbackAudience === "friends" ||
        (feedbackAudience === "specific" && post.feedbackTargetId === currentUserId);

      if (isPrivate) {
        if (isSelf) {
          privatePosts.push(post);
        }
        return;
      }
      if (isFriendScoped) {
        friendPosts.push(post);
        return;
      }
      if (isPublic) {
        publicPosts.push(post);
        return;
      }
      publicPosts.push(post);
    });

    const adminSorted = sortByCreatedAtDesc(adminPosts);
    const friendsSorted = sortByCreatedAtDesc(friendPosts);
    const privateSorted = sortByCreatedAtDesc(privatePosts);
    const publicSorted = sortByCreatedAtDesc([...publicPosts, ...groupPosts]);

    return {
      admin: adminSorted,
      friends: friendsSorted,
      private: privateSorted,
      public: publicSorted,
      ordered: [...adminSorted, ...friendsSorted, ...privateSorted, ...publicSorted],
    };
  }, [friendIds, posts, profileNameMap, userId]);

  const visiblePosts = useMemo(() => {
    switch (postFilter) {
      case "admin":
        return categorizedPosts.admin;
      case "friends":
        return categorizedPosts.friends;
      case "private":
        return categorizedPosts.private;
      case "public":
        return categorizedPosts.public;
      default:
        return categorizedPosts.ordered;
    }
  }, [categorizedPosts, postFilter]);

  const activePost = useMemo(() => {
    if (!activePostKey) return null;
    return (
      categorizedPosts.ordered.find((post) => String(post.id) === activePostKey) ?? null
    );
  }, [activePostKey, categorizedPosts]);

  const fetchUserPostByKey = useCallback(async (postKey: string) => {
    if (!postKey) return false;
    try {
      const res = await api.get(
        `/users-posts/${postKey}?populate=Users_Pictures&populate=owner&populate=feedbackTarget`
      );
      const entry = res.data?.data;
      if (!entry) return false;
      setPosts((prev) => ({
        ...prev,
        user: mergePostLists(prev.user, [entry]),
      }));
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const hash = location.hash;
    if (!hash) return;
    const hashKey = `${location.key}:${hash}`;
    if (hashHandledRef.current === hashKey && visiblePosts.length) return;
    const id = hash.replace(/^#/, "");
    if (!id) return;
    const postKey = id.startsWith("post-") ? id.slice(5) : id;
    if (!postKey) return;
    if (postFilter !== "all") {
      setPostFilter("all");
    }
    const existingPost = categorizedPosts.ordered.find(
      (post) => String(post.id) === postKey
    );
    if (existingPost) {
      hashHandledRef.current = hashKey;
      setActivePostKey(postKey);
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      return;
    }
    if (hashFetchRef.current === postKey) return;
    hashFetchRef.current = postKey;
    void (async () => {
      const loaded = await fetchUserPostByKey(postKey);
      hashFetchRef.current = null;
      if (!loaded) return;
      hashHandledRef.current = hashKey;
      setActivePostKey(postKey);
      const target = document.getElementById(id);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    })();
  }, [
    categorizedPosts.ordered,
    fetchUserPostByKey,
    location.hash,
    location.key,
    postFilter,
    visiblePosts.length,
  ]);

  useEffect(() => {
    const url = extractFirstUrl(formContent);
    if (!url) {
      setLinkPreview(null);
      setLinkPreviewError(null);
      setLinkPreviewLoading(false);
      return;
    }

    setLinkPreviewError(null);
    if (linkPreview?.url === url) return;
    const cached = previewCache[url];
    if (cached !== undefined) {
      setLinkPreview(cached);
      return;
    }

    let active = true;
    const handle = setTimeout(() => {
      fetchLinkPreview(url).then((preview) => {
        if (!active) return;
        setLinkPreview(preview);
      });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [fetchLinkPreview, formContent, linkPreview?.url, previewCache]);

  useEffect(() => {
    const handleScroll = () => {
      setShowGoToTop(window.scrollY > 600);
    };
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const urls = Array.from(
      new Set(
        visiblePosts
          .map((post) => extractFirstUrl(post.content))
          .filter((url) => url)
      )
    );

    if (!urls.length) return;
    urls.forEach((url) => {
      enqueuePreview(url);
    });
  }, [enqueuePreview, visiblePosts]);

  const formatDate = (date?: string) => {
    if (!date) return "";
    try {
      return new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(date));
    } catch {
      return date;
    }
  };

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  }, []);
  const greetingLine = user ? `${greeting}, ${userLabel}` : greeting;

  const motivation = useMemo(() => {
    const index = Math.floor(Math.random() * MOTIVATIONAL_PHRASES.length);
    return MOTIVATIONAL_PHRASES[index] || "Keep showing up for yourself.";
  }, []);

  const createPost = async () => {
    const sanitized = sanitizePostText(formContent);
    const content = sanitized.trim();
    if (!content && !formFile) {
      setFormError("Add a message or a photo/video to post.");
      return;
    }
    if (feedbackAudience === "specific" && !feedbackTargetId) {
      setFormError("Choose a friend for a specific feedback request.");
      return;
    }

    const url = extractFirstUrl(content);
    const previewTitle = linkPreview?.url === url ? linkPreview.title : undefined;
    const derivedTitle =
      previewTitle || (url ? hostnameFor(url) : "") || content || "Post";

    if (formFile && formFile.size > MAX_UPLOAD_BYTES) {
      setFormError(`Media files must be under ${MAX_UPLOAD_LABEL}.`);
      return;
    }

    setFormError(null);
    setSubmitting(true);
    try {
      let uploadedId: number | undefined;

      if (formFile) {
        const fd = new FormData();
        fd.append("files", formFile);
        const uploadRes = await api.post("/upload", fd);
        const uploaded = uploadRes.data?.[0];
        uploadedId = uploaded?.id;
      }

      await api.post("/users-posts", {
        data: {
          Title: String(derivedTitle).slice(0, 80) || "Post",
          Users_Content: content,
          owner: user?.id,
          Users_Pictures: uploadedId ? [uploadedId] : undefined,
          visibility: postVisibility,
          feedbackAudience,
          feedbackTarget: feedbackAudience === "specific" ? feedbackTargetId : undefined,
        },
      });

      setFormContent("");
      setFormFile(null);
      setLinkPreview(null);
      setLinkPreviewError(null);
      setFeedbackAudience("none");
      setFeedbackTargetId(null);
      await reloadPosts({ silent: true });
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Failed to create post";
        setFormError(msg);
      } else {
        setFormError("Failed to create post");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const deletePost = async (postId: number) => {
    if (!window.confirm("Delete this post?")) return;
    try {
      await api.delete(`/users-posts/${postId}`);
      setPosts((prev) => ({
        ...prev,
        user: prev.user.filter((post) => {
          const record = asRecord(post);
          const rawId = record.id ?? record.documentId;
          const idValue = Number(rawId);
          return !Number.isFinite(idValue) || idValue !== postId;
        }),
      }));
    } catch (err) {
      console.error("Delete post failed", err);
      setError("Failed to delete post");
    }
  };

  const buildShareUrl = useCallback((postKey: string) => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}${window.location.pathname}#post-${postKey}`;
  }, []);

  const updatePostMetric = useCallback(
    (source: NormalizedPost["source"], postKey: string, field: "likes" | "shares", value: number) => {
      if (source !== "user" && source !== "group" && source !== "admin") return;
      setPosts((prev) => {
        const listKey = source === "group" ? "group" : source === "admin" ? "admin" : "user";
        const nextList = prev[listKey].map((entry) => {
          const record = asRecord(entry);
          const attrs = isRecord(record.attributes) ? record.attributes : record;
          const rawId = record.id ?? record.documentId ?? attrs.id ?? attrs.documentId;
          if (rawId === undefined || String(rawId) !== postKey) return entry;
          if (isRecord(record.attributes)) {
            return {
              ...record,
              attributes: { ...record.attributes, [field]: value },
            };
          }
          return { ...record, [field]: value };
        });
        return { ...prev, [listKey]: nextList };
      });
    },
    []
  );

  const pushShareNotice = useCallback((postKey: string, message: string) => {
    setShareNotice((prev) => ({ ...prev, [postKey]: message }));
    window.setTimeout(() => {
      setShareNotice((prev) => {
        if (!prev[postKey]) return prev;
        const next = { ...prev };
        delete next[postKey];
        return next;
      });
    }, 2400);
  }, []);

  const trackShare = useCallback(
    async (post: NormalizedPost, postKey: string) => {
      if (post.source !== "user" && post.source !== "group" && post.source !== "admin") return;
      try {
        const endpoint =
          post.source === "group"
            ? `/group-posts/${post.id}/share`
            : post.source === "admin"
            ? `/posts/${post.id}/share`
            : `/users-posts/${post.id}/share`;
        const res = await api.post(endpoint);
        const nextShares =
          Number(res.data?.data?.shares) || Number(post.shares ?? 0) + 1;
        updatePostMetric(post.source, postKey, "shares", nextShares);
      } catch (err) {
        console.error("Share tracking failed", err);
        pushShareNotice(postKey, "Unable to update share count.");
      }
    },
    [pushShareNotice, updatePostMetric]
  );

  const handleCopyShare = useCallback(
    async (post: NormalizedPost, postKey: string, shareUrl: string) => {
      if (!shareUrl) {
        pushShareNotice(postKey, "Unable to copy link.");
        return;
      }
      try {
        await navigator.clipboard.writeText(shareUrl);
        pushShareNotice(postKey, "Link copied.");
        await trackShare(post, postKey);
      } catch (err) {
        console.error("Copy link failed", err);
        pushShareNotice(postKey, "Unable to copy link.");
      }
    },
    [pushShareNotice, trackShare]
  );

  const handleNativeShare = useCallback(
    async (post: NormalizedPost, postKey: string, shareUrl: string, shareText: string) => {
      if (!navigator.share) {
        pushShareNotice(postKey, "Sharing is not available here.");
        return;
      }
      try {
        await navigator.share({ url: shareUrl, text: shareText });
        pushShareNotice(postKey, "Shared.");
        await trackShare(post, postKey);
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        console.error("Share failed", err);
        pushShareNotice(postKey, "Unable to share.");
      }
    },
    [pushShareNotice, trackShare]
  );

  const handleReaction = useCallback(
    async (post: NormalizedPost, postKey: string, emoji: string) => {
      if (post.source !== "user" && post.source !== "group" && post.source !== "admin") {
        pushShareNotice(postKey, "Reactions are not available here.");
        return;
      }
      try {
        const endpoint =
          post.source === "group"
            ? `/group-posts/${post.id}/react`
            : post.source === "admin"
            ? `/posts/${post.id}/react`
            : `/users-posts/${post.id}/react`;
        const res = await api.post(endpoint, { emoji });
        const payload = res.data?.data;
        const nextLikes = Number(payload?.likes) || Number(post.likes ?? 0) + 1;
        updatePostMetric(post.source, postKey, "likes", nextLikes);
        if (payload?.alreadyReacted) {
          pushShareNotice(
            postKey,
            payload?.updated ? `Reaction updated ${emoji}` : "You already reacted."
          );
        } else {
          pushShareNotice(postKey, `You reacted ${emoji}`);
        }
      } catch (err) {
        console.error("Reaction failed", err);
        pushShareNotice(postKey, "Unable to react right now.");
      }
    },
    [pushShareNotice, updatePostMetric]
  );

  const toggleComments = useCallback((postKey: string) => {
    setOpenCommentsFor((prev) => ({ ...prev, [postKey]: !prev[postKey] }));
    setReactionPickerFor(null);
    setShareMenuFor(null);
  }, []);

  const toggleReactionPicker = useCallback((postKey: string) => {
    setReactionPickerFor((prev) => (prev === postKey ? null : postKey));
    setShareMenuFor(null);
  }, []);

  const toggleShareMenu = useCallback((postKey: string) => {
    setShareMenuFor((prev) => (prev === postKey ? null : postKey));
    setReactionPickerFor(null);
  }, []);

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

  const handleDescriptorAction = useCallback(
    async (post: NormalizedPost, postKey: string, descriptor: string) => {
      if (descriptor === "with a picture" && post.imageUrl && !isVideoUrl(post.imageUrl)) {
        if (typeof window !== "undefined" && !window.confirm("Download this picture?")) {
          return;
        }
        if (typeof document === "undefined") return;
        const link = document.createElement("a");
        link.href = post.imageUrl;
        link.download = `post-${postKey}`;
        link.rel = "noreferrer";
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        link.remove();
        return;
      }

      if (descriptor === "with a link") {
        const url = extractFirstUrl(post.content);
        if (!url) return;
        const copied = await copyToClipboard(url);
        if (copied) {
          showCopyToast("Link Copied");
        }
        pushShareNotice(postKey, copied ? "Link Copied" : "Unable to copy link.");
      }
    },
    [copyToClipboard, pushShareNotice, showCopyToast]
  );

  const openPostModal = useCallback((postKey: string) => {
    setActivePostKey(postKey);
    setReactionPickerFor(null);
    setShareMenuFor(null);
  }, []);

  const closePostModal = useCallback(() => {
    setActivePostKey(null);
    if (location.hash) {
      navigate(
        { pathname: location.pathname, search: location.search, hash: "" },
        { replace: true }
      );
    }
  }, [location.hash, location.pathname, location.search, navigate]);

  const handleGoToTop = useCallback(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const handlePostCardClick = useCallback(
    (event: { target: EventTarget | null }, postKey: string) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(
          "button, a, input, textarea, select, label, .post-action-group, .post-action-popover, .comment-form, .comment-list, .post-meta-tag--action"
        )
      ) {
        return;
      }
      openPostModal(postKey);
    },
    [openPostModal]
  );

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".post-action-group")) return;
      setReactionPickerFor(null);
      setShareMenuFor(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!activePostKey) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActivePostKey(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePostKey]);

  useEffect(() => {
    if (!activePostKey) return;
    if (typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [activePostKey]);

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (activePostKey && !activePost) {
      setActivePostKey(null);
    }
  }, [activePostKey, activePost]);

  const activePostUrl = activePost ? extractFirstUrl(activePost.content) : "";
  const activePreview = activePostUrl ? previewCache[activePostUrl] : undefined;
  const activePreviewImage = activePreview?.image;
  const activeDescriptor = activePost
    ? mediaDescriptor(activePost.imageUrl, Boolean(activePostUrl))
    : "";
  const activeFeedbackLabel = activePost ? feedbackLabelFor(activePost) : "";
  const activeAuthorLabel = activePost?.ownerName || "User";
  const isActiveDescriptorActionable =
    activeDescriptor === "with a picture" || activeDescriptor === "with a link";
  const showActivePreviewMedia = Boolean(
    activePost && !activePost.imageUrl && activePreviewImage
  );
  const showActivePlaceholder = Boolean(
    activePost && !activePost.imageUrl && !activePreviewImage
  );
  const modalTitleId = activePostKey ? `post-modal-title-${activePostKey}` : undefined;

  return (
    <div className="dashboard-shell" style={getBackgroundStyle("dashboard")}>
      <Sidebar active="dashboard" />

      <div className="main-content">
        {user && (
          <div className="topbar-greeting">
            <span className="topbar-greeting-title">{greetingLine}</span>
            <span className="topbar-greeting-sub">{motivation}</span>
          </div>
        )}
        <TopbarSearch />
        <div className="dash-hero">
        <div className="dash-hero__text">
          <p className="eyebrow">Your Social Place</p>
          <h1>Posts</h1>
          <p className="subhead">
            See What Our Community Is Doing!
          </p>
        </div>
        <div className="hero-badge" style={{ display: 
          "flex", alignItems: "center",
           gap: "10px" }}>
          <span className="pill" title="Live">Live</span>
          <div style={{ display: "flex",
             alignItems: "center", 
             gap: "10px" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #60a5fa, #7c3aed)",
                display: "grid",
                placeItems: "center",
                overflow: "hidden",
                color: "#fff",
                fontWeight: 700,
              }}
            >
              {profileAvatarUrl ? (
                <img
                  src={profileAvatarUrl}
                  alt={`${userLabel} avatar`}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  onError={() => setProfileAvatarUrl(null)}
                />
              ) : (
                userInitial
              )}
            </div>
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontSize: "12px", color: "#9ca3af" }}>Signed in as</div>
              <div style={{ fontWeight: 600 }}>{userLabel}</div>
            </div>
          </div>
        </div>
      </div>

      {loading && <p className="status">Loading posts…</p>}
      {error && <p className="status status-error">{error}</p>}

      {!loading && !error && (
        <>
          <div className="panel-grid">
            <section className="panel post-composer">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Create</p>
                  <h3>New Post</h3>
                  <p className="panel-sub">
                    Let Your Friends Know What You're Up To! 
                  </p>
                </div>
              </div>
              <div className="post-composer__top">
                <div className="post-composer__avatar">
                  {profileAvatarUrl ? (
                    <img
                      src={profileAvatarUrl}
                      alt={`${userLabel} avatar`}
                      loading="lazy"
                      decoding="async"
                      onError={() => setProfileAvatarUrl(null)}
                    />
                  ) : (
                    <span>{userInitial}</span>
                  )}
                </div>
                <div className="post-composer__input">
                  <textarea
                    className="auth-input"
                    value={formContent}
                    onChange={(e) => {
                      const nextValue = sanitizePostText(e.target.value);
                      setFormContent(nextValue);
                      setFormError(null);
                    }}
                    placeholder="What's on your mind?"
                    rows={4}
                  />
                  {linkPreviewLoading && (
                    <span className="post-composer__hint">Loading preview...</span>
                  )}
                </div>
              </div>

              {linkPreview && (
                <LinkPreviewCard
                  preview={linkPreview}
                  url={linkPreview.url || extractFirstUrl(formContent)}
                />
              )}
              {linkPreviewError && <p className="status status-error">{linkPreviewError}</p>}
              {formFilePreviewUrl && (
                <div className="post-composer__media-preview">
                  {formFileIsVideo ? (
                    <video controls muted playsInline preload="metadata">
                      <source src={formFilePreviewUrl} />
                    </video>
                  ) : (
                    <img
                      src={formFilePreviewUrl}
                      alt="Upload preview"
                      loading="lazy"
                      decoding="async"
                    />
                  )}
                </div>
              )}

              <div className="post-composer__feedback">
                <span className="post-feedback-label">Post visibility</span>
                <div className="post-feedback-row">
                  <select
                    className="auth-input post-feedback-select"
                    value={postVisibility}
                    onChange={(e) => {
                      setPostVisibility(e.target.value);
                      setFormError(null);
                    }}
                  >
                    <option value="public">Public</option>
                    <option value="friends">Friends</option>
                    <option value="private">Private</option>
                  </select>
                </div>
              </div>

              <div className="post-composer__feedback">
                <span className="post-feedback-label">Request feedback</span>
                <div className="post-feedback-row">
                  <select
                    className="auth-input post-feedback-select"
                    value={feedbackAudience}
                    onChange={(e) => {
                      setFeedbackAudience(e.target.value);
                      setFormError(null);
                    }}
                  >
                    <option value="none">No feedback request</option>
                    <option value="public">Public feedback</option>
                    <option value="friends">Friends only</option>
                    <option value="specific">Specific friend</option>
                  </select>
                  {feedbackAudience === "specific" && (
                    <select
                      className="auth-input post-feedback-select"
                      value={feedbackTargetId ?? ""}
                      onChange={(e) => {
                        const nextId = Number(e.target.value);
                        setFeedbackTargetId(Number.isFinite(nextId) ? nextId : null);
                        setFormError(null);
                      }}
                      disabled={!friendOptions.length}
                    >
                      <option value="">Select a friend</option>
                      {friendOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {feedbackAudience === "specific" && friendOptions.length === 0 && (
                  <p className="post-feedback-note">
                    Add a friend first to request feedback from a specific person.
                  </p>
                )}
              </div>

              <div className="post-composer__actions">
                <div className="post-composer__tools">
                  <label className="post-composer__tool">
                    <input
                      type="file"
                      accept="image/*,video/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        if (file && file.size > MAX_UPLOAD_BYTES) {
                          setFormError(`Media files must be under ${MAX_UPLOAD_LABEL}.`);
                          e.target.value = "";
                          setFormFile(null);
                          return;
                        }
                        setFormFile(file);
                        setFormError(null);
                      }}
                    />
                    <span>{formFile ? "Change media" : "Add photo/video"}</span>
                  </label>
                  <span className="post-composer__file">
                    {formFile ? formFile.name : "No media selected"}
                  </span>
                  {formFile && (
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => setFormFile(null)}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <button
                  className="btn primary"
                  type="button"
                  disabled={submitting}
                  onClick={createPost}
                >
                  {submitting ? "Posting..." : "Post"}
                </button>
              </div>

              {formError && <p className="auth-message error">{formError}</p>}
            </section>
            {/* <NewsWidget /> */}
          </div>

          <div className="posts-toolbar">
            <div>
              <p className="eyebrow">Feed</p>
              <h3>Latest posts</h3>
            </div>
            <div className="posts-filter">
              <span className="posts-filter-label">Show</span>
              <select
                className="auth-input post-filter-select"
                value={postFilter}
                onChange={(e) => setPostFilter(e.target.value as PostFilter)}
              >
                <option value="all">All posts</option>
                <option value="admin">Admin posts</option>
                <option value="friends">Friends posts</option>
                <option value="private">Private posts</option>
                <option value="public">Public posts</option>
              </select>
            </div>
          </div>

          <div className="posts-grid posts-grid--two">
            {visiblePosts.length === 0 && (
              <div className="empty-state">
                <p>No posts yet. Add one in Strapi to see it here.</p>
              </div>
            )}

            {visiblePosts.map((post) => {
              const postUrl = extractFirstUrl(post.content);
              const preview = postUrl ? previewCache[postUrl] : undefined;
              const hasLink = Boolean(postUrl);
              const descriptor = mediaDescriptor(post.imageUrl, hasLink);
              const previewImage = preview?.image;
              const showPreviewMedia = !post.imageUrl && !!previewImage;
              const showPlaceholder = !post.imageUrl && !previewImage;
              const authorLabel = post.ownerName || "User";
              const postId = Number(post.id);
              const canDelete =
                post.source === "user" &&
                Number.isFinite(postId) &&
                user?.id === post.ownerId;
              const feedbackLabel = feedbackLabelFor(post);
              const postKey = String(post.id);
              const isCommentsOpen = Boolean(openCommentsFor[postKey]);
              const showReactionPicker = reactionPickerFor === postKey;
              const showShareMenu = shareMenuFor === postKey;
              const shareUrl = buildShareUrl(postKey);
              const shareText = post.title
                ? `${authorLabel}: ${post.title}`
                : `${authorLabel} posted an update.`;
              const encodedUrl = encodeURIComponent(shareUrl);
              const encodedText = encodeURIComponent(shareText);
              const likesCount = Number(post.likes ?? 0);
              const sharesCount = Number(post.shares ?? 0);
              const commentsCount = post.comments?.length ?? 0;
              const isDescriptorActionable =
                descriptor === "with a picture" || descriptor === "with a link";

              return (
                <article
                  key={post.id}
                  id={`post-${postKey}`}
                  className={`post-card${
                    showReactionPicker || showShareMenu ? " is-popover-open" : ""
                  } post-card--openable`}
                  onClick={(event) => handlePostCardClick(event, postKey)}
                  aria-haspopup="dialog"
                >
                  <div className="post-meta-bar">
                    <span className="post-meta-name">{authorLabel}</span>
                    <span className="post-meta-text">
                      {formatPostUpdateLabel(post.createdAt)}
                    </span>
                    {descriptor &&
                      (isDescriptorActionable ? (
                        <button
                          type="button"
                          className="post-meta-tag post-meta-tag--action"
                          onClick={(event) => {
                            event.stopPropagation();
                            void handleDescriptorAction(post, postKey, descriptor);
                          }}
                          aria-label={
                            descriptor === "with a link"
                              ? "Copy link"
                              : "Download picture"
                          }
                        >
                          {descriptor}
                        </button>
                      ) : (
                        <span className="post-meta-tag">{descriptor}</span>
                      ))}
                  </div>

                  {post.imageUrl ? (
                    <div className="post-media">
                      {isVideoUrl(post.imageUrl) ? (
                        <video
                          controls
                          playsInline
                          preload="metadata"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        >
                          <source src={post.imageUrl} />
                        </video>
                      ) : (
                        <img
                          src={post.imageUrl}
                          alt={post.title}
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                    </div>
                  ) : showPreviewMedia ? (
                    <div className="post-media link-preview-media">
                      <img
                        src={previewImage}
                        alt={preview?.title || post.title}
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  ) : showPlaceholder ? (
                    <div
                      className={`post-media placeholder${hasLink ? " link-preview-placeholder" : ""}`}
                    >
                      <div className="dots" />
                      <span>No image</span>
                    </div>
                  ) : null}

                  <div className="post-body">
                    <div className="post-meta">
                      <span className="pill subtle">Feature</span>
                      <div className="post-meta-right">
                        {feedbackLabel && (
                          <span className="post-feedback-tag">{feedbackLabel}</span>
                        )}
                        {post.createdAt && (
                          <span className="date">{formatDate(post.createdAt)}</span>
                        )}
                        {canDelete && (
                          <button
                            className="btn ghost post-delete"
                            type="button"
                            onClick={() => deletePost(postId)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                    <h3>{post.title}</h3>
                    <p>{post.content}</p>
                    {preview && !post.imageUrl && (
                      <LinkPreviewCard
                        preview={preview}
                        url={preview.url || postUrl}
                        compact
                      />
                    )}
                    <div className="post-actions">
                      <div className="post-action-counts">
                        <span className="post-action-count">
                          <span className="post-action-count-icon" aria-hidden="true">
                            👍
                          </span>
                          {likesCount}
                        </span>
                        <span className="post-action-count">
                          <span className="post-action-count-icon" aria-hidden="true">
                            💬
                          </span>
                          {commentsCount}
                        </span>
                        <span className="post-action-count">
                          <span className="post-action-count-icon" aria-hidden="true">
                            ↗
                          </span>
                          {sharesCount}
                        </span>
                      </div>
                      <div className="post-action-bar">
                      <div className="post-action-group">
                        <button
                          className="post-action-btn"
                          type="button"
                          aria-pressed={showReactionPicker}
                          onClick={() => toggleReactionPicker(postKey)}
                        >
                          <span className="post-action-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                              <path d="M2 10.5A1.5 1.5 0 0 1 3.5 9h1A1.5 1.5 0 0 1 6 10.5v9A1.5 1.5 0 0 1 4.5 21h-1A1.5 1.5 0 0 1 2 19.5v-9Z" />
                              <path d="M6 10.333V5a3 3 0 0 1 3-3h.5a.5.5 0 0 1 .5.5V8h4.65a2.5 2.5 0 0 1 2.453 2.98l-1.2 6A2.5 2.5 0 0 1 13.452 19H8a2 2 0 0 1-2-2v-6.667Z" />
                            </svg>
                          </span>
                          <span>Like</span>
                        </button>
                        {showReactionPicker && (
                          <div className="post-action-popover">
                            <ReactionPicker
                              onPick={(emoji) => {
                                setReactionPickerFor(null);
                                void handleReaction(post, postKey, emoji);
                              }}
                            />
                          </div>
                        )}
                      </div>
                      <div className="post-action-group">
                        <button
                          className="post-action-btn"
                          type="button"
                          aria-pressed={isCommentsOpen}
                          onClick={() => toggleComments(postKey)}
                        >
                          <span className="post-action-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                              <path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2Z" />
                            </svg>
                          </span>
                          <span>Comment</span>
                        </button>
                      </div>
                      <div className="post-action-group">
                        <button
                          className="post-action-btn"
                          type="button"
                          aria-pressed={showShareMenu}
                          onClick={() => toggleShareMenu(postKey)}
                        >
                          <span className="post-action-icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24">
                              <path d="M14 3 21 10 14 17v-4h-4a4 4 0 0 0-4 4v4H4v-4a6 6 0 0 1 6-6h4V3Z" />
                            </svg>
                          </span>
                          <span>Share</span>
                        </button>
                        {showShareMenu && (
                          <div className="post-action-popover is-wide">
                            <div className="post-share-grid">
                              <button
                                className="post-share-btn"
                                type="button"
                                onClick={() => handleCopyShare(post, postKey, shareUrl)}
                              >
                                Copy link
                              </button>
                              {typeof navigator !== "undefined" &&
                                typeof navigator.share === "function" && (
                                  <button
                                    className="post-share-btn"
                                    type="button"
                                    onClick={() =>
                                      handleNativeShare(post, postKey, shareUrl, shareText)
                                    }
                                  >
                                    Share...
                                  </button>
                                )}
                              <a
                                className="post-share-link"
                                href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
                                onClick={() => void trackShare(post, postKey)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Facebook
                              </a>
                              <a
                                className="post-share-link"
                                href={`https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`}
                                onClick={() => void trackShare(post, postKey)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                X
                              </a>
                              <a
                                className="post-share-link"
                                href={`https://www.linkedin.com/shareArticle?mini=true&url=${encodedUrl}&title=${encodedText}`}
                                onClick={() => void trackShare(post, postKey)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                LinkedIn
                              </a>
                              <a
                                className="post-share-link"
                                href={`https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`}
                                onClick={() => void trackShare(post, postKey)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                Reddit
                              </a>
                              <a
                                className="post-share-link"
                                href={`https://wa.me/?text=${encodedText}%20${encodedUrl}`}
                                onClick={() => void trackShare(post, postKey)}
                                target="_blank"
                                rel="noreferrer"
                              >
                                WhatsApp
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    </div>
                    {shareNotice[postKey] && (
                      <p className="post-action-notice">{shareNotice[postKey]}</p>
                    )}
                    {isCommentsOpen && (
                      <div className="comments">
                        <p className="eyebrow">Comments</p>
                        {post.comments && post.comments.length > 0 ? (
                          <ul className="comment-list">
                            {post.comments.map((c) => (
                              <li key={c.id} className="comment-item">
                                <div className="comment-author">{c.owner || "User"}</div>
                                <div className="comment-body">{c.body}</div>
                                {user?.id === c.ownerId && (
                                  <button
                                    className="btn ghost comment-delete"
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        await api.delete(`/comments/${c.id}`);
                                        setPosts((prev) => ({
                                          ...prev,
                                          comments: prev.comments.filter((comment) => {
                                            const record = asRecord(comment);
                                            const commentId =
                                              typeof record.id === "string" ||
                                              typeof record.id === "number"
                                                ? record.id
                                                : null;
                                            return commentId !== c.id;
                                          }),
                                        }));
                                      } catch (err: unknown) {
                                        console.error("Delete comment failed", err);
                                        setError("Failed to delete comment");
                                      }
                                    }}
                                  >
                                    Delete
                                  </button>
                                )}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="status">No comments yet.</p>
                        )}
                        <div className="comment-form">
                          <input
                            className="auth-input"
                            placeholder="Add a comment..."
                            value={commentInputs[postKey] || ""}
                            onChange={(e) =>
                              setCommentInputs((prev) => ({
                                ...prev,
                                [postKey]: sanitizePostText(e.target.value),
                              }))
                            }
                          />
                          <button
                            className="btn primary"
                            type="button"
                            disabled={!commentInputs[postKey]?.trim()}
                            onClick={async () => {
                              const body = (commentInputs[postKey] || "").trim();
                              if (!body) return;
                              try {
                                const targetType =
                                  post.source === "admin"
                                    ? "admin"
                                    : post.source === "group"
                                    ? "group-post"
                                    : "user";
                                await api.post("/comments", {
                                  data: {
                                    body,
                                    target_type: targetType,
                                    target_id: post.id,
                                  },
                                });
                                const res = await api.get("/comments?populate=owner");
                                setPosts((prev) => ({
                                  ...prev,
                                  comments: res.data?.data ?? [],
                                }));
                                setCommentInputs((prev) => ({ ...prev, [postKey]: "" }));
                              } catch (err: unknown) {
                                console.error("Add comment failed", err);
                                if (axios.isAxiosError(err)) {
                                  const msg =
                                    err.response?.data?.error?.message ||
                                    err.response?.data?.message ||
                                    "Failed to add comment";
                                  setError(String(msg));
                                } else {
                                  setError("Failed to add comment");
                                }
                              }
                            }}
                          >
                            Comment
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
          <div className="posts-load-more" ref={loadMoreRef} aria-live="polite">
            {isLoadingMore && <span>Loading more posts...</span>}
            {!isLoadingMore &&
              !hasMoreUserPosts &&
              !hasMoreGroupPosts &&
              visiblePosts.length > 0 && <span>You are all caught up.</span>}
          </div>
          {showGoToTop && !activePostKey && (
            <button
              type="button"
              className="go-top-button"
              onClick={handleGoToTop}
            >
              Go to top
            </button>
          )}
      </>
    )}
      </div>
      {activePost && (
        <div
          className="post-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={modalTitleId}
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
                  <span className="post-modal__time">
                    {formatPostUpdateLabel(activePost.createdAt)}
                  </span>
                </div>
                <div className="post-modal__meta-right">
                  {activeDescriptor &&
                    (isActiveDescriptorActionable ? (
                      <button
                        type="button"
                        className="post-meta-tag post-meta-tag--action"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (!activePost || !activePostKey) return;
                          void handleDescriptorAction(
                            activePost,
                            activePostKey,
                            activeDescriptor
                          );
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
                <h2 id={modalTitleId}>{activePost.title}</h2>
                <p>{activePost.content}</p>
                {activePreview && !activePost.imageUrl && (
                  <LinkPreviewCard
                    preview={activePreview}
                    url={activePreview.url || activePostUrl}
                  />
                )}
              </div>

              {activePost.comments.length > 0 && (
                <div className="post-modal__comments">
                  <p className="eyebrow">Comments</p>
                  <ul className="comment-list">
                    {activePost.comments.map((comment) => (
                      <li key={comment.id} className="comment-item">
                        <div className="comment-author">{comment.owner || "User"}</div>
                        <div className="comment-body">{comment.body}</div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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
    </div>
  );
}
