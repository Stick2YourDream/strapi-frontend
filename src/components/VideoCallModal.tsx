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
import axios from "axios";
import { useNavigate } from "react-router-dom";
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
  faSliders,
  faStop,
  faTableColumns,
  faTrash,
  faUpRightFromSquare,
  faUser,
  faUserMinus,
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

type SettingsModalBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
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

const formatScreenShareLabel = (_rawLabel: string, fallbackLabel: string) => fallbackLabel;

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

const formatPercentValue = (value: number, options?: { signed?: boolean }) => {
  const rounded = Math.round(value * 100);
  if (options?.signed && rounded > 0) return `+${rounded}%`;
  return `${rounded}%`;
};

const AVATAR_BASE_EYE_X = 0.5;
const AVATAR_BASE_EYE_Y = 0.34;
const AVATAR_BASE_EYE_SPACING = 0.18;
const AVATAR_BASE_MOUTH_Y = 0.58;
const AVATAR_DEFAULT_OFFSET_X = 0;
const AVATAR_DEFAULT_OFFSET_Y = 0;
const AVATAR_DEFAULT_SCALE = 1;
const AVATAR_DEFAULT_EYE_SPACING = 0.45;
const AVATAR_DEFAULT_EYE_OFFSET_X = 0;
const AVATAR_DEFAULT_EYE_OFFSET_Y = 0;
const AVATAR_DEFAULT_EYE_SIZE = 1;
const AVATAR_DEFAULT_MOUTH_OFFSET_X = 0;
const AVATAR_DEFAULT_MOUTH_OFFSET_Y = -0.08;
const AVATAR_DEFAULT_MOUTH_SIZE = 1;
const AVATAR_PRESET_PROFILE_SETTINGS_VALUE = "__profile_settings__";
const CHAT_TEXT_SIZE_MIN_REM = 0.6;
const CHAT_TEXT_SIZE_MAX_REM = 4;
const CHAT_TEXT_SIZE_STEP_REM = 0.1;
const SETTINGS_MODAL_MIN_WIDTH = 500;
const SETTINGS_MODAL_MIN_HEIGHT = 460;

type AvatarFeatureCalibration = {
  avatarEyeOffsetX: number;
  avatarEyeOffsetY: number;
  avatarEyeSpacing: number;
  avatarMouthOffsetX: number;
  avatarMouthOffsetY: number;
};

type FaceDetectorPoint = { x?: number; y?: number };
type FaceDetectorLandmark = {
  type?: string;
  x?: number;
  y?: number;
  locations?: FaceDetectorPoint[];
};
type FaceDetectorBoundingBox = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  left?: number;
  top?: number;
};
type FaceDetectorResult = {
  boundingBox?: FaceDetectorBoundingBox;
  landmarks?: FaceDetectorLandmark[];
};
type FaceDetectorInstance = {
  detect: (source: CanvasImageSource) => Promise<FaceDetectorResult[]>;
};
type FaceDetectorConstructor = new (options?: {
  fastMode?: boolean;
  maxDetectedFaces?: number;
}) => FaceDetectorInstance;

const normalizeLandmarkType = (value: string | undefined) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, "");

const toFiniteNumber = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const pointIsValid = (point: FaceDetectorPoint): point is { x: number; y: number } =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

const averagePoint = (points: Array<{ x: number; y: number }>) => {
  if (!points.length) return null;
  const total = points.reduce(
    (acc, point) => ({
      x: acc.x + point.x,
      y: acc.y + point.y,
    }),
    { x: 0, y: 0 }
  );
  return {
    x: total.x / points.length,
    y: total.y / points.length,
  };
};

const collectLandmarkPoints = (
  landmarks: FaceDetectorLandmark[],
  acceptedTypes: string[]
) => {
  const accepted = new Set(acceptedTypes.map((type) => normalizeLandmarkType(type)));
  const points: Array<{ x: number; y: number }> = [];
  landmarks.forEach((landmark) => {
    const normalizedType = normalizeLandmarkType(landmark.type);
    if (!accepted.has(normalizedType)) return;
    if (Array.isArray(landmark.locations) && landmark.locations.length) {
      landmark.locations.forEach((location) => {
        if (pointIsValid(location)) {
          points.push({ x: location.x, y: location.y });
        }
      });
      return;
    }
    if (pointIsValid(landmark)) {
      points.push({ x: landmark.x, y: landmark.y });
    }
  });
  return points;
};

const loadImageForAvatarCalibration = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Unable to load avatar image."));
    image.src = source;
  });

const detectAvatarFeatureCalibration = async (
  avatarUrl: string
): Promise<AvatarFeatureCalibration | null> => {
  if (typeof window === "undefined") return null;
  const detectorCtor = (
    window as Window & {
      FaceDetector?: FaceDetectorConstructor;
    }
  ).FaceDetector;
  if (!detectorCtor) return null;

  const image = await loadImageForAvatarCalibration(avatarUrl);
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  if (!width || !height) return null;

  const detector = new detectorCtor({ fastMode: true, maxDetectedFaces: 1 });
  const faces = await detector.detect(image);
  const firstFace = faces[0];
  if (!firstFace) return null;

  const landmarks = Array.isArray(firstFace.landmarks) ? firstFace.landmarks : [];
  const leftEyePoints = collectLandmarkPoints(landmarks, ["leftEye"]);
  const rightEyePoints = collectLandmarkPoints(landmarks, ["rightEye"]);
  const allEyePoints = collectLandmarkPoints(landmarks, ["eye", "leftEye", "rightEye"]);
  const mouthPoints = collectLandmarkPoints(landmarks, [
    "mouth",
    "upperLip",
    "lowerLip",
    "lips",
  ]);

  let leftEye = averagePoint(leftEyePoints);
  let rightEye = averagePoint(rightEyePoints);
  if ((!leftEye || !rightEye) && allEyePoints.length >= 2) {
    const sortedEyes = [...allEyePoints].sort((a, b) => a.x - b.x);
    leftEye = leftEye || sortedEyes[0];
    rightEye = rightEye || sortedEyes[sortedEyes.length - 1];
  }
  let mouth = averagePoint(mouthPoints);

  const box = firstFace.boundingBox;
  const boxX = toFiniteNumber(box?.x) ?? toFiniteNumber(box?.left);
  const boxY = toFiniteNumber(box?.y) ?? toFiniteNumber(box?.top);
  const boxWidth = toFiniteNumber(box?.width);
  const boxHeight = toFiniteNumber(box?.height);
  if (
    (!leftEye || !rightEye || !mouth) &&
    boxX !== null &&
    boxY !== null &&
    boxWidth !== null &&
    boxHeight !== null &&
    boxWidth > 0 &&
    boxHeight > 0
  ) {
    leftEye = leftEye || { x: boxX + boxWidth * 0.32, y: boxY + boxHeight * 0.38 };
    rightEye = rightEye || { x: boxX + boxWidth * 0.68, y: boxY + boxHeight * 0.38 };
    mouth = mouth || { x: boxX + boxWidth * 0.5, y: boxY + boxHeight * 0.7 };
  }

  if (!leftEye || !rightEye || !mouth) return null;

  const eyeDistanceNormalized = Math.abs(rightEye.x - leftEye.x) / width;
  const eyeCenterXNormalized = (leftEye.x + rightEye.x) / 2 / width;
  const eyeYNormalized = (leftEye.y + rightEye.y) / 2 / height;
  const mouthXNormalized = mouth.x / width;
  const mouthYNormalized = mouth.y / height;

  return {
    avatarEyeOffsetX: clampValue(eyeCenterXNormalized - AVATAR_BASE_EYE_X, -0.35, 0.35),
    avatarEyeOffsetY: clampValue(eyeYNormalized - AVATAR_BASE_EYE_Y, -0.3, 0.3),
    avatarEyeSpacing: clampValue(
      eyeDistanceNormalized / (AVATAR_BASE_EYE_SPACING * 2),
      0.25,
      1
    ),
    avatarMouthOffsetX: clampValue(
      mouthXNormalized - eyeCenterXNormalized,
      -0.35,
      0.35
    ),
    avatarMouthOffsetY: clampValue(mouthYNormalized - AVATAR_BASE_MOUTH_Y, -0.3, 0.3),
  };
};

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
  { id: "ai", label: "AI (Generate)" },
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

const AVATAR_PRESET_OPTIONS = [
  {
    id: "human-alex",
    label: "Human - Alex",
    url: "/avatar-presets/human-alex.svg",
  },
  {
    id: "human-maya",
    label: "Human - Maya",
    url: "/avatar-presets/human-maya.svg",
  },
  {
    id: "human-jordan",
    label: "Human - Jordan",
    url: "/avatar-presets/human-jordan.svg",
  },
  {
    id: "human-sofia",
    label: "Human - Sofia",
    url: "/avatar-presets/human-sofia.svg",
  },
  {
    id: "human-ethan",
    label: "Human - Ethan",
    url: "/avatar-presets/human-ethan.svg",
  },
  {
    id: "human-ava",
    label: "Human - Ava",
    url: "/avatar-presets/human-ava.svg",
  },
  {
    id: "human-noah",
    label: "Human - Noah",
    url: "/avatar-presets/human-noah.svg",
  },
  {
    id: "human-chloe",
    label: "Human - Chloe",
    url: "/avatar-presets/human-chloe.svg",
  },
  {
    id: "dog-scout",
    label: "Dog - Scout",
    url: "/avatar-presets/dog-scout.svg",
  },
  {
    id: "dog-nova",
    label: "Dog - Nova",
    url: "/avatar-presets/dog-nova.svg",
  },
  {
    id: "cat-luna",
    label: "Cat - Luna",
    url: "/avatar-presets/cat-luna.svg",
  },
  {
    id: "cat-milo",
    label: "Cat - Milo",
    url: "/avatar-presets/cat-milo.svg",
  },
  {
    id: "horse-comet",
    label: "Horse - Comet",
    url: "/avatar-presets/horse-comet.svg",
  },
  {
    id: "horse-willow",
    label: "Horse - Willow",
    url: "/avatar-presets/horse-willow.svg",
  },
  {
    id: "fun-lollipop",
    label: "Talking Lollipop",
    url: "/avatar-presets/fun-lollipop.svg",
  },
  {
    id: "fun-robot",
    label: "Robot Buddy",
    url: "/avatar-presets/fun-robot.svg",
  },
  {
    id: "fun-unicorn",
    label: "Unicorn Pop",
    url: "/avatar-presets/fun-unicorn.svg",
  },
  {
    id: "fun-alien",
    label: "Alien Host",
    url: "/avatar-presets/fun-alien.svg",
  },
  {
    id: "fun-panda",
    label: "Panda Pal",
    url: "/avatar-presets/fun-panda.svg",
  },
  {
    id: "fun-fox",
    label: "Fox Friend",
    url: "/avatar-presets/fun-fox.svg",
  },
];

const AVATAR_EYE_STYLE_OPTIONS = [
  { id: "almond", label: "Almond" },
  { id: "hooded", label: "Hooded" },
  { id: "deep-set", label: "Deep Set" },
  { id: "monolid", label: "Monolid" },
  { id: "cat-eye", label: "Cat Eye" },
  { id: "doe", label: "Doe" },
  { id: "narrow", label: "Narrow" },
  { id: "bright-hazel", label: "Bright Hazel" },
];

const AVATAR_MOUTH_STYLE_OPTIONS = [
  { id: "natural", label: "Natural" },
  { id: "rose", label: "Rose" },
  { id: "mauve", label: "Mauve" },
  { id: "berry", label: "Berry" },
  { id: "caramel", label: "Caramel" },
  { id: "ruby-smile", label: "Ruby Smile" },
  { id: "mocha", label: "Mocha" },
  { id: "plum-gloss", label: "Plum Gloss" },
];

const normalizeAvatarEyeStyle = (value: string) => {
  switch (value) {
    case "almond":
    case "hooded":
    case "deep-set":
    case "monolid":
    case "cat-eye":
    case "doe":
    case "narrow":
    case "bright-hazel":
      return value;
    case "natural":
    case "classic":
      return "almond";
    case "soft":
    case "sleepy":
      return "hooded";
    case "defined":
    case "toon":
      return "deep-set";
    case "bright":
    case "sparkle":
      return "bright-hazel";
    default:
      return "almond";
  }
};

const normalizeAvatarMouthStyle = (value: string) => {
  switch (value) {
    case "natural":
    case "rose":
    case "mauve":
    case "berry":
    case "caramel":
    case "ruby-smile":
    case "mocha":
    case "plum-gloss":
      return value;
    case "nude":
      return "natural";
    case "smile":
      return "ruby-smile";
    case "neutral":
      return "caramel";
    case "defined":
      return "mocha";
    case "round":
      return "plum-gloss";
    case "line":
      return "mocha";
    default:
      return "natural";
  }
};

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
  const navigate = useNavigate();
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
    removeParticipantFromCall,
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
  const isStandaloneVideoApp = Boolean(appSettings) && import.meta.env.MODE === "video";
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
  const [chatTextSizeRem, setChatTextSizeRem] = useState(1);
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
  const [settingsModalBounds, setSettingsModalBounds] = useState<SettingsModalBounds | null>(
    null
  );
  const [isSettingsModalDragging, setIsSettingsModalDragging] = useState(false);
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
  const [screenPipPosition, setScreenPipPosition] = useState<{ x: number; y: number } | null>(
    null
  );
  const [isScreenPipDragging, setIsScreenPipDragging] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [aiBackgroundPrompt, setAiBackgroundPrompt] = useState("");
  const [aiBackgroundError, setAiBackgroundError] = useState<string | null>(null);
  const [aiBackgroundLoading, setAiBackgroundLoading] = useState(false);
  const [showViewSelect, setShowViewSelect] = useState(false);
  const [showScreenSelect, setShowScreenSelect] = useState(false);
  const [showCameraSelect, setShowCameraSelect] = useState(false);
  const [showWebMicDeviceSelect, setShowWebMicDeviceSelect] = useState(false);
  const [showWebCameraDeviceSelect, setShowWebCameraDeviceSelect] = useState(false);
  const [showDesktopMicSelect, setShowDesktopMicSelect] = useState(false);
  const [showDesktopCameraSelect, setShowDesktopCameraSelect] = useState(false);
  const [showDesktopFilterSelect, setShowDesktopFilterSelect] = useState(false);
  const viewSelectRef = useRef<HTMLDivElement | null>(null);
  const screenSelectRef = useRef<HTMLDivElement | null>(null);
  const cameraSelectRef = useRef<HTMLDivElement | null>(null);
  const webMicDeviceSelectRef = useRef<HTMLDivElement | null>(null);
  const webCameraDeviceSelectRef = useRef<HTMLDivElement | null>(null);
  const desktopMicSelectRef = useRef<HTMLDivElement | null>(null);
  const desktopCameraSelectRef = useRef<HTMLDivElement | null>(null);
  const desktopFilterSelectRef = useRef<HTMLDivElement | null>(null);
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
  const settingsOverlayRef = useRef<HTMLDivElement | null>(null);
  const settingsModalRef = useRef<HTMLDivElement | null>(null);
  const settingsDragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const settingsResizeRef = useRef<{
    startX: number;
    startY: number;
    originWidth: number;
    originHeight: number;
  } | null>(null);
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
  const screenPipDragRef = useRef({ active: false, offsetX: 0, offsetY: 0 });
  const demoCleanupRef = useRef<Record<string, () => void>>({});
  const demoCounterRef = useRef(1);
  const avatarAutoAlignedUrlRef = useRef("");
  const avatarCalibrationCacheRef = useRef<Record<string, AvatarFeatureCalibration | null>>({});

  const showModal = isOpen || status === "incoming";
  const showCallUi = status === "in-call" || status === "connecting";
  const showChat = showCallUi && (isChatVisible || mobilePanel === "chat");
  const isChatHidden = showCallUi && !isChatVisible && mobilePanel !== "chat";
  const popoutEnabled = !isStandaloneVideoApp;
  const isRenderingInPopout = Boolean(popoutEnabled && isPopout && popoutContainer);
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
  const isLikelyMobileDevice = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    const uaData = (
      navigator as Navigator & {
        userAgentData?: { mobile?: boolean };
      }
    ).userAgentData;
    if (uaData?.mobile) return true;
    return /Android|webOS|iPhone|iPad|iPod|Opera Mini|IEMobile|Mobile/i.test(
      navigator.userAgent || ""
    );
  }, []);
  const isWindows = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /Win/i.test(navigator.userAgent || "");
  }, []);
  const showDesktopTitlebar =
    isStandaloneVideoApp &&
    isDesktopApp &&
    !isRenderingInPopout &&
    !isMobileLayout &&
    !isLikelyMobileDevice;
  const showDesktopTitlebarControls = showDesktopTitlebar && showCallUi;
  const overlayClassName = `video-call-overlay video-theme${
    isRenderingInPopout ? " is-popout" : ""
  }`;
  const modalClassName = `video-call-modal${showCallUi ? "" : " is-setup"}${
    isChatHidden ? " is-chat-hidden" : ""
  }${mobilePanel === "chat" ? " is-mobile-chat" : " is-mobile-video"}${
    isRenderingInPopout ? " is-popout" : ""
  }${showDesktopTitlebar ? " has-desktop-titlebar" : ""}`;
  const windowsHelperDownloadUrl = "https://yoursocialplace.com/downloads/ysphelper.exe";

  useEffect(() => {
    screenPanOffsetsRef.current = screenPanOffsets;
  }, [screenPanOffsets]);

  useEffect(() => {
    const avatarUrl = String(videoEffects.avatarImageUrl || "").trim();
    if (!avatarUrl) {
      avatarAutoAlignedUrlRef.current = "";
      return;
    }
    if (avatarAutoAlignedUrlRef.current === avatarUrl) return;
    avatarAutoAlignedUrlRef.current = avatarUrl;

    let presetAvatar = avatarUrl.startsWith("/avatar-presets/");
    if (!presetAvatar) {
      try {
        const parsedUrl = new URL(avatarUrl, window.location.origin);
        presetAvatar = parsedUrl.pathname.startsWith("/avatar-presets/");
      } catch {
        presetAvatar = false;
      }
    }

    if (presetAvatar) {
      avatarCalibrationCacheRef.current[avatarUrl] = null;
      setVideoEffects({
        avatarOffsetX: AVATAR_DEFAULT_OFFSET_X,
        avatarOffsetY: AVATAR_DEFAULT_OFFSET_Y,
        avatarScale: AVATAR_DEFAULT_SCALE,
        avatarEyeOffsetX: 0,
        avatarEyeOffsetY: 0,
        avatarEyeSpacing: AVATAR_DEFAULT_EYE_SPACING,
        avatarEyeSize: AVATAR_DEFAULT_EYE_SIZE,
        avatarMouthOffsetX: 0,
        avatarMouthOffsetY: AVATAR_DEFAULT_MOUTH_OFFSET_Y,
        avatarMouthSize: AVATAR_DEFAULT_MOUTH_SIZE,
      });
      return;
    }

    if (Object.prototype.hasOwnProperty.call(avatarCalibrationCacheRef.current, avatarUrl)) {
      const cached = avatarCalibrationCacheRef.current[avatarUrl];
      if (cached) {
        setVideoEffects(cached);
      }
      return;
    }

    let cancelled = false;
    void detectAvatarFeatureCalibration(avatarUrl)
      .then((calibration) => {
        if (cancelled) return;
        avatarCalibrationCacheRef.current[avatarUrl] = calibration || null;
        if (!calibration) return;
        setVideoEffects(calibration);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [setVideoEffects, videoEffects.avatarImageUrl]);

  useEffect(() => {
    if (!showCallUi) {
      setIsPopout(false);
      setMobilePanel("video");
    }
  }, [showCallUi]);

  useEffect(() => {
    if (showDesktopTitlebarControls) return;
    setShowDesktopMicSelect(false);
    setShowDesktopCameraSelect(false);
    setShowDesktopFilterSelect(false);
  }, [showDesktopTitlebarControls]);

  useEffect(() => {
    if (!popoutEnabled && isPopout) {
      setIsPopout(false);
    }
  }, [isPopout, popoutEnabled]);

  useEffect(() => {
    if (!isRenderingInPopout) {
      setPopoutAudioBlocked(false);
    }
  }, [isRenderingInPopout]);

  useEffect(() => {
    if (!popoutEnabled) {
      if (popoutWindowRef.current && !popoutWindowRef.current.closed) {
        popoutWindowRef.current.close();
      }
      popoutWindowRef.current = null;
      setPopoutContainer(null);
      return;
    }
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
  }, [isPopout, popoutEnabled]);

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
  const incomingIsCurrentRoom = Boolean(
    incomingCall?.roomId && activeRoomId && incomingCall.roomId === activeRoomId
  );
  const incomingAcceptLabel = incomingIsCurrentRoom ? "Join call" : "Switch and accept";
  const localDisplayName = useMemo(() => {
    const first = String(profile?.firstName || "").trim();
    const last = String(profile?.lastName || "").trim();
    const combined = [first, last].filter(Boolean).join(" ").trim();
    if (combined) return combined;
    return "You";
  }, [profile?.firstName, profile?.lastName]);
  const selectedAvatarPresetId = useMemo(() => {
    const currentAvatarUrl = String(videoEffects.avatarImageUrl || "").trim();
    if (!currentAvatarUrl) return "";
    const matchedPreset = AVATAR_PRESET_OPTIONS.find((option) => option.url === currentAvatarUrl);
    return matchedPreset?.id || "";
  }, [videoEffects.avatarImageUrl]);
  const handleAvatarPresetChange = useCallback(
    (event: ChangeEvent<HTMLSelectElement>) => {
      const selectedPresetId = event.target.value;
      if (selectedPresetId === AVATAR_PRESET_PROFILE_SETTINGS_VALUE) {
        if (!isStandaloneVideoApp) {
          navigate("/me?view=settings&section=appearance");
        }
        return;
      }
      const selectedPreset = AVATAR_PRESET_OPTIONS.find((option) => option.id === selectedPresetId);
      if (!selectedPreset) return;
      setVideoEffects({
        avatarEnabled: true,
        avatarImageUrl: selectedPreset.url,
        avatarOffsetX: 0,
        avatarOffsetY: 0,
        avatarScale: 1,
        avatarEyeOffsetX: 0,
        avatarEyeOffsetY: 0,
        avatarEyeSpacing: AVATAR_DEFAULT_EYE_SPACING,
        avatarEyeSize: AVATAR_DEFAULT_EYE_SIZE,
        avatarMouthOffsetX: 0,
        avatarMouthOffsetY: AVATAR_DEFAULT_MOUTH_OFFSET_Y,
        avatarMouthSize: AVATAR_DEFAULT_MOUTH_SIZE,
      });
    },
    [isStandaloneVideoApp, navigate, setVideoEffects]
  );
  const maskStrengthValue = Number.isFinite(videoEffects.maskStrength)
    ? Math.min(1, Math.max(0.2, videoEffects.maskStrength))
    : 0.85;
  const avatarOffsetXValue = Number.isFinite(videoEffects.avatarOffsetX)
    ? Math.min(0.5, Math.max(-0.5, videoEffects.avatarOffsetX))
    : 0;
  const avatarOffsetYValue = Number.isFinite(videoEffects.avatarOffsetY)
    ? Math.min(0.5, Math.max(-0.5, videoEffects.avatarOffsetY))
    : 0;
  const avatarScaleValue = Number.isFinite(videoEffects.avatarScale)
    ? Math.min(1.6, Math.max(0.4, videoEffects.avatarScale))
    : 1;
  const avatarEyeOffsetXValue = Number.isFinite(videoEffects.avatarEyeOffsetX)
    ? Math.min(0.35, Math.max(-0.35, videoEffects.avatarEyeOffsetX))
    : 0;
  const avatarEyeOffsetYValue = Number.isFinite(videoEffects.avatarEyeOffsetY)
    ? Math.min(0.3, Math.max(-0.3, videoEffects.avatarEyeOffsetY))
    : 0;
  const avatarEyeSpacingValue = Number.isFinite(videoEffects.avatarEyeSpacing)
    ? Math.min(1, Math.max(0.25, videoEffects.avatarEyeSpacing))
    : AVATAR_DEFAULT_EYE_SPACING;
  const avatarEyeSizeValue = Number.isFinite(videoEffects.avatarEyeSize)
    ? Math.min(1.8, Math.max(0.5, videoEffects.avatarEyeSize))
    : AVATAR_DEFAULT_EYE_SIZE;
  const avatarMouthOffsetXValue = Number.isFinite(videoEffects.avatarMouthOffsetX)
    ? Math.min(0.35, Math.max(-0.35, videoEffects.avatarMouthOffsetX))
    : 0;
  const avatarMouthOffsetYValue = Number.isFinite(videoEffects.avatarMouthOffsetY)
    ? Math.min(0.3, Math.max(-0.3, videoEffects.avatarMouthOffsetY))
    : AVATAR_DEFAULT_MOUTH_OFFSET_Y;
  const avatarMouthSizeValue = Number.isFinite(videoEffects.avatarMouthSize)
    ? Math.min(1.8, Math.max(0.5, videoEffects.avatarMouthSize))
    : AVATAR_DEFAULT_MOUTH_SIZE;
  const avatarPreviewLayerStyle = useMemo<CSSProperties>(
    () => ({
      transform: `translate(${avatarOffsetXValue * 45}%, ${avatarOffsetYValue * 45}%) scale(${avatarScaleValue})`,
    }),
    [avatarOffsetXValue, avatarOffsetYValue, avatarScaleValue]
  );
  const avatarPreviewFaceMetrics = useMemo(() => {
    const eyeCenterX = clampValue(AVATAR_BASE_EYE_X + avatarEyeOffsetXValue, 0.12, 0.88) * 100;
    const eyeY = clampValue(AVATAR_BASE_EYE_Y + avatarEyeOffsetYValue, 0.1, 0.78) * 100;
    const eyeSpacing = AVATAR_BASE_EYE_SPACING * avatarEyeSpacingValue * 100;
    const leftEyeX = clampValue(eyeCenterX - eyeSpacing, 6, 94);
    const rightEyeX = clampValue(eyeCenterX + eyeSpacing, 6, 94);
    const mouthX = clampValue(eyeCenterX + avatarMouthOffsetXValue * 100, 8, 92);
    const mouthY = clampValue((AVATAR_BASE_MOUTH_Y + avatarMouthOffsetYValue) * 100, 22, 94);
    return {
      leftEyeX,
      rightEyeX,
      eyeY,
      mouthX,
      mouthY,
    };
  }, [
    avatarEyeOffsetXValue,
    avatarEyeOffsetYValue,
    avatarEyeSpacingValue,
    avatarMouthOffsetXValue,
    avatarMouthOffsetYValue,
  ]);
  const renderAvatarPreviewEyes = () => {
    const left = avatarPreviewFaceMetrics.leftEyeX;
    const right = avatarPreviewFaceMetrics.rightEyeX;
    const eyeY = avatarPreviewFaceMetrics.eyeY;
    const eyeStyle = normalizeAvatarEyeStyle(videoEffects.avatarEyeStyle);
    const eyePresets: Record<
      string,
      {
        iris: string;
        width: number;
        height: number;
        upperLift: number;
        lowerLift: number;
        tilt: number;
        irisScale: number;
        pupilScale: number;
        lidAlpha: number;
        irisShift: number;
      }
    > = {
      almond: {
        iris: "rgba(78, 58, 38, 0.95)",
        width: 6.2,
        height: 2.7,
        upperLift: 0.22,
        lowerLift: 0.08,
        tilt: 0.02,
        irisScale: 0.43,
        pupilScale: 0.22,
        lidAlpha: 0.56,
        irisShift: 0,
      },
      hooded: {
        iris: "rgba(86, 72, 54, 0.96)",
        width: 6.15,
        height: 2.3,
        upperLift: 0.33,
        lowerLift: 0.03,
        tilt: 0.01,
        irisScale: 0.4,
        pupilScale: 0.2,
        lidAlpha: 0.62,
        irisShift: 0,
      },
      "deep-set": {
        iris: "rgba(62, 74, 82, 0.95)",
        width: 6.05,
        height: 2.45,
        upperLift: 0.27,
        lowerLift: 0.06,
        tilt: 0.03,
        irisScale: 0.42,
        pupilScale: 0.21,
        lidAlpha: 0.66,
        irisShift: 0,
      },
      monolid: {
        iris: "rgba(74, 84, 62, 0.96)",
        width: 6.2,
        height: 2.05,
        upperLift: 0.38,
        lowerLift: 0.02,
        tilt: 0,
        irisScale: 0.38,
        pupilScale: 0.2,
        lidAlpha: 0.72,
        irisShift: 0,
      },
      "cat-eye": {
        iris: "rgba(56, 76, 66, 0.95)",
        width: 6.25,
        height: 2.35,
        upperLift: 0.28,
        lowerLift: 0.04,
        tilt: 0.17,
        irisScale: 0.4,
        pupilScale: 0.2,
        lidAlpha: 0.7,
        irisShift: 0.16,
      },
      doe: {
        iris: "rgba(98, 74, 48, 0.95)",
        width: 6.15,
        height: 2.95,
        upperLift: 0.16,
        lowerLift: 0.12,
        tilt: 0,
        irisScale: 0.46,
        pupilScale: 0.24,
        lidAlpha: 0.48,
        irisShift: 0,
      },
      narrow: {
        iris: "rgba(74, 72, 62, 0.96)",
        width: 6.4,
        height: 1.95,
        upperLift: 0.4,
        lowerLift: 0.01,
        tilt: 0.05,
        irisScale: 0.34,
        pupilScale: 0.18,
        lidAlpha: 0.75,
        irisShift: 0,
      },
      "bright-hazel": {
        iris: "rgba(112, 90, 42, 0.97)",
        width: 6.15,
        height: 2.6,
        upperLift: 0.2,
        lowerLift: 0.07,
        tilt: 0.02,
        irisScale: 0.45,
        pupilScale: 0.22,
        lidAlpha: 0.58,
        irisShift: 0,
      },
    };
    const preset = eyePresets[eyeStyle] || eyePresets.almond;
    const eyeSize = avatarEyeSizeValue;
    const renderDetailedEye = (centerX: number, side: -1 | 1) => {
      const eyeWidth = preset.width * eyeSize;
      const eyeHeight = preset.height * eyeSize;
      const topY = eyeY - eyeHeight * (1 + preset.upperLift) + eyeHeight * preset.tilt * side;
      const bottomY =
        eyeY + eyeHeight * (1 + preset.lowerLift) - eyeHeight * preset.tilt * side * 0.4;
      const irisRadius = eyeWidth * preset.irisScale;
      const pupilRadius = eyeWidth * preset.pupilScale;
      const irisX = centerX + eyeWidth * preset.irisShift * side;
      return (
        <g>
          <path
            d={`M ${centerX - eyeWidth} ${eyeY} Q ${centerX} ${topY} ${centerX + eyeWidth} ${eyeY} Q ${centerX} ${bottomY} ${centerX - eyeWidth} ${eyeY} Z`}
            fill="rgba(248, 250, 252, 0.95)"
            stroke={`rgba(15, 23, 42, ${preset.lidAlpha})`}
            strokeWidth={0.5}
          />
          <ellipse
            cx={irisX}
            cy={eyeY + eyeHeight * 0.02}
            rx={irisRadius}
            ry={irisRadius * 0.9}
            fill={preset.iris}
          />
          <circle cx={irisX} cy={eyeY + eyeHeight * 0.05} r={pupilRadius} fill="rgba(7, 10, 14, 0.96)" />
          <circle
            cx={irisX - irisRadius * 0.34}
            cy={eyeY - irisRadius * 0.28}
            r={irisRadius * 0.2}
            fill="rgba(255, 255, 255, 0.86)"
          />
          <path
            d={`M ${centerX - eyeWidth} ${eyeY} Q ${centerX} ${topY} ${centerX + eyeWidth} ${eyeY}`}
            fill="none"
            stroke={`rgba(10, 12, 18, ${Math.min(0.86, preset.lidAlpha + 0.2)})`}
            strokeWidth={0.8}
            strokeLinecap="round"
          />
          <path
            d={`M ${centerX - eyeWidth * 0.85} ${eyeY + eyeHeight * 0.45} Q ${centerX} ${bottomY - eyeHeight * 0.08} ${centerX + eyeWidth * 0.85} ${eyeY + eyeHeight * 0.45}`}
            fill="none"
            stroke={`rgba(28, 36, 46, ${Math.max(0.3, preset.lidAlpha - 0.18)})`}
            strokeWidth={0.5}
            strokeLinecap="round"
          />
        </g>
      );
    };
    return (
      <>
        {renderDetailedEye(left, -1)}
        {renderDetailedEye(right, 1)}
      </>
    );
  };
  const renderAvatarPreviewMouth = () => {
    const mouthX = avatarPreviewFaceMetrics.mouthX;
    const mouthY = avatarPreviewFaceMetrics.mouthY;
    const mouthStyle = normalizeAvatarMouthStyle(videoEffects.avatarMouthStyle);
    const mouthPresets: Record<
      string,
      {
        topLip: string;
        lowerLip: string;
        lipLine: string;
        lipShadow: string;
        inner: string;
        teeth: string;
        tongue: string;
        width: number;
        openness: number;
        smile: number;
        showTeeth: boolean;
        showTongue: boolean;
      }
    > = {
      natural: {
        topLip: "rgba(124, 72, 70, 0.62)",
        lowerLip: "rgba(108, 62, 62, 0.54)",
        lipLine: "rgba(76, 34, 36, 0.84)",
        lipShadow: "rgba(48, 22, 24, 0.66)",
        inner: "rgba(30, 10, 14, 0.92)",
        teeth: "rgba(246, 247, 250, 0.9)",
        tongue: "rgba(136, 48, 58, 0.84)",
        width: 0.95,
        openness: 3.4,
        smile: 0.08,
        showTeeth: true,
        showTongue: true,
      },
      rose: {
        topLip: "rgba(162, 74, 92, 0.68)",
        lowerLip: "rgba(144, 64, 84, 0.58)",
        lipLine: "rgba(94, 34, 52, 0.86)",
        lipShadow: "rgba(58, 20, 34, 0.68)",
        inner: "rgba(34, 8, 18, 0.94)",
        teeth: "rgba(248, 248, 252, 0.92)",
        tongue: "rgba(156, 48, 76, 0.86)",
        width: 0.96,
        openness: 3.7,
        smile: 0.12,
        showTeeth: true,
        showTongue: true,
      },
      mauve: {
        topLip: "rgba(130, 86, 112, 0.66)",
        lowerLip: "rgba(114, 72, 98, 0.56)",
        lipLine: "rgba(76, 46, 68, 0.86)",
        lipShadow: "rgba(48, 30, 44, 0.7)",
        inner: "rgba(28, 14, 26, 0.94)",
        teeth: "rgba(245, 246, 250, 0.9)",
        tongue: "rgba(132, 66, 102, 0.84)",
        width: 0.97,
        openness: 3.5,
        smile: 0.04,
        showTeeth: true,
        showTongue: true,
      },
      berry: {
        topLip: "rgba(116, 40, 66, 0.76)",
        lowerLip: "rgba(100, 34, 58, 0.66)",
        lipLine: "rgba(64, 18, 36, 0.9)",
        lipShadow: "rgba(38, 10, 22, 0.74)",
        inner: "rgba(20, 4, 12, 0.96)",
        teeth: "rgba(246, 247, 250, 0.9)",
        tongue: "rgba(124, 34, 66, 0.88)",
        width: 0.94,
        openness: 3.9,
        smile: 0.05,
        showTeeth: true,
        showTongue: true,
      },
      caramel: {
        topLip: "rgba(136, 86, 72, 0.68)",
        lowerLip: "rgba(118, 72, 60, 0.58)",
        lipLine: "rgba(82, 46, 36, 0.86)",
        lipShadow: "rgba(54, 28, 22, 0.68)",
        inner: "rgba(30, 14, 10, 0.92)",
        teeth: "rgba(245, 245, 248, 0.9)",
        tongue: "rgba(146, 70, 58, 0.84)",
        width: 0.98,
        openness: 3.3,
        smile: 0.06,
        showTeeth: true,
        showTongue: true,
      },
      "ruby-smile": {
        topLip: "rgba(168, 42, 56, 0.76)",
        lowerLip: "rgba(148, 34, 48, 0.66)",
        lipLine: "rgba(96, 16, 28, 0.9)",
        lipShadow: "rgba(56, 8, 18, 0.74)",
        inner: "rgba(28, 4, 10, 0.96)",
        teeth: "rgba(250, 250, 252, 0.94)",
        tongue: "rgba(170, 44, 62, 0.9)",
        width: 1,
        openness: 4.2,
        smile: 0.24,
        showTeeth: true,
        showTongue: true,
      },
      mocha: {
        topLip: "rgba(96, 56, 52, 0.74)",
        lowerLip: "rgba(82, 48, 46, 0.64)",
        lipLine: "rgba(52, 28, 28, 0.9)",
        lipShadow: "rgba(30, 16, 18, 0.76)",
        inner: "rgba(18, 10, 10, 0.96)",
        teeth: "rgba(243, 243, 246, 0.88)",
        tongue: "rgba(118, 62, 62, 0.84)",
        width: 0.94,
        openness: 3.8,
        smile: 0.02,
        showTeeth: true,
        showTongue: true,
      },
      "plum-gloss": {
        topLip: "rgba(118, 54, 98, 0.78)",
        lowerLip: "rgba(104, 44, 88, 0.68)",
        lipLine: "rgba(68, 24, 58, 0.92)",
        lipShadow: "rgba(40, 12, 34, 0.76)",
        inner: "rgba(22, 6, 20, 0.96)",
        teeth: "rgba(248, 248, 252, 0.92)",
        tongue: "rgba(136, 52, 108, 0.88)",
        width: 0.96,
        openness: 4.1,
        smile: 0.1,
        showTeeth: true,
        showTongue: true,
      },
    };
    const preset = mouthPresets[mouthStyle] || mouthPresets.natural;
    const mouthSize = avatarMouthSizeValue;
    const mouthWidth = 13.8 * preset.width * mouthSize;
    const openness = preset.openness * mouthSize;
    const smileLift = openness * preset.smile;
    const leftX = mouthX - mouthWidth;
    const rightX = mouthX + mouthWidth;

    return (
      <>
        <path
          d={`M ${leftX} ${mouthY} Q ${mouthX} ${mouthY - openness * (0.54 + preset.smile * 0.3)} ${rightX} ${mouthY} Q ${mouthX} ${mouthY + openness * 0.2} ${leftX} ${mouthY} Z`}
          fill={preset.topLip}
        />
        <path
          d={`M ${leftX * 0.985 + mouthX * 0.015} ${mouthY + openness * 0.08} Q ${mouthX} ${mouthY + openness * (1.12 + preset.smile * 0.2)} ${rightX * 0.985 + mouthX * 0.015} ${mouthY + openness * 0.08} Q ${mouthX} ${mouthY + openness * 0.24} ${leftX * 0.985 + mouthX * 0.015} ${mouthY + openness * 0.08} Z`}
          fill={preset.lowerLip}
        />
        <ellipse
          cx={mouthX}
          cy={mouthY + openness * (0.36 - preset.smile * 0.16)}
          rx={mouthWidth * 0.82}
          ry={openness * 0.92}
          fill={preset.inner}
        />
        {preset.showTeeth && (
          <rect
            x={mouthX - mouthWidth * 0.5}
            y={mouthY - openness * 0.02 - smileLift}
            width={mouthWidth}
            height={Math.max(1.2, openness * 0.38)}
            rx={1.1}
            fill={preset.teeth}
          />
        )}
        {preset.showTongue && (
          <ellipse
            cx={mouthX}
            cy={mouthY + openness * 0.85}
            rx={mouthWidth * 0.38}
            ry={Math.max(1.1, openness * 0.42)}
            fill={preset.tongue}
          />
        )}
        <path
          d={`M ${leftX} ${mouthY} Q ${mouthX} ${mouthY - openness * (0.58 + preset.smile * 0.34)} ${rightX} ${mouthY}`}
          fill="none"
          stroke={preset.lipLine}
          strokeWidth={1.9}
          strokeLinecap="round"
        />
        <path
          d={`M ${leftX * 0.9 + mouthX * 0.1} ${mouthY + openness * 0.5} Q ${mouthX} ${mouthY + openness * (1.16 + preset.smile * 0.2)} ${rightX * 0.9 + mouthX * 0.1} ${mouthY + openness * 0.5}`}
          fill="none"
          stroke={preset.lipShadow}
          strokeWidth={1.35}
          strokeLinecap="round"
        />
      </>
    );
  };
  const handleResetAvatarPlacement = useCallback(() => {
    setVideoEffects({
      avatarOffsetX: AVATAR_DEFAULT_OFFSET_X,
      avatarOffsetY: AVATAR_DEFAULT_OFFSET_Y,
      avatarScale: AVATAR_DEFAULT_SCALE,
    });
  }, [setVideoEffects]);

  const handleResetAvatarFace = useCallback(() => {
    setVideoEffects({
      avatarEyeSpacing: AVATAR_DEFAULT_EYE_SPACING,
      avatarEyeOffsetX: AVATAR_DEFAULT_EYE_OFFSET_X,
      avatarEyeOffsetY: AVATAR_DEFAULT_EYE_OFFSET_Y,
      avatarEyeSize: AVATAR_DEFAULT_EYE_SIZE,
      avatarMouthOffsetX: AVATAR_DEFAULT_MOUTH_OFFSET_X,
      avatarMouthOffsetY: AVATAR_DEFAULT_MOUTH_OFFSET_Y,
      avatarMouthSize: AVATAR_DEFAULT_MOUTH_SIZE,
    });
  }, [setVideoEffects]);

  const handleResetAvatarAlignment = useCallback(() => {
    setVideoEffects({
      avatarOffsetX: AVATAR_DEFAULT_OFFSET_X,
      avatarOffsetY: AVATAR_DEFAULT_OFFSET_Y,
      avatarScale: AVATAR_DEFAULT_SCALE,
      avatarEyeSpacing: AVATAR_DEFAULT_EYE_SPACING,
      avatarEyeOffsetX: AVATAR_DEFAULT_EYE_OFFSET_X,
      avatarEyeOffsetY: AVATAR_DEFAULT_EYE_OFFSET_Y,
      avatarEyeSize: AVATAR_DEFAULT_EYE_SIZE,
      avatarMouthOffsetX: AVATAR_DEFAULT_MOUTH_OFFSET_X,
      avatarMouthOffsetY: AVATAR_DEFAULT_MOUTH_OFFSET_Y,
      avatarMouthSize: AVATAR_DEFAULT_MOUTH_SIZE,
    });
  }, [setVideoEffects]);

  const buildAiBackgroundPrompt = useCallback((prompt: string) => {
    return [
      "High detail cinematic background, no people, no text.",
      prompt.trim(),
      "Soft lighting, depth of field, 16:9 composition.",
    ]
      .filter(Boolean)
      .join(" ");
  }, []);
  const hasRemoteMedia = useMemo(() => {
    if (remoteList.length > 0) return true;
    if (Object.keys(mergedRemoteStreams).length > 0) return true;
    return Object.keys(mergedRemoteScreenStreams).length > 0;
  }, [mergedRemoteScreenStreams, mergedRemoteStreams, remoteList.length]);

  const requestAiImage = useCallback(
    async (payload: { prompt: string; kind: "background" | "avatar"; pose?: string }) => {
      const response = await api.post("/ai-images/generate", payload);
      const image = response?.data?.image;
      if (!image || typeof image !== "string") {
        throw new Error("No image returned.");
      }
      return image;
    },
    []
  );

  const resolveAiErrorMessage = useCallback((err: unknown, fallback: string) => {
    if (!axios.isAxiosError(err)) {
      return (err as Error)?.message || fallback;
    }
    const data = err.response?.data as
      | { error?: { message?: string } | string; message?: string }
      | undefined;
    const error = data?.error;
    if (typeof error === "string" && error.trim()) return error;
    if (typeof error === "object" && error?.message) return error.message;
    if (typeof data?.message === "string" && data.message.trim()) return data.message;
    return fallback;
  }, []);

  const handleGenerateAiBackground = useCallback(async () => {
    const prompt = aiBackgroundPrompt.trim();
    if (!prompt) {
      setAiBackgroundError("Describe the background you want.");
      return;
    }
    setAiBackgroundLoading(true);
    setAiBackgroundError(null);
    try {
      const image = await requestAiImage({
        kind: "background",
        prompt: buildAiBackgroundPrompt(prompt),
      });
      setVideoEffects({
        background: "ai",
        backgroundImageUrl: image,
      });
    } catch (err) {
      setAiBackgroundError(resolveAiErrorMessage(err, "Unable to generate background."));
    } finally {
      setAiBackgroundLoading(false);
    }
  }, [
    aiBackgroundPrompt,
    buildAiBackgroundPrompt,
    requestAiImage,
    resolveAiErrorMessage,
    setVideoEffects,
  ]);

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
      const localScreenLabel = formatScreenShareLabel(trackLabel, localDisplayName);
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
        label: name,
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

  const mobileScreenShareEntry = useMemo(() => {
    if (!isMobileLayout) return null;
    if (screenShareEntries.length === 0) return null;
    const remoteEntry = screenShareEntries.find((entry) => !entry.isLocal);
    return remoteEntry || screenShareEntries[0] || null;
  }, [isMobileLayout, screenShareEntries]);

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
  const localAvatarMediaStyle = useMemo<CSSProperties | undefined>(
    () =>
      videoEffects.avatarEnabled
        ? {
            objectFit: "contain",
            background: "#05070f",
          }
        : undefined,
    [videoEffects.avatarEnabled]
  );

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
          mediaStyle={participant.isLocal ? localAvatarMediaStyle : undefined}
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
              {isCallHost && !participant.isLocal && (
                <button
                  type="button"
                  className="video-tile-focus is-remove"
                  onClick={() => {
                    const normalizedLabel =
                      String(participant.label || "this participant").trim() ||
                      "this participant";
                    const shouldRemove = window.confirm(
                      `Remove ${normalizedLabel} from this call?`
                    );
                    if (!shouldRemove) return;
                    removeParticipantFromCall(participant.id);
                  }}
                  aria-label={`Remove ${participant.label} from call`}
                  title="Remove from call"
                >
                  <FontAwesomeIcon icon={faUserMinus} aria-hidden="true" />
                  <span>Remove</span>
                </button>
              )}
            </div>
          )}
        </VideoTile>
      );
    },
    [
      focusedVideoKey,
      isRenderingInPopout,
      isCallHost,
      localAvatarMediaStyle,
      localEffectClass,
      primaryVideoSocketId,
      removeParticipantFromCall,
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
    if (showWebMicDeviceSelect) setShowWebMicDeviceSelect(false);
    if (showWebCameraDeviceSelect) setShowWebCameraDeviceSelect(false);
    if (showDesktopFilterSelect) setShowDesktopFilterSelect(false);
    setPipPosition(null);
    setIsPipDragging(false);
    pipDragRef.current.active = false;
    setScreenPipPosition(null);
    setIsScreenPipDragging(false);
    screenPipDragRef.current.active = false;
  }, [
    focusedScreenId,
    focusedVideoId,
    isMobileLayout,
    isPopout,
    isScreenBorderless,
    mobilePanel,
    screenViewMode,
    showCameraSelect,
    showWebCameraDeviceSelect,
    showDesktopFilterSelect,
    showWebMicDeviceSelect,
    showScreenSelect,
    showViewSelect,
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

  useEffect(() => {
    if (!showCallUi || !isMobileLayout || !mobileScreenShareEntry) {
      setScreenPipPosition(null);
      setIsScreenPipDragging(false);
      screenPipDragRef.current.active = false;
    }
  }, [isMobileLayout, mobileScreenShareEntry, showCallUi]);

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

  const handleScreenPipPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isMobileLayout || !mobileScreenShareEntry) return;
      const grid = gridRef.current;
      if (!grid) return;
      const tile = event.currentTarget;
      const gridRect = grid.getBoundingClientRect();
      const tileRect = tile.getBoundingClientRect();
      if (!gridRect.width || !gridRect.height) return;
      screenPipDragRef.current.active = true;
      screenPipDragRef.current.offsetX = event.clientX - tileRect.left;
      screenPipDragRef.current.offsetY = event.clientY - tileRect.top;
      setScreenPipPosition({
        x: tileRect.left - gridRect.left,
        y: tileRect.top - gridRect.top,
      });
      setIsScreenPipDragging(true);
      tile.setPointerCapture?.(event.pointerId);
    },
    [isMobileLayout, mobileScreenShareEntry]
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

  const handleScreenPipPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!screenPipDragRef.current.active || !isMobileLayout) return;
      const grid = gridRef.current;
      if (!grid) return;
      const gridRect = grid.getBoundingClientRect();
      const tile = event.currentTarget;
      const width = tile.offsetWidth;
      const height = tile.offsetHeight;
      if (!gridRect.width || !gridRect.height || !width || !height) return;
      let nextX = event.clientX - gridRect.left - screenPipDragRef.current.offsetX;
      let nextY = event.clientY - gridRect.top - screenPipDragRef.current.offsetY;
      nextX = Math.min(Math.max(0, nextX), gridRect.width - width);
      nextY = Math.min(Math.max(0, nextY), gridRect.height - height);
      setScreenPipPosition({ x: nextX, y: nextY });
    },
    [isMobileLayout]
  );

  const handlePipPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!pipDragRef.current.active || isMobileCameraOnly) return;
    pipDragRef.current.active = false;
    setIsPipDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, [isMobileCameraOnly]);

  const handleScreenPipPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!screenPipDragRef.current.active) return;
    screenPipDragRef.current.active = false;
    setIsScreenPipDragging(false);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  const pipStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isMobileLayout || isLocalPrimary || !pipPosition) return undefined;
    return {
      left: `${pipPosition.x}px`,
      top: `${pipPosition.y}px`,
      right: "auto",
      bottom: "auto",
    };
  }, [isLocalPrimary, isMobileLayout, pipPosition]);

  const screenPipStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isMobileLayout || !mobileScreenShareEntry || !screenPipPosition) return undefined;
    return {
      left: `${screenPipPosition.x}px`,
      top: `${screenPipPosition.y}px`,
      right: "auto",
      bottom: "auto",
    };
  }, [isMobileLayout, mobileScreenShareEntry, screenPipPosition]);

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
  const callMenuAudioDevices = useMemo(
    () => [
      { id: "default", label: "Default mic" },
      ...audioInputs
        .filter((device) => Boolean(device.deviceId) && device.deviceId !== "default")
        .map((device, index) => ({
          id: device.deviceId,
          label: device.label || `Microphone ${index + 1}`,
        })),
    ],
    [audioInputs]
  );
  const callMenuVideoDevices = useMemo(
    () => [
      { id: "default", label: "Default camera" },
      ...videoInputs
        .filter((device) => Boolean(device.deviceId) && device.deviceId !== "default")
        .map((device, index) => ({
          id: device.deviceId,
          label: device.label || `Camera ${index + 1}`,
        })),
    ],
    [videoInputs]
  );
  const selectedMicLabel = useMemo(() => {
    const selected =
      callMenuAudioDevices.find((device) => device.id === micSelectionValue) ||
      callMenuAudioDevices[0];
    return selected?.label || "Default mic";
  }, [callMenuAudioDevices, micSelectionValue]);
  const selectedCameraLabel = useMemo(() => {
    const selected =
      callMenuVideoDevices.find((device) => device.id === cameraSelectionValue) ||
      callMenuVideoDevices[0];
    return selected?.label || "Default camera";
  }, [callMenuVideoDevices, cameraSelectionValue]);
  const chatFontSizeRem = Number.isFinite(chatTextSizeRem)
    ? Math.min(CHAT_TEXT_SIZE_MAX_REM, Math.max(CHAT_TEXT_SIZE_MIN_REM, chatTextSizeRem))
    : 1;
  const chatStyle = useMemo(
    () =>
      ({
        "--video-chat-text-size": `${chatFontSizeRem}rem`,
      }) as CSSProperties,
    [chatFontSizeRem]
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
  }, [isPopout, isScreenSharing, startScreenShare, stopScreenShare]);

  const handleOpenSettings = useCallback(() => {
    if (typeof window !== "undefined") {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const safeViewportWidth = Math.max(320, viewportWidth);
      const safeViewportHeight = Math.max(260, viewportHeight);
      const minWidth = Math.min(SETTINGS_MODAL_MIN_WIDTH, safeViewportWidth - 16);
      const minHeight = Math.min(SETTINGS_MODAL_MIN_HEIGHT, safeViewportHeight - 16);
      const targetWidth = Math.min(760, Math.max(420, safeViewportWidth - 28));
      const targetHeight = Math.min(780, Math.max(480, safeViewportHeight - 28));
      const width = clampValue(
        targetWidth,
        Math.max(300, minWidth),
        safeViewportWidth - 8
      );
      const height = clampValue(
        targetHeight,
        Math.max(260, minHeight),
        safeViewportHeight - 8
      );
      const x = clampValue(Math.max(0, (safeViewportWidth - width) / 2), 0, safeViewportWidth - width);
      const y = clampValue(
        Math.max(0, (safeViewportHeight - height) / 2),
        0,
        safeViewportHeight - height
      );
      setSettingsModalBounds({ x, y, width, height });
    }
    setShowSettingsPanel(true);
  }, []);

  const handleCloseSettings = useCallback(() => {
    settingsDragRef.current = null;
    settingsResizeRef.current = null;
    setIsSettingsModalDragging(false);
    setShowSettingsPanel(false);
  }, []);

  const clampSettingsModalBounds = useCallback(
    (next: SettingsModalBounds, overlayWidth: number, overlayHeight: number) => {
      const safeOverlayWidth = Math.max(320, overlayWidth);
      const safeOverlayHeight = Math.max(260, overlayHeight);
      const minWidth = Math.min(SETTINGS_MODAL_MIN_WIDTH, safeOverlayWidth - 16);
      const minHeight = Math.min(SETTINGS_MODAL_MIN_HEIGHT, safeOverlayHeight - 16);
      const width = clampValue(next.width, Math.max(300, minWidth), safeOverlayWidth - 8);
      const height = clampValue(next.height, Math.max(260, minHeight), safeOverlayHeight - 8);
      const maxX = Math.max(0, safeOverlayWidth - width);
      const maxY = Math.max(0, safeOverlayHeight - height);
      return {
        x: clampValue(next.x, 0, maxX),
        y: clampValue(next.y, 0, maxY),
        width,
        height,
      };
    },
    []
  );

  const ensureSettingsModalBounds = useCallback(
    (forceCenter = false) => {
      const overlay = settingsOverlayRef.current;
      if (!overlay) return;
      const overlayRect = overlay.getBoundingClientRect();
      const centeredWidth = Math.min(760, Math.max(420, overlayRect.width - 28));
      const centeredHeight = Math.min(780, Math.max(480, overlayRect.height - 28));
      setSettingsModalBounds((prev) => {
        if (!prev || forceCenter) {
          const centered: SettingsModalBounds = {
            x: Math.max(0, (overlayRect.width - centeredWidth) / 2),
            y: Math.max(0, (overlayRect.height - centeredHeight) / 2),
            width: centeredWidth,
            height: centeredHeight,
          };
          return clampSettingsModalBounds(centered, overlayRect.width, overlayRect.height);
        }
        return clampSettingsModalBounds(prev, overlayRect.width, overlayRect.height);
      });
    },
    [clampSettingsModalBounds]
  );

  const handleSettingsModalHeaderPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (isMobileLayout) return;
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("button, input, select, textarea, a")) return;
      if (!settingsModalBounds) return;
      settingsResizeRef.current = null;
      settingsDragRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originX: settingsModalBounds.x,
        originY: settingsModalBounds.y,
      };
      setIsSettingsModalDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    },
    [isMobileLayout, settingsModalBounds]
  );

  const handleSettingsModalResizePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (isMobileLayout) return;
      if (event.button !== 0) return;
      if (!settingsModalBounds) return;
      settingsDragRef.current = null;
      settingsResizeRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        originWidth: settingsModalBounds.width,
        originHeight: settingsModalBounds.height,
      };
      setIsSettingsModalDragging(true);
      event.currentTarget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    },
    [isMobileLayout, settingsModalBounds]
  );

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
  const callExitLabel = isCallAdmin ? "End call" : "Leave call";

  useEffect(() => {
    if (!isDesktopApp || !desktopBridge?.setCallMenuState) return;
    if (!isStandaloneVideoApp || !showCallUi) {
      void desktopBridge.setCallMenuState({ visible: false });
      return;
    }
    void desktopBridge.setCallMenuState({
      visible: true,
      canManageCall: isCallAdmin,
      canMuteEveryone: isCallAdmin && remoteList.length > 0,
      canStopAllScreens: isCallAdmin && hasRemoteScreenShares,
      audioDevices: callMenuAudioDevices,
      videoDevices: callMenuVideoDevices,
      selectedAudioInputId: micSelectionValue,
      selectedVideoInputId: cameraSelectionValue,
    });
  }, [
    callMenuAudioDevices,
    callMenuVideoDevices,
    cameraSelectionValue,
    desktopBridge,
    hasRemoteScreenShares,
    isCallAdmin,
    isDesktopApp,
    isStandaloneVideoApp,
    micSelectionValue,
    remoteList.length,
    showCallUi,
  ]);

  useEffect(() => {
    if (!isDesktopApp || !desktopBridge?.setCallMenuState) return;
    return () => {
      void desktopBridge?.setCallMenuState?.({ visible: false });
    };
  }, [desktopBridge, isDesktopApp]);

  useEffect(() => {
    if (!isDesktopApp || !desktopBridge?.onMenuAction) return;
    const unsubscribe = desktopBridge.onMenuAction((event) => {
      if (!isStandaloneVideoApp || !showCallUi) return;
      if (!event || typeof event !== "object") return;
      const action = String(event.action || "");
      if (action === "open-settings") {
        handleOpenSettings();
        return;
      }
      if (action === "mute-everyone") {
        if (isCallAdmin) {
          muteAllParticipants();
        }
        return;
      }
      if (action === "stop-all-screens") {
        if (isCallAdmin) {
          stopAllScreenShares();
        }
        return;
      }
      if (action === "select-audio-input") {
        const deviceId = String(event.deviceId || "default");
        void setAudioInputDevice(deviceId);
        return;
      }
      if (action === "select-video-input") {
        const deviceId = String(event.deviceId || "default");
        void setVideoInputDevice(deviceId);
      }
    });
    return () => {
      unsubscribe?.();
    };
  }, [
    desktopBridge,
    handleOpenSettings,
    isCallAdmin,
    isDesktopApp,
    isStandaloneVideoApp,
    muteAllParticipants,
    setAudioInputDevice,
    setVideoInputDevice,
    showCallUi,
    stopAllScreenShares,
  ]);

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

  const handleExitCall = useCallback(() => {
    if (isCallAdmin) {
      void playEndCallTone();
      endCall();
      return;
    }
    leaveCall();
  }, [endCall, isCallAdmin, leaveCall, playEndCallTone]);

  const handleRemoveParticipant = useCallback(
    (socketId: string, label: string) => {
      if (!isCallAdmin) return;
      const normalizedLabel = String(label || "this participant").trim() || "this participant";
      const shouldRemove = window.confirm(`Remove ${normalizedLabel} from this call?`);
      if (!shouldRemove) return;
      removeParticipantFromCall(socketId);
    },
    [isCallAdmin, removeParticipantFromCall]
  );

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
    if (!showSettingsPanel) return;
    ensureSettingsModalBounds(false);
  }, [ensureSettingsModalBounds, showSettingsPanel]);

  useEffect(() => {
    if (!showSettingsPanel) return;
    const handleResize = () => ensureSettingsModalBounds(false);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [ensureSettingsModalBounds, showSettingsPanel]);

  useEffect(() => {
    if (!showSettingsPanel) return;
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      const overlay = settingsOverlayRef.current;
      if (!overlay) return;
      const overlayRect = overlay.getBoundingClientRect();
      const dragState = settingsDragRef.current;
      if (dragState) {
        const deltaX = event.clientX - dragState.startX;
        const deltaY = event.clientY - dragState.startY;
        setSettingsModalBounds((prev) => {
          if (!prev) return prev;
          return clampSettingsModalBounds(
            {
              ...prev,
              x: dragState.originX + deltaX,
              y: dragState.originY + deltaY,
            },
            overlayRect.width,
            overlayRect.height
          );
        });
        return;
      }

      const resizeState = settingsResizeRef.current;
      if (!resizeState) return;
      const deltaX = event.clientX - resizeState.startX;
      const deltaY = event.clientY - resizeState.startY;
      setSettingsModalBounds((prev) => {
        if (!prev) return prev;
        return clampSettingsModalBounds(
          {
            ...prev,
            width: resizeState.originWidth + deltaX,
            height: resizeState.originHeight + deltaY,
          },
          overlayRect.width,
          overlayRect.height
        );
      });
    };

    const handlePointerUp = () => {
      if (!settingsDragRef.current && !settingsResizeRef.current) return;
      settingsDragRef.current = null;
      settingsResizeRef.current = null;
      setIsSettingsModalDragging(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [clampSettingsModalBounds, showSettingsPanel]);

  useEffect(() => {
    if (showSettingsPanel) {
      setSettingsTab("call");
    }
  }, [showSettingsPanel]);

  useEffect(() => {
    if (showSettingsPanel) return;
    settingsDragRef.current = null;
    settingsResizeRef.current = null;
    setIsSettingsModalDragging(false);
  }, [showSettingsPanel]);

  useEffect(() => {
    if (
      !showViewSelect &&
      !showScreenSelect &&
      !showCameraSelect &&
      !showWebMicDeviceSelect &&
      !showWebCameraDeviceSelect &&
      !showDesktopMicSelect &&
      !showDesktopCameraSelect &&
      !showDesktopFilterSelect
    ) {
      return;
    }
    const handleClick = (event: globalThis.MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        viewSelectRef.current?.contains(target) ||
        screenSelectRef.current?.contains(target) ||
        cameraSelectRef.current?.contains(target) ||
        webMicDeviceSelectRef.current?.contains(target) ||
        webCameraDeviceSelectRef.current?.contains(target) ||
        desktopMicSelectRef.current?.contains(target) ||
        desktopCameraSelectRef.current?.contains(target) ||
        desktopFilterSelectRef.current?.contains(target)
      ) {
        return;
      }
      setShowViewSelect(false);
      setShowScreenSelect(false);
      setShowCameraSelect(false);
      setShowWebMicDeviceSelect(false);
      setShowWebCameraDeviceSelect(false);
      setShowDesktopMicSelect(false);
      setShowDesktopCameraSelect(false);
      setShowDesktopFilterSelect(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowViewSelect(false);
        setShowScreenSelect(false);
        setShowCameraSelect(false);
        setShowWebMicDeviceSelect(false);
        setShowWebCameraDeviceSelect(false);
        setShowDesktopMicSelect(false);
        setShowDesktopCameraSelect(false);
        setShowDesktopFilterSelect(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    showCameraSelect,
    showWebCameraDeviceSelect,
    showWebMicDeviceSelect,
    showDesktopCameraSelect,
    showDesktopFilterSelect,
    showDesktopMicSelect,
    showScreenSelect,
    showViewSelect,
  ]);

  const settingsModalStyle = useMemo<CSSProperties | undefined>(() => {
    if (isMobileLayout) return undefined;
    if (!settingsModalBounds) return undefined;
    return {
      left: settingsModalBounds.x,
      top: settingsModalBounds.y,
      width: settingsModalBounds.width,
      height: settingsModalBounds.height,
    };
  }, [isMobileLayout, settingsModalBounds]);

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
            ref={settingsOverlayRef}
          >
            <div
              className={`video-settings-modal${isSettingsModalDragging ? " is-dragging" : ""}${
                isMobileLayout ? "" : " is-draggable"
              }`}
              role="dialog"
              aria-modal="true"
              aria-label="Call settings"
              ref={settingsModalRef}
              style={settingsModalStyle}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="video-settings-header" onPointerDown={handleSettingsModalHeaderPointerDown}>
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
                    {isStandaloneVideoApp && showMicSelector && (
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
                    {!isStandaloneVideoApp && (
                      <>
                        <div className="video-settings-tile is-static is-select">
                          <FontAwesomeIcon icon={faMicrophone} aria-hidden="true" />
                          <span className="video-settings-label">Microphone</span>
                          <label className="video-settings-select">
                            <span className="sr-only">Microphone</span>
                            <select
                              value={micSelectionValue}
                              onChange={(event) => void setAudioInputDevice(event.target.value)}
                              title="Select microphone"
                            >
                              {callMenuAudioDevices.map((device) => (
                                <option key={`web-mic-${device.id}`} value={device.id}>
                                  {device.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="video-settings-tile is-static is-select">
                          <FontAwesomeIcon icon={faCamera} aria-hidden="true" />
                          <span className="video-settings-label">Camera</span>
                          <label className="video-settings-select">
                            <span className="sr-only">Camera</span>
                            <select
                              value={cameraSelectionValue}
                              onChange={(event) => void setVideoInputDevice(event.target.value)}
                              title="Select camera"
                            >
                              {callMenuVideoDevices.map((device) => (
                                <option key={`web-camera-${device.id}`} value={device.id}>
                                  {device.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </>
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
                    <button
                      type="button"
                      className={`video-settings-tile${
                        videoEffects.avatarEnabled ? " is-active" : ""
                      }`}
                      onClick={() =>
                        setVideoEffects({ avatarEnabled: !videoEffects.avatarEnabled })
                      }
                      aria-pressed={videoEffects.avatarEnabled}
                    >
                      <FontAwesomeIcon icon={faUser} aria-hidden="true" />
                      <span className="video-settings-label">Avatar pose</span>
                      <span className="video-settings-status">
                        {videoEffects.avatarEnabled ? "On" : "Off"}
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
                              backgroundImageUrl:
                                event.target.value === "ai"
                                  ? videoEffects.backgroundImageUrl
                                  : "",
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
                  </div>
                  <div className="video-settings-stack">
                    <div className="video-settings-group">
                      <div className="video-settings-row">
                        <span className="video-settings-label">Mask strength</span>
                        <span className="video-settings-hint">
                          Sharpen edges to reduce ghosting.
                        </span>
                      </div>
                      <div className="video-settings-alpha">
                        <input
                          className="video-settings-range"
                          type="range"
                          min={0.2}
                          max={1}
                          step={0.05}
                          value={maskStrengthValue}
                          onChange={(event) =>
                            setVideoEffects({
                              maskStrength: Number(event.target.value),
                            })
                          }
                          aria-label="Mask strength"
                        />
                        <span className="video-settings-alpha-value">
                          {Math.round(maskStrengthValue * 100)}%
                        </span>
                      </div>
                    </div>
                    {videoEffects.background === "ai" && (
                      <div className="video-settings-group">
                        <div className="video-settings-row">
                          <span className="video-settings-label">AI background</span>
                          <span className="video-settings-hint">
                            Describe the scene you want behind you.
                          </span>
                        </div>
                        <textarea
                          className="video-settings-input video-settings-textarea"
                          rows={3}
                          value={aiBackgroundPrompt}
                          onChange={(event) => setAiBackgroundPrompt(event.target.value)}
                          placeholder="Cozy library with warm lighting, cinematic bokeh."
                        />
                        {aiBackgroundError && (
                          <p className="video-settings-error">{aiBackgroundError}</p>
                        )}
                        <div className="video-settings-row">
                          <button
                            type="button"
                            className="btn primary small"
                            onClick={handleGenerateAiBackground}
                            disabled={aiBackgroundLoading}
                          >
                            {aiBackgroundLoading ? "Generating..." : "Generate background"}
                          </button>
                          {videoEffects.backgroundImageUrl && (
                            <button
                              type="button"
                              className="btn ghost small"
                              onClick={() =>
                                setVideoEffects({
                                  background: "none",
                                  backgroundImageUrl: "",
                                })
                              }
                            >
                              Clear
                            </button>
                          )}
                        </div>
                        {videoEffects.backgroundImageUrl && (
                          <img
                            className="video-settings-preview"
                            src={videoEffects.backgroundImageUrl}
                            alt="AI background preview"
                            loading="lazy"
                          />
                        )}
                      </div>
                    )}
                    <div className="video-settings-group">
                      <div className="video-settings-row">
                        <span className="video-settings-label">Avatar library</span>
                        <span className="video-settings-hint">
                          Choose from 20 pre-built avatars.
                        </span>
                      </div>
                      <div className="video-settings-row">
                        <label className="video-settings-select">
                          <span className="sr-only">Avatar preset</span>
                          <select
                            value={selectedAvatarPresetId}
                            onChange={handleAvatarPresetChange}
                          >
                            <option value="">
                              {videoEffects.avatarImageUrl
                                ? "Current custom avatar"
                                : "Choose preset avatar"}
                            </option>
                            {AVATAR_PRESET_OPTIONS.map((option) => (
                              <option key={option.id} value={option.id}>
                                {option.label}
                              </option>
                            ))}
                            {!isStandaloneVideoApp && (
                              <option value={AVATAR_PRESET_PROFILE_SETTINGS_VALUE}>
                                Profile settings…
                              </option>
                            )}
                          </select>
                        </label>
                        {videoEffects.avatarImageUrl && (
                          <button
                            type="button"
                            className="btn ghost small"
                            onClick={() =>
                              setVideoEffects({
                                avatarEnabled: false,
                                avatarImageUrl: "",
                              })
                            }
                          >
                            Clear
                          </button>
                        )}
                      </div>
                    </div>
                    {videoEffects.avatarEnabled && (
                      <div className="video-settings-group">
                        <div className="video-settings-row">
                          <span className="video-settings-label">Avatar alignment</span>
                          <span className="video-settings-hint">
                            Use Quick align first, then open Fine tune for eyes and mouth.
                          </span>
                        </div>
                        {videoEffects.avatarImageUrl ? (
                          <div className="video-settings-avatar-align-layout">
                            <div className="video-settings-avatar-preview">
                              <div className="video-settings-avatar-preview-stage">
                                <div className="video-settings-avatar-guides" aria-hidden="true">
                                  <span className="video-settings-avatar-guide-line is-vertical" />
                                  <span className="video-settings-avatar-guide-line is-horizontal" />
                                </div>
                                <div
                                  className="video-settings-avatar-preview-layer"
                                  style={avatarPreviewLayerStyle}
                                >
                                  <img
                                    className="video-settings-avatar-preview-image"
                                    src={videoEffects.avatarImageUrl}
                                    alt="Avatar alignment preview"
                                    loading="lazy"
                                  />
                                  <svg
                                    className="video-settings-avatar-overlay"
                                    viewBox="0 0 100 100"
                                    preserveAspectRatio="none"
                                    aria-hidden="true"
                                  >
                                    {renderAvatarPreviewEyes()}
                                    {renderAvatarPreviewMouth()}
                                  </svg>
                                </div>
                              </div>
                            </div>

                            <div className="video-settings-avatar-controls">
                              <div className="video-settings-avatar-style-row">
                                <label className="video-settings-avatar-style">
                                  <span>Eye style</span>
                                  <select
                                    value={normalizeAvatarEyeStyle(videoEffects.avatarEyeStyle)}
                                    onChange={(event) =>
                                      setVideoEffects({
                                        avatarEyeStyle:
                                          event.target.value as typeof videoEffects.avatarEyeStyle,
                                      })
                                    }
                                  >
                                    {AVATAR_EYE_STYLE_OPTIONS.map((option) => (
                                      <option key={option.id} value={option.id}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="video-settings-avatar-style">
                                  <span>Mouth style</span>
                                  <select
                                    value={normalizeAvatarMouthStyle(videoEffects.avatarMouthStyle)}
                                    onChange={(event) =>
                                      setVideoEffects({
                                        avatarMouthStyle:
                                          event.target.value as typeof videoEffects.avatarMouthStyle,
                                      })
                                    }
                                  >
                                    {AVATAR_MOUTH_STYLE_OPTIONS.map((option) => (
                                      <option key={option.id} value={option.id}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                              </div>

                              <div className="video-settings-avatar-panels">
                                <div className="video-settings-avatar-section">
                                  <div className="video-settings-row">
                                    <span className="video-settings-label">Quick align</span>
                                    <button
                                      type="button"
                                      className="video-settings-reset"
                                      onClick={handleResetAvatarPlacement}
                                    >
                                      Reset position
                                    </button>
                                  </div>

                                  <div className="video-settings-avatar-control">
                                    <div className="video-settings-avatar-control-head">
                                      <span className="video-settings-label">Position X</span>
                                      <span className="video-settings-avatar-value">
                                        {formatPercentValue(avatarOffsetXValue, { signed: true })}
                                      </span>
                                    </div>
                                    <input
                                      className="video-settings-range"
                                      type="range"
                                      min={-0.5}
                                      max={0.5}
                                      step={0.02}
                                      value={avatarOffsetXValue}
                                      onChange={(event) =>
                                        setVideoEffects({
                                          avatarOffsetX: Number(event.target.value),
                                        })
                                      }
                                      aria-label="Avatar horizontal alignment"
                                    />
                                  </div>

                                  <div className="video-settings-avatar-control">
                                    <div className="video-settings-avatar-control-head">
                                      <span className="video-settings-label">Position Y</span>
                                      <span className="video-settings-avatar-value">
                                        {formatPercentValue(avatarOffsetYValue, { signed: true })}
                                      </span>
                                    </div>
                                    <input
                                      className="video-settings-range"
                                      type="range"
                                      min={-0.5}
                                      max={0.5}
                                      step={0.02}
                                      value={avatarOffsetYValue}
                                      onChange={(event) =>
                                        setVideoEffects({
                                          avatarOffsetY: Number(event.target.value),
                                        })
                                      }
                                      aria-label="Avatar vertical alignment"
                                    />
                                  </div>

                                  <div className="video-settings-avatar-control">
                                    <div className="video-settings-avatar-control-head">
                                      <span className="video-settings-label">Scale</span>
                                      <span className="video-settings-avatar-value">
                                        {formatPercentValue(avatarScaleValue)}
                                      </span>
                                    </div>
                                    <input
                                      className="video-settings-range"
                                      type="range"
                                      min={0.4}
                                      max={1.6}
                                      step={0.05}
                                      value={avatarScaleValue}
                                      onChange={(event) =>
                                        setVideoEffects({
                                          avatarScale: Number(event.target.value),
                                        })
                                      }
                                      aria-label="Avatar scale"
                                    />
                                  </div>
                                </div>

                                <details className="video-settings-avatar-advanced">
                                  <summary>Fine tune eyes and mouth</summary>
                                  <div className="video-settings-avatar-section is-advanced">
                                    <div className="video-settings-row">
                                      <span className="video-settings-hint">
                                        Use these only if the face overlay needs extra adjustment.
                                      </span>
                                      <button
                                        type="button"
                                        className="video-settings-reset"
                                        onClick={handleResetAvatarFace}
                                      >
                                        Reset face
                                      </button>
                                    </div>

                                    <div className="video-settings-avatar-control">
                                      <div className="video-settings-avatar-control-head">
                                        <span className="video-settings-label">Eye spacing</span>
                                        <span className="video-settings-avatar-value">
                                          {formatPercentValue(avatarEyeSpacingValue)}
                                        </span>
                                      </div>
                                      <input
                                        className="video-settings-range"
                                        type="range"
                                        min={0.25}
                                        max={1}
                                        step={0.05}
                                        value={avatarEyeSpacingValue}
                                        onChange={(event) =>
                                          setVideoEffects({
                                            avatarEyeSpacing: Number(event.target.value),
                                          })
                                        }
                                        aria-label="Avatar eye spacing"
                                      />
                                    </div>

                                    <div className="video-settings-avatar-control">
                                      <div className="video-settings-avatar-control-head">
                                        <span className="video-settings-label">Eye size</span>
                                        <span className="video-settings-avatar-value">
                                          {formatPercentValue(avatarEyeSizeValue)}
                                        </span>
                                      </div>
                                      <input
                                        className="video-settings-range"
                                        type="range"
                                        min={0.5}
                                        max={1.8}
                                        step={0.05}
                                        value={avatarEyeSizeValue}
                                        onChange={(event) =>
                                          setVideoEffects({
                                            avatarEyeSize: Number(event.target.value),
                                          })
                                        }
                                        aria-label="Avatar eye size"
                                      />
                                    </div>

                                    <div className="video-settings-avatar-control">
                                      <div className="video-settings-avatar-control-head">
                                        <span className="video-settings-label">Eye X</span>
                                        <span className="video-settings-avatar-value">
                                          {formatPercentValue(avatarEyeOffsetXValue, { signed: true })}
                                        </span>
                                      </div>
                                      <input
                                        className="video-settings-range"
                                        type="range"
                                        min={-0.35}
                                        max={0.35}
                                        step={0.02}
                                        value={avatarEyeOffsetXValue}
                                        onChange={(event) =>
                                          setVideoEffects({
                                            avatarEyeOffsetX: Number(event.target.value),
                                          })
                                        }
                                        aria-label="Avatar eye horizontal offset"
                                      />
                                    </div>

                                    <div className="video-settings-avatar-control">
                                      <div className="video-settings-avatar-control-head">
                                        <span className="video-settings-label">Eye Y</span>
                                        <span className="video-settings-avatar-value">
                                          {formatPercentValue(avatarEyeOffsetYValue, { signed: true })}
                                        </span>
                                      </div>
                                      <input
                                        className="video-settings-range"
                                        type="range"
                                        min={-0.3}
                                        max={0.3}
                                        step={0.02}
                                        value={avatarEyeOffsetYValue}
                                        onChange={(event) =>
                                          setVideoEffects({
                                            avatarEyeOffsetY: Number(event.target.value),
                                          })
                                        }
                                        aria-label="Avatar eye vertical offset"
                                      />
                                    </div>

                                    <div className="video-settings-avatar-control">
                                      <div className="video-settings-avatar-control-head">
                                        <span className="video-settings-label">Mouth X</span>
                                        <span className="video-settings-avatar-value">
                                          {formatPercentValue(avatarMouthOffsetXValue, { signed: true })}
                                        </span>
                                      </div>
                                      <input
                                        className="video-settings-range"
                                        type="range"
                                        min={-0.35}
                                        max={0.35}
                                        step={0.02}
                                        value={avatarMouthOffsetXValue}
                                        onChange={(event) =>
                                          setVideoEffects({
                                            avatarMouthOffsetX: Number(event.target.value),
                                          })
                                        }
                                        aria-label="Avatar mouth horizontal offset"
                                      />
                                    </div>

                                    <div className="video-settings-avatar-control">
                                      <div className="video-settings-avatar-control-head">
                                        <span className="video-settings-label">Mouth size</span>
                                        <span className="video-settings-avatar-value">
                                          {formatPercentValue(avatarMouthSizeValue)}
                                        </span>
                                      </div>
                                      <input
                                        className="video-settings-range"
                                        type="range"
                                        min={0.5}
                                        max={1.8}
                                        step={0.05}
                                        value={avatarMouthSizeValue}
                                        onChange={(event) =>
                                          setVideoEffects({
                                            avatarMouthSize: Number(event.target.value),
                                          })
                                        }
                                        aria-label="Avatar mouth size"
                                      />
                                    </div>

                                    <div className="video-settings-avatar-control">
                                      <div className="video-settings-avatar-control-head">
                                        <span className="video-settings-label">Mouth Y</span>
                                        <span className="video-settings-avatar-value">
                                          {formatPercentValue(avatarMouthOffsetYValue, { signed: true })}
                                        </span>
                                      </div>
                                      <input
                                        className="video-settings-range"
                                        type="range"
                                        min={-0.3}
                                        max={0.3}
                                        step={0.02}
                                        value={avatarMouthOffsetYValue}
                                        onChange={(event) =>
                                          setVideoEffects({
                                            avatarMouthOffsetY: Number(event.target.value),
                                          })
                                        }
                                        aria-label="Avatar mouth vertical offset"
                                      />
                                    </div>
                                  </div>
                                </details>
                              </div>

                              <div className="video-settings-row">
                                <button
                                  type="button"
                                  className="video-settings-reset"
                                  onClick={handleResetAvatarAlignment}
                                >
                                  Reset all alignment
                                </button>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <span className="video-settings-hint">
                            Choose an avatar to unlock live alignment controls.
                          </span>
                        )}
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
              {!isMobileLayout && (
                <div
                  className="video-settings-resize-handle"
                  role="presentation"
                  onPointerDown={handleSettingsModalResizePointerDown}
                />
              )}
            </div>
          </div>
        )}
        {showDesktopTitlebar && (
          <div
            className={`video-desktop-titlebar${showDesktopTitlebarControls ? "" : " is-empty"}`}
            role={showDesktopTitlebarControls ? "toolbar" : undefined}
            aria-label={showDesktopTitlebarControls ? "Call title bar" : undefined}
          >
            {showDesktopTitlebarControls && (
              <>
                <div className="video-desktop-titlebar__brand">
                  <img src="/logo2.png" alt="" />
                  <span className="video-desktop-titlebar__brand-name">YSP Live</span>
                  <span className="video-desktop-titlebar__badge">
                    Live {totalParticipants}/{maxParticipants}
                  </span>
                </div>
                <div className="video-desktop-titlebar__controls">
                  <div className="video-desktop-titlebar__group is-actions">
                    <button
                      type="button"
                      className="video-desktop-titlebar__button is-settings"
                      onClick={handleOpenSettings}
                      data-hint="Call settings"
                      aria-label="Settings"
                      title="Settings"
                    >
                      <FontAwesomeIcon icon={faSliders} aria-hidden="true" />
                      <span className="video-desktop-titlebar__button-text">Settings</span>
                    </button>
                    {isCallAdmin && (
                      <>
                        <button
                          type="button"
                          className="video-desktop-titlebar__button is-mute-all"
                          onClick={muteAllParticipants}
                          disabled={remoteList.length === 0}
                          data-hint="Mute everyone"
                          aria-label="Mute everyone"
                          title="Mute everyone"
                        >
                          <FontAwesomeIcon icon={faMicrophoneSlash} aria-hidden="true" />
                          <span className="video-desktop-titlebar__button-text">Mute everyone</span>
                        </button>
                        <button
                          type="button"
                          className="video-desktop-titlebar__button is-stop-screens"
                          onClick={stopAllScreenShares}
                          disabled={!hasRemoteScreenShares}
                          data-hint="Stop all screens"
                          aria-label="Stop all screens"
                          title="Stop all screens"
                        >
                          <FontAwesomeIcon icon={faDisplay} aria-hidden="true" />
                          <span className="video-desktop-titlebar__button-text">Stop all screens</span>
                        </button>
                      </>
                    )}
                  </div>
                  <div className="video-desktop-titlebar__group is-devices">
                    <div
                      className={`video-desktop-titlebar__device-menu${
                        showDesktopMicSelect ? " is-open" : ""
                      }`}
                      ref={desktopMicSelectRef}
                    >
                      <button
                        type="button"
                        className="video-desktop-titlebar__device-trigger is-mic"
                        data-hint={selectedMicLabel}
                        aria-label="Microphone devices"
                        title={selectedMicLabel}
                        aria-expanded={showDesktopMicSelect}
                        onClick={() => {
                          setShowDesktopMicSelect((prev) => !prev);
                          setShowDesktopCameraSelect(false);
                          setShowDesktopFilterSelect(false);
                          setShowViewSelect(false);
                          setShowScreenSelect(false);
                          setShowCameraSelect(false);
                        }}
                      >
                        <FontAwesomeIcon icon={faMicrophone} aria-hidden="true" />
                      </button>
                      {showDesktopMicSelect && (
                        <div className="video-desktop-titlebar__device-dropdown">
                          <div className="video-desktop-titlebar__device-list">
                            {callMenuAudioDevices.map((device) => (
                              <button
                                type="button"
                                key={device.id}
                                className={`video-desktop-titlebar__device-option${
                                  micSelectionValue === device.id ? " is-active" : ""
                                }`}
                                onClick={() => {
                                  void setAudioInputDevice(device.id);
                                  setShowDesktopMicSelect(false);
                                }}
                              >
                                {device.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div
                      className={`video-desktop-titlebar__device-menu${
                        showDesktopCameraSelect ? " is-open" : ""
                      }`}
                      ref={desktopCameraSelectRef}
                    >
                      <button
                        type="button"
                        className="video-desktop-titlebar__device-trigger is-camera"
                        data-hint={selectedCameraLabel}
                        aria-label="Camera devices"
                        title={selectedCameraLabel}
                        aria-expanded={showDesktopCameraSelect}
                        onClick={() => {
                          setShowDesktopCameraSelect((prev) => !prev);
                          setShowDesktopMicSelect(false);
                          setShowDesktopFilterSelect(false);
                          setShowViewSelect(false);
                          setShowScreenSelect(false);
                          setShowCameraSelect(false);
                        }}
                      >
                        <FontAwesomeIcon icon={faCamera} aria-hidden="true" />
                      </button>
                      {showDesktopCameraSelect && (
                        <div className="video-desktop-titlebar__device-dropdown">
                          <div className="video-desktop-titlebar__device-list">
                            {callMenuVideoDevices.map((device) => (
                              <button
                                type="button"
                                key={device.id}
                                className={`video-desktop-titlebar__device-option${
                                  cameraSelectionValue === device.id ? " is-active" : ""
                                }`}
                                onClick={() => {
                                  void setVideoInputDevice(device.id);
                                  setShowDesktopCameraSelect(false);
                                }}
                              >
                                {device.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <div
                      className={`video-desktop-titlebar__device-menu${
                        showDesktopFilterSelect ? " is-open" : ""
                      }`}
                      ref={desktopFilterSelectRef}
                    >
                      <button
                        type="button"
                        className="video-desktop-titlebar__device-trigger is-filter"
                        data-hint="Camera Filter Options"
                        aria-label="Camera filter options"
                        title="Camera Filter Options"
                        aria-expanded={showDesktopFilterSelect}
                        onClick={() => {
                          setShowDesktopFilterSelect((prev) => !prev);
                          setShowDesktopMicSelect(false);
                          setShowDesktopCameraSelect(false);
                          setShowViewSelect(false);
                          setShowScreenSelect(false);
                          setShowCameraSelect(false);
                        }}
                      >
                        <FontAwesomeIcon icon={faSliders} aria-hidden="true" />
                      </button>
                      {showDesktopFilterSelect && (
                        <div className="video-desktop-titlebar__device-dropdown">
                          <div className="video-desktop-titlebar__device-list">
                            {FILTER_OPTIONS.map((option) => (
                              <button
                                type="button"
                                key={option.id}
                                className={`video-desktop-titlebar__device-option${
                                  videoEffects.filter === option.id ? " is-active" : ""
                                }`}
                                onClick={() => {
                                  setVideoEffects({
                                    filter: option.id as typeof videoEffects.filter,
                                  });
                                  setShowDesktopFilterSelect(false);
                                }}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
        <div className="video-call-main">
          {showCallUi && (
            <div className="video-call-controls-top">
              <div className="video-call-controls-group is-media">
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
                <button
                  type="button"
                  className={`video-control video-control-icon is-share${
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
                {!isMobileCameraOnly && (
                  <button
                    type="button"
                    className={`video-control video-control-icon ghost is-speaker${
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
              <div className="video-call-controls-group is-call-actions">
                {!isStandaloneVideoApp && (
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
                )}
                {!isStandaloneVideoApp && isCallAdmin && !isMobileCameraOnly && (
                  <>
                    <button
                      type="button"
                      className="video-control video-control-icon ghost is-admin-action"
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
                      className="video-control video-control-icon ghost is-admin-action"
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
                {!isMobileCameraOnly && (
                  <button
                    type="button"
                    className={`video-control video-control-icon ghost is-hold${
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
                <button
                  type="button"
                  className={`video-control video-control-icon${
                    isCallAdmin ? " end" : " leave"
                  }`}
                  onClick={handleExitCall}
                  data-hint={callExitLabel}
                  aria-label={callExitLabel}
                  title={callExitLabel}
                >
                  <FontAwesomeIcon
                    icon={faPhoneSlash}
                    aria-hidden="true"
                  />
                </button>
              </div>
              {!isMobileLayout && !isMobileCameraOnly && (
                <div className="video-call-controls-group is-relocated-toolbar is-view-tools">
                  {!isStandaloneVideoApp && (
                    <>
                      <div
                        className={`video-call-toolbar-group is-dropdown${
                          showWebMicDeviceSelect ? " is-open" : ""
                        }`}
                        ref={webMicDeviceSelectRef}
                      >
                        <button
                          type="button"
                          className="video-view-button is-icon is-dropdown-trigger"
                          data-hint={selectedMicLabel}
                          aria-label="Microphone devices"
                          title={selectedMicLabel}
                          aria-expanded={showWebMicDeviceSelect}
                          onClick={() => {
                            setShowWebMicDeviceSelect((prev) => !prev);
                            setShowWebCameraDeviceSelect(false);
                            setShowViewSelect(false);
                            setShowScreenSelect(false);
                            setShowCameraSelect(false);
                            setShowDesktopMicSelect(false);
                            setShowDesktopCameraSelect(false);
                            setShowDesktopFilterSelect(false);
                          }}
                        >
                          <FontAwesomeIcon icon={faMicrophone} aria-hidden="true" />
                        </button>
                        {showWebMicDeviceSelect && (
                          <div className="video-call-dropdown is-open">
                            <div className="video-call-dropdown-list">
                              {callMenuAudioDevices.map((device) => (
                                <button
                                  type="button"
                                  key={`web-callbar-mic-${device.id}`}
                                  className={`video-call-dropdown-option${
                                    micSelectionValue === device.id ? " is-active" : ""
                                  }`}
                                  onClick={() => {
                                    void setAudioInputDevice(device.id);
                                    setShowWebMicDeviceSelect(false);
                                  }}
                                >
                                  {device.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <div
                        className={`video-call-toolbar-group is-dropdown${
                          showWebCameraDeviceSelect ? " is-open" : ""
                        }`}
                        ref={webCameraDeviceSelectRef}
                      >
                        <button
                          type="button"
                          className="video-view-button is-icon is-dropdown-trigger"
                          data-hint={selectedCameraLabel}
                          aria-label="Camera devices"
                          title={selectedCameraLabel}
                          aria-expanded={showWebCameraDeviceSelect}
                          onClick={() => {
                            setShowWebCameraDeviceSelect((prev) => !prev);
                            setShowWebMicDeviceSelect(false);
                            setShowViewSelect(false);
                            setShowScreenSelect(false);
                            setShowCameraSelect(false);
                            setShowDesktopMicSelect(false);
                            setShowDesktopCameraSelect(false);
                            setShowDesktopFilterSelect(false);
                          }}
                        >
                          <FontAwesomeIcon icon={faVideo} aria-hidden="true" />
                        </button>
                        {showWebCameraDeviceSelect && (
                          <div className="video-call-dropdown is-open">
                            <div className="video-call-dropdown-list">
                              {callMenuVideoDevices.map((device) => (
                                <button
                                  type="button"
                                  key={`web-callbar-camera-${device.id}`}
                                  className={`video-call-dropdown-option${
                                    cameraSelectionValue === device.id ? " is-active" : ""
                                  }`}
                                  onClick={() => {
                                    void setVideoInputDevice(device.id);
                                    setShowWebCameraDeviceSelect(false);
                                  }}
                                >
                                  {device.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
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
                          setShowWebMicDeviceSelect(false);
                          setShowWebCameraDeviceSelect(false);
                          setShowDesktopMicSelect(false);
                          setShowDesktopCameraSelect(false);
                          setShowDesktopFilterSelect(false);
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
                          setShowWebMicDeviceSelect(false);
                          setShowWebCameraDeviceSelect(false);
                          setShowDesktopMicSelect(false);
                          setShowDesktopCameraSelect(false);
                          setShowDesktopFilterSelect(false);
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
                        data-hint="Choose a Screen to View"
                        aria-label="Choose a Screen to View"
                        title="Choose a Screen to View"
                        aria-expanded={showScreenSelect}
                        onClick={() => {
                          setShowScreenSelect((prev) => !prev);
                          setShowViewSelect(false);
                          setShowCameraSelect(false);
                          setShowWebMicDeviceSelect(false);
                          setShowWebCameraDeviceSelect(false);
                          setShowDesktopMicSelect(false);
                          setShowDesktopCameraSelect(false);
                          setShowDesktopFilterSelect(false);
                        }}
                      >
                        <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
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
                  {popoutEnabled && (
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
              )}
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
            {showCallUi && isMobileLayout && (
              <div className="video-call-header-controls">
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
              {incomingCall && (
                <div className="video-control-status info">
                  <span>
                    Incoming call from <strong>{incomingHostName}</strong>.
                    {incomingIsCurrentRoom
                      ? " Tap join to reconnect to this room."
                      : " Accept to switch without ending your current call automatically."}
                  </span>
                  <div className="video-control-status-actions">
                    <button
                      type="button"
                      className="video-control-status-btn ghost"
                      onClick={declineCall}
                    >
                      Decline
                    </button>
                    <button
                      type="button"
                      className="video-control-status-btn"
                      onClick={() => void acceptCall()}
                    >
                      {incomingAcceptLabel}
                    </button>
                  </div>
                </div>
              )}
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
                {isMobileLayout && mobileScreenShareEntry && (
                  <VideoTile
                    stream={mobileScreenShareEntry.stream}
                    label={mobileScreenShareEntry.label}
                    muted
                    badge="Screen"
                    className={`is-screen is-pip${
                      isScreenPipDragging ? " is-dragging" : ""
                    }`}
                    style={screenPipStyle}
                    mediaStyle={{ objectFit: "contain" }}
                    onPointerDown={handleScreenPipPointerDown}
                    onPointerMove={handleScreenPipPointerMove}
                    onPointerUp={handleScreenPipPointerUp}
                    onPointerLeave={handleScreenPipPointerUp}
                  />
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
                        muted
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
                        mediaStyle={localAvatarMediaStyle}
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
                      const participantLabel = resolveParticipantLabel({
                        userId: participant.userId,
                        displayName: participant.displayName,
                        handle: participant.handle,
                      });
                      return (
                        <VideoTile
                          key={participant.socketId}
                          stream={mergedRemoteStreams[participant.socketId] || null}
                          label={participantLabel}
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
                              {isCallAdmin && (
                                <button
                                  type="button"
                                  className="video-tile-focus is-remove"
                                  onClick={() =>
                                    handleRemoveParticipant(participant.socketId, participantLabel)
                                  }
                                  aria-label={`Remove ${participantLabel} from call`}
                                  title="Remove from call"
                                >
                                  <FontAwesomeIcon icon={faUserMinus} aria-hidden="true" />
                                  <span>Remove</span>
                                </button>
                              )}
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
                  className={`video-call-end-mobile${isCallAdmin ? "" : " is-leave"}`}
                  onClick={handleExitCall}
                >
                  {callExitLabel}
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
                className={`video-chat-tool is-emoji${showEmojiPicker ? " is-active" : ""}`}
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
                className={`video-chat-tool is-gif${showGifPicker ? " is-active" : ""}`}
                onClick={() => {
                  setShowGifPicker((prev) => !prev);
                  setShowEmojiPicker(false);
                }}
                aria-label="Pick GIF"
              >
                <FontAwesomeIcon icon={faBolt} aria-hidden="true" />
                <span className="video-chat-tool__label">GIF</span>
              </button>
              <label className="video-chat-size-slider">
                <span className="video-chat-size-slider__label">Text size</span>
                <input
                  type="range"
                  min={CHAT_TEXT_SIZE_MIN_REM}
                  max={CHAT_TEXT_SIZE_MAX_REM}
                  step={CHAT_TEXT_SIZE_STEP_REM}
                  value={chatFontSizeRem}
                  onChange={(event) => setChatTextSizeRem(Number(event.target.value))}
                  aria-label="Chat text size"
                />
                <span className="video-chat-size-slider__value">
                  {chatFontSizeRem.toFixed(1)}rem
                </span>
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
