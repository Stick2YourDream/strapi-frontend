// src/pages/Dashboard.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import api from "../api/strapi";
import axios from "axios";
import { getStoredToken } from "../utils/auth-storage";
import "../css/dashboard.css";
import { useAuth } from "../context/AuthContext";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import { usePageMeta } from "../hooks/usePageMeta";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { SIGNAL_TAGS, formatSignalTag, type SignalTag } from "../constants/signalTags";
import { sanitizePostText } from "../utils/emoji";
import { formatPostUpdateLabel } from "../utils/time";
import { pickMediaUrl } from "../utils/media";
import GoalsImpactPanel from "../components/GoalsImpactPanel";
import { useImpactStats } from "../hooks/useImpactStats";
import { useNewsPreference } from "../hooks/useNewsPreference";
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
};

type NormalizedPost = {
  id: string | number;
  numericId?: number;
  title: string;
  content: string;
  imageUrl?: string;
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

const computeCheckInStreak = (entries: CheckInEntry[]) => {
  const byDay = new Set(entries.map((entry) => new Date(entry.createdAt).toDateString()));
  let streak = 0;
  for (let i = 0; i < 60; i += 1) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    if (byDay.has(date.toDateString())) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
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
const normalizeReactionCounts = (
  value: unknown,
  fallbackLikes?: number
): ReactionCounts => {
  const record = isRecord(value) ? value : {};
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
const MAX_TRUSTED_CIRCLES = 5;
const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;
const MAX_UPLOAD_LABEL = "1 GB";
const MAX_VIDEO_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_UPLOAD_LABEL = "100 MB";
const URL_REGEX =
  /\b((?:https?:\/\/)?(?:www\.)?(?:(?:[a-z0-9-]+\.)+[a-z]{2,}|localhost|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})?)(?:\/[^\s]*)?/gi;
const TRAILING_PUNCTUATION = /[),.!?]+$/;
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
const isImageUrl = (value?: string) =>
  !!value && /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(value);
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
  const [composerExpanded, setComposerExpanded] = useState(false);
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
  const [editingComments, setEditingComments] = useState<Record<string, boolean>>({});
  const [openCommentsFor, setOpenCommentsFor] = useState<Record<string | number, boolean>>(
    {}
  );
  const [shareMenuFor, setShareMenuFor] = useState<string | number | null>(null);
  const [shareNotice, setShareNotice] = useState<Record<string | number, string>>({});
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [impactNotice, setImpactNotice] = useState<string | null>(null);
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

  const navigate = useNavigate();
  const location = useLocation();
  const hashHandledRef = useRef<string | null>(null);
  const { user, profile } = useAuth();
  const { getBackgroundStyle } = useUserPreferences();
  const userId = user?.id;
  const goalsStorageKey = useMemo(() => goalsStorageKeyFor(userId), [userId]);
  const [goalsState, setGoalsState] = useState<GoalsState>(() =>
    loadGoalsState(goalsStorageKey)
  );
  const { override: newsOverride } = useNewsPreference(userId);
  const { stats: impactStats, bumpStat } = useImpactStats(userId);
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
  const formFileIsVideo = formFile ? isVideoFile(formFile) : false;

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
    if (typeof window === "undefined") return;
    const handleStartCheckIn = (event: Event) => {
      const detail = (event as CustomEvent<{ goal?: string }>).detail;
      setComposerExpanded(true);
      setPostSignalTag("check-in");
      if (detail?.goal) {
        setCheckInGoal(detail.goal);
      }
      const target = document.getElementById("post-composer");
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener("ysp-goals-start-checkin", handleStartCheckIn as EventListener);
    return () =>
      window.removeEventListener("ysp-goals-start-checkin", handleStartCheckIn as EventListener);
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
  const showComposerAdvanced = composerExpanded;

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
    if (showCheckInOptions) {
      setComposerExpanded(true);
    }
  }, [showCheckInOptions]);

  useEffect(() => {
    if (!showCheckInOptions) {
      setCheckInGoal("");
      setCheckInTarget("feed");
      setCheckInGroupId("");
    }
  }, [showCheckInOptions]);

  const recap = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recent = (goalsState.checkIns || []).filter(
      (entry) => new Date(entry.createdAt).getTime() >= weekAgo
    );
    const checkInCount = recent.filter((entry) => entry.type === "check-in").length;
    const supportCount = recent.filter((entry) => entry.type === "support-request").length;
    return {
      checkInCount,
      supportCount,
      streak: computeCheckInStreak(goalsState.checkIns || []),
      lastEntry: goalsState.checkIns?.[0],
    };
  }, [goalsState.checkIns]);

  const heroBadges = useMemo(() => {
    const badges = [
      {
        id: "consistency",
        label: "Consistency",
        detail: "5+ check-ins",
        achieved: impactStats.checkIns >= 5,
      },
      {
        id: "encourager",
        label: "Encourager",
        detail: "10+ uplift reactions",
        achieved: impactStats.encouragements >= 10,
      },
      {
        id: "helper",
        label: "Support Ally",
        detail: "5+ support replies",
        achieved: impactStats.supportReplies >= 5,
      },
      {
        id: "beacon",
        label: "Beacon",
        detail: "3+ support requests",
        achieved: impactStats.supportRequests >= 3,
      },
    ];
    const achieved = badges.filter((badge) => badge.achieved);
    return (achieved.length ? achieved : badges.slice(0, 1)).slice(0, 2);
  }, [impactStats]);

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

      const token = getStoredToken();
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

        const [adminRes, userRes, groupRes, commentsRes, circlesRes] = await Promise.all([
          api.get(`/posts?populate=Pictures&pagination[pageSize]=${POSTS_PAGE_SIZE}`),
          api.get(
            `/users-posts?${userQuery}&populate=Users_Pictures&populate=owner&populate=feedbackTarget&populate=trustedCircle` +
              `&sort=createdAt:desc&pagination[pageSize]=${POSTS_PAGE_SIZE}&pagination[page]=1`
          ),
          memberGroups.length
            ? api.get(
                `/group-posts?${groupFilter}&populate=media&populate=owner&populate=group` +
                  `&sort=createdAt:desc&pagination[pageSize]=${POSTS_PAGE_SIZE}&pagination[page]=1`
              )
            : Promise.resolve({ data: { data: [], meta: {} } }),
          api.get(
            "/comments?populate=owner&sort=createdAt:desc&pagination[pageSize]=500"
          ),
          api.get(
            `/trusted-circles?sort=name:asc&pagination[pageSize]=${MAX_TRUSTED_CIRCLES}`
          ),
        ]);

        if (loadId !== loadIdRef.current) return;

        const allComments = commentsRes.data?.data ?? [];
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
              `/users-posts?${userQuery}&populate=Users_Pictures&populate=owner&populate=feedbackTarget&populate=trustedCircle` +
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

      const picturesRaw = getEntity(attributes.Users_Pictures) ?? getEntity(attributes.pictures);
      const mediaItem = Array.isArray(picturesRaw) ? picturesRaw[0] : picturesRaw;
      const imageUrl = pickMediaUrl(mediaItem, { kind: "post" });

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
        title,
        content,
        imageUrl,
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

      const picturesRaw = getEntity(attributes.Pictures);
      const mediaItem = Array.isArray(picturesRaw) ? picturesRaw[0] : picturesRaw;
      const imageUrl = pickMediaUrl(mediaItem, { kind: "post" });

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

  const fetchUserPostByKey = useCallback(async (postKey: string) => {
    if (!postKey) return false;
    try {
      const res = await api.get(
        `/users-posts/${postKey}?populate=Users_Pictures&populate=owner&populate=feedbackTarget&populate=trustedCircle`
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
    if (!content && !formFile) {
      setFormError("Add a message or a photo/video to post.");
      return;
    }
    const isCheckInPost =
      postSignalTag === "check-in" || postSignalTag === "support-request";
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

    if (formFile) {
      const isVideo = isVideoFile(formFile);
      const maxBytes = isVideo ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
      const maxLabel = isVideo ? MAX_VIDEO_UPLOAD_LABEL : MAX_UPLOAD_LABEL;
      if (formFile.size > maxBytes) {
        setFormError(`Media files must be under ${maxLabel}.`);
        return;
      }
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
          Users_Content: content,
          owner: user?.id,
          Users_Pictures: uploadedId ? [uploadedId] : undefined,
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
      setFormFile(null);
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
    const fallbackOrigin = String(import.meta.env.VITE_PUBLIC_SITE_URL || "").trim();
    const origin = window.location.origin;
    const base = origin.startsWith("http") ? origin : fallbackOrigin;
    if (!base) return "";
    const path = window.location.pathname?.startsWith("/")
      ? window.location.pathname
      : "/dashboard";
    return `${base}${path}#post-${postKey}`;
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
  }, []);

  const openSupportOptions = useCallback((postKey: string) => {
    setOpenCommentsFor((prev) => ({ ...prev, [postKey]: true }));
    setShareMenuFor(null);
  }, []);

  const toggleShareMenu = useCallback((postKey: string) => {
    setShareMenuFor((prev) => (prev === postKey ? null : postKey));
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
      if (target.closest(".post-action-group")) return;
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
            <p className="subhead">See What Our Community Is Doing!</p>
            <div className="dash-hero__insights">
              <div className="hero-insight">
                <span className="hero-insight__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M8 12.5l2.5 2.5L16 9.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <strong>{recap.checkInCount}</strong>
                  <span>Check-ins (7d)</span>
                </div>
              </div>
              <div className="hero-insight">
                <span className="hero-insight__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path
                      d="M12 21s-7-4.4-9-8.3C1.5 9 3 6 6 6c2 0 3.5 1.2 4 2.6C10.5 7.2 12 6 14 6c3 0 4.5 3 3 6.7C19 16.6 12 21 12 21z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div>
                  <strong>{recap.supportCount}</strong>
                  <span>Support (7d)</span>
                </div>
              </div>
              <div className="hero-insight">
                <span className="hero-insight__icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path
                      d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
                <div>
                  <strong>{recap.streak}</strong>
                  <span>Day streak</span>
                </div>
              </div>
            </div>
          </div>
          <div className="dash-hero__aside">
            <div className="hero-badge" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span className="pill" title="Live">
                Live
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
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
            <div className="hero-badges">
              {heroBadges.map((badge) => (
                <span key={badge.id} className="hero-badge-chip" title={badge.detail}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path
                      d="M12 17.27 18.18 21 16.54 13.97 22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {badge.label}
                </span>
              ))}
            </div>
          </div>
        </div>

      {loading && <p className="status">Loading posts…</p>}
      {error && <p className="status status-error">{error}</p>}

      {!loading && !error && (
        <>
          <div className="panel-grid">
            <GoalsImpactPanel
              userId={userId}
              groups={trustedCircleOptions}
              friends={friendOptions}
              onStateChange={setGoalsState}
            />
            <section className="panel post-composer" id="post-composer">
              <div className="panel-header post-composer__header">
                <div className="post-composer__header-text">
                  <p className="eyebrow">Create</p>
                  <h3>New Post</h3>
                  <p className="panel-sub">
                    Let Your Friends Know What You're Up To! 
                  </p>
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
                                Add goals in the Goals panel to pick one here.
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
                                  Create a trusted circle on the Friends page to use it here.
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <textarea
                    className="auth-input"
                    value={formContent}
                    onChange={(e) => {
                      const nextValue = sanitizePostText(e.target.value);
                      setFormContent(nextValue);
                      setFormError(null);
                    }}
                    placeholder="What's on your mind?"
                    rows={showComposerAdvanced ? 4 : 3}
                  />
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
                                Create a trusted circle on the Friends page to use this.
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

              <div className="post-composer__actions">
                <div className="post-composer__tools">
                  <label className="post-composer__tool">
                    <input
                      type="file"
                      accept="image/*,video/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        if (!file) {
                          setFormFile(null);
                          return;
                        }
                        const isVideo = isVideoFile(file);
                        const maxBytes = isVideo ? MAX_VIDEO_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
                        const maxLabel = isVideo ? MAX_VIDEO_UPLOAD_LABEL : MAX_UPLOAD_LABEL;
                        if (file.size > maxBytes) {
                          setFormError(`Media files must be under ${maxLabel}.`);
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
                  const mediaUrl =
                    post.imageUrl ||
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
                    <h5>{post.title}</h5>
                    {(() => {
                      const structured = parseStructuredPost(post.content, post.signalTag);
                      if (!structured) {
                        return <p className="post-body-text">{linkifyText(post.content)}</p>;
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

            {orderedPosts.map((post) => {
              const postUrl = extractFirstUrl(post.content);
              const preview = postUrl ? previewCache[postUrl] : undefined;
              const hasLink = Boolean(postUrl);
              const descriptor = mediaDescriptor(post.imageUrl, hasLink);
              const previewImage = preview?.image;
              const showPreviewMedia = !post.imageUrl && !!previewImage;
              const supportReplies = supportRepliesForTag(post.signalTag);
              const supportLabel = formatSignalTag(post.signalTag);
              const supportLabelText =
                post.signalTag === "support-request"
                  ? "Support options"
                  : supportLabel
                  ? `${supportLabel} support`
                  : "Support options";
              const authorLabel = post.ownerName || "User";
              const postId = Number(post.id);
              const canDelete =
                post.source === "user" &&
                Number.isFinite(postId) &&
                user?.id === post.ownerId;
              const feedbackLabel = feedbackLabelFor(post);
              const postKey = String(post.id);
              const commentKey = String(post.numericId ?? post.id);
              const isCommentsOpen = Boolean(openCommentsFor[commentKey]);
              const showShareMenu = shareMenuFor === postKey;
              const shareUrl = buildShareUrl(postKey);
              const shareText = post.title
                ? `${authorLabel}: ${post.title}`
                : `${authorLabel} posted an update.`;
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
              const commentsCount = post.comments?.length ?? 0;
              const isDescriptorActionable =
                descriptor === "with a picture" || descriptor === "with a link";

              return (
                <article
                  key={post.id}
                  id={`post-${postKey}`}
                  className={`post-card${showShareMenu ? " is-popover-open" : ""}${
                    post.signalTag === "support-request" ? " post-card--support" : ""
                  }${post.signalTag === "win" ? " post-card--win" : ""}`}
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
                    {(() => {
                      const structured = parseStructuredPost(post.content, post.signalTag);
                      if (!structured) {
                        return <p className="post-body-text">{linkifyText(post.content)}</p>;
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
                    {preview && !post.imageUrl && (
                      <LinkPreviewCard
                        preview={preview}
                        url={preview.url || postUrl}
                        compact
                      />
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
                        {post.comments && post.comments.length > 0 ? (
                          <ul className="comment-list">
                            {post.comments.map((c) => {
                              const commentIdKey = String(
                                c.documentId ?? c.numericId ?? c.id
                              );
                              const isEditing = Boolean(editingComments[commentIdKey]);
                              const editValue = commentEdits[commentIdKey] ?? c.body;
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
                                  <div className="comment-body">{c.body}</div>
                                )}
                                {(() => {
                                  const commentUrl = extractFirstUrl(c.body);
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
                                          const res = await api.get(
                                            "/comments?populate=owner&sort=createdAt:desc&pagination[pageSize]=500"
                                          );
                                          setPosts((prev) => ({
                                            ...prev,
                                            comments: res.data?.data ?? [],
                                          }));
                                        } catch (err: unknown) {
                                          console.warn(
                                            "Comment refresh failed after delete",
                                            err
                                          );
                                        }
                                      } catch (err: unknown) {
                                        const status = axios.isAxiosError(err)
                                          ? err.response?.status
                                          : undefined;
                                        if (status && status >= 500) {
                                          try {
                                            const res = await api.get(
                                              "/comments?populate=owner&sort=createdAt:desc&pagination[pageSize]=500"
                                            );
                                            const nextComments = res.data?.data ?? [];
                                            setPosts((prev) => ({
                                              ...prev,
                                              comments: nextComments,
                                            }));
                                            const stillThere = nextComments.some(
                                              (entry: unknown) => {
                                                const record = asRecord(entry);
                                                const attrs = normalize(entry);
                                                const entryId = record.id ?? attrs.id;
                                                const entryDoc =
                                                  record.documentId ?? attrs.documentId;
                                                if (entryId !== undefined) {
                                                  if (removeIds.has(String(entryId))) {
                                                    return true;
                                                  }
                                                }
                                                if (entryDoc !== undefined) {
                                                  if (removeIds.has(String(entryDoc))) {
                                                    return true;
                                                  }
                                                }
                                                return false;
                                              }
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
                                const res = await api.get(
                                  "/comments?populate=owner&sort=createdAt:desc&pagination[pageSize]=500"
                                );
                                setPosts((prev) => ({
                                  ...prev,
                                  comments: res.data?.data ?? [],
                                }));
                                setCommentInputs((prev) => ({ ...prev, [commentKey]: "" }));
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
              ) : null}

              <div className="post-modal__body">
                <h2 id={modalTitleId}>{activePost.title}</h2>
                {(() => {
                  const structured = parseStructuredPost(
                    activePost.content,
                    activePost.signalTag
                  );
                  if (!structured) {
                    return (
                      <p className="post-body-text">{linkifyText(activePost.content)}</p>
                    );
                  }
                  return (
                    <div className="post-structured">
                      {structured.rows.map((row) => (
                        <div key={row.label} className="post-structured__row">
                          <span className="post-structured__label">{row.label}</span>
                          <span
                            className={`post-structured__value${row.value ? "" : " is-empty"}`}
                          >
                            {row.value || "Not added yet"}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
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
                    {activePost.comments.map((comment) => {
                      const commentIdKey = String(
                        comment.documentId ?? comment.numericId ?? comment.id
                      );
                      const isEditing = Boolean(editingComments[commentIdKey]);
                      const editValue = commentEdits[commentIdKey] ?? comment.body;
                      return (
                        <li key={comment.id} className="comment-item">
                          <div className="comment-author">{comment.owner || "User"}</div>
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
                                        comment,
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
                            <div className="comment-body">{comment.body}</div>
                          )}
                          {(() => {
                            const commentUrl = extractFirstUrl(comment.body);
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
                          {user?.id === comment.ownerId && (
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
                                    [commentIdKey]: comment.body,
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
                                    comment.numericId ??
                                    (typeof comment.id === "number"
                                      ? comment.id
                                      : Number(comment.id));
                                  const removeIds = new Set<string>();
                                  removeIds.add(String(comment.id));
                                  if (comment.documentId) {
                                    removeIds.add(String(comment.documentId));
                                  }
                                  if (Number.isFinite(numericId)) {
                                    removeIds.add(String(numericId));
                                  }
                                  try {
                                    setError(null);
                                    const attempts: string[] = [];
                                    if (comment.documentId) {
                                      attempts.push(`/comments/${comment.documentId}`);
                                    }
                                    if (Number.isFinite(numericId)) {
                                      attempts.push(`/comments/${numericId}`);
                                    }
                                    attempts.push(`/comments/${comment.id}`);

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
                                      comments: (prev.comments ?? []).filter((entry) => {
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
                                      }),
                                    }));

                                    try {
                                      const res = await api.get(
                                        "/comments?populate=owner&sort=createdAt:desc&pagination[pageSize]=500"
                                      );
                                      setPosts((prev) => ({
                                        ...prev,
                                        comments: res.data?.data ?? [],
                                      }));
                                    } catch (err: unknown) {
                                      console.warn(
                                        "Comment refresh failed after delete",
                                        err
                                      );
                                    }
                                  } catch (err: unknown) {
                                    const status = axios.isAxiosError(err)
                                      ? err.response?.status
                                      : undefined;
                                    if (status && status >= 500) {
                                      try {
                                        const res = await api.get(
                                          "/comments?populate=owner&sort=createdAt:desc&pagination[pageSize]=500"
                                        );
                                        const nextComments = res.data?.data ?? [];
                                        setPosts((prev) => ({
                                          ...prev,
                                          comments: nextComments,
                                        }));
                                        const stillThere = nextComments.some(
                                          (entry: unknown) => {
                                            const record = asRecord(entry);
                                            const attrs = normalize(entry);
                                            const entryId = record.id ?? attrs.id;
                                            const entryDoc =
                                              record.documentId ?? attrs.documentId;
                                            if (entryId !== undefined) {
                                              if (removeIds.has(String(entryId))) {
                                                return true;
                                              }
                                            }
                                            if (entryDoc !== undefined) {
                                              if (removeIds.has(String(entryDoc))) {
                                                return true;
                                              }
                                            }
                                            return false;
                                          }
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
                        </li>
                      );
                    })}
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
