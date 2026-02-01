import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import axios from "axios";
import "../css/forums.css";
import api from "../api/strapi";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import { useAuth } from "../context/AuthContext";
import { usePageMeta } from "../hooks/usePageMeta";
import { useUserPreferences } from "../context/UserPreferencesContext";

type ForumCategory = {
  id: number | string;
  name: string;
  description: string;
  slug?: string;
  isCustom?: boolean;
  sortOrder?: number;
};

type ForumPost = {
  id: string | number;
  numericId?: number;
  documentId?: string;
  title: string;
  body: string;
  categoryId: string | number;
  intent: "win" | "support" | "idea" | "tip" | "gratitude";
  authorName: string;
  ownerId?: number;
  createdAt: string;
  encouragements: number;
  thanks: number;
  status?: "approved" | "review" | "blocked";
};

type ForumPostComment = {
  id: string | number;
  documentId?: string;
  numericId?: number;
  postId: string | number;
  parentId?: string | number | null;
  body: string;
  ownerName: string;
  ownerId?: number;
  createdAt: string;
  children?: ForumPostComment[];
};

type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
};

const DEFAULT_CATEGORIES: ForumCategory[] = [
  {
    id: "growth",
    name: "Personal Growth",
    description: "Habits, mindset, and momentum.",
  },
  {
    id: "health",
    name: "Health & Wellness",
    description: "Movement, rest, and mental clarity.",
  },
  {
    id: "career",
    name: "Career & Purpose",
    description: "Work wins, pivots, and purpose.",
  },
  {
    id: "relationships",
    name: "Relationships",
    description: "Supportive connections and communication.",
  },
  {
    id: "creativity",
    name: "Creativity",
    description: "Ideas, art, music, and expression.",
  },
  {
    id: "learning",
    name: "Learning",
    description: "Courses, books, and growth notes.",
  },
  {
    id: "faith",
    name: "Faith & Meaning",
    description: "Purpose, spirituality, and gratitude.",
  },
  {
    id: "money",
    name: "Money & Freedom",
    description: "Budgeting, saving, and milestones.",
  },
];

const INTENT_LABELS: Record<ForumPost["intent"], string> = {
  win: "Win",
  support: "Support request",
  idea: "Idea",
  tip: "Tip",
  gratitude: "Gratitude",
};

const TEMPLATE_PRESETS = [
  {
    id: "win",
    label: "Share a win",
    intent: "win" as const,
    body: "Win:\n\nWhat helped:\n\nNext step:",
  },
  {
    id: "support",
    label: "Ask for support",
    intent: "support" as const,
    body: "I'm working on...\n\nWhat I've tried:\n\nWhat would help:",
  },
  {
    id: "gratitude",
    label: "Gratitude",
    intent: "gratitude" as const,
    body: "I'm grateful for...\n\nWhy it matters:\n\nHow I'll keep it going:",
  },
  {
    id: "tip",
    label: "Share a tip",
    intent: "tip" as const,
    body: "Tip:\n\nWhen to use it:\n\nHelpful resources:",
  },
];

const PLEDGE_OPTIONS = [
  {
    value: "uplifting",
    label: "Uplifting ally",
    description: "I will keep this space encouraging and kind.",
  },
  {
    value: "support",
    label: "Support seeker",
    description: "I am here to ask for help and welcome encouragement.",
  },
  {
    value: "accountability",
    label: "Accountability partner",
    description: "I will check in, follow through, and encourage progress.",
  },
  {
    value: "feedback",
    label: "Feedback giver",
    description: "I will offer thoughtful, constructive feedback.",
  },
  {
    value: "listener",
    label: "Compassionate listener",
    description: "I will listen without judgment and respond with care.",
  },
  {
    value: "celebrator",
    label: "Win celebrator",
    description: "I will celebrate wins and share uplifting energy.",
  },
] as const;

const NEGATIVE_TERMS = [
  "hate",
  "stupid",
  "idiot",
  "dumb",
  "loser",
  "trash",
  "worthless",
  "kill",
  "die",
  "suicide",
  "ugly",
  "shut up",
  "shutup",
  "moron",
  "pathetic",
  "garbage",
  "worst",
  "awful",
  "disgusting",
  "toxic",
  "jerk",
  "bully",
];

const EXPLICIT_TERMS = new Set([
  "sex",
  "sexual",
  "sexy",
  "porn",
  "porno",
  "xxx",
  "nude",
  "nudes",
  "naked",
  "topless",
  "boobs",
  "breasts",
  "nipple",
  "nipples",
  "penis",
  "dick",
  "cock",
  "vagina",
  "pussy",
  "anal",
  "blowjob",
  "handjob",
  "fuck",
  "fucking",
  "escort",
  "strip",
  "stripper",
  "onlyfans",
  "camgirl",
  "camgirls",
  "fetish",
]);

const tokenize = (value: string) =>
  value
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter(Boolean);

const findExplicitTerm = (value: string) => {
  const tokens = tokenize(value || "");
  return tokens.find((token) => EXPLICIT_TERMS.has(token)) || "";
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

const isVideoUrl = (value?: string) =>
  !!value && /\.(mp4|webm|mov|m4v|mkv)$/i.test(value);

const isPreviewableUrl = (value?: string) =>
  !!value && (isYoutubeUrl(value) || isVideoUrl(value));

const getEntity = (entry: any) => entry?.data ?? entry ?? null;

const getEntityId = (entry: any) => {
  if (typeof entry === "number" || typeof entry === "string") return entry;
  const data = getEntity(entry);
  return data?.id ?? data?.documentId ?? null;
};

const normalizeCategory = (entry: any): ForumCategory => {
  const record = getEntity(entry);
  const attrs = record?.attributes ?? record ?? {};
  return {
    id: record?.id ?? record?.documentId ?? attrs?.id ?? attrs?.documentId ?? "",
    name: String(attrs?.name || "").trim(),
    description: String(attrs?.description || "").trim(),
    slug: attrs?.slug,
    isCustom: Boolean(attrs?.isCustom),
    sortOrder: Number(attrs?.sortOrder ?? 0),
  };
};

const normalizePost = (entry: any): ForumPost => {
  const record = getEntity(entry);
  const attrs = record?.attributes ?? record ?? {};
  const categoryId = getEntityId(attrs?.category) ?? "";
  const owner = getEntity(attrs?.owner);
  const authorFallback =
    String(attrs?.authorLabel || "").trim() ||
    String(owner?.username || "").trim() ||
    String(owner?.email || "").trim() ||
    "Member";

  return {
    id: record?.id ?? record?.documentId ?? attrs?.id ?? attrs?.documentId ?? "",
    numericId: Number.isFinite(Number(record?.id ?? attrs?.id))
      ? Number(record?.id ?? attrs?.id)
      : undefined,
    documentId: record?.documentId ?? attrs?.documentId,
    title: String(attrs?.title || "").trim(),
    body: String(attrs?.body || "").trim(),
    categoryId,
    intent: (attrs?.intent || "win") as ForumPost["intent"],
    authorName: authorFallback,
    ownerId: Number(getEntityId(owner) ?? 0) || undefined,
    createdAt: String(attrs?.createdAt || new Date().toISOString()),
    encouragements: Number(attrs?.encouragements ?? 0),
    thanks: Number(attrs?.thanks ?? 0),
    status: attrs?.status as ForumPost["status"],
  };
};

const LinkPreviewCard = ({
  preview,
  url,
  compact = true,
}: {
  preview: LinkPreview;
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

const normalizeComment = (entry: any): ForumPostComment => {
  const record = getEntity(entry);
  const attrs = record?.attributes ?? record ?? {};
  const owner = getEntity(attrs?.owner ?? record?.owner);
  const documentId = record?.documentId ?? attrs?.documentId ?? undefined;
  const numericId = Number(record?.id ?? attrs?.id);
  const postRecord = getEntity(attrs?.post);
  const parentRecord = getEntity(attrs?.parent);
  const authorFallback =
    String(owner?.username || "").trim() ||
    String(owner?.email || "").trim() ||
    "Member";
  return {
    id: documentId ?? record?.id ?? attrs?.id ?? "",
    documentId: documentId || undefined,
    numericId: Number.isFinite(numericId) ? numericId : undefined,
    postId: postRecord?.documentId ?? postRecord?.id ?? "",
    parentId: parentRecord?.documentId ?? parentRecord?.id ?? null,
    body: String(attrs?.body || "").trim(),
    ownerName: authorFallback,
    ownerId: Number(getEntityId(owner) ?? 0) || undefined,
    createdAt: String(attrs?.createdAt || new Date().toISOString()),
  };
};

const buildCommentTree = (comments: ForumPostComment[]) => {
  const nodes = comments.map((comment) => ({ ...comment, children: [] }));
  const lookup = new Map<string, ForumPostComment>();
  nodes.forEach((comment) => {
    const keys = new Set<string>();
    keys.add(String(comment.id));
    if (comment.documentId) keys.add(String(comment.documentId));
    if (typeof comment.numericId === "number") keys.add(String(comment.numericId));
    keys.forEach((key) => lookup.set(key, comment));
  });

  const roots: ForumPostComment[] = [];
  nodes.forEach((comment) => {
    const parentId = comment.parentId ? String(comment.parentId) : "";
    const parent = parentId ? lookup.get(parentId) : null;
    if (parent) {
      parent.children?.push(comment);
    } else {
      roots.push(comment);
    }
  });

  const sortTree = (nodes: ForumPostComment[]) => {
    nodes.sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    nodes.forEach((node) => {
      if (node.children && node.children.length) sortTree(node.children);
    });
  };
  sortTree(roots);

  return roots;
};

const getPostKey = (post: ForumPost) =>
  String(post.documentId ?? post.numericId ?? post.id ?? "");

const sortCategories = (list: ForumCategory[]) =>
  [...list].sort((a, b) => {
    const orderA = Number(a.sortOrder ?? 0);
    const orderB = Number(b.sortOrder ?? 0);
    if (orderA !== orderB) return orderA - orderB;
    return a.name.localeCompare(b.name);
  });

const findErrorMessage = (error: any, fallback: string) => {
  const message =
    error?.response?.data?.error?.message ||
    error?.response?.data?.message ||
    error?.message;
  return String(message || fallback);
};

type QuickReplyState = Record<
  string,
  {
    encouraged?: boolean;
    thanked?: boolean;
  }
>;

const quickReplyStorageKeyFor = (userId?: number | string | null) =>
  userId ? `ysp-forums-quick-replies-${userId}` : "ysp-forums-quick-replies-guest";

const loadQuickReplyState = (key: string): QuickReplyState => {
  if (typeof window === "undefined") return {};
  const raw = window.localStorage.getItem(key);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as QuickReplyState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

const saveQuickReplyState = (key: string, state: QuickReplyState) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(state));
};

export default function Forums() {
  const { user } = useAuth();
  const { getBackgroundStyle } = useUserPreferences();
  const quickReplyStorageKey = quickReplyStorageKeyFor(user?.id ?? null);
  const [categories, setCategories] = useState<ForumCategory[]>(DEFAULT_CATEGORIES);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [commentsByPost, setCommentsByPost] = useState<
    Record<string, ForumPostComment[]>
  >({});
  const [previewCache, setPreviewCache] = useState<Record<string, LinkPreview | null>>(
    {}
  );
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [replyInputs, setReplyInputs] = useState<Record<string, string>>({});
  const [openComments, setOpenComments] = useState<Record<string, boolean>>({});
  const [openReplies, setOpenReplies] = useState<Record<string, boolean>>({});
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editInputs, setEditInputs] = useState<Record<string, string>>({});
  const [commentError, setCommentError] = useState<string | null>(null);
  const [commentSubmitting, setCommentSubmitting] = useState<
    Record<string, boolean>
  >({});
  const [commentEditing, setCommentEditing] = useState<Record<string, boolean>>({});
  const [commentDeleting, setCommentDeleting] = useState<Record<string, boolean>>({});
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostTitle, setEditPostTitle] = useState("");
  const [editPostBody, setEditPostBody] = useState("");
  const [postEditing, setPostEditing] = useState<Record<string, boolean>>({});
  const [postDeleting, setPostDeleting] = useState<Record<string, boolean>>({});
  const [quickReplies, setQuickReplies] = useState<QuickReplyState>(() =>
    loadQuickReplyState(quickReplyStorageKey)
  );
  const [quickReplySubmitting, setQuickReplySubmitting] = useState<
    Record<string, boolean>
  >({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [categorySearch, setCategorySearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [intentFilter, setIntentFilter] = useState<ForumPost["intent"] | "all">(
    "all"
  );
  const [search, setSearch] = useState("");
  const [postTitle, setPostTitle] = useState("");
  const [postBody, setPostBody] = useState("");
  const [postCategory, setPostCategory] = useState<string>("");
  const [postIntent, setPostIntent] = useState<ForumPost["intent"]>("win");
  const [pledgeAccepted, setPledgeAccepted] = useState(false);
  const [pledgeChoice, setPledgeChoice] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [nudge, setNudge] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const topicsRef = useRef<HTMLDivElement | null>(null);
  const createPostRef = useRef<HTMLDivElement | null>(null);

  usePageMeta({
    title: "Forums | Your Social Place",
    description:
      "Uplifting forums built for encouragement, progress, and positive support.",
    type: "website",
    canonical: "https://yoursocialplace.com/forums",
    keywords:
      "uplifting forums, supportive community, positive social network, goals, accountability",
  });

  const loadForums = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [categoryRes, postsRes] = await Promise.all([
        api.get("/forum-categories?sort=sortOrder:asc&sort=name:asc"),
        api.get("/forum-posts?populate=owner&populate=category&sort=createdAt:desc"),
      ]);
      const categoryData = (categoryRes.data?.data ?? []).map(normalizeCategory);
      const postData = (postsRes.data?.data ?? []).map(normalizePost);
      if (categoryData.length) {
        setCategories(sortCategories(categoryData));
      }
      setPosts(postData);
    } catch (error) {
      setLoadError(findErrorMessage(error, "Unable to load forums right now."));
    } finally {
      setLoading(false);
    }
  }, []);

  const buildCommentQuery = (postIds: Array<string | number>) => {
    const numericIds = postIds
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id));
    const docIds = postIds
      .map((id) => String(id))
      .filter((id) => !Number.isFinite(Number(id)));

    const parts: string[] = [];
    let orIndex = 0;
    if (numericIds.length) {
      numericIds.forEach((id, index) => {
        parts.push(`filters[$or][${orIndex}][post][id][$in][${index}]=${id}`);
      });
      orIndex += 1;
    }
    if (docIds.length) {
      docIds.forEach((id, index) => {
        parts.push(
          `filters[$or][${orIndex}][post][documentId][$in][${index}]=${encodeURIComponent(
            id
          )}`
        );
      });
    }

    return parts.join("&");
  };

  const loadComments = useCallback(
    async (postIds: Array<string | number>) => {
      if (!postIds.length) return;
      const query = buildCommentQuery(postIds);
      try {
        const response = await api.get(
          `/forum-post-comments?${query}&populate=owner&populate=parent&populate=post&sort=createdAt:asc&pagination[pageSize]=500`
        );
        const entries = (response.data?.data ?? []).map(normalizeComment);
        const grouped: Record<string, ForumPostComment[]> = {};
        postIds.forEach((postId) => {
          const key = String(postId);
          if (key) grouped[key] = [];
        });
        entries.forEach((comment: ForumPostComment) => {
          const key = String(comment.postId || "");
          if (!key) return;
          grouped[key] = grouped[key] ? [...grouped[key], comment] : [comment];
        });
        setCommentsByPost((prev) => ({ ...prev, ...grouped }));
      } catch (error) {
        setCommentError(findErrorMessage(error, "Unable to load comments."));
      }
    },
    []
  );

  const fetchLinkPreview = useCallback(
    async (url: string): Promise<LinkPreview | null> => {
      if (!url) return null;
      if (previewCache[url] !== undefined) return previewCache[url];
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
        return null;
      }
    },
    [previewCache]
  );

  const toggleComments = useCallback(
    (post: ForumPost) => {
      const key = getPostKey(post);
      const isOpen = Boolean(openComments[key]);
      const nextOpen = !isOpen;
      setOpenComments((prev) => ({ ...prev, [key]: nextOpen }));
      if (nextOpen && !commentsByPost[key]) {
        void loadComments([key]);
      }
    },
    [commentsByPost, loadComments, openComments]
  );

  const toggleReply = useCallback((commentId: string | number) => {
    const key = String(commentId);
    setOpenReplies((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const startEditComment = useCallback((comment: ForumPostComment) => {
    const key = String(comment.id);
    setEditingCommentId(key);
    setEditInputs((prev) => ({ ...prev, [key]: comment.body }));
    setCommentError(null);
  }, []);

  const cancelEditComment = useCallback((commentId: string | number) => {
    const key = String(commentId);
    setEditingCommentId((prev) => (prev === key ? null : prev));
    setEditInputs((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const saveEditedComment = useCallback(
    async (comment: ForumPostComment) => {
      if (!user) {
        setCommentError("Please log in to edit comments.");
        return;
      }
      const key = String(comment.id);
      const current = editInputs[key] ?? comment.body;
      const trimmed = String(current || "").trim();
      if (!trimmed) {
        setCommentError("Comment can't be empty.");
        return;
      }
      if (findExplicitTerm(trimmed)) {
        setCommentError("Explicit or sexual content isn't allowed in the forums.");
        return;
      }
      if (trimmed === comment.body) {
        cancelEditComment(key);
        return;
      }
      setCommentEditing((prev) => ({ ...prev, [key]: true }));
      setCommentError(null);
      try {
        const targetId = comment.documentId ?? comment.id;
        await api.put(`/forum-post-comments/${targetId}`, {
          data: { body: trimmed },
        });
        await loadComments([comment.postId]);
        cancelEditComment(key);
      } catch (error) {
        setCommentError(findErrorMessage(error, "Unable to edit comment."));
      } finally {
        setCommentEditing((prev) => ({ ...prev, [key]: false }));
      }
    },
    [cancelEditComment, editInputs, loadComments, user]
  );

  const deleteComment = useCallback(
    async (comment: ForumPostComment) => {
      if (!user) {
        setCommentError("Please log in to delete comments.");
        return;
      }
      if (typeof window !== "undefined") {
        const ok = window.confirm("Delete this comment?");
        if (!ok) return;
      }
      const key = String(comment.id);
      setCommentDeleting((prev) => ({ ...prev, [key]: true }));
      setCommentError(null);
      try {
        const targetId = comment.documentId ?? comment.id;
        await api.delete(`/forum-post-comments/${targetId}`);
        await loadComments([comment.postId]);
        cancelEditComment(key);
      } catch (error) {
        setCommentError(findErrorMessage(error, "Unable to delete comment."));
      } finally {
        setCommentDeleting((prev) => ({ ...prev, [key]: false }));
      }
    },
    [cancelEditComment, loadComments, user]
  );

  const saveForumPost = useCallback(
    async (post: ForumPost) => {
      if (!user) {
        setStatus("Please log in to edit posts.");
        return;
      }
      if (post.ownerId !== user.id) {
        setStatus("You can only edit your own posts.");
        return;
      }
      const key = getPostKey(post);
      const nextTitle = editPostTitle.trim();
      const nextBody = editPostBody.trim();
      if (!nextTitle || !nextBody) {
        setStatus("Add a title and a message to update your post.");
        return;
      }
      if (findExplicitTerm(nextTitle) || findExplicitTerm(nextBody)) {
        setStatus("Explicit or sexual content isn't allowed in the forums.");
        return;
      }
      setPostEditing((prev) => ({ ...prev, [key]: true }));
      setStatus(null);
      try {
        const targetId = post.documentId ?? post.id;
        await api.put(`/forum-posts/${targetId}`, {
          data: { title: nextTitle, body: nextBody },
        });
        setPosts((prev) =>
          prev.map((entry) =>
            String(entry.id) === String(post.id)
              ? { ...entry, title: nextTitle, body: nextBody }
              : entry
          )
        );
        setEditingPostId(null);
        setEditPostTitle("");
        setEditPostBody("");
        setStatus("Post updated.");
      } catch (error) {
        setStatus(findErrorMessage(error, "Unable to update post."));
      } finally {
        setPostEditing((prev) => ({ ...prev, [key]: false }));
      }
    },
    [editPostBody, editPostTitle, user]
  );

  const deleteForumPost = useCallback(
    async (post: ForumPost) => {
      if (!user) {
        setStatus("Please log in to delete posts.");
        return;
      }
      if (post.ownerId !== user.id) {
        setStatus("You can only delete your own posts.");
        return;
      }
      if (typeof window !== "undefined") {
        const ok = window.confirm("Delete this post?");
        if (!ok) return;
      }
      const key = getPostKey(post);
      setPostDeleting((prev) => ({ ...prev, [key]: true }));
      setStatus(null);
      try {
        const targetId = post.documentId ?? post.id;
        await api.delete(`/forum-posts/${targetId}`);
        setPosts((prev) => prev.filter((entry) => String(entry.id) !== String(post.id)));
        setCommentsByPost((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setOpenComments((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        setStatus("Post deleted.");
      } catch (error) {
        setStatus(findErrorMessage(error, "Unable to delete post."));
      } finally {
        setPostDeleting((prev) => ({ ...prev, [key]: false }));
      }
    },
    [user]
  );

  const submitComment = useCallback(
    async (
      postId: string | number,
      postKey: string,
      parentId?: string | number | null,
      parentApiId?: string | number | null
    ) => {
      if (!user) {
        setCommentError("Please log in to comment.");
        return;
      }
      const inputKey = parentId ? String(parentId) : postKey;
      const body = parentId ? replyInputs[inputKey] : commentInputs[inputKey];
      const trimmed = String(body || "").trim();
      if (!trimmed) return;
      if (findExplicitTerm(trimmed)) {
        setCommentError("Explicit or sexual content isn't allowed in the forums.");
        return;
      }

      const submitKey = parentId ? `reply-${inputKey}` : `post-${postKey}`;
      setCommentSubmitting((prev) => ({ ...prev, [submitKey]: true }));
      setCommentError(null);
      try {
        await api.post("/forum-post-comments", {
          data: {
            body: trimmed,
            post: postId,
            parent: parentApiId ?? parentId ?? null,
          },
        });
        await loadComments([postKey]);
        if (parentId) {
          setReplyInputs((prev) => ({ ...prev, [inputKey]: "" }));
          setOpenReplies((prev) => ({ ...prev, [inputKey]: false }));
        } else {
          setCommentInputs((prev) => ({ ...prev, [postKey]: "" }));
        }
      } catch (error) {
        const status = axios.isAxiosError(error) ? error.response?.status : undefined;
        if (status && status >= 500) {
          try {
            const query = buildCommentQuery([postKey]);
            const response = await api.get(
              `/forum-post-comments?${query}&populate=owner&populate=parent&populate=post&sort=createdAt:asc&pagination[pageSize]=500`
            );
            const entries = (response.data?.data ?? []).map(normalizeComment);
            setCommentsByPost((prev) => ({ ...prev, [postKey]: entries }));
            const parentMatch = parentId ? String(parentId) : "";
            const match = entries.some(
              (comment: ForumPostComment) =>
                comment.body === trimmed &&
                (!parentMatch || String(comment.parentId || "") === parentMatch) &&
                (user?.id ? comment.ownerId === user.id : true)
            );
            if (match) {
              if (parentId) {
                setReplyInputs((prev) => ({ ...prev, [inputKey]: "" }));
                setOpenReplies((prev) => ({ ...prev, [inputKey]: false }));
              } else {
                setCommentInputs((prev) => ({ ...prev, [postKey]: "" }));
              }
              return;
            }
          } catch {
            // fall through to error message
          }
        }
        setCommentError(findErrorMessage(error, "Unable to add comment."));
      } finally {
        setCommentSubmitting((prev) => ({ ...prev, [submitKey]: false }));
      }
    },
    [commentInputs, loadComments, replyInputs, user]
  );

  useEffect(() => {
    loadForums();
  }, [loadForums]);

  useEffect(() => {
    setQuickReplies(loadQuickReplyState(quickReplyStorageKey));
  }, [quickReplyStorageKey]);

  useEffect(() => {
    saveQuickReplyState(quickReplyStorageKey, quickReplies);
  }, [quickReplyStorageKey, quickReplies]);

  useEffect(() => {
    if (!nudge) return;
    const handle = window.setTimeout(() => setNudge(null), 2400);
    return () => window.clearTimeout(handle);
  }, [nudge]);

  useEffect(() => {
    if (!categories.length) return;
    const hasCategory = categories.some((category) => String(category.id) === postCategory);
    if (!postCategory || !hasCategory) {
      setPostCategory(String(categories[0].id));
    }
  }, [categories, postCategory]);

  const filteredCategories = useMemo(() => {
    if (!categorySearch.trim()) return categories;
    const needle = categorySearch.toLowerCase();
    return categories.filter((category) => category.name.toLowerCase().includes(needle));
  }, [categorySearch, categories]);

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    posts.forEach((post) => {
      const key = String(post.categoryId);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [posts]);

  const trendingCategories = useMemo(() => {
    return [...categories]
      .map((category) => ({
        ...category,
        count: categoryCounts.get(String(category.id)) || 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [categoryCounts, categories]);

  const visiblePosts = useMemo(() => {
    return posts.filter((post) => {
      if (activeCategory !== "all" && String(post.categoryId) !== activeCategory) {
        return false;
      }
      if (intentFilter !== "all" && post.intent !== intentFilter) return false;
      if (search.trim()) {
        const needle = search.toLowerCase();
        if (
          !post.title.toLowerCase().includes(needle) &&
          !post.body.toLowerCase().includes(needle)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [activeCategory, intentFilter, search, posts]);

  useEffect(() => {
    if (!visiblePosts.length) return;
    void loadComments(visiblePosts.map((post) => getPostKey(post)));
  }, [loadComments, visiblePosts]);

  useEffect(() => {
    const urls = new Set<string>();
    Object.values(commentsByPost).forEach((list) => {
      list.forEach((comment) => {
        const url = extractFirstUrl(comment.body);
        if (!isPreviewableUrl(url)) return;
        if (previewCache[url] !== undefined) return;
        urls.add(url);
      });
    });
    if (!urls.size) return;
    urls.forEach((url) => {
      void fetchLinkPreview(url);
    });
  }, [commentsByPost, fetchLinkPreview, previewCache]);

  const negativeHit = useMemo(() => {
    const text = `${postTitle} ${postBody}`.toLowerCase();
    return NEGATIVE_TERMS.find((term) => text.includes(term)) || "";
  }, [postBody, postTitle]);

  const explicitHit = useMemo(() => {
    const text = `${postTitle} ${postBody}`;
    return findExplicitTerm(text);
  }, [postBody, postTitle]);

  const pledgeMeta = useMemo(
    () => PLEDGE_OPTIONS.find((option) => option.value === pledgeChoice),
    [pledgeChoice]
  );

  const applyTemplate = (template: (typeof TEMPLATE_PRESETS)[number]) => {
    setPostIntent(template.intent);
    setPostBody(template.body);
    if (!postTitle.trim()) {
      setPostTitle(template.label);
    }
  };

  const handlePost = async () => {
    if (!user) {
      setStatus("Please log in to post in the forums.");
      return;
    }
    if (!pledgeAccepted) {
      setStatus("Please accept the uplifting pledge before posting.");
      return;
    }
    if (explicitHit) {
      setStatus("Explicit or sexual content isn't allowed in the forums.");
      return;
    }
    if (!postTitle.trim() || !postBody.trim()) {
      setStatus("Add a title and a message to post.");
      return;
    }
    if (!postCategory) {
      setStatus("Choose a topic to post in.");
      return;
    }
    if (negativeHit) {
      setStatus(
        "This space is uplifting only. Please rephrase to keep the tone supportive."
      );
      return;
    }

    setSubmitting(true);
    try {
      const categoryId = Number(postCategory);
      const payload = {
        title: postTitle.trim(),
        body: postBody.trim(),
        intent: postIntent,
        category: Number.isFinite(categoryId) ? categoryId : postCategory,
      };
      const response = await api.post("/forum-posts", { data: payload });
      const created = normalizePost(response.data?.data);
      const fallbackCategory = Number.isFinite(Number(postCategory))
        ? Number(postCategory)
        : postCategory;
      const createdPost: ForumPost = {
        ...created,
        id: created.id || `temp-${Date.now()}`,
        title: created.title || payload.title,
        body: created.body || payload.body,
        intent: created.intent || postIntent,
        categoryId: created.categoryId || fallbackCategory,
        authorName:
          created.authorName ||
          user?.username ||
          user?.email ||
          "Member",
        ownerId: created.ownerId ?? user?.id,
        createdAt: created.createdAt || new Date().toISOString(),
      };
      setPosts((prev) => [createdPost, ...prev]);
      setPostTitle("");
      setPostBody("");
      setStatus(
        created.status === "review"
          ? "Thanks! Your post is queued for review to keep the forums uplifting."
          : "Posted! Thanks for keeping it uplifting."
      );
    } catch (error) {
      setStatus(findErrorMessage(error, "Unable to post right now."));
    } finally {
      setSubmitting(false);
    }
  };

  const scrollToSection = (ref: RefObject<HTMLElement>) => {
    if (!ref.current) return;
    ref.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const bumpEncouragement = async (postId: string | number) => {
    if (!user) {
      setStatus("Please log in to encourage someone.");
      return;
    }
    const postKey = String(postId);
    if (quickReplies[postKey]?.encouraged) {
      setNudge("You already encouraged this post.");
      return;
    }
    const submitKey = `encourage-${postKey}`;
    if (quickReplySubmitting[submitKey]) return;
    setQuickReplySubmitting((prev) => ({ ...prev, [submitKey]: true }));
    try {
      const res = await api.post(`/forum-posts/${postId}/encourage`);
      const alreadyReacted = Boolean(res.data?.data?.alreadyReacted);
      const next = Number(res.data?.data?.encouragements);
      if (!alreadyReacted) {
        if (Number.isFinite(next)) {
          setPosts((prev) =>
            prev.map((post) =>
              post.id === postId ? { ...post, encouragements: next } : post
            )
          );
        } else {
          setPosts((prev) =>
            prev.map((post) =>
              post.id === postId
                ? { ...post, encouragements: post.encouragements + 1 }
                : post
            )
          );
        }
      }
      setQuickReplies((prev) => {
        const current = prev[postKey] || {};
        if (current.encouraged) return prev;
        return { ...prev, [postKey]: { ...current, encouraged: true } };
      });
      setNudge(
        alreadyReacted
          ? "You already encouraged this post."
          : "Thanks for lifting someone up today."
      );
    } catch (error) {
      setStatus(findErrorMessage(error, "Unable to send encouragement."));
    } finally {
      setQuickReplySubmitting((prev) => ({ ...prev, [submitKey]: false }));
    }
  };

  const bumpThanks = async (postId: string | number) => {
    if (!user) {
      setStatus("Please log in to send a thank you.");
      return;
    }
    const postKey = String(postId);
    if (quickReplies[postKey]?.thanked) {
      setNudge("You already thanked this post.");
      return;
    }
    const submitKey = `thank-${postKey}`;
    if (quickReplySubmitting[submitKey]) return;
    setQuickReplySubmitting((prev) => ({ ...prev, [submitKey]: true }));
    try {
      const res = await api.post(`/forum-posts/${postId}/thank`);
      const alreadyReacted = Boolean(res.data?.data?.alreadyReacted);
      const next = Number(res.data?.data?.thanks);
      if (!alreadyReacted) {
        if (Number.isFinite(next)) {
          setPosts((prev) =>
            prev.map((post) => (post.id === postId ? { ...post, thanks: next } : post))
          );
        } else {
          setPosts((prev) =>
            prev.map((post) =>
              post.id === postId ? { ...post, thanks: post.thanks + 1 } : post
            )
          );
        }
      }
      setQuickReplies((prev) => {
        const current = prev[postKey] || {};
        if (current.thanked) return prev;
        return { ...prev, [postKey]: { ...current, thanked: true } };
      });
      setNudge(
        alreadyReacted
          ? "You already thanked this post."
          : "Gratitude makes the community stronger."
      );
    } catch (error) {
      setStatus(findErrorMessage(error, "Unable to send thanks."));
    } finally {
      setQuickReplySubmitting((prev) => ({ ...prev, [submitKey]: false }));
    }
  };

  return (
    <div className="dashboard-shell" style={getBackgroundStyle("forums")}>
      <Sidebar active="forums" />
      <div className="main-content">
        <TopbarSearch />
        <div className="forums-page">
          <div className="forums-shell">
        <header className="forums-hero">
          <div>
            <span className="forums-eyebrow">Uplifting Forums</span>
            <h1>Only uplifting conversations. Every topic, zero negativity.</h1>
            <p>
              Your Social Place forums are built for support, progress, and encouragement.
              Share wins, ask for help, and offer tips in a positive, safe space.
            </p>
            <div className="forums-hero__actions">
              <button
                className="forums-button primary"
                type="button"
                onClick={() => {
                  setActiveCategory("all");
                  scrollToSection(topicsRef);
                }}
              >
                Explore topics
              </button>
              <button
                className="forums-button ghost"
                type="button"
                onClick={() => {
                  setPostIntent("support");
                  scrollToSection(createPostRef);
                }}
              >
                Ask for support
              </button>
            </div>
          </div>
          <div className="forums-hero__card">
            <h3>Uplifting pledge</h3>
            <ul>
              <li>Encourage or offer solutions.</li>
              <li>Keep language supportive and kind.</li>
              <li>No attacks, no shaming, no negativity.</li>
            </ul>
            <div className="forums-pledge">
              <label className="forums-pledge-label" htmlFor="pledge-select">
                Pledge
              </label>
              <select
                id="pledge-select"
                className="forums-input forums-pledge-select"
                value={pledgeChoice}
                onChange={(event) => {
                  const next = event.target.value;
                  setPledgeChoice(next);
                  setPledgeAccepted(Boolean(next));
                }}
              >
                <option value="">Choose your pledge</option>
                {PLEDGE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              {pledgeAccepted && pledgeMeta && (
                <span className="forums-pledge-status">
                  {pledgeMeta.description}
                </span>
              )}
            </div>
          </div>
        </header>

        <section className="forums-topics" ref={topicsRef}>
          <div className="forums-topics__header">
            <h2>Topics</h2>
            <div className="forums-topics__controls">
              <input
                className="forums-input"
                placeholder="Search topics"
                value={categorySearch}
                onChange={(event) => setCategorySearch(event.target.value)}
              />
              {/* Topic creation is admin-only (managed in Strapi). */}
            </div>
          </div>
          <div className="forums-topic-grid">
            {filteredCategories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={`forums-topic-card${
                  activeCategory === String(category.id) ? " is-active" : ""
                }`}
                onClick={() => setActiveCategory(String(category.id))}
              >
                <h3>{category.name}</h3>
                <p>{category.description}</p>
                <span>{categoryCounts.get(String(category.id)) || 0} posts</span>
              </button>
            ))}
          </div>
        </section>

        <section className="forums-layout">
          <div className="forums-feed">
            <div className="forums-feed__toolbar">
              <div>
                <h2>Forum feed</h2>
                <p>Only uplifting posts, curated by topic.</p>
              </div>
              <div className="forums-feed__filters">
                <select
                  className="forums-input"
                  value={activeCategory}
                  onChange={(event) => setActiveCategory(event.target.value)}
                >
                  <option value="all">All topics</option>
                  {categories.map((category) => (
                    <option key={category.id} value={String(category.id)}>
                      {category.name}
                    </option>
                  ))}
                </select>
                <select
                  className="forums-input"
                  value={intentFilter}
                  onChange={(event) =>
                    setIntentFilter(event.target.value as ForumPost["intent"] | "all")
                  }
                >
                  <option value="all">All intents</option>
                  <option value="win">Wins</option>
                  <option value="support">Support requests</option>
                  <option value="tip">Tips</option>
                  <option value="idea">Ideas</option>
                  <option value="gratitude">Gratitude</option>
                </select>
                <input
                  className="forums-input"
                  placeholder="Search posts"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>

            {loadError && <div className="forums-status">{loadError}</div>}
            {loading && <div className="forums-status">Loading forums...</div>}
            {nudge && <div className="forums-nudge">{nudge}</div>}

            {!loading && visiblePosts.length === 0 && (
              <div className="forums-empty">
                <p>No uplifting posts yet. Be the first to start the conversation.</p>
              </div>
            )}

            <div className="forums-posts">
              {visiblePosts.map((post) => {
                const category = categories.find(
                  (item) => String(item.id) === String(post.categoryId)
                );
                const postKey = getPostKey(post);
                const commentKey = postKey;
                const postComments = commentsByPost[commentKey] || [];
                const commentTree = buildCommentTree(postComments);
                const isCommentsOpen = Boolean(openComments[commentKey]);
                const commentCount = postComments.length;
                const hasEncouraged = Boolean(quickReplies[postKey]?.encouraged);
                const hasThanked = Boolean(quickReplies[postKey]?.thanked);
                const encouragePending = quickReplySubmitting[`encourage-${postKey}`];
                const thankPending = quickReplySubmitting[`thank-${postKey}`];
                const postApiId = post.numericId ?? post.id;
                const isPostOwner = user?.id && post.ownerId === user.id;
                return (
                  <article
                    key={post.id}
                    className={`forums-post${post.status === "review" ? " is-review" : ""}`}
                  >
                    <div className="forums-post__meta">
                      <span className={`forums-badge is-${post.intent}`}>
                        {INTENT_LABELS[post.intent]}
                      </span>
                      <span className="forums-topic">{category?.name || "Topic"}</span>
                      <span className="forums-author">{post.authorName}</span>
                      <span className="forums-date">
                        {new Date(post.createdAt).toLocaleDateString()}
                      </span>
                      {post.status === "review" && (
                        <span className="forums-post__status">In review</span>
                      )}
                    </div>
                    <h3>{post.title}</h3>
                    <p>{post.body}</p>
                    <div className="forums-post__actions">
                      <button
                        type="button"
                        className="forums-button ghost"
                        aria-pressed={hasEncouraged}
                        disabled={!user || hasEncouraged || encouragePending}
                        onClick={() => bumpEncouragement(post.id)}
                      >
                        {encouragePending
                          ? `Encouraging (${post.encouragements})`
                          : hasEncouraged
                          ? `Encouraged (${post.encouragements})`
                          : `Encourage (${post.encouragements})`}
                      </button>
                      <button
                        type="button"
                        className="forums-button ghost"
                        aria-pressed={hasThanked}
                        disabled={!user || hasThanked || thankPending}
                        onClick={() => bumpThanks(post.id)}
                      >
                        {thankPending
                          ? `Thanking (${post.thanks})`
                          : hasThanked
                          ? `Thanked (${post.thanks})`
                          : `Thank you (${post.thanks})`}
                      </button>
                      <button
                        type="button"
                        className="forums-button ghost"
                        onClick={() => toggleComments(post)}
                      >
                        Comment ({commentCount})
                      </button>
                      {isPostOwner && (
                        <>
                          <button
                            type="button"
                            className="forums-button ghost"
                            onClick={() => {
                              setEditingPostId(postKey);
                              setEditPostTitle(post.title);
                              setEditPostBody(post.body);
                            }}
                            disabled={editingPostId === postKey}
                          >
                            Edit post
                          </button>
                          <button
                            type="button"
                            className="forums-button ghost"
                            onClick={() => deleteForumPost(post)}
                            disabled={postDeleting[postKey]}
                          >
                            {postDeleting[postKey] ? "Deleting..." : "Delete post"}
                          </button>
                        </>
                      )}
                    </div>
                    {editingPostId === postKey ? (
                      <div className="forums-post__edit">
                        <input
                          className="forums-input"
                          value={editPostTitle}
                          onChange={(event) => setEditPostTitle(event.target.value)}
                          placeholder="Post title"
                        />
                        <textarea
                          className="forums-input forums-textarea"
                          rows={4}
                          value={editPostBody}
                          onChange={(event) => setEditPostBody(event.target.value)}
                          placeholder="Post content"
                        />
                        <div className="forums-post__edit-actions">
                          <button
                            type="button"
                            className="forums-button ghost"
                            onClick={() => {
                              setEditingPostId(null);
                              setEditPostTitle("");
                              setEditPostBody("");
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="forums-button primary"
                            onClick={() => saveForumPost(post)}
                            disabled={postEditing[postKey]}
                          >
                            {postEditing[postKey] ? "Saving..." : "Save changes"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {isCommentsOpen && (
                      <div className="forums-comments">
                        <div className="forums-comment-form">
                          <input
                            className="forums-input"
                            placeholder="Add a supportive comment..."
                            value={commentInputs[commentKey] || ""}
                            onChange={(event) =>
                              setCommentInputs((prev) => ({
                                ...prev,
                                [commentKey]: event.target.value,
                              }))
                            }
                          />
                          <button
                            type="button"
                            className="forums-button primary"
                            disabled={
                              !commentInputs[commentKey]?.trim() ||
                              commentSubmitting[`post-${commentKey}`]
                            }
                            onClick={() => submitComment(postApiId, commentKey)}
                          >
                            {commentSubmitting[`post-${commentKey}`] ? "Posting..." : "Post"}
                          </button>
                        </div>
                        {commentError && <div className="forums-status">{commentError}</div>}
                        {commentTree.length === 0 ? (
                          <p className="forums-status">No comments yet.</p>
                        ) : (
                          <ul className="forums-comment-list">
                            {commentTree.map((comment) => (
                              <li key={comment.id} className="forums-comment">
                                <div className="forums-comment__header">
                                  <span className="forums-comment__author">
                                    {comment.ownerName}
                                  </span>
                                  <span className="forums-comment__date">
                                    {new Date(comment.createdAt).toLocaleDateString()}
                                  </span>
                                </div>
                                {editingCommentId === String(comment.id) ? (
                                  <div className="forums-comment__edit-form">
                                    <textarea
                                      className="forums-input forums-textarea"
                                      rows={2}
                                      value={editInputs[String(comment.id)] ?? comment.body}
                                      onChange={(event) =>
                                        setEditInputs((prev) => ({
                                          ...prev,
                                          [String(comment.id)]: event.target.value,
                                        }))
                                      }
                                    />
                                    <div className="forums-comment__edit-actions">
                                      <button
                                        type="button"
                                        className="forums-button ghost"
                                        onClick={() => cancelEditComment(comment.id)}
                                        disabled={commentEditing[String(comment.id)]}
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        className="forums-button primary"
                                        onClick={() => saveEditedComment(comment)}
                                        disabled={commentEditing[String(comment.id)]}
                                      >
                                        {commentEditing[String(comment.id)]
                                          ? "Saving..."
                                          : "Save"}
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <p className="forums-comment__body">{comment.body}</p>
                                    {(() => {
                                      const commentUrl = extractFirstUrl(comment.body);
                                      if (!isPreviewableUrl(commentUrl)) return null;
                                      const preview = previewCache[commentUrl];
                                      if (!preview) return null;
                                      return (
                                        <div className="forums-comment__preview">
                                          <LinkPreviewCard
                                            preview={preview}
                                            url={preview.url || commentUrl}
                                          />
                                        </div>
                                      );
                                    })()}
                                  </>
                                )}
                                <div className="forums-comment__actions">
                                  <button
                                    type="button"
                                    className="forums-button ghost"
                                    onClick={() => toggleReply(comment.id)}
                                  >
                                    Reply
                                  </button>
                                  {user?.id && comment.ownerId === user.id && (
                                    <>
                                      <button
                                        type="button"
                                        className="forums-button ghost"
                                        onClick={() => startEditComment(comment)}
                                        disabled={editingCommentId === String(comment.id)}
                                      >
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        className="forums-button ghost"
                                        onClick={() => deleteComment(comment)}
                                        disabled={commentDeleting[String(comment.id)]}
                                      >
                                        {commentDeleting[String(comment.id)]
                                          ? "Deleting..."
                                          : "Delete"}
                                      </button>
                                    </>
                                  )}
                                </div>
                                {openReplies[String(comment.id)] && (
                                  <div className="forums-comment__reply-form">
                                    <input
                                      className="forums-input"
                                      placeholder="Write a reply..."
                                      value={replyInputs[String(comment.id)] || ""}
                                      onChange={(event) =>
                                        setReplyInputs((prev) => ({
                                          ...prev,
                                          [String(comment.id)]: event.target.value,
                                        }))
                                      }
                                    />
                                    <button
                                      type="button"
                                      className="forums-button primary"
                                      disabled={
                                        !replyInputs[String(comment.id)]?.trim() ||
                                        commentSubmitting[`reply-${String(comment.id)}`]
                                      }
                                      onClick={() =>
                                        submitComment(
                                          postApiId,
                                          commentKey,
                                          comment.id,
                                          comment.numericId ?? comment.documentId ?? comment.id
                                        )
                                      }
                                    >
                                      {commentSubmitting[`reply-${String(comment.id)}`]
                                        ? "Replying..."
                                        : "Reply"}
                                    </button>
                                  </div>
                                )}
                                {comment.children && comment.children.length > 0 && (
                                  <ul className="forums-comment-children">
                                    {comment.children.map((child) => (
                                      <li
                                        key={child.id}
                                        className="forums-comment forums-comment--child"
                                      >
                                        <div className="forums-comment__header">
                                          <span className="forums-comment__author">
                                            {child.ownerName}
                                          </span>
                                          <span className="forums-comment__date">
                                            {new Date(child.createdAt).toLocaleDateString()}
                                          </span>
                                        </div>
                                        {editingCommentId === String(child.id) ? (
                                          <div className="forums-comment__edit-form">
                                            <textarea
                                              className="forums-input forums-textarea"
                                              rows={2}
                                              value={
                                                editInputs[String(child.id)] ?? child.body
                                              }
                                              onChange={(event) =>
                                                setEditInputs((prev) => ({
                                                  ...prev,
                                                  [String(child.id)]: event.target.value,
                                                }))
                                              }
                                            />
                                            <div className="forums-comment__edit-actions">
                                              <button
                                                type="button"
                                                className="forums-button ghost"
                                                onClick={() => cancelEditComment(child.id)}
                                                disabled={commentEditing[String(child.id)]}
                                              >
                                                Cancel
                                              </button>
                                              <button
                                                type="button"
                                                className="forums-button primary"
                                                onClick={() => saveEditedComment(child)}
                                                disabled={commentEditing[String(child.id)]}
                                              >
                                                {commentEditing[String(child.id)]
                                                  ? "Saving..."
                                                  : "Save"}
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <>
                                            <p className="forums-comment__body">
                                              {child.body}
                                            </p>
                                            {(() => {
                                              const commentUrl = extractFirstUrl(child.body);
                                              if (!isPreviewableUrl(commentUrl)) return null;
                                              const preview = previewCache[commentUrl];
                                              if (!preview) return null;
                                              return (
                                                <div className="forums-comment__preview">
                                                  <LinkPreviewCard
                                                    preview={preview}
                                                    url={preview.url || commentUrl}
                                                  />
                                                </div>
                                              );
                                            })()}
                                          </>
                                        )}
                                        <div className="forums-comment__actions">
                                          <button
                                            type="button"
                                            className="forums-button ghost"
                                            onClick={() => toggleReply(child.id)}
                                          >
                                            Reply
                                          </button>
                                          {user?.id && child.ownerId === user.id && (
                                            <>
                                              <button
                                                type="button"
                                                className="forums-button ghost"
                                                onClick={() => startEditComment(child)}
                                                disabled={
                                                  editingCommentId === String(child.id)
                                                }
                                              >
                                                Edit
                                              </button>
                                              <button
                                                type="button"
                                                className="forums-button ghost"
                                                onClick={() => deleteComment(child)}
                                                disabled={commentDeleting[String(child.id)]}
                                              >
                                                {commentDeleting[String(child.id)]
                                                  ? "Deleting..."
                                                  : "Delete"}
                                              </button>
                                            </>
                                          )}
                                        </div>
                                        {openReplies[String(child.id)] && (
                                          <div className="forums-comment__reply-form">
                                            <input
                                              className="forums-input"
                                              placeholder="Write a reply..."
                                              value={replyInputs[String(child.id)] || ""}
                                              onChange={(event) =>
                                                setReplyInputs((prev) => ({
                                                  ...prev,
                                                  [String(child.id)]: event.target.value,
                                                }))
                                              }
                                            />
                                            <button
                                              type="button"
                                              className="forums-button primary"
                                              disabled={
                                                !replyInputs[String(child.id)]?.trim() ||
                                                commentSubmitting[`reply-${String(child.id)}`]
                                              }
                                              onClick={() =>
                                                submitComment(
                                                  postApiId,
                                                  commentKey,
                                                  child.id,
                                                  child.numericId ?? child.documentId ?? child.id
                                                )
                                              }
                                            >
                                              {commentSubmitting[`reply-${String(child.id)}`]
                                                ? "Replying..."
                                                : "Reply"}
                                            </button>
                                          </div>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          </div>

          <aside className="forums-side">
            <div className="forums-panel" ref={createPostRef}>
              <h3>Create a post</h3>
              <div className="forums-template-row">
                {TEMPLATE_PRESETS.map((template) => (
                  <button
                    key={template.id}
                    type="button"
                    className="forums-chip"
                    onClick={() => applyTemplate(template)}
                  >
                    {template.label}
                  </button>
                ))}
              </div>
              <div className="forums-field">
                <label>Intent</label>
                <select
                  className="forums-input"
                  value={postIntent}
                  onChange={(event) =>
                    setPostIntent(event.target.value as ForumPost["intent"])
                  }
                >
                  <option value="win">Win</option>
                  <option value="support">Support request</option>
                  <option value="tip">Tip</option>
                  <option value="idea">Idea</option>
                  <option value="gratitude">Gratitude</option>
                </select>
              </div>
              <div className="forums-field">
                <label>Topic</label>
                <select
                  className="forums-input"
                  value={postCategory}
                  onChange={(event) => setPostCategory(event.target.value)}
                >
                  {categories.map((category) => (
                    <option key={category.id} value={String(category.id)}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="forums-field">
                <label>Title</label>
                <input
                  className="forums-input"
                  value={postTitle}
                  onChange={(event) => setPostTitle(event.target.value)}
                  placeholder="Give your post a clear title"
                />
              </div>
              <div className="forums-field">
                <label>Message</label>
                <textarea
                  className="forums-input forums-textarea"
                  value={postBody}
                  onChange={(event) => setPostBody(event.target.value)}
                  placeholder="Share your story, question, or encouragement."
                />
              </div>
              {explicitHit && (
                <div className="forums-tone-warning">
                  Explicit or sexual content isn't allowed here.
                </div>
              )}
              {negativeHit && (
                <div className="forums-tone-warning">
                  We keep this forum uplifting. Please rephrase to remove negative wording.
                </div>
              )}
              {status && <div className="forums-status">{status}</div>}
              <button
                className="forums-button primary"
                type="button"
                onClick={handlePost}
                disabled={submitting}
              >
                {submitting ? "Posting..." : "Post to forum"}
              </button>
            </div>

            <div className="forums-panel">
              <h3>Trending topics</h3>
              <div className="forums-trending">
                {trendingCategories.map((category) => (
                  <button
                    key={category.id}
                    type="button"
                    className="forums-trending-item"
                    onClick={() => setActiveCategory(String(category.id))}
                  >
                    <div className="forums-trending-text">
                      <strong className="forums-trending-title">{category.name}</strong>
                      <span className="forums-trending-desc">{category.description}</span>
                    </div>
                    <span className="forums-count">{category.count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="forums-panel">
              <h3>Uplift ideas</h3>
              <ul className="forums-ideas">
                <li>Share a progress photo or a small win.</li>
                <li>Offer a tip that helped your routine.</li>
                <li>Ask for help in a calm, clear way.</li>
                <li>Celebrate someone else in the comments.</li>
              </ul>
            </div>
          </aside>
        </section>
          </div>
        </div>
      </div>
    </div>
  );
}
