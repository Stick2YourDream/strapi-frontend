import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import "../css/dashboard.css";
import "../css/groups.css";
import api from "../api/strapi";
import axios from "axios";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import { useAuth } from "../context/AuthContext";
import { usePageMeta } from "../hooks/usePageMeta";
import { sanitizePostText } from "../utils/emoji";
import { formatPostUpdateLabel } from "../utils/time";
import { pickMediaUrl, pickMediaUrls } from "../utils/media";

type GroupDetail = {
  id: number | string;
  documentId?: string;
  name: string;
  description?: string;
  visibility: "public" | "private";
  backgroundImage?: string;
  gradientStart?: string;
  gradientEnd?: string;
  gradientAngle?: number;
  ownerName?: string;
  ownerId?: number;
};

type GroupMember = {
  id: number | string;
  userId: number;
  name: string;
  role: "admin" | "moderator" | "member";
};

type GroupInvite = {
  id: number | string;
  inviteeName: string;
};

type ReactionCounts = {
  thumbsUp: number;
  heart: number;
};

type GroupPost = {
  id: number | string;
  numericId?: number;
  title?: string;
  body?: string;
  mediaUrls: string[];
  createdAt?: string;
  ownerName?: string;
  ownerId?: number;
  likes?: number;
  reactionCounts?: ReactionCounts;
  myReaction?: string | null;
  shares?: number;
};

type CommentItem = {
  id: number | string;
  numericId?: number;
  documentId?: string;
  body: string;
  owner?: string;
  ownerId?: number | string;
  createdAt?: string;
};

type LinkPreview = {
  url?: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
};

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
const getEntity = (entry: any) => entry?.data ?? entry ?? null;
const getEntityId = (entry: any) => {
  const data = getEntity(entry);
  const rawId = data?.id ?? normalize(data)?.id;
  const num = Number(rawId);
  return Number.isFinite(num) ? num : undefined;
};
const getUserDisplayName = (entry: any, fallback = "Member") => {
  const attrs = normalize(entry);
  const firstName = String(attrs?.firstName || attrs?.firstname || "").trim();
  const lastName = String(attrs?.lastName || attrs?.lastname || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const handle = String(attrs?.handle || attrs?.username || "").trim();
  const email = String(attrs?.email || "").trim();
  return fullName || handle || email || fallback;
};

const normalizeReactionCounts = (value: unknown, fallbackLikes?: number): ReactionCounts => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const thumbsRaw = record.thumbsUp ?? record.thumbs_up;
  const heartRaw = record.heart;
  const thumbsUp = Number(thumbsRaw);
  const heart = Number(heartRaw);
  const hasCounts = Number.isFinite(thumbsUp) || Number.isFinite(heart);
  return {
    thumbsUp: Number.isFinite(thumbsUp)
      ? thumbsUp
      : hasCounts
      ? 0
      : Number(fallbackLikes ?? 0),
    heart: Number.isFinite(heart) ? heart : 0,
  };
};

const normalizeReactionValue = (value: unknown): string | null => {
  const trimmed = String(value || "").trim();
  if (trimmed === "👍" || trimmed === "❤️") return trimmed;
  return null;
};

const hexToRgba = (value: string, alpha: number) => {
  const hex = (value || "").replace("#", "");
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return value;
};

const buildGroupStyle = (group: GroupDetail) => {
  const hasGradient = Boolean(group.gradientStart || group.gradientEnd);
  const angle = Number.isFinite(group.gradientAngle || 0) ? group.gradientAngle : 135;
  const gradient = hasGradient
    ? `linear-gradient(${angle}deg, ${hexToRgba(
        group.gradientStart || "#2563eb",
        0.75
      )}, ${hexToRgba(group.gradientEnd || "#22d3ee", 0.75)})`
    : "linear-gradient(135deg, rgba(8, 12, 22, 0.9), rgba(8, 12, 22, 0.4))";
  if (group.backgroundImage) {
    return {
      backgroundImage: `${gradient}, url("${group.backgroundImage}")`,
      backgroundSize: "cover",
      backgroundPosition: "center",
    };
  }
  return { backgroundImage: gradient };
};

const isVideoUrl = (value?: string) => !!value && /\.(mp4|webm|mov)$/i.test(value);
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
  const fallbackImage = preview.image || faviconFor(url);
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
            className={preview.image ? "" : "is-favicon"}
          />
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

export default function GroupDetail() {
  const { groupId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  usePageMeta({
    title: "Group | Your Social Place",
    description: "Share updates, media, and momentum with your group.",
  });

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [invites, setInvites] = useState<GroupInvite[]>([]);
  const [posts, setPosts] = useState<GroupPost[]>([]);
  const [postComments, setPostComments] = useState<Record<string, CommentItem[]>>({});
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [commentEdits, setCommentEdits] = useState<Record<string, string>>({});
  const [editingComments, setEditingComments] = useState<Record<string, boolean>>({});
  const [openCommentsFor, setOpenCommentsFor] = useState<Record<string, boolean>>({});
  const [shareMenuFor, setShareMenuFor] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [linkPreviews, setLinkPreviews] = useState<Record<string, LinkPreview | null>>({});
  const linkPreviewRef = useRef<Record<string, LinkPreview | null>>({});

  const [myRole, setMyRole] = useState<"admin" | "moderator" | "member" | null>(null);
  const [myMembershipId, setMyMembershipId] = useState<number | string | null>(null);
  const [pendingInviteId, setPendingInviteId] = useState<number | string | null>(null);

  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postFiles, setPostFiles] = useState<File[]>([]);
  const [postStatus, setPostStatus] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

  const [inviteIdentifier, setInviteIdentifier] = useState("");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);

  const [settingsName, setSettingsName] = useState("");
  const [settingsDescription, setSettingsDescription] = useState("");
  const [settingsVisibility, setSettingsVisibility] = useState<"public" | "private">("private");
  const [settingsUseGradient, setSettingsUseGradient] = useState(true);
  const [settingsGradientStart, setSettingsGradientStart] = useState("#2563eb");
  const [settingsGradientEnd, setSettingsGradientEnd] = useState("#22d3ee");
  const [settingsGradientAngle, setSettingsGradientAngle] = useState(135);
  const [settingsUseImage, setSettingsUseImage] = useState(false);
  const [settingsImageFile, setSettingsImageFile] = useState<File | null>(null);
  const [settingsPreviewImageUrl, setSettingsPreviewImageUrl] = useState<string | null>(null);
  const [settingsClearImage, setSettingsClearImage] = useState(false);
  const [settingsStatus, setSettingsStatus] = useState<string | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [groupView, setGroupView] = useState<"feed" | "settings">("feed");

  const mapGroup = useCallback((entry: any): GroupDetail => {
    const attrs = normalize(entry);
    const ownerEntry = getEntity(attrs.owner);
    return {
      id: entry?.id ?? attrs.documentId ?? attrs.id,
      documentId: entry?.documentId ?? attrs.documentId,
      name: attrs.name || "Group",
      description: attrs.description || "",
      visibility: attrs.visibility === "public" ? "public" : "private",
      backgroundImage: pickMediaUrl(attrs.backgroundImage, { kind: "cover" }),
      gradientStart: attrs.gradientStart || "",
      gradientEnd: attrs.gradientEnd || "",
      gradientAngle: Number(attrs.gradientAngle ?? 135),
      ownerName: getUserDisplayName(ownerEntry, "Owner"),
      ownerId: ownerEntry?.id ?? normalize(ownerEntry)?.id,
    };
  }, []);

  const mapComments = useCallback((rows: any[]): Record<string, CommentItem[]> => {
    const next: Record<string, CommentItem[]> = {};
    rows.forEach((entry) => {
      const attrs = normalize(entry);
      const targetId = attrs.target_id ?? entry?.target_id;
      if (targetId === undefined || targetId === null) return;
      const key = String(targetId);
      const ownerEntry = getEntity(attrs.owner ?? entry?.owner);
      const ownerName = getUserDisplayName(ownerEntry, "Member");
      const ownerId = getEntityId(ownerEntry);
      const rawId = entry?.id ?? attrs?.id;
      const numericId = Number(rawId);
      const documentId = entry?.documentId ?? attrs?.documentId;
      const commentId = rawId ?? documentId ?? String(targetId);
      const body = String(attrs.body ?? entry?.body ?? "").trim();
      const createdAt = String(attrs.createdAt ?? entry?.createdAt ?? "");
      if (!body) return;
      (next[key] = next[key] || []).push({
        id: commentId,
        numericId: Number.isFinite(numericId) ? numericId : undefined,
        documentId,
        body,
        owner: ownerName,
        ownerId,
        createdAt: createdAt || undefined,
      });
    });
    return next;
  }, []);

  const fetchCommentsForPostIds = useCallback(
    async (postIds: Array<string | number>) => {
      if (!postIds.length) return {};
      const idFilter = postIds
        .map(
          (id, index) =>
            `filters[target_id][$in][${index}]=${encodeURIComponent(String(id))}`
        )
        .join("&");
      const typeFilter =
        "filters[target_type][$in][0]=group-post&filters[target_type][$in][1]=group";
      const res = await api.get(
        `/comments?${typeFilter}&${idFilter}&populate=owner&pagination[pageSize]=200`
      );
      return mapComments(res.data?.data ?? []);
    },
    [mapComments]
  );

  const loadGroup = useCallback(async () => {
    if (!groupId) return;
    setLoading(true);
    setError(null);
    try {
      const groupRes = await api.get(
        `/groups/${groupId}?populate=backgroundImage&populate=owner`
      );
      const groupEntry = groupRes.data?.data ?? groupRes.data;
      if (!groupEntry) {
        setError("Group not found.");
        return;
      }
      const detail = mapGroup(groupEntry);
      const groupNumericId = groupEntry.id ?? detail.id;

      const [myMemberRes, membersRes, postsRes, inviteRes, adminInviteRes] = await Promise.all([
        user?.id
          ? api.get(
              `/group-members?filters[group][id][$eq]=${groupNumericId}` +
                `&filters[user][id][$eq]=${user.id}&pagination[pageSize]=1`
            )
          : Promise.resolve({ data: { data: [] } }),
        api
          .get(
            `/group-members?filters[group][id][$eq]=${groupNumericId}` +
              `&populate=user&pagination[pageSize]=200`
          )
          .catch(() => ({ data: { data: [] } })),
        api
          .get(
            `/group-posts?filters[group][id][$eq]=${groupNumericId}` +
              `&populate=media&populate=owner&sort=createdAt:desc&pagination[pageSize]=50`
          )
          .catch(() => ({ data: { data: [] } })),
        user?.id
          ? api
              .get(
                `/group-invites?filters[group][id][$eq]=${groupNumericId}` +
                  `&filters[invitee][id][$eq]=${user.id}` +
                  `&filters[status][$eq]=pending&pagination[pageSize]=1`
              )
              .catch(() => ({ data: { data: [] } }))
          : Promise.resolve({ data: { data: [] } }),
        api
          .get(
            `/group-invites?filters[group][id][$eq]=${groupNumericId}` +
              `&filters[status][$eq]=pending&populate=invitee&pagination[pageSize]=200`
          )
          .catch(() => ({ data: { data: [] } })),
      ]);

      const memberEntry = myMemberRes.data?.data?.[0];
      const memberAttrs = normalize(memberEntry);
      const role =
        memberAttrs?.role === "admin"
          ? "admin"
          : memberAttrs?.role === "moderator"
          ? "moderator"
          : memberAttrs?.role === "member"
          ? "member"
          : null;

      setMyRole(role);
      setMyMembershipId(memberEntry?.id ?? null);
      setPendingInviteId(inviteRes.data?.data?.[0]?.id ?? null);

      const membersList: GroupMember[] = (membersRes.data?.data ?? [])
        .map((entry: any) => {
          const attrs = normalize(entry);
          const userEntry = getEntity(attrs.user);
          return {
            id: entry.id ?? attrs.documentId,
            userId: userEntry?.id ?? normalize(userEntry)?.id,
            name: getUserDisplayName(userEntry, "Member"),
            role:
              attrs.role === "admin"
                ? "admin"
                : attrs.role === "moderator"
                ? "moderator"
                : "member",
          };
        })
        .filter((entry: GroupMember) => entry.userId) as GroupMember[];

      const postList: GroupPost[] = (postsRes.data?.data ?? [])
        .map((entry: any) => {
          const attrs = normalize(entry);
          const ownerEntry = getEntity(attrs.owner);
          const likes = Number(attrs.likes ?? 0);
          const reactionCounts = normalizeReactionCounts(attrs.reactionCounts, likes);
          const myReaction = normalizeReactionValue(attrs.myReaction ?? entry?.myReaction);
          const numericId = Number(entry.id ?? attrs.id);
          return {
            id: entry.id ?? attrs.documentId,
            numericId: Number.isFinite(numericId) ? numericId : undefined,
            title: attrs.title || "",
            body: attrs.body || "",
            mediaUrls: pickMediaUrls(attrs.media, { kind: "post" }),
            createdAt: attrs.createdAt,
            ownerName: getUserDisplayName(ownerEntry, "Member"),
            ownerId: ownerEntry?.id ?? normalize(ownerEntry)?.id,
            likes,
            reactionCounts,
            myReaction,
            shares: Number(attrs.shares ?? 0),
          };
        })
        .filter(Boolean) as GroupPost[];

      setGroup(detail);
      setMembers(membersList);
      setPosts(postList);
      if (postList.length) {
        try {
          const commentsMap = await fetchCommentsForPostIds(
            postList.map((post) => post.numericId ?? post.id)
          );
          setPostComments(commentsMap);
        } catch (err) {
          console.error("Failed to load group comments", err);
          setPostComments({});
        }
      } else {
        setPostComments({});
      }

      const inviteList: GroupInvite[] = (adminInviteRes.data?.data ?? [])
        .map((entry: any) => {
          const attrs = normalize(entry);
          const inviteeEntry = getEntity(attrs.invitee);
          return {
            id: entry.id ?? attrs.documentId,
            inviteeName: getUserDisplayName(inviteeEntry, "Invitee"),
          };
        })
        .filter((entry: GroupInvite) => entry.inviteeName);
      setInvites(role === "admin" ? inviteList : []);

      setSettingsName(detail.name);
      setSettingsDescription(detail.description || "");
      setSettingsVisibility(detail.visibility);
      const hasGradient = Boolean(detail.gradientStart || detail.gradientEnd);
      setSettingsUseGradient(hasGradient);
      setSettingsGradientStart(detail.gradientStart || "#2563eb");
      setSettingsGradientEnd(detail.gradientEnd || "#22d3ee");
      setSettingsGradientAngle(detail.gradientAngle ?? 135);
      setSettingsUseImage(Boolean(detail.backgroundImage));
      setSettingsImageFile(null);
      setSettingsClearImage(false);
    } catch {
      setError("Unable to load this group.");
    } finally {
      setLoading(false);
    }
  }, [fetchCommentsForPostIds, groupId, mapGroup, user?.id]);

  useEffect(() => {
    void loadGroup();
  }, [loadGroup]);

  useEffect(() => {
    linkPreviewRef.current = linkPreviews;
  }, [linkPreviews]);

  const fetchLinkPreview = useCallback(async (url: string) => {
    if (!url) return;
    if (linkPreviewRef.current[url] !== undefined) return;
    linkPreviewRef.current = { ...linkPreviewRef.current, [url]: null };
    setLinkPreviews((prev) => ({ ...prev, [url]: null }));
    try {
      const res = await api.get("/link-preview", { params: { url } });
      const data = res.data?.data;
      const preview: LinkPreview | null = data?.url
        ? {
            url: data.url,
            title: data.title,
            description: data.description,
            image: data.image,
            siteName: data.siteName,
            type: data.type,
          }
        : null;
      linkPreviewRef.current = { ...linkPreviewRef.current, [url]: preview };
      setLinkPreviews((prev) => ({ ...prev, [url]: preview }));
    } catch {
      linkPreviewRef.current = { ...linkPreviewRef.current, [url]: null };
      setLinkPreviews((prev) => ({ ...prev, [url]: null }));
    }
  }, []);

  useEffect(() => {
    const urls = new Set<string>();
    posts.forEach((post) => {
      const postUrl = extractFirstUrl(post.body || "");
      if (postUrl) urls.add(postUrl);
    });
    urls.forEach((url) => {
      void fetchLinkPreview(url);
    });
  }, [fetchLinkPreview, posts]);

  useEffect(() => {
    if (myRole !== "admin" && myRole !== "moderator") {
      setGroupView("feed");
    }
  }, [myRole]);

  useEffect(() => {
    if (!settingsImageFile) {
      setSettingsPreviewImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(settingsImageFile);
    setSettingsPreviewImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [settingsImageFile]);

  const buildShareUrl = useCallback((postKey: string) => {
    if (typeof window === "undefined") return "";
    const fallbackOrigin = String(import.meta.env.VITE_PUBLIC_SITE_URL || "").trim();
    const origin = window.location.origin;
    const base = origin.startsWith("http") ? origin : fallbackOrigin;
    if (!base) return "";
    const path = window.location.pathname?.startsWith("/")
      ? window.location.pathname
      : "/dashboard";
    return `${base}${path}#post-${postKey}`;
  }, []);

  const updatePostMetric = useCallback((postKey: string, field: "likes" | "shares", value: number) => {
    setPosts((prev) =>
      prev.map((post) =>
        String(post.id) === postKey ? { ...post, [field]: value } : post
      )
    );
  }, []);

  const updatePostReactions = useCallback(
    (postKey: string, reactionCounts: ReactionCounts, myReaction: string | null) => {
      setPosts((prev) =>
        prev.map((post) =>
          String(post.id) === postKey
            ? { ...post, reactionCounts, myReaction }
            : post
        )
      );
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
    async (post: GroupPost, postKey: string) => {
      try {
        const res = await api.post(`/group-posts/${post.id}/share`);
        const nextShares = Number(res.data?.data?.shares) || Number(post.shares ?? 0) + 1;
        updatePostMetric(postKey, "shares", nextShares);
      } catch (err) {
        console.error("Share tracking failed", err);
        pushShareNotice(postKey, "Unable to update share count.");
      }
    },
    [pushShareNotice, updatePostMetric]
  );

  const handleCopyShare = useCallback(
    async (post: GroupPost, postKey: string, shareUrl: string) => {
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
    async (post: GroupPost, postKey: string, shareUrl: string, shareText: string) => {
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

  const updateCommentBody = useCallback(
    async (comment: CommentItem, postKey: string, nextBody: string) => {
      const trimmed = nextBody.trim();
      if (!trimmed) {
        setError("Comment cannot be empty.");
        return false;
      }
      setError(null);
      const numericId =
        comment.numericId ??
        (typeof comment.id === "number" ? comment.id : Number(comment.id));
      const attempts: string[] = [];
      if (comment.documentId) {
        attempts.push(`/comments/${comment.documentId}`);
      }
      if (Number.isFinite(numericId)) {
        attempts.push(`/comments/${numericId}`);
      }
      attempts.push(`/comments/${comment.id}`);

      let updated = false;
      for (const path of attempts) {
        try {
          await api.put(path, { data: { body: trimmed } });
          updated = true;
          break;
        } catch (err: unknown) {
          if (axios.isAxiosError(err) && err.response?.status === 404) {
            continue;
          }
          throw err;
        }
      }

      if (!updated) {
        setError("Failed to update comment.");
        return false;
      }

      const matchIds = new Set<string>();
      matchIds.add(String(comment.id));
      if (comment.documentId) {
        matchIds.add(String(comment.documentId));
      }
      if (Number.isFinite(numericId)) {
        matchIds.add(String(numericId));
      }

      setPostComments((prev) => {
        const list = prev[postKey] ?? [];
        return {
          ...prev,
          [postKey]: list.map((entry) =>
            matchIds.has(String(entry.id)) ||
            (entry.documentId && matchIds.has(String(entry.documentId))) ||
            (entry.numericId !== undefined && matchIds.has(String(entry.numericId)))
              ? { ...entry, body: trimmed }
              : entry
          ),
        };
      });

      pushShareNotice(postKey, "Comment updated.");
      return true;
    },
    [pushShareNotice]
  );

  const handleReaction = useCallback(
    async (post: GroupPost, postKey: string, emoji: string) => {
      try {
        const res = await api.post(`/group-posts/${post.id}/react`, { emoji });
        const payload = res.data?.data;
        const payloadLikes = Number(payload?.likes);
        const nextLikes = Number.isFinite(payloadLikes)
          ? payloadLikes
          : Number(post.likes ?? 0) + 1;
        if (Number.isFinite(payloadLikes)) {
          updatePostMetric(postKey, "likes", nextLikes);
        }
        const counts = normalizeReactionCounts(payload?.reactionCounts, nextLikes);
        const reactionValue = normalizeReactionValue(payload?.myReaction ?? emoji);
        updatePostReactions(postKey, counts, reactionValue);
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
    [pushShareNotice, updatePostMetric, updatePostReactions]
  );

  const refreshCommentsForPost = useCallback(
    async (postId: string | number) => {
      try {
        const updates = await fetchCommentsForPostIds([postId]);
        setPostComments((prev) => ({ ...prev, ...updates }));
      } catch (err) {
        console.error("Failed to refresh comments", err);
      }
    },
    [fetchCommentsForPostIds]
  );

  const toggleComments = useCallback((postKey: string) => {
    setOpenCommentsFor((prev) => ({ ...prev, [postKey]: !prev[postKey] }));
    setShareMenuFor(null);
  }, []);

  const toggleShareMenu = useCallback((postKey: string) => {
    setShareMenuFor((prev) => (prev === postKey ? null : postKey));
  }, []);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".post-action-group")) return;
      setShareMenuFor(null);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const handleJoinGroup = async () => {
    if (!group) return;
    try {
      await api.post("/group-members", { data: { group: group.id } });
      await loadGroup();
    } catch {
      setError("Unable to join this group.");
    }
  };

  const handleAcceptInvite = async () => {
    if (!pendingInviteId) return;
    try {
      await api.put(`/group-invites/${pendingInviteId}`, { data: { status: "accepted" } });
      await loadGroup();
    } catch {
      setError("Unable to accept invite.");
    }
  };

  const handleDeclineInvite = async () => {
    if (!pendingInviteId) return;
    try {
      await api.put(`/group-invites/${pendingInviteId}`, { data: { status: "declined" } });
      setPendingInviteId(null);
    } catch {
      setError("Unable to decline invite.");
    }
  };

  const handleInviteMember = async () => {
    if (!group || !inviteIdentifier.trim()) {
      setInviteStatus("Enter a handle or email.");
      return;
    }
    setInviting(true);
    setInviteStatus(null);
    try {
      await api.post("/group-invites", {
        data: { group: group.id, identifier: inviteIdentifier.trim() },
      });
      setInviteIdentifier("");
      setInviteStatus("Invite sent.");
      await loadGroup();
    } catch {
      setInviteStatus("Unable to send invite.");
    } finally {
      setInviting(false);
    }
  };

  const handleCreatePost = async () => {
    if (!group) return;
    const sanitized = sanitizePostText(postBody);
    const body = sanitized.trim();
    if (!body && postFiles.length === 0) {
      setPostStatus("Add a message or media.");
      return;
    }
    setPosting(true);
    setPostStatus(null);
    try {
      let mediaIds: number[] = [];
      if (postFiles.length) {
        const fd = new FormData();
        postFiles.forEach((file) => fd.append("files", file));
        const uploadRes = await api.post("/upload", fd);
        mediaIds = (uploadRes.data ?? []).map((item: any) => item?.id).filter(Boolean);
      }

      await api.post("/group-posts", {
        data: {
          title: postTitle.trim(),
          body,
          media: mediaIds.length ? mediaIds : undefined,
          group: group.id,
        },
      });
      setPostTitle("");
      setPostBody("");
      setPostFiles([]);
      await loadGroup();
    } catch {
      setPostStatus("Unable to post right now.");
    } finally {
      setPosting(false);
    }
  };

  const handleRemovePost = async (postId: number | string) => {
    try {
      await api.delete(`/group-posts/${postId}`);
      await loadGroup();
    } catch {
      setError("Unable to delete post.");
    }
  };

  const handleRoleChange = async (
    memberId: number | string,
    role: "admin" | "moderator" | "member"
  ) => {
    try {
      await api.put(`/group-members/${memberId}`, { data: { role } });
      await loadGroup();
    } catch {
      setError("Unable to update role.");
    }
  };

  const handleRemoveMember = async (memberId: number | string) => {
    try {
      await api.delete(`/group-members/${memberId}`);
      await loadGroup();
    } catch {
      setError("Unable to remove member.");
    }
  };

  const handleLeaveGroup = async () => {
    if (!myMembershipId) return;
    try {
      await api.delete(`/group-members/${myMembershipId}`);
      navigate("/groups");
    } catch {
      setError("Unable to leave group.");
    }
  };

  const handleSaveSettings = async () => {
    if (!group) return;
    setSavingSettings(true);
    setSettingsStatus(null);
    try {
      let backgroundId: number | undefined;
      if (settingsUseImage && settingsImageFile) {
        const fd = new FormData();
        fd.append("files", settingsImageFile);
        const uploadRes = await api.post("/upload", fd);
        backgroundId = uploadRes.data?.[0]?.id;
      }

      const payload: any = {
        name: settingsName.trim(),
        description: settingsDescription.trim(),
        visibility: settingsVisibility,
      };
      if (settingsUseGradient) {
        payload.gradientStart = settingsGradientStart;
        payload.gradientEnd = settingsGradientEnd;
        payload.gradientAngle = settingsGradientAngle;
      } else {
        payload.gradientStart = null;
        payload.gradientEnd = null;
        payload.gradientAngle = null;
      }

      if (backgroundId) payload.backgroundImage = backgroundId;
      if (settingsClearImage) payload.backgroundImage = null;

      await api.put(`/groups/${group.documentId ?? group.id}`, { data: payload });
      setSettingsStatus("Group updated.");
      setSettingsImageFile(null);
      setSettingsClearImage(false);
      await loadGroup();
    } catch {
      setSettingsStatus("Unable to update group.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!group) return;
    const confirmed = window.confirm(
      "Delete this group? This will remove posts and members."
    );
    if (!confirmed) return;
    try {
      await api.delete(`/groups/${group.documentId ?? group.id}`);
      navigate("/groups");
    } catch {
      setError("Unable to delete group.");
    }
  };

  const settingsPreview: GroupDetail | null = useMemo(() => {
    if (!group) return null;
    return {
      ...group,
      name: settingsName || group.name,
      description: settingsDescription || group.description,
      visibility: settingsVisibility,
      gradientStart: settingsUseGradient ? settingsGradientStart : "",
      gradientEnd: settingsUseGradient ? settingsGradientEnd : "",
      gradientAngle: settingsUseGradient ? settingsGradientAngle : group.gradientAngle,
      backgroundImage:
        settingsUseImage && settingsPreviewImageUrl
          ? settingsPreviewImageUrl
          : settingsUseImage
          ? group.backgroundImage
          : undefined,
    };
  }, [
    group,
    settingsName,
    settingsDescription,
    settingsVisibility,
    settingsUseGradient,
    settingsGradientStart,
    settingsGradientEnd,
    settingsGradientAngle,
    settingsUseImage,
    settingsPreviewImageUrl,
  ]);

  if (loading) {
    return (
      <div className="dashboard-shell">
        <Sidebar active="groups" />
        <div className="main-content">
          <p className="status">Loading group...</p>
        </div>
      </div>
    );
  }

  if (!group) {
    return (
      <div className="dashboard-shell">
        <Sidebar active="groups" />
        <div className="main-content">
          <p className="status status-error">{error || "Group not found."}</p>
          <button className="btn ghost" type="button" onClick={() => navigate("/groups")}>
            Back to groups
          </button>
        </div>
      </div>
    );
  }

  const canPost = myRole === "admin" || myRole === "moderator" || myRole === "member";
  const isAdmin = myRole === "admin";
  const canManageGroup = myRole === "admin" || myRole === "moderator";
  const showSettingsView = canManageGroup && groupView === "settings";
  const isPrivateLocked = group.visibility === "private" && !myRole;
  const memberLabel = isPrivateLocked
    ? "Invite-only list"
    : `${members.length} member${members.length === 1 ? "" : "s"}`;

  return (
    <div className="dashboard-shell">
      <Sidebar
        active="groups"
        groupView={groupView}
        onGroupViewChange={canManageGroup ? setGroupView : undefined}
      />
      <div className="main-content group-shell">
        <div className="group-detail-hero" style={buildGroupStyle(group)}>
          <div className="group-detail-hero__overlay" />
          <div className="group-detail-hero__content">
            <div className="group-detail-hero__meta">
              <span className="pill">{group.visibility}</span>
              {myRole && <span className="pill subtle">{myRole}</span>}
            </div>
            <h1>{group.name}</h1>
            <p>{group.description || "A focused space to build momentum."}</p>
            <div className="group-detail-hero__actions">
              <button className="btn ghost" type="button" onClick={() => navigate("/groups")}>
                Back
              </button>
              {!myRole && group.visibility === "public" && (
                <button className="btn primary" type="button" onClick={handleJoinGroup}>
                  Join group
                </button>
              )}
              {!myRole && group.visibility === "private" && pendingInviteId && (
                <div className="group-invite-actions">
                  <button className="btn ghost" type="button" onClick={handleDeclineInvite}>
                    Decline
                  </button>
                  <button className="btn primary" type="button" onClick={handleAcceptInvite}>
                    Accept invite
                  </button>
                </div>
              )}
              {!myRole && group.visibility === "private" && !pendingInviteId && (
                <span className="group-private-note">Invite-only group</span>
              )}
              {myRole && (
                <button className="btn ghost" type="button" onClick={handleLeaveGroup}>
                  Leave group
                </button>
              )}
            </div>
          </div>
        </div>

        <TopbarSearch />

        {error && <p className="status status-error">{error}</p>}

        {!showSettingsView && (
          <>
            <div className="panel-grid">
              {canPost && (
                <section className="panel group-post-panel">
                  <div className="panel-header">
                    <p className="eyebrow">New post</p>
                    <h3>Share the momentum</h3>
                    <p className="panel-sub">Drop a message, photo, or video update.</p>
                  </div>
                  <div className="form-grid">
                    <input
                      className="auth-input"
                      type="text"
                      placeholder="Title (optional)"
                      value={postTitle}
                      onChange={(e) => setPostTitle(e.target.value)}
                    />
                    <textarea
                      className="auth-input"
                      rows={4}
                      placeholder="What is the update?"
                      value={postBody}
                      onChange={(e) => setPostBody(sanitizePostText(e.target.value))}
                    />
                    <input
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      onChange={(e) => setPostFiles(Array.from(e.target.files ?? []))}
                    />
                    {postStatus && <div className="status">{postStatus}</div>}
                    <button
                      className="btn primary"
                      type="button"
                      onClick={handleCreatePost}
                      disabled={posting}
                    >
                      {posting ? "Posting..." : "Post to group"}
                    </button>
                  </div>
                </section>
              )}

              <section className="panel group-member-panel">
                <div className="panel-header">
                  <p className="eyebrow">Members</p>
                  <h3>People in this group</h3>
                  <p className="panel-sub">{memberLabel}</p>
                </div>
                {isPrivateLocked ? (
                  <p className="status">Invite-only members list.</p>
                ) : (
                  <div className="group-member-list">
                    {members.map((member) => (
                      <div key={member.id} className="group-member-row">
                        <div>
                          <strong>{member.name}</strong>
                          <span className="group-member-role">{member.role}</span>
                        </div>
                        {isAdmin && (
                          <div className="group-member-actions">
                            <select
                              className="group-role-select"
                              value={member.role}
                              onChange={(e) =>
                                handleRoleChange(
                                  member.id,
                                  e.target.value === "admin"
                                    ? "admin"
                                    : e.target.value === "moderator"
                                    ? "moderator"
                                    : "member"
                                )
                              }
                            >
                              <option value="member">member</option>
                              <option value="moderator">moderator</option>
                              <option value="admin">admin</option>
                            </select>
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => handleRemoveMember(member.id)}
                            >
                              Remove
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {isAdmin && (
                <section className="panel group-invite-admin">
                  <div className="panel-header">
                    <p className="eyebrow">Invite</p>
                    <h3>Add members</h3>
                    <p className="panel-sub">Invite by handle or email.</p>
                  </div>
                  <div className="form-grid">
                    <input
                      className="auth-input"
                      type="text"
                      value={inviteIdentifier}
                      onChange={(e) => setInviteIdentifier(e.target.value)}
                      placeholder="handle or email"
                    />
                    {inviteStatus && <div className="status">{inviteStatus}</div>}
                    <button
                      className="btn primary"
                      type="button"
                      onClick={handleInviteMember}
                      disabled={inviting}
                    >
                      {inviting ? "Sending..." : "Send invite"}
                    </button>
                  </div>
                  {invites.length > 0 && (
                    <div className="group-invite-pending">
                      <strong>Pending invites</strong>
                      {invites.map((invite) => (
                        <div key={invite.id} className="group-invite-pill">
                          {invite.inviteeName}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>

            <section className="group-section">
              <div className="group-section-header">
                <div>
                  <p className="eyebrow">Posts</p>
                  <h3>Latest updates</h3>
                </div>
              </div>
              {isPrivateLocked ? (
                <p className="status">Accept your invite to see private posts.</p>
              ) : (
                <div className="group-post-grid">
                  {posts.map((post) => {
                    const postUrl = extractFirstUrl(post.body || "");
                    const preview = postUrl ? linkPreviews[postUrl] : undefined;
                    const previewData = postUrl ? preview ?? { url: postUrl } : null;
                    const postKey = String(post.id);
                    const commentKey = String(post.numericId ?? post.id);
                    const comments = postComments[commentKey] ?? [];
                    const isCommentsOpen = Boolean(openCommentsFor[commentKey]);
                    const showShareMenu = shareMenuFor === postKey;
                    const authorLabel = post.ownerName || "Member";
                    const shareUrl = buildShareUrl(postKey);
                    const shareText = post.title
                      ? `${authorLabel}: ${post.title}`
                      : `${authorLabel} posted in ${group?.name || "a group"}.`;
                    const encodedUrl = encodeURIComponent(shareUrl);
                    const encodedText = encodeURIComponent(shareText);
                    const likesCount = Number(post.likes ?? 0);
                    const reactionCounts = normalizeReactionCounts(
                      post.reactionCounts,
                      likesCount
                    );
                    const thumbsUpCount = reactionCounts.thumbsUp;
                    const heartCount = reactionCounts.heart;
                    const myReaction = normalizeReactionValue(post.myReaction);
                    const sharesCount = Number(post.shares ?? 0);
                    const commentsCount = comments.length;
                    return (
                      <div key={post.id} id={`post-${postKey}`} className="group-post-card">
                        <div className="group-post-header">
                          <div>
                            <strong>{authorLabel}</strong>
                            <span className="group-post-time">
                              {formatPostUpdateLabel(post.createdAt)}
                            </span>
                          </div>
                          {(isAdmin || post.ownerId === user?.id) && (
                            <button
                              className="btn ghost"
                              type="button"
                              onClick={() => handleRemovePost(post.id)}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                        {post.title && <h4>{post.title}</h4>}
                        {post.body && <p>{post.body}</p>}
                        {previewData && (
                          <LinkPreviewCard
                            preview={previewData}
                            url={previewData.url || postUrl}
                            compact
                          />
                        )}
                        {post.mediaUrls.length > 0 && (
                          <div className="group-post-media">
                            {post.mediaUrls.map((url) =>
                              isVideoUrl(url) ? (
                                <video
                                  key={url}
                                  src={url}
                                  controls
                                  playsInline
                                  preload="metadata"
                                />
                              ) : (
                                <img
                                  key={url}
                                  src={url}
                                  alt="Group post media"
                                  loading="lazy"
                                  decoding="async"
                                />
                              )
                            )}
                          </div>
                        )}
                        <div className="post-actions">
                          <div className="post-action-counts">
                            <span
                              className={`post-action-count${
                                myReaction === "👍" ? " is-selected" : ""
                              }`}
                            >
                              <span className="post-action-count-icon" aria-hidden="true">
                                👍
                              </span>
                              {thumbsUpCount}
                            </span>
                            <span
                              className={`post-action-count${
                                myReaction === "❤️" ? " is-selected" : ""
                              }`}
                            >
                              <span className="post-action-count-icon" aria-hidden="true">
                                ❤️
                              </span>
                              {heartCount}
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
                              aria-pressed={myReaction === "👍"}
                              onClick={() => void handleReaction(post, postKey, "👍")}
                            >
                              <span className="post-action-icon" aria-hidden="true">
                                👍
                              </span>
                              <span>Like</span>
                            </button>
                          </div>
                          <div className="post-action-group">
                            <button
                              className="post-action-btn"
                              type="button"
                              aria-pressed={myReaction === "❤️"}
                              onClick={() => void handleReaction(post, postKey, "❤️")}
                            >
                              <span className="post-action-icon" aria-hidden="true">
                                ❤️
                              </span>
                              <span>Heart</span>
                            </button>
                          </div>
                          <div className="post-action-group">
                            <button
                              className="post-action-btn"
                              type="button"
                              aria-pressed={isCommentsOpen}
                              onClick={() => toggleComments(commentKey)}
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
                                    className="post-share-btn is-icon"
                                    type="button"
                                    onClick={() => handleCopyShare(post, postKey, shareUrl)}
                                    aria-label="Copy link"
                                  >
                                    <span className="post-share-icon" aria-hidden="true">
                                      🔗
                                    </span>
                                    <span className="post-share-label">Copy link</span>
                                  </button>
                                  {typeof navigator !== "undefined" &&
                                    typeof navigator.share === "function" && (
                                      <button
                                        className="post-share-btn is-icon"
                                        type="button"
                                        onClick={() =>
                                          handleNativeShare(post, postKey, shareUrl, shareText)
                                        }
                                        aria-label="Share"
                                      >
                                        <span className="post-share-icon" aria-hidden="true">
                                          📤
                                        </span>
                                        <span className="post-share-label">Share</span>
                                      </button>
                                    )}
                                  <a
                                    className="post-share-link is-icon post-share-link--facebook"
                                    href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`}
                                    onClick={() => void trackShare(post, postKey)}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label="Share to Facebook"
                                  >
                                    <span className="post-share-icon" aria-hidden="true">
                                      f
                                    </span>
                                    <span className="post-share-label">Facebook</span>
                                  </a>
                                  <a
                                    className="post-share-link is-icon post-share-link--x"
                                    href={`https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`}
                                    onClick={() => void trackShare(post, postKey)}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label="Share to X"
                                  >
                                    <span className="post-share-icon" aria-hidden="true">
                                      X
                                    </span>
                                    <span className="post-share-label">X</span>
                                  </a>
                                  <a
                                    className="post-share-link is-icon post-share-link--linkedin"
                                    href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`}
                                    onClick={() => void trackShare(post, postKey)}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label="Share to LinkedIn"
                                  >
                                    <span className="post-share-icon" aria-hidden="true">
                                      in
                                    </span>
                                    <span className="post-share-label">LinkedIn</span>
                                  </a>
                                  <a
                                    className="post-share-link is-icon post-share-link--reddit"
                                    href={`https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`}
                                    onClick={() => void trackShare(post, postKey)}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label="Share to Reddit"
                                  >
                                    <span className="post-share-icon" aria-hidden="true">
                                      r
                                    </span>
                                    <span className="post-share-label">Reddit</span>
                                  </a>
                                  <a
                                    className="post-share-link is-icon post-share-link--whatsapp"
                                    href={`https://wa.me/?text=${encodedText}%20${encodedUrl}`}
                                    onClick={() => void trackShare(post, postKey)}
                                    target="_blank"
                                    rel="noreferrer"
                                    aria-label="Share to WhatsApp"
                                  >
                                    <span className="post-share-icon" aria-hidden="true">
                                      🟢
                                    </span>
                                    <span className="post-share-label">WhatsApp</span>
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
                            {comments.length > 0 ? (
                              <ul className="comment-list">
                                {comments.map((c) => {
                                  const commentIdKey = String(
                                    c.documentId ?? c.numericId ?? c.id
                                  );
                                  const isEditing = Boolean(editingComments[commentIdKey]);
                                  const editValue = commentEdits[commentIdKey] ?? c.body;
                                  return (
                                  <li key={c.id} className="comment-item">
                                    <div className="comment-author">{c.owner || "Member"}</div>
                                    {isEditing ? (
                                      <div className="comment-edit">
                                        <textarea
                                          className="auth-input comment-edit-input"
                                          value={editValue}
                                          onChange={(event) =>
                                            setCommentEdits((prev) => ({
                                              ...prev,
                                              [commentIdKey]: sanitizePostText(event.target.value),
                                            }))
                                          }
                                        />
                                        <div className="comment-edit-actions">
                                          <button
                                            className="btn ghost"
                                            type="button"
                                            onClick={() => {
                                              setEditingComments((prev) => {
                                                const next = { ...prev };
                                                delete next[commentIdKey];
                                                return next;
                                              });
                                              setCommentEdits((prev) => {
                                                const next = { ...prev };
                                                delete next[commentIdKey];
                                                return next;
                                              });
                                            }}
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            className="btn primary"
                                            type="button"
                                            onClick={async () => {
                                              try {
                                                const updated = await updateCommentBody(
                                                  c,
                                                  commentKey,
                                                  editValue
                                                );
                                                if (!updated) return;
                                                setEditingComments((prev) => {
                                                  const next = { ...prev };
                                                  delete next[commentIdKey];
                                                  return next;
                                                });
                                                setCommentEdits((prev) => {
                                                  const next = { ...prev };
                                                  delete next[commentIdKey];
                                                  return next;
                                                });
                                              } catch (err: unknown) {
                                                const msg = axios.isAxiosError(err)
                                                  ? err.response?.data?.error?.message ||
                                                    err.response?.data?.message ||
                                                    "Failed to update comment."
                                                  : "Failed to update comment.";
                                                setError(String(msg));
                                              }
                                            }}
                                          >
                                            Save
                                          </button>
                                        </div>
                                      </div>
                                    ) : (
                                      <div className="comment-body">{c.body}</div>
                                    )}
                                    {user?.id === c.ownerId && (
                                      <div className="comment-actions">
                                        <button
                                          className="btn ghost"
                                          type="button"
                                          onClick={() => {
                                            setEditingComments((prev) => ({
                                              ...prev,
                                              [commentIdKey]: true,
                                            }));
                                            setCommentEdits((prev) => ({
                                              ...prev,
                                              [commentIdKey]: c.body,
                                            }));
                                          }}
                                        >
                                          Edit
                                        </button>
                                        <button
                                          className="btn ghost comment-delete"
                                          type="button"
                                          onClick={async () => {
                                            const numericId =
                                              c.numericId ??
                                              (typeof c.id === "number"
                                                ? c.id
                                                : Number(c.id));
                                            const removeIds = new Set<string>();
                                            removeIds.add(String(c.id));
                                            if (c.documentId) {
                                              removeIds.add(String(c.documentId));
                                            }
                                            if (Number.isFinite(numericId)) {
                                              removeIds.add(String(numericId));
                                            }
                                            try {
                                              setError(null);
                                              const attempts: string[] = [];
                                              if (c.documentId) {
                                                attempts.push(`/comments/${c.documentId}`);
                                              }
                                              if (Number.isFinite(numericId)) {
                                                attempts.push(`/comments/${numericId}`);
                                              }
                                              attempts.push(`/comments/${c.id}`);

                                              let removed = false;
                                              for (const path of attempts) {
                                                try {
                                                  await api.delete(path);
                                                  removed = true;
                                                  break;
                                                } catch (err: unknown) {
                                                  if (
                                                    axios.isAxiosError(err) &&
                                                    err.response?.status === 404
                                                  ) {
                                                    continue;
                                                  }
                                                  throw err;
                                                }
                                              }

                                              if (!removed) {
                                                setError("Failed to delete comment.");
                                                return;
                                              }

                                              setPostComments((prev) => ({
                                                ...prev,
                                                [commentKey]: (prev[commentKey] || []).filter(
                                                  (comment) => {
                                                    if (removeIds.has(String(comment.id))) {
                                                      return false;
                                                    }
                                                    if (
                                                      comment.documentId &&
                                                      removeIds.has(String(comment.documentId))
                                                    ) {
                                                      return false;
                                                    }
                                                    if (
                                                      Number.isFinite(comment.numericId) &&
                                                      removeIds.has(String(comment.numericId))
                                                    ) {
                                                      return false;
                                                    }
                                                    return true;
                                                  }
                                                ),
                                              }));
                                            } catch (err) {
                                              console.error("Delete comment failed", err);
                                              setError("Failed to delete comment");
                                            }
                                          }}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    )}
                                  </li>
                                );
                                })}
                              </ul>
                            ) : (
                              <p className="status">No comments yet.</p>
                            )}
                            <div className="comment-form">
                              <input
                                className="auth-input"
                                placeholder="Add a comment..."
                                value={commentInputs[commentKey] || ""}
                                onChange={(e) =>
                                  setCommentInputs((prev) => ({
                                    ...prev,
                                    [commentKey]: sanitizePostText(e.target.value),
                                  }))
                                }
                              />
                              <button
                                className="btn primary"
                                type="button"
                                disabled={!commentInputs[commentKey]?.trim()}
                                onClick={async () => {
                                  const body = (commentInputs[commentKey] || "").trim();
                                  if (!body) return;
                                  try {
                                    await api.post("/comments", {
                                      data: {
                                        body,
                                        target_type: "group-post",
                                        target_id: post.numericId ?? post.id,
                                      },
                                    });
                                    await refreshCommentsForPost(post.numericId ?? post.id);
                                    setCommentInputs((prev) => ({ ...prev, [commentKey]: "" }));
                                  } catch (err) {
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
                    );
                  })}
                  {posts.length === 0 && <p className="status">No posts yet.</p>}
                </div>
              )}
            </section>
          </>
        )}

        {showSettingsView && settingsPreview && (
          <section className="group-section">
            <div className="group-section-header">
              <div>
                <p className="eyebrow">Settings</p>
                <h3>Group look and feel</h3>
              </div>
            </div>
            <div className="panel-grid">
              <section className="panel group-settings-panel">
                <div className="form-grid">
                  <input
                    className="auth-input"
                    type="text"
                    value={settingsName}
                    onChange={(e) => setSettingsName(e.target.value)}
                    placeholder="Group name"
                  />
                  <textarea
                    className="auth-input"
                    rows={3}
                    value={settingsDescription}
                    onChange={(e) => setSettingsDescription(e.target.value)}
                    placeholder="Description"
                  />
                  <div className="group-toggle-row">
                    <label className="group-toggle">
                      <input
                        type="radio"
                        name="group-visibility"
                        checked={settingsVisibility === "public"}
                        onChange={() => setSettingsVisibility("public")}
                      />
                      <span>Public</span>
                    </label>
                    <label className="group-toggle">
                      <input
                        type="radio"
                        name="group-visibility"
                        checked={settingsVisibility === "private"}
                        onChange={() => setSettingsVisibility("private")}
                      />
                      <span>Private</span>
                    </label>
                  </div>
                  <div className="group-toggle-row">
                    <label className="group-toggle">
                      <input
                        type="checkbox"
                        checked={settingsUseGradient}
                        onChange={() => setSettingsUseGradient((prev) => !prev)}
                      />
                      <span>Use gradient</span>
                    </label>
                    <label className="group-toggle">
                      <input
                        type="checkbox"
                        checked={settingsUseImage}
                        onChange={() => setSettingsUseImage((prev) => !prev)}
                      />
                      <span>Use image</span>
                    </label>
                  </div>
                  {settingsUseGradient && (
                    <div className="group-gradient-row">
                      <label>
                        <span>Start</span>
                        <input
                          type="color"
                          value={settingsGradientStart}
                          onChange={(e) => setSettingsGradientStart(e.target.value)}
                        />
                      </label>
                      <label>
                        <span>End</span>
                        <input
                          type="color"
                          value={settingsGradientEnd}
                          onChange={(e) => setSettingsGradientEnd(e.target.value)}
                        />
                      </label>
                      <label className="group-angle">
                        <span>Angle</span>
                        <input
                          type="range"
                          min={0}
                          max={180}
                          value={settingsGradientAngle}
                          onChange={(e) => setSettingsGradientAngle(Number(e.target.value))}
                        />
                      </label>
                    </div>
                  )}
                  {settingsUseImage && (
                    <div className="group-image-row">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) =>
                          setSettingsImageFile(
                            e.target.files?.[0] ? e.target.files[0] : null
                          )
                        }
                      />
                      {group.backgroundImage && (
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => setSettingsClearImage(true)}
                        >
                          Remove current image
                        </button>
                      )}
                    </div>
                  )}
                  {settingsStatus && <div className="status">{settingsStatus}</div>}
                  <button
                    className="btn primary"
                    type="button"
                    onClick={handleSaveSettings}
                    disabled={savingSettings}
                  >
                    {savingSettings ? "Saving..." : "Save settings"}
                  </button>
                  {isAdmin && (
                    <button
                      className="btn ghost group-danger"
                      type="button"
                      onClick={handleDeleteGroup}
                    >
                      Delete group
                    </button>
                  )}
                </div>
              </section>
              <section className="panel group-settings-preview">
                <div
                  className="group-settings-preview__card"
                  style={buildGroupStyle(settingsPreview)}
                >
                  <div className="group-settings-preview__content">
                    <span className="pill">{settingsVisibility}</span>
                    <h3>{settingsPreview.name}</h3>
                    <p>{settingsPreview.description || "Describe the vibe."}</p>
                  </div>
                </div>
              </section>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
