import axios from "axios";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import api from "../api/strapi";
import PopupModal from "./PopupModal";
import LinkPreviewCard from "./LinkPreviewCard";
import { sanitizePostText } from "../utils/emoji";
import { linkifyText } from "../utils/linkify";
import { pickMediaUrl } from "../utils/media";
import { formatPostUpdateLabel } from "../utils/time";

type ReactionCounts = {
  thumbsUp: number;
  heart: number;
  care: number;
  haha: number;
  wow: number;
  sad: number;
  angry: number;
};

type ReactionOption = {
  key: keyof ReactionCounts;
  emoji: string;
  label: string;
};

type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
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

export type FriendFeedPost = {
  id: number | string;
  numericId?: number;
  documentId?: string;
  ownerId?: number;
  ownerName?: string;
  title: string;
  content: string;
  imageUrl?: string;
  createdAt?: string;
  linkUrl?: string;
  feedbackAudience?: string;
  feedbackTargetId?: number;
  feedbackTargetName?: string;
  likes?: number;
  reactionCounts?: ReactionCounts;
  myReaction?: string | null;
  shares?: number;
  visibility?: string;
};

type FriendPostsFeedProps = {
  posts: FriendFeedPost[];
  onPostsChange: Dispatch<SetStateAction<FriendFeedPost[]>>;
  emptyMessage?: string;
  collapseCount?: number;
};

const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_UPLOAD_LABEL = "1 GB";
const MAX_COMMENT_MEDIA_FILES = 4;
const IMAGE_EXT_REGEX = /\.(?:png|jpe?g|webp|gif|bmp|avif)(?:\?|#|$)/i;
const RELATIVE_UPLOAD_REGEX = /\/uploads\/[^\s)]+/g;
const REACTION_OPTIONS: ReactionOption[] = [
  { key: "thumbsUp", emoji: "👍", label: "Like" },
  { key: "heart", emoji: "❤️", label: "Love" },
  { key: "care", emoji: "🥰", label: "Care" },
  { key: "haha", emoji: "😆", label: "Haha" },
  { key: "wow", emoji: "😮", label: "Wow" },
  { key: "sad", emoji: "😢", label: "Sad" },
  { key: "angry", emoji: "😡", label: "Angry" },
];
const REACTION_VALUES = new Set(REACTION_OPTIONS.map((option) => option.emoji));

const extractFirstUrl = (text: string) => {
  const match = String(text || "").match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (!match) return "";
  let url = match[0].replace(/[),.!?]+$/, "");
  if (url.startsWith("www.")) url = `https://${url}`;
  return url;
};

const isYoutubeUrl = (value?: string) => {
  if (!value) return false;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes("youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
};

const isVideoUrl = (value?: string) => !!value && /\.(mp4|webm|mov|m4v|mkv)$/i.test(value);

const isImageFile = (file: File) => /^image\//i.test(file.type || "");

const feedbackLabelFor = (post: Pick<FriendFeedPost, "feedbackAudience" | "feedbackTargetName">) => {
  const audience = post.feedbackAudience;
  if (!audience || audience === "none") return "";
  if (audience === "public") return "Feedback: Public";
  if (audience === "friends") return "Feedback: Friends";
  if (audience === "specific") return `Feedback: ${post.feedbackTargetName || "You"}`;
  return "";
};

const normalizeReactionCounts = (value: unknown, fallbackLikes?: number): ReactionCounts => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const thumbsUp = Number(record.thumbsUp ?? record.thumbs_up);
  const heart = Number(record.heart);
  const care = Number(record.care);
  const haha = Number(record.haha);
  const wow = Number(record.wow);
  const sad = Number(record.sad);
  const angry = Number(record.angry);
  const hasCounts =
    Number.isFinite(thumbsUp) ||
    Number.isFinite(heart) ||
    Number.isFinite(care) ||
    Number.isFinite(haha) ||
    Number.isFinite(wow) ||
    Number.isFinite(sad) ||
    Number.isFinite(angry);
  return {
    thumbsUp: Number.isFinite(thumbsUp)
      ? thumbsUp
      : hasCounts
      ? 0
      : Number(fallbackLikes ?? 0),
    heart: Number.isFinite(heart) ? heart : 0,
    care: Number.isFinite(care) ? care : 0,
    haha: Number.isFinite(haha) ? haha : 0,
    wow: Number.isFinite(wow) ? wow : 0,
    sad: Number.isFinite(sad) ? sad : 0,
    angry: Number.isFinite(angry) ? angry : 0,
  };
};

const normalizeReactionValue = (value: unknown) => {
  const trimmed = String(value || "").trim();
  return REACTION_VALUES.has(trimmed) ? trimmed : null;
};

const getTopReactionOptions = (counts: ReactionCounts, limit = 3): ReactionOption[] =>
  REACTION_OPTIONS.map((option, index) => ({
    option,
    value: Number(counts[option.key] || 0),
    index,
  }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => (b.value === a.value ? a.index - b.index : b.value - a.value))
    .slice(0, limit)
    .map((entry) => entry.option);

const isPubliclyShareablePost = (post: Pick<FriendFeedPost, "visibility">) => {
  const visibility = String(post.visibility || "").trim().toLowerCase();
  return !visibility || visibility === "public";
};

const extractImageUrls = (text: string) => {
  const input = String(text || "");
  const matches = [
    ...input.matchAll(/https?:\/\/[^\s)]+/g),
    ...input.matchAll(RELATIVE_UPLOAD_REGEX),
  ];
  return matches
    .map((match) => match[0].replace(/[),.!?]+$/, ""))
    .filter((value, index, all) => IMAGE_EXT_REGEX.test(value) && all.indexOf(value) === index);
};

const stripImageUrls = (text: string, urls: string[]) => {
  if (!urls.length) return String(text || "");
  let next = String(text || "");
  urls.forEach((url) => {
    const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, "g"), " ");
  });
  return next.replace(/\n{3,}/g, "\n\n").replace(/[ \t]{2,}/g, " ").trim();
};

const isPreviewableUrl = (value?: string) => {
  if (!value) return false;
  const lower = value.toLowerCase();
  return lower.startsWith("http://") || lower.startsWith("https://") || lower.startsWith("www.");
};

const getEntity = (entry: any) => entry?.data ?? entry ?? null;
const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
const getEntityId = (entry: any) => {
  const data = getEntity(entry);
  const rawId = data?.id ?? data?.attributes?.id;
  const num = Number(rawId);
  return Number.isFinite(num) ? num : undefined;
};
const getEntityLabel = (entry: any, fallback: string) => {
  const attrs = normalize(getEntity(entry));
  const firstName = String(attrs?.firstName || attrs?.firstname || "").trim();
  const lastName = String(attrs?.lastName || attrs?.lastname || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  const handle = String(attrs?.handle || attrs?.username || "").trim();
  return fullName || handle || attrs?.email || fallback;
};

const mapComments = (rows: any[]): Record<string, CommentItem[]> => {
  const next: Record<string, CommentItem[]> = {};
  rows.forEach((entry) => {
    const attrs = normalize(entry);
    const targetId = attrs.target_id ?? entry?.target_id;
    if (targetId === undefined || targetId === null) return;
    const key = String(targetId);
    const ownerEntry = getEntity(attrs.owner ?? entry?.owner);
    const ownerId = getEntityId(ownerEntry);
    const ownerLabel = getEntityLabel(ownerEntry, "User");
    const rawId = entry?.id ?? attrs?.id;
    const numericId = Number(rawId);
    const documentId = attrs?.documentId ?? entry?.documentId;
    const body = String(attrs.body ?? entry?.body ?? "").trim();
    if (!body) return;
    (next[key] = next[key] || []).push({
      id: rawId ?? documentId ?? key,
      numericId: Number.isFinite(numericId) ? numericId : undefined,
      documentId,
      body,
      owner: ownerLabel,
      ownerId,
      createdAt: String(attrs.createdAt ?? entry?.createdAt ?? "") || undefined,
    });
  });
  return next;
};

const shouldIgnorePostOpen = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(
    target.closest(
      "button, a, input, textarea, select, label, video, .popup-modal, .post-action-dialog, .comment-upload"
    )
  );

export default function FriendPostsFeed({
  posts,
  onPostsChange,
  emptyMessage = "No posts yet.",
  collapseCount = 3,
}: FriendPostsFeedProps) {
  const [previewCache, setPreviewCache] = useState<Record<string, LinkPreview | null>>({});
  const previewCacheRef = useRef(previewCache);
  const [postComments, setPostComments] = useState<Record<string, CommentItem[]>>({});
  const [openCommentsFor, setOpenCommentsFor] = useState<Record<string, boolean>>({});
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [commentMediaFiles, setCommentMediaFiles] = useState<Record<string, File[]>>({});
  const [commentMediaPreviews, setCommentMediaPreviews] = useState<Record<string, string[]>>({});
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [reactionBreakdownFor, setReactionBreakdownFor] = useState<string | null>(null);
  const [shareMenuFor, setShareMenuFor] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<Record<string, string>>({});
  const [activePostKey, setActivePostKey] = useState<string | null>(null);
  const [showAllPosts, setShowAllPosts] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    previewCacheRef.current = previewCache;
  }, [previewCache]);

  const fetchLinkPreview = useCallback(async (url: string) => {
    if (!url || previewCacheRef.current[url] !== undefined) return;
    setPreviewCache((prev) => ({ ...prev, [url]: null }));
    try {
      const res = await api.get("/link-preview", { params: { url } });
      const data = res.data?.data;
      const preview: LinkPreview | null = data?.url
        ? {
            url: data.url,
            title: data.title || undefined,
            description: data.description || undefined,
            image: data.image || undefined,
            siteName: data.siteName || undefined,
            type: data.type || undefined,
          }
        : null;
      setPreviewCache((prev) => ({ ...prev, [url]: preview }));
    } catch {
      setPreviewCache((prev) => ({ ...prev, [url]: null }));
    }
  }, []);

  useEffect(() => {
    const urls = new Set<string>();
    posts.forEach((post) => {
      const url = post.linkUrl || extractFirstUrl(post.content);
      if (url && isPreviewableUrl(url) && previewCacheRef.current[url] === undefined) {
        urls.add(url);
      }
    });
    Object.values(postComments).forEach((comments) => {
      comments.forEach((comment) => {
        const url = extractFirstUrl(comment.body);
        if (url && isPreviewableUrl(url) && previewCacheRef.current[url] === undefined) {
          urls.add(url);
        }
      });
    });
    urls.forEach((url) => void fetchLinkPreview(url));
  }, [fetchLinkPreview, postComments, posts]);

  const fetchCommentsForPostIds = useCallback(async (postIds: Array<string | number>) => {
    if (!postIds.length) return {};
    const idFilter = postIds
      .map(
        (id, index) => `filters[target_id][$in][${index}]=${encodeURIComponent(String(id))}`
      )
      .join("&");
    const typeFilter =
      "filters[target_type][$in][0]=user&filters[target_type][$in][1]=users-post";
    const res = await api.get(
      `/comments?${typeFilter}&${idFilter}&populate=owner&pagination[pageSize]=200`
    );
    return mapComments(res.data?.data ?? []);
  }, []);

  useEffect(() => {
    let active = true;
    const targetIds = Array.from(new Set(posts.map((post) => post.numericId ?? post.id)));
    if (!targetIds.length) {
      setPostComments({});
      return;
    }
    const load = async () => {
      try {
        const comments = await fetchCommentsForPostIds(targetIds);
        if (active) setPostComments(comments);
      } catch (err) {
        if (active) {
          console.error("Failed to load comments", err);
          setPostComments({});
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [fetchCommentsForPostIds, posts]);

  useEffect(() => {
    if (!activePostKey) return;
    const exists = posts.some((post) => String(post.id) === activePostKey);
    if (!exists) setActivePostKey(null);
  }, [activePostKey, posts]);

  useEffect(() => {
    if (!activePostKey) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActivePostKey(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePostKey]);

  useEffect(() => {
    if (!activePostKey || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [activePostKey]);

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

  const updatePostMetric = useCallback(
    (postKey: string, field: "likes" | "shares", value: number) => {
      onPostsChange((prev) =>
        prev.map((post) =>
          String(post.id) === postKey ? { ...post, [field]: value } : post
        )
      );
    },
    [onPostsChange]
  );

  const updatePostReactions = useCallback(
    (postKey: string, reactionCounts: ReactionCounts, myReaction: string | null) => {
      onPostsChange((prev) =>
        prev.map((post) =>
          String(post.id) === postKey ? { ...post, reactionCounts, myReaction } : post
        )
      );
    },
    [onPostsChange]
  );

  const buildShareUrl = useCallback((post: FriendFeedPost, postKey: string) => {
    if (typeof window === "undefined") return "";
    const origin = String(window.location.origin || "").trim().replace(/\/+$/, "");
    const configuredBase = String(import.meta.env.VITE_PUBLIC_SITE_URL || "")
      .trim()
      .replace(/\/+$/, "");
    const base = origin.startsWith("http")
      ? origin
      : configuredBase.startsWith("http")
      ? configuredBase
      : "";
    if (!base) return "";
    const configuredApi = String(import.meta.env.VITE_API_URL || "")
      .trim()
      .replace(/\/+$/, "");
    const apiBase = !configuredApi
      ? `${base}/api`
      : /^https?:\/\//i.test(configuredApi)
      ? /\/api$/i.test(configuredApi)
        ? configuredApi
        : `${configuredApi}/api`
      : `${base}/${configuredApi.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\/api$/i, "")}/api`;
    const shareId = String(post.documentId ?? post.numericId ?? post.id ?? postKey).trim();
    if (!shareId) return "";
    const params = new URLSearchParams({
      source: "user",
      id: shareId,
      site: base,
    });
    return `${apiBase.replace(/\/+$/, "")}/share/post?${params.toString()}`;
  }, []);

  const trackShare = useCallback(
    async (post: FriendFeedPost, postKey: string) => {
      try {
        const res = await api.post(`/users-posts/${post.id}/share`);
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
    async (post: FriendFeedPost, postKey: string, shareUrl: string) => {
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
    async (post: FriendFeedPost, postKey: string, shareUrl: string, shareText: string) => {
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
    async (post: FriendFeedPost, postKey: string, emoji: string) => {
      if (!REACTION_VALUES.has(emoji)) {
        pushShareNotice(postKey, "Unsupported reaction.");
        return;
      }
      try {
        const res = await api.post(`/users-posts/${post.id}/react`, { emoji });
        const payload = res.data?.data;
        const payloadLikes = Number(payload?.likes);
        const nextLikes = Number.isFinite(payloadLikes)
          ? payloadLikes
          : Number(post.likes ?? 0) + 1;
        if (Number.isFinite(payloadLikes)) {
          updatePostMetric(postKey, "likes", nextLikes);
        }
        updatePostReactions(
          postKey,
          normalizeReactionCounts(payload?.reactionCounts, nextLikes),
          normalizeReactionValue(payload?.myReaction ?? emoji)
        );
        setReactionPickerFor(null);
        pushShareNotice(
          postKey,
          payload?.alreadyReacted
            ? payload?.updated
              ? `Reaction updated ${emoji}`
              : "You already reacted."
            : `You reacted ${emoji}`
        );
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

  const clearCommentAttachments = useCallback((commentKey: string) => {
    setCommentMediaFiles((prev) => {
      if (!(commentKey in prev)) return prev;
      const next = { ...prev };
      delete next[commentKey];
      return next;
    });
    setCommentMediaPreviews((prev) => {
      if (!(commentKey in prev)) return prev;
      const next = { ...prev };
      const urls = next[commentKey] || [];
      if (typeof URL !== "undefined") urls.forEach((url) => URL.revokeObjectURL(url));
      delete next[commentKey];
      return next;
    });
  }, []);

  const handleCommentFilesChange = useCallback((commentKey: string, files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files).filter((file) => isImageFile(file));
    if (!selected.length) {
      setError("Only image files are allowed for comments.");
      return;
    }
    const limited = selected.slice(0, MAX_COMMENT_MEDIA_FILES);
    if (selected.length > MAX_COMMENT_MEDIA_FILES) {
      setError(`You can upload up to ${MAX_COMMENT_MEDIA_FILES} images per comment.`);
    }
    for (const file of limited) {
      if (file.size > MAX_UPLOAD_BYTES) {
        setError(`Images must be under ${MAX_UPLOAD_LABEL}.`);
        return;
      }
    }
    setCommentMediaFiles((prev) => ({ ...prev, [commentKey]: limited }));
    setCommentMediaPreviews((prev) => {
      const next = { ...prev };
      const urls = next[commentKey] || [];
      if (typeof URL !== "undefined") urls.forEach((url) => URL.revokeObjectURL(url));
      next[commentKey] = limited.map((file) => URL.createObjectURL(file));
      return next;
    });
  }, []);

  const removeCommentAttachment = useCallback((commentKey: string, index: number) => {
    setCommentMediaFiles((prev) => {
      const current = prev[commentKey];
      if (!current) return prev;
      const nextFiles = current.filter((_, idx) => idx !== index);
      const next = { ...prev };
      if (nextFiles.length) next[commentKey] = nextFiles;
      else delete next[commentKey];
      return next;
    });
    setCommentMediaPreviews((prev) => {
      const current = prev[commentKey];
      if (!current) return prev;
      const nextUrls = current.filter((_, idx) => idx !== index);
      if (typeof URL !== "undefined" && current[index]) URL.revokeObjectURL(current[index]);
      const next = { ...prev };
      if (nextUrls.length) next[commentKey] = nextUrls;
      else delete next[commentKey];
      return next;
    });
  }, []);

  const visiblePosts = useMemo(() => {
    if (!collapseCount || showAllPosts || posts.length <= collapseCount) return posts;
    return posts.slice(0, collapseCount);
  }, [collapseCount, posts, showAllPosts]);

  const activePost = useMemo(
    () => posts.find((post) => String(post.id) === activePostKey) ?? null,
    [activePostKey, posts]
  );

  const renderCommentsModal = (post: FriendFeedPost) => {
    const commentKey = String(post.numericId ?? post.id);
    const comments = postComments[commentKey] ?? [];
    const attachmentFiles = commentMediaFiles[commentKey] ?? [];
    const attachmentPreviews = commentMediaPreviews[commentKey] ?? [];
    return (
      <PopupModal
        open={Boolean(openCommentsFor[commentKey])}
        title="Comments"
        onClose={() => {
          clearCommentAttachments(commentKey);
          setOpenCommentsFor((prev) => ({ ...prev, [commentKey]: false }));
        }}
        className="comment-modal"
        bodyClassName="comment-modal-body"
      >
        <div className="comments comments--modal">
          <p className="eyebrow">Comments</p>
          {comments.length > 0 ? (
            <ul className="comment-list">
              {comments.map((comment) => {
                const imageUrls = extractImageUrls(comment.body);
                const cleanedBody = stripImageUrls(comment.body, imageUrls);
                const displayBody = cleanedBody || (imageUrls.length ? "" : comment.body);
                const commentUrl = extractFirstUrl(cleanedBody);
                const preview =
                  isPreviewableUrl(commentUrl) && commentUrl ? previewCache[commentUrl] : null;
                return (
                  <li key={String(comment.id)} className="comment-item">
                    <div className="comment-author">{comment.owner || "User"}</div>
                    <div className="comment-body">{linkifyText(displayBody)}</div>
                    {imageUrls.length > 0 && (
                      <div className="comment-images">
                        {imageUrls.map((url, index) => (
                          <img
                            key={`${comment.id}-${index}`}
                            src={pickMediaUrl(url, { kind: "post" }) || url}
                            alt="Comment attachment"
                            loading="lazy"
                            decoding="async"
                          />
                        ))}
                      </div>
                    )}
                    {preview && (
                      <div className="comment-preview">
                        <LinkPreviewCard preview={preview} url={preview.url || commentUrl} compact />
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
            <div className="comment-form-row">
              <input
                className="auth-input"
                placeholder="Add a comment..."
                value={commentInputs[commentKey] || ""}
                onChange={(event) =>
                  setCommentInputs((prev) => ({
                    ...prev,
                    [commentKey]: sanitizePostText(event.target.value),
                  }))
                }
              />
              <button
                className="btn primary"
                type="button"
                disabled={!commentInputs[commentKey]?.trim() && attachmentFiles.length === 0}
                onClick={async () => {
                  const body = (commentInputs[commentKey] || "").trim();
                  if (!body && attachmentFiles.length === 0) return;
                  try {
                    let attachmentUrls: string[] = [];
                    if (attachmentFiles.length > 0) {
                      const fd = new FormData();
                      attachmentFiles.forEach((file) => fd.append("files", file));
                      const uploadRes = await api.post("/upload", fd);
                      attachmentUrls = (uploadRes.data ?? [])
                        .map((item: { url?: string }) => item?.url)
                        .filter((url: string | undefined): url is string => Boolean(url));
                    }
                    await api.post("/comments", {
                      data: {
                        body: [body, ...attachmentUrls].filter(Boolean).join("\n"),
                        target_type: "user",
                        target_id: post.numericId ?? post.id,
                      },
                    });
                    await refreshCommentsForPost(post.numericId ?? post.id);
                    setCommentInputs((prev) => ({ ...prev, [commentKey]: "" }));
                    clearCommentAttachments(commentKey);
                    setError(null);
                  } catch (err) {
                    console.error("Add comment failed", err);
                    if (axios.isAxiosError(err)) {
                      setError(
                        err.response?.data?.error?.message ||
                          err.response?.data?.message ||
                          "Failed to add comment."
                      );
                    } else {
                      setError("Failed to add comment.");
                    }
                  }
                }}
              >
                Comment
              </button>
            </div>
            <div className="comment-attachments">
              <label className="comment-upload">
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(event) => {
                    handleCommentFilesChange(commentKey, event.target.files);
                    event.target.value = "";
                  }}
                />
                <span>{attachmentFiles.length ? "Change photos" : "Add photos"}</span>
              </label>
              {attachmentPreviews.length > 0 && (
                <div className="comment-attachment-list">
                  {attachmentPreviews.map((url, index) => (
                    <div key={`${commentKey}-${index}`} className="comment-attachment">
                      <img
                        src={url}
                        alt="New attachment preview"
                        loading="lazy"
                        decoding="async"
                      />
                      <button
                        type="button"
                        className="comment-attachment-remove"
                        aria-label="Remove photo"
                        onClick={() => removeCommentAttachment(commentKey, index)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </PopupModal>
    );
  };

  const renderPostCard = (post: FriendFeedPost, openable = true) => {
    const postKey = String(post.id);
    const commentKey = String(post.numericId ?? post.id);
    const postUrl = post.linkUrl || extractFirstUrl(post.content);
    const preview = postUrl ? previewCache[postUrl] : undefined;
    const showPreviewMedia = !post.imageUrl && !!preview?.image && !isYoutubeUrl(postUrl);
    const likesCount = Number(post.likes ?? 0);
    const reactionCounts = normalizeReactionCounts(post.reactionCounts, likesCount);
    const myReaction = normalizeReactionValue(post.myReaction);
    const reactionTotalCount = REACTION_OPTIONS.reduce(
      (sum, option) => sum + Number(reactionCounts[option.key] || 0),
      0
    );
    const topReactions = getTopReactionOptions(reactionCounts);
    const reactionBadgeOptions = topReactions.length ? topReactions : REACTION_OPTIONS.slice(0, 1);
    const commentsCount = (postComments[commentKey] ?? []).length;
    const sharesCount = Number(post.shares ?? 0);
    const isReactionPickerOpen = reactionPickerFor === postKey;
    const isReactionBreakdownOpen = reactionBreakdownFor === postKey;
    const showShareMenu = shareMenuFor === postKey;
    const shareUrl = buildShareUrl(post, postKey);
    const shareText = post.title
      ? `${post.ownerName || "Friend"}: ${post.title}`
      : `${post.ownerName || "Friend"} posted an update.`;
    const encodedUrl = encodeURIComponent(shareUrl);
    const encodedText = encodeURIComponent(shareText);
    return (
      <article
        key={postKey}
        id={`post-${postKey}`}
        className={`post-card${openable ? " post-card--openable" : ""}${
          showShareMenu || isReactionPickerOpen || isReactionBreakdownOpen
            ? " is-popover-open"
            : ""
        }`}
        role={openable ? "button" : undefined}
        tabIndex={openable ? 0 : undefined}
        onClick={(event) => {
          if (!openable || shouldIgnorePostOpen(event.target)) return;
          setActivePostKey(postKey);
        }}
        onKeyDown={(event) => {
          if (!openable || (event.key !== "Enter" && event.key !== " ")) return;
          if (shouldIgnorePostOpen(event.target)) return;
          event.preventDefault();
          setActivePostKey(postKey);
        }}
      >
        <div className="post-meta-bar">
          <span className="post-meta-name">{post.ownerName || "Friend"}</span>
          <span className="post-meta-text">{formatPostUpdateLabel(post.createdAt)}</span>
          {feedbackLabelFor(post) && <span className="post-feedback-tag">{feedbackLabelFor(post)}</span>}
        </div>
        {post.imageUrl ? (
          <div className="post-media">
            {isVideoUrl(post.imageUrl) ? (
              <video controls playsInline preload="metadata">
                <source src={post.imageUrl} />
              </video>
            ) : (
              <img src={post.imageUrl} alt={post.title} loading="lazy" decoding="async" />
            )}
          </div>
        ) : showPreviewMedia ? (
          <div className="post-media link-preview-media">
            <img
              src={preview?.image}
              alt={preview?.title || post.title}
              loading="lazy"
              decoding="async"
            />
          </div>
        ) : null}
        <div className="post-body">
          <h3>{post.title}</h3>
          <p className="post-body-text">{linkifyText(post.content)}</p>
          {preview && !post.imageUrl && (
            <LinkPreviewCard preview={preview} url={preview.url || postUrl} compact />
          )}
          <div className="post-actions" onClick={(event) => event.stopPropagation()}>
            <div
              className={`post-action-counts post-action-counts--with-breakdown${
                isReactionBreakdownOpen ? " is-open" : ""
              }`}
              role="button"
              tabIndex={0}
              aria-label="Show reaction breakdown"
              aria-expanded={isReactionBreakdownOpen}
              onClick={() =>
                setReactionBreakdownFor((prev) => (prev === postKey ? null : postKey))
              }
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                setReactionBreakdownFor((prev) => (prev === postKey ? null : postKey));
              }}
            >
              <span
                className={`post-action-count post-action-count--reactions${
                  myReaction ? " is-selected" : ""
                }`}
              >
                <span className="post-action-reaction-stack" aria-hidden="true">
                  {reactionBadgeOptions.map((option, index) => (
                    <span
                      key={`${postKey}-${option.key}-${index}`}
                      className="post-action-reaction-chip"
                      title={option.label}
                    >
                      {option.emoji}
                    </span>
                  ))}
                </span>
                <span className="post-action-count-total">{reactionTotalCount}</span>
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
              <div
                className={`post-action-popover post-action-popover--reaction-breakdown${
                  isReactionBreakdownOpen ? " is-open" : ""
                }`}
                role="tooltip"
              >
                <div className="post-reaction-breakdown">
                  {REACTION_OPTIONS.map((option) => (
                    <div className="post-reaction-breakdown-row" key={option.key}>
                      <span className="post-reaction-breakdown-meta">
                        <span aria-hidden="true">{option.emoji}</span>
                        <span>{option.label}</span>
                      </span>
                      <strong>{Number(reactionCounts[option.key] || 0)}</strong>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="post-action-bar">
              <div className="post-action-group post-action-group--reaction">
                <button
                  className={`post-action-btn${myReaction ? " is-reacted" : ""}`}
                  type="button"
                  aria-pressed={Boolean(myReaction)}
                  aria-expanded={isReactionPickerOpen}
                  aria-haspopup="dialog"
                  onClick={() =>
                    setReactionPickerFor((prev) => (prev === postKey ? null : postKey))
                  }
                >
                  <span className="post-action-icon" aria-hidden="true">
                    {myReaction || "👍"}
                  </span>
                  <span>Like</span>
                </button>
                <PopupModal
                  open={isReactionPickerOpen}
                  title="Choose reaction"
                  onClose={() => setReactionPickerFor(null)}
                  className="post-action-dialog"
                  bodyClassName="post-action-dialog-body"
                >
                  <div className="post-reaction-picker post-reaction-picker--modal">
                    {REACTION_OPTIONS.map((option) => (
                      <button
                        key={option.key}
                        className={`post-reaction-emoji${
                          myReaction === option.emoji ? " is-selected" : ""
                        }`}
                        type="button"
                        aria-label={option.label}
                        title={option.label}
                        onClick={() => {
                          setReactionPickerFor(null);
                          void handleReaction(post, postKey, option.emoji);
                        }}
                      >
                        {option.emoji}
                      </button>
                    ))}
                  </div>
                </PopupModal>
              </div>
              <div className="post-action-group">
                <button
                  className="post-action-btn"
                  type="button"
                  aria-pressed={Boolean(openCommentsFor[commentKey])}
                  onClick={() =>
                    setOpenCommentsFor((prev) => ({ ...prev, [commentKey]: !prev[commentKey] }))
                  }
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
                  aria-haspopup="dialog"
                  onClick={() => setShareMenuFor((prev) => (prev === postKey ? null : postKey))}
                >
                  <span className="post-action-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24">
                      <path d="M14 3 21 10 14 17v-4h-4a4 4 0 0 0-4 4v4H4v-4a6 6 0 0 1 6-6h4V3Z" />
                    </svg>
                  </span>
                  <span>Share</span>
                </button>
                <PopupModal
                  open={showShareMenu}
                  title="Share post"
                  onClose={() => setShareMenuFor(null)}
                  className="post-action-dialog"
                  bodyClassName="post-action-dialog-body"
                >
                  <div className="post-share-grid post-share-grid--modal">
                    <button
                      className="post-share-btn is-icon"
                      type="button"
                      onClick={() => {
                        void handleCopyShare(post, postKey, shareUrl);
                        setShareMenuFor(null);
                      }}
                    >
                      <span className="post-share-icon" aria-hidden="true">
                        🔗
                      </span>
                      <span className="post-share-label">Copy link</span>
                    </button>
                    {typeof navigator !== "undefined" && typeof navigator.share === "function" && (
                      <button
                        className="post-share-btn is-icon"
                        type="button"
                        onClick={() => {
                          void handleNativeShare(post, postKey, shareUrl, shareText);
                          setShareMenuFor(null);
                        }}
                      >
                        <span className="post-share-icon" aria-hidden="true">
                          📤
                        </span>
                        <span className="post-share-label">Share</span>
                      </button>
                    )}
                    {[
                      ["Facebook", `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`, "f"],
                      ["X", `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`, "X"],
                      [
                        "LinkedIn",
                        `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
                        "in",
                      ],
                      ["Reddit", `https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`, "r"],
                      ["WhatsApp", `https://wa.me/?text=${encodedText}%20${encodedUrl}`, "🟢"],
                    ].map(([label, href, icon]) => (
                      <a
                        key={label}
                        className={`post-share-link is-icon post-share-link--${label.toLowerCase()}`}
                        href={href}
                        onClick={(event) => {
                          if (!isPubliclyShareablePost(post)) {
                            event.preventDefault();
                            pushShareNotice(postKey, "Only public posts can be shared externally.");
                            return;
                          }
                          setShareMenuFor(null);
                          void trackShare(post, postKey);
                        }}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span className="post-share-icon" aria-hidden="true">
                          {icon}
                        </span>
                        <span className="post-share-label">{label}</span>
                      </a>
                    ))}
                  </div>
                </PopupModal>
              </div>
            </div>
          </div>
          {shareNotice[postKey] && <p className="post-action-notice">{shareNotice[postKey]}</p>}
          {renderCommentsModal(post)}
        </div>
      </article>
    );
  };

  if (!posts.length) {
    return <p className="status">{emptyMessage}</p>;
  }

  return (
    <>
      {collapseCount > 0 && posts.length > collapseCount && (
        <div className="friend-posts-header">
          <button
            className="btn ghost friend-posts-toggle"
            type="button"
            onClick={() => setShowAllPosts((prev) => !prev)}
          >
            {showAllPosts ? "Hide posts" : "Show all posts"}
          </button>
        </div>
      )}
      {error && <p className="status status-error">{error}</p>}
      <div className="posts-grid">{visiblePosts.map((post) => renderPostCard(post))}</div>
      {activePost && (
        <div
          className="post-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`friend-post-title-${String(activePost.id)}`}
          onClick={() => setActivePostKey(null)}
        >
          <div className="post-modal__panel" onClick={(event) => event.stopPropagation()}>
            <div className="post-modal__handle" aria-hidden="true" />
            <button
              className="post-modal__close"
              type="button"
              onClick={() => setActivePostKey(null)}
              aria-label="Close post"
            >
              X
            </button>
            <div className="post-modal__scroll">
              <div id={`friend-post-title-${String(activePost.id)}`}>{renderPostCard(activePost, false)}</div>
            </div>
            <div className="post-modal__mobile-actions">
              <button
                className="post-modal__close-btn"
                type="button"
                onClick={() => setActivePostKey(null)}
              >
                Close
              </button>
              <span className="post-modal__hint">Tap outside to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
