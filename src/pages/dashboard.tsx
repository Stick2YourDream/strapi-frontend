// src/pages/Dashboard.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/strapi";
import axios from "axios";
import { getStoredToken } from "../utils/auth-storage";
import "../css/dashboard.css";
import FullScreenLoader from "../components/FullScreenLoader";
import { useAuth } from "../context/AuthContext";
import Sidebar from "../components/Sidebar";
import { usePageMeta } from "../hooks/usePageMeta";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { SIGNAL_TAGS, formatSignalTag, type SignalTag } from "../constants/signalTags";
import { sanitizePostText } from "../utils/emoji";
import { formatPostUpdateLabel } from "../utils/time";
import { pickMediaUrl } from "../utils/media";
import GoalsImpactPanel from "../components/GoalsImpactPanel";
import { ArrowUp, Target } from "lucide-react";
import { useImpactStats } from "../hooks/useImpactStats";
import { useNewsPreference } from "../hooks/useNewsPreference";
import LinkPreviewCard from "../components/LinkPreviewCard";
import PopupModal from "../components/PopupModal";
// import NewsWidget from "../components/NewsWidget";
import "../css/news-widget.css";

type CommentItem = {
  id: string | number;
  numericId?: number;
  documentId?: string;
  body: string;
  owner?: string;
  ownerId?: string | number;
  createdAt?: string;
};

type GroupOption = {
  id: number;
  name: string;
  kind?: string;
};

type TrustedCircleOption = {
  id: number;
  name: string;
};

type CheckInEntry = {
  id: string;
  createdAt: string;
  type: "check-in" | "support-request";
  goal: string;
  note: string;
  target: "private" | "trusted" | "feed";
  groupId?: number;
  groupName?: string;
};

type GoalsState = {
  selectedGoals: string[];
  customGoals: string[];
  achievedGoals: string[];
  trustedFriendIds: number[];
  reminder: "daily" | "weekly" | "off";
  trustedCircleIds: number[];
  checkIns: CheckInEntry[];
};

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

type PostMediaItem = {
  id: number;
  url: string;
  fullUrl: string;
  isVideo: boolean;
};

type NormalizedPost = {
  id: string | number;
  numericId?: number;
  documentId?: string;
  title: string;
  content: string;
  imageUrl?: string;
  mediaUrls?: string[];
  mediaItems?: PostMediaItem[];
  mediaIds?: number[];
  createdAt?: string;
  source: "user" | "group" | "admin";
  ownerName?: string;
  ownerId?: number;
  likes?: number;
  reactionCounts?: ReactionCounts;
  myReaction?: string | null;
  shares?: number;
  comments: CommentItem[];
  groupName?: string;
  groupId?: number;
  signalTag?: SignalTag;
  feedbackAudience?: string;
  feedbackTargetId?: number;
  feedbackTargetName?: string;
  visibility?: string;
  trustedCircleId?: number;
  trustedCircleName?: string;
};

type PostFilter = "all" | "admin" | "friends" | "private" | "public";
type PostSort = "newest" | "oldest";
type PostSource = NormalizedPost["source"];

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

type CommentTargetBuckets = {
  userIds: number[];
  groupIds: number[];
  adminIds: number[];
};

const isPostSource = (value: string): value is PostSource =>
  value === "user" || value === "group" || value === "admin";

const goalsStorageKeyFor = (userId?: number | null) =>
  userId ? `ysp-goals-${userId}` : "ysp-goals-guest";

const loadGoalsState = (key: string): GoalsState => {
  if (typeof window === "undefined") {
    return {
      selectedGoals: [],
      customGoals: [],
      achievedGoals: [],
      trustedFriendIds: [],
      reminder: "weekly",
      trustedCircleIds: [],
      checkIns: [],
    };
  }
  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return {
      selectedGoals: [],
      customGoals: [],
      achievedGoals: [],
      trustedFriendIds: [],
      reminder: "weekly",
      trustedCircleIds: [],
      checkIns: [],
    };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<
      GoalsState & { trustedGroupIds?: number[] }
    > | null;
    return {
      selectedGoals: parsed?.selectedGoals ?? [],
      customGoals: parsed?.customGoals ?? [],
      achievedGoals: parsed?.achievedGoals ?? [],
      trustedFriendIds: parsed?.trustedFriendIds ?? [],
      reminder: parsed?.reminder ?? "weekly",
      trustedCircleIds: parsed?.trustedCircleIds ?? parsed?.trustedGroupIds ?? [],
      checkIns: parsed?.checkIns ?? [],
    };
  } catch {
    return {
      selectedGoals: [],
      customGoals: [],
      achievedGoals: [],
      trustedFriendIds: [],
      reminder: "weekly",
      trustedCircleIds: [],
      checkIns: [],
    };
  }
};

const saveGoalsState = (key: string, state: GoalsState) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(state));
  window.dispatchEvent(new Event("ysp-goals-updated"));
};

const SUPPORT_REQUEST_QUICK_REPLIES = [
  "Thanks for sharing this. I'm here for you.",
  "You are not alone in this. Want to talk about it?",
  "That sounds really tough. What would help most right now?",
  "I'm cheering you on. One step at a time.",
  "I'm proud of you for asking for support.",
  "If you want, we can break this into a smaller next step.",
  "Sending support. You've got this.",
  "I'm here to listen if you want to share more.",
];

const WIN_SUPPORT_REPLIES = [
  "Congrats on the win!",
  "Proud of you for this.",
  "Celebrate this moment!",
  "Huge progress. Well done.",
  "You earned this.",
];

const BLOCKER_SUPPORT_REPLIES = [
  "Want to brainstorm a workaround?",
  "What's the biggest blocker right now?",
  "Happy to help you tackle this.",
  "Want a quick plan together?",
  "Let's break it down step by step.",
];

const FEEDBACK_SUPPORT_REPLIES = [
  "Happy to give feedback. What should I focus on?",
  "I can review this if you want.",
  "Want detailed or high-level feedback?",
  "Here's a quick thought if helpful.",
  "I can test or review it for you.",
];

const CHECKIN_SUPPORT_REPLIES = [
  "Cheering you on today.",
  "How are you feeling right now?",
  "You've got this.",
  "Proud of your consistency.",
  "Need anything to stay on track?",
];

const STRUCTURED_POST_SECTIONS: Partial<Record<SignalTag, string[]>> = {
  "check-in": ["Today I'm focused on", "Next step", "Support I need"],
  "support-request": ["I'm stuck on", "What I've tried", "What would help me most"],
  win: ["Win", "What helped", "Next goal"],
};

const supportRepliesForTag = (tag?: SignalTag) => {
  if (!tag || tag === "none") return [];
  if (tag === "support-request") return SUPPORT_REQUEST_QUICK_REPLIES;
  if (tag === "win") return WIN_SUPPORT_REPLIES;
  if (tag === "blocker") return BLOCKER_SUPPORT_REPLIES;
  if (tag === "feedback") return FEEDBACK_SUPPORT_REPLIES;
  if (tag === "check-in") return CHECKIN_SUPPORT_REPLIES;
  return [];
};

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;
const asRecord = (value: unknown): UnknownRecord => (isRecord(value) ? value : {});
const getString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;
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
const normalizeReactionCounts = (
  value: unknown,
  fallbackLikes?: number
): ReactionCounts => {
  const record = isRecord(value) ? value : {};
  const thumbsRaw = record.thumbsUp ?? record.thumbs_up;
  const heartRaw = record.heart;
  const careRaw = record.care;
  const hahaRaw = record.haha;
  const wowRaw = record.wow;
  const sadRaw = record.sad;
  const angryRaw = record.angry;
  const thumbsUp = Number(thumbsRaw);
  const heart = Number(heartRaw);
  const care = Number(careRaw);
  const haha = Number(hahaRaw);
  const wow = Number(wowRaw);
  const sad = Number(sadRaw);
  const angry = Number(angryRaw);
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
const normalizeReactionValue = (value: unknown): string | null => {
  const trimmed = String(value || "").trim();
  if (REACTION_VALUES.has(trimmed)) return trimmed;
  return null;
};
const getTopReactionOptions = (
  counts: ReactionCounts,
  limit = 3
): ReactionOption[] =>
  REACTION_OPTIONS.map((option, index) => ({
    option,
    index,
    count: Number(counts[option.key] || 0),
  }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.index - b.index)
    .slice(0, Math.max(1, limit))
    .map((entry) => entry.option);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseStructuredPost = (content: string, tag?: SignalTag) => {
  if (!content || !tag) return null;
  const labels = STRUCTURED_POST_SECTIONS[tag];
  if (!labels) return null;
  const raw = String(content || "").replace(/\s+/g, " ").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const hits = labels
    .map((label) => ({ label, idx: lower.indexOf(label.toLowerCase()) }))
    .filter((entry) => entry.idx >= 0)
    .sort((a, b) => a.idx - b.idx);
  if (!hits.length) return null;
  const rows = hits.map((entry, index) => {
    const end = hits[index + 1]?.idx ?? raw.length;
    let segment = raw.slice(entry.idx, end).trim();
    const labelPattern = new RegExp(
      `^${escapeRegExp(entry.label)}\\s*(?:[:\\-]|\\.{3})?\\s*`,
      "i"
    );
    segment = segment.replace(labelPattern, "").trim();
    return { label: entry.label, value: segment };
  });
  return { rows };
};
const extractCheckInGoal = (content: string, tag?: SignalTag) => {
  const safeContent = String(content || "");
  if (tag !== "check-in" && tag !== "support-request") {
    return { goal: "", content: safeContent };
  }
  const lines = safeContent.split(/\r?\n/);
  let index = 0;
  while (index < lines.length && lines[index].trim() === "") {
    index += 1;
  }
  if (index >= lines.length) {
    return { goal: "", content: safeContent };
  }
  const match = lines[index].match(/^goal\s*:\s*(.+)$/i);
  if (!match) {
    return { goal: "", content: safeContent };
  }
  const goal = match[1]?.trim() ?? "";
  if (!goal) {
    return { goal: "", content: safeContent };
  }
  const remaining = [...lines.slice(0, index), ...lines.slice(index + 1)];
  while (remaining.length && remaining[0].trim() === "") {
    remaining.shift();
  }
  return { goal, content: remaining.join("\n") };
};
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
const resolveMediaItems = (field: unknown): unknown[] => {
  const unwrap = (value: unknown): unknown[] => {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) {
      return value.flatMap((item) => unwrap(item));
    }
    if (isRecord(value) && "data" in value) {
      return unwrap((value as UnknownRecord).data);
    }
    return [value];
  };

  return unwrap(field);
};
const getMediaIdFromItem = (item: unknown) => {
  if (typeof item === "number") return Number.isFinite(item) ? item : undefined;
  if (typeof item === "string") {
    const num = Number(item);
    return Number.isFinite(num) ? num : undefined;
  }
  if (isRecord(item)) {
    const rawId =
      item.id ?? (isRecord(item.attributes) ? item.attributes.id : undefined);
    const num = Number(rawId);
    return Number.isFinite(num) ? num : undefined;
  }
  return undefined;
};
const getMediaItemsFromField = (field: unknown): PostMediaItem[] =>
  resolveMediaItems(field)
    .map((item) => {
      const id = getMediaIdFromItem(item);
      if (!id) return null;
      const url =
        pickMediaUrl(item, { kind: "post", size: "medium" }) ||
        pickMediaUrl(item, { kind: "post" });
      const fullUrl =
        pickMediaUrl(item, { kind: "post", size: "large" }) ||
        pickMediaUrl(item, { kind: "post", size: "original" }) ||
        url;
      if (!url) return null;
      const resolvedFullUrl = fullUrl || url;
      return {
        id,
        url,
        fullUrl: resolvedFullUrl,
        isVideo: isVideoUrl(resolvedFullUrl),
      };
    })
    .filter((entry): entry is PostMediaItem => Boolean(entry));
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
const COMMENTS_PAGE_SIZE = 500;
const COMMENT_TARGET_CHUNK_SIZE = 40;
const MAX_TRUSTED_CIRCLES = 5;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_UPLOAD_LABEL = "1 GB";
const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_LABEL = "100 MB";
const MAX_POST_MEDIA_FILES = 10;
const MAX_COMMENT_MEDIA_FILES = 4;
const DASHBOARD_DESKTOP_SIDEBAR_KEY = "dashboard:desktop-sidebar-collapsed:v2";
const USERS_POST_POPULATE =
  "populate[0]=Users_Pictures&populate[1]=owner&populate[2]=feedbackTarget&populate[3]=trustedCircle";
const GROUP_POST_POPULATE = "populate[0]=media&populate[1]=owner&populate[2]=group";
const ADMIN_POST_POPULATE = "populate[0]=Pictures";
const URL_REGEX =
  /\b((?:https?:\/\/)?(?:www\.)?(?:(?:[a-z0-9-]+\.)+[a-z]{2,}|localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})?)(?:\/[^\s]*)?/gi;
const TRAILING_PUNCTUATION = /[),.!?]+$/;
const IMAGE_EXT_REGEX = /\.(?:png|jpe?g|webp|gif|bmp|avif)(?:\?|#|$)/i;
const RELATIVE_UPLOAD_REGEX = /\/uploads\/[^\s)]+/g;
const normalizeLink = (raw: string) => {
  const cleaned = raw.replace(TRAILING_PUNCTUATION, "");
  const hasProtocol = /^https?:\/\//i.test(cleaned);
  if (hasProtocol) {
    return { cleaned, href: cleaned };
  }
  const isLocalhost = /^(?:www\.)?localhost(?::\d+)?(?:\/|$)/i.test(cleaned);
  const isIpv4 = /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?(?:\/|$)/.test(cleaned);
  const protocol = isLocalhost || isIpv4 ? "http" : "https";
  const href = cleaned.startsWith("www.")
    ? `${protocol}://${cleaned}`
    : `${protocol}://${cleaned}`;
  return { cleaned, href };
};
const extractFirstUrl = (text: string) => {
  const safeText = String(text || "");
  if (!safeText) return "";
  const matches = Array.from(safeText.matchAll(URL_REGEX));
  for (const match of matches) {
    const raw = match[0];
    const start = match.index ?? 0;
    const prevChar = start > 0 ? safeText[start - 1] : "";
    if (prevChar === "@") continue;
    return normalizeLink(raw).href;
  }
  return "";
};
const extractImageUrls = (text: string) => {
  const safeText = String(text || "");
  if (!safeText) return [];
  const urls = new Set<string>();
  const matches = Array.from(safeText.matchAll(URL_REGEX));
  matches.forEach((match) => {
    const raw = match[0];
    const start = match.index ?? 0;
    const prevChar = start > 0 ? safeText[start - 1] : "";
    if (prevChar === "@") return;
    const { href } = normalizeLink(raw);
    if (IMAGE_EXT_REGEX.test(href) || IMAGE_EXT_REGEX.test(raw)) {
      urls.add(href);
    }
  });
  const relativeMatches = safeText.match(RELATIVE_UPLOAD_REGEX) ?? [];
  relativeMatches.forEach((raw) => {
    if (IMAGE_EXT_REGEX.test(raw)) {
      urls.add(raw);
    }
  });
  return Array.from(urls);
};
const stripImageUrls = (text: string, urls: string[]) => {
  let cleaned = String(text || "");
  urls.forEach((url) => {
    cleaned = cleaned.replace(url, "");
  });
  return cleaned.replace(/\s{2,}/g, " ").trim();
};
const linkifyText = (text: string) => {
  const safeText = String(text || "");
  if (!safeText) return "";
  const matches = Array.from(safeText.matchAll(URL_REGEX));
  if (!matches.length) return safeText;
  const nodes: Array<string | JSX.Element> = [];
  let lastIndex = 0;
  matches.forEach((match, index) => {
    const raw = match[0];
    const start = match.index ?? 0;
    if (start > lastIndex) {
      nodes.push(safeText.slice(lastIndex, start));
    }
    const prevChar = start > 0 ? safeText[start - 1] : "";
    if (prevChar === "@") {
      nodes.push(raw);
      lastIndex = start + raw.length;
      return;
    }
    const { cleaned, href } = normalizeLink(raw);
    const suffix = raw.slice(cleaned.length);
    nodes.push(
      <a
        key={`${href}-${start}-${index}`}
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(event) => event.stopPropagation()}
      >
        {cleaned}
      </a>
    );
    if (suffix) {
      nodes.push(suffix);
    }
    lastIndex = start + raw.length;
  });
  if (lastIndex < safeText.length) {
    nodes.push(safeText.slice(lastIndex));
  }
  return nodes;
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
const isVideoUrl = (value?: string) =>
  !!value && /\.(mp4|webm|mov|m4v|mkv)$/i.test(value);
const isPreviewableUrl = (value?: string) =>
  !!value && (isYoutubeUrl(value) || isVideoUrl(value));
const isImageUrl = (value?: string) =>
  !!value && /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(value);
const isVideoFile = (file: File) => {
  if (file.type && file.type.startsWith("video/")) return true;
  return /\.(mp4|webm|mov|m4v|mkv)$/i.test(file.name);
};
const isImageFile = (file: File) => {
  if (file.type && file.type.startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|heif)$/i.test(file.name);
};
const mediaDescriptor = (mediaUrl?: string, hasLink?: boolean) => {
  if (mediaUrl) return isVideoUrl(mediaUrl) ? "with a video" : "with a picture";
  if (hasLink) return "with a link";
  return "";
};
const getPostMediaUrls = (post: NormalizedPost, options?: { preferFull?: boolean }) => {
  const preferFull = Boolean(options?.preferFull);
  if (post.mediaItems && post.mediaItems.length) {
    return post.mediaItems
      .map((item) => (preferFull ? item.fullUrl || item.url : item.url))
      .filter(Boolean)
      .slice(0, MAX_POST_MEDIA_FILES);
  }
  if (post.mediaUrls && post.mediaUrls.length) {
    return post.mediaUrls.filter(Boolean).slice(0, MAX_POST_MEDIA_FILES);
  }
  return post.imageUrl ? [post.imageUrl] : [];
};
const getMediaGridLayout = (count: number) => {
  const total = Math.min(count, MAX_POST_MEDIA_FILES);
  if (total <= 1) return { columns: 1, rows: 1 };
  if (total <= 5) return { columns: total, rows: 1 };
  return { columns: 5, rows: 2 };
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
const uniqueNumberList = (values: Array<number | null | undefined>) => {
  const seen = new Set<number>();
  const output: number[] = [];
  values.forEach((value) => {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    output.push(value);
  });
  return output;
};
const getEntryNumericId = (entry: unknown) => {
  const record = asRecord(entry);
  const attrs = normalize(entry);
  const direct = Number(record.id ?? attrs.id);
  if (Number.isFinite(direct)) return direct;
  return null;
};
const collectPostNumericIds = (entries: unknown[]) =>
  uniqueNumberList(entries.map((entry) => getEntryNumericId(entry)));
const splitIntoChunks = <T,>(items: T[], size: number) => {
  if (size <= 0 || items.length <= size) return [items];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};
const hasCommentTargets = (targets: CommentTargetBuckets) =>
  targets.userIds.length > 0 || targets.groupIds.length > 0 || targets.adminIds.length > 0;
const buildCommentTargetsFromLists = (
  userPosts: unknown[],
  groupPosts: unknown[],
  adminPosts: unknown[]
): CommentTargetBuckets => ({
  userIds: collectPostNumericIds(userPosts),
  groupIds: collectPostNumericIds(groupPosts),
  adminIds: collectPostNumericIds(adminPosts),
});
const buildCommentTargetsForPost = (
  post: Pick<NormalizedPost, "source" | "numericId" | "id">
): CommentTargetBuckets => {
  const numericId =
    post.numericId ??
    (typeof post.id === "number" ? post.id : Number.isFinite(Number(post.id)) ? Number(post.id) : null);
  if (typeof numericId !== "number" || !Number.isFinite(numericId)) {
    return { userIds: [], groupIds: [], adminIds: [] };
  }
  if (post.source === "group") {
    return { userIds: [], groupIds: [numericId], adminIds: [] };
  }
  if (post.source === "admin") {
    return { userIds: [], groupIds: [], adminIds: [numericId] };
  }
  return { userIds: [numericId], groupIds: [], adminIds: [] };
};
const commentTargetMatchesType = (
  targetType: string,
  targetId: number,
  targets: CommentTargetBuckets
) => {
  if (targetType === "user" || targetType === "users-post") {
    return targets.userIds.includes(targetId);
  }
  if (targetType === "group" || targetType === "group-post") {
    return targets.groupIds.includes(targetId);
  }
  if (targetType === "admin") {
    return targets.adminIds.includes(targetId);
  }
  return false;
};
const filterOutCommentsByTargets = (comments: unknown[], targets: CommentTargetBuckets) =>
  comments.filter((entry) => {
    const record = asRecord(entry);
    const attrs = normalize(entry);
    const targetType = String(attrs.target_type ?? record.target_type ?? "")
      .trim()
      .toLowerCase();
    const targetId = Number(attrs.target_id ?? record.target_id);
    if (!targetType || !Number.isFinite(targetId)) return true;
    return !commentTargetMatchesType(targetType, targetId, targets);
  });
const getCommentKey = (entry: unknown) => {
  const record = asRecord(entry);
  const attrs = normalize(entry);
  const raw = record.documentId ?? attrs.documentId ?? record.id ?? attrs.id;
  return raw === undefined || raw === null ? "" : String(raw);
};
const mergeCommentLists = (prev: unknown[], next: unknown[]) => {
  if (!next.length) return prev;
  const seen = new Set(prev.map((entry) => getCommentKey(entry)).filter(Boolean));
  const merged = [...prev];
  next.forEach((entry) => {
    const key = getCommentKey(entry);
    if (key && seen.has(key)) return;
    merged.push(entry);
    if (key) seen.add(key);
  });
  return merged;
};
const commentInIdentifierSet = (entry: unknown, ids: Set<string>) => {
  const record = asRecord(entry);
  const attrs = normalize(entry);
  const entryId = record.id ?? attrs.id;
  const entryDoc = record.documentId ?? attrs.documentId;
  if (entryId !== undefined && ids.has(String(entryId))) return true;
  if (entryDoc !== undefined && ids.has(String(entryDoc))) return true;
  return false;
};
const buildUserPostPathCandidates = (post: NormalizedPost) => {
  const attempts: string[] = [];
  if (post.documentId) {
    attempts.push(`/users-posts/${post.documentId}`);
  }
  const numericId =
    post.numericId ?? (typeof post.id === "number" ? post.id : Number(post.id));
  if (Number.isFinite(numericId)) {
    attempts.push(`/users-posts/${numericId}`);
  }
  if (typeof post.id === "string") {
    attempts.push(`/users-posts/${post.id}`);
  }
  if (typeof post.id === "number") {
    attempts.push(`/users-posts/${post.id}`);
  }
  return Array.from(new Set(attempts));
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
const isPubliclyShareablePost = (
  post: Pick<NormalizedPost, "source" | "visibility" | "feedbackAudience">
) => {
  if (post.source === "admin") return true;
  const visibility = String(post.visibility || "")
    .trim()
    .toLowerCase();
  const audience = String(post.feedbackAudience || "")
    .trim()
    .toLowerCase();
  if (post.source === "group") {
    return visibility === "public";
  }
  return visibility === "public" || audience === "public";
};
const sortByCreatedAtDesc = (items: NormalizedPost[]) =>
  [...items].sort((a, b) => {
    const aParsed = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bParsed = b.createdAt ? Date.parse(b.createdAt) : 0;
    const aTime = Number.isNaN(aParsed) ? 0 : aParsed;
    const bTime = Number.isNaN(bParsed) ? 0 : bParsed;
    return bTime - aTime;
  });
const sortByCreatedAtAsc = (items: NormalizedPost[]) =>
  [...items].sort((a, b) => {
    const aParsed = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bParsed = b.createdAt ? Date.parse(b.createdAt) : 0;
    const aTime = Number.isNaN(aParsed) ? 0 : aParsed;
    const bTime = Number.isNaN(bParsed) ? 0 : bParsed;
    return aTime - bTime;
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
const POST_TEMPLATES: Array<{
  id: string;
  label: string;
  body: string;
  signalTag?: SignalTag;
}> = [
  {
    id: "check-in",
    label: "New check-in",
    body: "Today I'm focused on...\n\nNext step:\n\nSupport I need:",
    signalTag: "check-in",
  },
  {
    id: "win",
    label: "Share a win",
    body: "Win:\n\nWhat helped:\n\nNext goal:",
    signalTag: "win",
  },
  {
    id: "support",
    label: "Support request",
    body: "I'm stuck on...\n\nWhat I've tried:\n\nWhat would help me most:",
    signalTag: "support-request",
  },
];

export default function Dashboard() {
  const [posts, setPosts] = useState<PostsState>({
    user: [],
    group: [],
    comments: [],
    admin: [],
  });
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formContent, setFormContent] = useState("");
  const [formFiles, setFormFiles] = useState<File[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [checkInModalOpen, setCheckInModalOpen] = useState(false);
  const [postVisibility, setPostVisibility] = useState("friends");
  const [postTrustedCircleId, setPostTrustedCircleId] = useState<number | "">("");
  const [postSignalTag, setPostSignalTag] = useState<SignalTag>("none");
  const [postTemplateId, setPostTemplateId] = useState("");
  const [checkInGoal, setCheckInGoal] = useState("");
  const [checkInTarget, setCheckInTarget] = useState<"feed" | "trusted">("feed");
  const [checkInGroupId, setCheckInGroupId] = useState<number | "">("");
  const [feedbackAudience, setFeedbackAudience] = useState("none");
  const [feedbackTargetId, setFeedbackTargetId] = useState<number | null>(null);
  const [postFilter, setPostFilter] = useState<PostFilter>("all");
  const [postSort, setPostSort] = useState<PostSort>("newest");
  const [friendOptions, setFriendOptions] = useState<FriendOption[]>([]);
  const [friendIds, setFriendIds] = useState<number[]>([]);
  const [, setFavoriteFriendIds] = useState<number[]>([]);
  const [groupIds, setGroupIds] = useState<number[]>([]);
  const [trustedCircleOptions, setTrustedCircleOptions] = useState<TrustedCircleOption[]>([]);
  const [commentInputs, setCommentInputs] = useState<Record<string | number, string>>({});
  const [commentEdits, setCommentEdits] = useState<Record<string, string>>({});
  const [commentMediaFiles, setCommentMediaFiles] = useState<
    Record<string | number, File[]>
  >({});
  const [commentMediaPreviews, setCommentMediaPreviews] = useState<
    Record<string | number, string[]>
  >({});
  const commentPreviewRef = useRef<Record<string | number, string[]>>({});
  const [editingComments, setEditingComments] = useState<Record<string, boolean>>({});
  const [commentMenuOpen, setCommentMenuOpen] = useState<Record<string, boolean>>({});
  const [openCommentsFor, setOpenCommentsFor] = useState<Record<string | number, boolean>>(
    {}
  );
  const [shareMenuFor, setShareMenuFor] = useState<string | number | null>(null);
  const [postMenuFor, setPostMenuFor] = useState<string | null>(null);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [reactionBreakdownFor, setReactionBreakdownFor] = useState<string | null>(null);
  const [shareNotice, setShareNotice] = useState<Record<string | number, string>>({});
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [impactNotice, setImpactNotice] = useState<string | null>(null);
  const [activePostKey, setActivePostKey] = useState<string | null>(null);
  const [editingPostId, setEditingPostId] = useState<string | null>(null);
  const [editPostTitle, setEditPostTitle] = useState("");
  const [editPostContent, setEditPostContent] = useState("");
  const [editMediaItems, setEditMediaItems] = useState<PostMediaItem[]>([]);
  const [editMediaPostId, setEditMediaPostId] = useState<string | null>(null);
  const [editMediaRemovingId, setEditMediaRemovingId] = useState<number | null>(
    null
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDeletePost, setPendingDeletePost] = useState<NormalizedPost | null>(
    null
  );
  const [postEditing, setPostEditing] = useState<Record<string, boolean>>({});
  const [visiblePostKeys, setVisiblePostKeys] = useState<Record<string, boolean>>({});
  const [goalsModalOpen, setGoalsModalOpen] = useState(false);
  const [formFilePreviewUrls, setFormFilePreviewUrls] = useState<string[]>([]);
  const [formDragActive, setFormDragActive] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(DASHBOARD_DESKTOP_SIDEBAR_KEY) === "1";
  });
  const [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null);
  const [linkPreviewLoading, setLinkPreviewLoading] = useState(false);
  const [linkPreviewError, setLinkPreviewError] = useState<string | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, LinkPreview | null>>({});
  const previewQueueRef = useRef<string[]>([]);
  const previewInFlightRef = useRef(0);
  const previewPendingRef = useRef<Set<string>>(new Set());
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const impactTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const postObserverRef = useRef<IntersectionObserver | null>(null);
  const postObserverTargetsRef = useRef<Map<Element, string>>(new Map());

  const navigate = useNavigate();
  const location = useLocation();
  const sharedPostTarget = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const rawPost = String(params.get("post") || params.get("postId") || "").trim();
    const postKey = rawPost.replace(/^post-/, "");
    if (!postKey) return null;
    const rawSource = String(params.get("source") || "").trim().toLowerCase();
    const source = isPostSource(rawSource) ? rawSource : null;
    return { postKey, source };
  }, [location.search]);
  const hashHandledRef = useRef<string | null>(null);
  const { user, profile, sessionActive } = useAuth();
  const { getBackgroundStyle } = useUserPreferences();
  const userId = user?.id;
  const goalsStorageKey = useMemo(() => goalsStorageKeyFor(userId), [userId]);
  const [goalsState, setGoalsState] = useState<GoalsState>(() =>
    loadGoalsState(goalsStorageKey)
  );
  const { override: newsOverride } = useNewsPreference(userId);
  const { bumpStat } = useImpactStats(userId);
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

  useEffect(() => {
    setGoalsState(loadGoalsState(goalsStorageKey));
  }, [goalsStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleSync = () => setGoalsState(loadGoalsState(goalsStorageKey));
    window.addEventListener("ysp-goals-updated", handleSync);
    return () => window.removeEventListener("ysp-goals-updated", handleSync);
  }, [goalsStorageKey]);

  useEffect(() => {
    commentPreviewRef.current = commentMediaPreviews;
  }, [commentMediaPreviews]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      DASHBOARD_DESKTOP_SIDEBAR_KEY,
      desktopSidebarCollapsed ? "1" : "0"
    );
  }, [desktopSidebarCollapsed]);

  useEffect(() => {
    return () => {
      if (typeof URL === "undefined") return;
      Object.values(commentPreviewRef.current)
        .flat()
        .forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleStartCheckIn = (event: Event) => {
      const detail = (event as CustomEvent<{ goal?: string }>).detail;
      setGoalsModalOpen(false);
      setCheckInModalOpen(true);
      setPostSignalTag("check-in");
      setPostTemplateId("check-in");
      setFormError(null);
      setFormFiles([]);
      const template = POST_TEMPLATES.find((item) => item.id === "check-in");
      if (template) {
        setFormContent((prev) => (prev.trim() ? prev : template.body));
      }
      if (detail?.goal) {
        setCheckInGoal(detail.goal);
      }
    };
    window.addEventListener("ysp-goals-start-checkin", handleStartCheckIn as EventListener);
    return () =>
      window.removeEventListener("ysp-goals-start-checkin", handleStartCheckIn as EventListener);
  }, []);

  const closeCheckInModal = useCallback(() => {
    setCheckInModalOpen(false);
    setFormError(null);
    setFormContent("");
    setFormFiles([]);
    setPostSignalTag("none");
    setPostTemplateId("");
    setCheckInGoal("");
    setCheckInTarget("feed");
    setCheckInGroupId("");
  }, []);

  const applyTemplate = useCallback(
    (template: (typeof POST_TEMPLATES)[number]) => {
      setFormContent(template.body);
      if (template.signalTag) {
        setPostSignalTag(template.signalTag);
      }
      setFormError(null);
    },
    []
  );

  const handleTemplateSelect = useCallback(
    (templateId: string) => {
      setPostTemplateId(templateId);
      const template = POST_TEMPLATES.find((item) => item.id === templateId);
      if (template) {
        applyTemplate(template);
      }
    },
    [applyTemplate]
  );

  const availableGoals = useMemo(
    () =>
      Array.from(
        new Set([...(goalsState.selectedGoals || []), ...(goalsState.customGoals || [])])
      ).filter(Boolean),
    [goalsState.customGoals, goalsState.selectedGoals]
  );

  const trustedCircles = useMemo(
    () => trustedCircleOptions,
    [trustedCircleOptions]
  );

  const showCheckInOptions =
    postSignalTag === "check-in" || postSignalTag === "support-request";
  const showFeedOptions = !showCheckInOptions || checkInTarget === "feed";
  const dashboardNewsEnabled =
    (newsOverride ?? profile?.notificationSettings?.newsEnabled) !== false;
  const composerHasDraft = Boolean(formContent.trim()) || formFiles.length > 0;
  const isComposerOpen = composerOpen || composerHasDraft || submitting;
  const showComposerAdvanced = isComposerOpen && composerExpanded;

  useEffect(() => {
    if (!composerOpen) return;
    if (submitting) return;
    if (composerHasDraft) return;
    if (showCheckInOptions) return;
    if (typeof document === "undefined") return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      const composer = document.getElementById("post-composer");
      if (composer && composer.contains(target)) return;
      setComposerExpanded(false);
      setComposerOpen(false);
      setFormError(null);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [composerHasDraft, composerOpen, showCheckInOptions, submitting]);

  const selectedTemplateLabel = useMemo(() => {
    if (!postTemplateId) return "No template";
    const match = POST_TEMPLATES.find((template) => template.id === postTemplateId);
    return match?.label ?? "No template";
  }, [postTemplateId]);

  const selectedSignalLabel = useMemo(() => {
    const match = SIGNAL_TAGS.find((tag) => tag.value === postSignalTag);
    return match?.label ?? "None";
  }, [postSignalTag]);

  const visibilityLabel = useMemo(() => {
    if (postVisibility === "public") return "Public";
    if (postVisibility === "private") return "Private";
    if (postVisibility === "trusted") return "Trusted circle";
    return "Friends";
  }, [postVisibility]);

  const feedbackTargetLabel = useMemo(() => {
    if (!feedbackTargetId) return "Specific friend";
    return (
      friendOptions.find((option) => option.id === feedbackTargetId)?.label ||
      "Specific friend"
    );
  }, [feedbackTargetId, friendOptions]);

  const feedbackLabel = useMemo(() => {
    if (feedbackAudience === "public") return "Public feedback";
    if (feedbackAudience === "friends") return "Friends feedback";
    if (feedbackAudience === "specific") return `Ask ${feedbackTargetLabel}`;
    return "No feedback";
  }, [feedbackAudience, feedbackTargetLabel]);

  const reminderLabel = useMemo(() => {
    if (goalsState.reminder === "daily") return "Daily reminders";
    if (goalsState.reminder === "weekly") return "Weekly recap";
    return "No reminders";
  }, [goalsState.reminder]);

  const summaryChips = useMemo(() => {
    const chips: Array<{ key: string; label: string }> = [];

    if (postTemplateId) {
      chips.unshift({ key: "template", label: `Template: ${selectedTemplateLabel}` });
    }
    if (postSignalTag !== "none") {
      chips.unshift({ key: "type", label: `Post type: ${selectedSignalLabel}` });
    }
    if (showCheckInOptions) {
      const shareLabel =
        checkInTarget === "trusted" ? "Trusted circle" : "My feed";
      chips.push({ key: "share", label: `Share: ${shareLabel}` });
      if (checkInGoal) {
        chips.push({ key: "goal", label: `Goal: ${checkInGoal}` });
      }
      if (checkInTarget === "trusted" && checkInGroupId) {
        const groupName =
          trustedCircles.find((group) => group.id === checkInGroupId)?.name ||
          "Trusted circle";
        chips.push({ key: "circle", label: `Circle: ${groupName}` });
      }
    }
    if (showFeedOptions) {
      chips.push({ key: "visibility", label: `Visibility: ${visibilityLabel}` });
      chips.push({ key: "feedback", label: `Feedback: ${feedbackLabel}` });
      if (postVisibility === "trusted" && postTrustedCircleId) {
        const groupName =
          trustedCircleOptions.find((group) => group.id === Number(postTrustedCircleId))
            ?.name || "Trusted circle";
        chips.push({ key: "circle", label: `Circle: ${groupName}` });
      }
    }

    chips.push({ key: "reminders", label: `Reminders: ${reminderLabel}` });
    chips.push({
      key: "news",
      label: dashboardNewsEnabled ? "Newsroom: On" : "Newsroom: Off",
    });

    return chips;
  }, [
    checkInGoal,
    checkInGroupId,
    checkInTarget,
    dashboardNewsEnabled,
    feedbackLabel,
    trustedCircleOptions,
    postSignalTag,
    postTrustedCircleId,
    postTemplateId,
    reminderLabel,
    selectedSignalLabel,
    selectedTemplateLabel,
    showCheckInOptions,
    showFeedOptions,
    trustedCircles,
    postVisibility,
    visibilityLabel,
  ]);
  const visibilityChipKeys = new Set(["visibility", "feedback", "reminders", "news"]);
  const visibilityChips = useMemo(
    () => summaryChips.filter((chip) => visibilityChipKeys.has(chip.key)),
    [summaryChips]
  );
  const detailChips = useMemo(
    () => summaryChips.filter((chip) => !visibilityChipKeys.has(chip.key)),
    [summaryChips]
  );

  const composerToggleLabel = showComposerAdvanced ? "Hide options" : "Customize post";
  const composerToggleDisabled = false;

  const handleComposerFiles = useCallback(
    (incoming: FileList | File[] | null) => {
      const files = incoming ? Array.from(incoming) : [];
      if (!files.length) {
        setFormFiles([]);
        return;
      }

      let valid = files.filter((file) => isVideoFile(file) || isImageFile(file));
      if (valid.length !== files.length) {
        setFormError("Only images or videos are allowed.");
      }

      if (!valid.length) {
        setFormFiles([]);
        return;
      }

      if (valid.length > MAX_POST_MEDIA_FILES) {
        setFormError(`You can upload up to ${MAX_POST_MEDIA_FILES} files at once.`);
        valid = valid.slice(0, MAX_POST_MEDIA_FILES);
      }

      for (const file of valid) {
        const isVideo = isVideoFile(file);
        const maxBytes = isVideo ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
        const maxLabel = isVideo ? MAX_VIDEO_UPLOAD_LABEL : MAX_UPLOAD_LABEL;
        if (file.size > maxBytes) {
          setFormError(`Media files must be under ${maxLabel}.`);
          return;
        }
      }

      setFormFiles(valid);
      setFormError(null);
    },
    []
  );

  useEffect(() => {
    if (checkInTarget !== "trusted") {
      setCheckInGroupId("");
    }
  }, [checkInTarget]);

  useEffect(() => {
    if (postVisibility !== "trusted") {
      setPostTrustedCircleId("");
    }
  }, [postVisibility]);

  useEffect(() => {
    if (showCheckInOptions && !checkInModalOpen) {
      setComposerOpen(true);
      setComposerExpanded(true);
    }
  }, [showCheckInOptions, checkInModalOpen]);

  useEffect(() => {
    if (!showCheckInOptions) {
      setCheckInGoal("");
      setCheckInTarget("feed");
      setCheckInGroupId("");
    }
  }, [showCheckInOptions]);

  useEffect(() => {
    if (!formFiles.length) {
      setFormFilePreviewUrls([]);
      return;
    }
    const urls = formFiles.map((file) => URL.createObjectURL(file));
    setFormFilePreviewUrls(urls);
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [formFiles]);

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

  const fetchCommentsForTargets = useCallback(async (targets: CommentTargetBuckets) => {
    if (!hasCommentTargets(targets)) return [] as unknown[];

    const requestDefs: Array<{ targetType: string; ids: number[] }> = [];
    if (targets.userIds.length) {
      requestDefs.push({ targetType: "user", ids: targets.userIds });
      requestDefs.push({ targetType: "users-post", ids: targets.userIds });
    }
    if (targets.groupIds.length) {
      requestDefs.push({ targetType: "group-post", ids: targets.groupIds });
      requestDefs.push({ targetType: "group", ids: targets.groupIds });
    }
    if (targets.adminIds.length) {
      requestDefs.push({ targetType: "admin", ids: targets.adminIds });
    }

    const requests = requestDefs.flatMap((def) =>
      splitIntoChunks(def.ids, COMMENT_TARGET_CHUNK_SIZE).map((idChunk) => {
        const idQuery = idChunk
          .map((id, index) => `filters[target_id][$in][${index}]=${id}`)
          .join("&");
        const query =
          `filters[target_type][$eq]=${encodeURIComponent(def.targetType)}` +
          `&${idQuery}&populate=owner&sort=createdAt:desc&pagination[pageSize]=${COMMENTS_PAGE_SIZE}`;
        return api.get(`/comments?${query}`);
      })
    );

    if (!requests.length) return [] as unknown[];
    const responses = await Promise.all(requests);
    const allComments = responses.flatMap((res) => res.data?.data ?? []);
    return mergeCommentLists([], allComments);
  }, []);

  const refreshCommentsForPost = useCallback(
    async (post: Pick<NormalizedPost, "source" | "numericId" | "id">) => {
      const targets = buildCommentTargetsForPost(post);
      if (!hasCommentTargets(targets)) return [] as unknown[];
      const nextComments = await fetchCommentsForTargets(targets);
      setPosts((prev) => ({
        ...prev,
        comments: mergeCommentLists(
          filterOutCommentsByTargets(prev.comments ?? [], targets),
          nextComments
        ),
      }));
      return nextComments;
    },
    [fetchCommentsForTargets]
  );


  const reloadPosts = useCallback(
    async (options?: { silent?: boolean }) => {
      const loadId = ++loadIdRef.current;
      if (!options?.silent) {
        setLoading(true);
      }
      setError(null);

      const token = getStoredToken();
      if (!token) {
        if (!options?.silent) {
          setLoading(false);
        }
        if (!sessionActive && !userId) {
          navigate("/login");
        }
        return;
      }

      try {
        if (!userId) {
          if (!options?.silent) {
            setLoading(false);
          }
          return;
        }

        const [friendsRes, groupMembersRes] = await Promise.all([
          api.get(
            `/friends?filters[$or][0][requester][id][$eq]=${userId}` +
              `&filters[$or][1][target][id][$eq]=${userId}` +
              `&populate=requester&populate=target`
          ),
          api.get(
            `/group-members?filters[user][id][$eq]=${userId}&populate=group&pagination[pageSize]=200`
          ),
        ]);

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

        const groupEntries = groupMembersRes.data?.data ?? [];
        const resolvedGroups = groupEntries
          .map((entry: unknown) => {
            const attrs = normalize(entry) as { group?: unknown };
            const groupEntity = getEntity(attrs.group);
            const groupId = getEntityId(groupEntity);
            if (!groupId) return null;
            const groupAttrs = normalize(groupEntity) as { name?: unknown; kind?: unknown };
            return {
              id: groupId,
              name: getString(groupAttrs.name) ?? `Group ${groupId}`,
              kind: getString(groupAttrs.kind) ?? undefined,
            } as GroupOption;
          })
          .filter(Boolean) as GroupOption[];
        const uniqueGroupOptions = Array.from(
          new Map(resolvedGroups.map((group) => [group.id, group])).values()
        );
        const memberGroups = uniqueGroupOptions.map((group) => group.id);
        setGroupIds(memberGroups);

        const userFilterIds = Array.from(new Set([userId, ...nextFriendIds]));
        const userQuery = buildUserPostsQuery(userFilterIds);
        const groupFilter = memberGroups.length ? buildIdFilter("group", memberGroups) : "";

        const [adminRes, userRes, groupRes, circlesRes] = await Promise.all([
          api.get(`/posts?${ADMIN_POST_POPULATE}&pagination[pageSize]=${POSTS_PAGE_SIZE}`),
          api.get(
            `/users-posts?${userQuery}&${USERS_POST_POPULATE}` +
              `&sort=createdAt:desc&pagination[pageSize]=${POSTS_PAGE_SIZE}&pagination[page]=1`
          ),
          memberGroups.length
            ? api.get(
                `/group-posts?${groupFilter}&${GROUP_POST_POPULATE}` +
                  `&sort=createdAt:desc&pagination[pageSize]=${POSTS_PAGE_SIZE}&pagination[page]=1`
              )
            : Promise.resolve({ data: { data: [], meta: {} } }),
          api.get(
            `/trusted-circles?sort=name:asc&pagination[pageSize]=${MAX_TRUSTED_CIRCLES}`
          ),
        ]);

        if (loadId !== loadIdRef.current) return;

        const trustedCircleRows = circlesRes.data?.data ?? [];
        const nextTrustedCircles = (trustedCircleRows || [])
          .map((entry: any) => {
            const attrs = normalize(entry);
            const circleId = Number(entry?.id ?? attrs?.documentId ?? attrs?.id);
            if (!Number.isFinite(circleId)) return null;
            return {
              id: circleId,
              name: String(attrs?.name || `Circle ${circleId}`),
            } as TrustedCircleOption;
          })
          .filter(Boolean) as TrustedCircleOption[];
        setTrustedCircleOptions(nextTrustedCircles);
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
        const nextAdminPosts = adminRes.data?.data ?? [];
        const commentTargets = buildCommentTargetsFromLists(
          userPostsData,
          groupPostsData,
          nextAdminPosts
        );
        setPosts((prev) => ({
          user: userPostsData,
          group: groupPostsData,
          comments: prev.comments ?? [],
          admin: nextAdminPosts,
        }));
        void (async () => {
          try {
            const nextComments = await fetchCommentsForTargets(commentTargets);
            if (loadId !== loadIdRef.current) return;
            setPosts((prev) => ({
              ...prev,
              comments: nextComments,
            }));
          } catch (err) {
            console.warn("Targeted comment load failed", err);
          }
        })();
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
                Boolean(getStoredToken())
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
    [fetchCommentsForTargets, nameFromProfile, navigate, sessionActive, userId]
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
              `/users-posts?${userQuery}&${USERS_POST_POPULATE}` +
                `&sort=createdAt:desc&pagination[pageSize]=${POSTS_PAGE_SIZE}&pagination[page]=${nextUserPage}`
            )
          : Promise.resolve({ data: { data: [], meta: {} } }),
        shouldLoadGroup
          ? api.get(
              `/group-posts?${groupFilter}&${GROUP_POST_POPULATE}` +
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
        const nextCommentTargets = buildCommentTargetsFromLists(
          shouldLoadUser ? userPostsData : [],
          shouldLoadGroup ? groupPostsData : [],
          []
        );
        if (hasCommentTargets(nextCommentTargets)) {
          void (async () => {
            try {
              const nextComments = await fetchCommentsForTargets(nextCommentTargets);
              if (loadId !== loadIdRef.current) return;
              setPosts((prev) => ({
                ...prev,
                comments: mergeCommentLists(prev.comments ?? [], nextComments),
              }));
            } catch (err) {
              console.warn("Load-more comment fetch failed", err);
            }
          })();
        }
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
    fetchCommentsForTargets,
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

  useEffect(() => {
    const allComments = posts.comments ?? [];
    const urls = new Set<string>();
    allComments.forEach((entry) => {
      const attrs = normalize(entry);
      const body = String(attrs.body ?? "").trim();
      const url = extractFirstUrl(body);
      if (isPreviewableUrl(url)) {
        urls.add(url);
      }
    });
    urls.forEach((url) => enqueuePreview(url));
  }, [enqueuePreview, posts.comments]);

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
        id?: number | string;
        documentId?: string;
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
        trustedCircle?: unknown;
        likes?: number;
        reactionCounts?: ReactionCounts;
        myReaction?: string | null;
        shares?: number;
        visibility?: string;
      };
      const title = getString(attributes.Title) ?? getString(attributes.title) ?? "Untitled";
      const content =
        getString(attributes.Users_Content) ?? getString(attributes.content) ?? "";

      const mediaItems = getMediaItemsFromField(
        attributes.Users_Pictures ?? attributes.pictures
      );
      const mediaUrls = mediaItems.map((item) => item.url);
      const mediaIds = mediaItems.map((item) => item.id);
      const imageUrl = mediaUrls[0];

      const postRecord = asRecord(post);
      const rawPostId = postRecord.id ?? postRecord.documentId;
      const documentId =
        typeof postRecord.documentId === "string"
          ? postRecord.documentId
          : typeof attributes.documentId === "string"
          ? attributes.documentId
          : undefined;
      const targetIdSet = new Set<string>();
      const addTargetId = (value: unknown) => {
        if (value === undefined || value === null) return;
        targetIdSet.add(String(value));
      };
      addTargetId(rawPostId);
      addTargetId(postRecord.id);
      addTargetId(postRecord.documentId);
      addTargetId(attributes.id);
      addTargetId(attributes.documentId);
      const matchedComments = allComments
        .filter((comment) => {
          const commentRecord = asRecord(comment);
          const commentAttrs = normalize(comment);
          const targetType = String(
            commentAttrs.target_type ?? commentRecord.target_type ?? ""
          ).toLowerCase();
          const targetIdRaw = commentAttrs.target_id ?? commentRecord.target_id;
          const targetId = targetIdRaw === undefined ? "" : String(targetIdRaw);
          return (
            (targetType === "user" || targetType === "users-post") &&
            targetIdSet.has(targetId)
          );
        })
        .map((comment) => {
          const commentRecord = asRecord(comment);
          const commentAttrs = normalize(comment);
          const ownerSource = commentAttrs.owner ?? commentRecord.owner;
          const commentId =
            typeof commentRecord.id === "string" || typeof commentRecord.id === "number"
              ? commentRecord.id
              : String(commentRecord.id ?? "");
          const numericIdRaw =
            typeof commentRecord.id === "number" || typeof commentRecord.id === "string"
              ? commentRecord.id
              : commentAttrs.id;
          const numericId = Number(numericIdRaw);
          const documentId =
            typeof commentRecord.documentId === "string"
              ? commentRecord.documentId
              : typeof commentAttrs.documentId === "string"
              ? commentAttrs.documentId
              : undefined;
          return {
            id: commentId,
            numericId: Number.isFinite(numericId) ? numericId : undefined,
            documentId,
            body: getString(commentAttrs.body) ?? getString(commentRecord.body) ?? "",
            owner: resolveOwnerName(
              getEntityId(ownerSource),
              getOwnerName(ownerSource, "User")
            ),
            ownerId: getEntityId(ownerSource),
            createdAt:
              getString(commentAttrs.createdAt) ??
              getString(commentRecord.createdAt) ??
              undefined,
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
      const trustedCircleData = getEntity(attributes.trustedCircle);
      const trustedCircleId = getEntityId(trustedCircleData);
      const trustedCircleAttrs = normalize(trustedCircleData) as { name?: string };
      const trustedCircleName = trustedCircleId
        ? getString(trustedCircleAttrs.name) ?? `Circle ${trustedCircleId}`
        : undefined;
      const postId =
        typeof rawPostId === "string" || typeof rawPostId === "number" ? rawPostId : title;
      const numericId = Number(postRecord.id ?? rawPostId ?? attributes.id);
      const normalizedNumericId = Number.isFinite(numericId) ? numericId : undefined;
      const likes = Number(attributes.likes ?? 0);
      const reactionCounts = normalizeReactionCounts(attributes.reactionCounts, likes);
      const myReaction = normalizeReactionValue(
        attributes.myReaction ?? postRecord.myReaction
      );
      const shares = Number(attributes.shares ?? 0);

      return {
        id: postId,
        numericId: normalizedNumericId,
        documentId,
        title,
        content,
        imageUrl,
        mediaUrls,
        mediaItems,
        mediaIds,
        createdAt: getString(attributes.createdAt),
        source: "user",
        ownerName,
        ownerId,
        likes,
        reactionCounts,
        myReaction,
        shares,
        comments: matchedComments,
        visibility,
        signalTag: getString(attributes.signalTag) as SignalTag | undefined,
        feedbackAudience: getString(attributes.feedbackAudience),
        feedbackTargetId,
        feedbackTargetName,
        trustedCircleId,
        trustedCircleName,
      };
    };

    const normalizeGroupPost = (post: unknown): NormalizedPost => {
      const attributes = normalize(post) as {
        id?: number | string;
        documentId?: string;
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
        reactionCounts?: ReactionCounts;
        myReaction?: string | null;
        shares?: number;
      };
      const title =
        getString(attributes.title) ?? getString(attributes.Title) ?? "Group update";
      const content = getString(attributes.body) ?? getString(attributes.content) ?? "";
      const mediaItems = getMediaItemsFromField(attributes.media);
      const mediaUrls = mediaItems.map((item) => item.url);
      const mediaIds = mediaItems.map((item) => item.id);
      const imageUrl = mediaUrls[0];

      const ownerData = getEntity(attributes.owner);
      const ownerAttrs = normalize(ownerData) as { email?: string };
      const ownerId = getEntityId(ownerData);
      const ownerName = resolveOwnerName(ownerId, getString(ownerAttrs.email) ?? "Member");
      const groupData = getEntity(attributes.group);
      const groupAttrs = normalize(groupData) as { name?: string; visibility?: string };
      const groupName = getString(groupAttrs.name) ?? "Group";
      const groupId = getEntityId(groupData);
      const groupVisibility = getString(groupAttrs.visibility);
      const postRecord = asRecord(post);
      const rawPostId = postRecord.id ?? postRecord.documentId;
      const postId =
        typeof rawPostId === "string" || typeof rawPostId === "number" ? rawPostId : title;
      const numericId = Number(postRecord.id ?? rawPostId ?? attributes.id);
      const normalizedNumericId = Number.isFinite(numericId) ? numericId : undefined;
      const targetIdSet = new Set<string>();
      const addTargetId = (value: unknown) => {
        if (value === undefined || value === null) return;
        targetIdSet.add(String(value));
      };
      addTargetId(rawPostId);
      addTargetId(postRecord.id);
      addTargetId(postRecord.documentId);
      addTargetId(attributes.id);
      addTargetId(attributes.documentId);
      const matchedComments = allComments
        .filter((comment) => {
          const commentRecord = asRecord(comment);
          const commentAttrs = normalize(comment);
          const targetType = String(
            commentAttrs.target_type ?? commentRecord.target_type ?? ""
          ).toLowerCase();
          const targetIdRaw = commentAttrs.target_id ?? commentRecord.target_id;
          const targetId = targetIdRaw === undefined ? "" : String(targetIdRaw);
          return (
            (targetType === "group-post" || targetType === "group") &&
            targetIdSet.has(targetId)
          );
        })
        .map((comment) => {
          const commentRecord = asRecord(comment);
          const commentAttrs = normalize(comment);
          const ownerSource = commentAttrs.owner ?? commentRecord.owner;
          const commentId =
            typeof commentRecord.id === "string" || typeof commentRecord.id === "number"
              ? commentRecord.id
              : String(commentRecord.id ?? "");
          const numericIdRaw =
            typeof commentRecord.id === "number" || typeof commentRecord.id === "string"
              ? commentRecord.id
              : commentAttrs.id;
          const numericId = Number(numericIdRaw);
          const documentId =
            typeof commentRecord.documentId === "string"
              ? commentRecord.documentId
              : typeof commentAttrs.documentId === "string"
              ? commentAttrs.documentId
              : undefined;
          return {
            id: commentId,
            numericId: Number.isFinite(numericId) ? numericId : undefined,
            documentId,
            body: getString(commentAttrs.body) ?? getString(commentRecord.body) ?? "",
            owner: resolveOwnerName(
              getEntityId(ownerSource),
              getOwnerName(ownerSource, "User")
            ),
            ownerId: getEntityId(ownerSource),
            createdAt:
              getString(commentAttrs.createdAt) ??
              getString(commentRecord.createdAt) ??
              undefined,
          };
        });

      const likes = Number(attributes.likes ?? 0);
      const reactionCounts = normalizeReactionCounts(attributes.reactionCounts, likes);
      const myReaction = normalizeReactionValue(
        attributes.myReaction ?? postRecord.myReaction
      );

      return {
        id: postId,
        numericId: normalizedNumericId,
        title,
        content,
        imageUrl,
        mediaUrls,
        mediaItems,
        mediaIds,
        createdAt: getString(attributes.createdAt),
        source: "group",
        ownerName,
        ownerId,
        likes,
        reactionCounts,
        myReaction,
        shares: Number(attributes.shares ?? 0),
        comments: matchedComments,
        groupName,
        groupId,
        visibility: groupVisibility,
        signalTag: getString(attributes.signalTag) as SignalTag | undefined,
      };
    };

    const normalizeAdminPost = (post: unknown): NormalizedPost => {
      const attributes = normalize(post) as {
        id?: number | string;
        documentId?: string;
        Title?: string;
        Posts_Content?: string;
        Pictures?: unknown;
        createdAt?: string;
        likes?: number;
        reactionCounts?: ReactionCounts;
        myReaction?: string | null;
        shares?: number;
        signalTag?: SignalTag;
      };
      const title = getString(attributes.Title) ?? "Announcement";
      const content = getString(attributes.Posts_Content) ?? "";

      const mediaItems = getMediaItemsFromField(attributes.Pictures);
      const mediaUrls = mediaItems.map((item) => item.url);
      const mediaIds = mediaItems.map((item) => item.id);
      const imageUrl = mediaUrls[0];

      const postRecord = asRecord(post);
      const rawPostId = postRecord.id ?? postRecord.documentId;
      const targetIdSet = new Set<string>();
      const addTargetId = (value: unknown) => {
        if (value === undefined || value === null) return;
        targetIdSet.add(String(value));
      };
      addTargetId(rawPostId);
      addTargetId(postRecord.id);
      addTargetId(postRecord.documentId);
      addTargetId(attributes.id);
      addTargetId(attributes.documentId);
      const matchedComments = allComments
        .filter((comment) => {
          const commentRecord = asRecord(comment);
          const commentAttrs = normalize(comment);
          const targetType = String(
            commentAttrs.target_type ?? commentRecord.target_type ?? ""
          ).toLowerCase();
          const targetIdRaw = commentAttrs.target_id ?? commentRecord.target_id;
          const targetId = targetIdRaw === undefined ? "" : String(targetIdRaw);
          return targetType === "admin" && targetIdSet.has(targetId);
        })
        .map((comment) => {
          const commentRecord = asRecord(comment);
          const commentAttrs = normalize(comment);
          const ownerSource = commentAttrs.owner ?? commentRecord.owner;
          const commentId =
            typeof commentRecord.id === "string" || typeof commentRecord.id === "number"
              ? commentRecord.id
              : String(commentRecord.id ?? "");
          const numericIdRaw =
            typeof commentRecord.id === "number" || typeof commentRecord.id === "string"
              ? commentRecord.id
              : commentAttrs.id;
          const numericId = Number(numericIdRaw);
          const documentId =
            typeof commentRecord.documentId === "string"
              ? commentRecord.documentId
              : typeof commentAttrs.documentId === "string"
              ? commentAttrs.documentId
              : undefined;
          return {
            id: commentId,
            numericId: Number.isFinite(numericId) ? numericId : undefined,
            documentId,
            body: getString(commentAttrs.body) ?? getString(commentRecord.body) ?? "",
            owner: resolveOwnerName(
              getEntityId(ownerSource),
              getOwnerName(ownerSource, "User")
            ),
            ownerId: getEntityId(ownerSource),
            createdAt:
              getString(commentAttrs.createdAt) ??
              getString(commentRecord.createdAt) ??
              undefined,
          };
        });

      const postId =
        typeof rawPostId === "string" || typeof rawPostId === "number" ? rawPostId : title;
      const numericId = Number(postRecord.id ?? rawPostId ?? attributes.id);
      const normalizedNumericId = Number.isFinite(numericId) ? numericId : undefined;
      const likes = Number(attributes.likes ?? 0);
      const reactionCounts = normalizeReactionCounts(attributes.reactionCounts, likes);
      const myReaction = normalizeReactionValue(
        attributes.myReaction ?? postRecord.myReaction
      );

      return {
        id: postId,
        numericId: normalizedNumericId,
        title,
        content,
        imageUrl,
        mediaUrls,
        mediaItems,
        mediaIds,
        createdAt: getString(attributes.createdAt),
        source: "admin",
        ownerName: "Your Social Place",
        likes,
        reactionCounts,
        myReaction,
        shares: Number(attributes.shares ?? 0),
        comments: matchedComments,
        signalTag: getString(attributes.signalTag) as SignalTag | undefined,
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
      const isTrusted = visibility === "trusted";
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
      if (isTrusted) {
        friendPosts.push(post);
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
    const publicSorted = sortByCreatedAtDesc(publicPosts);

    return {
      admin: adminSorted,
      friends: friendsSorted,
      private: privateSorted,
      public: publicSorted,
      group: groupPosts,
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

  const orderedPosts = useMemo(
    () =>
      postSort === "oldest"
        ? sortByCreatedAtAsc(visiblePosts)
        : sortByCreatedAtDesc(visiblePosts),
    [postSort, visiblePosts]
  );

  const featuredWins = useMemo(
    () => orderedPosts.filter((post) => post.signalTag === "win").slice(0, 3),
    [orderedPosts]
  );

  const activePost = useMemo(() => {
    if (!activePostKey) return null;
    return (
      categorizedPosts.ordered.find((post) => String(post.id) === activePostKey) ?? null
    );
  }, [activePostKey, categorizedPosts]);

  const fetchPostByTarget = useCallback(
    async (postKey: string, source?: PostSource | null) => {
      if (!postKey) return false;

      const attempts: Array<{
        endpoint: string;
        listKey: keyof Pick<PostsState, "user" | "group" | "admin">;
      }> = [];

      if (!source || source === "user") {
        attempts.push({
          endpoint: `/users-posts/${postKey}?${USERS_POST_POPULATE}`,
          listKey: "user",
        });
      }
      if (!source || source === "group") {
        attempts.push({
          endpoint: `/group-posts/${postKey}?${GROUP_POST_POPULATE}`,
          listKey: "group",
        });
      }
      if (!source || source === "admin") {
        attempts.push({
          endpoint: `/posts/${postKey}?${ADMIN_POST_POPULATE}`,
          listKey: "admin",
        });
      }

      for (const attempt of attempts) {
        try {
          const res = await api.get(attempt.endpoint);
          const entry = res.data?.data;
          if (!entry) continue;
          setPosts((prev) => ({
            ...prev,
            [attempt.listKey]: mergePostLists(prev[attempt.listKey], [entry]),
          }));
          return true;
        } catch {
          // Try the next source bucket.
        }
      }

      return false;
    },
    []
  );

  useEffect(() => {
    const hashId = location.hash.replace(/^#/, "");
    const hashPostKey = hashId ? (hashId.startsWith("post-") ? hashId.slice(5) : hashId) : "";
    const targetPostKey = sharedPostTarget?.postKey || hashPostKey;
    const targetSource = sharedPostTarget?.source ?? null;
    if (!targetPostKey) return;

    const targetId = `post-${targetPostKey}`;
    const targetHash = `#${targetId}`;
    const targetStateKey = `${location.key}:${targetPostKey}:${targetSource ?? "any"}`;
    if (hashHandledRef.current === targetStateKey && visiblePosts.length) return;

    if (postFilter !== "all") {
      setPostFilter("all");
    }

    const existingPost = categorizedPosts.ordered.find((post) => {
      if (String(post.id) !== targetPostKey) return false;
      if (targetSource && post.source !== targetSource) return false;
      return true;
    });

    const scrollToTarget = () => {
      const target = document.getElementById(targetId);
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    const syncHash = () => {
      if (location.hash === targetHash) return;
      navigate(
        { pathname: location.pathname, search: location.search, hash: targetId },
        { replace: true }
      );
    };

    if (existingPost) {
      hashHandledRef.current = targetStateKey;
      syncHash();
      scrollToTarget();
      return;
    }

    const fetchKey = `${targetSource ?? "any"}:${targetPostKey}`;
    if (hashFetchRef.current === fetchKey) return;
    hashFetchRef.current = fetchKey;
    void (async () => {
      const loaded = await fetchPostByTarget(targetPostKey, targetSource);
      hashFetchRef.current = null;
      if (!loaded) return;
      hashHandledRef.current = targetStateKey;
      syncHash();
      scrollToTarget();
    })();
  }, [
    categorizedPosts.ordered,
    fetchPostByTarget,
    location.hash,
    location.key,
    location.pathname,
    location.search,
    navigate,
    postFilter,
    sharedPostTarget,
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

  const logCheckInEntry = useCallback(
    (entry: CheckInEntry) => {
      setGoalsState((prev) => {
        const next: GoalsState = {
          ...prev,
          checkIns: [entry, ...(prev.checkIns || [])].slice(0, 50),
        };
        saveGoalsState(goalsStorageKey, next);
        return next;
      });
    },
    [goalsStorageKey]
  );

  const createPost = async () => {
    const sanitized = sanitizePostText(formContent);
    const content = sanitized.trim();
    if (!content && formFiles.length === 0) {
      setFormError("Add a message or a photo/video to post.");
      return;
    }
    const isCheckInPost =
      postSignalTag === "check-in" || postSignalTag === "support-request";
    const goalSelection = checkInGoal.trim();
    const postToTrustedCircle = isCheckInPost && checkInTarget === "trusted";
    if (postToTrustedCircle && !checkInGroupId) {
      setFormError("Choose a trusted circle for this check-in.");
      return;
    }
    if (!postToTrustedCircle && postVisibility === "trusted" && !postTrustedCircleId) {
      setFormError("Choose a trusted circle for this post.");
      return;
    }
    if (!postToTrustedCircle && feedbackAudience === "specific" && !feedbackTargetId) {
      setFormError("Choose a friend for a specific feedback request.");
      return;
    }

    const url = extractFirstUrl(content);
    const previewTitle = linkPreview?.url === url ? linkPreview.title : undefined;
    const derivedTitle =
      previewTitle || (url ? hostnameFor(url) : "") || content || "Post";
    const contentWithGoal =
      isCheckInPost && goalSelection && !/^\s*goal\s*:/i.test(content)
        ? content
          ? `Goal: ${goalSelection}\n\n${content}`
          : `Goal: ${goalSelection}`
        : content;

    if (formFiles.length > MAX_POST_MEDIA_FILES) {
      setFormError(`You can upload up to ${MAX_POST_MEDIA_FILES} files at once.`);
      return;
    }

    for (const file of formFiles) {
      if (!isVideoFile(file) && !isImageFile(file)) {
        setFormError("Only images or videos are allowed.");
        return;
      }
      const isVideo = isVideoFile(file);
      const maxBytes = isVideo ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
      const maxLabel = isVideo ? MAX_VIDEO_UPLOAD_LABEL : MAX_UPLOAD_LABEL;
      if (file.size > maxBytes) {
        setFormError(`Media files must be under ${maxLabel}.`);
        return;
      }
    }

    setFormError(null);
    setSubmitting(true);
    try {
      let uploadedIds: number[] = [];

      if (formFiles.length) {
        const fd = new FormData();
        formFiles.forEach((file) => fd.append("files", file));
        const uploadRes = await api.post("/upload", fd);
        uploadedIds = (uploadRes.data ?? [])
          .map((item: { id?: number }) => item?.id)
          .filter((id: number | undefined): id is number => Number.isFinite(id));
      }

      const resolvedSignalTag = postSignalTag === "none" ? undefined : postSignalTag;

      const effectiveVisibility = postToTrustedCircle ? "trusted" : postVisibility;
      const trustedCircleSelection = postToTrustedCircle
        ? checkInGroupId
        : postTrustedCircleId;
      const trustedCircleId =
        effectiveVisibility === "trusted" && trustedCircleSelection !== ""
          ? Number(trustedCircleSelection)
          : undefined;

      await api.post("/users-posts", {
        data: {
          Title: String(derivedTitle).slice(0, 80) || (isCheckInPost ? "Check-in" : "Post"),
          Users_Content: contentWithGoal,
          owner: user?.id,
          Users_Pictures: uploadedIds.length ? uploadedIds : undefined,
          visibility: effectiveVisibility,
          trustedCircle: trustedCircleId,
          signalTag: resolvedSignalTag,
          feedbackAudience: postToTrustedCircle ? "none" : feedbackAudience,
          feedbackTarget:
            !postToTrustedCircle && feedbackAudience === "specific"
              ? feedbackTargetId
              : undefined,
        },
      });

      if (isCheckInPost) {
        const goalLabel = checkInGoal.trim() || "General";
        const groupName = postToTrustedCircle
          ? trustedCircleOptions.find(
              (group) => group.id === Number(checkInGroupId)
            )?.name
          : undefined;
        const entryId =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}`;
        const feedTarget = postVisibility === "private" ? "private" : "feed";
        logCheckInEntry({
          id: entryId,
          createdAt: new Date().toISOString(),
          type: postSignalTag === "support-request" ? "support-request" : "check-in",
          goal: goalLabel,
          note: content || String(derivedTitle),
          target: postToTrustedCircle ? "trusted" : feedTarget,
          groupId: postToTrustedCircle ? Number(checkInGroupId) : undefined,
          groupName,
        });
        bumpStat(postSignalTag === "support-request" ? "supportRequests" : "checkIns", 1);
      }

      setFormContent("");
      setFormFiles([]);
      setLinkPreview(null);
      setLinkPreviewError(null);
      setFeedbackAudience("none");
      setFeedbackTargetId(null);
      setPostSignalTag("none");
      setPostTemplateId("");
      setCheckInGoal("");
      setCheckInTarget("feed");
      setCheckInGroupId("");
      setPostTrustedCircleId("");
      setComposerExpanded(false);
      setComposerOpen(false);
      setCheckInModalOpen(false);
      pushImpactNotice("Post created successfully.");
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

  const pushImpactNotice = useCallback(
    (message: string) => {
      setImpactNotice(message);
      if (impactTimeoutRef.current) {
        window.clearTimeout(impactTimeoutRef.current);
      }
      impactTimeoutRef.current = window.setTimeout(() => {
        setImpactNotice(null);
      }, 3200);
    },
    [setImpactNotice]
  );

  const deletePost = async (post: NormalizedPost) => {
    if (post.source !== "user") return;
    if (!pendingDeletePost || pendingDeletePost.id !== post.id) {
      setPendingDeletePost(post);
      return;
    }
    setPendingDeletePost(null);
    const postKey = String(post.id);
    try {
      const uniqueAttempts = buildUserPostPathCandidates(post);

      let removed = false;
      for (const path of uniqueAttempts) {
        try {
          await api.delete(path);
          removed = true;
          break;
        } catch (err: unknown) {
          if (axios.isAxiosError(err) && err.response?.status === 404) {
            continue;
          }
          throw err;
        }
      }

      if (!removed) {
        setError("Failed to delete post");
        return;
      }

      setPosts((prev) => ({
        ...prev,
        user: prev.user.filter((entry) => {
          const record = asRecord(entry);
          const attrs = normalize(entry);
          const rawId =
            record.id ?? record.documentId ?? attrs.id ?? attrs.documentId ?? undefined;
          return rawId === undefined || String(rawId) !== postKey;
        }),
      }));
      if (editingPostId === postKey) {
        cancelEditPost();
      }
      if (shareMenuFor === postKey) {
        setShareMenuFor(null);
      }
      if (activePostKey === postKey) {
        setActivePostKey(null);
      }
      pushImpactNotice("Post deleted.");
    } catch (err) {
      console.error("Delete post failed", err);
      setActionError("Failed to delete post");
    }
  };

  const updateUserPostEntry = useCallback(
    (postKey: string, nextTitle: string, nextContent: string) => {
      setPosts((prev) => ({
        ...prev,
        user: prev.user.map((entry) => {
          const record = asRecord(entry);
          const attrs = normalize(entry);
          const rawId =
            record.id ?? record.documentId ?? attrs.id ?? attrs.documentId ?? undefined;
          if (rawId === undefined || String(rawId) !== postKey) return entry;
          if (isRecord(record.attributes)) {
            return {
              ...record,
              attributes: {
                ...record.attributes,
                Title: nextTitle,
                Users_Content: nextContent,
                title: nextTitle,
                content: nextContent,
              },
            };
          }
          if (isRecord(record)) {
            return {
              ...record,
              Title: nextTitle,
              Users_Content: nextContent,
              title: nextTitle,
              content: nextContent,
            };
          }
          return entry;
        }),
      }));
    },
    []
  );

  const cancelEditPost = useCallback(() => {
    setEditingPostId(null);
    setEditPostTitle("");
    setEditPostContent("");
    setEditMediaItems([]);
    setEditMediaPostId(null);
    setEditMediaRemovingId(null);
  }, []);

  const updatePostMediaEntry = useCallback(
    (postKey: string, nextItems: PostMediaItem[]) => {
      setPosts((prev) => ({
        ...prev,
        user: prev.user.map((entry) => {
          const record = asRecord(entry);
          const attrs = normalize(entry);
          const rawId =
            record.id ?? record.documentId ?? attrs.id ?? attrs.documentId ?? undefined;
          if (rawId === undefined || String(rawId) !== postKey) return entry;
          const nextMedia = nextItems.map((item) => ({ id: item.id, url: item.url }));
          if (isRecord(record.attributes)) {
            return {
              ...record,
              attributes: { ...record.attributes, Users_Pictures: nextMedia },
            };
          }
          return { ...record, Users_Pictures: nextMedia };
        }),
      }));
    },
    []
  );

  const removePostMediaItem = useCallback(
    async (post: NormalizedPost, item: PostMediaItem) => {
      if (!user) {
        setActionError("Please log in to edit posts.");
        return;
      }
      if (post.source !== "user" || post.ownerId !== user.id) {
        setActionError("You can only edit your own posts.");
        return;
      }
      const postKey = String(post.id);
      if (editMediaRemovingId) return;
      const currentItems =
        editMediaPostId === postKey && editMediaItems.length
          ? editMediaItems
          : post.mediaItems || [];
      const remainingItems = currentItems.filter((entry) => entry.id !== item.id);

      setEditMediaRemovingId(item.id);
      setActionError(null);
      try {
        const uniqueAttempts = buildUserPostPathCandidates(post);

        let updated = false;
        for (const path of uniqueAttempts) {
          try {
            await api.put(path, {
              data: { Users_Pictures: remainingItems.map((entry) => entry.id) },
            });
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
          setActionError("Failed to update post media.");
          return;
        }

        updatePostMediaEntry(postKey, remainingItems);
        setEditMediaItems(remainingItems);
        pushImpactNotice("Media removed.");
      } catch (err: unknown) {
        const msg = axios.isAxiosError(err)
          ? err.response?.data?.error?.message ||
            err.response?.data?.message ||
            "Failed to update post media."
          : "Failed to update post media.";
        setActionError(String(msg));
      } finally {
        setEditMediaRemovingId(null);
      }
    },
    [
      editMediaItems,
      editMediaPostId,
      editMediaRemovingId,
      pushImpactNotice,
      updatePostMediaEntry,
      user,
    ]
  );

  const saveUserPost = useCallback(
    async (post: NormalizedPost) => {
      if (!user) {
        setActionError("Please log in to edit posts.");
        return;
      }
      if (post.source !== "user" || post.ownerId !== user.id) {
        setActionError("You can only edit your own posts.");
        return;
      }
      const postKey = String(post.id);
      const nextContent = sanitizePostText(editPostContent).trim();
      const nextTitleInput = editPostTitle.trim();
      const finalTitle = (nextTitleInput || post.title || "Post").slice(0, 80);
      if (post.title === finalTitle && post.content === nextContent) {
        cancelEditPost();
        return;
      }

      setPostEditing((prev) => ({ ...prev, [postKey]: true }));
      setActionError(null);
      try {
        const uniqueAttempts = buildUserPostPathCandidates(post);

        let updated = false;
        for (const path of uniqueAttempts) {
          try {
            await api.put(path, {
              data: { Title: finalTitle, Users_Content: nextContent },
            });
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
          setActionError("Failed to update post.");
          return;
        }

        updateUserPostEntry(postKey, finalTitle, nextContent);
        cancelEditPost();
        pushImpactNotice("Post updated.");
      } catch (err: unknown) {
        const msg = axios.isAxiosError(err)
          ? err.response?.data?.error?.message ||
            err.response?.data?.message ||
            "Failed to update post."
          : "Failed to update post.";
        setActionError(String(msg));
      } finally {
        setPostEditing((prev) => ({ ...prev, [postKey]: false }));
      }
    },
    [
      cancelEditPost,
      editPostContent,
      editPostTitle,
      pushImpactNotice,
      updateUserPostEntry,
      user,
    ]
  );

  const buildShareUrl = useCallback((post: NormalizedPost) => {
    if (typeof window === "undefined") return "";
    const origin = String(window.location.origin || "").trim().replace(/\/+$/, "");
    const configuredBase = String(import.meta.env.VITE_PUBLIC_SITE_URL || "")
      .trim()
      .replace(/\/+$/, "");
    const base = /^https?:\/\//i.test(origin)
      ? origin
      : /^https?:\/\//i.test(configuredBase)
      ? configuredBase
      : "";
    if (!base) return "";
    const configuredApi = String(import.meta.env.VITE_API_URL || "")
      .trim()
      .replace(/\/+$/, "");
    const resolveShareApiBase = () => {
      if (!configuredApi) return `${base}/api`;
      if (/^https?:\/\//i.test(configuredApi)) {
        return /\/api$/i.test(configuredApi) ? configuredApi : `${configuredApi}/api`;
      }
      const normalizedPath = /\/api$/i.test(configuredApi)
        ? configuredApi
        : `${configuredApi}/api`;
      const path = normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`;
      return `${base}${path}`;
    };
    const shareApiBase = resolveShareApiBase();
    const shareId = String(post.documentId ?? post.numericId ?? post.id ?? "").trim();
    if (!shareId) return "";
    const params = new URLSearchParams();
    params.set("source", post.source);
    params.set("id", shareId);
    params.set("site", base);
    return `${shareApiBase}/share/post?${params.toString()}`;
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
  const updatePostReactions = useCallback(
    (
      source: NormalizedPost["source"],
      postKey: string,
      reactionCounts: ReactionCounts,
      myReaction: string | null
    ) => {
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
              attributes: {
                ...record.attributes,
                reactionCounts,
                myReaction,
              },
            };
          }
          return { ...record, reactionCounts, myReaction };
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
    [bumpStat, pushImpactNotice, pushShareNotice, updatePostMetric, userId]
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

  const updateCommentBody = useCallback(
    async (comment: CommentItem, nextBody: string) => {
      const trimmed = nextBody.trim();
      if (!trimmed) {
        setError("Comment cannot be empty.");
        return false;
      }
      setError(null);
      const numericId =
        comment.numericId ?? (typeof comment.id === "number" ? comment.id : Number(comment.id));
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

      setPosts((prev) => ({
        ...prev,
        comments: (prev.comments ?? []).map((entry) => {
          const record = asRecord(entry);
          const attrs = normalize(entry);
          const entryId = record.id ?? attrs.id;
          const entryDoc = record.documentId ?? attrs.documentId;
          const shouldUpdate =
            (entryId !== undefined && matchIds.has(String(entryId))) ||
            (entryDoc !== undefined && matchIds.has(String(entryDoc)));
          if (!shouldUpdate) return entry;
          if (isRecord(record.attributes)) {
            return {
              ...record,
              attributes: {
                ...record.attributes,
                body: trimmed,
                updatedAt: new Date().toISOString(),
              },
            };
          }
          if (isRecord(record)) {
            return { ...record, body: trimmed, updatedAt: new Date().toISOString() };
          }
          return entry;
        }),
      }));

      pushImpactNotice("Comment updated.");
      return true;
    },
    [pushImpactNotice]
  );

  const handleReaction = useCallback(
    async (post: NormalizedPost, postKey: string, emoji: string) => {
      if (post.source !== "user" && post.source !== "group" && post.source !== "admin") {
        pushShareNotice(postKey, "Reactions are not available here.");
        return;
      }
      if (!REACTION_VALUES.has(emoji)) {
        pushShareNotice(postKey, "Unsupported reaction.");
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
        const payloadLikes = Number(payload?.likes);
        const nextLikes = Number.isFinite(payloadLikes)
          ? payloadLikes
          : Number(post.likes ?? 0) + 1;
        if (Number.isFinite(payloadLikes)) {
          updatePostMetric(post.source, postKey, "likes", nextLikes);
        }
        const counts = normalizeReactionCounts(payload?.reactionCounts, nextLikes);
        const reactionValue = normalizeReactionValue(payload?.myReaction ?? emoji);
        updatePostReactions(post.source, postKey, counts, reactionValue);
        setReactionPickerFor(null);
        if (payload?.alreadyReacted) {
          pushShareNotice(
            postKey,
            payload?.updated ? `Reaction updated ${emoji}` : "You already reacted."
          );
        } else {
          pushShareNotice(postKey, `You reacted ${emoji}`);
        }
        if (post.ownerId && post.ownerId !== userId) {
          bumpStat("encouragements", 1);
          pushImpactNotice("Thanks for lifting someone up today.");
        }
      } catch (err) {
        console.error("Reaction failed", err);
        pushShareNotice(postKey, "Unable to react right now.");
      }
    },
    [pushShareNotice, updatePostMetric, updatePostReactions]
  );

  const toggleComments = useCallback((postKey: string) => {
    setOpenCommentsFor((prev) => ({ ...prev, [postKey]: !prev[postKey] }));
    setShareMenuFor(null);
    setPostMenuFor(null);
    setReactionPickerFor(null);
    setReactionBreakdownFor(null);
  }, []);

  const openSupportOptions = useCallback((postKey: string) => {
    setOpenCommentsFor((prev) => ({ ...prev, [postKey]: true }));
    setShareMenuFor(null);
    setPostMenuFor(null);
    setReactionPickerFor(null);
    setReactionBreakdownFor(null);
  }, []);

  const clearCommentAttachments = useCallback((commentKey: string | number) => {
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
      if (typeof URL !== "undefined") {
        urls.forEach((url) => URL.revokeObjectURL(url));
      }
      delete next[commentKey];
      return next;
    });
  }, []);

  const handleCommentFilesChange = useCallback(
    (commentKey: string | number, files: FileList | null) => {
      if (!files || files.length === 0) return;
      const selected = Array.from(files).filter((file) => isImageFile(file));
      if (selected.length === 0) {
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
        if (typeof URL !== "undefined") {
          urls.forEach((url) => URL.revokeObjectURL(url));
        }
        next[commentKey] = limited.map((file) => URL.createObjectURL(file));
        return next;
      });
    },
    [setError]
  );

  const removeCommentAttachment = useCallback(
    (commentKey: string | number, index: number) => {
      setCommentMediaFiles((prev) => {
        const current = prev[commentKey];
        if (!current) return prev;
        const nextFiles = current.filter((_, idx) => idx !== index);
        const next = { ...prev };
        if (nextFiles.length) {
          next[commentKey] = nextFiles;
        } else {
          delete next[commentKey];
        }
        return next;
      });
      setCommentMediaPreviews((prev) => {
        const current = prev[commentKey];
        if (!current) return prev;
        const nextUrls = current.filter((_, idx) => idx !== index);
        if (typeof URL !== "undefined" && current[index]) {
          URL.revokeObjectURL(current[index]);
        }
        const next = { ...prev };
        if (nextUrls.length) {
          next[commentKey] = nextUrls;
        } else {
          delete next[commentKey];
        }
        return next;
      });
    },
    []
  );

  const toggleShareMenu = useCallback((postKey: string) => {
    setShareMenuFor((prev) => (prev === postKey ? null : postKey));
    setPostMenuFor(null);
    setReactionPickerFor(null);
    setReactionBreakdownFor(null);
  }, []);

  const togglePostMenu = useCallback((postKey: string) => {
    setPostMenuFor((prev) => (prev === postKey ? null : postKey));
    setShareMenuFor(null);
    setReactionPickerFor(null);
    setReactionBreakdownFor(null);
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
      const primaryMediaUrl = getPostMediaUrls(post, { preferFull: true })[0];
      if (
        descriptor === "with a picture" &&
        primaryMediaUrl &&
        !isVideoUrl(primaryMediaUrl)
      ) {
        if (typeof window !== "undefined" && !window.confirm("Download this picture?")) {
          return;
        }
        if (typeof document === "undefined") return;
        const link = document.createElement("a");
        link.href = primaryMediaUrl;
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

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") {
      const eager: Record<string, boolean> = {};
      orderedPosts.forEach((post) => {
        eager[String(post.id)] = true;
      });
      setVisiblePostKeys((prev) => ({ ...eager, ...prev }));
      return;
    }
    postObserverRef.current?.disconnect();
    postObserverRef.current = new IntersectionObserver(
      (entries) => {
        setVisiblePostKeys((prev) => {
          let changed = false;
          const next = { ...prev };
          entries.forEach((entry) => {
            if (!entry.isIntersecting && entry.intersectionRatio <= 0) return;
            const key = postObserverTargetsRef.current.get(entry.target);
            if (!key || next[key]) return;
            next[key] = true;
            changed = true;
          });
          return changed ? next : prev;
        });
      },
      { rootMargin: "220px 0px", threshold: 0.12 }
    );
    postObserverTargetsRef.current.forEach((_key, node) => {
      postObserverRef.current?.observe(node);
    });
    return () => {
      postObserverRef.current?.disconnect();
    };
  }, [orderedPosts]);

  const registerPostNode = useCallback((postKey: string) => {
    return (node: HTMLElement | null) => {
      const map = postObserverTargetsRef.current;
      for (const [element, key] of map.entries()) {
        if (key === postKey && element !== node) {
          postObserverRef.current?.unobserve(element);
          map.delete(element);
        }
      }
      if (!node) return;
      map.set(node, postKey);
      postObserverRef.current?.observe(node);
    };
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

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(".post-action-group") ||
        target.closest(".post-action-counts") ||
        target.closest(".post-menu-wrapper") ||
        target.closest(".popup-modal")
      )
        return;
      setShareMenuFor(null);
      setPostMenuFor(null);
      setReactionPickerFor(null);
      setReactionBreakdownFor(null);
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
    if (!goalsModalOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setGoalsModalOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goalsModalOpen]);

  useEffect(() => {
    if (!activePostKey && !goalsModalOpen) return;
    if (typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [activePostKey, goalsModalOpen]);

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

  useEffect(() => {
    if (!loading) {
      setHasLoadedOnce(true);
    }
  }, [loading]);

  const activePostMeta = activePost
    ? extractCheckInGoal(activePost.content, activePost.signalTag)
    : { goal: "", content: "" };
  const activePostContent = activePost ? activePostMeta.content : "";
  const activePostGoal = activePost ? activePostMeta.goal : "";
  const activePostUrl = activePost ? extractFirstUrl(activePostContent) : "";
  const activePreview = activePostUrl ? previewCache[activePostUrl] : undefined;
  const activePreviewImage = activePreview?.image;
  const activeIsYoutube = activePostUrl ? isYoutubeUrl(activePostUrl) : false;
  const activeMediaUrls = activePost
    ? getPostMediaUrls(activePost, { preferFull: true })
    : [];
  const activeMediaLayout = getMediaGridLayout(activeMediaUrls.length);
  const activeDescriptor = activePost
    ? mediaDescriptor(activeMediaUrls[0], Boolean(activePostUrl))
    : "";
  const activeFeedbackLabel = activePost ? feedbackLabelFor(activePost) : "";
  const activeAuthorLabel = activePost?.ownerName || "User";
  const isActiveDescriptorActionable =
    activeDescriptor === "with a picture" || activeDescriptor === "with a link";
  const showActivePreviewMedia = Boolean(
    activePost &&
      activeMediaUrls.length === 0 &&
      activePreviewImage &&
      !activeIsYoutube
  );
  const modalTitleId = activePostKey ? `post-modal-title-${activePostKey}` : undefined;
  const showInitialLoader = loading && !hasLoadedOnce;

  return (
    <div
      className={`dashboard-shell${desktopSidebarCollapsed ? " is-sidebar-collapsed" : ""}`}
      style={getBackgroundStyle("dashboard")}
    >
      {showInitialLoader && <FullScreenLoader label="Loading dashboard" />}
      <Sidebar
        active="dashboard"
        enableDesktopCollapse
        desktopCollapsed={desktopSidebarCollapsed}
        onDesktopCollapsedChange={setDesktopSidebarCollapsed}
      />

      <div className="main-content">
        {user && (
          <div className="topbar-greeting">
            <span className="topbar-greeting-title">{greetingLine}</span>
            <span className="topbar-greeting-sub">{motivation}</span>
          </div>
        )}
      {loading && <p className="status">Loading posts…</p>}
      {error && <p className="status status-error">{error}</p>}

      {!loading && !error && (
          <>
            <div className="panel-grid">
              <section
                className={`panel post-composer${isComposerOpen ? "" : " is-collapsed"}${
                  formDragActive ? " is-dragover" : ""
                }`}
                id="post-composer"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "copy";
                  if (!isComposerOpen) {
                    setComposerOpen(true);
                  }
                  setFormDragActive(true);
                }}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setFormDragActive(true);
                }}
                onDragLeave={(event) => {
                  if (
                    event.currentTarget.contains(event.relatedTarget as Node | null)
                  ) {
                    return;
                  }
                  setFormDragActive(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setFormDragActive(false);
                  const files = event.dataTransfer.files;
                  if (!files || files.length === 0) {
                    return;
                  }
                  if (!isComposerOpen) {
                    setComposerOpen(true);
                  }
                  setComposerExpanded(true);
                  handleComposerFiles(files);
                }}
              >
              {isComposerOpen && (
                <div className="panel-header post-composer__header">
                  <div className="post-composer__header-text">
                    <p className="eyebrow">Create</p>
                    <h3>New Post</h3>
                    <p className="panel-sub">Let Your Friends Know What You're Up To!</p>
                  </div>
                  {visibilityChips.length > 0 && (
                    <div className="post-composer__header-chips">
                      {visibilityChips.map((chip) => (
                        <span key={chip.key} className="post-composer__summary-chip">
                          {chip.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
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
                  {showComposerAdvanced && (
                    <div className="post-composer__advanced" id="post-composer-advanced">
                      <div className="post-composer__toolbar">
                        <div className="post-composer__template">
                          <span className="post-template-label">Template</span>
                          <div className="post-composer__select">
                            <select
                              className="auth-input post-template-select"
                              value={postTemplateId}
                              onChange={(e) => handleTemplateSelect(e.target.value)}
                            >
                              <option value="">No template</option>
                              {POST_TEMPLATES.map((template) => (
                                <option key={template.id} value={template.id}>
                                  {template.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <div className="post-composer__signal">
                          <span className="post-template-label">Post type</span>
                          <div className="post-composer__select post-composer__select--sm">
                            <select
                              className="auth-input post-feedback-select"
                              value={postSignalTag}
                              onChange={(e) =>
                                setPostSignalTag(e.target.value as SignalTag)
                              }
                            >
                              {SIGNAL_TAGS.map((tag) => (
                                <option key={tag.value} value={tag.value}>
                                  {tag.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                      {showCheckInOptions && (
                        <div className="post-composer__checkin">
                          <div className="post-composer__checkin-field">
                            <span className="post-template-label">Goal (optional)</span>
                            <select
                              className="auth-input post-feedback-select"
                              value={checkInGoal}
                              onChange={(e) => setCheckInGoal(e.target.value)}
                            >
                              <option value="">No goal selected</option>
                              {availableGoals.map((goal) => (
                                <option key={goal} value={goal}>
                                  {goal}
                                </option>
                              ))}
                            </select>
                             {availableGoals.length === 0 && (
                               <span className="post-composer__hint">
                                 Add goals in Goals &amp; Trackers to pick one here.
                               </span>
                             )}
                          </div>
                          <div className="post-composer__checkin-field">
                            <span className="post-template-label">Share</span>
                            <select
                              className="auth-input post-feedback-select"
                              value={checkInTarget}
                              onChange={(e) =>
                                setCheckInTarget(e.target.value as "feed" | "trusted")
                              }
                            >
                              <option value="feed">My feed</option>
                              <option value="trusted">Trusted circle</option>
                            </select>
                          </div>
                          {checkInTarget === "trusted" && (
                            <div className="post-composer__checkin-field">
                              <span className="post-template-label">Trusted circle</span>
                              <select
                                className="auth-input post-feedback-select"
                                value={checkInGroupId}
                                onChange={(e) =>
                                  setCheckInGroupId(
                                    e.target.value ? Number(e.target.value) : ""
                                  )
                                }
                              >
                                <option value="">Select a circle</option>
                                {trustedCircleOptions.map((group) => (
                                  <option key={group.id} value={group.id}>
                                    {group.name}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                className="post-composer__hint-link"
                                onClick={() => navigate("/friends")}
                              >
                                Set Trusted Friends
                              </button>
                              {trustedCircleOptions.length === 0 && (
                                <span className="post-composer__hint">
                                  Create a trusted circle in My Trusted Circles to use it here.
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="post-composer__textarea-wrap">
                    <textarea
                      className="auth-input"
                      value={formContent}
                      onChange={(e) => {
                        const nextValue = sanitizePostText(e.target.value);
                        setFormContent(nextValue);
                        setFormError(null);
                      }}
                      onFocus={() => {
                        if (!isComposerOpen) {
                          setComposerOpen(true);
                        }
                      }}
                      placeholder="What's on your mind?"
                      rows={showComposerAdvanced ? 4 : isComposerOpen ? 3 : 1}
                    />
                    <button
                      type="button"
                      className="post-composer__goals-trigger"
                      title="Set Goals and Trackers"
                      aria-label="Set Goals and Trackers"
                      onClick={() => setGoalsModalOpen(true)}
                    >
                      <Target size={18} />
                    </button>
                  </div>
                  {isComposerOpen && (
                    <>
                      <div className="post-composer__summary">
                        <button
                          className="post-composer__toggle"
                          type="button"
                          onClick={() => setComposerExpanded((prev) => !prev)}
                          aria-controls="post-composer-advanced"
                          aria-expanded={showComposerAdvanced}
                          disabled={composerToggleDisabled}
                        >
                          <span>{composerToggleLabel}</span>
                          <span
                            className={`post-composer__chevron${
                              showComposerAdvanced ? " is-open" : ""
                            }`}
                            aria-hidden="true"
                          >
                            <svg viewBox="0 0 20 20">
                              <path
                                d="M5 7.5 10 12.5 15 7.5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.6"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        </button>
                        {detailChips.length > 0 && (
                          <div className="post-composer__summary-chips">
                            {detailChips.map((chip) => (
                              <span key={chip.key} className="post-composer__summary-chip">
                                {chip.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      {linkPreviewLoading && (
                        <span className="post-composer__hint">Loading preview...</span>
                      )}
                    </>
                  )}
                </div>
              </div>

              {isComposerOpen && (
                <>
                  {linkPreview && (
                    <LinkPreviewCard
                      preview={linkPreview}
                      url={linkPreview.url || extractFirstUrl(formContent)}
                    />
                  )}
                  {linkPreviewError && (
                    <p className="status status-error">{linkPreviewError}</p>
                  )}
                  {formFilePreviewUrls.length > 0 && (
                    <div className="post-composer__media-preview">
                      <div
                        className={`post-composer__media-grid${
                          formFilePreviewUrls.length === 1 ? " is-single" : ""
                        }`}
                      >
                        {formFilePreviewUrls.map((url, index) => {
                          const file = formFiles[index];
                          const isVideo = file ? isVideoFile(file) : false;
                          return (
                            <div
                              key={`${file?.name || "media"}-${index}`}
                              className="post-composer__media-thumb"
                            >
                              {isVideo ? (
                                <video muted playsInline preload="metadata">
                                  <source src={url} />
                                </video>
                              ) : (
                                <img
                                  src={url}
                                  alt="Upload preview"
                                  loading="lazy"
                                  decoding="async"
                                />
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {showComposerAdvanced && (
                <div className="post-composer__settings">
                  {showFeedOptions && (
                    <div className="post-composer__feedback">
                      <span className="post-feedback-label">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                          />
                          <circle cx="12" cy="12" r="3.2" fill="currentColor" />
                        </svg>
                        Post visibility
                      </span>
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
                          <option value="trusted">Trusted circle</option>
                          <option value="private">Private</option>
                        </select>
                        {postVisibility === "trusted" && (
                          <>
                          <select
                              className="auth-input post-feedback-select"
                              value={postTrustedCircleId}
                              onChange={(e) => {
                                const next = Number(e.target.value);
                                setPostTrustedCircleId(
                                  Number.isFinite(next) ? next : ""
                                );
                                setFormError(null);
                              }}
                            >
                              <option value="">Select a trusted circle</option>
                            {trustedCircleOptions.map((group) => (
                              <option key={group.id} value={group.id}>
                                {group.name}
                              </option>
                            ))}
                          </select>
                            <button
                              type="button"
                              className="post-composer__hint-link"
                              onClick={() => navigate("/friends")}
                            >
                              Set Trusted Friends
                            </button>
                            {trustedCircleOptions.length === 0 && (
                              <p className="status">
                                Create a trusted circle in My Trusted Circles to use this.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {showFeedOptions && (
                    <div className="post-composer__feedback">
                      <span className="post-feedback-label">
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path
                            d="M4 5.5h16a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H10l-4 3v-3H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2Z"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinejoin="round"
                          />
                        </svg>
                        Request feedback
                      </span>
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
                              setFeedbackTargetId(
                                Number.isFinite(nextId) ? nextId : null
                              );
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
                  )}
                      
                
                </div>
              )}

              {isComposerOpen && (
                <>
                  <div className="post-composer__actions">
                    <div className="post-composer__tools">
                      <label className="post-composer__tool">
                        <input
                          type="file"
                          accept="image/*,video/*"
                          multiple
                          onChange={(e) => {
                            const files = e.target.files;
                            handleComposerFiles(files);
                            e.target.value = "";
                          }}
                        />
                        <span>{formFiles.length ? "Change media" : "Add photo/video"}</span>
                      </label>
                      <span className="post-composer__file">
                        {formFiles.length
                          ? `${formFiles.length} file${formFiles.length === 1 ? "" : "s"} selected`
                          : "No media selected"}
                      </span>
                      {formFiles.length > 0 && (
                        <button
                          className="btn ghost"
                          type="button"
                          onClick={() => setFormFiles([])}
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
                </>
              )}
            </section>
            {/* <NewsWidget /> */}
          </div>

          {impactNotice && <div className="impact-notice">{impactNotice}</div>}

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
              <span className="posts-filter-label">Order</span>
              <select
                className="auth-input post-filter-select"
                value={postSort}
                onChange={(e) => setPostSort(e.target.value as PostSort)}
              >
                <option value="newest">Newest to oldest</option>
                <option value="oldest">Oldest to newest</option>
              </select>
            </div>
          </div>

          {featuredWins.length > 0 && (
            <section className="featured-wins">
              <div className="featured-wins__header">
                <h4>Featured wins</h4>
                <span>Celebrate progress</span>
              </div>
              <div className="featured-wins__grid">
                {featuredWins.map((post) => {
                  const fallbackUrl = extractFirstUrl(post.content);
                  const previewImage = fallbackUrl ? previewCache[fallbackUrl]?.image : "";
                  const primaryMediaUrl = getPostMediaUrls(post)[0];
                  const mediaUrl =
                    primaryMediaUrl ||
                    (isVideoUrl(fallbackUrl) || isImageUrl(fallbackUrl)
                      ? fallbackUrl
                      : previewImage);
                  return (
                  <div key={post.id} className="featured-wins__card">
                    {mediaUrl && (
                      <div className="featured-wins__media">
                        {isVideoUrl(mediaUrl) ? (
                          <video
                            muted
                            playsInline
                            preload="metadata"
                            style={{ width: "100%", height: "100%", objectFit: "cover" }}
                          >
                            <source src={mediaUrl} />
                          </video>
                        ) : (
                          <img
                            src={mediaUrl}
                            alt={post.title}
                            loading="lazy"
                            decoding="async"
                          />
                        )}
                      </div>
                    )}
                    <span className="featured-wins__badge">Win</span>
                    {(() => {
                      const structured = parseStructuredPost(post.content, post.signalTag);
                      if (!structured) {
                        return (
                          <>
                            <h5>{post.title}</h5>
                            <p className="post-body-text">{linkifyText(post.content)}</p>
                          </>
                        );
                      }
                      return (
                        <div className="post-structured">
                          {structured.rows.map((row) => (
                            <div key={row.label} className="post-structured__row">
                              <span className="post-structured__label">{row.label}</span>
                              <span
                                className={`post-structured__value${
                                  row.value ? "" : " is-empty"
                                }`}
                              >
                                {row.value || "Not added yet"}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                    <span className="featured-wins__meta">
                      {post.ownerName || "Member"}
                    </span>
                  </div>
                  );
                })}
              </div>
            </section>
          )}

          <div className="posts-grid">
            {orderedPosts.length === 0 && (
              <div className="empty-state">
                <p>No posts yet. Add one in Strapi to see it here.</p>
              </div>
            )}

            {orderedPosts.map((post, index) => {
              const { goal: checkInGoalLabel, content: displayContent } =
                extractCheckInGoal(post.content, post.signalTag);
              const postUrl = extractFirstUrl(displayContent);
              const preview = postUrl ? previewCache[postUrl] : undefined;
              const hasLink = Boolean(postUrl);
              const isYoutubeLink = postUrl ? isYoutubeUrl(postUrl) : false;
              const mediaUrls = getPostMediaUrls(post);
              const mediaCount = mediaUrls.length;
              const primaryMediaUrl = mediaUrls[0];
              const mediaLayout = getMediaGridLayout(mediaCount);
              const descriptor = mediaDescriptor(primaryMediaUrl, hasLink);
              const previewImage = preview?.image;
              const showPreviewMedia =
                mediaCount === 0 && !!previewImage && !isYoutubeLink;
              const supportReplies = supportRepliesForTag(post.signalTag);
              const supportLabel = formatSignalTag(post.signalTag);
              const supportLabelText =
                post.signalTag === "support-request"
                  ? "Support options"
                  : supportLabel
                  ? `${supportLabel} support`
                  : "Support options";
              const authorLabel = post.ownerName || "User";
              const canEdit = post.source === "user" && user?.id === post.ownerId;
              const feedbackLabel = feedbackLabelFor(post);
              const postKey = String(post.id);
              const isEditing = editingPostId === postKey;
              const isSavingPost = Boolean(postEditing[postKey]);
              const editableMediaItems =
                isEditing && editMediaPostId === postKey
                  ? editMediaItems
                  : post.mediaItems || [];
              const commentKey = String(post.numericId ?? post.id);
              const isCommentsOpen = Boolean(openCommentsFor[commentKey]);
              const commentAttachmentPreviews = commentMediaPreviews[commentKey] ?? [];
              const commentAttachmentFiles = commentMediaFiles[commentKey] ?? [];
              const closeCommentModal = () => {
                clearCommentAttachments(commentKey);
                setOpenCommentsFor((prev) => ({ ...prev, [commentKey]: false }));
              };
              const showShareMenu = shareMenuFor === postKey;
              const showPostMenu = postMenuFor === postKey;
              const shareUrl = buildShareUrl(post);
              const shareText = post.title
                ? `${authorLabel}: ${post.title}`
                : `${authorLabel} posted an update.`;
              const canShareExternally = isPubliclyShareablePost(post);
              const externalShareBlockMessage =
                post.source === "group"
                  ? "This group post is private. Only public posts can be shared externally."
                  : "Only public posts can be shared externally.";
              const encodedUrl = encodeURIComponent(shareUrl);
              const encodedText = encodeURIComponent(shareText);
              const likesCount = Number(post.likes ?? 0);
              const reactionCounts = normalizeReactionCounts(
                post.reactionCounts,
                likesCount
              );
              const myReaction = normalizeReactionValue(post.myReaction);
              const reactionTotalCount = REACTION_OPTIONS.reduce(
                (sum, option) => sum + Number(reactionCounts[option.key] || 0),
                0
              );
              const topReactionOptions = getTopReactionOptions(reactionCounts);
              const reactionBadgeOptions = topReactionOptions.length
                ? topReactionOptions
                : REACTION_OPTIONS.slice(0, 1);
              const isReactionPickerOpen = reactionPickerFor === postKey;
              const isReactionBreakdownOpen = reactionBreakdownFor === postKey;
              const hasOpenPopover =
                showShareMenu ||
                showPostMenu ||
                isReactionPickerOpen ||
                isReactionBreakdownOpen;
              const sharesCount = Number(post.shares ?? 0);
              const commentsCount = post.comments?.length ?? 0;
              const isDescriptorActionable =
                descriptor === "with a picture" || descriptor === "with a link";
              const isPostVisible = Boolean(visiblePostKeys[postKey]) || index < 3;
              const shouldRenderMedia = isPostVisible;

              return (
                <article
                  key={post.id}
                  id={`post-${postKey}`}
                  className={`post-card${hasOpenPopover ? " is-popover-open" : ""}${
                    post.signalTag === "support-request" ? " post-card--support" : ""
                  }${post.signalTag === "win" ? " post-card--win" : ""}`}
                  ref={registerPostNode(postKey)}
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
                  {post.signalTag && post.signalTag !== "none" && (
                      <>
                        {supportReplies.length > 0 ? (
                          <button
                            type="button"
                            className={`post-meta-tag post-meta-tag--signal post-meta-tag--${post.signalTag} post-meta-tag--action`}
                            onClick={(event) => {
                              event.stopPropagation();
                              openSupportOptions(commentKey);
                            }}
                            aria-label={`Support ${formatSignalTag(post.signalTag)} post`}
                          >
                            {formatSignalTag(post.signalTag)}
                          </button>
                        ) : (
                          <span
                            className={`post-meta-tag post-meta-tag--signal post-meta-tag--${post.signalTag}`}
                          >
                            {formatSignalTag(post.signalTag)}
                          </span>
                        )}
                      </>
                    )}
                    {post.visibility === "trusted" && (
                      <span className="post-meta-tag post-meta-tag--trusted">
                        {post.trustedCircleName
                          ? `Circle: ${post.trustedCircleName}`
                          : "Trusted circle"}
                      </span>
                    )}
                  </div>

                  {canEdit && !isEditing && (
                    <div className="post-menu-wrapper">
                      <button
                        className="post-menu-trigger"
                        type="button"
                        aria-haspopup="menu"
                        aria-expanded={showPostMenu}
                        aria-label="Open post options"
                        onClick={(event) => {
                          event.stopPropagation();
                          togglePostMenu(postKey);
                        }}
                      >
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <circle cx="5" cy="12" r="2" />
                          <circle cx="12" cy="12" r="2" />
                          <circle cx="19" cy="12" r="2" />
                        </svg>
                      </button>
                      {showPostMenu && (
                        <div className="post-menu" role="menu">
                          <button
                            className="post-menu-item"
                            type="button"
                            role="menuitem"
                            onClick={(event) => {
                              event.stopPropagation();
                              setEditingPostId(postKey);
                              setEditPostTitle(post.title);
                              setEditPostContent(post.content);
                              setEditMediaItems(post.mediaItems || []);
                              setEditMediaPostId(postKey);
                              setShareMenuFor(null);
                              setPostMenuFor(null);
                              setActionError(null);
                            }}
                          >
                            Edit
                          </button>
                          <button
                            className="post-menu-item is-danger"
                            type="button"
                            role="menuitem"
                            onClick={(event) => {
                              event.stopPropagation();
                              setPostMenuFor(null);
                              deletePost(post);
                            }}
                            disabled={isSavingPost}
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {mediaCount > 0 ? (
                    mediaCount === 1 ? (
                      shouldRenderMedia ? (
                        <div className="post-media">
                          {primaryMediaUrl && isVideoUrl(primaryMediaUrl) ? (
                            <video
                              controls
                              playsInline
                              preload="metadata"
                              style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            >
                              <source src={primaryMediaUrl} />
                            </video>
                          ) : (
                            <img
                              src={primaryMediaUrl}
                              alt={post.title}
                              loading="lazy"
                              decoding="async"
                            />
                          )}
                        </div>
                      ) : (
                        <div className="post-media placeholder">
                          <span>Loading media…</span>
                          <span className="dots" aria-hidden="true" />
                        </div>
                      )
                    ) : shouldRenderMedia ? (
                      <div
                        className="post-media-grid"
                        style={{
                          gridTemplateColumns: `repeat(${mediaLayout.columns}, minmax(0, 1fr))`,
                          gridTemplateRows: `repeat(${mediaLayout.rows}, minmax(0, 1fr))`,
                        }}
                      >
                        {mediaUrls
                          .slice(
                            0,
                            mediaLayout.columns * mediaLayout.rows
                          )
                          .map((url, index) => (
                            <div key={`${url}-${index}`} className="post-media-grid__item">
                              {isVideoUrl(url) ? (
                                <video muted playsInline preload="metadata">
                                  <source src={url} />
                                </video>
                              ) : (
                                <img
                                  src={url}
                                  alt={post.title}
                                  loading="lazy"
                                  decoding="async"
                                />
                              )}
                            </div>
                          ))}
                      </div>
                    ) : (
                      <div className="post-media placeholder">
                        <span>Loading media…</span>
                        <span className="dots" aria-hidden="true" />
                      </div>
                    )
                  ) : showPreviewMedia ? (
                    shouldRenderMedia ? (
                      <div className="post-media link-preview-media">
                        <img
                          src={previewImage}
                          alt={preview?.title || post.title}
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    ) : (
                      <div className="post-media placeholder">
                        <span>Loading preview…</span>
                        <span className="dots" aria-hidden="true" />
                      </div>
                    )
                  ) : null}

                  <div className="post-body">
                    <div className="post-meta">
                      <div className="post-meta-right">
                        {feedbackLabel && (
                          <span className="post-feedback-tag">{feedbackLabel}</span>
                        )}
                        {post.createdAt && (
                          <span className="date">{formatDate(post.createdAt)}</span>
                        )}
                      </div>
                    </div>
                    {isEditing ? (
                      <div className="post-edit">
                        <input
                          className="auth-input post-edit-title"
                          value={editPostTitle}
                          onChange={(event) => setEditPostTitle(event.target.value)}
                          placeholder="Post title"
                        />
                        <textarea
                          className="auth-input post-edit-body"
                          rows={4}
                          value={editPostContent}
                          onChange={(event) =>
                            setEditPostContent(sanitizePostText(event.target.value))
                          }
                          placeholder="Update your post"
                        />
                        {editableMediaItems.length > 0 && (
                          <div className="post-edit-media">
                            {editableMediaItems.map((item) => (
                              <div key={item.id} className="post-edit-media__item">
                                {item.isVideo ? (
                                  <video muted playsInline preload="metadata">
                                    <source src={item.url} />
                                  </video>
                                ) : (
                                  <img src={item.url} alt={post.title} loading="lazy" />
                                )}
                                <button
                                  type="button"
                                  className="post-edit-media__remove"
                                  onClick={() => void removePostMediaItem(post, item)}
                                  disabled={editMediaRemovingId === item.id || isSavingPost}
                                  aria-label="Remove media"
                                >
                                  Remove
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        <div className="post-edit-actions">
                          <button
                            className="btn ghost"
                            type="button"
                            onClick={cancelEditPost}
                            disabled={isSavingPost}
                          >
                            Cancel
                          </button>
                          <button
                            className="btn primary"
                            type="button"
                            onClick={() => void saveUserPost(post)}
                            disabled={isSavingPost}
                          >
                            {isSavingPost ? "Saving..." : "Save changes"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {(() => {
                          const structured = parseStructuredPost(
                            displayContent,
                            post.signalTag
                          );
                          if (!structured) {
                            return (
                              <>
                                {checkInGoalLabel ? (
                                  <span className="post-meta-tag post-meta-tag--goal post-goal-tag">
                                    Goal: {checkInGoalLabel}
                                  </span>
                                ) : (
                                  <h3>{post.title}</h3>
                                )}
                                <p className="post-body-text">
                                  {linkifyText(displayContent)}
                                </p>
                              </>
                            );
                          }
                          return (
                            <>
                              {checkInGoalLabel && (
                                <span className="post-meta-tag post-meta-tag--goal post-goal-tag">
                                  Goal: {checkInGoalLabel}
                                </span>
                              )}
                              <div className="post-structured">
                                {structured.rows.map((row) => (
                                  <div key={row.label} className="post-structured__row">
                                    <span className="post-structured__label">
                                      {row.label}
                                    </span>
                                    <span
                                      className={`post-structured__value${
                                        row.value ? "" : " is-empty"
                                      }`}
                                    >
                                      {row.value || "Not added yet"}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </>
                          );
                        })()}
                        {preview && mediaCount === 0 && (
                          <LinkPreviewCard
                            preview={preview}
                            url={preview.url || postUrl}
                            compact
                          />
                        )}
                      </>
                    )}
                    <div className="post-actions">
                      <div
                        className={`post-action-counts post-action-counts--with-breakdown${
                          isReactionBreakdownOpen ? " is-open" : ""
                        }`}
                        role="button"
                        tabIndex={0}
                        aria-label="Show reaction breakdown"
                        aria-expanded={isReactionBreakdownOpen}
                        onClick={(event) => {
                          event.stopPropagation();
                          setReactionBreakdownFor((prev) =>
                            prev === postKey ? null : postKey
                          );
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== "Enter" && event.key !== " ") return;
                          event.preventDefault();
                          setReactionBreakdownFor((prev) =>
                            prev === postKey ? null : postKey
                          );
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
                                key={`${postKey}-reaction-chip-${option.key}-${index}`}
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
                            <div className="post-reaction-breakdown-row is-total">
                              <span>Total reactions</span>
                              <strong>{reactionTotalCount}</strong>
                            </div>
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
                          onClick={(event) => {
                            event.stopPropagation();
                            setReactionPickerFor((prev) =>
                              prev === postKey ? null : postKey
                            );
                          }}
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
                          aria-haspopup="dialog"
                          onClick={() => toggleShareMenu(postKey)}
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
                                  onClick={() => {
                                    void handleNativeShare(post, postKey, shareUrl, shareText);
                                    setShareMenuFor(null);
                                  }}
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
                              href={`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`}
                              onClick={(event) => {
                                if (!canShareExternally) {
                                  event.preventDefault();
                                  pushShareNotice(postKey, externalShareBlockMessage);
                                  return;
                                }
                                setShareMenuFor(null);
                                void trackShare(post, postKey);
                              }}
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
                              onClick={(event) => {
                                if (!canShareExternally) {
                                  event.preventDefault();
                                  pushShareNotice(postKey, externalShareBlockMessage);
                                  return;
                                }
                                setShareMenuFor(null);
                                void trackShare(post, postKey);
                              }}
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
                              onClick={(event) => {
                                if (!canShareExternally) {
                                  event.preventDefault();
                                  pushShareNotice(postKey, externalShareBlockMessage);
                                  return;
                                }
                                setShareMenuFor(null);
                                void trackShare(post, postKey);
                              }}
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
                              onClick={(event) => {
                                if (!canShareExternally) {
                                  event.preventDefault();
                                  pushShareNotice(postKey, externalShareBlockMessage);
                                  return;
                                }
                                setShareMenuFor(null);
                                void trackShare(post, postKey);
                              }}
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
                              onClick={(event) => {
                                if (!canShareExternally) {
                                  event.preventDefault();
                                  pushShareNotice(postKey, externalShareBlockMessage);
                                  return;
                                }
                                setShareMenuFor(null);
                                void trackShare(post, postKey);
                              }}
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
                        </PopupModal>
                      </div>
                    </div>
                    </div>
                    {shareNotice[postKey] && (
                      <p className="post-action-notice">{shareNotice[postKey]}</p>
                    )}
                    <PopupModal
                      open={isCommentsOpen}
                      title="Comments"
                      onClose={closeCommentModal}
                      className="comment-modal"
                      bodyClassName="comment-modal-body"
                    >
                      <div className="comments comments--modal">
                        <p className="eyebrow">Comments</p>
                        {post.comments && post.comments.length > 0 ? (
                          <ul className="comment-list">
                            {post.comments.map((c) => {
                              const commentIdKey = String(
                                c.documentId ?? c.numericId ?? c.id
                              );
                              const isEditing = Boolean(editingComments[commentIdKey]);
                              const editValue = commentEdits[commentIdKey] ?? c.body;
                              const imageUrls = extractImageUrls(c.body);
                              const cleanedBody = stripImageUrls(c.body, imageUrls);
                              const displayBody =
                                cleanedBody || (imageUrls.length ? "" : c.body);
                              return (
                              <li key={c.id} className="comment-item">
                                <div className="comment-author">{c.owner || "User"}</div>
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
                                  <div className="comment-body">{linkifyText(displayBody)}</div>
                                )}
                                {!isEditing && imageUrls.length > 0 && (
                                  <div className="comment-images">
                                    {imageUrls.map((url, index) => {
                                      const resolved =
                                        pickMediaUrl(url, { kind: "post" }) || url;
                                      return (
                                        <img
                                          key={`${commentIdKey}-${index}`}
                                          src={resolved}
                                          alt="Comment attachment"
                                          loading="lazy"
                                          decoding="async"
                                        />
                                      );
                                    })}
                                  </div>
                                )}
                                {(() => {
                                  const commentUrl = extractFirstUrl(cleanedBody);
                                  if (!isPreviewableUrl(commentUrl)) return null;
                                  const preview = previewCache[commentUrl];
                                  if (!preview) return null;
                                  return (
                                    <div className="comment-preview">
                                      <LinkPreviewCard
                                        preview={preview}
                                        url={preview.url || commentUrl}
                                        compact
                                      />
                                    </div>
                                  );
                                })()}
                                {user?.id === c.ownerId && (
                                  <div className="comment-menu">
                                    <button
                                      className="comment-menu-button"
                                      type="button"
                                      aria-label="Comment actions"
                                      aria-haspopup="menu"
                                      aria-expanded={Boolean(commentMenuOpen[commentIdKey])}
                                      onClick={() =>
                                        setCommentMenuOpen((prev) => ({
                                          ...prev,
                                          [commentIdKey]: !prev[commentIdKey],
                                        }))
                                      }
                                    >
                                      <span className="comment-menu-dots" aria-hidden="true">
                                        ⋯
                                      </span>
                                    </button>
                                    {commentMenuOpen[commentIdKey] && (
                                      <div className="comment-menu-panel" role="menu">
                                        <button
                                          className="comment-menu-item"
                                          type="button"
                                          role="menuitem"
                                          onClick={() => {
                                            setEditingComments((prev) => ({
                                              ...prev,
                                              [commentIdKey]: true,
                                            }));
                                            setCommentEdits((prev) => ({
                                              ...prev,
                                              [commentIdKey]: c.body,
                                            }));
                                            setCommentMenuOpen((prev) => ({
                                              ...prev,
                                              [commentIdKey]: false,
                                            }));
                                          }}
                                        >
                                          Edit
                                        </button>
                                        <button
                                          className="comment-menu-item is-danger"
                                          type="button"
                                          role="menuitem"
                                          onClick={async () => {
                                            setCommentMenuOpen((prev) => ({
                                              ...prev,
                                              [commentIdKey]: false,
                                            }));
                                            const numericId =
                                              c.numericId ??
                                              (typeof c.id === "number" ? c.id : Number(c.id));
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

                                              setPosts((prev) => ({
                                                ...prev,
                                                comments: (prev.comments ?? []).filter(
                                                  (entry) => {
                                                    const record = asRecord(entry);
                                                    const attrs = normalize(entry);
                                                    const entryId = record.id ?? attrs.id;
                                                    const entryDoc =
                                                      record.documentId ?? attrs.documentId;
                                                    if (entryId !== undefined) {
                                                      if (removeIds.has(String(entryId))) {
                                                        return false;
                                                      }
                                                    }
                                                    if (entryDoc !== undefined) {
                                                      if (removeIds.has(String(entryDoc))) {
                                                        return false;
                                                      }
                                                    }
                                                    return true;
                                                  }
                                                ),
                                              }));

                                              try {
                                                await refreshCommentsForPost(post);
                                              } catch (err: unknown) {
                                                console.warn("Comment refresh failed after delete", err);
                                              }
                                            } catch (err: unknown) {
                                              const status = axios.isAxiosError(err)
                                                ? err.response?.status
                                                : undefined;
                                              if (status && status >= 500) {
                                                try {
                                                  const nextComments =
                                                    await refreshCommentsForPost(post);
                                                  const stillThere = nextComments.some(
                                                    (entry: unknown) =>
                                                      commentInIdentifierSet(entry, removeIds)
                                                  );
                                                  if (!stillThere) {
                                                    return;
                                                  }
                                                } catch {
                                                  // fall through to error message
                                                }
                                              }
                                              console.error("Delete comment failed", err);
                                              setError("Failed to delete comment");
                                            }
                                          }}
                                        >
                                          Delete
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </li>
                            );
                            })}
                          </ul>
                        ) : (
                          <p className="status">No comments yet.</p>
                        )}
                        {supportReplies.length > 0 && (
                          <div className="comment-quick-replies">
                            <span className="comment-quick-label">
                              {supportLabelText}
                            </span>
                            <div className="comment-quick-grid">
                              {supportReplies.map((reply) => (
                                <button
                                  key={reply}
                                  className="comment-quick-reply"
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setCommentInputs((prev) => {
                                      const current = (prev[commentKey] || "").trim();
                                      const next = current ? `${current} ${reply}` : reply;
                                      return {
                                        ...prev,
                                        [commentKey]: sanitizePostText(next),
                                      };
                                    });
                                  }}
                                >
                                  {reply}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        <div className="comment-form">
                          <div className="comment-form-row">
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
                              disabled={
                                !commentInputs[commentKey]?.trim() &&
                                commentAttachmentFiles.length === 0
                              }
                              onClick={async () => {
                                const body = (commentInputs[commentKey] || "").trim();
                                if (!body && commentAttachmentFiles.length === 0) return;
                                try {
                                  const targetType =
                                    post.source === "admin"
                                      ? "admin"
                                      : post.source === "group"
                                      ? "group-post"
                                      : "user";
                                  let attachmentUrls: string[] = [];
                                  if (commentAttachmentFiles.length > 0) {
                                    const fd = new FormData();
                                    commentAttachmentFiles.forEach((file) =>
                                      fd.append("files", file)
                                    );
                                    const uploadRes = await api.post("/upload", fd);
                                    attachmentUrls = (uploadRes.data ?? [])
                                      .map((item: { url?: string }) => item?.url)
                                      .filter(
                                        (url: string | undefined): url is string =>
                                          Boolean(url)
                                      );
                                  }
                                  const combinedBody = [body, ...attachmentUrls]
                                    .filter(Boolean)
                                    .join("\n");
                                  if (!combinedBody.trim()) return;
                                  await api.post("/comments", {
                                    data: {
                                      body: combinedBody,
                                      target_type: targetType,
                                      target_id: post.numericId ?? post.id,
                                    },
                                  });
                                  if (
                                    post.signalTag === "support-request" &&
                                    post.ownerId &&
                                    post.ownerId !== userId
                                  ) {
                                    bumpStat("supportReplies", 1);
                                    pushImpactNotice("Thanks for supporting someone today.");
                                  }
                                  await refreshCommentsForPost(post);
                                  setCommentInputs((prev) => ({
                                    ...prev,
                                    [commentKey]: "",
                                  }));
                                  clearCommentAttachments(commentKey);
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
                          <div className="comment-attachments">
                            <label className="comment-upload">
                              <input
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(e) => {
                                  handleCommentFilesChange(commentKey, e.target.files);
                                  e.target.value = "";
                                }}
                              />
                              <span>
                                {commentAttachmentFiles.length
                                  ? "Change photos"
                                  : "Add photos"}
                              </span>
                            </label>
                            {commentAttachmentPreviews.length > 0 && (
                              <div className="comment-attachment-list">
                                {commentAttachmentPreviews.map((url, index) => (
                                  <div
                                    key={`${commentKey}-attachment-${index}`}
                                    className="comment-attachment"
                                  >
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
                                      onClick={() =>
                                        removeCommentAttachment(commentKey, index)
                                      }
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
          {showGoToTop && !activePostKey && !goalsModalOpen && (
            <button
              type="button"
              className="go-top-button"
              onClick={handleGoToTop}
              aria-label="Go to top"
              title="Go to top"
            >
              <ArrowUp size={18} aria-hidden="true" />
            </button>
          )}
      </>
    )}
      </div>

      <PopupModal
        open={checkInModalOpen}
        title="Start check-in"
        onClose={closeCheckInModal}
        bodyClassName="comment-modal-body"
      >
        <div className="checkin-modal">
          <textarea
            className="auth-input"
            value={formContent}
            onChange={(e) => {
              setFormContent(sanitizePostText(e.target.value));
              setFormError(null);
            }}
            placeholder="Today I'm focused on..."
            rows={6}
          />
          {showCheckInOptions && (
            <div className="post-composer__checkin">
              <div className="post-composer__checkin-field">
                <span className="post-template-label">Goal (optional)</span>
                <select
                  className="auth-input post-feedback-select"
                  value={checkInGoal}
                  onChange={(e) => setCheckInGoal(e.target.value)}
                >
                  <option value="">No goal selected</option>
                  {availableGoals.map((goal) => (
                    <option key={goal} value={goal}>
                      {goal}
                    </option>
                  ))}
                </select>
                {availableGoals.length === 0 && (
                  <span className="post-composer__hint">
                    Add goals in Goals &amp; Trackers to pick one here.
                  </span>
                )}
              </div>
              <div className="post-composer__checkin-field">
                <span className="post-template-label">Share</span>
                <select
                  className="auth-input post-feedback-select"
                  value={checkInTarget}
                  onChange={(e) =>
                    setCheckInTarget(e.target.value as "feed" | "trusted")
                  }
                >
                  <option value="feed">My feed</option>
                  <option value="trusted">Trusted circle</option>
                </select>
              </div>
              {checkInTarget === "trusted" && (
                <div className="post-composer__checkin-field">
                  <span className="post-template-label">Trusted circle</span>
                  <select
                    className="auth-input post-feedback-select"
                    value={checkInGroupId}
                    onChange={(e) =>
                      setCheckInGroupId(e.target.value ? Number(e.target.value) : "")
                    }
                  >
                    <option value="">Select a circle</option>
                    {trustedCircleOptions.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="post-composer__hint-link"
                    onClick={() => navigate("/friends")}
                  >
                    Set Trusted Friends
                  </button>
                  {trustedCircleOptions.length === 0 && (
                    <span className="post-composer__hint">
                      Create a trusted circle in My Trusted Circles to use it here.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          {formFilePreviewUrls.length > 0 && (
            <div className="post-composer__media-preview">
              <div
                className={`post-composer__media-grid${
                  formFilePreviewUrls.length === 1 ? " is-single" : ""
                }`}
              >
                {formFilePreviewUrls.map((url, index) => {
                  const file = formFiles[index];
                  const isVideo = file ? isVideoFile(file) : false;
                  return (
                    <div
                      key={`${file?.name || "media"}-${index}`}
                      className="post-composer__media-thumb"
                    >
                      {isVideo ? (
                        <video muted playsInline preload="metadata">
                          <source src={url} />
                        </video>
                      ) : (
                        <img
                          src={url}
                          alt="Upload preview"
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <div className="post-composer__actions">
            <div className="post-composer__tools">
              <label className="post-composer__tool">
                <input
                  type="file"
                  accept="image/*,video/*"
                  multiple
                  onChange={(e) => {
                    const files = e.target.files;
                    handleComposerFiles(files);
                    e.target.value = "";
                  }}
                />
                <span>{formFiles.length ? "Change media" : "Add photo/video"}</span>
              </label>
              <span className="post-composer__file">
                {formFiles.length
                  ? `${formFiles.length} file${formFiles.length === 1 ? "" : "s"} selected`
                  : "No media selected"}
              </span>
              {formFiles.length > 0 && (
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => setFormFiles([])}
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
              {submitting ? "Posting..." : "Post check-in"}
            </button>
          </div>
          {formError && <p className="auth-message error">{formError}</p>}
        </div>
      </PopupModal>

      {goalsModalOpen && (
        <div
          className="goals-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="goals-modal-title"
          onClick={() => setGoalsModalOpen(false)}
        >
          <div className="goals-modal__panel" onClick={(event) => event.stopPropagation()}>
            <div className="goals-modal__handle" aria-hidden="true" />
            <button
              className="goals-modal__close"
              type="button"
              onClick={() => setGoalsModalOpen(false)}
              aria-label="Close goals and trackers"
            >
              X
            </button>
            <div className="goals-modal__scroll">
              <h2 id="goals-modal-title" className="sr-only">
                Set Goals and Trackers
              </h2>
              <GoalsImpactPanel
                userId={userId}
                groups={trustedCircleOptions}
                friends={friendOptions}
                onStateChange={setGoalsState}
                defaultOpen
              />
            </div>
          </div>
        </div>
      )}

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
                  {activePost?.signalTag && activePost.signalTag !== "none" && (
                    <span
                      className={`post-meta-tag post-meta-tag--signal post-meta-tag--${activePost.signalTag}`}
                    >
                      {formatSignalTag(activePost.signalTag)}
                    </span>
                  )}
                  {activeFeedbackLabel && (
                    <span className="post-feedback-tag">{activeFeedbackLabel}</span>
                  )}
                  {activePost.visibility === "trusted" && (
                    <span className="post-meta-tag post-meta-tag--trusted">
                      {activePost.trustedCircleName
                        ? `Circle: ${activePost.trustedCircleName}`
                        : "Trusted circle"}
                    </span>
                  )}
                </div>
              </div>

              {activeMediaUrls.length > 0 ? (
                activeMediaUrls.length === 1 ? (
                  <div className="post-media post-modal__media">
                    {isVideoUrl(activeMediaUrls[0]) ? (
                      <video
                        controls
                        playsInline
                        preload="metadata"
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      >
                        <source src={activeMediaUrls[0]} />
                      </video>
                    ) : (
                      <img
                        src={activeMediaUrls[0]}
                        alt={activePost.title}
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                  </div>
                ) : (
                  <div
                    className="post-media-grid post-modal__media-grid"
                    style={{
                      gridTemplateColumns: `repeat(${activeMediaLayout.columns}, minmax(0, 1fr))`,
                      gridTemplateRows: `repeat(${activeMediaLayout.rows}, minmax(0, 1fr))`,
                    }}
                  >
                    {activeMediaUrls
                      .slice(
                        0,
                        activeMediaLayout.columns * activeMediaLayout.rows
                      )
                      .map((url, index) => (
                        <div key={`${url}-${index}`} className="post-media-grid__item">
                          {isVideoUrl(url) ? (
                            <video muted playsInline preload="metadata">
                              <source src={url} />
                            </video>
                          ) : (
                            <img
                              src={url}
                              alt={activePost.title}
                              loading="lazy"
                              decoding="async"
                            />
                          )}
                        </div>
                      ))}
                  </div>
                )
              ) : showActivePreviewMedia ? (
                <div className="post-media post-modal__media link-preview-media">
                  <img
                    src={activePreviewImage}
                    alt={activePreview?.title || activePost.title}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              ) : null}

              <div className="post-modal__body">
                {(() => {
                  const structured = parseStructuredPost(
                    activePostContent,
                    activePost.signalTag
                  );
                  if (!structured) {
                    return (
                      <>
                        {activePostGoal ? (
                          <span className="post-meta-tag post-meta-tag--goal post-goal-tag">
                            Goal: {activePostGoal}
                          </span>
                        ) : (
                          <h2 id={modalTitleId}>{activePost.title}</h2>
                        )}
                        <p className="post-body-text">
                          {linkifyText(activePostContent)}
                        </p>
                      </>
                    );
                  }
                  return (
                    <>
                      <h2 id={modalTitleId} className="sr-only">
                        {activePost.title}
                      </h2>
                      {activePostGoal && (
                        <span className="post-meta-tag post-meta-tag--goal post-goal-tag">
                          Goal: {activePostGoal}
                        </span>
                      )}
                      <div className="post-structured">
                        {structured.rows.map((row) => (
                          <div key={row.label} className="post-structured__row">
                            <span className="post-structured__label">{row.label}</span>
                            <span
                              className={`post-structured__value${
                                row.value ? "" : " is-empty"
                              }`}
                            >
                              {row.value || "Not added yet"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  );
                })()}
                {activePreview && activeMediaUrls.length === 0 && (
                  <LinkPreviewCard
                    preview={activePreview}
                    url={activePreview.url || activePostUrl}
                  />
                )}
              </div>

              <div className="post-modal__comments">
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    const commentKey = String(activePost.numericId ?? activePost.id);
                    toggleComments(commentKey);
                    closePostModal();
                  }}
                >
                  View comments ({activePost.comments?.length ?? 0})
                </button>
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
        </div>
      )}
      {actionError && (
        <div className="post-error-overlay" role="dialog" aria-modal="true">
          <div className="post-error-modal">
            <div className="post-error-header">
              <h3>Action needed</h3>
              <button
                type="button"
                className="post-error-close"
                onClick={() => setActionError(null)}
              >
                X
              </button>
            </div>
            <p>{actionError}</p>
            <div className="post-error-actions">
              <button
                type="button"
                className="btn primary"
                onClick={() => setActionError(null)}
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
      {pendingDeletePost && (
        <div className="post-error-overlay" role="dialog" aria-modal="true">
          <div className="post-error-modal post-delete-modal">
            <div className="post-error-header">
              <h3>Delete post?</h3>
              <button
                type="button"
                className="post-error-close"
                onClick={() => setPendingDeletePost(null)}
              >
                X
              </button>
            </div>
            <p>This will permanently delete the post and its media.</p>
            <div className="post-error-actions post-delete-actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => setPendingDeletePost(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={() => void deletePost(pendingDeletePost)}
              >
                Yes, delete
              </button>
            </div>
          </div>
        </div>
      )}
      {copyToast && <div className="toast success-toast">{copyToast}</div>}
    </div>
  );
}
