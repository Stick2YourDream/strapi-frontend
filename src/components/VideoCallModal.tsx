import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type KeyboardEvent,
  type KeyboardEventHandler,
  type MouseEvent,
  type MouseEventHandler,
  type PointerEvent,
  type PointerEventHandler,
  type Ref,
  type ReactNode,
  type WheelEvent,
  type WheelEventHandler,
} from "react";
import { createPortal } from "react-dom";
import {
  useVideoCall,
  type VideoCallInvitee,
  type VideoCallMessage,
  type VideoCallParticipant,
} from "../context/VideoCallContext";
import { Grid } from "@giphy/react-components";
import { GiphyFetch } from "@giphy/js-fetch-api";
import { useAuth } from "../context/AuthContext";
import { sanitizePostText } from "../utils/emoji";
import api from "../api/strapi";
import callRingtoneUrl from "../assets/call.mp3";
import holdMusicUrl from "../assets/on_hold.mp3";
import messageSoundUrl from "../assets/notification_sound.mp3";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBolt,
  faCamera,
  faCommentSlash,
  faComments,
  faCompress,
  faDesktop,
  faDisplay,
  faExpand,
  faFaceSmile as faFaceSmileSolid,
  faMagnifyingGlass,
  faMicrophone,
  faMicrophoneSlash,
  faMinus,
  faPause,
  faPhoneSlash,
  faPlay,
  faPlus,
  faRightFromBracket,
  faSliders,
  faStop,
  faTableColumns,
  faTrash,
  faUpRightFromSquare,
  faUserPlus,
  faUsers,
  faVideo,
  faVideoSlash,
  faVolumeHigh,
  faVolumeXmark,
  faWaveSquare,
  faWindowMaximize,
  faWindowRestore,
  faXmark,
} from "@fortawesome/free-solid-svg-icons";
import { faFaceSmile as faFaceSmileRegular } from "@fortawesome/free-regular-svg-icons";

type VideoCallModalProps = {
  friends: VideoCallInvitee[];
  appSettings?: VideoAppSettings;
  onSettingsChange?: (next: VideoAppSettings) => void;
};

type VideoAppSettings = {
  theme: "dark" | "light";
  backgroundColor: string;
  backgroundImage: string;
  backgroundImageName: string;
  boxColor: string;
};

type PanOffset = {
  x: number;
  y: number;
};

type EmojiCategory = {
  id: string;
  label: string;
  emojis: string[];
};

type Emoji3dItem = {
  id: string;
  label: string;
  url: string;
  fallback: string;
};

type Emoji3dCategory = {
  id: string;
  label: string;
  items: Emoji3dItem[];
};

type VideoParticipantEntry = {
  id: string;
  stream: MediaStream | null;
  label: string;
  avatarUrl?: string;
  isLocal: boolean;
  status?: string;
};

type GifCategory = {
  id: string;
  label: string;
  query?: string;
};

const EMOJI_3D_BASE_URL = "https://fonts.gstatic.com/s/e/notoemoji/latest";
const EMOJI_3D_TOKEN_PREFIX = "[[3d:";
const EMOJI_3D_TOKEN_SUFFIX = "]]";
const EMOJI_3D_TOKEN_REGEX = /\[\[3d:([a-z0-9_-]+)\]\]/gi;

type LinkMeta = {
  title?: string;
  description?: string;
  siteName?: string;
  image?: string;
};

const extractLinks = (text: string) => {
  const regex = /(https?:\/\/[^\s]+)/g;
  return text.match(regex) || [];
};

const parseYouTubeId = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) {
      return parsed.searchParams.get("v");
    }
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.replace("/", "") || null;
    }
  } catch {
    return null;
  }
  return null;
};

const formatUrlLabel = (url: string) => url.replace(/^https?:\/\//, "");
const faviconFor = (value: string) => {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch {
    return "";
  }
};
const getEmoji3dUrl = (code: string) => `${EMOJI_3D_BASE_URL}/${code}/512.gif`;

const formatScreenShareLabel = (rawLabel: string, fallbackLabel: string) => {
  const trimmed = rawLabel.trim();
  if (!trimmed) return fallbackLabel;
  const lower = trimmed.toLowerCase();
  const knownApps: Array<[string, string]> = [
    ["visual studio code", "Visual Studio Code"],
    ["microsoft edge", "Microsoft Edge"],
    ["google chrome", "Google Chrome"],
    ["chrome", "Google Chrome"],
    ["firefox", "Firefox"],
    ["safari", "Safari"],
    ["figma", "Figma"],
    ["slack", "Slack"],
    ["discord", "Discord"],
    ["zoom", "Zoom"],
  ];
  for (const [match, label] of knownApps) {
    if (lower.includes(match)) return label;
  }
  const screenMatch = trimmed.match(/screen\s*\d+/i);
  if (screenMatch) return screenMatch[0].replace(/\s+/g, " ");
  const normalized = trimmed.replace(/^(window|screen)\s*[:\-]\s*/i, "");
  return normalized || fallbackLabel;
};

type FileWithPath = File & { path?: string };
type RgbaColor = { r: number; g: number; b: number; a: number };

const getFileDisplayName = (file: File) => {
  if (file.name) return file.name;
  const fileWithPath = file as FileWithPath;
  if (typeof fileWithPath.path === "string" && fileWithPath.path) {
    const parts = fileWithPath.path.split(/[/\\]+/);
    return parts[parts.length - 1] || "";
  }
  return "";
};

const clampValue = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const parseRgbChannel = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith("%")) {
    const percent = Number.parseFloat(trimmed);
    if (Number.isNaN(percent)) return null;
    return clampValue(Math.round((percent / 100) * 255), 0, 255);
  }
  const numeric = Number.parseFloat(trimmed);
  if (Number.isNaN(numeric)) return null;
  return clampValue(Math.round(numeric), 0, 255);
};

const parseAlphaChannel = (value?: string) => {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.endsWith("%")) {
    const percent = Number.parseFloat(trimmed);
    if (Number.isNaN(percent)) return null;
    return clampValue(percent / 100, 0, 1);
  }
  const numeric = Number.parseFloat(trimmed);
  if (Number.isNaN(numeric)) return null;
  return clampValue(numeric, 0, 1);
};

const parseHexColor = (value: string) => {
  const hex = value.replace("#", "").trim();
  if (hex.length === 3) {
    const r = Number.parseInt(hex[0] + hex[0], 16);
    const g = Number.parseInt(hex[1] + hex[1], 16);
    const b = Number.parseInt(hex[2] + hex[2], 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
  }
  if (hex.length === 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if ([r, g, b].some(Number.isNaN)) return null;
    return { r, g, b };
  }
  return null;
};

const parseRgbaColor = (value: string, fallback: RgbaColor): RgbaColor => {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "transparent") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (normalized.startsWith("#")) {
    const hex = parseHexColor(normalized);
    if (hex) return { ...hex, a: 1 };
    return fallback;
  }
  if (normalized.startsWith("rgb")) {
    const parts = normalized.replace(/rgba?\(|\)/g, "").split(",");
    const r = parseRgbChannel(parts[0] || "");
    const g = parseRgbChannel(parts[1] || "");
    const b = parseRgbChannel(parts[2] || "");
    const a = parseAlphaChannel(parts[3]);
    if ([r, g, b].some((channel) => channel === null)) return fallback;
    return {
      r: r ?? fallback.r,
      g: g ?? fallback.g,
      b: b ?? fallback.b,
      a: a ?? 1,
    };
  }
  return fallback;
};

const toHex = (value: number) =>
  clampValue(Math.round(value), 0, 255).toString(16).padStart(2, "0");

const rgbaToHex = (color: RgbaColor) => `#${toHex(color.r)}${toHex(color.g)}${toHex(color.b)}`;

const rgbaToString = (color: RgbaColor) => {
  const alpha = clampValue(Number(color.a.toFixed(2)), 0, 1);
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
};

const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    id: "smileys",
    label: "Smileys",
    emojis: [
      "\u{1F603}",
      "\u{1F604}",
      "\u{1F606}",
      "\u{1F602}",
      "\u{1F923}",
      "\u{1F609}",
      "\u{1F60D}",
      "\u{1F618}",
      "\u{1F970}",
      "\u{1F929}",
      "\u{1F60E}",
      "\u{1F60A}",
      "\u{1F972}",
      "\u{1F913}",
      "\u{1F914}",
      "\u{1F92F}",
      "\u{1F62E}",
      "\u{1F632}",
      "\u{1F622}",
      "\u{1F62D}",
      "\u{1F620}",
      "\u{1F621}",
      "\u{1F624}",
      "\u{1F607}",
      "\u{1F47B}",
      "\u{1F47D}",
    ],
  },
  {
    id: "hands",
    label: "Hands",
    emojis: [
      "\u{1F44D}",
      "\u{1F44E}",
      "\u{1F44F}",
      "\u{1F44A}",
      "\u{1F91D}",
      "\u{1F64F}",
      "\u{1F64C}",
      "\u{1F4AA}",
    ],
  },
  {
    id: "celebrate",
    label: "Celebrate",
    emojis: [
      "\u{2728}",
      "\u{1F389}",
      "\u{1F38A}",
      "\u{1F381}",
      "\u{1F3C6}",
      "\u{1F680}",
      "\u{1F4A1}",
      "\u{1F31F}",
      "\u{1F525}",
      "\u{1F4AF}",
    ],
  },
  {
    id: "nature",
    label: "Nature",
    emojis: ["\u{1F33F}", "\u{1F339}", "\u{1F30A}", "\u{1F387}", "\u{1F984}"],
  },
  {
    id: "love",
    label: "Love",
    emojis: ["\u{2764}", "\u{1F49A}", "\u{1F499}"],
  },
];

const EMOJI_3D_CATEGORIES: Emoji3dCategory[] = [
  {
    id: "celebrate-3d",
    label: "Celebrate",
    items: [
      {
        id: "party",
        label: "Party popper",
        url: getEmoji3dUrl("1f389"),
        fallback: "\u{1F389}",
      },
      {
        id: "confetti",
        label: "Confetti",
        url: getEmoji3dUrl("1f38a"),
        fallback: "\u{1F38A}",
      },
      {
        id: "gift",
        label: "Gift",
        url: getEmoji3dUrl("1f381"),
        fallback: "\u{1F381}",
      },
      {
        id: "trophy",
        label: "Trophy",
        url: getEmoji3dUrl("1f3c6"),
        fallback: "\u{1F3C6}",
      },
    ],
  },
  {
    id: "reactions-3d",
    label: "Reactions",
    items: [
      {
        id: "thumbs-up",
        label: "Thumbs up",
        url: getEmoji3dUrl("1f44d"),
        fallback: "\u{1F44D}",
      },
      {
        id: "clap",
        label: "Clap",
        url: getEmoji3dUrl("1f44f"),
        fallback: "\u{1F44F}",
      },
      {
        id: "fire",
        label: "Fire",
        url: getEmoji3dUrl("1f525"),
        fallback: "\u{1F525}",
      },
      {
        id: "wow",
        label: "Wow",
        url: getEmoji3dUrl("1f62e"),
        fallback: "\u{1F62E}",
      },
      {
        id: "heart",
        label: "Love",
        url: getEmoji3dUrl("2764_fe0f"),
        fallback: "\u2764",
      },
      {
        id: "pray",
        label: "Thank you",
        url: getEmoji3dUrl("1f64f"),
        fallback: "\u{1F64F}",
      },
    ],
  },
  {
    id: "vibes-3d",
    label: "Vibes",
    items: [
      {
        id: "cool",
        label: "Cool",
        url: getEmoji3dUrl("1f60e"),
        fallback: "\u{1F60E}",
      },
      {
        id: "sparkle",
        label: "Sparkle",
        url: getEmoji3dUrl("2728"),
        fallback: "\u2728",
      },
      {
        id: "rocket",
        label: "Rocket",
        url: getEmoji3dUrl("1f680"),
        fallback: "\u{1F680}",
      },
      {
        id: "muscle",
        label: "Strength",
        url: getEmoji3dUrl("1f4aa"),
        fallback: "\u{1F4AA}",
      },
      {
        id: "light",
        label: "Idea",
        url: getEmoji3dUrl("1f4a1"),
        fallback: "\u{1F4A1}",
      },
      {
        id: "star",
        label: "Star",
        url: getEmoji3dUrl("1f31f"),
        fallback: "\u{1F31F}",
      },
    ],
  },
];

const EMOJI_3D_ITEM_MAP = new Map<string, Emoji3dItem>();
EMOJI_3D_CATEGORIES.forEach((category) => {
  category.items.forEach((item) => {
    EMOJI_3D_ITEM_MAP.set(item.id, item);
  });
});

const buildEmoji3dToken = (id: string) => `${EMOJI_3D_TOKEN_PREFIX}${id}${EMOJI_3D_TOKEN_SUFFIX}`;

const REACTION_EMOJIS = [
  "\u{1F44D}",
  "\u2764",
  "\u{1F602}",
  "\u{1F525}",
  "\u{1F44F}",
  "\u{1F62E}",
];

const GIFS = [
  {
    label: "Hype",
    url: "https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif",
  },
  {
    label: "Celebrate",
    url: "https://media.giphy.com/media/3oz8xAFtqoOUUrsh7W/giphy.gif",
  },
  {
    label: "Yes",
    url: "https://media.giphy.com/media/111ebonMs90YLu/giphy.gif",
  },
  {
    label: "Applause",
    url: "https://media.giphy.com/media/l0MYt5jPR6QX5pnqM/giphy.gif",
  },
  {
    label: "Focus",
    url: "https://media.giphy.com/media/xT9IgG50Fb7Mi0prBC/giphy.gif",
  },
  {
    label: "Mind blown",
    url: "https://media.giphy.com/media/3oriO0OEd9QIDdllqo/giphy.gif",
  },
  {
    label: "Excited",
    url: "https://media.giphy.com/media/JIX9t2j0ZTN9S/giphy.gif",
  },
  {
    label: "Happy dance",
    url: "https://media.giphy.com/media/ASd0Ukj0y3qMM/giphy.gif",
  },
  {
    label: "Big yes",
    url: "https://media.giphy.com/media/5GoVLqeAOo6PK/giphy.gif",
  },
  {
    label: "Clap",
    url: "https://media.giphy.com/media/13HgwGsXF0aiGY/giphy.gif",
  },
  {
    label: "Lets go",
    url: "https://media.giphy.com/media/3o7aD2saalBwwftBIY/giphy.gif",
  },
  {
    label: "Nailed it",
    url: "https://media.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif",
  },
  {
    label: "Fire",
    url: "https://media.giphy.com/media/l0MYC0LajbaPoEADu/giphy.gif",
  },
  {
    label: "Mic drop",
    url: "https://media.giphy.com/media/3o6Zt9jaIlgVHWUZ1K/giphy.gif",
  },
  {
    label: "Victory",
    url: "https://media.giphy.com/media/3o6Zt481isNVuQI1l6/giphy.gif",
  },
  {
    label: "Wow",
    url: "https://media.giphy.com/media/26gslfJ7oM1aBH1e8/giphy.gif",
  },
  {
    label: "Thank you",
    url: "https://media.giphy.com/media/xUPGcguWZHRC2HyBRS/giphy.gif",
  },
  {
    label: "High five",
    url: "https://media.giphy.com/media/3o6Zt5b8oCV0nG5CQU/giphy.gif",
  },
];

const GIF_CATEGORIES: GifCategory[] = [
  { id: "trending", label: "Trending" },
  { id: "celebration", label: "Celebration", query: "celebration" },
  { id: "hype", label: "Hype", query: "hype" },
  { id: "laugh", label: "Laugh", query: "laugh" },
  { id: "applause", label: "Applause", query: "applause" },
  { id: "reactions", label: "Reactions", query: "reaction" },
  { id: "success", label: "Success", query: "success" },
  { id: "mindblown", label: "Mind blown", query: "mind blown" },
  { id: "sports", label: "Sports", query: "sports" },
  { id: "work", label: "Work", query: "work" },
  { id: "dance", label: "Dance", query: "dance" },
  { id: "motivation", label: "Motivation", query: "motivation" },
];

const BACKGROUND_OPTIONS = [
  { id: "none", label: "None" },
  { id: "backdrop1", label: "Bedroom" },
  { id: "backdrop2", label: "Dots" },
  { id: "backdrop3", label: "Futuristic Home" },
  { id: "backdrop4", label: "Home" },
  { id: "backdrop5", label: "Lakeside" },
  { id: "backdrop6", label: "Lilies" },
  { id: "backdrop7", label: "Nighttime City" },
  { id: "backdrop8", label: "Stunning" },
  { id: "backdrop9", label: "Tech Lab" },
  { id: "backdrop10", label: "Wavy" },
];

const FILTER_OPTIONS = [
  { id: "none", label: "Clean" },
  { id: "neon", label: "Neon Pop" },
  { id: "sunset", label: "Sunset" },
  { id: "ice", label: "Ice Blue" },
  { id: "vivid", label: "Vivid" },
  { id: "crisp", label: "Crisp" },
  { id: "cinema", label: "Cinema" },
  { id: "vintage", label: "Vintage" },
  { id: "matte", label: "Matte" },
  { id: "soft", label: "Soft" },
  { id: "warm", label: "Warm" },
  { id: "cool", label: "Cool" },
  { id: "amber", label: "Amber" },
  { id: "teal", label: "Teal" },
  { id: "rose", label: "Rose" },
  { id: "noir", label: "Noir" },
  { id: "midnight", label: "Midnight" },
];

const SETTINGS_STORAGE_PREFIX = "video-call-settings";
const SETTINGS_GLOBAL_KEY = `${SETTINGS_STORAGE_PREFIX}:global`;
const DEFAULT_BACKGROUND_COLOR = "rgba(5, 7, 15, 1)";
const DEFAULT_SETTINGS: VideoAppSettings = {
  theme: "dark",
  backgroundColor: DEFAULT_BACKGROUND_COLOR,
  backgroundImage: "",
  backgroundImageName: "",
  boxColor: "",
};

const loadSettings = (raw: string | null): VideoAppSettings => {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_SETTINGS };
    const backgroundColor =
      typeof parsed.backgroundColor === "string" && parsed.backgroundColor.trim()
        ? parsed.backgroundColor
        : DEFAULT_BACKGROUND_COLOR;
    return {
      theme: parsed.theme === "light" ? "light" : "dark",
      backgroundColor,
      backgroundImage: typeof parsed.backgroundImage === "string" ? parsed.backgroundImage : "",
      backgroundImageName:
        typeof parsed.backgroundImageName === "string" ? parsed.backgroundImageName : "",
      boxColor: typeof parsed.boxColor === "string" ? parsed.boxColor : "",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
};

const getInitials = (value: string) => {
  const parts = String(value || "").trim().split(/\s+/);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
};

const VideoTile = ({
  stream,
  label,
  avatarUrl,
  muted,
  status,
  className,
  badge,
  children,
  onPointerMove,
  onPointerUp,
  onPointerDown,
  onPointerLeave,
  onContextMenu,
  onWheel,
  onKeyDown,
  onKeyUp,
  tabIndex,
  rootRef,
  dataScreenId,
  style,
  mediaStyle,
  mediaClassName,
}: {
  stream: MediaStream | null;
  label: string;
  avatarUrl?: string;
  muted?: boolean;
  status?: string;
  className?: string;
  badge?: string;
  children?: React.ReactNode;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerUp?: PointerEventHandler<HTMLDivElement>;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  onWheel?: WheelEventHandler<HTMLDivElement>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onKeyUp?: KeyboardEventHandler<HTMLDivElement>;
  tabIndex?: number;
  rootRef?: Ref<HTMLDivElement>;
  dataScreenId?: string;
  style?: CSSProperties;
  mediaStyle?: CSSProperties;
  mediaClassName?: string;
}) => {
  const ref = useRef<HTMLVideoElement | null>(null);
  const hasVideo = Boolean(
    stream?.getVideoTracks().some((track) => track.enabled && track.readyState === "live")
  );
  const mediaClasses = `video-tile__media${hasVideo ? "" : " is-hidden"}${
    mediaClassName ? ` ${mediaClassName}` : ""
  }`;

  useEffect(() => {
    if (!ref.current) return;
    if (!stream) {
      ref.current.srcObject = null;
      return;
    }
    ref.current.srcObject = stream;
    ref.current.play().catch(() => undefined);
  }, [stream]);

  return (
    <div
      ref={rootRef}
      data-screen-id={dataScreenId}
      className={`video-tile${className ? ` ${className}` : ""}`}
      style={style}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerDown={onPointerDown}
      onPointerLeave={onPointerLeave}
      onContextMenu={onContextMenu}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      tabIndex={tabIndex}
    >
      {stream && (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          className={mediaClasses}
          style={mediaStyle}
        />
      )}
      {(!stream || !hasVideo) && (
        <div className="video-tile__placeholder">
          {avatarUrl ? (
            <div
              className="video-tile__avatar"
              style={{ backgroundImage: `url(${avatarUrl})` }}
            />
          ) : (
            <div className="video-tile__initials">{getInitials(label)}</div>
          )}
          {status && <span className="video-tile__status">{status}</span>}
        </div>
      )}
      {badge && <span className="video-tile__badge">{badge}</span>}
      <div className="video-tile__meta">
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
};

const renderEmoji3dTokens = (text: string): ReactNode => {
  if (!text) return "";
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  text.replace(EMOJI_3D_TOKEN_REGEX, (match, id, offset) => {
    if (offset > lastIndex) {
      parts.push(text.slice(lastIndex, offset));
    }
    const item = EMOJI_3D_ITEM_MAP.get(String(id).toLowerCase());
    if (item) {
      parts.push(
        <img
          key={`emoji3d-${offset}-${id}`}
          className="video-chat-emoji-inline is-3d"
          src={item.url}
          alt={item.label}
          loading="lazy"
        />
      );
    } else {
      parts.push(match);
    }
    lastIndex = offset + match.length;
    return match;
  });
  if (parts.length === 0) return text;
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return parts;
};

const renderMessageContent = (message: VideoCallMessage): ReactNode => {
  if (message.kind === "gif" && message.gifUrl) {
    const isEmojiGif = message.gifUrl.startsWith(EMOJI_3D_BASE_URL);
    return (
      <img
        className={isEmojiGif ? "video-chat-emoji-inline is-3d" : undefined}
        src={message.gifUrl}
        alt={isEmojiGif ? "3D emoji" : "GIF"}
        loading="lazy"
      />
    );
  }
  return (
    <span className="video-chat-inline-content">
      {renderEmoji3dTokens(message.body || "")}
    </span>
  );
};

export default function VideoCallModal({
  friends,
  appSettings,
  onSettingsChange,
}: VideoCallModalProps) {
  const {
    isOpen,
    status,
    selectedInvitees,
    incomingCall,
    activeRoomId,
    isCallHost,
    localStream,
    localScreenStream,
    remoteStreams,
    remoteScreenStreams,
    remoteParticipants,
    messages,
    error,
    e2eeDebug,
    maxParticipants,
    isVideoEnabled,
    isAudioEnabled,
    noiseSuppressionEnabled,
    lowLatencyMode,
    lowLatencySuggested,
    lowLatencySuggestionReason,
    isHolding,
    isOnHold,
    selectedAudioInputId,
    selectedVideoInputId,
    isScreenSharing,
    onlineUserIds,
    videoEffects,
    setVideoEffects,
    closeCallComposer,
    setSelectedInvitees,
    startCall,
    acceptCall,
    declineCall,
    leaveCall,
    endCall,
    toggleVideo,
    toggleAudio,
    toggleNoiseSuppression,
    toggleLowLatencyMode,
    setAudioInputDevice,
    setVideoInputDevice,
    startScreenShare,
    stopScreenShare,
    screenControlRequests,
    pendingScreenControlTargets,
    activeScreenController,
    screenControlTarget,
    screenControlAgentId,
    screenControlCursor,
    requestScreenControl,
    grantScreenControl,
    denyScreenControl,
    stopScreenControl,
    sendScreenControlEvent,
    sendMessage,
    toggleHold,
    muteAllParticipants,
    stopAllScreenShares,
  } = useVideoCall();
  const { user, profile } = useAuth();
  const settingsStorageKey = useMemo(
    () => `${SETTINGS_STORAGE_PREFIX}:${user?.id ?? "anon"}`,
    [user?.id]
  );
  const [localSettings, setLocalSettings] = useState<VideoAppSettings>(() => {
    if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
    return loadSettings(localStorage.getItem(settingsStorageKey));
  });
  const effectiveSettings = appSettings ?? localSettings;
  const backgroundColorRgba = useMemo(
    () => parseRgbaColor(effectiveSettings.backgroundColor, { r: 5, g: 7, b: 15, a: 1 }),
    [effectiveSettings.backgroundColor]
  );
  const boxColorRgba = useMemo(
    () => parseRgbaColor(effectiveSettings.boxColor, { r: 15, g: 23, b: 42, a: 1 }),
    [effectiveSettings.boxColor]
  );
  const updateAppSettings = useCallback(
    (updater: (prev: VideoAppSettings) => VideoAppSettings) => {
      const current = appSettings ?? localSettings;
      const next = updater(current);
      if (appSettings && onSettingsChange) {
        onSettingsChange(next);
        return;
      }
      setLocalSettings(next);
      if (typeof window !== "undefined") {
        localStorage.setItem(settingsStorageKey, JSON.stringify(next));
        localStorage.setItem(SETTINGS_GLOBAL_KEY, JSON.stringify(next));
      }
    },
    [appSettings, localSettings, onSettingsChange, settingsStorageKey]
  );
  const handleModalBackgroundImageFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file || !file.type.startsWith("image/")) {
        return;
      }
      const fileName = getFileDisplayName(file);
      const reader = new FileReader();
      reader.onload = () => {
        const result = typeof reader.result === "string" ? reader.result : "";
        if (!result) return;
        updateAppSettings((prev) => ({
          ...prev,
          backgroundImage: result,
          backgroundImageName: fileName,
        }));
      };
      reader.readAsDataURL(file);
      event.target.value = "";
    },
    [updateAppSettings]
  );
  const overlayStyle = useMemo(() => {
    const style: CSSProperties = {};
    const vars = style as Record<string, string>;
    const backgroundColor = effectiveSettings.backgroundColor.trim();
    const backgroundImage = effectiveSettings.backgroundImage.trim();
    const boxColor = effectiveSettings.boxColor.trim();
    const hasCustomBackground =
      Boolean(backgroundColor) && backgroundColor !== DEFAULT_BACKGROUND_COLOR;
    if (backgroundColor) {
      vars["--video-app-bg-color"] = backgroundColor;
      if (!boxColor && hasCustomBackground) {
        vars["--video-hero-bg"] = "var(--video-surface-solid)";
        vars["--video-surface"] = "var(--video-surface-solid)";
        vars["--video-surface-alt"] = "var(--video-surface-alt-solid)";
        vars["--video-card"] = "var(--video-card-solid)";
        vars["--video-input-bg"] = "var(--video-input-solid)";
      }
    }
    if (backgroundImage) {
      vars["--video-app-bg-image"] = `url("${backgroundImage}")`;
      vars["--video-modal-bg"] = "rgba(10, 14, 26, 0.65)";
      vars["--video-ghost-bg"] = "rgba(15, 23, 42, 0.72)";
      vars["--video-ghost-border"] = "rgba(148, 163, 184, 0.4)";
      if (!boxColor) {
        vars["--video-surface"] = "rgba(12, 18, 32, 0.7)";
        vars["--video-surface-alt"] = "rgba(10, 16, 28, 0.76)";
        vars["--video-card"] = "rgba(10, 16, 30, 0.78)";
        vars["--video-input-bg"] = "rgba(12, 18, 32, 0.8)";
      }
    } else if (hasCustomBackground) {
      vars["--video-app-bg-image"] = "none";
    }
    if (boxColor) {
      vars["--video-box-bg"] = boxColor;
    }
    return style;
  }, [
    effectiveSettings.backgroundColor,
    effectiveSettings.backgroundImage,
    effectiveSettings.boxColor,
  ]);

  useEffect(() => {
    if (appSettings || typeof window === "undefined") return;
    setLocalSettings(loadSettings(localStorage.getItem(settingsStorageKey)));
  }, [appSettings, settingsStorageKey]);

  useEffect(() => {
    if (appSettings || typeof window === "undefined") return;
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== settingsStorageKey) return;
      setLocalSettings(loadSettings(event.newValue));
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [appSettings, settingsStorageKey]);

  const [chatInput, setChatInput] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [chatTextSize, setChatTextSize] = useState<"sm" | "md" | "lg">("md");
  const [emojiMode, setEmojiMode] = useState<"2d" | "3d">("2d");
  const [emojiCategoryId, setEmojiCategoryId] = useState(EMOJI_CATEGORIES[0]?.id || "smileys");
  const [emoji3dCategoryId, setEmoji3dCategoryId] = useState(
    EMOJI_3D_CATEGORIES[0]?.id || "celebrate-3d"
  );
  const [gifCategoryId, setGifCategoryId] = useState(GIF_CATEGORIES[0]?.id || "trending");
  const [gifSearch, setGifSearch] = useState("");
  const [activeReactionMessageId, setActiveReactionMessageId] = useState<string | null>(null);
  const [messageReactions, setMessageReactions] = useState<
    Record<string, Record<string, string[]>>
  >({});
  const [emoji3dErrors, setEmoji3dErrors] = useState<Record<string, boolean>>({});
  const [linkMeta, setLinkMeta] = useState<Record<string, LinkMeta>>({});
  const linkMetaRef = useRef(linkMeta);
  const [isRemoteMuted, setIsRemoteMuted] = useState(false);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"call" | "theme">("call");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [screenViewMode, setScreenViewMode] = useState<"split" | "screen" | "video">("split");
  const [focusedScreenId, setFocusedScreenId] = useState<string | null>(null);
  const [focusedVideoId, setFocusedVideoId] = useState<string | null>(null);
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [isScreenBorderless, setIsScreenBorderless] = useState(false);
  const [fullscreenTargetId, setFullscreenTargetId] = useState<string | null>(null);
  const [isFullscreenActive, setIsFullscreenActive] = useState(false);
  const [isPopout, setIsPopout] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"video" | "chat">("video");
  const [pipPosition, setPipPosition] = useState<{ x: number; y: number } | null>(null);
  const [isPipDragging, setIsPipDragging] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [showViewSelect, setShowViewSelect] = useState(false);
  const [showScreenSelect, setShowScreenSelect] = useState(false);
  const [showCameraSelect, setShowCameraSelect] = useState(false);
  const viewSelectRef = useRef<HTMLDivElement | null>(null);
  const screenSelectRef = useRef<HTMLDivElement | null>(null);
  const cameraSelectRef = useRef<HTMLDivElement | null>(null);
  const [screenZoomLevels, setScreenZoomLevels] = useState<Record<string, number>>({});
  const [screenPanOffsets, setScreenPanOffsets] = useState<Record<string, PanOffset>>({});
  const [activePanTarget, setActivePanTarget] = useState<string | null>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioInputError, setAudioInputError] = useState<string | null>(null);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputError, setVideoInputError] = useState<string | null>(null);
  const [lowLatencyDismissed, setLowLatencyDismissed] = useState(false);
  const [showControlHelper, setShowControlHelper] = useState(false);
  const [controlHelperCode, setControlHelperCode] = useState("");
  const [controlHelperStatus, setControlHelperStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [controlHelperError, setControlHelperError] = useState<string | null>(null);
  const [controlHelperCopied, setControlHelperCopied] = useState(false);
  const [gifGridWidth, setGifGridWidth] = useState(0);
  const [popoutContainer, setPopoutContainer] = useState<HTMLDivElement | null>(null);
  const [popoutAudioBlocked, setPopoutAudioBlocked] = useState(false);
  const [dominantSpeakerId, setDominantSpeakerId] = useState<string | null>(null);
  const [fullscreenChatOverlay, setFullscreenChatOverlay] = useState(false);
  const [activeScreenSettingsId, setActiveScreenSettingsId] = useState<string | null>(null);
  const [demoParticipants, setDemoParticipants] = useState<VideoCallParticipant[]>([]);
  const [demoStreams, setDemoStreams] = useState<Record<string, MediaStream>>({});
  const [demoScreenStreams, setDemoScreenStreams] = useState<Record<string, MediaStream>>({});
  const gifGridRef = useRef<HTMLDivElement | null>(null);
  const ringtoneRef = useRef<{ audio: HTMLAudioElement | null }>({
    audio: null,
  });
  const holdAudioRef = useRef<HTMLAudioElement | null>(null);
  const messageSoundRef = useRef<HTMLAudioElement | null>(null);
  const lastMessageIdRef = useRef<string | null>(null);
  const ringbackRef = useRef<{ ctx: AudioContext | null; timer: number | null }>({
    ctx: null,
    timer: null,
  });
  const controlThrottleRef = useRef(0);
  const screenTileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const gridRef = useRef<HTMLDivElement | null>(null);
  const popoutWindowRef = useRef<Window | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnalyserRef = useRef<
    Map<
      string,
      {
        source: MediaStreamAudioSourceNode;
        analyser: AnalyserNode;
        data: Uint8Array<ArrayBuffer>;
      }
    >
  >(new Map());
  const speakerActivityRef = useRef<{ id: string | null; lastActiveAt: number }>({
    id: null,
    lastActiveAt: 0,
  });
  const prevHasScreenSharesRef = useRef(false);
  const screenPanOffsetsRef = useRef<Record<string, PanOffset>>({});
  const screenPanDragRef = useRef<{
    targetId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);
  const pipDragRef = useRef({ active: false, offsetX: 0, offsetY: 0 });
  const demoCleanupRef = useRef<Record<string, () => void>>({});
  const demoCounterRef = useRef(1);

  const showModal = isOpen || status === "incoming";
  const showCallUi = status === "in-call" || status === "connecting";
  const showChat = showCallUi && (isChatVisible || mobilePanel === "chat");
  const isChatHidden = showCallUi && !isChatVisible && mobilePanel !== "chat";
  const isRenderingInPopout = Boolean(isPopout && popoutContainer);
  const overlayClassName = `video-call-overlay video-theme${
    isRenderingInPopout ? " is-popout" : ""
  }`;
  const modalClassName = `video-call-modal${showCallUi ? "" : " is-setup"}${
    isChatHidden ? " is-chat-hidden" : ""
  }${mobilePanel === "chat" ? " is-mobile-chat" : " is-mobile-video"}${
    isRenderingInPopout ? " is-popout" : ""
  }`;
  const apiBase = useMemo(
    () => String(import.meta.env.VITE_API_URL || "").replace(/\/api$/, ""),
    []
  );
  const controlHelperApiBase = useMemo(() => {
    const override = String(import.meta.env.VITE_CONTROL_HELPER_URL || "").trim();
    const resolved = override || apiBase;
    return resolved.replace(/\/$/, "");
  }, [apiBase]);
  const desktopBridge =
    typeof window !== "undefined" ? window.yspDesktop ?? null : null;
  const isDesktopApp = Boolean(desktopBridge?.isAvailable);
  const isWindows = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /Win/i.test(navigator.userAgent || "");
  }, []);
  const windowsHelperDownloadUrl = "https://yoursocialplace.com/downloads/ysphelper.exe";

  useEffect(() => {
    screenPanOffsetsRef.current = screenPanOffsets;
  }, [screenPanOffsets]);

  useEffect(() => {
    if (!showCallUi) {
      setIsPopout(false);
      setMobilePanel("video");
    }
  }, [showCallUi]);

  useEffect(() => {
    if (!isRenderingInPopout) {
      setPopoutAudioBlocked(false);
    }
  }, [isRenderingInPopout]);

  useEffect(() => {
    if (!isPopout) {
      if (popoutWindowRef.current && !popoutWindowRef.current.closed) {
        popoutWindowRef.current.close();
      }
      popoutWindowRef.current = null;
      setPopoutContainer(null);
      return;
    }

    const nextWindow = window.open(
      "",
      "Your Social Place Video Call",
      "popup=yes,width=1120,height=760,resizable=yes"
    );
    if (!nextWindow) {
      setIsPopout(false);
      return;
    }

    popoutWindowRef.current = nextWindow;
    nextWindow.document.title = "Your Social Place - Video call";
    nextWindow.document.body.style.margin = "0";
    nextWindow.document.body.style.background = "#05070f";

    const container = nextWindow.document.createElement("div");
    container.id = "video-call-popout-root";
    nextWindow.document.body.appendChild(container);

    const head = nextWindow.document.head;
    document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
      head.appendChild(node.cloneNode(true));
    });

    setPopoutContainer(container);

    const handleBeforeUnload = () => {
      setIsPopout(false);
    };

    nextWindow.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      nextWindow.removeEventListener("beforeunload", handleBeforeUnload);
      if (!nextWindow.closed) {
        nextWindow.close();
      }
    };
  }, [isPopout]);

  useEffect(() => {
    if (!showGifPicker) return;
    const node = gifGridRef.current;
    if (!node) return;
    const updateWidth = () => {
      const nextWidth = node.clientWidth || node.offsetWidth;
      if (nextWidth) setGifGridWidth(nextWidth);
    };
    updateWidth();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(node);
    return () => observer.disconnect();
  }, [showGifPicker]);


  const demoParticipantRecord = useMemo(() => {
    const record: Record<string, VideoCallParticipant> = {};
    demoParticipants.forEach((participant) => {
      record[participant.socketId] = participant;
    });
    return record;
  }, [demoParticipants]);

  const mergedRemoteParticipants = useMemo(
    () =>
      demoParticipants.length
        ? { ...remoteParticipants, ...demoParticipantRecord }
        : remoteParticipants,
    [demoParticipantRecord, demoParticipants.length, remoteParticipants]
  );

  const mergedRemoteStreams = useMemo(
    () =>
      demoParticipants.length ? { ...remoteStreams, ...demoStreams } : remoteStreams,
    [demoParticipants.length, demoStreams, remoteStreams]
  );

  const mergedRemoteScreenStreams = useMemo(
    () =>
      demoParticipants.length
        ? { ...remoteScreenStreams, ...demoScreenStreams }
        : remoteScreenStreams,
    [demoParticipants.length, demoScreenStreams, remoteScreenStreams]
  );

  const remoteList = useMemo(
    () => Object.values(mergedRemoteParticipants),
    [mergedRemoteParticipants]
  );
  const remoteAudioStreams = useMemo(
    () =>
      Object.entries(mergedRemoteStreams)
        .filter(([, stream]) =>
          stream
            .getAudioTracks()
            .some((track) => track.enabled && track.readyState === "live")
        )
        .map(([socketId, stream]) => ({ socketId, stream })),
    [mergedRemoteStreams]
  );
  const participantNameById = useMemo(() => {
    const map = new Map<number, string>();
    Object.values(mergedRemoteParticipants).forEach((participant) => {
      if (participant.userId && participant.displayName) {
        map.set(participant.userId, participant.displayName);
      }
    });
    selectedInvitees.forEach((invitee) => {
      if (invitee.userId && invitee.displayName) {
        map.set(invitee.userId, invitee.displayName);
      }
    });
    friends.forEach((friend) => {
      if (friend.userId && friend.displayName) {
        map.set(friend.userId, friend.displayName);
      }
    });
    return map;
  }, [friends, mergedRemoteParticipants, selectedInvitees]);
  const resolveParticipantLabel = useCallback(
    (options: {
      userId?: number;
      displayName?: string;
      handle?: string;
      fallback?: string;
    }) => {
      const fromMap = options.userId ? participantNameById.get(options.userId) : undefined;
      const candidates = [fromMap, options.displayName, options.fallback]
        .map((value) => String(value || "").trim())
        .filter((value) => value.length > 0);
      for (const candidate of candidates) {
        if (!candidate.includes("@")) {
          return candidate;
        }
      }
      const handle = String(options.handle || "").trim();
      if (handle) return handle;
      if (options.userId) return `User ${options.userId}`;
      return "User";
    },
    [participantNameById]
  );

  const remoteVideoParticipants = useMemo<VideoParticipantEntry[]>(
    () =>
      remoteList.map((participant) => ({
        id: participant.socketId,
        stream: mergedRemoteStreams[participant.socketId] || null,
        label: resolveParticipantLabel({
          userId: participant.userId,
          displayName: participant.displayName,
          handle: participant.handle,
        }),
        avatarUrl: participant.avatarUrl,
        isLocal: false,
        status: mergedRemoteStreams[participant.socketId] ? "" : "Waiting for video",
      })),
    [mergedRemoteStreams, remoteList, resolveParticipantLabel]
  );

  const localVideoParticipant = useMemo<VideoParticipantEntry>(
    () => ({
      id: "local",
      stream: localStream,
      label: "You",
      avatarUrl: profile?.avatarUrl,
      isLocal: true,
      status: !localStream || !isVideoEnabled ? "Camera off" : "",
    }),
    [isVideoEnabled, localStream, profile?.avatarUrl]
  );

  const videoParticipants = useMemo<VideoParticipantEntry[]>(
    () => [...remoteVideoParticipants, localVideoParticipant],
    [localVideoParticipant, remoteVideoParticipants]
  );

  const videoParticipantById = useMemo(() => {
    const map = new Map<string, VideoParticipantEntry>();
    videoParticipants.forEach((participant) => {
      map.set(participant.id, participant);
    });
    return map;
  }, [videoParticipants]);

  useEffect(() => {
    if (!showCallUi) {
      setDominantSpeakerId(null);
      return;
    }
    if (typeof window === "undefined") return;
    const AudioContextCtor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextCtor();
    }
    const audioContext = audioContextRef.current;
    audioContext.resume().catch(() => undefined);

    const analyserMap = audioAnalyserRef.current;
    const activeKeys = new Set<string>();

    const attachAnalyser = (key: string, stream: MediaStream | null | undefined) => {
      if (!stream) return;
      const hasAudio = stream
        .getAudioTracks()
        .some((track) => track.readyState === "live");
      if (!hasAudio) return;
      activeKeys.add(key);
      if (analyserMap.has(key)) return;
      try {
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserMap.set(key, {
          source,
          analyser,
          data: new Uint8Array(new ArrayBuffer(analyser.fftSize)),
        });
      } catch {
        // ignore audio analyser failures
      }
    };

    attachAnalyser("local", localStream);
    Object.entries(mergedRemoteStreams).forEach(([socketId, stream]) => {
      attachAnalyser(socketId, stream);
    });

    analyserMap.forEach((entry, key) => {
      if (activeKeys.has(key)) return;
      try {
        entry.source.disconnect();
        entry.analyser.disconnect();
      } catch {
        // ignore disconnect errors
      }
      analyserMap.delete(key);
    });

    const threshold = 0.02;
    const holdMs = 2500;
    let active = true;

    const tick = () => {
      if (!active) return;
      let topId: string | null = null;
      let topLevel = 0;
      analyserMap.forEach((entry, key) => {
        entry.analyser.getByteTimeDomainData(entry.data);
        let sum = 0;
        for (let i = 0; i < entry.data.length; i += 1) {
          const value = (entry.data[i] - 128) / 128;
          sum += value * value;
        }
        const rms = Math.sqrt(sum / entry.data.length);
        if (rms > topLevel) {
          topLevel = rms;
          topId = key;
        }
      });
      const now = Date.now();
      if (topId && topLevel >= threshold) {
        speakerActivityRef.current = { id: topId, lastActiveAt: now };
      }
      const current = speakerActivityRef.current;
      const nextId =
        current.id && now - current.lastActiveAt < holdMs ? current.id : null;
      setDominantSpeakerId(nextId);
    };

    const interval = window.setInterval(tick, 700);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [localStream, mergedRemoteStreams, showCallUi]);
  const resolveMessageName = useCallback(
    (message: VideoCallMessage) => {
      if (user?.id && message.from.userId === user.id) {
        return "Me";
      }
      return resolveParticipantLabel({
        userId: message.from.userId,
        displayName: message.from.displayName,
        handle: message.from.handle,
      });
    },
    [resolveParticipantLabel, user?.id]
  );
  const giphyApiKey = String(import.meta.env.VITE_GIPHY_API_KEY || "");
  const giphyFetch = useMemo(
    () => (giphyApiKey ? new GiphyFetch(giphyApiKey) : null),
    [giphyApiKey]
  );
  const canUseGiphy = Boolean(giphyFetch);
  const currentUserKey = user?.id ? `user-${user.id}` : "me";
  const activeEmojiCategory =
    EMOJI_CATEGORIES.find((category) => category.id === emojiCategoryId) ||
    EMOJI_CATEGORIES[0];
  const activeEmoji3dCategory =
    EMOJI_3D_CATEGORIES.find((category) => category.id === emoji3dCategoryId) ||
    EMOJI_3D_CATEGORIES[0];
  const activeGifCategory =
    GIF_CATEGORIES.find((category) => category.id === gifCategoryId) ||
    GIF_CATEGORIES[0];
  const gifQuery = useMemo(() => {
    const trimmed = gifSearch.trim();
    if (trimmed) return trimmed;
    if (activeGifCategory.id !== "trending") {
      return activeGifCategory.query || activeGifCategory.label;
    }
    return "";
  }, [activeGifCategory, gifSearch]);
  const gifGridKey = useMemo(
    () => `${activeGifCategory.id}-${gifQuery || "trending"}`,
    [activeGifCategory.id, gifQuery]
  );
  const gifGridColumns = useMemo(() => {
    if (gifGridWidth >= 420) return 3;
    if (gifGridWidth >= 280) return 2;
    return 1;
  }, [gifGridWidth]);
  const incomingHostName = useMemo(() => {
    if (!incomingCall) return "Caller";
    return resolveParticipantLabel({
      userId: incomingCall.hostId,
      displayName: incomingCall.hostName,
      handle: incomingCall.hostHandle,
    });
  }, [incomingCall, resolveParticipantLabel]);
  const localDisplayName = useMemo(() => {
    const first = String(profile?.firstName || "").trim();
    const last = String(profile?.lastName || "").trim();
    const combined = [first, last].filter(Boolean).join(" ").trim();
    if (combined) return combined;
    return "You";
  }, [profile?.firstName, profile?.lastName]);
  const hasRemoteMedia = useMemo(() => {
    if (remoteList.length > 0) return true;
    if (Object.keys(mergedRemoteStreams).length > 0) return true;
    return Object.keys(mergedRemoteScreenStreams).length > 0;
  }, [mergedRemoteScreenStreams, mergedRemoteStreams, remoteList.length]);

  const screenShareEntries = useMemo(() => {
    const entries: Array<{
      id: string;
      stream: MediaStream;
      label: string;
      isLocal: boolean;
      socketId?: string;
    }> = [];
    if (localScreenStream) {
      const trackLabel = localScreenStream.getVideoTracks()?.[0]?.label || "";
      const defaultLabel =
        localDisplayName === "You" ? "Your screen" : `${localDisplayName}'s screen`;
      const localScreenLabel = formatScreenShareLabel(trackLabel, defaultLabel);
      entries.push({
        id: "local",
        stream: localScreenStream,
        label: localScreenLabel,
        isLocal: true,
      });
    }
    Object.entries(mergedRemoteScreenStreams).forEach(([socketId, stream]) => {
      const participant = mergedRemoteParticipants[socketId];
      const name = resolveParticipantLabel({
        userId: participant?.userId,
        displayName: participant?.displayName,
        handle: participant?.handle,
      });
      entries.push({
        id: socketId,
        stream,
        label: `${name}'s screen`,
        isLocal: false,
        socketId,
      });
    });
    return entries;
  }, [
    localScreenStream,
    localDisplayName,
    mergedRemoteParticipants,
    mergedRemoteScreenStreams,
    resolveParticipantLabel,
  ]);

  const getScreenFocusKey = useCallback(
    (entry: { id: string; socketId?: string; isLocal: boolean }) =>
      entry.isLocal ? "local" : entry.socketId || entry.id,
    []
  );
  const getScreenTileId = useCallback(
    (entry: { id: string; socketId?: string; isLocal: boolean }) =>
      entry.isLocal ? "screen-local" : `screen-${entry.socketId || entry.id}`,
    []
  );

  const isMobileCameraOnly = isMobileLayout;
  const hasScreenShares = screenShareEntries.length > 0;
  const hasRemoteScreenShares = screenShareEntries.some((entry) => !entry.isLocal);
  const effectiveViewMode = isMobileCameraOnly
    ? "video"
    : hasScreenShares
    ? screenViewMode
    : "video";
  const screenShareStatusLabel = useMemo(() => {
    if (isMobileCameraOnly) return "";
    if (!showCallUi) return "";
    if (localScreenStream && screenShareEntries[0]?.isLocal) {
      return `Sharing ${screenShareEntries[0].label}`;
    }
    if (hasScreenShares) {
      const activeEntry =
        screenShareEntries.find((entry) => !entry.isLocal) || screenShareEntries[0];
      return activeEntry ? `Viewing ${activeEntry.label}` : "";
    }
    return "";
  }, [hasScreenShares, isMobileCameraOnly, localScreenStream, screenShareEntries, showCallUi]);
  const showScreenTiles = effectiveViewMode !== "video";
  const showVideoTiles = effectiveViewMode !== "screen";
  const shouldRenderRemoteAudio =
    showCallUi && (!showVideoTiles || isRenderingInPopout);
  const totalParticipantCount = videoParticipants.length;
  const presenterMode =
    !isMobileCameraOnly &&
    showCallUi &&
    showVideoTiles &&
    !showScreenTiles &&
    totalParticipantCount > 2;
  const focusedScreenKey = effectiveViewMode === "screen" ? focusedScreenId : null;
  const focusedVideoKey = effectiveViewMode === "video" ? focusedVideoId : null;
  const visibleScreenShareEntries = useMemo(() => {
    if (!focusedScreenKey) return screenShareEntries;
    return screenShareEntries.filter(
      (entry) => getScreenFocusKey(entry) === focusedScreenKey
    );
  }, [focusedScreenKey, getScreenFocusKey, screenShareEntries]);
  const focusedRemoteMissing = Boolean(
    focusedVideoKey &&
      focusedVideoKey !== "local" &&
      !mergedRemoteParticipants[focusedVideoKey]
  );
  const visibleVideoParticipants = useMemo(() => {
    if (presenterMode) return remoteList;
    if (!focusedVideoKey || focusedRemoteMissing) return remoteList;
    if (focusedVideoKey === "local") return [];
    const participant = mergedRemoteParticipants[focusedVideoKey];
    return participant ? [participant] : [];
  }, [
    focusedRemoteMissing,
    focusedVideoKey,
    mergedRemoteParticipants,
    presenterMode,
    remoteList,
  ]);
  const showLocalVideo =
    !focusedVideoKey || focusedVideoKey === "local" || focusedRemoteMissing;
  const isLocalFocused = focusedVideoKey === "local";
  const basePrimaryVideoSocketId = focusedVideoKey || remoteList[0]?.socketId || "local";
  const presenterTargetId = presenterMode
    ? focusedVideoKey || dominantSpeakerId || basePrimaryVideoSocketId
    : null;
  const primaryVideoSocketId = presenterMode
    ? presenterTargetId || basePrimaryVideoSocketId
    : basePrimaryVideoSocketId;
  const isLocalPrimary = primaryVideoSocketId === "local";
  const presenterParticipant = presenterMode
    ? videoParticipantById.get(presenterTargetId || "local") || localVideoParticipant
    : null;
  const presenterOthers = presenterMode
    ? videoParticipants.filter((participant) => participant.id !== presenterParticipant?.id)
    : [];
  const isSplitView = effectiveViewMode === "split";
  const splitScreenEntry = useMemo(() => {
    if (!isSplitView || !showScreenTiles) return null;
    if (!screenShareEntries.length) return null;
    if (focusedScreenId) {
      const focused = screenShareEntries.find(
        (entry) => getScreenFocusKey(entry) === focusedScreenId
      );
      if (focused) return focused;
    }
    const remoteEntry = screenShareEntries.find((entry) => !entry.isLocal);
    return remoteEntry || screenShareEntries[0] || null;
  }, [
    focusedScreenId,
    getScreenFocusKey,
    isSplitView,
    screenShareEntries,
    showScreenTiles,
  ]);
  const primaryScreenTileId = useMemo(() => {
    const entries = isSplitView && splitScreenEntry ? [splitScreenEntry] : visibleScreenShareEntries;
    if (!showScreenTiles || entries.length === 0) return null;
    const remoteEntry = entries.find((entry) => !entry.isLocal);
    const entry = remoteEntry || entries[0];
    if (!entry) return null;
    return entry.isLocal ? "screen-local" : `screen-${entry.socketId || entry.id}`;
  }, [isSplitView, showScreenTiles, splitScreenEntry, visibleScreenShareEntries]);
  const gridClassName = `video-call-grid${
    effectiveViewMode === "screen"
      ? " is-screen-only"
      : effectiveViewMode === "video"
      ? " is-video-only"
      : " is-split"
  }${presenterMode ? " is-presenter" : ""}${
    isScreenBorderless ? " is-borderless" : ""
  }`;
  const screenEntriesToRender =
    isSplitView && splitScreenEntry ? [splitScreenEntry] : visibleScreenShareEntries;

  const splitCameraParticipants = useMemo(() => {
    if (!isSplitView || !showVideoTiles) return [];
    const ordered = [...videoParticipants];
    if (focusedVideoId) {
      const focusIndex = ordered.findIndex((entry) => entry.id === focusedVideoId);
      if (focusIndex > -1) {
        const [focused] = ordered.splice(focusIndex, 1);
        ordered.unshift(focused);
      }
    }
    const top = ordered.slice(0, 3);
    const localParticipant = ordered.find((entry) => entry.isLocal);
    if (localParticipant && !top.some((entry) => entry.isLocal)) {
      if (top.length < 3) {
        top.push(localParticipant);
      } else {
        top[top.length - 1] = localParticipant;
      }
    }
    return top;
  }, [focusedVideoId, isSplitView, showVideoTiles, videoParticipants]);

  useEffect(() => {
    if (isMobileCameraOnly) {
      prevHasScreenSharesRef.current = hasScreenShares;
      return;
    }
    if (hasScreenShares && !prevHasScreenSharesRef.current && screenViewMode === "video") {
      setScreenViewMode("split");
    }
    prevHasScreenSharesRef.current = hasScreenShares;
  }, [hasScreenShares, isMobileCameraOnly, screenViewMode]);

  useEffect(() => {
    if (!focusedScreenId) return;
    const exists = screenShareEntries.some(
      (entry) => getScreenFocusKey(entry) === focusedScreenId
    );
    if (!exists) {
      setFocusedScreenId(null);
    }
  }, [focusedScreenId, getScreenFocusKey, screenShareEntries]);

  useEffect(() => {
    if (!focusedVideoId) return;
    if (focusedVideoId === "local") return;
    if (!mergedRemoteParticipants[focusedVideoId]) {
      setFocusedVideoId(null);
    }
  }, [focusedVideoId, mergedRemoteParticipants]);

  useEffect(() => {
    if (!activeScreenSettingsId) return;
    if (!isMobileLayout) {
      setActiveScreenSettingsId(null);
      return;
    }
    const exists = visibleScreenShareEntries.some(
      (entry) => getScreenTileId(entry) === activeScreenSettingsId
    );
    if (!exists) {
      setActiveScreenSettingsId(null);
    }
  }, [
    activeScreenSettingsId,
    getScreenTileId,
    isMobileLayout,
    visibleScreenShareEntries,
  ]);

  const toggleScreenFocus = useCallback(
    (entry: { id: string; socketId?: string; isLocal: boolean }) => {
      const key = getScreenFocusKey(entry);
      setScreenViewMode("screen");
      setFocusedVideoId(null);
      setFocusedScreenId((prev) => (prev === key ? null : key));
    },
    [getScreenFocusKey]
  );

  const toggleVideoFocus = useCallback((targetId: string) => {
    setScreenViewMode("video");
    setFocusedScreenId(null);
    setFocusedVideoId((prev) => (prev === targetId ? null : targetId));
  }, []);

  const selectScreenShareFocus = useCallback((key: string | null) => {
    setFocusedScreenId(key);
  }, []);

  const selectVideoFeedFocus = useCallback((targetId: string | null) => {
    setFocusedVideoId(targetId);
  }, []);

  const handleToggleChatVisibility = useCallback(() => {
    if (fullscreenTargetId) {
      setFullscreenChatOverlay((prev) => !prev);
      return;
    }
    const nextShow = !showChat;
    setIsChatVisible(nextShow);
    if (isMobileLayout) {
      setMobilePanel(nextShow ? "chat" : "video");
    }
  }, [fullscreenTargetId, isMobileLayout, showChat]);

  const localEffectClass = useMemo(() => {
    const classes = [];
    if (videoEffects.background !== "none") {
      classes.push(`has-backdrop-${videoEffects.background}`);
    }
    return classes.join(" ");
  }, [videoEffects.background]);

  const isFullscreenUi = isFullscreenActive || Boolean(fullscreenTargetId);
  const showFocusControls = !isFullscreenUi && !isMobileCameraOnly;

  const renderCompactVideoTile = useCallback(
    (participant: VideoParticipantEntry, options?: { style?: CSSProperties; className?: string }) => {
      const isFocused = focusedVideoKey === participant.id;
      const isPrimary = participant.id === primaryVideoSocketId;
      const baseClass = participant.isLocal
        ? `is-local is-self-video${isPrimary ? " is-primary" : ""}${
            localEffectClass ? ` ${localEffectClass}` : ""
          }`
        : isPrimary
        ? "is-primary"
        : "";
      return (
        <VideoTile
          key={participant.id}
          stream={participant.stream}
          label={participant.label}
          avatarUrl={participant.avatarUrl}
          muted={participant.isLocal || isRenderingInPopout}
          status={participant.status}
          className={`${baseClass}${options?.className ? ` ${options.className}` : ""}`}
          style={options?.style}
        >
          {showFocusControls && (
            <div className="video-tile__actions">
              <button
                type="button"
                className={`video-tile-focus${isFocused ? " is-active" : ""}`}
                onClick={() => toggleVideoFocus(participant.id)}
                aria-pressed={isFocused}
              >
                {isFocused ? "Show all" : "Focus"}
              </button>
            </div>
          )}
        </VideoTile>
      );
    },
    [
      focusedVideoKey,
      isRenderingInPopout,
      localEffectClass,
      primaryVideoSocketId,
      showFocusControls,
      toggleVideoFocus,
    ]
  );

  useEffect(() => {
    const targetWindow = isRenderingInPopout ? popoutWindowRef.current : window;
    if (!targetWindow || !targetWindow.matchMedia) return;
    const media = targetWindow.matchMedia(
      "(max-width: 720px), (max-width: 1024px) and (pointer: coarse)"
    );
    const handleChange = () => setIsMobileLayout(media.matches);
    handleChange();
    if (media.addEventListener) {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, [isRenderingInPopout]);

  useEffect(() => {
    if (!isMobileLayout) return;
    if (isPopout) setIsPopout(false);
    if (screenViewMode !== "video") setScreenViewMode("video");
    if (focusedScreenId) setFocusedScreenId(null);
    if (focusedVideoId) setFocusedVideoId(null);
    if (isScreenBorderless) setIsScreenBorderless(false);
    if (showViewSelect) setShowViewSelect(false);
    if (showScreenSelect) setShowScreenSelect(false);
    if (showCameraSelect) setShowCameraSelect(false);
    if (isScreenSharing) stopScreenShare();
    setPipPosition(null);
    setIsPipDragging(false);
    pipDragRef.current.active = false;
  }, [
    focusedScreenId,
    focusedVideoId,
    isMobileLayout,
    isPopout,
    isScreenBorderless,
    isScreenSharing,
    mobilePanel,
    screenViewMode,
    showCameraSelect,
    showScreenSelect,
    showViewSelect,
    stopScreenShare,
  ]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    let active = true;
    const loadDevices = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const inputs = devices.filter((device) => device.kind === "audioinput");
        const cameras = devices.filter((device) => device.kind === "videoinput");
        if (active) {
          setAudioInputs(inputs);
          setVideoInputs(cameras);
          setAudioInputError(null);
          setVideoInputError(null);
        }
      } catch {
        if (active) {
          setAudioInputError("Unable to load microphones.");
          setVideoInputError("Unable to load cameras.");
        }
      }
    };
    void loadDevices();
    const handleChange = () => {
      void loadDevices();
    };
    navigator.mediaDevices.addEventListener?.("devicechange", handleChange);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener?.("devicechange", handleChange);
    };
  }, [showCallUi]);

  useEffect(() => {
    if (!showCallUi || !isMobileLayout || isLocalPrimary) {
      setPipPosition(null);
      setIsPipDragging(false);
      pipDragRef.current.active = false;
    }
  }, [isLocalPrimary, isMobileLayout, showCallUi]);

  const handlePipPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isMobileLayout || isLocalPrimary || isMobileCameraOnly) return;
      const grid = gridRef.current;
      if (!grid) return;
      const tile = event.currentTarget;
      const gridRect = grid.getBoundingClientRect();
      const tileRect = tile.getBoundingClientRect();
      if (!gridRect.width || !gridRect.height) return;
      pipDragRef.current.active = true;
      pipDragRef.current.offsetX = event.clientX - tileRect.left;
      pipDragRef.current.offsetY = event.clientY - tileRect.top;
      setPipPosition({
        x: tileRect.left - gridRect.left,
        y: tileRect.top - gridRect.top,
      });
      setIsPipDragging(true);
      tile.setPointerCapture?.(event.pointerId);
    },
    [isLocalPrimary, isMobileCameraOnly, isMobileLayout]
  );

  const handlePipPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (
        !pipDragRef.current.active ||
        !isMobileLayout ||
        isLocalPrimary ||
        isMobileCameraOnly
      )
        return;
      const grid = gridRef.current;
      if (!grid) return;
      const gridRect = grid.getBoundingClientRect();
      const tile = event.currentTarget;
      const width = tile.offsetWidth;
      const height = tile.offsetHeight;
      if (!gridRect.width || !gridRect.height || !width || !height) return;
      let nextX = event.clientX - gridRect.left - pipDragRef.current.offsetX;
      let nextY = event.clientY - gridRect.top - pipDragRef.current.offsetY;
      nextX = Math.min(Math.max(0, nextX), gridRect.width - width);
      nextY = Math.min(Math.max(0, nextY), gridRect.height - height);
      setPipPosition({ x: nextX, y: nextY });
    },
    [isLocalPrimary, isMobileCameraOnly, isMobileLayout]
  );

  const handlePipPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!pipDragRef.current.active || isMobileCameraOnly) return;
    pipDragRef.current.active = false;
    setIsPipDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, [isMobileCameraOnly]);

  const pipStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isMobileLayout || isLocalPrimary || !pipPosition) return undefined;
    return {
      left: `${pipPosition.x}px`,
      top: `${pipPosition.y}px`,
      right: "auto",
      bottom: "auto",
    };
  }, [isLocalPrimary, isMobileLayout, pipPosition]);

  const registerScreenTile = useCallback((id: string) => {
    return (node: HTMLDivElement | null) => {
      if (node) {
        screenTileRefs.current.set(id, node);
      } else {
        screenTileRefs.current.delete(id);
      }
    };
  }, []);

  const toggleFullscreen = useCallback((targetId: string) => {
    const node = screenTileRefs.current.get(targetId);
    if (!node) return;
    if (document.fullscreenElement) {
      if (document.fullscreenElement === node) {
        document.exitFullscreen().catch(() => undefined);
        return;
      }
      document.exitFullscreen().catch(() => undefined);
    }
    const requestFullscreen =
      (node as any).requestFullscreen ||
      (node as any).webkitRequestFullscreen ||
      (node as any).mozRequestFullScreen ||
      (node as any).msRequestFullscreen;
    if (requestFullscreen) {
      try {
        const result = requestFullscreen.call(node);
        if (result && typeof result.catch === "function") {
          result.catch(() => {
            document.documentElement.requestFullscreen?.().catch(() => undefined);
            desktopBridge?.toggleFullScreen?.();
          });
        }
        return;
      } catch {
        // fall through to fallback
      }
    }

    document.documentElement.requestFullscreen?.().catch(() => undefined);
    desktopBridge?.toggleFullScreen?.();
  }, [desktopBridge]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const element = document.fullscreenElement as HTMLElement | null;
      const id = element?.dataset?.screenId || null;
      setFullscreenTargetId(id);
      setIsFullscreenActive(Boolean(element));
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (fullscreenTargetId) return;
    setFullscreenChatOverlay(false);
  }, [fullscreenTargetId]);

  const previewStatus = !localStream ? "Camera off" : isVideoEnabled ? "" : "Camera off";
  const micSelectionValue = selectedAudioInputId || "default";
  const showMicSelector = audioInputs.length > 1;
  const cameraSelectionValue = selectedVideoInputId || "default";
  const showCameraSelector = videoInputs.length > 1;
  const chatFontSize = chatTextSize === "sm" ? 13 : chatTextSize === "lg" ? 17 : 15;
  const chatStyle = useMemo(
    () =>
      ({
        "--video-chat-text-size": `${chatFontSize}px`,
      }) as CSSProperties,
    [chatFontSize]
  );
  const orderedMessages = useMemo(
    () =>
      [...messages].sort(
        (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
      ),
    [messages]
  );

  useEffect(() => {
    linkMetaRef.current = linkMeta;
  }, [linkMeta]);

  const fetchPreviewMeta = useCallback(async (url: string, fallbackImage?: string) => {
    if (!url || linkMetaRef.current[url]) return;
    try {
      const res = await api.get("/link-preview", { params: { url } });
      const data = res.data?.data ?? res.data ?? {};
      setLinkMeta((prev) => ({
        ...prev,
        [url]: {
          title: data?.title || data?.siteName || formatUrlLabel(url),
          description: data?.description || "",
          siteName: data?.siteName || "",
          image: data?.image || fallbackImage,
        },
      }));
    } catch {
      setLinkMeta((prev) => ({
        ...prev,
        [url]: {
          title: formatUrlLabel(url),
          image: fallbackImage,
        },
      }));
    }
  }, []);

  useEffect(() => {
    if (!messages.length) return;
    messages.forEach((message) => {
      if (message.kind !== "text") return;
      const urls = extractLinks(message.body || "");
      urls.forEach((url) => {
        const ytId = parseYouTubeId(url);
        const fallback = ytId
          ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`
          : undefined;
        const existing = linkMetaRef.current[url];
        if (!existing) {
          fetchPreviewMeta(url, fallback);
        } else if (fallback && !existing.image) {
          setLinkMeta((prev) => ({
            ...prev,
            [url]: { ...prev[url], image: fallback },
          }));
        }
      });
    });
  }, [fetchPreviewMeta, messages]);
  const overlayMessages = useMemo(
    () => orderedMessages.slice(0, 6).reverse(),
    [orderedMessages]
  );

  useEffect(() => {
    if (!showCallUi) {
      lastMessageIdRef.current = null;
    }
  }, [showCallUi]);

  useEffect(() => {
    if (!showCallUi) return;
    if (profile?.notificationSettings?.soundEnabled === false) return;
    const latest = orderedMessages[0];
    if (!latest) return;
    if (lastMessageIdRef.current === latest.id) return;
    lastMessageIdRef.current = latest.id;
    if (latest.from.userId === user?.id) return;
    const audio = messageSoundRef.current ?? new Audio(messageSoundUrl);
    audio.volume = 0.6;
    audio.currentTime = 0;
    messageSoundRef.current = audio;
    audio.play().catch(() => undefined);
  }, [orderedMessages, profile?.notificationSettings?.soundEnabled, showCallUi, user?.id]);

  const totalParticipants = 1 + remoteList.length;
  const maxInvitees = maxParticipants - 1;
  const demoSlotsAvailable = Math.max(
    0,
    maxParticipants - 1 - Object.keys(remoteParticipants).length - demoParticipants.length
  );
  const demoStatusLabel =
    demoParticipants.length > 0
      ? `${demoParticipants.length} demo ${
          demoParticipants.length === 1 ? "user" : "users"
        } active`
      : "No demo users";

  const toggleInvitee = (invitee: VideoCallInvitee) => {
    const exists = selectedInvitees.some((entry) => entry.userId === invitee.userId);
    if (exists) {
      setSelectedInvitees(selectedInvitees.filter((entry) => entry.userId !== invitee.userId));
      setSelectionError(null);
      return;
    }
    if (selectedInvitees.length >= maxInvitees) {
      setSelectionError(`Max ${maxParticipants} participants per call.`);
      return;
    }
    setSelectedInvitees([...selectedInvitees, invitee]);
    setSelectionError(null);
  };

  const handleSend = () => {
    const sanitized = sanitizePostText(chatInput).trim();
    if (!sanitized) return;
    sendMessage(sanitized, "text");
    setChatInput("");
  };

  const handleEmojiPick = (emoji: string) => {
    setChatInput((prev) => `${prev}${emoji}`);
  };

  const handleAnimatedEmojiPick = (item: Emoji3dItem) => {
    setChatInput((prev) => `${prev}${buildEmoji3dToken(item.id)}`);
    setShowEmojiPicker(false);
  };

  const handleGifPick = (gifUrl: string) => {
    sendMessage(gifUrl, "gif", gifUrl);
    setShowGifPicker(false);
  };

  const toggleMessageReaction = useCallback(
    (messageId: string, emoji: string) => {
      setMessageReactions((prev) => {
        const messageMap = { ...(prev[messageId] || {}) };
        const existing = new Set(messageMap[emoji] || []);
        if (existing.has(currentUserKey)) {
          existing.delete(currentUserKey);
        } else {
          existing.add(currentUserKey);
        }
        if (existing.size === 0) {
          delete messageMap[emoji];
        } else {
          messageMap[emoji] = Array.from(existing);
        }
        return { ...prev, [messageId]: messageMap };
      });
    },
    [currentUserKey]
  );

  const openReactionPicker = useCallback((messageId: string) => {
    setActiveReactionMessageId((prev) => (prev === messageId ? null : messageId));
  }, []);

  const fetchGifs = useCallback(
    (offset: number) => {
      const params = { offset, limit: 18, rating: "pg-13" as const };
      if (!giphyFetch) {
        return Promise.resolve({
          data: [],
          pagination: { total_count: 0, count: 0, offset },
          meta: { status: 200, msg: "OK", response_id: "" },
        });
      }
      if (gifQuery) {
        return giphyFetch.search(gifQuery, params);
      }
      return giphyFetch.trending(params);
    },
    [giphyFetch, gifQuery]
  );

  const handleToggleScreenShare = useCallback(() => {
    if (isMobileCameraOnly) return;
    if (isScreenSharing) {
      stopScreenShare();
      return;
    }
    if (isPopout && popoutWindowRef.current) {
      try {
        popoutWindowRef.current.focus();
      } catch {
        // ignore focus errors
      }
      void startScreenShare({
        mediaDevices: popoutWindowRef.current.navigator?.mediaDevices,
      });
      return;
    }
    void startScreenShare();
  }, [isMobileCameraOnly, isPopout, isScreenSharing, startScreenShare, stopScreenShare]);

  const handleOpenSettings = useCallback(() => {
    setShowSettingsPanel(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    setShowSettingsPanel(false);
  }, []);

  const toggleScreenSettings = useCallback((targetId: string) => {
    setActiveScreenSettingsId((prev) => (prev === targetId ? null : targetId));
  }, []);

  const closeScreenSettings = useCallback(() => {
    setActiveScreenSettingsId(null);
  }, []);

  const handleEnablePopoutAudio = useCallback(() => {
    if (!popoutWindowRef.current) return;
    const media = popoutWindowRef.current.document.querySelectorAll("audio");
    if (!media.length) {
      setPopoutAudioBlocked(false);
      return;
    }
    const attempts = Array.from(media).map((node) =>
      node
        .play()
        .then(() => null)
        .catch((error) => error)
    );
    void Promise.all(attempts).then((results) => {
      const blocked = results.some(
        (error) => error && (error as Error).name === "NotAllowedError"
      );
      setPopoutAudioBlocked(blocked);
    });
  }, []);

  useEffect(() => {
    if (!isRenderingInPopout || !shouldRenderRemoteAudio) return;
    handleEnablePopoutAudio();
  }, [
    handleEnablePopoutAudio,
    isRenderingInPopout,
    remoteAudioStreams.length,
    shouldRenderRemoteAudio,
  ]);

  const isAdmin = user?.appRole === "admin";
  const isCallAdmin = Boolean(isCallHost);

  const createDemoCanvasStream = useCallback(
    (label: string, type: "camera" | "screen") => {
      if (typeof document === "undefined") return null;
      const canvas = document.createElement("canvas");
      const isScreen = type === "screen";
      canvas.width = isScreen ? 1280 : 640;
      canvas.height = isScreen ? 720 : 360;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      let rafId = 0;
      const baseHue = Math.floor(Math.random() * 360);
      const draw = () => {
        const now = new Date();
        ctx.fillStyle = `hsl(${baseHue}, 35%, 12%)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = `hsla(${baseHue + 40}, 70%, 35%, 0.25)`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#e2e8f0";
        ctx.font = `${isScreen ? 42 : 28}px "Inter", system-ui, sans-serif`;
        ctx.fillText(label, 30, 70);
        ctx.font = `${isScreen ? 28 : 18}px "Inter", system-ui, sans-serif`;
        ctx.fillStyle = "#94a3b8";
        ctx.fillText(now.toLocaleTimeString(), 30, 110);
        ctx.fillStyle = "rgba(255,255,255,0.08)";
        ctx.strokeStyle = "rgba(255,255,255,0.12)";
        ctx.lineWidth = 2;
        ctx.strokeRect(12, 12, canvas.width - 24, canvas.height - 24);
        rafId = window.requestAnimationFrame(draw);
      };
      draw();
      const stream = canvas.captureStream(15);
      const cleanup = () => {
        window.cancelAnimationFrame(rafId);
        stream.getTracks().forEach((track) => track.stop());
      };
      return { stream, cleanup };
    },
    []
  );

  const clearDemoParticipants = useCallback(() => {
    Object.values(demoCleanupRef.current).forEach((cleanup) => cleanup());
    demoCleanupRef.current = {};
    setDemoParticipants([]);
    setDemoStreams({});
    setDemoScreenStreams({});
  }, []);

  const addDemoParticipants = useCallback(
    (count: number) => {
      if (count <= 0) return;
      const additions: VideoCallParticipant[] = [];
      const nextStreams: Record<string, MediaStream> = {};
      const nextScreenStreams: Record<string, MediaStream> = {};
      const nextCleanups: Record<string, () => void> = {};

      for (let i = 0; i < count; i += 1) {
        const index = demoCounterRef.current;
        demoCounterRef.current += 1;
        const socketId = `demo-${index}`;
        const displayName = `Demo ${index}`;
        const cameraStream = createDemoCanvasStream(displayName, "camera");
        const screenStream = createDemoCanvasStream(`${displayName} Screen`, "screen");
        if (!cameraStream && !screenStream) continue;
        additions.push({
          socketId,
          userId: 900000 + index,
          displayName,
          handle: `demo${index}`,
        });
        if (cameraStream) {
          nextStreams[socketId] = cameraStream.stream;
        }
        if (screenStream) {
          nextScreenStreams[socketId] = screenStream.stream;
        }
        nextCleanups[socketId] = () => {
          cameraStream?.cleanup();
          screenStream?.cleanup();
        };
      }

      if (!additions.length) return;
      setDemoParticipants((prev) => [...prev, ...additions]);
      setDemoStreams((prev) => ({ ...prev, ...nextStreams }));
      setDemoScreenStreams((prev) => ({ ...prev, ...nextScreenStreams }));
      demoCleanupRef.current = { ...demoCleanupRef.current, ...nextCleanups };
    },
    [createDemoCanvasStream]
  );

  useEffect(() => {
    return () => {
      clearDemoParticipants();
    };
  }, [clearDemoParticipants]);

  const getScreenZoom = useCallback(
    (targetId: string) => screenZoomLevels[targetId] ?? 1,
    [screenZoomLevels]
  );

  const updateScreenZoom = useCallback((targetId: string, nextZoom: number) => {
    const clamped = Math.min(5, Math.max(1, nextZoom));
    setScreenZoomLevels((prev) => ({ ...prev, [targetId]: clamped }));
    setScreenPanOffsets((prev) => ({ ...prev, [targetId]: { x: 0, y: 0 } }));
    setActivePanTarget((prev) => (prev === targetId ? null : prev));
  }, []);

  const getScreenPan = useCallback(
    (targetId: string) => screenPanOffsets[targetId] ?? { x: 0, y: 0 },
    [screenPanOffsets]
  );

  const beginScreenPan = useCallback(
    (event: PointerEvent<HTMLDivElement>, targetId: string, zoom: number) => {
      if (zoom <= 1) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(".screen-share-actions") ||
        target?.closest(".screen-share-overlays") ||
        target?.closest(".screen-settings-modal") ||
        target?.closest(".screen-settings-overlay")
      )
        return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const extraX = Math.max(0, rect.width * zoom - rect.width);
      const extraY = Math.max(0, rect.height * zoom - rect.height);
      if (!extraX && !extraY) return;
      const current = screenPanOffsetsRef.current[targetId] ?? { x: 0, y: 0 };
      screenPanDragRef.current = {
        targetId,
        startX: event.clientX,
        startY: event.clientY,
        originX: current.x,
        originY: current.y,
        minX: -extraX / 2,
        maxX: extraX / 2,
        minY: -extraY / 2,
        maxY: extraY / 2,
      };
      setActivePanTarget(targetId);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    []
  );

  const updateScreenPan = useCallback(
    (event: PointerEvent<HTMLDivElement>, targetId: string) => {
      const dragState = screenPanDragRef.current;
      if (!dragState || dragState.targetId !== targetId) return;
      const deltaX = event.clientX - dragState.startX;
      const deltaY = event.clientY - dragState.startY;
      const nextX = clampValue(
        dragState.originX + deltaX,
        dragState.minX,
        dragState.maxX
      );
      const nextY = clampValue(
        dragState.originY + deltaY,
        dragState.minY,
        dragState.maxY
      );
      setScreenPanOffsets((prev) => ({
        ...prev,
        [targetId]: { x: nextX, y: nextY },
      }));
    },
    []
  );

  const endScreenPan = useCallback(
    (event: PointerEvent<HTMLDivElement>, targetId: string) => {
      const dragState = screenPanDragRef.current;
      if (!dragState || dragState.targetId !== targetId) return;
      screenPanDragRef.current = null;
      setActivePanTarget((prev) => (prev === targetId ? null : prev));
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    },
    []
  );

  const getControlPoint = useCallback(
    (
      clientX: number,
      clientY: number,
      targetSocketId: string,
      rect: DOMRect
    ) => {
      const zoom = getScreenZoom(targetSocketId);
      const pan = getScreenPan(targetSocketId);
      const rawX = clientX - rect.left - pan.x;
      const rawY = clientY - rect.top - pan.y;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      const scaledX = (rawX - centerX) / zoom + centerX;
      const scaledY = (rawY - centerY) / zoom + centerY;
      const x = Math.min(1, Math.max(0, scaledX / rect.width));
      const y = Math.min(1, Math.max(0, scaledY / rect.height));
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    },
    [getScreenPan, getScreenZoom]
  );

  const sendControlPointer = (
    event: PointerEvent<HTMLDivElement> | MouseEvent<HTMLDivElement>,
    targetSocketId: string,
    type: "move" | "click",
    button?: "left" | "right"
  ) => {
    if (screenControlTarget !== targetSocketId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = getControlPoint(event.clientX, event.clientY, targetSocketId, rect);
    if (!point) return;
    const now = performance.now();
    if (type === "move" && now - controlThrottleRef.current < 50) return;
    controlThrottleRef.current = now;
    sendScreenControlEvent(targetSocketId, {
      type,
      x: point.x,
      y: point.y,
      ...(button ? { button } : {}),
    });
  };

  const sendControlScroll = (
    event: WheelEvent<HTMLDivElement>,
    targetSocketId: string
  ) => {
    if (screenControlTarget !== targetSocketId) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest(".screen-share-actions") ||
      target?.closest(".screen-share-overlays") ||
      target?.closest(".screen-settings-modal") ||
      target?.closest(".screen-settings-overlay")
    )
      return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = getControlPoint(event.clientX, event.clientY, targetSocketId, rect);
    if (!point) return;
    event.preventDefault();
    sendScreenControlEvent(targetSocketId, {
      type: "scroll",
      x: point.x,
      y: point.y,
      deltaX: event.deltaX,
      deltaY: event.deltaY,
    });
  };

  const getControlHelperErrorMessage = (err: unknown) => {
    const fallback = "Unable to generate a connection code. Try again.";
    if (!err || typeof err !== "object") return fallback;
    const response = (err as { response?: { status?: number; data?: any } }).response;
    const status = response?.status;
    const serverMessage =
      response?.data?.error?.message || response?.data?.message || undefined;
    if (status === 401 || status === 403) {
      return "Session expired. Please log in again and retry.";
    }
    if (serverMessage && typeof serverMessage === "string") {
      return serverMessage;
    }
    if ("message" in err && typeof (err as Error).message === "string") {
      return (err as Error).message;
    }
    return fallback;
  };

  const generateControlHelperCode = useCallback(async (): Promise<string | null> => {
    if (!activeRoomId) {
      setControlHelperStatus("error");
      setControlHelperError("Start a call before enabling Windows control.");
      return null;
    }
    setControlHelperStatus("loading");
    setControlHelperError(null);
    try {
      const response = await api.post("/remote-control/token");
      const token = String(response.data?.token || "").trim();
      if (!token) {
        throw new Error("Missing token.");
      }
      const payload = JSON.stringify({
        token,
        roomId: activeRoomId,
        apiUrl: controlHelperApiBase,
      });
      const encoded = window.btoa(payload);
      const nextCode = `YSP-CTRL:${encoded}`;
      setControlHelperCode(nextCode);
      setControlHelperStatus("ready");
      return nextCode;
    } catch (err) {
      setControlHelperStatus("error");
      setControlHelperError(getControlHelperErrorMessage(err));
      console.warn("Failed to generate control helper code.", err);
      return null;
    }
  }, [activeRoomId, controlHelperApiBase]);

  const copyControlHelperCode = useCallback(async () => {
    if (!controlHelperCode) return;
    try {
      await navigator.clipboard.writeText(controlHelperCode);
      setControlHelperCopied(true);
      window.setTimeout(() => setControlHelperCopied(false), 1500);
    } catch {
      setControlHelperCopied(false);
    }
  }, [controlHelperCode]);

  const handleOpenHelper = useCallback(async () => {
    if (!desktopBridge?.openHelper) return;
    let code = controlHelperCode;
    if (!code) {
      code = (await generateControlHelperCode()) || "";
    }
    await desktopBridge.openHelper({
      code,
      autoConnect: Boolean(code),
    });
  }, [controlHelperCode, desktopBridge, generateControlHelperCode]);

  const closeControlHelper = useCallback(() => {
    setShowControlHelper(false);
    setControlHelperError(null);
    setControlHelperStatus("idle");
  }, []);

  const handleControlPointerDown = (
    event: PointerEvent<HTMLDivElement>,
    targetSocketId: string
  ) => {
    if (screenControlTarget !== targetSocketId) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus?.();
    sendControlPointer(event, targetSocketId, "move");
  };

  const handleControlPointerUp = (
    event: PointerEvent<HTMLDivElement>,
    targetSocketId: string
  ) => {
    if (screenControlTarget !== targetSocketId) return;
    const button = event.button === 2 ? "right" : "left";
    sendControlPointer(event, targetSocketId, "click", button);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const handleControlContextMenu = (
    event: MouseEvent<HTMLDivElement>,
    targetSocketId: string
  ) => {
    if (screenControlTarget !== targetSocketId) return;
    event.preventDefault();
  };

  const shouldIgnoreControlKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (!target) return false;
    if (target.closest("input, textarea, [contenteditable='true']")) return true;
    return false;
  };

  const sendControlKey = (
    event: KeyboardEvent<HTMLDivElement>,
    targetSocketId: string,
    state: "down" | "up"
  ) => {
    if (screenControlTarget !== targetSocketId) return;
    if (shouldIgnoreControlKey(event)) return;
    event.preventDefault();
    sendScreenControlEvent(targetSocketId, {
      type: "key",
      key: event.key,
      code: event.code,
      state,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey,
    });
  };

  const playEndCallTone = async () => {
    try {
      const AudioCtor =
        window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtor) return;
      const ctx = new AudioCtor();
      if (ctx.state === "suspended") {
        await ctx.resume();
      }
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(240, now + 0.32);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
      osc.onended = () => {
        ctx.close().catch(() => undefined);
      };
    } catch {
      // ignore audio errors
    }
  };

  useEffect(() => {
    const stopRingtone = () => {
      const audio = ringtoneRef.current.audio;
      if (!audio) return;
      audio.pause();
      audio.currentTime = 0;
      ringtoneRef.current.audio = null;
    };

    if (status !== "incoming" || !incomingCall) {
      stopRingtone();
      return;
    }

    const startRingtone = async () => {
      try {
        const audio = new Audio(callRingtoneUrl);
        audio.loop = true;
        ringtoneRef.current.audio = audio;
        await audio.play();
      } catch {
        // ignore audio errors
      }
    };

    void startRingtone();

    return () => stopRingtone();
  }, [incomingCall, status]);

  useEffect(() => {
    const stopRingback = () => {
      if (ringbackRef.current.timer) {
        window.clearInterval(ringbackRef.current.timer);
        ringbackRef.current.timer = null;
      }
      if (ringbackRef.current.ctx) {
        ringbackRef.current.ctx.close().catch(() => undefined);
        ringbackRef.current.ctx = null;
      }
    };

    if (status !== "connecting" || hasRemoteMedia) {
      stopRingback();
      return;
    }

    const startRingback = async () => {
      try {
        const AudioCtor =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtor) return;
        const ctx = new AudioCtor();
        ringbackRef.current.ctx = ctx;
        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        const playRingBurst = (offset: number) => {
          if (!ringbackRef.current.ctx) return;
          const startAt = ctx.currentTime + offset;
          const duration = 0.45;
          const oscA = ctx.createOscillator();
          const oscB = ctx.createOscillator();
          const gain = ctx.createGain();
          const filter = ctx.createBiquadFilter();
          oscA.type = "sine";
          oscB.type = "sine";
          oscA.frequency.value = 480;
          oscB.frequency.value = 620;
          filter.type = "bandpass";
          filter.frequency.value = 550;
          filter.Q.value = 0.9;
          gain.gain.setValueAtTime(0.0001, startAt);
          gain.gain.exponentialRampToValueAtTime(0.24, startAt + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
          oscA.connect(gain);
          oscB.connect(gain);
          gain.connect(filter);
          filter.connect(ctx.destination);
          oscA.start(startAt);
          oscB.start(startAt);
          oscA.stop(startAt + duration);
          oscB.stop(startAt + duration);
        };

        const playCadence = () => {
          playRingBurst(0);
          playRingBurst(0.62);
        };

        playCadence();
        ringbackRef.current.timer = window.setInterval(playCadence, 3200);
      } catch {
        // ignore audio errors
      }
    };

    void startRingback();

    return () => stopRingback();
  }, [hasRemoteMedia, status]);

  useEffect(() => {
    const audio = holdAudioRef.current ?? new Audio(holdMusicUrl);
    audio.loop = true;
    audio.volume = 0.45;
    holdAudioRef.current = audio;
    if (!showCallUi || !isOnHold || isHolding) {
      audio.pause();
      audio.currentTime = 0;
      return;
    }
    audio.play().catch(() => undefined);
    return () => {
      audio.pause();
      audio.currentTime = 0;
    };
  }, [isHolding, isOnHold, showCallUi]);

  useEffect(() => {
    if (!lowLatencySuggested || lowLatencyMode) {
      setLowLatencyDismissed(false);
    }
  }, [lowLatencyMode, lowLatencySuggested]);

  useEffect(() => {
    if (!showSettingsPanel) return;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowSettingsPanel(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [showSettingsPanel]);

  useEffect(() => {
    if (showSettingsPanel) {
      setSettingsTab("call");
    }
  }, [showSettingsPanel]);

  useEffect(() => {
    if (!showViewSelect && !showScreenSelect && !showCameraSelect) return;
    const handleClick = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        viewSelectRef.current?.contains(target) ||
        screenSelectRef.current?.contains(target) ||
        cameraSelectRef.current?.contains(target)
      ) {
        return;
      }
      setShowViewSelect(false);
      setShowScreenSelect(false);
      setShowCameraSelect(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowViewSelect(false);
        setShowScreenSelect(false);
        setShowCameraSelect(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [showCameraSelect, showScreenSelect, showViewSelect]);

  if (!showModal) return null;

  const modalContent = (
    <div
      className={overlayClassName}
      data-theme={effectiveSettings.theme}
      style={overlayStyle}
    >
      <div className={modalClassName}>
        {isRenderingInPopout && popoutAudioBlocked && (
          <div className="video-popout-unlock" role="presentation">
            <div className="video-popout-unlock-card" role="dialog" aria-label="Enable audio">
              <h4>Enable sound</h4>
              <p>Click to enable audio in the popout window.</p>
              <button
                type="button"
                className="btn primary"
                onClick={handleEnablePopoutAudio}
              >
                Enable audio
              </button>
            </div>
          </div>
        )}
        {showCallUi && showSettingsPanel && (
          <div
            className="video-settings-overlay"
            role="presentation"
            onClick={handleCloseSettings}
          >
            <div
              className="video-settings-modal"
              role="dialog"
              aria-modal="true"
              aria-label="Call settings"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="video-settings-header">
                <div>
                  <p className="video-settings-eyebrow">Settings</p>
                  <h3>Call settings</h3>
                </div>
                <button
                  type="button"
                  className="video-settings-close"
                  onClick={handleCloseSettings}
                >
                  Close
                </button>
              </div>
              <div className="video-settings-tabs" role="tablist" aria-label="Settings tabs">
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === "call"}
                  className={`video-settings-tab${settingsTab === "call" ? " is-active" : ""}`}
                  onClick={() => setSettingsTab("call")}
                >
                  Call
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={settingsTab === "theme"}
                  className={`video-settings-tab${settingsTab === "theme" ? " is-active" : ""}`}
                  onClick={() => setSettingsTab("theme")}
                >
                  Theme
                </button>
              </div>
              <div className="video-settings-body">
                {settingsTab === "call" && (
                  <>
                    <section className="video-settings-section">
                  <h4>Audio</h4>
                  <div className="video-settings-grid">
                    <button
                      type="button"
                      className={`video-settings-tile${
                        noiseSuppressionEnabled ? " is-active" : ""
                      }`}
                      onClick={toggleNoiseSuppression}
                      aria-pressed={noiseSuppressionEnabled}
                    >
                      <FontAwesomeIcon icon={faWaveSquare} aria-hidden="true" />
                      <span className="video-settings-label">Noise filter</span>
                      <span className="video-settings-status">
                        {noiseSuppressionEnabled ? "On" : "Off"}
                      </span>
                    </button>
                    {showMicSelector && (
                      <div className="video-settings-tile is-static is-select">
                        <FontAwesomeIcon icon={faMicrophone} aria-hidden="true" />
                        <span className="video-settings-label">Microphone</span>
                        <label className="video-settings-select">
                          <span className="sr-only">Microphone</span>
                          <select
                            value={micSelectionValue}
                            onChange={(e) => void setAudioInputDevice(e.target.value)}
                            title="Select microphone"
                          >
                            <option value="default">Default mic</option>
                            {audioInputs.map((device, index) => (
                              <option
                                key={device.deviceId || String(index)}
                                value={device.deviceId}
                              >
                                {device.label || `Microphone ${index + 1}`}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                </section>
                <section className="video-settings-section">
                  <h4>Video</h4>
                  <div className="video-settings-grid">
                    <button
                      type="button"
                      className={`video-settings-tile${
                        videoEffects.blur ? " is-active" : ""
                      }`}
                      onClick={() => setVideoEffects({ blur: !videoEffects.blur })}
                      aria-pressed={videoEffects.blur}
                    >
                      <FontAwesomeIcon icon={faVideo} aria-hidden="true" />
                      <span className="video-settings-label">Blur background</span>
                      <span className="video-settings-status">
                        {videoEffects.blur ? "On" : "Off"}
                      </span>
                    </button>
                    <button
                      type="button"
                      className={`video-settings-tile${
                        videoEffects.mirror ? " is-active" : ""
                      }`}
                      onClick={() => setVideoEffects({ mirror: !videoEffects.mirror })}
                      aria-pressed={videoEffects.mirror}
                    >
                      <FontAwesomeIcon icon={faFaceSmileSolid} aria-hidden="true" />
                      <span className="video-settings-label">Mirror camera</span>
                      <span className="video-settings-status">
                        {videoEffects.mirror ? "On" : "Off"}
                      </span>
                    </button>
                    <div className="video-settings-tile is-static is-select">
                      <FontAwesomeIcon icon={faSliders} aria-hidden="true" />
                      <span className="video-settings-label">Camera filter</span>
                      <label className="video-settings-select">
                        <span className="sr-only">Filter</span>
                        <select
                          value={videoEffects.filter}
                          onChange={(event) =>
                            setVideoEffects({
                              filter: event.target.value as typeof videoEffects.filter,
                            })
                          }
                        >
                          {FILTER_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    <div className="video-settings-tile is-static is-select">
                      <FontAwesomeIcon icon={faDisplay} aria-hidden="true" />
                      <span className="video-settings-label">Background</span>
                      <label className="video-settings-select">
                        <span className="sr-only">Background</span>
                        <select
                          value={videoEffects.background}
                          onChange={(event) =>
                            setVideoEffects({
                              background: event.target.value as typeof videoEffects.background,
                            })
                          }
                        >
                          {BACKGROUND_OPTIONS.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                    {showCameraSelector && (
                      <div className="video-settings-tile is-static is-select">
                        <FontAwesomeIcon icon={faVideo} aria-hidden="true" />
                        <span className="video-settings-label">Camera</span>
                        <label className="video-settings-select">
                          <span className="sr-only">Camera</span>
                          <select
                            value={cameraSelectionValue}
                            onChange={(e) => void setVideoInputDevice(e.target.value)}
                            title="Select camera"
                          >
                            <option value="default">Default camera</option>
                            {videoInputs.map((device, index) => (
                              <option
                                key={device.deviceId || String(index)}
                                value={device.deviceId}
                              >
                                {device.label || `Camera ${index + 1}`}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                  </div>
                </section>
                </>
                )}
                {settingsTab === "theme" && (
                  <section className="video-settings-section">
                    <h4>Theme</h4>
                    <div className="video-settings-stack">
                      <div className="video-settings-group">
                      <span className="video-settings-label">Background color</span>
                      <div className="video-settings-row">
                        <input
                          className="video-settings-color"
                          type="color"
                          value={rgbaToHex(backgroundColorRgba)}
                          onChange={(event) =>
                            updateAppSettings((prev) => {
                              const rgb = parseHexColor(event.target.value);
                              if (!rgb) return prev;
                              return {
                                ...prev,
                                backgroundColor: rgbaToString({
                                  ...rgb,
                                  a: backgroundColorRgba.a,
                                }),
                              };
                            })
                          }
                          aria-label="Background color"
                        />
                        <div className="video-settings-alpha">
                          <input
                            className="video-settings-range"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={backgroundColorRgba.a}
                            onChange={(event) =>
                              updateAppSettings((prev) => ({
                                ...prev,
                                backgroundColor: rgbaToString({
                                  ...backgroundColorRgba,
                                  a: Number.parseFloat(event.target.value),
                                }),
                              }))
                            }
                            aria-label="Background color transparency"
                          />
                          <span className="video-settings-alpha-value">
                            {Math.round(backgroundColorRgba.a * 100)}%
                          </span>
                        </div>
                        <button
                          type="button"
                          className="video-settings-reset"
                          onClick={() =>
                            updateAppSettings((prev) => ({
                              ...prev,
                              backgroundColor: DEFAULT_BACKGROUND_COLOR,
                            }))
                          }
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                    <div className="video-settings-group">
                      <span className="video-settings-label">Background image</span>
                      <div className="video-settings-row">
                        <label className="video-settings-file">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleModalBackgroundImageFile}
                          />
                          {effectiveSettings.backgroundImage ? "Change Image" : "Choose image"}
                        </label>
                        <button
                          type="button"
                          className="video-settings-reset"
                          onClick={() =>
                            updateAppSettings((prev) => ({
                              ...prev,
                              backgroundImage: "",
                              backgroundImageName: "",
                            }))
                          }
                        >
                          Clear
                        </button>
                      </div>
                      <span
                        className={`video-settings-hint${
                          effectiveSettings.backgroundImage ? " is-file" : ""
                        }`}
                      >
                        {effectiveSettings.backgroundImage ? (
                          <>
                            <span className="video-settings-hint-label">Image:</span>
                            <span
                              className="video-settings-filename"
                              title={
                                effectiveSettings.backgroundImageName || "Selected image"
                              }
                            >
                              {effectiveSettings.backgroundImageName || "Selected image"}
                            </span>
                          </>
                        ) : (
                          "No image selected"
                        )}
                      </span>
                    </div>
                    <div className="video-settings-group">
                      <span className="video-settings-label">Box color</span>
                      <div className="video-settings-row">
                        <input
                          className="video-settings-color"
                          type="color"
                          value={rgbaToHex(boxColorRgba)}
                          onChange={(event) =>
                            updateAppSettings((prev) => {
                              const rgb = parseHexColor(event.target.value);
                              if (!rgb) return prev;
                              return {
                                ...prev,
                                boxColor: rgbaToString({
                                  ...rgb,
                                  a: boxColorRgba.a,
                                }),
                              };
                            })
                          }
                          aria-label="Box color"
                        />
                        <div className="video-settings-alpha">
                          <input
                            className="video-settings-range"
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={boxColorRgba.a}
                            onChange={(event) =>
                              updateAppSettings((prev) => ({
                                ...prev,
                                boxColor: rgbaToString({
                                  ...boxColorRgba,
                                  a: Number.parseFloat(event.target.value),
                                }),
                              }))
                            }
                            aria-label="Box color transparency"
                          />
                          <span className="video-settings-alpha-value">
                            {Math.round(boxColorRgba.a * 100)}%
                          </span>
                        </div>
                        <button
                          type="button"
                          className="video-settings-reset"
                          onClick={() =>
                            updateAppSettings((prev) => ({ ...prev, boxColor: "" }))
                          }
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
                )}
                {settingsTab === "call" && (
                  <>
                    <section className="video-settings-section">
                      <h4>Performance</h4>
                  <div className="video-settings-grid">
                    <button
                      type="button"
                      className={`video-settings-tile${lowLatencyMode ? " is-active" : ""}`}
                      onClick={toggleLowLatencyMode}
                      aria-pressed={lowLatencyMode}
                    >
                      <FontAwesomeIcon icon={faBolt} aria-hidden="true" />
                      <span className="video-settings-label">Low latency</span>
                      <span className="video-settings-status">
                        {lowLatencyMode ? "On" : "Off"}
                      </span>
                    </button>
                  </div>
                  {lowLatencySuggested && !lowLatencyMode && (
                    <p className="video-settings-note">
                      Suggested for your network
                      {lowLatencySuggestionReason
                        ? `: ${lowLatencySuggestionReason}`
                        : "."}
                    </p>
                  )}
                </section>
                {isAdmin && (
                  <section className="video-settings-section">
                    <h4>Admin tools</h4>
                    <div className="video-settings-grid">
                      <button
                        type="button"
                        className="video-settings-tile"
                        onClick={() => addDemoParticipants(1)}
                        disabled={!showCallUi || demoSlotsAvailable === 0}
                      >
                        <FontAwesomeIcon icon={faUserPlus} aria-hidden="true" />
                        <span className="video-settings-label">Add demo user</span>
                        <span className="video-settings-status">
                          {demoSlotsAvailable > 0
                            ? `${demoSlotsAvailable} slots left`
                            : "Max reached"}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="video-settings-tile"
                        onClick={() => addDemoParticipants(demoSlotsAvailable)}
                        disabled={!showCallUi || demoSlotsAvailable === 0}
                      >
                        <FontAwesomeIcon icon={faUsers} aria-hidden="true" />
                        <span className="video-settings-label">Fill to max</span>
                        <span className="video-settings-status">
                          {demoSlotsAvailable > 0
                            ? `Add ${demoSlotsAvailable}`
                            : "Max reached"}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="video-settings-tile"
                        onClick={clearDemoParticipants}
                        disabled={demoParticipants.length === 0}
                      >
                        <FontAwesomeIcon icon={faTrash} aria-hidden="true" />
                        <span className="video-settings-label">Clear demos</span>
                        <span className="video-settings-status">{demoStatusLabel}</span>
                      </button>
                    </div>
                    <p className="video-settings-note">
                      Admin only. Adds local dummy camera + screen share streams for
                      layout testing.
                    </p>
                  </section>
                )}
                {isScreenSharing && (
                  <section className="video-settings-section">
                    <h4>Screen share</h4>
                    <div className="video-settings-grid">
                      <button
                        type="button"
                        className={`video-settings-tile${
                          showControlHelper ? " is-active" : ""
                        }`}
                        disabled={!isWindows}
                        onClick={() => {
                          setShowControlHelper(true);
                          if (controlHelperStatus === "idle") {
                            void generateControlHelperCode();
                          }
                        }}
                      >
                        <FontAwesomeIcon icon={faDesktop} aria-hidden="true" />
                        <span className="video-settings-label">Windows control</span>
                        <span className="video-settings-status">
                          {isWindows ? "Enable helper" : "Windows only"}
                        </span>
                      </button>
                    </div>
                    <p className="video-settings-note">
                      Allow trusted people to move your mouse when you share your screen.
                    </p>
                  </section>
                )}
                  </>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="video-call-main">
          {showCallUi && (
            <div className="video-call-controls-top">
              <div className="video-call-controls-group">
                <button
                  type="button"
                  className={`video-control video-control-icon${
                    isAudioEnabled ? "" : " is-off"
                  }`}
                  onClick={toggleAudio}
                  data-hint={isAudioEnabled ? "Mic on" : "Mic off"}
                  aria-label={isAudioEnabled ? "Mic on" : "Mic off"}
                  title={isAudioEnabled ? "Mic on" : "Mic off"}
                >
                  <FontAwesomeIcon
                    icon={isAudioEnabled ? faMicrophone : faMicrophoneSlash}
                    aria-hidden="true"
                  />
                </button>
                <button
                  type="button"
                  className={`video-control video-control-icon${
                    isVideoEnabled ? "" : " is-off"
                  }`}
                  onClick={toggleVideo}
                  data-hint={isVideoEnabled ? "Cam on" : "Cam off"}
                  aria-label={isVideoEnabled ? "Cam on" : "Cam off"}
                  title={isVideoEnabled ? "Cam on" : "Cam off"}
                >
                  <FontAwesomeIcon
                    icon={isVideoEnabled ? faVideo : faVideoSlash}
                    aria-hidden="true"
                  />
                </button>
                {!isMobileCameraOnly && (
                  <button
                    type="button"
                    className={`video-control video-control-icon${
                      isScreenSharing ? " is-active" : ""
                    }`}
                    onClick={handleToggleScreenShare}
                    data-hint={isScreenSharing ? "Stop share" : "Share screen"}
                    aria-label={isScreenSharing ? "Stop share" : "Share screen"}
                    title={isScreenSharing ? "Stop share" : "Share screen"}
                  >
                    <FontAwesomeIcon
                      icon={isScreenSharing ? faStop : faDesktop}
                      aria-hidden="true"
                    />
                  </button>
                )}
                {!isMobileCameraOnly && (
                  <button
                    type="button"
                    className={`video-control video-control-icon ghost${
                      isRemoteMuted ? " is-active" : ""
                    }`}
                    onClick={() => setIsRemoteMuted((prev) => !prev)}
                    data-hint={
                      isRemoteMuted ? "Unmute everyone (local)" : "Mute everyone (local)"
                    }
                    aria-label={
                      isRemoteMuted ? "Unmute everyone locally" : "Mute everyone locally"
                    }
                    title={isRemoteMuted ? "Unmute everyone locally" : "Mute everyone locally"}
                    disabled={remoteAudioStreams.length === 0}
                  >
                    <FontAwesomeIcon
                      icon={isRemoteMuted ? faVolumeXmark : faVolumeHigh}
                      aria-hidden="true"
                    />
                  </button>
                )}
                {isCallAdmin && !isMobileCameraOnly && (
                  <>
                    <button
                      type="button"
                      className="video-control video-control-icon ghost"
                      onClick={muteAllParticipants}
                      data-hint="Mute everyone"
                      aria-label="Mute everyone"
                      title="Mute everyone"
                      disabled={remoteList.length === 0}
                    >
                      <FontAwesomeIcon icon={faMicrophoneSlash} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="video-control video-control-icon ghost"
                      onClick={stopAllScreenShares}
                      data-hint="Stop all screens"
                      aria-label="Stop all screens"
                      title="Stop all screens"
                      disabled={!hasRemoteScreenShares}
                    >
                      <FontAwesomeIcon icon={faDisplay} aria-hidden="true" />
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className="video-control video-control-settings"
                  onClick={handleOpenSettings}
                  data-hint="Settings"
                  aria-label="Settings"
                  title="Settings"
                >
                  <FontAwesomeIcon icon={faSliders} aria-hidden="true" />
                  <span className="video-control-settings-label">Settings</span>
                </button>
                {isMobileLayout && (
                  <button
                    type="button"
                    className="video-control video-control-icon ghost"
                    onClick={() => setMobilePanel("chat")}
                    data-hint="Chat"
                    aria-label="Open chat"
                    title="Chat"
                  >
                    <FontAwesomeIcon icon={faComments} aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="video-call-controls-group">
                {!isMobileCameraOnly && (
                  <button
                    type="button"
                    className={`video-control video-control-icon ghost${
                      isHolding ? " is-active" : ""
                    }`}
                    onClick={toggleHold}
                    data-hint={isHolding ? "Resume call" : "Hold call"}
                    aria-label={isHolding ? "Resume call" : "Hold call"}
                    title={isHolding ? "Resume call" : "Hold call"}
                  >
                    <FontAwesomeIcon
                      icon={isHolding ? faPlay : faPause}
                      aria-hidden="true"
                    />
                  </button>
                )}
                {!isMobileCameraOnly && (
                  <button
                    type="button"
                    className="video-control video-control-icon ghost"
                    onClick={leaveCall}
                    data-hint="Leave call"
                    aria-label="Leave call"
                    title="Leave call"
                  >
                    <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  className="video-control video-control-icon end"
                  onClick={() => {
                    void playEndCallTone();
                    endCall();
                  }}
                  data-hint="End call"
                  aria-label="End call"
                  title="End call"
                >
                  <FontAwesomeIcon icon={faPhoneSlash} aria-hidden="true" />
                </button>
              </div>
            </div>
          )}
          {(audioInputError || videoInputError) && (
            <div className="video-control-status">
              {audioInputError || videoInputError}
            </div>
          )}
          {showCallUi && lowLatencySuggested && !lowLatencyMode && !lowLatencyDismissed && (
            <div className="video-control-status info">
              <span>
                Low latency suggested.
                {lowLatencySuggestionReason ? ` ${lowLatencySuggestionReason}` : ""}
              </span>
              <div className="video-control-status-actions">
                <button
                  type="button"
                  className="video-control-status-btn"
                  onClick={toggleLowLatencyMode}
                >
                  Enable
                </button>
                <button
                  type="button"
                  className="video-control-status-btn ghost"
                  onClick={() => setLowLatencyDismissed(true)}
                >
                  Not now
                </button>
              </div>
            </div>
          )}
          <div className="video-call-header">
            <div className="video-call-header-left">
              <p className="video-call-eyebrow">
                {status === "incoming" ? "Incoming video call" : "Video room"}
              </p>
              <h3 className="video-call-title">
                {status === "incoming" ? (
                  <span className="video-call-title-call">
                    <span className="video-call-title-name">{incomingHostName}</span>{" "}
                    is calling
                  </span>
                ) : status === "setup" ? (
                  "Start a video call"
                ) : (
                  "Live video call"
                )}
              </h3>
            </div>
            {showCallUi && (
              <div className="video-call-header-controls">
                {!isMobileCameraOnly && (
                  <div className="video-call-header-controls-group">
                    {!isFullscreenUi && (
                      <div
                        className={`video-call-toolbar-group is-dropdown${
                          showViewSelect ? " is-open" : ""
                        }`}
                        ref={viewSelectRef}
                      >
                        <button
                          type="button"
                          className="video-view-button is-icon is-dropdown-trigger"
                          data-hint="View"
                          aria-label="View options"
                          title="View"
                          aria-expanded={showViewSelect}
                          onClick={() => {
                            setShowViewSelect((prev) => !prev);
                            setShowScreenSelect(false);
                            setShowCameraSelect(false);
                          }}
                        >
                          <FontAwesomeIcon icon={faTableColumns} aria-hidden="true" />
                        </button>
                        {showViewSelect && (
                          <div className="video-call-dropdown is-open">
                            <div className="video-call-dropdown-list">
                              <button
                                type="button"
                                className={`video-call-dropdown-option${
                                  effectiveViewMode === "split" ? " is-active" : ""
                                }`}
                                onClick={() => {
                                  setScreenViewMode("split");
                                  setShowViewSelect(false);
                                }}
                              >
                                Split view
                              </button>
                              {hasScreenShares && (
                                <button
                                  type="button"
                                  className={`video-call-dropdown-option${
                                    effectiveViewMode === "screen" ? " is-active" : ""
                                  }`}
                                  onClick={() => {
                                    setScreenViewMode("screen");
                                    setShowViewSelect(false);
                                  }}
                                >
                                  Screen focus
                                </button>
                              )}
                              <button
                                type="button"
                                className={`video-call-dropdown-option${
                                  effectiveViewMode === "video" ? " is-active" : ""
                                }`}
                                onClick={() => {
                                  setScreenViewMode("video");
                                  setShowViewSelect(false);
                                }}
                              >
                                All cameras
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {videoParticipants.length > 0 && (
                      <div
                        className={`video-call-toolbar-group is-dropdown${
                          showCameraSelect ? " is-open" : ""
                        }`}
                        ref={cameraSelectRef}
                      >
                        <button
                          type="button"
                          className="video-view-button is-icon is-dropdown-trigger"
                          data-hint="Camera feed"
                          aria-label="Camera feed"
                          title="Camera feed"
                          aria-expanded={showCameraSelect}
                          onClick={() => {
                            setShowCameraSelect((prev) => !prev);
                            setShowViewSelect(false);
                            setShowScreenSelect(false);
                          }}
                        >
                          <FontAwesomeIcon icon={faCamera} aria-hidden="true" />
                        </button>
                        {showCameraSelect && (
                          <div className="video-call-dropdown is-open">
                            <div className="video-call-dropdown-list">
                              <button
                                type="button"
                                className={`video-call-dropdown-option${
                                  !focusedVideoId ? " is-active" : ""
                                }`}
                                onClick={() => {
                                  selectVideoFeedFocus(null);
                                  setShowCameraSelect(false);
                                }}
                              >
                                All cameras
                              </button>
                              {videoParticipants.map((participant) => (
                                <button
                                  type="button"
                                  key={participant.id}
                                  className={`video-call-dropdown-option${
                                    focusedVideoId === participant.id ? " is-active" : ""
                                  }`}
                                  onClick={() => {
                                    selectVideoFeedFocus(participant.id);
                                    setShowCameraSelect(false);
                                  }}
                                >
                                  {participant.isLocal ? localDisplayName : participant.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {hasScreenShares && (
                      <div
                        className={`video-call-toolbar-group is-dropdown${
                          showScreenSelect ? " is-open" : ""
                        }`}
                        ref={screenSelectRef}
                      >
                        <button
                          type="button"
                          className="video-view-button is-icon is-dropdown-trigger"
                          data-hint="Screen share"
                          aria-label="Screen share"
                          title="Screen share"
                          aria-expanded={showScreenSelect}
                          onClick={() => {
                            setShowScreenSelect((prev) => !prev);
                            setShowViewSelect(false);
                            setShowCameraSelect(false);
                          }}
                        >
                          <FontAwesomeIcon icon={faDisplay} aria-hidden="true" />
                        </button>
                        {showScreenSelect && (
                          <div className="video-call-dropdown is-open">
                            <div className="video-call-dropdown-list">
                              <button
                                type="button"
                                className={`video-call-dropdown-option${
                                  !focusedScreenId ? " is-active" : ""
                                }`}
                                onClick={() => {
                                  selectScreenShareFocus(null);
                                  setShowScreenSelect(false);
                                }}
                              >
                                All screens
                              </button>
                              {screenShareEntries.map((entry) => {
                                const entryKey = getScreenFocusKey(entry);
                                return (
                                  <button
                                    type="button"
                                    key={entryKey}
                                    className={`video-call-dropdown-option${
                                      focusedScreenId === entryKey ? " is-active" : ""
                                    }`}
                                    title={entry.label}
                                    onClick={() => {
                                      selectScreenShareFocus(entryKey);
                                      setShowScreenSelect(false);
                                    }}
                                  >
                                    {entry.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {hasScreenShares && (
                      <div className="video-call-toolbar-group">
                        <button
                          type="button"
                          className={`video-view-button is-icon${
                            isScreenBorderless ? " is-active" : ""
                          }`}
                          onClick={() => setIsScreenBorderless((prev) => !prev)}
                          data-hint={isScreenBorderless ? "Windowed" : "Borderless"}
                          aria-label={isScreenBorderless ? "Windowed" : "Borderless"}
                          title={isScreenBorderless ? "Windowed" : "Borderless"}
                        >
                          <FontAwesomeIcon
                            icon={isScreenBorderless ? faWindowRestore : faWindowMaximize}
                            aria-hidden="true"
                          />
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div className="video-call-header-controls-group is-actions">
                  <button
                    type="button"
                    className={`video-view-button is-icon is-chat-toggle${
                      showChat ? " is-active" : ""
                    }`}
                    onClick={handleToggleChatVisibility}
                    disabled={!showCallUi}
                    data-hint={showChat ? "Hide chat" : "Show chat"}
                    aria-label={showChat ? "Hide chat" : "Show chat"}
                    title={showChat ? "Hide chat" : "Show chat"}
                  >
                    <FontAwesomeIcon
                      icon={showChat ? faCommentSlash : faComments}
                      aria-hidden="true"
                    />
                  </button>
                  {!isMobileCameraOnly && (
                    <button
                      type="button"
                      className={`video-view-button is-icon${isPopout ? " is-active" : ""}`}
                      onClick={() => setIsPopout((prev) => !prev)}
                      aria-pressed={isPopout}
                      data-hint={isPopout ? "Dock" : "Pop out"}
                      aria-label={isPopout ? "Dock" : "Pop out"}
                      title={isPopout ? "Dock" : "Pop out"}
                    >
                      <FontAwesomeIcon
                        icon={isPopout ? faCompress : faUpRightFromSquare}
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </div>
                <div className="video-call-header-controls-group is-mobile-only">
                  <span className="video-call-toolbar-label">Panel</span>
                  <button
                    type="button"
                    className={`video-view-button is-icon${
                      mobilePanel === "video" ? " is-active" : ""
                    }`}
                    onClick={() => setMobilePanel("video")}
                    data-hint="Video panel"
                    aria-label="Video panel"
                    title="Video panel"
                  >
                    <FontAwesomeIcon icon={faVideo} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className={`video-view-button is-icon${
                      mobilePanel === "chat" ? " is-active" : ""
                    }`}
                    onClick={() => setMobilePanel("chat")}
                    data-hint="Chat panel"
                    aria-label="Chat panel"
                    title="Chat panel"
                  >
                    <FontAwesomeIcon icon={faComments} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )}
            <div className="video-call-meta">
              {!isMobileCameraOnly && screenShareStatusLabel && (
                <span className="video-call-chip is-screen-share" title={screenShareStatusLabel}>
                  {screenShareStatusLabel}
                </span>
              )}
              <span className="video-call-chip">
                {showCallUi ? `${totalParticipants}/${maxParticipants}` : `Up to ${maxParticipants}`}
              </span>
              {showCallUi && (
                <span className={`video-call-chip ${status === "connecting" ? "is-warm" : ""}`}>
                  {status === "connecting" ? "Connecting" : "Live"}
                </span>
              )}
            </div>
          </div>

          {shouldRenderRemoteAudio && remoteAudioStreams.length > 0 && (
            <div className="video-call-audio" aria-hidden="true">
              {remoteAudioStreams.map(({ socketId, stream }) => (
                <audio
                  key={socketId}
                  autoPlay
                  playsInline
                  muted={isRemoteMuted}
                  ref={(node) => {
                    if (!node) return;
                    if (node.srcObject !== stream) {
                      node.srcObject = stream;
                    }
                    node.play().catch((error) => {
                      if (
                        isRenderingInPopout &&
                        error &&
                        (error as Error).name === "NotAllowedError"
                      ) {
                        setPopoutAudioBlocked(true);
                      }
                    });
                  }}
                />
              ))}
            </div>
          )}

          {status === "setup" && (
            <div className="video-call-setup">
              <div className="video-setup-preview">
                <div className="video-preview-tile">
                  <VideoTile
                    stream={localStream}
                    label="You"
                    muted
                    status={previewStatus}
                    className={`is-preview ${localEffectClass}`.trim()}
                  />
                </div>
                <div className="video-preview-controls">
                  <div className="video-preview-row">
                    <div className="video-preview-group">
                      <span className="video-preview-label">Microphone</span>
                      <button
                        type="button"
                        className={`video-preview-toggle${isAudioEnabled ? " is-active" : ""}`}
                        onClick={toggleAudio}
                      >
                        {isAudioEnabled ? "On" : "Off"}
                      </button>
                    </div>
                    <div className="video-preview-group">
                      <span className="video-preview-label">Camera</span>
                      <button
                        type="button"
                        className={`video-preview-toggle${isVideoEnabled ? " is-active" : ""}`}
                        onClick={toggleVideo}
                      >
                        {isVideoEnabled ? "On" : "Off"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="video-setup-intro">
                <p className="subhead">
                  Pick friends to invite. You can start with one or build a squad of up to{" "}
                  {maxParticipants}.
                </p>
                <button className="btn ghost" type="button" onClick={() => setSelectedInvitees([])}>
                  Clear selection
                </button>
              </div>
              {friends.length === 0 ? (
                <p className="status">No friends available to invite yet.</p>
              ) : (
                <div className="video-setup-grid">
                  {friends.map((friend) => {
                    const selected = selectedInvitees.some(
                      (entry) => entry.userId === friend.userId
                    );
                    const isOnline = onlineUserIds.has(friend.userId);
                    const statusLabel = isOnline ? "Online" : "Offline";
                    return (
                      <button
                        key={friend.userId}
                        type="button"
                        className={`video-setup-card${selected ? " is-selected" : ""}`}
                        onClick={() => toggleInvitee(friend)}
                      >
                        <span className="video-setup-avatar-wrap">
                          <span
                            className="video-setup-avatar"
                            style={
                              friend.avatarUrl
                                ? { backgroundImage: `url(${friend.avatarUrl})` }
                                : undefined
                            }
                          >
                            {!friend.avatarUrl && getInitials(friend.displayName)}
                          </span>
                          <span
                            className={`presence-dot ${isOnline ? "is-online" : "is-offline"}`}
                            title={statusLabel}
                            aria-label={statusLabel}
                          />
                        </span>
                        <span className="video-setup-meta">
                          <strong>{friend.displayName}</strong>
                          <span>@{friend.handle || "friend"}</span>
                        </span>
                        <span className="video-setup-tag">
                          {selected ? "Selected" : "Invite"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {selectionError && <p className="status status-error">{selectionError}</p>}
              {error && <p className="status status-error">{error}</p>}
              <div className="video-setup-actions">
                <span className="video-setup-count">
                  {selectedInvitees.length} selected
                </span>
                <div className="video-setup-buttons">
                  <button className="btn ghost" type="button" onClick={closeCallComposer}>
                    Cancel
                  </button>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => void startCall()}
                    disabled={selectedInvitees.length === 0}
                  >
                    Start call
                  </button>
                </div>
              </div>
            </div>
          )}

          {status === "incoming" && (
            <div className="video-call-incoming">
              <div className="video-incoming-card">
                <p className="eyebrow">Incoming call</p>
                <h3 className="video-incoming-title">
                  <span className="video-incoming-name">{incomingHostName}</span>{" "}
                  is calling
                </h3>
                <p className="subhead">
                  {incomingCall?.hostHandle ? `@${incomingCall.hostHandle}` : "Tap accept to join."}
                </p>
                <div className="video-incoming-actions">
                  <button className="btn ghost" type="button" onClick={declineCall}>
                    Decline
                  </button>
                  <button className="btn primary" type="button" onClick={() => void acceptCall()}>
                    Accept
                  </button>
                </div>
              </div>
            </div>
          )}

          {showCallUi && (
            <>
              {error && <p className="status status-error video-call-error">{error}</p>}
              {e2eeDebug && <div className="video-call-debug">{e2eeDebug}</div>}
              {localScreenStream && screenControlRequests.length > 0 && (
                <div className="screen-control-requests">
                  <div className="screen-control-title">Screen control requests</div>
                  {screenControlRequests.map((request) => (
                    <div key={request.socketId} className="screen-control-request">
                      <span>
                        {resolveParticipantLabel({
                          userId: request.userId,
                          displayName: request.displayName,
                          handle: request.handle,
                        })}{" "}
                        wants control.
                      </span>
                      <div className="screen-control-actions">
                        <button
                          type="button"
                          className="btn ghost"
                          onClick={() => denyScreenControl(request.socketId)}
                        >
                          Deny
                        </button>
                        <button
                          type="button"
                          className="btn primary"
                          onClick={() => grantScreenControl(request.socketId)}
                        >
                          Allow
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className={gridClassName} ref={gridRef}>
                {isOnHold && (
                  <div className="video-call-hold-overlay">
                    <div className="video-call-hold-card">
                      <p className="video-call-hold-title">Call on hold</p>
                      <p className="video-call-hold-sub">
                        {isHolding
                          ? "You placed the call on hold. Resume when you're ready."
                          : "You're on hold. We'll reconnect you shortly."}
                      </p>
                    </div>
                  </div>
                )}
                {presenterMode ? (
                  <div className="video-call-presenter">
                    <div className="video-call-presenter-main">
                      {presenterParticipant
                        ? renderCompactVideoTile(presenterParticipant, {
                            className: "is-presenter-main",
                          })
                        : null}
                    </div>
                    <div className="video-call-presenter-strip">
                      {presenterOthers.map((participant) =>
                        renderCompactVideoTile(participant, {
                          className: "is-presenter-thumb",
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                {showScreenTiles &&
                  screenEntriesToRender.map((entry) => {
                    const gridPlacementStyle = isSplitView
                      ? { gridColumn: 1, gridRow: 1 }
                      : undefined;
                    const tileId = getScreenTileId(entry);
                    const isFullscreen = fullscreenTargetId === tileId;
                    const isPrimary = tileId === primaryScreenTileId;
                    const screenFocusKey = getScreenFocusKey(entry);
                    const isScreenFocused = focusedScreenKey === screenFocusKey;
                    const zoomKey = entry.isLocal
                      ? "local"
                      : entry.socketId || entry.id || "";
                    const screenZoom = getScreenZoom(zoomKey);
                    const screenPan = getScreenPan(zoomKey);
                    const isPanning = activePanTarget === zoomKey;
                    const isPannable =
                      screenZoom > 1 && !(entry.isLocal && activeScreenController);
                    const zoomStyle: CSSProperties = {
                      transform: `translate(${screenPan.x}px, ${screenPan.y}px) scale(${screenZoom})`,
                      transformOrigin: "center center",
                      transition: isPanning ? "none" : "transform 0.2s ease",
                    };
                    const localIsScreenSettingsOpen =
                      isMobileLayout && activeScreenSettingsId === tileId;
                    const localScreenStatus = activeScreenController ? (
                      <span className="screen-share-status">
                        Controlled by{" "}
                        {resolveParticipantLabel({
                          userId: activeScreenController.userId,
                          displayName: activeScreenController.displayName,
                          handle: activeScreenController.handle,
                        })}
                      </span>
                    ) : null;
                    const screenShareTag = (
                      <span
                        className="screen-share-status is-label"
                        title={entry.label}
                      >
                        {entry.isLocal ? `Sharing ${entry.label}` : entry.label}
                      </span>
                    );
                    const localScreenSettingsButtons = (
                      <>
                        <button
                          type="button"
                          className="screen-share-control is-icon"
                          onClick={() => toggleFullscreen(tileId)}
                        >
                          <FontAwesomeIcon
                            icon={isFullscreen ? faCompress : faExpand}
                            aria-hidden="true"
                          />
                          <span className="screen-share-label">
                            {isFullscreen ? "Exit full screen" : "Full screen"}
                          </span>
                        </button>
                        {!isFullscreenUi && (
                          <button
                            type="button"
                            className={`screen-share-control is-icon${
                              isScreenFocused ? " is-active" : ""
                            }`}
                            onClick={() => toggleScreenFocus(entry)}
                            aria-pressed={isScreenFocused}
                          >
                            <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
                            <span className="screen-share-label">
                              {isScreenFocused ? "Show all" : "Focus"}
                            </span>
                          </button>
                        )}
                        <div className="screen-share-zoom">
                          <button
                            type="button"
                            className="screen-share-control is-icon"
                            onClick={() => updateScreenZoom(zoomKey, screenZoom - 0.25)}
                            disabled={screenZoom <= 1}
                            aria-label="Zoom out"
                          >
                            <FontAwesomeIcon icon={faMinus} aria-hidden="true" />
                            <span className="screen-share-label">Zoom out</span>
                          </button>
                          <button
                            type="button"
                            className="screen-share-control is-icon"
                            onClick={() => updateScreenZoom(zoomKey, screenZoom + 0.25)}
                            disabled={screenZoom >= 5}
                            aria-label="Zoom in"
                          >
                            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
                            <span className="screen-share-label">Zoom in</span>
                          </button>
                        </div>
                        {!isFullscreenUi && (
                          <button
                            type="button"
                            className="screen-share-control is-icon"
                            onClick={() => setIsScreenBorderless((prev) => !prev)}
                          >
                            <FontAwesomeIcon icon={faDisplay} aria-hidden="true" />
                            <span className="screen-share-label">
                              {isScreenBorderless ? "Windowed" : "Borderless"}
                            </span>
                          </button>
                        )}
                        {isFullscreen && (
                          <>
                            <button
                              type="button"
                              className={`screen-share-control is-icon${
                                fullscreenChatOverlay ? " is-active" : ""
                              }`}
                              onClick={handleToggleChatVisibility}
                              aria-pressed={fullscreenChatOverlay}
                            >
                              <FontAwesomeIcon
                                icon={fullscreenChatOverlay ? faCommentSlash : faComments}
                                aria-hidden="true"
                              />
                              <span className="screen-share-label">
                                {fullscreenChatOverlay ? "Hide chat" : "Show chat"}
                              </span>
                            </button>
                          </>
                        )}
                        {activeScreenController && (
                          <button
                            type="button"
                            className="screen-share-control is-icon"
                            onClick={() =>
                              stopScreenControl(activeScreenController.socketId)
                            }
                          >
                            <FontAwesomeIcon icon={faStop} aria-hidden="true" />
                            <span className="screen-share-label">Stop control</span>
                          </button>
                        )}
                      </>
                    );
                    if (entry.isLocal) {
                      return (
                        <VideoTile
                          key={entry.id}
                          stream={entry.stream}
                          label={entry.label}
                          muted
                          badge="Screen"
                          className={`is-screen is-local${
                            isPrimary ? " is-primary" : ""
                          }${isPannable ? " is-pannable" : ""}${
                            isPanning ? " is-panning" : ""
                          }`}
                          style={gridPlacementStyle}
                          rootRef={registerScreenTile(tileId)}
                          dataScreenId={tileId}
                          mediaStyle={zoomStyle}
                          onPointerDown={
                            isPannable
                              ? (event) => beginScreenPan(event, zoomKey, screenZoom)
                              : undefined
                          }
                          onPointerMove={
                            isPannable ? (event) => updateScreenPan(event, zoomKey) : undefined
                          }
                          onPointerUp={
                            isPannable ? (event) => endScreenPan(event, zoomKey) : undefined
                          }
                          onPointerLeave={
                            isPannable ? (event) => endScreenPan(event, zoomKey) : undefined
                          }
                        >
                        <div
                          className={`screen-share-actions${
                            isFullscreen ? " is-fullscreen" : " is-compact"
                          }`}
                        >
                          {isMobileLayout ? (
                            <>
                              {screenShareTag}
                              <button
                                type="button"
                                className="screen-share-control is-icon is-settings-trigger"
                                onClick={() => toggleScreenSettings(tileId)}
                                aria-expanded={localIsScreenSettingsOpen}
                              >
                                <FontAwesomeIcon icon={faSliders} aria-hidden="true" />
                                <span className="screen-share-label">Screen Settings</span>
                              </button>
                            </>
                          ) : (
                            <>
                              {screenShareTag}
                              {localScreenStatus}
                              {localScreenSettingsButtons}
                            </>
                          )}
                        </div>
                          {localIsScreenSettingsOpen && (
                            <div
                              className="screen-settings-overlay"
                              onClick={closeScreenSettings}
                            >
                              <div
                                className="screen-settings-modal"
                                role="dialog"
                                aria-modal="true"
                                aria-label="Screen settings"
                                onClick={(event) => event.stopPropagation()}
                              >
                                <div className="screen-settings-header">
                                  <div>
                                    <p className="screen-settings-eyebrow">Screen settings</p>
                                    <h4>{entry.label}</h4>
                                  </div>
                                  <button
                                    type="button"
                                    className="screen-settings-close"
                                    onClick={closeScreenSettings}
                                  >
                                    Close
                                  </button>
                                </div>
                                {localScreenStatus && (
                                  <div className="screen-settings-status">
                                    {localScreenStatus}
                                  </div>
                                )}
                                <div className="screen-settings-body">
                                  <div className="screen-settings-grid">
                                    {localScreenSettingsButtons}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                          {isFullscreen && fullscreenChatOverlay && (
                              <div className="screen-share-overlays">
                                {fullscreenChatOverlay && (
                                  <div className="screen-share-overlay is-chat">
                                    <div className="screen-share-overlay-header">Chat</div>
                                    <div className="screen-share-overlay-body">
                                      {overlayMessages.length === 0 ? (
                                        <p className="screen-share-overlay-empty">
                                          No messages yet.
                                        </p>
                                      ) : (
                                        overlayMessages.map((message) => (
                                          <div
                                            key={message.id}
                                            className="screen-share-overlay-message"
                                          >
                                            <div className="screen-share-overlay-meta">
                                              <span>{resolveMessageName(message)}</span>
                                              <span>
                                                {new Date(message.at).toLocaleTimeString([], {
                                                  hour: "2-digit",
                                                  minute: "2-digit",
                                                })}
                                              </span>
                                            </div>
                                            <div className="screen-share-overlay-text">
                                              {renderMessageContent(message)}
                                            </div>
                                          </div>
                                        ))
                                      )}
                                    </div>
                                    <div className="screen-share-overlay-compose">
                                      <textarea
                                        className="screen-share-overlay-input"
                                        value={chatInput}
                                        onChange={(event) =>
                                          setChatInput(sanitizePostText(event.target.value))
                                        }
                                        onKeyDown={(event) => {
                                          if (event.key !== "Enter" || event.shiftKey) return;
                                          event.preventDefault();
                                          if (!showCallUi) return;
                                          handleSend();
                                        }}
                                        placeholder="Type a message"
                                        rows={2}
                                        disabled={!showCallUi}
                                      />
                                      <button
                                        type="button"
                                        className="btn primary"
                                        onClick={handleSend}
                                        disabled={!showCallUi || !chatInput.trim()}
                                      >
                                        Send
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          {activeScreenController && screenControlCursor && (
                            <span
                              className={`screen-control-cursor${
                                screenControlCursor.kind === "click" ? " is-click" : ""
                              }${
                                screenControlCursor.button === "right" ? " is-right" : ""
                              }`}
                              style={{
                                left: `${screenControlCursor.x * 100}%`,
                                top: `${screenControlCursor.y * 100}%`,
                              }}
                            />
                          )}
                        </VideoTile>
                      );
                    }

                    const targetId = entry.socketId || entry.id;
                    const isControlling = screenControlTarget === targetId;
                    const isPending = pendingScreenControlTargets.includes(targetId);
                    const targetZoomKey = targetId || "remote";
                    const targetZoom = getScreenZoom(targetZoomKey);
                    const targetPan = getScreenPan(targetZoomKey);
                    const isTargetPanning = activePanTarget === targetZoomKey;
                    const isTargetPannable = targetZoom > 1 && !isControlling;
                    const targetZoomStyle: CSSProperties = {
                      transform: `translate(${targetPan.x}px, ${targetPan.y}px) scale(${targetZoom})`,
                      transformOrigin: "center center",
                      transition: isTargetPanning ? "none" : "transform 0.2s ease",
                    };
                    const remoteIsScreenSettingsOpen =
                      isMobileLayout && activeScreenSettingsId === tileId;
                    const remoteScreenStatus =
                      isControlling && screenControlAgentId ? (
                        <span className="screen-share-status">Windows control active</span>
                      ) : isPending ? (
                        <span className="screen-share-status">Control requested</span>
                      ) : null;
                    const remoteScreenTag = (
                      <span
                        className="screen-share-status is-label"
                        title={entry.label}
                      >
                        {entry.label}
                      </span>
                    );
                    const remoteScreenSettingsButtons = (
                      <>
                        <button
                          type="button"
                          className="screen-share-control is-icon"
                          onClick={() => toggleFullscreen(tileId)}
                        >
                          <FontAwesomeIcon
                            icon={isFullscreen ? faCompress : faExpand}
                            aria-hidden="true"
                          />
                          <span className="screen-share-label">
                            {isFullscreen ? "Exit full screen" : "Full screen"}
                          </span>
                        </button>
                        {!isFullscreenUi && (
                          <button
                            type="button"
                            className={`screen-share-control is-icon${
                              isScreenFocused ? " is-active" : ""
                            }`}
                            onClick={() => toggleScreenFocus(entry)}
                            aria-pressed={isScreenFocused}
                          >
                            <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
                            <span className="screen-share-label">
                              {isScreenFocused ? "Show all" : "Focus"}
                            </span>
                          </button>
                        )}
                        <div className="screen-share-zoom">
                          <button
                            type="button"
                            className="screen-share-control is-icon"
                            onClick={() => updateScreenZoom(targetZoomKey, targetZoom - 0.25)}
                            disabled={targetZoom <= 1}
                            aria-label="Zoom out"
                          >
                            <FontAwesomeIcon icon={faMinus} aria-hidden="true" />
                            <span className="screen-share-label">Zoom out</span>
                          </button>
                          <button
                            type="button"
                            className="screen-share-control is-icon"
                            onClick={() => updateScreenZoom(targetZoomKey, targetZoom + 0.25)}
                            disabled={targetZoom >= 5}
                            aria-label="Zoom in"
                          >
                            <FontAwesomeIcon icon={faPlus} aria-hidden="true" />
                            <span className="screen-share-label">Zoom in</span>
                          </button>
                        </div>
                        {!isFullscreenUi && (
                          <button
                            type="button"
                            className="screen-share-control is-icon"
                            onClick={() => setIsScreenBorderless((prev) => !prev)}
                          >
                            <FontAwesomeIcon icon={faDisplay} aria-hidden="true" />
                            <span className="screen-share-label">
                              {isScreenBorderless ? "Windowed" : "Borderless"}
                            </span>
                          </button>
                        )}
                        {isFullscreen && (
                          <>
                            <button
                              type="button"
                              className={`screen-share-control is-icon${
                                fullscreenChatOverlay ? " is-active" : ""
                              }`}
                              onClick={handleToggleChatVisibility}
                              aria-pressed={fullscreenChatOverlay}
                            >
                              <FontAwesomeIcon
                                icon={fullscreenChatOverlay ? faCommentSlash : faComments}
                                aria-hidden="true"
                              />
                              <span className="screen-share-label">
                                {fullscreenChatOverlay ? "Hide chat" : "Show chat"}
                              </span>
                            </button>
                          </>
                        )}
                        {isControlling ? (
                          <button
                            type="button"
                            className="screen-share-control is-icon"
                            onClick={() => stopScreenControl(targetId)}
                          >
                            <FontAwesomeIcon icon={faStop} aria-hidden="true" />
                            <span className="screen-share-label">Stop control</span>
                          </button>
                        ) : isPending ? null : (
                          <button
                            type="button"
                            className="screen-share-control is-icon"
                            onClick={() => requestScreenControl(targetId)}
                          >
                            <FontAwesomeIcon icon={faDesktop} aria-hidden="true" />
                            <span className="screen-share-label">Take control</span>
                          </button>
                        )}
                      </>
                    );

                    return (
                      <VideoTile
                        key={entry.id}
                        stream={entry.stream}
                        label={entry.label}
                        badge="Screen"
                        className={`is-screen${isControlling ? " is-controlling" : ""}${
                          isPrimary ? " is-primary" : ""
                        }${isTargetPannable ? " is-pannable" : ""}${
                          isTargetPanning ? " is-panning" : ""
                        }`}
                        style={gridPlacementStyle}
                        mediaStyle={targetZoomStyle}
                        onPointerMove={
                          isControlling
                            ? (event) => sendControlPointer(event, targetId, "move")
                            : isTargetPannable
                            ? (event) => updateScreenPan(event, targetZoomKey)
                            : undefined
                        }
                        onPointerDown={
                          isControlling
                            ? (event) => handleControlPointerDown(event, targetId)
                            : isTargetPannable
                            ? (event) => beginScreenPan(event, targetZoomKey, targetZoom)
                            : undefined
                        }
                        onPointerUp={
                          isControlling
                            ? (event) => handleControlPointerUp(event, targetId)
                            : isTargetPannable
                            ? (event) => endScreenPan(event, targetZoomKey)
                            : undefined
                        }
                        onPointerLeave={
                          isControlling
                            ? (event) => sendControlPointer(event, targetId, "move")
                            : isTargetPannable
                            ? (event) => endScreenPan(event, targetZoomKey)
                            : undefined
                        }
                        onContextMenu={
                          isControlling
                            ? (event) => handleControlContextMenu(event, targetId)
                            : undefined
                        }
                        onWheel={
                          isControlling
                            ? (event) => sendControlScroll(event, targetId)
                            : undefined
                        }
                        onKeyDown={
                          isControlling
                            ? (event) => sendControlKey(event, targetId, "down")
                            : undefined
                        }
                        onKeyUp={
                          isControlling
                            ? (event) => sendControlKey(event, targetId, "up")
                            : undefined
                        }
                        tabIndex={isControlling ? 0 : undefined}
                        rootRef={registerScreenTile(tileId)}
                        dataScreenId={tileId}
                      >
                        <div
                          className={`screen-share-actions${
                            isFullscreen ? " is-fullscreen" : " is-compact"
                          }`}
                        >
                          {isMobileLayout ? (
                            <>
                              {remoteScreenTag}
                              <button
                                type="button"
                                className="screen-share-control is-icon is-settings-trigger"
                                onClick={() => toggleScreenSettings(tileId)}
                                aria-expanded={remoteIsScreenSettingsOpen}
                              >
                                <FontAwesomeIcon icon={faSliders} aria-hidden="true" />
                                <span className="screen-share-label">Screen Settings</span>
                              </button>
                            </>
                          ) : (
                            <>
                              {remoteScreenTag}
                              {remoteScreenStatus}
                              {remoteScreenSettingsButtons}
                            </>
                          )}
                        </div>
                        {remoteIsScreenSettingsOpen && (
                          <div
                            className="screen-settings-overlay"
                            onClick={closeScreenSettings}
                          >
                            <div
                              className="screen-settings-modal"
                              role="dialog"
                              aria-modal="true"
                              aria-label="Screen settings"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <div className="screen-settings-header">
                                <div>
                                  <p className="screen-settings-eyebrow">Screen settings</p>
                                  <h4>{entry.label}</h4>
                                </div>
                                <button
                                  type="button"
                                  className="screen-settings-close"
                                  onClick={closeScreenSettings}
                                >
                                  Close
                                </button>
                              </div>
                              {remoteScreenStatus && (
                                <div className="screen-settings-status">
                                  {remoteScreenStatus}
                                </div>
                              )}
                              <div className="screen-settings-body">
                                <div className="screen-settings-grid">
                                  {remoteScreenSettingsButtons}
                                </div>
                              </div>
                            </div>
                          </div>
                        )}
                        {isFullscreen && fullscreenChatOverlay && (
                            <div className="screen-share-overlays">
                              {fullscreenChatOverlay && (
                                <div className="screen-share-overlay is-chat">
                                  <div className="screen-share-overlay-header">Chat</div>
                                  <div className="screen-share-overlay-body">
                                    {overlayMessages.length === 0 ? (
                                      <p className="screen-share-overlay-empty">
                                        No messages yet.
                                      </p>
                                    ) : (
                                      overlayMessages.map((message) => (
                                        <div
                                          key={message.id}
                                          className="screen-share-overlay-message"
                                        >
                                          <div className="screen-share-overlay-meta">
                                            <span>{resolveMessageName(message)}</span>
                                            <span>
                                              {new Date(message.at).toLocaleTimeString([], {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                              })}
                                            </span>
                                          </div>
                                          <div className="screen-share-overlay-text">
                                            {renderMessageContent(message)}
                                          </div>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                  <div className="screen-share-overlay-compose">
                                    <textarea
                                      className="screen-share-overlay-input"
                                      value={chatInput}
                                      onChange={(event) =>
                                        setChatInput(sanitizePostText(event.target.value))
                                      }
                                      onKeyDown={(event) => {
                                        if (event.key !== "Enter" || event.shiftKey) return;
                                        event.preventDefault();
                                        if (!showCallUi) return;
                                        handleSend();
                                      }}
                                      placeholder="Type a message"
                                      rows={2}
                                      disabled={!showCallUi}
                                    />
                                    <button
                                      type="button"
                                      className="btn primary"
                                      onClick={handleSend}
                                      disabled={!showCallUi || !chatInput.trim()}
                                    >
                                      Send
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                      </VideoTile>
                    );
                  })}
                {showScreenTiles && screenShareEntries.length === 0 && (
                  <div className="video-tile is-skeleton is-screen">
                    <div className="video-tile__placeholder">
                      <span className="video-tile__status">No screen share yet</span>
                    </div>
                  </div>
                )}
                {showVideoTiles && isSplitView && (
                  <div className="video-call-camera-stack" style={{ gridColumn: 2, gridRow: 1 }}>
                    {splitCameraParticipants.length > 0 ? (
                      splitCameraParticipants.map((participant) =>
                        renderCompactVideoTile(participant, {
                          className: "is-camera-stack",
                        })
                      )
                    ) : (
                      <div className="video-tile is-skeleton is-camera-stack">
                        <div className="video-tile__placeholder">
                          <span className="video-tile__status">No cameras yet</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {showVideoTiles && !isSplitView && (
                  <>
                    {showLocalVideo && (
                      <VideoTile
                        stream={localStream}
                        label="You"
                        muted
                        status={!localStream ? "Camera off" : isVideoEnabled ? "" : "Camera off"}
                        className={`is-local is-self-video${
                          isLocalPrimary ? " is-primary" : ""
                        }${
                          !isLocalPrimary && isMobileLayout && !isMobileCameraOnly
                            ? " is-draggable"
                            : ""
                        }${isPipDragging ? " is-dragging" : ""}${
                          localEffectClass ? ` ${localEffectClass}` : ""
                        }`}
                        style={pipStyle}
                        onPointerDown={handlePipPointerDown}
                        onPointerMove={handlePipPointerMove}
                        onPointerUp={handlePipPointerUp}
                        onPointerLeave={handlePipPointerUp}
                      >
                        {showFocusControls && (
                          <div className="video-tile__actions">
                            <button
                              type="button"
                              className={`video-tile-focus${
                                isLocalFocused ? " is-active" : ""
                              }`}
                              onClick={() => toggleVideoFocus("local")}
                              aria-pressed={isLocalFocused}
                            >
                              {isLocalFocused ? "Show all" : "Focus"}
                            </button>
                          </div>
                        )}
                      </VideoTile>
                    )}
                    {visibleVideoParticipants.map((participant) => {
                      const isFocused = focusedVideoKey === participant.socketId;
                      return (
                        <VideoTile
                          key={participant.socketId}
                          stream={mergedRemoteStreams[participant.socketId] || null}
                          label={resolveParticipantLabel({
                            userId: participant.userId,
                            displayName: participant.displayName,
                            handle: participant.handle,
                          })}
                          avatarUrl={participant.avatarUrl}
                          muted={isRenderingInPopout}
                          status={
                            mergedRemoteStreams[participant.socketId]
                              ? ""
                              : "Waiting for video"
                          }
                          className={
                            participant.socketId === primaryVideoSocketId ? "is-primary" : undefined
                          }
                        >
                          {showFocusControls && (
                            <div className="video-tile__actions">
                              <button
                                type="button"
                                className={`video-tile-focus${
                                  isFocused ? " is-active" : ""
                                }`}
                                onClick={() => toggleVideoFocus(participant.socketId)}
                                aria-pressed={isFocused}
                              >
                                {isFocused ? "Show all" : "Focus"}
                              </button>
                            </div>
                          )}
                        </VideoTile>
                      );
                    })}
                    {status === "connecting" && remoteList.length === 0 && (
                      <div className="video-tile is-skeleton">
                        <div className="video-tile__placeholder">
                          <span className="video-tile__status">
                            Connecting to friends...
                          </span>
                        </div>
                      </div>
                    )}
                  </>
                )}
                  </>
                )}
                <button
                  type="button"
                  className="video-call-end-mobile"
                  onClick={() => {
                    void playEndCallTone();
                    endCall();
                  }}
                >
                  End call
                </button>
              </div>
            </>
          )}
        </div>

        <div className="video-call-sidebar" style={chatStyle}>
          <div className="video-chat-header">
            <strong>Call chat</strong>
            <span>{showCallUi ? "Live" : "Ready"}</span>
            <div className="video-chat-toggle is-mobile-only">
              <button
                type="button"
                className={`video-view-button${mobilePanel === "video" ? " is-active" : ""}`}
                onClick={() => setMobilePanel("video")}
                disabled={!showCallUi}
              >
                {mobilePanel === "chat" ? "Back to video" : "Video"}
              </button>
              <button
                type="button"
                className={`video-view-button${mobilePanel === "chat" ? " is-active" : ""}`}
                onClick={() => setMobilePanel("chat")}
                disabled={!showCallUi}
              >
                Chat
              </button>
            </div>
          </div>
          <div className="video-chat-list">
            {messages.length === 0 ? (
              <p className="status">Messages appear here during the call.</p>
            ) : (
              orderedMessages.map((message) => {
                const reactionMap = messageReactions[message.id] || {};
                const reactionEntries = Object.entries(reactionMap);
                const isPickerOpen = activeReactionMessageId === message.id;
                const messageLinks =
                  message.kind === "text" ? extractLinks(message.body || "") : [];
                return (
                  <div
                    key={message.id}
                    className={`video-chat-message${message.kind === "emoji" ? " is-emoji" : ""}${
                      message.kind === "gif" ? " is-gif" : ""
                    }`}
                  >
                    <div className="video-chat-meta">
                      <span>{resolveMessageName(message)}</span>
                      <span>
                        {new Date(message.at).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div
                      className={`video-chat-body${
                        message.kind === "emoji" ? " is-emoji" : ""
                      }`}
                    >
                      {renderMessageContent(message)}
                    </div>
                    {messageLinks.length > 0 && (
                      <div className="video-chat-link-list">
                        {messageLinks.map((url) => {
                          const meta = linkMeta[url];
                          const title = meta?.title || meta?.siteName || formatUrlLabel(url);
                          const description = meta?.description || "";
                          const image = meta?.image || faviconFor(url);
                          const hasImage = Boolean(image);
                          const isFavicon = !meta?.image && hasImage;
                          const siteLabel = meta?.siteName || formatUrlLabel(url);
                          return (
                            <a
                              key={`${message.id}-${url}`}
                              className="video-chat-link-card"
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {hasImage ? (
                                <div className="video-chat-link-media">
                                  <img
                                    src={image}
                                    alt={title}
                                    loading="lazy"
                                    className={isFavicon ? "is-favicon" : ""}
                                  />
                                </div>
                              ) : (
                                <div className="video-chat-link-media is-placeholder">LINK</div>
                              )}
                              <div className="video-chat-link-body">
                                <span className="video-chat-link-title">{title}</span>
                                {description && (
                                  <span className="video-chat-link-desc">{description}</span>
                                )}
                                <span className="video-chat-link-url">{siteLabel}</span>
                              </div>
                            </a>
                          );
                        })}
                      </div>
                    )}
                    <div className="video-chat-reaction-row">
                      {reactionEntries.map(([emoji, users]) => {
                        const userList = Array.isArray(users) ? users : [];
                        const isActive = userList.includes(currentUserKey);
                        return (
                          <button
                            key={`${message.id}-${emoji}`}
                            type="button"
                            className={`video-chat-reaction-chip${
                              isActive ? " is-active" : ""
                            }`}
                            onClick={() => toggleMessageReaction(message.id, emoji)}
                            aria-pressed={isActive}
                          >
                            <span className="video-chat-reaction-symbol">{emoji}</span>
                            <span className="video-chat-reaction-count">{userList.length}</span>
                          </button>
                        );
                      })}
                      {showCallUi && (
                        <button
                          type="button"
                          className={`video-chat-reaction-add${
                            isPickerOpen ? " is-active" : ""
                          }`}
                          onClick={() => openReactionPicker(message.id)}
                          aria-pressed={isPickerOpen}
                          aria-label="Add reaction"
                        >
                          <FontAwesomeIcon icon={faFaceSmileRegular} aria-hidden="true" />
                        </button>
                      )}
                    </div>
                    {isPickerOpen && (
                      <div className="video-chat-reaction-picker">
                        {REACTION_EMOJIS.map((emoji) => (
                          <button
                            key={`${message.id}-pick-${emoji}`}
                            type="button"
                            className="video-chat-reaction-emoji"
                            onClick={() => {
                              toggleMessageReaction(message.id, emoji);
                              setActiveReactionMessageId(null);
                            }}
                            aria-label={`React with ${emoji}`}
                          >
                            {emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="video-chat-input">
            <div className="video-chat-tools">
              <button
                type="button"
                className="video-chat-tool"
                onClick={() => {
                  setShowEmojiPicker((prev) => !prev);
                  setShowGifPicker(false);
                }}
                aria-label="Pick emoji"
              >
                <FontAwesomeIcon icon={faFaceSmileSolid} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="video-chat-tool"
                onClick={() => {
                  setShowGifPicker((prev) => !prev);
                  setShowEmojiPicker(false);
                }}
                aria-label="Pick GIF"
              >
                GIF
              </button>
              <label className="video-chat-size">
                <span>Text</span>
                <select
                  value={chatTextSize}
                  onChange={(event) =>
                    setChatTextSize(event.target.value as "sm" | "md" | "lg")
                  }
                  aria-label="Chat text size"
                >
                  <option value="sm">Small</option>
                  <option value="md">Medium</option>
                  <option value="lg">Large</option>
                </select>
              </label>
            </div>
            {showEmojiPicker && (
              <div className="video-chat-picker">
                <div className="video-chat-picker-tabs">
                  <button
                    type="button"
                    className={`video-chat-picker-tab${
                      emojiMode === "2d" ? " is-active" : ""
                    }`}
                    onClick={() => setEmojiMode("2d")}
                  >
                    2D emojis
                  </button>
                  <button
                    type="button"
                    className={`video-chat-picker-tab${
                      emojiMode === "3d" ? " is-active" : ""
                    }`}
                    onClick={() => setEmojiMode("3d")}
                  >
                    3D emojis
                  </button>
                </div>
                <div className="video-chat-picker-categories">
                  {emojiMode === "2d"
                    ? EMOJI_CATEGORIES.map((category) => (
                        <button
                          key={category.id}
                          type="button"
                          className={`video-chat-picker-category${
                            category.id === activeEmojiCategory.id ? " is-active" : ""
                          }`}
                          onClick={() => setEmojiCategoryId(category.id)}
                        >
                          {category.label}
                        </button>
                      ))
                    : EMOJI_3D_CATEGORIES.map((category) => (
                        <button
                          key={category.id}
                          type="button"
                          className={`video-chat-picker-category${
                            category.id === activeEmoji3dCategory.id ? " is-active" : ""
                          }`}
                          onClick={() => setEmoji3dCategoryId(category.id)}
                        >
                          {category.label}
                        </button>
                      ))}
                </div>
                <div
                  className={`video-chat-picker-grid${
                    emojiMode === "3d" ? " is-3d" : ""
                  }`}
                >
                  {emojiMode === "2d"
                    ? activeEmojiCategory.emojis.map((emoji) => (
                        <button
                          key={`${activeEmojiCategory.id}-${emoji}`}
                          type="button"
                          className="video-chat-emoji"
                          onClick={() => handleEmojiPick(emoji)}
                        >
                          {emoji}
                        </button>
                      ))
                    : activeEmoji3dCategory.items.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          className="video-chat-emoji is-3d"
                          onClick={() => handleAnimatedEmojiPick(item)}
                          aria-label={item.label}
                        >
                          {emoji3dErrors[item.id] ? (
                            <span className="video-chat-emoji-fallback">
                              {item.fallback}
                            </span>
                          ) : (
                            <img
                              src={item.url}
                              alt={item.label}
                              loading="lazy"
                              onError={() =>
                                setEmoji3dErrors((prev) => ({ ...prev, [item.id]: true }))
                              }
                            />
                          )}
                          <span className="video-chat-emoji-label">{item.label}</span>
                        </button>
                      ))}
                </div>
              </div>
            )}
            {showGifPicker && (
              <div className="video-chat-picker is-gif">
                <div className="video-chat-gif-toolbar">
                  <div className="video-chat-gif-search">
                    <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
                    <input
                      type="search"
                      value={gifSearch}
                      onChange={(event) => setGifSearch(event.target.value)}
                      placeholder="Search GIFs"
                      aria-label="Search GIFs"
                    />
                    {gifSearch && (
                      <button
                        type="button"
                        className="video-chat-gif-clear"
                        onClick={() => setGifSearch("")}
                        aria-label="Clear GIF search"
                      >
                        <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                  <div className="video-chat-gif-categories">
                    {GIF_CATEGORIES.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        className={`video-chat-gif-category${
                          category.id === activeGifCategory.id ? " is-active" : ""
                        }`}
                        onClick={() => {
                          setGifCategoryId(category.id);
                          setGifSearch("");
                        }}
                      >
                        {category.label}
                      </button>
                    ))}
                  </div>
                </div>
                {!canUseGiphy && (
                  <p className="video-chat-picker-note is-error">
                    Add VITE_GIPHY_API_KEY to load the full GIF library.
                  </p>
                )}
                <div className="video-chat-gif-grid" ref={gifGridRef}>
                  {canUseGiphy ? (
                    gifGridWidth > 0 && (
                      <Grid
                        key={gifGridKey}
                        width={gifGridWidth}
                        columns={gifGridColumns}
                        gutter={8}
                        fetchGifs={fetchGifs}
                        onGifClick={(gif, event) => {
                          event.preventDefault();
                          const gifUrl =
                            gif.images?.original?.url ||
                            gif.images?.fixed_width?.url ||
                            gif.images?.downsized?.url;
                          if (gifUrl) handleGifPick(gifUrl);
                        }}
                      />
                    )
                  ) : (
                    GIFS.map((gif) => (
                      <button
                        key={gif.url}
                        type="button"
                        className="video-chat-gif"
                        onClick={() => handleGifPick(gif.url)}
                      >
                        <img src={gif.url} alt={gif.label} loading="lazy" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
            <div className="video-chat-compose">
              <textarea
                className="video-chat-textarea"
                value={chatInput}
                onChange={(event) => setChatInput(sanitizePostText(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey) return;
                  event.preventDefault();
                  if (!showCallUi) return;
                  handleSend();
                }}
                placeholder="Type a message"
                rows={2}
                disabled={!showCallUi}
              />
              <button
                type="button"
                className="btn primary"
                onClick={handleSend}
                disabled={!showCallUi || !chatInput.trim()}
              >
                Send
              </button>
            </div>
          </div>
        </div>
        {showControlHelper && (
          <div className="video-control-helper-overlay" onClick={closeControlHelper}>
            <div
              className="video-control-helper-card"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="video-control-helper-header">
                <div>
                  <p className="eyebrow">Windows only</p>
                  <h3>Enable Windows Screen Control</h3>
                </div>
                <button
                  type="button"
                  className="video-control-helper-close"
                  onClick={closeControlHelper}
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <p className="video-control-helper-note">
                Browsers can’t control your Windows desktop directly. The helper app runs on
                your PC so approved controllers can move the real mouse and type.
              </p>
              <div className="video-control-helper-actions">
                {isDesktopApp ? (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => void handleOpenHelper()}
                  >
                    Open helper
                  </button>
                ) : (
                  <a
                    className="btn ghost"
                    href={windowsHelperDownloadUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Download helper
                  </a>
                )}
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void generateControlHelperCode()}
                  disabled={controlHelperStatus === "loading"}
                >
                  {controlHelperStatus === "loading" ? "Generating..." : "Generate new code"}
                </button>
                <button
                  type="button"
                  className="btn primary"
                  onClick={copyControlHelperCode}
                  disabled={!controlHelperCode}
                >
                  {controlHelperCopied ? "Copied" : "Copy code"}
                </button>
              </div>
              <textarea
                className="video-control-helper-code"
                readOnly
                value={controlHelperCode}
                placeholder="Connection code will appear here."
              />
              {controlHelperError && (
                <p className="video-control-helper-error">{controlHelperError}</p>
              )}
              <div className="video-control-helper-steps">
                <span>
                  {isDesktopApp
                    ? "1. Open the Windows Helper from the desktop app."
                    : "1. Download the Your Social Place Windows Helper."}
                </span>
                <span>
                  {isDesktopApp
                    ? "2. The connection code will be sent to the helper."
                    : "2. Paste this code into the helper and connect."}
                </span>
                <span>3. Approve control requests inside the call.</span>
                <span>Tip: Share your full screen for the most accurate control.</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  if (isRenderingInPopout && popoutContainer) {
    return createPortal(modalContent, popoutContainer);
  }

  return modalContent;
}
