import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io, type Socket } from "socket.io-client";
import api from "../api/strapi";
import { useAuth } from "./AuthContext";
import {
  decryptJson,
  decryptWrappedKey,
  deriveSharedKey,
  encryptJson,
  encryptKeyForRecipient,
  exportPublicKey,
  generateCallKey,
  getOrCreateIdentityKeyPair,
  importPublicKey,
} from "../utils/crypto";
import {
  buildProfilePayloadFromAttrs,
  decryptOwnProfilePayload,
  fetchUserKeys,
} from "../utils/profile-e2ee";
import { pickMediaUrl } from "../utils/media";
import { getStoredToken } from "../utils/auth-storage";

type VideoCallInvitee = {
  userId: number;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
};

type VideoCallParticipant = {
  socketId: string;
  userId: number;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
  e2eeCapable?: boolean;
};

type IncomingCall = {
  roomId: string;
  hostId: number;
  hostName: string;
  hostHandle?: string;
  hostAvatar?: string;
  invitees: number[];
  e2eeEnabled?: boolean;
};

type VideoCallMessage = {
  id: string;
  body: string;
  kind: "text" | "emoji" | "gif" | "image";
  gifUrl?: string;
  from: {
    userId: number;
    displayName: string;
    handle?: string;
    avatarUrl?: string;
  };
  at: string;
};

type VideoCallChatEnvelope = {
  body: string;
  kind: VideoCallMessage["kind"];
  gifUrl?: string;
};

type VideoCallChatWirePayload = {
  roomId?: string;
  body?: string;
  kind?: VideoCallMessage["kind"] | string;
  gifUrl?: string;
  encryptedMessage?: string;
  from?: {
    userId?: number;
    displayName?: string;
    handle?: string;
    avatarUrl?: string;
  };
  at?: string;
};

type VideoCallStatus = "idle" | "setup" | "incoming" | "connecting" | "in-call";
type RealtimeStatus = "disconnected" | "connecting" | "connected";

type AvatarEyeStyle =
  | "almond"
  | "hooded"
  | "deep-set"
  | "monolid"
  | "cat-eye"
  | "doe"
  | "narrow"
  | "bright-hazel";

type AvatarMouthStyle =
  | "natural"
  | "rose"
  | "mauve"
  | "berry"
  | "caramel"
  | "ruby-smile"
  | "mocha"
  | "plum-gloss";

type ScreenControlRequest = {
  socketId: string;
  userId: number;
  displayName: string;
  handle?: string;
  avatarUrl?: string;
};

type ScreenControlCursor = {
  x: number;
  y: number;
  from: string;
  at: number;
  kind: "move" | "click";
  button?: "left" | "right";
};

type ScreenControlEvent = {
  type: "move" | "click" | "scroll" | "key";
  x?: number;
  y?: number;
  button?: "left" | "right";
  deltaX?: number;
  deltaY?: number;
  key?: string;
  code?: string;
  state?: "down" | "up";
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
};

type VideoCallEffects = {
  blur: boolean;
  mirror: boolean;
  background:
    | "none"
    | "ai"
    | "backdrop1"
    | "backdrop2"
    | "backdrop3"
    | "backdrop4"
    | "backdrop5"
    | "backdrop6"
    | "backdrop7"
    | "backdrop8"
    | "backdrop9"
    | "backdrop10";
  backgroundImageUrl: string;
  maskStrength: number;
  avatarEnabled: boolean;
  avatarImageUrl: string;
  avatarOffsetX: number;
  avatarOffsetY: number;
  avatarScale: number;
  avatarEyeOffsetX: number;
  avatarEyeOffsetY: number;
  avatarEyeSpacing: number;
  avatarEyeSize: number;
  avatarMouthOffsetX: number;
  avatarMouthOffsetY: number;
  avatarMouthSize: number;
  avatarEyeStyle: AvatarEyeStyle;
  avatarMouthStyle: AvatarMouthStyle;
  filter:
    | "none"
    | "vivid"
    | "crisp"
    | "cinema"
    | "matte"
    | "soft"
    | "neon"
    | "sunset"
    | "ice"
    | "vintage"
    | "warm"
    | "cool"
    | "amber"
    | "teal"
    | "rose"
    | "noir"
    | "midnight";
  softFocus: boolean;
  softFocusAmount: number;
};

type SelfieSegmentationResults = {
  segmentationMask?: CanvasImageSource | null;
};

type SelfieSegmentationInstance = {
  setOptions: (options: { modelSelection?: number; selfieMode?: boolean }) => void;
  onResults: (callback: (results: SelfieSegmentationResults) => void) => void;
  send: (input: { image: HTMLVideoElement | HTMLCanvasElement }) => Promise<void>;
  close?: () => void;
};

type SelfieSegmentationConstructor = new (config: {
  locateFile?: (file: string) => string;
}) => SelfieSegmentationInstance;

type FaceBlendshapeCategory = { categoryName: string; score: number };
type FaceLandmarkerResults = {
  faceBlendshapes?: Array<{ categories: FaceBlendshapeCategory[] }>;
};
type FaceLandmarkerInstance = {
  detectForVideo: (video: HTMLVideoElement, timestamp: number) => FaceLandmarkerResults;
  close?: () => void;
};

type VideoCallContextValue = {
  isOpen: boolean;
  status: VideoCallStatus;
  realtimeStatus: RealtimeStatus;
  realtimeError: string | null;
  realtimeUrl: string;
  selectedInvitees: VideoCallInvitee[];
  incomingCall: IncomingCall | null;
  activeRoomId: string | null;
  isCallHost: boolean;
  localStream: MediaStream | null;
  localScreenStream: MediaStream | null;
  remoteStreams: Record<string, MediaStream>;
  remoteScreenStreams: Record<string, MediaStream>;
  remoteParticipants: Record<string, VideoCallParticipant>;
  messages: VideoCallMessage[];
  error: string | null;
  e2eeDebug: string | null;
  maxParticipants: number;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
  noiseSuppressionEnabled: boolean;
  voiceFocusEnabled: boolean;
  lowLatencyMode: boolean;
  lowLatencySuggested: boolean;
  lowLatencySuggestionReason: string | null;
  isHolding: boolean;
  isOnHold: boolean;
  selectedAudioInputId: string;
  selectedVideoInputId: string;
  isScreenSharing: boolean;
  videoEffects: VideoCallEffects;
  setVideoEffects: (effects: Partial<VideoCallEffects>) => void;
  toggleNoiseSuppression: () => void;
  toggleVoiceFocus: () => void;
  toggleLowLatencyMode: () => void;
  onlineUserIds: Set<number>;
  openCallComposer: (invitees?: VideoCallInvitee[]) => void;
  closeCallComposer: () => void;
  setSelectedInvitees: (invitees: VideoCallInvitee[]) => void;
  setPresenceTargets: (userIds: number[]) => void;
  startCall: (invitees?: VideoCallInvitee[]) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  leaveCall: () => void;
  endCall: () => void;
  toggleVideo: () => void;
  toggleAudio: () => void;
  setAudioInputDevice: (deviceId: string) => Promise<void>;
  setVideoInputDevice: (deviceId: string) => Promise<void>;
  startScreenShare: (options?: { mediaDevices?: MediaDevices | null }) => Promise<void>;
  stopScreenShare: () => void;
  screenControlRequests: ScreenControlRequest[];
  pendingScreenControlTargets: string[];
  activeScreenController: ScreenControlRequest | null;
  screenControlTarget: string | null;
  screenControlAgentId: string | null;
  screenControlCursor: ScreenControlCursor | null;
  requestScreenControl: (targetSocketId: string) => void;
  grantScreenControl: (requesterSocketId: string) => void;
  denyScreenControl: (requesterSocketId: string) => void;
  stopScreenControl: (targetSocketId?: string) => void;
  sendScreenControlEvent: (targetSocketId: string, event: ScreenControlEvent) => void;
  sendMessage: (body: string, kind?: VideoCallMessage["kind"], gifUrl?: string) => void;
  toggleHold: () => void;
  muteAllParticipants: () => void;
  stopAllScreenShares: () => void;
  removeParticipantFromCall: (socketId: string) => void;
};

const MAX_VIDEO_PARTICIPANTS = 8;
const CALL_CONNECT_TIMEOUT_MS = 20000;
const E2EE_VERSION = 1;
const E2EE_IV_BYTES = 12;
const E2EE_HEADER_BYTES = 1 + E2EE_IV_BYTES;
const CALL_E2EE_ENABLED = !["0", "false", "off", "no"].includes(
  String(import.meta.env.VITE_CALL_E2EE ?? "1").trim().toLowerCase()
);
// Media (video/audio/screen-share) E2EE via insertable streams is still experimental.
// Keep it separately toggleable from chat/profile encryption so we can fall back safely.
const CALL_MEDIA_E2EE_ENABLED = !["0", "false", "off", "no"].includes(
  String(import.meta.env.VITE_CALL_MEDIA_E2EE ?? "0").trim().toLowerCase()
);
const REALTIME_URL =
  String(import.meta.env.VITE_SOCKET_URL || "").trim() ||
  String(import.meta.env.VITE_API_URL || "").replace(/\/api$/, "") ||
  (typeof window !== "undefined" ? window.location.origin : "");
const AUDIO_SYNC_DELAY_SEC = 0.14;
const NOISE_SUPPRESSION_STORAGE_KEY = "call:noise-suppression";
const VOICE_FOCUS_STORAGE_KEY = "call:voice-focus";
const LOW_LATENCY_STORAGE_KEY = "call:low-latency";
const SOCKET_HEARTBEAT_INTERVAL_MS = Number(
  import.meta.env.VITE_SOCKET_HEARTBEAT_INTERVAL || 20000
);
const SOCKET_HEARTBEAT_TIMEOUT_MS = Number(
  import.meta.env.VITE_SOCKET_HEARTBEAT_TIMEOUT || 45000
);
const SOCKET_AUTH_REFRESH_INTERVAL_MS = Number(
  import.meta.env.VITE_SOCKET_AUTH_REFRESH_INTERVAL || 10 * 60 * 1000
);

const supportsCallE2ee = () => {
  if (typeof window === "undefined") return false;
  if (!CALL_E2EE_ENABLED) return false;
  if (!CALL_MEDIA_E2EE_ENABLED) return false;
  const sender = (window as any).RTCRtpSender?.prototype;
  const receiver = (window as any).RTCRtpReceiver?.prototype;
  const senderHasStreams =
    typeof sender?.createEncodedStreams === "function" ||
    (typeof sender?.createEncodedAudioStreams === "function" &&
      typeof sender?.createEncodedVideoStreams === "function");
  const receiverHasStreams =
    typeof receiver?.createEncodedStreams === "function" ||
    (typeof receiver?.createEncodedAudioStreams === "function" &&
      typeof receiver?.createEncodedVideoStreams === "function");
  const hasInsertable =
    senderHasStreams &&
    receiverHasStreams &&
    typeof (window as any).TransformStream === "function";
  return hasInsertable && Boolean(window.crypto?.subtle);
};

const supportsCallCrypto = () => {
  if (typeof window === "undefined") return false;
  if (!CALL_E2EE_ENABLED) return false;
  return Boolean(window.crypto?.subtle);
};

const TURN_URLS = String(
  import.meta.env.VITE_TURN_URLS || import.meta.env.VITE_TURN_URL || ""
)
  .split(/[,\\s]+/)
  .map((value) => value.trim())
  .filter(Boolean);
const TURN_USERNAME = String(import.meta.env.VITE_TURN_USERNAME || "").trim();
const TURN_CREDENTIAL = String(import.meta.env.VITE_TURN_CREDENTIAL || "").trim();
const ICE_POLICY = String(import.meta.env.VITE_ICE_TRANSPORT_POLICY || "")
  .trim()
  .toLowerCase();

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
];

if (TURN_URLS.length) {
  const turnServer: RTCIceServer = { urls: TURN_URLS };
  if (TURN_USERNAME && TURN_CREDENTIAL) {
    turnServer.username = TURN_USERNAME;
    turnServer.credential = TURN_CREDENTIAL;
  }
  ICE_SERVERS.push(turnServer);
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: ICE_SERVERS,
  ...(ICE_POLICY === "relay" || ICE_POLICY === "all"
    ? { iceTransportPolicy: ICE_POLICY as RTCIceTransportPolicy }
    : {}),
};

const createRoomId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const createMessageId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const LOCAL_CHAT_DEDUPE_WINDOW_MS = 5000;

const buildChatMessageSignature = (message: {
  userId: number;
  kind: VideoCallMessage["kind"];
  body: string;
  gifUrl?: string;
}) =>
  [
    Number.isFinite(message.userId) ? message.userId : 0,
    message.kind,
    String(message.body || ""),
    String(message.gifUrl || ""),
  ].join("|");

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");
const mediapipeBase =
  String(import.meta.env.VITE_MEDIAPIPE_ASSETS_URL || "").trim() ||
  "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation";
const mediapipeVisionBase =
  String(import.meta.env.VITE_MEDIAPIPE_VISION_URL || "").trim() ||
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm";
const faceLandmarkerModelUrl =
  String(import.meta.env.VITE_FACE_LANDMARKER_MODEL_URL || "").trim() ||
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";
const BACKDROP_ASSETS = {
  backdrop1: "/backdropsAI/bedroom.png",
  backdrop2: "/backdropsAI/dots.png",
  backdrop3: "/backdropsAI/futuristic_home.png",
  backdrop4: "/backdropsAI/home.png",
  backdrop5: "/backdropsAI/lakeside.png",
  backdrop6: "/backdropsAI/lillies.png",
  backdrop7: "/backdropsAI/nightime_city.png",
  backdrop8: "/backdropsAI/stunning.png",
  backdrop9: "/backdropsAI/tech_lab.png",
  backdrop10: "/backdropsAI/wavy.png",
} as const;
const backdropImageCache = new Map<string, HTMLImageElement>();
const getBackdropImage = (src: string) => {
  if (typeof Image === "undefined") return null;
  const cached = backdropImageCache.get(src);
  if (cached) return cached;
  const img = new Image();
  img.decoding = "async";
  img.crossOrigin = "anonymous";
  img.src = src;
  backdropImageCache.set(src, img);
  return img;
};

const isPresetAvatarSource = (src: string) => {
  const value = String(src || "").trim();
  if (!value) return false;
  if (value.includes("/avatar-presets/")) return true;
  try {
    const parsed = new URL(value, "http://localhost");
    return parsed.pathname.includes("/avatar-presets/");
  } catch {
    return false;
  }
};
let selfieSegmentationPromise: Promise<SelfieSegmentationConstructor | null> | null = null;
const loadSelfieSegmentation = () => {
  if (!selfieSegmentationPromise) {
    selfieSegmentationPromise = (async () => {
      if (typeof window === "undefined") return null;
      const globalAny = globalThis as any;
      if (!globalAny.SelfieSegmentation) {
        try {
          await import("@mediapipe/selfie_segmentation");
        } catch {
          return null;
        }
      }
      return (globalAny.SelfieSegmentation as SelfieSegmentationConstructor) || null;
    })();
  }
  return selfieSegmentationPromise;
};

const isCallActiveStatus = (status: VideoCallStatus) =>
  status === "in-call" || status === "connecting";

const normalizeAvatarEyeStyle = (style: AvatarEyeStyle | string): AvatarEyeStyle => {
  switch (style) {
    case "almond":
    case "hooded":
    case "deep-set":
    case "monolid":
    case "cat-eye":
    case "doe":
    case "narrow":
    case "bright-hazel":
      return style;
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

const normalizeAvatarMouthStyle = (style: AvatarMouthStyle | string): AvatarMouthStyle => {
  switch (style) {
    case "natural":
    case "rose":
    case "mauve":
    case "berry":
    case "caramel":
    case "ruby-smile":
    case "mocha":
    case "plum-gloss":
      return style;
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

const buildVideoEffectsKey = (
  effects: VideoCallEffects,
  hasAvatar: boolean
) =>
  {
    const eyeStyle = normalizeAvatarEyeStyle(effects.avatarEyeStyle);
    const mouthStyle = normalizeAvatarMouthStyle(effects.avatarMouthStyle);
    return (
  `${effects.blur ? "1" : "0"}-${effects.background}-${effects.filter}-${
    effects.mirror ? "1" : "0"
  }-${hasAvatar ? "1" : "0"}-${effects.backgroundImageUrl}-${effects.avatarImageUrl}-${
    effects.maskStrength
  }-${effects.avatarOffsetX}-${effects.avatarOffsetY}-${effects.avatarScale}-${
    effects.avatarEyeOffsetX
  }-${effects.avatarEyeOffsetY}-${effects.avatarEyeSpacing}-${effects.avatarEyeSize}-${
    effects.avatarMouthOffsetX
  }-${effects.avatarMouthOffsetY}-${effects.avatarMouthSize}-${eyeStyle}-${mouthStyle}`
    );
  };

let faceLandmarkerPromise: Promise<FaceLandmarkerInstance | null> | null = null;
const loadFaceLandmarker = () => {
  if (!faceLandmarkerPromise) {
    faceLandmarkerPromise = (async () => {
      if (typeof window === "undefined") return null;
      try {
        const vision = (await import("@mediapipe/tasks-vision")) as {
          FaceLandmarker?: {
            createFromOptions: (
              resolver: unknown,
              options: {
                baseOptions: { modelAssetPath: string };
                runningMode: "VIDEO";
                numFaces: number;
                outputFaceBlendshapes: boolean;
                outputFaceLandmarks: boolean;
              }
            ) => Promise<FaceLandmarkerInstance>;
          };
          FilesetResolver?: {
            forVisionTasks: (base: string) => Promise<unknown>;
          };
        };
        if (!vision.FaceLandmarker || !vision.FilesetResolver) return null;
        const resolver = await vision.FilesetResolver.forVisionTasks(mediapipeVisionBase);
        return await vision.FaceLandmarker.createFromOptions(resolver, {
          baseOptions: { modelAssetPath: faceLandmarkerModelUrl },
          runningMode: "VIDEO",
          numFaces: 1,
          outputFaceBlendshapes: true,
          outputFaceLandmarks: false,
        });
      } catch {
        return null;
      }
    })();
  }
  return faceLandmarkerPromise;
};

const VideoCallContext = createContext<VideoCallContextValue | undefined>(undefined);

export const VideoCallProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [status, setStatus] = useState<VideoCallStatus>("idle");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedInvitees, setSelectedInviteesState] = useState<VideoCallInvitee[]>([]);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [isCallHost, setIsCallHost] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteScreenStreams, setRemoteScreenStreams] = useState<Record<string, MediaStream>>({});
  const [remoteParticipants, setRemoteParticipants] = useState<
    Record<string, VideoCallParticipant>
  >({});
  const [messages, setMessages] = useState<VideoCallMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [e2eeDebug, setE2eeDebug] = useState<string | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [isHolding, setIsHolding] = useState(false);
  const [remoteHoldStates, setRemoteHoldStates] = useState<Record<string, boolean>>({});
  const [selectedAudioInputId, setSelectedAudioInputId] = useState<string>("default");
  const [selectedVideoInputId, setSelectedVideoInputId] = useState<string>("default");
  const [screenControlRequests, setScreenControlRequests] = useState<ScreenControlRequest[]>([]);
  const [pendingScreenControlTargets, setPendingScreenControlTargets] = useState<string[]>([]);
  const [activeScreenController, setActiveScreenController] =
    useState<ScreenControlRequest | null>(null);
  const [screenControlTarget, setScreenControlTarget] = useState<string | null>(null);
  const [screenControlAgentId, setScreenControlAgentId] = useState<string | null>(null);
  const [screenControlCursor, setScreenControlCursor] = useState<ScreenControlCursor | null>(null);
  const [videoEffects, setVideoEffectsState] = useState<VideoCallEffects>({
    blur: false,
    mirror: false,
    background: "none",
    backgroundImageUrl: "",
    maskStrength: 0.85,
    avatarEnabled: false,
    avatarImageUrl: "",
    avatarOffsetX: 0,
    avatarOffsetY: 0,
    avatarScale: 1,
    avatarEyeOffsetX: 0,
    avatarEyeOffsetY: 0,
    avatarEyeSpacing: 0.45,
    avatarEyeSize: 1,
    avatarMouthOffsetX: 0,
    avatarMouthOffsetY: -0.08,
    avatarMouthSize: 1,
    avatarEyeStyle: "almond",
    avatarMouthStyle: "natural",
    filter: "none",
    softFocus: false,
    softFocusAmount: 0.35,
  });
  const [onlineUserIds, setOnlineUserIds] = useState<Set<number>>(new Set());
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>("disconnected");
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = window.localStorage.getItem(NOISE_SUPPRESSION_STORAGE_KEY);
    if (!stored) return true;
    return stored === "1";
  });
  const [voiceFocusEnabled, setVoiceFocusEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(VOICE_FOCUS_STORAGE_KEY);
    if (!stored) return false;
    return stored === "1";
  });
  const [lowLatencyMode, setLowLatencyMode] = useState(() => {
    if (typeof window === "undefined") return false;
    const stored = window.localStorage.getItem(LOW_LATENCY_STORAGE_KEY);
    if (!stored) return false;
    return stored === "1";
  });
  const [lowLatencySuggested, setLowLatencySuggested] = useState(false);
  const [lowLatencySuggestionReason, setLowLatencySuggestionReason] = useState<string | null>(
    null
  );
  const errorRef = useRef<string | null>(null);
  const transientErrorTimerRef = useRef<number | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const lastHeartbeatRef = useRef(0);
  const authRefreshTimerRef = useRef<number | null>(null);
  const reconnectingRef = useRef(false);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsRef = useRef<Record<string, MediaStream>>({});
  const remoteScreenStreamsRef = useRef<Record<string, MediaStream>>({});
  const remoteParticipantsRef = useRef<Record<string, VideoCallParticipant>>({});
  const peerE2eeCapableRef = useRef<Map<string, boolean>>(new Map());
  const hadRemoteParticipantsRef = useRef(false);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const screenShareSendersRef = useRef<
    Map<string, { video?: RTCRtpSender; audio?: RTCRtpSender }>
  >(new Map());
  const screenShareOwnersRef = useRef<Map<string, string>>(new Map());
  const screenShareByOwnerRef = useRef<Map<string, string>>(new Map());
  const disconnectTimersRef = useRef<Map<string, number>>(new Map());
  // Trickle ICE can arrive before SDP is applied; queue per-peer candidates until `remoteDescription` exists.
  const pendingIceCandidatesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const rtcConfigRef = useRef<RTCConfiguration>(RTC_CONFIG);
  const iceServersLoadingRef = useRef<
    Promise<{ servers: RTCIceServer[]; ttlSeconds: number; updated: boolean }> | null
  >(null);
  const iceServerMetaRef = useRef<{ expiresAt: number; ttlSeconds: number } | null>(null);
  const iceRefreshTimerRef = useRef<number | null>(null);
  const iceRestartAttemptsRef = useRef<Map<string, { count: number; lastAttemptAt: number }>>(
    new Map()
  );
  const audioInputDeviceRef = useRef<string | null>(null);
  const videoInputDeviceRef = useRef<string | null>(null);
  const selectedInviteesRef = useRef<VideoCallInvitee[]>([]);
  const peerNegotiationRef = useRef<
    Map<string, { makingOffer: boolean; isPolite: boolean; needsIceRestart?: boolean }>
  >(new Map());
  const localSocketIdRef = useRef<string | null>(null);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const videoEffectsRef = useRef(videoEffects);
  const noiseSuppressionRef = useRef(noiseSuppressionEnabled);
  const voiceFocusRef = useRef(voiceFocusEnabled);
  const lowLatencyModeRef = useRef(lowLatencyMode);
  const holdEnabledRef = useRef(false);
  const holdRestoreRef = useRef<{ audio: boolean; video: boolean }>({
    audio: true,
    video: true,
  });
  const remoteHoldStatesRef = useRef<Record<string, boolean>>({});
  const screenControlTargetRef = useRef<string | null>(null);
  const screenControlAgentRef = useRef<string | null>(null);
  const callTimeoutRef = useRef<number | null>(null);
  const turnAvailableRef = useRef<boolean>(TURN_URLS.length > 0);
  const videoProcessingRef = useRef<{
    track: MediaStreamTrack | null;
    cleanup: (() => void) | null;
    sourceId: string | null;
    effectsKey: string;
  }>({ track: null, cleanup: null, sourceId: null, effectsKey: "" });
  const audioProcessingRef = useRef<{
    track: MediaStreamTrack | null;
    cleanup: (() => void) | null;
    sourceId: string | null;
    delaySec: number;
    mode: "none" | "delay" | "voice";
  }>({ track: null, cleanup: null, sourceId: null, delaySec: 0, mode: "none" });
  const cleanupCallRef = useRef<() => void>(() => {});
  const profileRef = useRef<VideoCallInvitee | null>(null);
  const statusRef = useRef<VideoCallStatus>(status);
  const activeRoomRef = useRef<string | null>(activeRoomId);
  const activeScreenControllerRef = useRef<ScreenControlRequest | null>(null);
  const presenceTargetsRef = useRef<number[]>([]);
  const e2eeSupported = useMemo(() => supportsCallE2ee(), []);
  const e2eeCryptoSupported = useMemo(() => supportsCallCrypto(), []);
  // Desired room E2EE mode (may be true even if this client can't do media transforms).
  const callEncryptionEnabledRef = useRef<boolean>(CALL_E2EE_ENABLED);
  const callKeyRef = useRef<CryptoKey | null>(null);
  const callKeyRoomRef = useRef<string | null>(null);
  const callKeyRecipientsRef = useRef<Set<number>>(new Set());
  const callKeyShareThrottleRef = useRef<Map<number, number>>(new Map());
  const isCallHostRef = useRef(false);
  const missingCallKeySinceRef = useRef<number | null>(null);
  const senderE2eeRef = useRef<WeakSet<RTCRtpSender>>(new WeakSet());
  const receiverE2eeRef = useRef<WeakSet<RTCRtpReceiver>>(new WeakSet());
  const lastCallKeyRequestRef = useRef(0);
  const localChatEchoRef = useRef<Map<string, number>>(new Map());
  const pendingEncryptedChatOutboxRef = useRef<
    Array<{ roomId: string; payload: VideoCallChatEnvelope }>
  >([]);
  const pendingEncryptedChatInboxRef = useRef<
    Map<string, { roomId: string; encryptedMessage: string }>
  >(new Map());

  const clearCallTimeout = useCallback(() => {
    if (callTimeoutRef.current) {
      window.clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
  }, []);

  const buildSocketUrl = () => {
    const envUrl = String(import.meta.env.VITE_SOCKET_URL || "").trim();
    if (envUrl) return envUrl;
    if (apiBase) return apiBase;
    if (typeof window !== "undefined") return window.location.origin;
    return "";
  };

  const resolveLocalIdentity = useCallback(() => {
    const profile = profileRef.current;
    const displayName = String(
      profile?.displayName || user?.username || user?.email || ""
    ).trim();
    return {
      displayName,
      handle: String(profile?.handle || "").trim(),
      avatarUrl: String(profile?.avatarUrl || "").trim(),
    };
  }, [user?.email, user?.username]);

  const resolveSocketAuth = useCallback(() => {
    const token = getStoredToken();
    const identity = resolveLocalIdentity();
    return {
      token,
      userId: user?.id,
      displayName: identity.displayName,
      handle: identity.handle,
      avatarUrl: identity.avatarUrl,
    };
  }, [resolveLocalIdentity, user?.id]);

  const refreshSocketAuth = useCallback(
    async (socket?: Socket | null) => {
      const target = socket ?? socketRef.current;
      if (!target) return "timeout" as const;
      const auth = resolveSocketAuth();
      target.auth = auth;
      return new Promise<"ok" | "unauthorized" | "timeout">((resolve) => {
        target
          .timeout(6000)
          .emit(
            "auth:refresh",
            auth,
            (err: Error | null, response?: { ok?: boolean }) => {
              if (err) {
                resolve("timeout");
                return;
              }
              if (response?.ok === false) {
                resolve("unauthorized");
                return;
              }
              resolve("ok");
            }
          );
      });
    },
    [resolveSocketAuth]
  );

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const stopAuthRefresh = useCallback(() => {
    if (authRefreshTimerRef.current) {
      window.clearInterval(authRefreshTimerRef.current);
      authRefreshTimerRef.current = null;
    }
  }, []);

  const startHeartbeat = useCallback(
    (socket: Socket) => {
      stopHeartbeat();
      if (
        !Number.isFinite(SOCKET_HEARTBEAT_INTERVAL_MS) ||
        SOCKET_HEARTBEAT_INTERVAL_MS < 5000
      ) {
        return;
      }
      lastHeartbeatRef.current = Date.now();
      heartbeatTimerRef.current = window.setInterval(() => {
        if (!socket.connected) return;
        const now = Date.now();
        if (
          Number.isFinite(SOCKET_HEARTBEAT_TIMEOUT_MS) &&
          SOCKET_HEARTBEAT_TIMEOUT_MS > 0 &&
          now - lastHeartbeatRef.current > SOCKET_HEARTBEAT_TIMEOUT_MS
        ) {
          setRealtimeError("Realtime keepalive timed out.");
          socket.disconnect();
          socket.connect();
          return;
        }
        socket
          .timeout(5000)
          .emit(
            "presence:ping",
            { at: now },
            (err: Error | null, response?: { ok?: boolean }) => {
              if (!err && response?.ok) {
                lastHeartbeatRef.current = Date.now();
              }
            }
          );
      }, SOCKET_HEARTBEAT_INTERVAL_MS);
    },
    [stopHeartbeat]
  );

  const startAuthRefresh = useCallback(
    (socket: Socket) => {
      stopAuthRefresh();
      if (
        !Number.isFinite(SOCKET_AUTH_REFRESH_INTERVAL_MS) ||
        SOCKET_AUTH_REFRESH_INTERVAL_MS < 60_000
      ) {
        return;
      }
      authRefreshTimerRef.current = window.setInterval(() => {
        void refreshSocketAuth(socket).then((result) => {
          if (result !== "unauthorized") return;
          setRealtimeError("Session expired. Please log in again.");
          socket.disconnect();
        });
      }, SOCKET_AUTH_REFRESH_INTERVAL_MS);
    },
    [refreshSocketAuth, stopAuthRefresh]
  );

  const showTransientError = useCallback((message: string, duration = 8000) => {
    if (!message) return;
    setError(message);
    if (transientErrorTimerRef.current) {
      window.clearTimeout(transientErrorTimerRef.current);
    }
    transientErrorTimerRef.current = window.setTimeout(() => {
      if (errorRef.current === message) {
        setError(null);
      }
    }, duration);
  }, []);

  const warnIfNoTurn = useCallback(() => {
    if (turnAvailableRef.current) return;
    showTransientError(
      "No TURN server configured. Calls may drop on restrictive networks.",
      10000
    );
  }, [showTransientError]);

  const setVideoEffects = useCallback((effects: Partial<VideoCallEffects>) => {
    setVideoEffectsState((prev) => {
      const next = {
        ...prev,
        ...effects,
        avatarEyeStyle: normalizeAvatarEyeStyle(
          (effects.avatarEyeStyle as string | undefined) ?? prev.avatarEyeStyle
        ),
        avatarMouthStyle: normalizeAvatarMouthStyle(
          (effects.avatarMouthStyle as string | undefined) ?? prev.avatarMouthStyle
        ),
      };
      const changedKeys = new Set<keyof VideoCallEffects>(
        Object.keys(effects) as Array<keyof VideoCallEffects>
      );
      changedKeys.add("avatarEyeStyle");
      changedKeys.add("avatarMouthStyle");
      const hasChanges = Array.from(changedKeys).some((key) => !Object.is(prev[key], next[key]));
      if (!hasChanges) {
        return prev;
      }
      videoEffectsRef.current = next;
      return next;
    });
  }, []);

  const isOnHold = useMemo(
    () => isHolding || Object.values(remoteHoldStates).some(Boolean),
    [isHolding, remoteHoldStates]
  );

  useEffect(() => {
    noiseSuppressionRef.current = noiseSuppressionEnabled;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      NOISE_SUPPRESSION_STORAGE_KEY,
      noiseSuppressionEnabled ? "1" : "0"
    );
  }, [noiseSuppressionEnabled]);

  useEffect(() => {
    voiceFocusRef.current = voiceFocusEnabled;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(VOICE_FOCUS_STORAGE_KEY, voiceFocusEnabled ? "1" : "0");
  }, [voiceFocusEnabled]);

  useEffect(() => {
    lowLatencyModeRef.current = lowLatencyMode;
    if (typeof window === "undefined") return;
    window.localStorage.setItem(LOW_LATENCY_STORAGE_KEY, lowLatencyMode ? "1" : "0");
  }, [lowLatencyMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const connection =
      (navigator as any).connection ||
      (navigator as any).mozConnection ||
      (navigator as any).webkitConnection;
    if (!connection) return;

    const evaluate = () => {
      const effectiveType = String(connection.effectiveType || "").toLowerCase();
      const downlink = Number(connection.downlink || 0);
      const rtt = Number(connection.rtt || 0);
      const saveData = Boolean(connection.saveData);
      let suggested = false;
      let reason: string | null = null;
      if (saveData) {
        suggested = true;
        reason = "Data Saver is enabled.";
      } else if (["slow-2g", "2g", "3g"].includes(effectiveType)) {
        suggested = true;
        reason = `Network type: ${effectiveType}.`;
      } else if (downlink > 0 && downlink < 2) {
        suggested = true;
        reason = `Estimated downlink: ${downlink.toFixed(1)} Mbps.`;
      } else if (rtt > 200) {
        suggested = true;
        reason = `High latency: ${Math.round(rtt)} ms.`;
      }
      setLowLatencySuggested(suggested);
      setLowLatencySuggestionReason(reason);
    };

    evaluate();
    connection.addEventListener?.("change", evaluate);
    return () => {
      connection.removeEventListener?.("change", evaluate);
    };
  }, []);

  const applyTrackHints = useCallback((track: MediaStreamTrack | null) => {
    if (!track) return;
    if (track.kind === "video") {
      try {
        track.contentHint = "motion";
      } catch {
        // ignore unsupported hints
      }
    }
    if (track.kind === "audio") {
      try {
        track.contentHint = "speech";
      } catch {
        // ignore unsupported hints
      }
    }
  }, []);

const buildAudioConstraints = useCallback(
    (deviceId: string | null, noiseSuppression: boolean) => {
      const supported =
        typeof navigator !== "undefined" && navigator.mediaDevices?.getSupportedConstraints
          ? navigator.mediaDevices.getSupportedConstraints()
          : {};
      const constraints: MediaTrackConstraints = {
        noiseSuppression,
        echoCancellation: true,
        autoGainControl: true,
      };
      if (supported.channelCount) {
        constraints.channelCount = 1;
      }
      if (supported.sampleRate) {
        constraints.sampleRate = { ideal: 48000 };
      }
      if (supported.sampleSize) {
        constraints.sampleSize = 16;
      }
      const supportsLatency =
        "latency" in supported && Boolean((supported as { latency?: boolean }).latency);
      if (supportsLatency) {
        (
          constraints as MediaTrackConstraints & { latency?: ConstrainDoubleRange }
        ).latency = { ideal: 0.02, max: 0.05 };
      }
      if ((supported as { voiceIsolation?: boolean }).voiceIsolation) {
        (constraints as MediaTrackConstraints & { voiceIsolation?: boolean }).voiceIsolation =
          noiseSuppression;
      }
      const advancedHints: Record<string, unknown> = {
        googEchoCancellation: true,
        googAutoGainControl: true,
        googNoiseSuppression: noiseSuppression,
        googHighpassFilter: noiseSuppression,
      };
      constraints.advanced = [advancedHints as MediaTrackConstraintSet];
      if (deviceId && deviceId !== "default") {
        constraints.deviceId = { exact: deviceId };
      }
      return constraints;
    },
    []
  );

  const buildVideoConstraints = useCallback((deviceId: string | null, lowLatency: boolean) => {
    const constraints: MediaTrackConstraints = {
      width: { ideal: lowLatency ? 640 : 1280 },
      height: { ideal: lowLatency ? 360 : 720 },
      frameRate: { ideal: lowLatency ? 24 : 30 },
    };
    if (deviceId && deviceId !== "default") {
      constraints.deviceId = { exact: deviceId };
    }
    return constraints;
  }, []);

  const tuneSenderForLowLatency = useCallback((sender?: RTCRtpSender | null) => {
    if (!sender?.track) return;
    try {
      const params = sender.getParameters();
      if (!params) return;
      const encodings = params.encodings?.length ? params.encodings : [{}];
      if (sender.track.kind === "video") {
        params.degradationPreference = "maintain-framerate";
        if (lowLatencyModeRef.current) {
          encodings[0] = {
            ...encodings[0],
            maxFramerate: 24,
            maxBitrate: 600_000,
            scaleResolutionDownBy: 1.5,
            priority: "high",
            networkPriority: "high",
          };
        } else {
          encodings[0] = {
            ...encodings[0],
            maxFramerate: 30,
            maxBitrate: 2_000_000,
            scaleResolutionDownBy: 1,
            priority: "high",
            networkPriority: "high",
          };
        }
      } else if (sender.track.kind === "audio") {
        encodings[0] = {
          ...encodings[0],
          priority: "high",
          networkPriority: "high",
        };
      }
      params.encodings = encodings;
      sender.setParameters(params).catch(() => undefined);
    } catch {
      // ignore parameter errors
    }
  }, []);

  const applyLowLatencyToSenders = useCallback(() => {
    peersRef.current.forEach((pc) => {
      pc.getSenders().forEach((sender) => {
        tuneSenderForLowLatency(sender);
      });
    });
  }, [tuneSenderForLowLatency]);

  const queueIceCandidate = useCallback((socketId: string, candidate: RTCIceCandidateInit) => {
    if (!socketId || !candidate) return;
    const map = pendingIceCandidatesRef.current;
    const queued = map.get(socketId) || [];
    queued.push(candidate);
    map.set(socketId, queued);
  }, []);

  const flushQueuedIceCandidates = useCallback(async (socketId: string, pc: RTCPeerConnection) => {
    if (!socketId) return;
    if (!pc?.remoteDescription) return;
    const map = pendingIceCandidatesRef.current;
    const queued = map.get(socketId);
    if (!queued?.length) return;
    map.delete(socketId);
    for (const candidate of queued) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        // ignore ICE errors (candidates can become invalid after restarts)
      }
    }
  }, []);

  const getPeerNegotiationState = useCallback((socketId: string) => {
    const existing = peerNegotiationRef.current.get(socketId);
    if (existing) return existing;
    const localSocketId = socketRef.current?.id || localSocketIdRef.current || "";
    const isPolite = localSocketId ? localSocketId.localeCompare(socketId) < 0 : true;
    const created = { makingOffer: false, isPolite, needsIceRestart: false };
    peerNegotiationRef.current.set(socketId, created);
    return created;
  }, []);

  const isSharedArrayBuffer = (value: unknown) => {
    const ctor = typeof globalThis !== "undefined" ? (globalThis as any).SharedArrayBuffer : null;
    return typeof ctor === "function" && value instanceof ctor;
  };

  const toArrayBuffer = useCallback(
    (data: ArrayBuffer | ArrayBufferView | unknown) => {
      if (data instanceof ArrayBuffer) return data;
      if (isSharedArrayBuffer(data)) {
        const view = new Uint8Array(data as unknown as ArrayBufferLike);
        const copy = new Uint8Array(view.byteLength);
        copy.set(view);
        return copy.buffer;
      }
      if (ArrayBuffer.isView(data)) {
        const view = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        const copy = new Uint8Array(view.byteLength);
        copy.set(view);
        return copy.buffer;
      }
      throw new Error("Unsupported frame data type");
    },
    []
  );

  const encryptFrame = useCallback(
    async (key: CryptoKey, data: ArrayBuffer | ArrayBufferView) => {
      const iv = crypto.getRandomValues(new Uint8Array(E2EE_IV_BYTES));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        toArrayBuffer(data)
      );
      const output = new Uint8Array(E2EE_HEADER_BYTES + encrypted.byteLength);
      output[0] = E2EE_VERSION;
      output.set(iv, 1);
      output.set(new Uint8Array(encrypted), E2EE_HEADER_BYTES);
      return output.buffer;
    },
    [toArrayBuffer]
  );

  const decryptFrame = useCallback(
    async (key: CryptoKey, data: ArrayBuffer | ArrayBufferView) => {
      const buffer = toArrayBuffer(data);
      const bytes = new Uint8Array(buffer);
      if (bytes.length <= E2EE_HEADER_BYTES || bytes[0] !== E2EE_VERSION) {
        throw new Error("Invalid frame");
      }
      const iv = bytes.slice(1, E2EE_HEADER_BYTES);
      const encrypted = bytes.slice(E2EE_HEADER_BYTES);
      return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted);
    },
    [toArrayBuffer]
  );

  const resetE2eeState = useCallback(() => {
    callKeyRef.current = null;
    callKeyRoomRef.current = null;
    callKeyRecipientsRef.current = new Set();
    callKeyShareThrottleRef.current.clear();
    isCallHostRef.current = false;
    setIsCallHost(false);
    senderE2eeRef.current = new WeakSet();
    receiverE2eeRef.current = new WeakSet();
    callEncryptionEnabledRef.current = CALL_E2EE_ENABLED;
    missingCallKeySinceRef.current = null;
    peerE2eeCapableRef.current.clear();
    pendingEncryptedChatOutboxRef.current = [];
    pendingEncryptedChatInboxRef.current.clear();
  }, []);

  const setCallEncryptionMode = useCallback(
    (
      enabled: boolean,
      reason?: string,
      options?: { broadcast?: boolean; suppressBanner?: boolean }
    ) => {
      const nextEnabled = Boolean(enabled);
      callEncryptionEnabledRef.current = nextEnabled;
      if (!nextEnabled) {
        callKeyRef.current = null;
        callKeyRoomRef.current = null;
        callKeyRecipientsRef.current = new Set();
        pendingEncryptedChatOutboxRef.current = [];
        if (pendingEncryptedChatInboxRef.current.size) {
          const pendingIds = new Set(pendingEncryptedChatInboxRef.current.keys());
          pendingEncryptedChatInboxRef.current.clear();
          setMessages((prev) =>
            prev.map((message) =>
              pendingIds.has(message.id) ? { ...message, body: "[Encrypted message]" } : message
            )
          );
        } else {
          pendingEncryptedChatInboxRef.current.clear();
        }
        if (options?.suppressBanner) {
          setE2eeDebug(null);
        } else {
          const message = reason ? `E2EE disabled: ${reason}` : "E2EE disabled.";
          setE2eeDebug(message);
        }
      } else {
        setE2eeDebug(null);
      }
      if (options?.broadcast && socketRef.current && activeRoomRef.current) {
        socketRef.current.emit("call:e2ee:mode", {
          roomId: activeRoomRef.current,
          enabled: nextEnabled,
        });
      }
    },
    [setE2eeDebug]
  );

  const maybeRequestCallKey = useCallback(async (roomIdOverride?: string) => {
    if (!e2eeCryptoSupported || !callEncryptionEnabledRef.current) return;
    if (isCallHostRef.current || callKeyRef.current) return;
    const roomId = roomIdOverride || activeRoomRef.current;
    if (!roomId) return;
    const now = Date.now();
    if (now - lastCallKeyRequestRef.current < 3000) return;
    lastCallKeyRequestRef.current = now;
    if (!socketRef.current || !user?.id) return;
    try {
      const { publicKey } = await getOrCreateIdentityKeyPair();
      const publicKeyText = await exportPublicKey(publicKey);
      socketRef.current.emit("call:e2ee:request", {
        roomId,
        publicKey: publicKeyText,
      });
      setE2eeDebug(null);
    } catch (err) {
      const detail = err instanceof Error ? err.message : "Key request failed";
      setE2eeDebug(`E2EE: ${detail}`);
    }
  }, [e2eeCryptoSupported, user?.id, setE2eeDebug]);

  const flushPendingEncryptedChatOutbox = useCallback(
    async (roomId: string, key: CryptoKey) => {
      const socket = socketRef.current;
      if (!socket || !roomId || !key) return;
      if (!CALL_E2EE_ENABLED || !callEncryptionEnabledRef.current) {
        pendingEncryptedChatOutboxRef.current = [];
        return;
      }

      const queued = pendingEncryptedChatOutboxRef.current;
      if (!queued.length) return;

      const remaining: Array<{ roomId: string; payload: VideoCallChatEnvelope }> = [];
      for (const entry of queued) {
        if (!entry?.roomId || entry.roomId !== roomId) {
          remaining.push(entry);
          continue;
        }
        try {
          const encryptedMessage = await encryptJson(key, entry.payload);
          socket.emit("call:chat", { roomId, encryptedMessage });
        } catch {
          remaining.push(entry);
        }
      }
      pendingEncryptedChatOutboxRef.current = remaining;
    },
    []
  );

  const flushPendingEncryptedChatInbox = useCallback(async (roomId: string, key: CryptoKey) => {
    if (!roomId || !key) return;
    const pending = pendingEncryptedChatInboxRef.current;
    if (!pending.size) return;

    const entries = Array.from(pending.entries()).filter(([, entry]) => entry.roomId === roomId);
    if (!entries.length) return;

    const updates = new Map<string, VideoCallChatEnvelope>();
    await Promise.all(
      entries.map(async ([messageId, entry]) => {
        try {
          const decrypted = await decryptJson<VideoCallChatEnvelope>(key, entry.encryptedMessage);
          const nextKind =
            decrypted?.kind === "emoji" ||
            decrypted?.kind === "gif" ||
            decrypted?.kind === "image"
              ? decrypted.kind
              : "text";
          updates.set(messageId, {
            body: String(decrypted?.body || ""),
            kind: nextKind,
            gifUrl: String(decrypted?.gifUrl || ""),
          });
        } catch {
          updates.set(messageId, { body: "[Unable to decrypt message]", kind: "text", gifUrl: "" });
        }
      })
    );

    entries.forEach(([messageId]) => pending.delete(messageId));

    if (!updates.size) return;
    setMessages((prev) =>
      prev.map((message) => {
        const update = updates.get(message.id);
        if (!update) return message;
        const safeKind =
          update.kind === "emoji" || update.kind === "gif" ? update.kind : "text";
        const safeGifUrl = String(update.gifUrl || "");
        return {
          ...message,
          body: String(update.body || ""),
          kind: safeKind,
          gifUrl: safeGifUrl ? safeGifUrl : undefined,
        };
      })
    );
  }, []);

  const shouldUsePeerE2ee = useCallback(
    (peerSocketId: string) => {
      if (!callEncryptionEnabledRef.current) return false;
      if (!e2eeSupported) return false;
      return peerE2eeCapableRef.current.get(peerSocketId) === true;
    },
    [e2eeSupported]
  );

  const setupSenderE2ee = useCallback(
    (peerSocketId: string, sender?: RTCRtpSender | null) => {
      try {
        if (!sender || !e2eeSupported) return;
        if (!shouldUsePeerE2ee(peerSocketId)) return;
        if (senderE2eeRef.current.has(sender)) return;
        const senderAny = sender as any;
        let streams: { readable?: ReadableStream; writable?: WritableStream } | null = null;
        try {
          streams =
            senderAny.createEncodedStreams?.() ||
            (sender.track?.kind === "audio" ? senderAny.createEncodedAudioStreams?.() : null) ||
            (sender.track?.kind === "video" ? senderAny.createEncodedVideoStreams?.() : null);
        } catch {
          // If insertable streams aren't actually enabled for this sender, keep media flowing.
          return;
        }
        if (!streams?.readable || !streams?.writable) return;
        const transform = new TransformStream({
          async transform(encodedFrame, controller) {
            if (!encodedFrame) return;
            if (!shouldUsePeerE2ee(peerSocketId)) {
              controller.enqueue(encodedFrame);
              return;
            }
            if (!encodedFrame?.data) {
              controller.enqueue(encodedFrame);
              return;
            }
            const key = callKeyRef.current;
            if (!key) {
              // Never block media while waiting for keys; fall back to unencrypted frames.
              if (!missingCallKeySinceRef.current) {
                missingCallKeySinceRef.current = Date.now();
              }
              void maybeRequestCallKey();
              controller.enqueue(encodedFrame);
              return;
            }
            missingCallKeySinceRef.current = null;
            try {
              const encrypted = await encryptFrame(key, encodedFrame.data);
              encodedFrame.data = encrypted;
              controller.enqueue(encodedFrame);
            } catch {
              controller.enqueue(encodedFrame);
            }
          },
        });
        streams.readable
          .pipeThrough(transform)
          .pipeTo(streams.writable)
          .catch(() => undefined);
        senderE2eeRef.current.add(sender);
      } catch {
        // Never break media setup due to E2EE wiring failures.
      }
    },
    [e2eeSupported, encryptFrame, maybeRequestCallKey, shouldUsePeerE2ee]
  );

  const setupReceiverE2ee = useCallback(
    (peerSocketId: string, receiver?: RTCRtpReceiver | null) => {
      try {
        if (!receiver || !e2eeSupported) return;
        if (!shouldUsePeerE2ee(peerSocketId)) return;
        if (receiverE2eeRef.current.has(receiver)) return;
        const receiverAny = receiver as any;
        let streams: { readable?: ReadableStream; writable?: WritableStream } | null = null;
        try {
          streams =
            receiverAny.createEncodedStreams?.() ||
            (receiver.track?.kind === "audio" ? receiverAny.createEncodedAudioStreams?.() : null) ||
            (receiver.track?.kind === "video" ? receiverAny.createEncodedVideoStreams?.() : null);
        } catch {
          // If insertable streams aren't actually enabled for this receiver, keep media flowing.
          return;
        }
        if (!streams?.readable || !streams?.writable) return;
        const transform = new TransformStream({
          async transform(encodedFrame, controller) {
            if (!encodedFrame) return;
            if (!shouldUsePeerE2ee(peerSocketId)) {
              controller.enqueue(encodedFrame);
              return;
            }
            const key = callKeyRef.current;
            if (!encodedFrame?.data) {
              controller.enqueue(encodedFrame);
              return;
            }
            let dataBuffer: ArrayBuffer;
            try {
              dataBuffer = toArrayBuffer(encodedFrame.data);
            } catch {
              // If we can't read the frame bytes, let the frame continue unmodified.
              controller.enqueue(encodedFrame);
              return;
            }
            const bytes = new Uint8Array(dataBuffer);
            const isEncryptedFrame =
              bytes.length > E2EE_HEADER_BYTES && bytes[0] === E2EE_VERSION;
            if (!key) {
              if (!missingCallKeySinceRef.current) {
                missingCallKeySinceRef.current = Date.now();
              }
              void maybeRequestCallKey();
              // If the sender isn't encrypting, allow the frame through even without a key.
              if (!isEncryptedFrame) controller.enqueue(encodedFrame);
              return;
            }
            missingCallKeySinceRef.current = null;
            if (!isEncryptedFrame) {
              controller.enqueue(encodedFrame);
              return;
            }
          try {
            const decrypted = await decryptFrame(key, dataBuffer);
            encodedFrame.data = decrypted;
            controller.enqueue(encodedFrame);
          } catch {
              // If this frame wasn't actually encrypted (false positive) or the key is briefly
              // out-of-sync, passing through is safer than hard-dropping (black video).
              controller.enqueue(encodedFrame);
          }
        },
      });
        streams.readable
          .pipeThrough(transform)
          .pipeTo(streams.writable)
          .catch(() => undefined);
        receiverE2eeRef.current.add(receiver);
      } catch {
        // Never break media setup due to E2EE wiring failures.
      }
    },
    [decryptFrame, e2eeSupported, maybeRequestCallKey, shouldUsePeerE2ee, toArrayBuffer]
  );

  const requestVideoKeyFrame = useCallback((sender?: RTCRtpSender | null) => {
    if (!sender || sender.track?.kind !== "video") return;
    const request = (sender as any).requestKeyFrame;
    if (typeof request !== "function") return;
    try {
      request.call(sender);
    } catch {
      // ignore keyframe request failures
    }
  }, []);

  const requestAllVideoKeyFrames = useCallback(() => {
    peersRef.current.forEach((pc) => {
      pc.getSenders().forEach((sender) => requestVideoKeyFrame(sender));
    });
  }, [requestVideoKeyFrame]);

  const shareCallKeyWithUser = useCallback(
    async (roomId: string, targetUserId: number) => {
      if (!socketRef.current || !user?.id) return;
      if (!callEncryptionEnabledRef.current) return;
      if (!callKeyRef.current || !targetUserId) return;
      if (callKeyRoomRef.current && callKeyRoomRef.current !== roomId) return;
      if (targetUserId === user.id) return;
      if (callKeyRecipientsRef.current.has(targetUserId)) return;
      try {
        const cache = await fetchUserKeys([targetUserId]);
        const entry = cache.get(targetUserId);
        if (!entry?.publicKey) return;
        const { privateKey, publicKey } = await getOrCreateIdentityKeyPair();
        const targetPublicKey = await importPublicKey(entry.publicKey);
        const sharedKey = await deriveSharedKey(privateKey, targetPublicKey);
        const encryptedKey = await encryptKeyForRecipient(sharedKey, callKeyRef.current);
        const senderPublicKey = await exportPublicKey(publicKey);
        socketRef.current.emit("call:e2ee:key", {
          roomId,
          toUserId: targetUserId,
          encryptedKey,
          keyVersion: 1,
          senderPublicKey,
        });
        callKeyRecipientsRef.current.add(targetUserId);
      } catch {
        // ignore key share errors
      }
    },
    [user?.id]
  );

  const shareCallKeyWithPublicKey = useCallback(
    async (roomId: string, targetUserId: number, publicKeyText: string) => {
      if (!socketRef.current || !user?.id) return;
      if (!callEncryptionEnabledRef.current) return;
      if (!callKeyRef.current || !targetUserId || !publicKeyText) return;
      if (callKeyRoomRef.current && callKeyRoomRef.current !== roomId) return;
      if (targetUserId === user.id) return;
      const now = Date.now();
      const lastSent = callKeyShareThrottleRef.current.get(targetUserId) ?? 0;
      if (now - lastSent < 1500) return;
      try {
        const { privateKey, publicKey } = await getOrCreateIdentityKeyPair();
        const targetPublicKey = await importPublicKey(publicKeyText);
        const sharedKey = await deriveSharedKey(privateKey, targetPublicKey);
        const encryptedKey = await encryptKeyForRecipient(sharedKey, callKeyRef.current);
        const senderPublicKey = await exportPublicKey(publicKey);
        socketRef.current.emit("call:e2ee:key", {
          roomId,
          toUserId: targetUserId,
          encryptedKey,
          keyVersion: 1,
          senderPublicKey,
        });
        callKeyShareThrottleRef.current.set(targetUserId, now);
        callKeyRecipientsRef.current.add(targetUserId);
      } catch {
        // ignore key share errors
      }
    },
    [user?.id]
  );

  const shareCallKeyWithParticipants = useCallback(
    (roomId: string, participants: VideoCallParticipant[]) => {
      if (!isCallHostRef.current) return;
      if (!callEncryptionEnabledRef.current) return;
      participants.forEach((participant) => {
        if (!participant?.userId) return;
        void shareCallKeyWithUser(roomId, participant.userId);
      });
    },
    [shareCallKeyWithUser]
  );

  const stopVideoProcessing = useCallback(() => {
    const current = videoProcessingRef.current;
    if (current.cleanup) {
      current.cleanup();
    }
    if (current.track) {
      current.track.stop();
    }
    videoProcessingRef.current = {
      track: null,
      cleanup: null,
      sourceId: null,
      effectsKey: "",
    };
  }, []);

  const stopAudioProcessing = useCallback(() => {
    const current = audioProcessingRef.current;
    if (current.cleanup) {
      current.cleanup();
    }
    if (current.track) {
      current.track.stop();
    }
    audioProcessingRef.current = {
      track: null,
      cleanup: null,
      sourceId: null,
      delaySec: 0,
      mode: "none",
    };
  }, []);

  const createDelayedAudioTrack = useCallback(
    (rawTrack: MediaStreamTrack, delaySec: number) => {
      const AudioCtor =
        typeof window !== "undefined"
          ? window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined;
      if (!AudioCtor) {
        throw new Error("AudioContext unavailable");
      }
      const ctx = new AudioCtor({ latencyHint: "interactive" });
      const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
      const delayNode = ctx.createDelay(1);
      delayNode.delayTime.value = delaySec;
      const destination = ctx.createMediaStreamDestination();
      source.connect(delayNode);
      delayNode.connect(destination);
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => undefined);
      }
      const [track] = destination.stream.getAudioTracks();
      if (track) {
        track.enabled = rawTrack.enabled;
      }
      const cleanup = () => {
        source.disconnect();
        delayNode.disconnect();
        track?.stop();
        ctx.close().catch(() => undefined);
      };
      return { track, cleanup };
    },
    []
  );

  const createVoiceFocusAudioTrack = useCallback(
    (rawTrack: MediaStreamTrack, delaySec: number) => {
      const AudioCtor =
        typeof window !== "undefined"
          ? window.AudioContext ||
            (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined;
      if (!AudioCtor) {
        throw new Error("AudioContext unavailable");
      }
      const ctx = new AudioCtor({ latencyHint: "interactive" });
      const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 85;
      highpass.Q.value = 0.7;
      const lowpass = ctx.createBiquadFilter();
      lowpass.type = "lowpass";
      lowpass.frequency.value = 6000;
      lowpass.Q.value = 0.7;
      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.value = -45;
      compressor.knee.value = 30;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.25;
      const gain = ctx.createGain();
      gain.gain.value = 1;
      const gate = ctx.createScriptProcessor(1024, 1, 1);
      let envelope = 1;
      const attackTime = 0.02;
      const releaseTime = 0.15;
      const attackCoeff = Math.exp(-1 / (ctx.sampleRate * attackTime));
      const releaseCoeff = Math.exp(-1 / (ctx.sampleRate * releaseTime));
      const threshold = 0.015;
      const floor = 0.0;
      gate.onaudioprocess = (event) => {
        const input = event.inputBuffer;
        const output = event.outputBuffer;
        const channels = input.numberOfChannels || 1;
        const length = input.getChannelData(0).length;
        let sum = 0;
        for (let ch = 0; ch < channels; ch += 1) {
          const data = input.getChannelData(ch);
          for (let i = 0; i < length; i += 1) {
            sum += data[i] * data[i];
          }
        }
        const rms = Math.sqrt(sum / (length * channels));
        const target = rms >= threshold ? 1 : floor;
        if (target > envelope) {
          envelope = target + (envelope - target) * attackCoeff;
        } else {
          envelope = target + (envelope - target) * releaseCoeff;
        }
        for (let ch = 0; ch < channels; ch += 1) {
          const inputData = input.getChannelData(ch);
          const outputData = output.getChannelData(ch);
          for (let i = 0; i < length; i += 1) {
            outputData[i] = inputData[i] * envelope;
          }
        }
      };
      const destination = ctx.createMediaStreamDestination();
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(compressor);
      compressor.connect(gain);
      gain.connect(gate);
      let delayNode: DelayNode | null = null;
      if (delaySec > 0) {
        delayNode = ctx.createDelay(1);
        delayNode.delayTime.value = delaySec;
        gate.connect(delayNode);
        delayNode.connect(destination);
      } else {
        gate.connect(destination);
      }
      if (ctx.state === "suspended") {
        ctx.resume().catch(() => undefined);
      }
      const [track] = destination.stream.getAudioTracks();
      if (track) {
        track.enabled = rawTrack.enabled;
      }
      const cleanup = () => {
        gate.onaudioprocess = null;
        source.disconnect();
        highpass.disconnect();
        lowpass.disconnect();
        compressor.disconnect();
        gain.disconnect();
        gate.disconnect();
        if (delayNode) delayNode.disconnect();
        track?.stop();
        ctx.close().catch(() => undefined);
      };
      return { track, cleanup };
    },
    []
  );

  const applyScreenControlEvent = useCallback((event: ScreenControlEvent) => {
    if (typeof document === "undefined" || typeof window === "undefined") return;
    if (!localScreenStreamRef.current) return;

    if (event.type === "key") {
      const target =
        (document.activeElement as HTMLElement | null) || document.body || document.documentElement;
      if (!target) return;
      const init: KeyboardEventInit = {
        key: event.key || "",
        code: event.code || "",
        ctrlKey: Boolean(event.ctrlKey),
        altKey: Boolean(event.altKey),
        shiftKey: Boolean(event.shiftKey),
        metaKey: Boolean(event.metaKey),
        bubbles: true,
        cancelable: true,
      };
      const eventType = event.state === "up" ? "keyup" : "keydown";
      target.dispatchEvent(new KeyboardEvent(eventType, init));
      return;
    }

    const docEl = document.documentElement;
    const viewportWidth = docEl?.clientWidth || window.innerWidth;
    const viewportHeight = docEl?.clientHeight || window.innerHeight;
    if (!viewportWidth || !viewportHeight) return;

    const normX = Math.min(1, Math.max(0, Number(event.x)));
    const normY = Math.min(1, Math.max(0, Number(event.y)));
    const clientX = Math.min(viewportWidth - 1, Math.max(0, normX * viewportWidth));
    const clientY = Math.min(
      viewportHeight - 1,
      Math.max(0, normY * viewportHeight)
    );

    const target =
      (document.elementFromPoint(clientX, clientY) as HTMLElement | null) ||
      document.body;
    if (!target) return;

    const buttonValue = event.button === "right" ? 2 : 0;
    const buttonsValue =
      event.type === "click" ? (buttonValue === 2 ? 2 : 1) : 0;
    const baseMouse: MouseEventInit = {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      screenX: clientX,
      screenY: clientY,
      button: buttonValue,
      buttons: buttonsValue,
    };
    const basePointer: PointerEventInit = {
      ...baseMouse,
      pointerId: 1,
      pointerType: "mouse",
      isPrimary: true,
    };

    const dispatchMouse = (type: string, init: MouseEventInit) => {
      target.dispatchEvent(new MouseEvent(type, init));
    };
    const dispatchPointer = (type: string, init: PointerEventInit) => {
      if (typeof PointerEvent !== "function") return;
      target.dispatchEvent(new PointerEvent(type, init));
    };
    const focusTarget = () => {
      if (typeof (target as HTMLElement).focus !== "function") return;
      try {
        (target as HTMLElement).focus({ preventScroll: true });
      } catch {
        (target as HTMLElement).focus();
      }
    };
    const findScrollableTarget = (start: HTMLElement | null) => {
      let node: HTMLElement | null = start;
      while (node) {
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY;
        const overflowX = style.overflowX;
        const canScrollY =
          (overflowY === "auto" || overflowY === "scroll") &&
          node.scrollHeight > node.clientHeight;
        const canScrollX =
          (overflowX === "auto" || overflowX === "scroll") &&
          node.scrollWidth > node.clientWidth;
        if (canScrollX || canScrollY) return node;
        if (!node.parentElement) break;
        node = node.parentElement;
      }
      return document.scrollingElement as HTMLElement | null;
    };

    if (event.type === "move") {
      dispatchPointer("pointermove", { ...basePointer, buttons: 0 });
      dispatchMouse("mousemove", { ...baseMouse, buttons: 0 });
      return;
    }

    if (event.type === "click") {
      focusTarget();
      dispatchPointer("pointerdown", basePointer);
      dispatchMouse("mousedown", baseMouse);
      dispatchPointer("pointerup", { ...basePointer, buttons: 0 });
      dispatchMouse("mouseup", { ...baseMouse, buttons: 0 });
      if (buttonValue === 2) {
        dispatchMouse("contextmenu", { ...baseMouse, buttons: 0 });
      } else {
        dispatchMouse("click", { ...baseMouse, buttons: 0 });
      }
      return;
    }

    if (event.type === "scroll") {
      const deltaX = Number(event.deltaX) || 0;
      const deltaY = Number(event.deltaY) || 0;
      if (typeof WheelEvent === "function") {
        target.dispatchEvent(
          new WheelEvent("wheel", {
            ...baseMouse,
            deltaX,
            deltaY,
            deltaMode: 0,
          })
        );
      }
      const scrollTarget = findScrollableTarget(target);
      if (scrollTarget) {
        scrollTarget.scrollBy({ left: deltaX, top: deltaY, behavior: "auto" });
      } else {
        window.scrollBy({ left: deltaX, top: deltaY, behavior: "auto" });
      }
    }
  }, []);

  const attachScreenShareTrack = useCallback(
    (pc: RTCPeerConnection, socketId: string) => {
      const screenStream = localScreenStreamRef.current;
      if (!screenStream) return;
      const videoTrack = screenStream.getVideoTracks()[0];
      const audioTrack = screenStream.getAudioTracks()[0];
      if (!videoTrack && !audioTrack) return;
      const existing = screenShareSendersRef.current.get(socketId) || {};
      if (videoTrack) {
        if (existing.video) {
          if (existing.video.track?.id !== videoTrack.id) {
            existing.video.replaceTrack(videoTrack).catch(() => undefined);
          }
          setupSenderE2ee(socketId, existing.video);
          requestVideoKeyFrame(existing.video);
        } else {
          try {
            existing.video = pc.addTrack(videoTrack, screenStream);
            setupSenderE2ee(socketId, existing.video);
            requestVideoKeyFrame(existing.video);
          } catch {
            // ignore share attach errors
          }
        }
      }
      if (audioTrack) {
        if (existing.audio) {
          if (existing.audio.track?.id !== audioTrack.id) {
            existing.audio.replaceTrack(audioTrack).catch(() => undefined);
          }
          setupSenderE2ee(socketId, existing.audio);
        } else {
          try {
            existing.audio = pc.addTrack(audioTrack, screenStream);
            setupSenderE2ee(socketId, existing.audio);
          } catch {
            // ignore share attach errors
          }
        }
      }
      screenShareSendersRef.current.set(socketId, existing);
    },
    [requestVideoKeyFrame, setupSenderE2ee]
  );

  const removeScreenShareTracks = useCallback(() => {
    screenShareSendersRef.current.forEach((senders, socketId) => {
      const pc = peersRef.current.get(socketId);
      if (!pc) return;
      [senders.video, senders.audio].forEach((sender) => {
        if (!sender) return;
        try {
          pc.removeTrack(sender);
        } catch {
          sender.replaceTrack(null).catch(() => undefined);
        }
      });
    });
    screenShareSendersRef.current.clear();
  }, []);

  const stopScreenShare = useCallback(
    (options?: { notify?: boolean }) => {
      const stream = localScreenStreamRef.current;
      const streamId = stream?.id;
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      localScreenStreamRef.current = null;
      setLocalScreenStream(null);
      removeScreenShareTracks();
      setScreenControlCursor(null);
      const controller = activeScreenControllerRef.current;
      if (controller && socketRef.current && activeRoomRef.current) {
        socketRef.current.emit("call:control:stop", {
          roomId: activeRoomRef.current,
          to: controller.socketId,
        });
      }
      setActiveScreenController(null);
      setScreenControlRequests([]);
      if (options?.notify !== false && streamId && socketRef.current && activeRoomRef.current) {
        socketRef.current.emit("call:screen:stop", {
          roomId: activeRoomRef.current,
          streamId,
        });
      }
    },
    [removeScreenShareTracks]
  );

  const startScreenShare = useCallback(async (options?: { mediaDevices?: MediaDevices | null }) => {
    const mediaDevices = options?.mediaDevices ?? navigator.mediaDevices;
    if (!mediaDevices?.getDisplayMedia) {
      setError("Screen sharing is not supported in this browser.");
      return;
    }
    if (!activeRoomRef.current) {
      setError("Join a call before sharing your screen.");
      return;
    }
    if (localScreenStreamRef.current) return;
    try {
      const videoConstraints: MediaTrackConstraints & {
        cursor?: "always" | "motion" | "never";
      } = {
        frameRate: { ideal: 30, max: 60 },
        cursor: "always",
      };
      const displayOptions: DisplayMediaStreamOptions = {
        video: videoConstraints,
        // Avoid requesting system audio by default (improves reliability and prevents echo).
        audio: false,
      };
      let lastError: Error | null = null;
      const attemptGetDisplayMedia = async (
        params: DisplayMediaStreamOptions
      ): Promise<MediaStream | null> => {
        try {
          return await mediaDevices.getDisplayMedia(params);
        } catch (error) {
          lastError = error as Error;
          const name = lastError?.name;
          if (name === "NotAllowedError" || name === "AbortError") {
            throw lastError;
          }
          return null;
        }
      };
      let stream =
        (await attemptGetDisplayMedia(displayOptions)) ||
        (await attemptGetDisplayMedia({ video: true }));
      if (!stream) {
        throw lastError || new Error("Unable to start screen sharing.");
      }
      const [track] = stream.getVideoTracks();
      if (!track) return;
      if ("contentHint" in track) {
        track.contentHint = "detail";
      }
      track.onended = () => stopScreenShare();
      localScreenStreamRef.current = stream;
      setLocalScreenStream(stream);
      peersRef.current.forEach((pc, socketId) => attachScreenShareTrack(pc, socketId));
      if (socketRef.current && activeRoomRef.current) {
        socketRef.current.emit("call:screen:start", {
          roomId: activeRoomRef.current,
          streamId: stream.id,
        });
      }
      try {
        window.focus();
      } catch {
        // ignore focus errors
      }
    } catch (error) {
      const name = (error as Error)?.name;
      if (name === "NotAllowedError" || name === "AbortError") {
        setError(null);
        return;
      }
      const message = (error as Error)?.message;
      const detail = [name, message].filter(Boolean).join(": ");
      const isDesktop =
        typeof window !== "undefined" && Boolean((window as any).yspDesktop?.isAvailable);
      setError(
        isDesktop && detail
          ? `Unable to start screen sharing (${detail}).`
          : "Unable to start screen sharing."
      );
    }
  }, [attachScreenShareTrack, stopScreenShare]);

  const drawBackdrop = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      width: number,
      height: number,
      mode: VideoCallEffects["background"],
      customUrl?: string
    ) => {
      if (mode === "none") return false;

      const src =
        mode === "ai"
          ? customUrl || ""
          : BACKDROP_ASSETS[mode as keyof typeof BACKDROP_ASSETS];
      if (!src) return false;

      const image = getBackdropImage(src);
      if (!image || !image.complete || !image.naturalWidth) return false;

      const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
      const sw = width / scale;
      const sh = height / scale;
      const sx = (image.naturalWidth - sw) / 2;
      const sy = (image.naturalHeight - sh) / 2;
      ctx.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
      return true;
    },
    []
  );

  const getCameraFilter = useCallback((filter: VideoCallEffects["filter"]) => {
    switch (filter) {
      case "vivid":
        return "contrast(1.3) saturate(1.5) brightness(1.08)";
      case "crisp":
        return "contrast(1.35) saturate(1.15) brightness(1.06)";
      case "cinema":
        return "contrast(1.2) saturate(0.85) brightness(0.95) sepia(0.08)";
      case "matte":
        return "contrast(0.85) saturate(0.9) brightness(1.12)";
      case "soft":
        return "contrast(0.9) saturate(0.85) brightness(1.12)";
      case "neon":
        return "contrast(1.35) saturate(1.8) hue-rotate(25deg)";
      case "sunset":
        return "sepia(0.5) saturate(1.35) hue-rotate(-10deg) brightness(1.05)";
      case "ice":
        return "saturate(1.3) hue-rotate(200deg) brightness(1.08)";
      case "vintage":
        return "sepia(0.45) saturate(0.9) contrast(0.9) brightness(1.05)";
      case "noir":
        return "grayscale(1) contrast(1.35) brightness(0.95)";
      case "warm":
        return "saturate(1.25) sepia(0.35) brightness(1.04)";
      case "cool":
        return "saturate(1.2) hue-rotate(200deg) brightness(1.02)";
      case "amber":
        return "sepia(0.55) saturate(1.2) contrast(1.05) brightness(1.05)";
      case "teal":
        return "hue-rotate(160deg) saturate(1.2) contrast(1.1)";
      case "rose":
        return "hue-rotate(-20deg) saturate(1.3) brightness(1.05)";
      case "midnight":
        return "brightness(0.75) contrast(1.2) saturate(0.8)";
      default:
        return "none";
    }
  }, []);

  const createProcessedVideoTrack = useCallback(
    (rawTrack: MediaStreamTrack, effectsRef: { current: VideoCallEffects }) => {
      const sourceStream = new MediaStream([rawTrack]);
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      video.srcObject = sourceStream;

      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const foregroundCanvas = document.createElement("canvas");
      const foregroundCtx = foregroundCanvas.getContext("2d");
      const maskCanvas = document.createElement("canvas");
      const maskCtx = maskCanvas.getContext("2d");
      const maskScratchCanvas = document.createElement("canvas");
      const maskScratchCtx = maskScratchCanvas.getContext("2d");
      const maskHistoryCanvas = document.createElement("canvas");
      const maskHistoryCtx = maskHistoryCanvas.getContext("2d");
      const avatarMaskCanvas = document.createElement("canvas");
      const avatarMaskCtx = avatarMaskCanvas.getContext("2d", { willReadFrequently: true });
      let rafId = 0;
      let maskSource: CanvasImageSource | null = null;
      let lastSegmentationTs = 0;
      let segmenting = false;
      let segmentationFailed = false;
      let segmentationLoading = false;
      const avatarFrame = { x: 0, y: 0, width: 0, height: 0, valid: false };
      let lastAvatarFrameTs = 0;
      const segmentationIntervalMs = 1000 / 30;
      let segmenter: SelfieSegmentationInstance | null = null;
      let closed = false;
      let faceLandmarker: FaceLandmarkerInstance | null = null;
      let faceLandmarkerLoading = false;
      let lastFaceTs = 0;
      const avatarRig = { mouth: 0, blink: 0, lastSeen: 0 };

      const ensureSegmentation = () => {
        if (segmenter || segmentationFailed || segmentationLoading) return;
        segmentationLoading = true;
        loadSelfieSegmentation()
          .then((SelfieSegmentationCtor) => {
            if (!SelfieSegmentationCtor || closed) {
              segmentationFailed = true;
              return;
            }
            try {
              segmenter = new SelfieSegmentationCtor({
                locateFile: (file) => `${mediapipeBase}/${file}`,
              });
              segmenter.setOptions({ modelSelection: 1, selfieMode: false });
              segmenter.onResults((results) => {
                maskSource = results?.segmentationMask || null;
              });
            } catch {
              segmentationFailed = true;
            }
          })
          .catch(() => {
            segmentationFailed = true;
          })
          .finally(() => {
            segmentationLoading = false;
          });
      };

      const withMirror = (
        context: CanvasRenderingContext2D,
        width: number,
        mirror: boolean,
        draw: () => void
      ) => {
        if (!mirror) {
          draw();
          return;
        }
        context.save();
        context.translate(width, 0);
        context.scale(-1, 1);
        draw();
        context.restore();
      };

      const drawCover = (
        context: CanvasRenderingContext2D,
        width: number,
        height: number,
        mirror: boolean
      ) => {
        const vw = video.videoWidth || width;
        const vh = video.videoHeight || height;
        const scale = Math.max(width / vw, height / vh);
        const sw = width / scale;
        const sh = height / scale;
        const sx = Math.max(0, (vw - sw) / 2);
        const sy = Math.max(0, (vh - sh) / 2);
        withMirror(context, width, mirror, () => {
          context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
        });
      };

      const drawContainImage = (
        context: CanvasRenderingContext2D,
        image: HTMLImageElement,
        bounds: { x: number; y: number; width: number; height: number },
        mirror: boolean,
        canvasWidth: number
      ) => {
        const sourceWidth = image.naturalWidth || bounds.width;
        const sourceHeight = image.naturalHeight || bounds.height;
        if (!sourceWidth || !sourceHeight) return;
        const scale = Math.min(bounds.width / sourceWidth, bounds.height / sourceHeight);
        const dw = sourceWidth * scale;
        const dh = sourceHeight * scale;
        const dx = bounds.x + (bounds.width - dw) / 2;
        const dy = bounds.y + (bounds.height - dh) / 2;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        withMirror(context, canvasWidth, mirror, () => {
          // Use whole-image draw for SVG assets; source-rect draw can crop in some runtimes.
          context.drawImage(image, dx, dy, dw, dh);
        });
      };

      const updateAvatarFrame = (width: number, height: number) => {
        if (!avatarMaskCtx || !maskSource) return;
        const now = performance.now();
        if (now - lastAvatarFrameTs < segmentationIntervalMs) return;
        lastAvatarFrameTs = now;

        const sampleWidth = 96;
        const sampleHeight = Math.max(54, Math.round((sampleWidth * height) / width));
        if (
          avatarMaskCanvas.width !== sampleWidth ||
          avatarMaskCanvas.height !== sampleHeight
        ) {
          avatarMaskCanvas.width = sampleWidth;
          avatarMaskCanvas.height = sampleHeight;
        }
        avatarMaskCtx.clearRect(0, 0, sampleWidth, sampleHeight);
        avatarMaskCtx.drawImage(maskSource, 0, 0, sampleWidth, sampleHeight);

        const data = avatarMaskCtx.getImageData(0, 0, sampleWidth, sampleHeight).data;
        let minX = sampleWidth;
        let minY = sampleHeight;
        let maxX = -1;
        let maxY = -1;
        for (let y = 0; y < sampleHeight; y += 1) {
          for (let x = 0; x < sampleWidth; x += 1) {
            const idx = (y * sampleWidth + x) * 4;
            const alpha = data[idx + 3];
            const intensity = alpha < 255 ? alpha : data[idx];
            if (intensity > 32) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (maxX < 0 || maxY < 0) return;

        const scaleX = width / sampleWidth;
        const scaleY = height / sampleHeight;
        let nextX = minX * scaleX;
        let nextY = minY * scaleY;
        let nextWidth = (maxX - minX + 1) * scaleX;
        let nextHeight = (maxY - minY + 1) * scaleY;

        if (nextWidth < width * 0.15 || nextHeight < height * 0.15) return;

        const expandX = nextWidth * 0.28;
        const expandTop = nextHeight * 0.28;
        const expandBottom = nextHeight * 0.45;
        nextX = Math.max(0, nextX - expandX / 2);
        nextY = Math.max(0, nextY - expandTop);
        nextWidth = Math.min(width - nextX, nextWidth + expandX);
        nextHeight = Math.min(height - nextY, nextHeight + expandTop + expandBottom);

        if (!avatarFrame.valid) {
          avatarFrame.x = nextX;
          avatarFrame.y = nextY;
          avatarFrame.width = nextWidth;
          avatarFrame.height = nextHeight;
          avatarFrame.valid = true;
          return;
        }

        const lerp = (from: number, to: number) => from + (to - from) * 0.25;
        avatarFrame.x = lerp(avatarFrame.x, nextX);
        avatarFrame.y = lerp(avatarFrame.y, nextY);
        avatarFrame.width = lerp(avatarFrame.width, nextWidth);
        avatarFrame.height = lerp(avatarFrame.height, nextHeight);
      };

      const drawAvatarFace = (
        context: CanvasRenderingContext2D,
        bounds: { x: number; y: number; width: number; height: number },
        options: {
          eyeOffsetX: number;
          eyeOffsetY: number;
          eyeSpacing: number;
          eyeSize: number;
          mouthOffsetX: number;
          mouthOffsetY: number;
          mouthSize: number;
          eyeStyle: VideoCallEffects["avatarEyeStyle"];
          mouthStyle: VideoCallEffects["avatarMouthStyle"];
        }
      ) => {
        const mouthOpen = Math.min(1, Math.max(0, avatarRig.mouth || 0));
        const blink = Math.min(1, Math.max(0, avatarRig.blink || 0));
        const safeEyeSize = Math.min(
          1.8,
          Math.max(0.5, Number.isFinite(options.eyeSize) ? options.eyeSize : 1)
        );
        const safeMouthSize = Math.min(
          1.8,
          Math.max(0.5, Number.isFinite(options.mouthSize) ? options.mouthSize : 1)
        );

        const centerX = bounds.x + bounds.width * 0.5 + bounds.width * options.eyeOffsetX;
        const eyeSpacing = bounds.width * 0.18 * options.eyeSpacing;
        const eyeY = bounds.y + bounds.height * (0.34 + options.eyeOffsetY);
        const eyeRadiusX = Math.max(2, bounds.width * 0.055 * safeEyeSize);
        const eyeRadiusY = Math.max(
          1.5,
          bounds.height * 0.03 * safeEyeSize * (1 - blink * 0.9)
        );
        const mouthCenterX = centerX + bounds.width * options.mouthOffsetX;
        const mouthY = bounds.y + bounds.height * (0.58 + options.mouthOffsetY);
        const mouthWidth = bounds.width * 0.26 * safeMouthSize;

        context.save();
        const ink = "rgba(10, 10, 12, 0.85)";
        context.fillStyle = ink;
        context.strokeStyle = ink;
        context.lineWidth = Math.max(1, bounds.width * 0.008);

        const eyeStyle = normalizeAvatarEyeStyle(options.eyeStyle);
        const mouthStyle = normalizeAvatarMouthStyle(options.mouthStyle);
        const leftX = centerX - eyeSpacing;
        const rightX = centerX + eyeSpacing;
        const eyePresets: Record<
          AvatarEyeStyle,
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
            width: 1.02,
            height: 0.74,
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
            width: 1.01,
            height: 0.64,
            upperLift: 0.34,
            lowerLift: 0.03,
            tilt: 0.01,
            irisScale: 0.4,
            pupilScale: 0.2,
            lidAlpha: 0.62,
            irisShift: 0,
          },
          "deep-set": {
            iris: "rgba(62, 74, 82, 0.95)",
            width: 1,
            height: 0.69,
            upperLift: 0.28,
            lowerLift: 0.06,
            tilt: 0.03,
            irisScale: 0.42,
            pupilScale: 0.21,
            lidAlpha: 0.66,
            irisShift: 0,
          },
          monolid: {
            iris: "rgba(74, 84, 62, 0.96)",
            width: 1.03,
            height: 0.58,
            upperLift: 0.4,
            lowerLift: 0.02,
            tilt: 0,
            irisScale: 0.38,
            pupilScale: 0.2,
            lidAlpha: 0.72,
            irisShift: 0,
          },
          "cat-eye": {
            iris: "rgba(56, 76, 66, 0.95)",
            width: 1.04,
            height: 0.66,
            upperLift: 0.3,
            lowerLift: 0.04,
            tilt: 0.17,
            irisScale: 0.4,
            pupilScale: 0.2,
            lidAlpha: 0.7,
            irisShift: 0.15,
          },
          doe: {
            iris: "rgba(98, 74, 48, 0.95)",
            width: 1,
            height: 0.82,
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
            width: 1.08,
            height: 0.54,
            upperLift: 0.42,
            lowerLift: 0.01,
            tilt: 0.05,
            irisScale: 0.34,
            pupilScale: 0.18,
            lidAlpha: 0.75,
            irisShift: 0,
          },
          "bright-hazel": {
            iris: "rgba(112, 90, 42, 0.97)",
            width: 1.01,
            height: 0.72,
            upperLift: 0.2,
            lowerLift: 0.07,
            tilt: 0.02,
            irisScale: 0.45,
            pupilScale: 0.22,
            lidAlpha: 0.58,
            irisShift: 0,
          },
        };
        const eyePreset = eyePresets[eyeStyle];

        if (blink > 0.78 || eyeRadiusY <= 1.2) {
          const half = eyeRadiusX * eyePreset.width;
          context.beginPath();
          context.strokeStyle = `rgba(10, 12, 16, ${Math.min(0.9, eyePreset.lidAlpha + 0.2)})`;
          context.lineWidth = Math.max(1.4, bounds.width * 0.008);
          context.moveTo(leftX - half, eyeY);
          context.lineTo(leftX + half, eyeY);
          context.moveTo(rightX - half, eyeY);
          context.lineTo(rightX + half, eyeY);
          context.stroke();
        } else {
          const drawEye = (x: number, side: -1 | 1) => {
            const eyeWidth = eyeRadiusX * eyePreset.width;
            const eyeHeight = Math.max(1.2, eyeRadiusY * eyePreset.height);
            const topY =
              eyeY - eyeHeight * (1 + eyePreset.upperLift) + eyeHeight * eyePreset.tilt * side;
            const bottomY =
              eyeY +
              eyeHeight * (1 + eyePreset.lowerLift) -
              eyeHeight * eyePreset.tilt * side * 0.4;
            context.save();
            context.beginPath();
            context.moveTo(x - eyeWidth, eyeY);
            context.quadraticCurveTo(x, topY, x + eyeWidth, eyeY);
            context.quadraticCurveTo(x, bottomY, x - eyeWidth, eyeY);
            context.closePath();
            context.fillStyle = "rgba(248, 250, 252, 0.95)";
            context.fill();
            context.strokeStyle = `rgba(15, 23, 42, ${eyePreset.lidAlpha})`;
            context.lineWidth = Math.max(1, bounds.width * 0.007);
            context.stroke();
            context.clip();

            const irisRadius = eyeWidth * eyePreset.irisScale;
            const irisX = x + eyeWidth * eyePreset.irisShift * side;
            context.beginPath();
            context.fillStyle = eyePreset.iris;
            context.ellipse(
              irisX,
              eyeY + eyeHeight * 0.02,
              irisRadius,
              irisRadius * 0.9,
              0,
              0,
              Math.PI * 2
            );
            context.fill();

            const pupilRadius = eyeWidth * eyePreset.pupilScale;
            context.beginPath();
            context.fillStyle = "rgba(7, 10, 14, 0.96)";
            context.ellipse(
              irisX,
              eyeY + eyeHeight * 0.05,
              pupilRadius,
              pupilRadius,
              0,
              0,
              Math.PI * 2
            );
            context.fill();

            context.beginPath();
            context.fillStyle = "rgba(255, 255, 255, 0.86)";
            context.ellipse(
              irisX - irisRadius * 0.34,
              eyeY - irisRadius * 0.28,
              irisRadius * 0.2,
              irisRadius * 0.2,
              0,
              0,
              Math.PI * 2
            );
            context.fill();
            context.restore();

            context.beginPath();
            context.strokeStyle = `rgba(10, 12, 18, ${Math.min(0.88, eyePreset.lidAlpha + 0.2)})`;
            context.lineWidth = Math.max(1.2, bounds.width * 0.007);
            context.moveTo(x - eyeWidth, eyeY);
            context.quadraticCurveTo(x, topY, x + eyeWidth, eyeY);
            context.stroke();
            context.beginPath();
            context.strokeStyle = `rgba(28, 36, 46, ${Math.max(0.28, eyePreset.lidAlpha - 0.18)})`;
            context.lineWidth = Math.max(1, bounds.width * 0.006);
            context.moveTo(x - eyeWidth * 0.85, eyeY + eyeHeight * 0.45);
            context.quadraticCurveTo(
              x,
              bottomY - eyeHeight * 0.08,
              x + eyeWidth * 0.85,
              eyeY + eyeHeight * 0.45
            );
            context.stroke();
          };
          drawEye(leftX, -1);
          drawEye(rightX, 1);
        }

        const mouthPresets: Record<
          AvatarMouthStyle,
          {
            topLip: string;
            lowerLip: string;
            lipLine: string;
            lipShadow: string;
            inner: string;
            teeth: string;
            tongue: string;
            width: number;
            baseOpen: number;
            rigOpen: number;
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
            baseOpen: 0.018,
            rigOpen: 0.08,
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
            baseOpen: 0.02,
            rigOpen: 0.084,
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
            baseOpen: 0.019,
            rigOpen: 0.08,
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
            baseOpen: 0.022,
            rigOpen: 0.088,
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
            baseOpen: 0.017,
            rigOpen: 0.08,
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
            baseOpen: 0.024,
            rigOpen: 0.094,
            smile: 0.22,
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
            baseOpen: 0.021,
            rigOpen: 0.086,
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
            baseOpen: 0.023,
            rigOpen: 0.09,
            smile: 0.1,
            showTeeth: true,
            showTongue: true,
          },
        };
        const mouthPreset = mouthPresets[mouthStyle];
        const mouthHalfWidth = mouthWidth * mouthPreset.width;
        const dynamicOpen = Math.max(
          2,
          bounds.height * (mouthPreset.baseOpen + mouthPreset.rigOpen * mouthOpen) * safeMouthSize
        );
        const smileLift = dynamicOpen * mouthPreset.smile;
        const leftM = mouthCenterX - mouthHalfWidth;
        const rightM = mouthCenterX + mouthHalfWidth;

        context.beginPath();
        context.fillStyle = mouthPreset.topLip;
        context.moveTo(leftM, mouthY);
        context.quadraticCurveTo(
          mouthCenterX,
          mouthY - dynamicOpen * (0.56 + mouthPreset.smile * 0.35),
          rightM,
          mouthY
        );
        context.quadraticCurveTo(
          mouthCenterX,
          mouthY + dynamicOpen * 0.2,
          leftM,
          mouthY
        );
        context.closePath();
        context.fill();

        const leftLower = mouthCenterX - mouthHalfWidth * 0.96;
        const rightLower = mouthCenterX + mouthHalfWidth * 0.96;
        context.beginPath();
        context.fillStyle = mouthPreset.lowerLip;
        context.moveTo(leftLower, mouthY + dynamicOpen * 0.08);
        context.quadraticCurveTo(
          mouthCenterX,
          mouthY + dynamicOpen * (1.12 + mouthPreset.smile * 0.2),
          rightLower,
          mouthY + dynamicOpen * 0.08
        );
        context.quadraticCurveTo(
          mouthCenterX,
          mouthY + dynamicOpen * 0.24,
          leftLower,
          mouthY + dynamicOpen * 0.08
        );
        context.closePath();
        context.fill();

        context.beginPath();
        context.fillStyle = mouthPreset.inner;
        context.ellipse(
          mouthCenterX,
          mouthY + dynamicOpen * (0.36 - mouthPreset.smile * 0.16),
          mouthHalfWidth * 0.82,
          dynamicOpen * 0.92,
          0,
          0,
          Math.PI * 2
        );
        context.fill();

        if (mouthPreset.showTeeth && dynamicOpen > 1.5) {
          const teethWidth = mouthHalfWidth * 1.02;
          const teethHeight = Math.max(1.3, dynamicOpen * 0.34);
          context.fillStyle = mouthPreset.teeth;
          context.fillRect(
            mouthCenterX - teethWidth / 2,
            mouthY - dynamicOpen * 0.02 - smileLift * 0.2,
            teethWidth,
            teethHeight
          );
        }

        if (mouthPreset.showTongue && dynamicOpen > 2) {
          context.beginPath();
          context.fillStyle = mouthPreset.tongue;
          context.ellipse(
            mouthCenterX,
            mouthY + dynamicOpen * 0.85,
            mouthHalfWidth * 0.38,
            Math.max(1.2, dynamicOpen * 0.42),
            0,
            0,
            Math.PI * 2
          );
          context.fill();
        }

        context.beginPath();
        context.strokeStyle = mouthPreset.lipLine;
        context.lineWidth = Math.max(1.8, bounds.width * 0.012);
        context.moveTo(leftM, mouthY);
        context.quadraticCurveTo(
          mouthCenterX,
          mouthY - dynamicOpen * (0.58 + mouthPreset.smile * 0.34),
          rightM,
          mouthY
        );
        context.stroke();

        context.beginPath();
        context.strokeStyle = mouthPreset.lipShadow;
        context.lineWidth = Math.max(1.2, bounds.width * 0.008);
        context.moveTo(mouthCenterX - mouthHalfWidth * 0.9, mouthY + dynamicOpen * 0.5);
        context.quadraticCurveTo(
          mouthCenterX,
          mouthY + dynamicOpen * (1.16 + mouthPreset.smile * 0.2),
          mouthCenterX + mouthHalfWidth * 0.9,
          mouthY + dynamicOpen * 0.5
        );
        context.stroke();

        context.restore();
      };

      const alignBounds = (
        bounds: { x: number; y: number; width: number; height: number },
        offsetX: number,
        offsetY: number,
        scale: number,
        maxWidth: number,
        maxHeight: number
      ) => {
        const boundsWidth = Math.max(1, bounds.width);
        const boundsHeight = Math.max(1, bounds.height);
        const fitScale = Math.min(maxWidth / boundsWidth, maxHeight / boundsHeight);
        const safeScale = Math.min(
          1.6,
          Math.max(0.4, Number.isFinite(scale) ? scale : 1),
          Number.isFinite(fitScale) ? fitScale : 1
        );
        const width = boundsWidth * safeScale;
        const height = boundsHeight * safeScale;
        const dx = bounds.x + (bounds.width - width) / 2 + maxWidth * offsetX * 0.45;
        const dy = bounds.y + (bounds.height - height) / 2 + maxHeight * offsetY * 0.45;
        const x = Math.min(Math.max(dx, 0), Math.max(0, maxWidth - width));
        const y = Math.min(Math.max(dy, 0), Math.max(0, maxHeight - height));
        return { x, y, width, height };
      };

      const maybeSegment = (shouldSegment: boolean) => {
        if (!shouldSegment || !segmenter || segmentationFailed || segmenting) return;
        const now = performance.now();
        if (now - lastSegmentationTs < segmentationIntervalMs) return;
        segmenting = true;
        segmenter
          .send({ image: video })
          .then(() => {
            lastSegmentationTs = now;
          })
          .catch(() => {
            segmentationFailed = true;
          })
          .finally(() => {
            segmenting = false;
          });
      };

      const ensureFaceLandmarker = () => {
        if (faceLandmarker || faceLandmarkerLoading) return;
        faceLandmarkerLoading = true;
        loadFaceLandmarker()
          .then((instance) => {
            if (!instance || closed) return;
            faceLandmarker = instance;
          })
          .finally(() => {
            faceLandmarkerLoading = false;
          });
      };

      const getBlendshapeScore = (
        categories: FaceBlendshapeCategory[] | undefined,
        name: string
      ) => {
        if (!categories) return 0;
        const match = categories.find((entry) => entry.categoryName === name);
        return match ? match.score : 0;
      };

      const updateAvatarRig = () => {
        if (!faceLandmarker) return;
        const now = performance.now();
        if (now - lastFaceTs < 80) return;
        lastFaceTs = now;
        try {
          const result = faceLandmarker.detectForVideo(video, now);
          const blendshapes = result.faceBlendshapes?.[0]?.categories;
          if (!blendshapes || blendshapes.length === 0) {
            avatarRig.mouth = avatarRig.mouth * 0.85;
            avatarRig.blink = avatarRig.blink * 0.85;
            return;
          }
          const jawOpen = getBlendshapeScore(blendshapes, "jawOpen");
          const mouthOpen = getBlendshapeScore(blendshapes, "mouthOpen");
          const mouth = Math.min(1, Math.max(jawOpen, mouthOpen) * 1.2);
          const blinkLeft = getBlendshapeScore(blendshapes, "eyeBlinkLeft");
          const blinkRight = getBlendshapeScore(blendshapes, "eyeBlinkRight");
          const blink = Math.min(1, Math.max(blinkLeft, blinkRight));

          const lerp = (from: number, to: number, speed: number) =>
            from + (to - from) * speed;
          avatarRig.mouth = lerp(avatarRig.mouth, mouth, 0.35);
          avatarRig.blink = lerp(avatarRig.blink, blink, 0.5);
          avatarRig.lastSeen = now;
        } catch {
          // ignore face tracking errors
        }
      };

      const drawFrame = () => {
        if (!ctx) return;
        if (video.readyState < 2) {
          rafId = window.requestAnimationFrame(drawFrame);
          return;
        }
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 360;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        if (foregroundCanvas.width !== width || foregroundCanvas.height !== height) {
          foregroundCanvas.width = width;
          foregroundCanvas.height = height;
        }
        if (maskCanvas.width !== width || maskCanvas.height !== height) {
          maskCanvas.width = width;
          maskCanvas.height = height;
          if (maskCtx) {
            maskCtx.imageSmoothingEnabled = true;
          }
        }
        if (
          maskScratchCanvas.width !== width ||
          maskScratchCanvas.height !== height
        ) {
          maskScratchCanvas.width = width;
          maskScratchCanvas.height = height;
          if (maskScratchCtx) {
            maskScratchCtx.imageSmoothingEnabled = true;
          }
        }
        if (
          maskHistoryCanvas.width !== width ||
          maskHistoryCanvas.height !== height
        ) {
          maskHistoryCanvas.width = width;
          maskHistoryCanvas.height = height;
          if (maskHistoryCtx) {
            maskHistoryCtx.imageSmoothingEnabled = true;
          }
        }

        const effects = effectsRef.current;
        const useAvatar = effects.avatarEnabled && Boolean(effects.avatarImageUrl);
        const maskStrength = Math.min(
          1,
          Math.max(0.2, Number.isFinite(effects.maskStrength) ? effects.maskStrength : 0.85)
        );
        const avatarOffsetX = Math.min(
          0.5,
          Math.max(-0.5, Number.isFinite(effects.avatarOffsetX) ? effects.avatarOffsetX : 0)
        );
        const avatarOffsetY = Math.min(
          0.5,
          Math.max(-0.5, Number.isFinite(effects.avatarOffsetY) ? effects.avatarOffsetY : 0)
        );
        const avatarScale = Math.min(
          1.6,
          Math.max(0.4, Number.isFinite(effects.avatarScale) ? effects.avatarScale : 1)
        );
        const avatarEyeOffsetX = Math.min(
          0.35,
          Math.max(-0.35, Number.isFinite(effects.avatarEyeOffsetX) ? effects.avatarEyeOffsetX : 0)
        );
        const avatarEyeOffsetY = Math.min(
          0.3,
          Math.max(-0.3, Number.isFinite(effects.avatarEyeOffsetY) ? effects.avatarEyeOffsetY : 0)
        );
        const avatarEyeSpacing = Math.min(
          1,
          Math.max(
            0.25,
            Number.isFinite(effects.avatarEyeSpacing) ? effects.avatarEyeSpacing : 0.45
          )
        );
        const avatarEyeSize = Math.min(
          1.8,
          Math.max(0.5, Number.isFinite(effects.avatarEyeSize) ? effects.avatarEyeSize : 1)
        );
        const avatarMouthOffsetX = Math.min(
          0.35,
          Math.max(-0.35, Number.isFinite(effects.avatarMouthOffsetX) ? effects.avatarMouthOffsetX : 0)
        );
        const avatarMouthOffsetY = Math.min(
          0.3,
          Math.max(
            -0.3,
            Number.isFinite(effects.avatarMouthOffsetY) ? effects.avatarMouthOffsetY : -0.08
          )
        );
        const avatarMouthSize = Math.min(
          1.8,
          Math.max(0.5, Number.isFinite(effects.avatarMouthSize) ? effects.avatarMouthSize : 1)
        );
        const avatarEyeStyle = normalizeAvatarEyeStyle(effects.avatarEyeStyle || "almond");
        const avatarMouthStyle = normalizeAvatarMouthStyle(effects.avatarMouthStyle || "natural");
        const needsSegmentation =
          effects.blur || effects.background !== "none" || useAvatar;
        if (needsSegmentation) {
          ensureSegmentation();
        } else {
          maskSource = null;
        }
        let cameraFilter = getCameraFilter(effects.filter);
        const softFocusAmount = Number.isFinite(effects.softFocusAmount)
          ? Math.min(1, Math.max(0, effects.softFocusAmount))
          : 0.35;
        const softFocusPx = effects.softFocus ? softFocusAmount * 4 : 0;
        if (effects.softFocus && softFocusPx > 0.01) {
          const softFocusFilter = `blur(${softFocusPx.toFixed(2)}px)`;
          cameraFilter =
            cameraFilter && cameraFilter !== "none"
              ? `${cameraFilter} ${softFocusFilter}`
              : softFocusFilter;
        }
        const mirror = effects.mirror;
        const maskBlurPx = useAvatar
          ? 0.8
          : effects.blur
            ? 1.6 + (1 - maskStrength) * 2.4
            : 0.8 + (1 - maskStrength) * 1.6;
        const maskShrinkPx = useAvatar ? 0 : Math.round(1 + maskStrength * 6);
        const shouldBlurBackground = effects.blur && effects.background === "none";
        const blurFilter = shouldBlurBackground ? "blur(10px)" : "none";
        const baseFilter = cameraFilter !== "none" ? cameraFilter : "none";

        if (useAvatar) {
          ensureFaceLandmarker();
          updateAvatarRig();
        } else if (avatarRig.mouth > 0 || avatarRig.blink > 0) {
          avatarRig.mouth *= 0.85;
          avatarRig.blink *= 0.85;
        }

        if (!needsSegmentation) {
          ctx.clearRect(0, 0, width, height);
          ctx.filter = cameraFilter;
          drawCover(ctx, width, height, mirror);
          ctx.filter = "none";
          rafId = window.requestAnimationFrame(drawFrame);
          return;
        }

        maybeSegment(needsSegmentation);

        if (!maskSource || !foregroundCtx) {
          ctx.clearRect(0, 0, width, height);
          ctx.filter = baseFilter;
          drawCover(ctx, width, height, mirror);
          ctx.filter = "none";
          rafId = window.requestAnimationFrame(drawFrame);
          return;
        }

        if (maskCtx) {
          const historyAlpha = 0.08 + (1 - maskStrength) * 0.25;
          if (maskScratchCtx) {
            maskScratchCtx.clearRect(0, 0, width, height);
            maskScratchCtx.filter = `blur(${maskBlurPx}px) contrast(${1 + maskStrength})`;
            maskScratchCtx.drawImage(maskSource, 0, 0, width, height);
            maskScratchCtx.filter = "none";
          }

          maskCtx.clearRect(0, 0, width, height);
          if (historyAlpha > 0.001 && maskHistoryCtx) {
            maskCtx.globalAlpha = historyAlpha;
            maskCtx.drawImage(maskHistoryCanvas, 0, 0, width, height);
            maskCtx.globalAlpha = 1;
          }
          if (maskScratchCtx) {
            maskCtx.drawImage(maskScratchCanvas, 0, 0, width, height);
          } else {
            maskCtx.filter = `blur(${maskBlurPx}px) contrast(${1 + maskStrength})`;
            maskCtx.drawImage(maskSource, 0, 0, width, height);
            maskCtx.filter = "none";
          }
          if (maskShrinkPx > 0) {
            const shrinkX = Math.min(maskShrinkPx, width / 2);
            const shrinkY = Math.min(maskShrinkPx, height / 2);
            maskCtx.globalCompositeOperation = "destination-in";
            maskCtx.drawImage(
              maskSource,
              shrinkX,
              shrinkY,
              width - shrinkX * 2,
              height - shrinkY * 2,
              shrinkX,
              shrinkY,
              width - shrinkX * 2,
              height - shrinkY * 2
            );
            maskCtx.globalCompositeOperation = "source-over";
          }
          if (maskHistoryCtx) {
            maskHistoryCtx.clearRect(0, 0, width, height);
            maskHistoryCtx.drawImage(maskCanvas, 0, 0, width, height);
          }
        }

        foregroundCtx.clearRect(0, 0, width, height);
        if (useAvatar) {
          const avatarImage = effects.avatarImageUrl
            ? getBackdropImage(effects.avatarImageUrl)
            : null;
          if (avatarImage && avatarImage.complete && avatarImage.naturalWidth) {
            updateAvatarFrame(width, height);
            const fallbackBounds = {
              x: width * 0.15,
              y: height * 0.05,
              width: width * 0.7,
              height: height * 0.9,
            };
            const presetBounds = {
              x: width * 0.18,
              y: height * 0.04,
              width: width * 0.64,
              height: height * 0.88,
            };
            const trackedAreaRatio = (avatarFrame.width * avatarFrame.height) / (width * height);
            const trackedAspect = avatarFrame.width / Math.max(1, avatarFrame.height);
            const isPresetAvatar = isPresetAvatarSource(effects.avatarImageUrl);
            const canUseTrackedBounds =
              avatarFrame.valid &&
              !isPresetAvatar &&
              trackedAreaRatio >= 0.08 &&
              trackedAreaRatio <= 0.9 &&
              trackedAspect >= 0.28 &&
              trackedAspect <= 1.45;
            const bounds = isPresetAvatar
              ? presetBounds
              : canUseTrackedBounds
              ? {
                  x: avatarFrame.x,
                  y: avatarFrame.y,
                  width: avatarFrame.width,
                  height: avatarFrame.height,
                }
              : fallbackBounds;
            const alignedBounds = alignBounds(
              bounds,
              avatarOffsetX,
              avatarOffsetY,
              avatarScale,
              width,
              height
            );
            foregroundCtx.filter = "none";
            drawContainImage(foregroundCtx, avatarImage, alignedBounds, false, width);
            drawAvatarFace(foregroundCtx, alignedBounds, {
              eyeOffsetX: avatarEyeOffsetX,
              eyeOffsetY: avatarEyeOffsetY,
              eyeSpacing: avatarEyeSpacing,
              eyeSize: avatarEyeSize,
              mouthOffsetX: avatarMouthOffsetX,
              mouthOffsetY: avatarMouthOffsetY,
              mouthSize: avatarMouthSize,
              eyeStyle: avatarEyeStyle,
              mouthStyle: avatarMouthStyle,
            });
          } else {
            foregroundCtx.filter = cameraFilter;
            drawCover(foregroundCtx, width, height, false);
          }
        } else {
          foregroundCtx.filter = cameraFilter;
          drawCover(foregroundCtx, width, height, false);
        }
        foregroundCtx.filter = "none";
        if (!useAvatar) {
          foregroundCtx.globalCompositeOperation = "destination-in";
          if (maskCtx) {
            foregroundCtx.drawImage(maskCanvas, 0, 0, width, height);
          } else {
            foregroundCtx.filter = `blur(${maskBlurPx}px)`;
            foregroundCtx.drawImage(maskSource, 0, 0, width, height);
            foregroundCtx.filter = "none";
          }
          foregroundCtx.globalCompositeOperation = "source-over";
        }

        const drawBackdropFrame = (
          mode: VideoCallEffects["background"],
          customUrl?: string
        ) => {
          let drew = false;
          withMirror(ctx, width, mirror, () => {
            drew = drawBackdrop(ctx, width, height, mode, customUrl);
          });
          return drew;
        };

        if (effects.background !== "none") {
          const drewBackdrop = drawBackdropFrame(
            effects.background,
            effects.backgroundImageUrl
          );
          if (!drewBackdrop) {
            ctx.clearRect(0, 0, width, height);
            ctx.filter = baseFilter;
            drawCover(ctx, width, height, mirror);
            ctx.filter = "none";
          }
        } else {
          ctx.clearRect(0, 0, width, height);
          if (blurFilter !== "none") {
            ctx.filter = `${baseFilter} ${blurFilter}`.trim();
          } else {
            ctx.filter = baseFilter;
          }
          drawCover(ctx, width, height, mirror);
          ctx.filter = "none";
        }

        withMirror(ctx, width, mirror, () => {
          ctx.drawImage(foregroundCanvas, 0, 0, width, height);
        });

        rafId = window.requestAnimationFrame(drawFrame);
      };

      video.play().catch(() => undefined);
      rafId = window.requestAnimationFrame(drawFrame);

      if (!("captureStream" in canvas)) {
        throw new Error("captureStream not supported");
      }
      const capture = canvas.captureStream(30);
      const [track] = capture.getVideoTracks();
      if (track) {
        track.enabled = rawTrack.enabled;
      }

      const cleanup = () => {
        closed = true;
        if (rafId) {
          window.cancelAnimationFrame(rafId);
        }
        capture.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
        segmenter?.close?.();
        segmenter = null;
      };

      return { track, cleanup };
    },
    [drawBackdrop, getCameraFilter]
  );

  const applyHoldState = useCallback((hold: boolean) => {
    holdEnabledRef.current = hold;
    const rawStream = rawStreamRef.current;
    if (!rawStream) return;
    const audioTrack = rawStream.getAudioTracks()[0] || null;
    const videoTrack = rawStream.getVideoTracks()[0] || null;
    if (hold) {
      holdRestoreRef.current = {
        audio: audioTrack?.enabled ?? false,
        video: videoTrack?.enabled ?? false,
      };
    }
    const nextAudio = hold ? false : holdRestoreRef.current.audio;
    const nextVideo = hold ? false : holdRestoreRef.current.video;
    if (audioTrack) {
      audioTrack.enabled = nextAudio;
    }
    if (videoTrack) {
      videoTrack.enabled = nextVideo;
    }
    if (audioProcessingRef.current.track) {
      audioProcessingRef.current.track.enabled = nextAudio;
    }
    if (videoProcessingRef.current.track) {
      videoProcessingRef.current.track.enabled = nextVideo;
    }
    setIsAudioEnabled(nextAudio);
    setIsVideoEnabled(nextVideo);
  }, []);

  const applyVideoEffects = useCallback(() => {
    const rawStream = rawStreamRef.current;
    const rawTrack = rawStream?.getVideoTracks()[0] || null;
    if (!rawTrack) {
      stopVideoProcessing();
      return null;
    }

    const effects = videoEffectsRef.current;
    const hasAvatar = effects.avatarEnabled && Boolean(effects.avatarImageUrl);
    const needsProcessing =
      effects.blur ||
      effects.background !== "none" ||
      effects.filter !== "none" ||
      effects.mirror ||
      hasAvatar;
    if (!needsProcessing) {
      stopVideoProcessing();
      return rawTrack;
    }

    const current = videoProcessingRef.current;
    const effectsKey = buildVideoEffectsKey(effects, hasAvatar);
    if (current.track && current.sourceId === rawTrack.id) {
      current.track.enabled = rawTrack.enabled;
      current.effectsKey = effectsKey;
      return current.track;
    }

    stopVideoProcessing();
    try {
      const { track, cleanup } = createProcessedVideoTrack(rawTrack, videoEffectsRef);
      if (!track) {
        return rawTrack;
      }
      videoProcessingRef.current = {
        track,
        cleanup,
        sourceId: rawTrack.id,
        effectsKey,
      };
      return track;
    } catch {
      stopVideoProcessing();
      return rawTrack;
    }
  }, [createProcessedVideoTrack, status, stopVideoProcessing]);

  const getOutgoingAudioTrack = useCallback(() => {
    const rawTrack = rawStreamRef.current?.getAudioTracks()[0] || null;
    if (!rawTrack) {
      stopAudioProcessing();
      return null;
    }
    const effects = videoEffectsRef.current;
    const hasAvatar = effects.avatarEnabled && Boolean(effects.avatarImageUrl);
    const needsProcessing =
      effects.blur ||
      effects.background !== "none" ||
      effects.filter !== "none" ||
      hasAvatar;
    const needsDelay = needsProcessing && AUDIO_SYNC_DELAY_SEC > 0;
    const wantsVoiceFocus = voiceFocusRef.current;
    if (!wantsVoiceFocus && !needsDelay) {
      stopAudioProcessing();
      return rawTrack;
    }
    const current = audioProcessingRef.current;
    const targetDelay = needsDelay ? AUDIO_SYNC_DELAY_SEC : 0;
    if (
      current.track &&
      current.sourceId === rawTrack.id &&
      current.delaySec === targetDelay &&
      ((wantsVoiceFocus && current.mode === "voice") ||
        (!wantsVoiceFocus && current.mode === "delay"))
    ) {
      current.track.enabled = rawTrack.enabled;
      return current.track;
    }
    stopAudioProcessing();
    try {
      if (wantsVoiceFocus) {
        const { track, cleanup } = createVoiceFocusAudioTrack(rawTrack, targetDelay);
        if (!track) return rawTrack;
        audioProcessingRef.current = {
          track,
          cleanup,
          sourceId: rawTrack.id,
          delaySec: targetDelay,
          mode: "voice",
        };
        return track;
      }
      const { track, cleanup } = createDelayedAudioTrack(rawTrack, targetDelay);
      if (!track) return rawTrack;
      audioProcessingRef.current = {
        track,
        cleanup,
        sourceId: rawTrack.id,
        delaySec: targetDelay,
        mode: "delay",
      };
      return track;
    } catch {
      stopAudioProcessing();
      if (wantsVoiceFocus) {
        setError("Unable to apply voice focus.");
      }
      return rawTrack;
    }
  }, [createDelayedAudioTrack, createVoiceFocusAudioTrack, stopAudioProcessing]);

  const syncLocalStream = useCallback(
    (videoTrack: MediaStreamTrack | null) => {
      const outgoingAudioTrack = getOutgoingAudioTrack();
      const audioTracks = outgoingAudioTrack ? [outgoingAudioTrack] : [];
      if (holdEnabledRef.current) {
        audioTracks.forEach((track) => {
          track.enabled = false;
        });
        if (videoTrack) {
          videoTrack.enabled = false;
        }
      }
      const tracks = [...audioTracks, ...(videoTrack ? [videoTrack] : [])];
      const stream = new MediaStream(tracks);

      setLocalStream(stream);
      localStreamRef.current = stream;

      peersRef.current.forEach((pc, socketId) => {
        audioTracks.forEach((track) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
          if (sender) {
            if (sender.track?.id !== track.id) {
              try {
                void sender.replaceTrack(track).catch(() => undefined);
              } catch {
                // ignore replace failures
              }
            }
            setupSenderE2ee(socketId, sender);
            tuneSenderForLowLatency(sender);
          } else {
            const newSender = pc.addTrack(track, stream);
            setupSenderE2ee(socketId, newSender);
            tuneSenderForLowLatency(newSender);
          }
        });
        const screenSender = screenShareSendersRef.current.get(socketId)?.video;
        const videoSender = pc
          .getSenders()
          .find((s) => s.track?.kind === "video" && s !== screenSender);
        if (videoTrack) {
          if (videoSender) {
            if (videoSender.track?.id !== videoTrack.id) {
              try {
                void videoSender.replaceTrack(videoTrack).catch(() => undefined);
              } catch {
                // ignore replace failures
              }
            }
            setupSenderE2ee(socketId, videoSender);
            tuneSenderForLowLatency(videoSender);
            requestVideoKeyFrame(videoSender);
          } else {
            const newSender = pc.addTrack(videoTrack, stream);
            setupSenderE2ee(socketId, newSender);
            tuneSenderForLowLatency(newSender);
            requestVideoKeyFrame(newSender);
          }
        } else if (videoSender) {
          try {
            videoSender.replaceTrack(null);
          } catch {
            // ignore replace failures
          }
        }
      });
    },
    [requestVideoKeyFrame, setupSenderE2ee]
  );

  const attachLocalTracks = useCallback(
    (pc: RTCPeerConnection, socketId: string) => {
      const stream = localStreamRef.current;
      if (!stream) return;
      const screenTrackIds = new Set(
        localScreenStreamRef.current?.getVideoTracks().map((track) => track.id) ?? []
      );
      stream.getTracks().forEach((track) => {
        const senderByTrack = pc
          .getSenders()
          .find((candidate) => candidate.track?.id === track.id);
        if (senderByTrack) {
          setupSenderE2ee(socketId, senderByTrack);
          if (track.kind === "video") {
            requestVideoKeyFrame(senderByTrack);
          }
          return;
        }
        const senderByKind = pc
          .getSenders()
          .find(
            (candidate) =>
              candidate.track?.kind === track.kind &&
              !screenTrackIds.has(candidate.track?.id || "")
          );
        if (senderByKind) {
          try {
            void senderByKind.replaceTrack(track).catch(() => undefined);
          } catch {
            // ignore replace failures
          }
          setupSenderE2ee(socketId, senderByKind);
          if (track.kind === "video") {
            requestVideoKeyFrame(senderByKind);
          }
          return;
        }
        if (pc.getSenders().some((candidate) => candidate.track?.id === track.id)) {
          return;
        }
        const newSender = pc.addTrack(track, stream);
        setupSenderE2ee(socketId, newSender);
        if (track.kind === "video") {
          requestVideoKeyFrame(newSender);
        }
      });
    },
    [requestVideoKeyFrame, setupSenderE2ee]
  );

  const closePeer = useCallback((socketId: string) => {
    peerE2eeCapableRef.current.delete(socketId);
    pendingIceCandidatesRef.current.delete(socketId);
    const disconnectTimer = disconnectTimersRef.current.get(socketId);
    if (disconnectTimer) {
      window.clearTimeout(disconnectTimer);
      disconnectTimersRef.current.delete(socketId);
    }
    iceRestartAttemptsRef.current.delete(socketId);
    const pc = peersRef.current.get(socketId);
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.onsignalingstatechange = null;
      pc.close();
      peersRef.current.delete(socketId);
    }
    screenShareSendersRef.current.delete(socketId);
    const screenStreamId = screenShareByOwnerRef.current.get(socketId);
    if (screenStreamId) {
      screenShareByOwnerRef.current.delete(socketId);
      screenShareOwnersRef.current.delete(screenStreamId);
    }
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
    setRemoteScreenStreams((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
    setRemoteParticipants((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
    setRemoteHoldStates((prev) => {
      if (!prev[socketId]) return prev;
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
    setScreenControlRequests((prev) =>
      prev.filter((request) => request.socketId !== socketId)
    );
    setPendingScreenControlTargets((prev) => prev.filter((entry) => entry !== socketId));
    if (activeScreenControllerRef.current?.socketId === socketId) {
      setActiveScreenController(null);
      setScreenControlCursor(null);
    }
    if (screenControlTargetRef.current === socketId) {
      setScreenControlTarget(null);
    }
  }, []);

  const clearIceRefreshTimer = useCallback(() => {
    if (iceRefreshTimerRef.current) {
      window.clearTimeout(iceRefreshTimerRef.current);
      iceRefreshTimerRef.current = null;
    }
  }, []);

  const scheduleIceRefresh = useCallback(
    (ttlSeconds: number) => {
      if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) return;
      clearIceRefreshTimer();
      const ttlMs = ttlSeconds * 1000;
      const refreshAt = Date.now() + Math.max(ttlMs * 0.8, ttlMs - 5 * 60 * 1000);
      const delay = Math.max(60_000, refreshAt - Date.now());
      iceRefreshTimerRef.current = window.setTimeout(() => {
        void refreshIceServers("ttl");
      }, delay);
    },
    [clearIceRefreshTimer]
  );

  const requestIceRestart = useCallback(
    async (socketId: string, reason: string, options?: { force?: boolean }) => {
      const pc = peersRef.current.get(socketId);
      const socket = socketRef.current;
      if (!pc || !socket || pc.signalingState === "closed") return false;
      const attempts = iceRestartAttemptsRef.current.get(socketId) ?? {
        count: 0,
        lastAttemptAt: 0,
      };
      const now = Date.now();
      if (!options?.force) {
        if (attempts.count >= 2 && now - attempts.lastAttemptAt < 30_000) {
          return false;
        }
        if (now - attempts.lastAttemptAt < 8000) {
          return false;
        }
      }
      attempts.count = options?.force ? attempts.count : attempts.count + 1;
      attempts.lastAttemptAt = now;
      iceRestartAttemptsRef.current.set(socketId, attempts);

      const negotiationState = getPeerNegotiationState(socketId);
      if (pc.signalingState !== "stable") {
        negotiationState.needsIceRestart = true;
        return false;
      }
      try {
        negotiationState.makingOffer = true;
        const offer = await pc.createOffer({ iceRestart: true });
        await pc.setLocalDescription(offer);
        socket.emit("call:offer", {
          to: socketId,
          sdp: pc.localDescription,
          iceRestart: true,
          reason,
        });
        return true;
      } catch {
        return false;
      } finally {
        negotiationState.makingOffer = false;
      }
    },
    [getPeerNegotiationState]
  );

  const applyIceServersToPeers = useCallback(
    (servers: RTCIceServer[], reason: string) => {
      peersRef.current.forEach((pc, socketId) => {
        try {
          const current = pc.getConfiguration?.() || {};
          pc.setConfiguration({
            ...current,
            iceServers: servers,
          });
        } catch {
          // ignore configuration errors
        }
        void requestIceRestart(socketId, reason, { force: true });
      });
    },
    [requestIceRestart]
  );

  const ensureIceServers = useCallback(
    async (options?: { force?: boolean }) => {
      if (iceServersLoadingRef.current) {
        return iceServersLoadingRef.current;
      }
      const meta = iceServerMetaRef.current;
      if (!options?.force && meta && meta.expiresAt - Date.now() > 5 * 60 * 1000) {
        return {
          servers: rtcConfigRef.current?.iceServers || RTC_CONFIG.iceServers || [],
          ttlSeconds: meta.ttlSeconds,
          updated: false,
        };
      }
      const load = (async () => {
        const hasTurn = (servers: RTCIceServer[]) =>
          servers.some((server) => {
            const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
            return urls.some((url) => {
              const value = String(url || "").toLowerCase();
              return value.startsWith("turn:") || value.startsWith("turns:");
            });
          });
        let ttlSeconds = 0;
        let servers: RTCIceServer[] = RTC_CONFIG.iceServers || [];
        try {
          const res = await api.get("/webrtc/ice");
          const nextServers = res.data?.iceServers ?? res.data?.ice_servers ?? [];
          ttlSeconds = Number(res.data?.ttl) || 0;
          if (Array.isArray(nextServers) && nextServers.length > 0) {
            servers = nextServers;
          }
          rtcConfigRef.current = { ...RTC_CONFIG, iceServers: servers };
          turnAvailableRef.current = hasTurn(servers);
          if (ttlSeconds > 0) {
            iceServerMetaRef.current = {
              expiresAt: Date.now() + ttlSeconds * 1000,
              ttlSeconds,
            };
            scheduleIceRefresh(ttlSeconds);
          }
        } catch {
          rtcConfigRef.current = RTC_CONFIG;
          turnAvailableRef.current = hasTurn(RTC_CONFIG.iceServers || []);
        } finally {
          iceServersLoadingRef.current = null;
        }
        return { servers, ttlSeconds, updated: true };
      })();
      iceServersLoadingRef.current = load;
      return load;
    },
    [scheduleIceRefresh]
  );

  const refreshIceServers = useCallback(
    async (reason: string) => {
      const result = await ensureIceServers({ force: true });
      if (Array.isArray(result?.servers) && result.servers.length > 0) {
        applyIceServersToPeers(result.servers, `ice-refresh:${reason}`);
      }
      return result;
    },
    [applyIceServersToPeers, ensureIceServers]
  );

  const replaceAudioTrack = useCallback(
    (nextTrack: MediaStreamTrack) => {
      const rawStream = rawStreamRef.current ?? new MediaStream();
      rawStream.getAudioTracks().forEach((track) => {
        if (track.id !== nextTrack.id) {
          rawStream.removeTrack(track);
          track.stop();
        }
      });
      if (!rawStream.getAudioTracks().some((track) => track.id === nextTrack.id)) {
        rawStream.addTrack(nextTrack);
      }
      rawStreamRef.current = rawStream;
      setIsAudioEnabled(nextTrack.enabled);
      const videoTrack = applyVideoEffects();
      if (videoTrack) {
        setIsVideoEnabled(videoTrack.enabled);
      }
      syncLocalStream(videoTrack);
    },
    [applyVideoEffects, syncLocalStream]
  );

  const replaceVideoTrack = useCallback(
    (nextTrack: MediaStreamTrack) => {
      const rawStream = rawStreamRef.current ?? new MediaStream();
      rawStream.getVideoTracks().forEach((track) => {
        if (track.id !== nextTrack.id) {
          rawStream.removeTrack(track);
          track.stop();
        }
      });
      if (!rawStream.getVideoTracks().some((track) => track.id === nextTrack.id)) {
        rawStream.addTrack(nextTrack);
      }
      rawStreamRef.current = rawStream;
      setIsVideoEnabled(nextTrack.enabled);
      const videoTrack = applyVideoEffects();
      if (videoTrack) {
        setIsVideoEnabled(videoTrack.enabled);
      }
      syncLocalStream(videoTrack);
    },
    [applyVideoEffects, syncLocalStream]
  );

  const setAudioInputDevice = useCallback(
    async (deviceId: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Media devices are not supported in this browser.");
        return;
      }
      const normalized = deviceId && deviceId !== "default" ? deviceId : "default";
      audioInputDeviceRef.current = normalized === "default" ? null : normalized;
      setSelectedAudioInputId(normalized);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: buildAudioConstraints(
            normalized === "default" ? null : normalized,
            noiseSuppressionRef.current
          ),
          video: false,
        });
        const [track] = stream.getAudioTracks();
        if (!track) return;
        applyTrackHints(track);
        replaceAudioTrack(track);
      } catch {
        setError("Unable to switch microphone.");
      }
    },
    [applyTrackHints, buildAudioConstraints, replaceAudioTrack]
  );

  const setVideoInputDevice = useCallback(
    async (deviceId: string) => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Media devices are not supported in this browser.");
        return;
      }
      const normalized = deviceId && deviceId !== "default" ? deviceId : "default";
      videoInputDeviceRef.current = normalized === "default" ? null : normalized;
      setSelectedVideoInputId(normalized);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: buildVideoConstraints(
            normalized === "default" ? null : normalized,
            lowLatencyModeRef.current
          ),
          audio: false,
        });
        const [track] = stream.getVideoTracks();
        if (!track) return;
        applyTrackHints(track);
        replaceVideoTrack(track);
      } catch {
        setError("Unable to switch camera.");
      }
    },
    [applyTrackHints, buildVideoConstraints, replaceVideoTrack]
  );

  const toggleNoiseSuppression = useCallback(async () => {
    const next = !noiseSuppressionRef.current;
    setNoiseSuppressionEnabled(next);
    if (!navigator.mediaDevices?.getUserMedia) return;
    const rawTrack = rawStreamRef.current?.getAudioTracks()[0] || null;
    if (!rawTrack) return;
    try {
      if (typeof rawTrack.applyConstraints === "function") {
        await rawTrack.applyConstraints(buildAudioConstraints(null, next));
        return;
      }
    } catch {
      // fall back to re-acquiring the track
    }
    try {
      const deviceId = audioInputDeviceRef.current;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: buildAudioConstraints(deviceId, next),
        video: false,
      });
      const [track] = stream.getAudioTracks();
      if (!track) return;
      applyTrackHints(track);
      replaceAudioTrack(track);
    } catch {
      setError("Unable to update noise suppression.");
    }
  }, [applyTrackHints, buildAudioConstraints, replaceAudioTrack]);

  const toggleVoiceFocus = useCallback(() => {
    const next = !voiceFocusRef.current;
    voiceFocusRef.current = next;
    setVoiceFocusEnabled(next);
    if (!rawStreamRef.current) return;
    const videoTrack =
      videoProcessingRef.current.track || rawStreamRef.current?.getVideoTracks()[0] || null;
    syncLocalStream(videoTrack);
  }, [syncLocalStream]);

  const toggleLowLatencyMode = useCallback(async () => {
    const next = !lowLatencyModeRef.current;
    setLowLatencyMode(next);
    const rawTrack = rawStreamRef.current?.getVideoTracks()[0] || null;
    if (rawTrack && typeof rawTrack.applyConstraints === "function") {
      try {
        await rawTrack.applyConstraints(
          buildVideoConstraints(videoInputDeviceRef.current, next)
        );
      } catch {
        // ignore constraint failures
      }
    }
    applyLowLatencyToSenders();
    requestAllVideoKeyFrames();
  }, [applyLowLatencyToSenders, buildVideoConstraints, requestAllVideoKeyFrames]);

  const createPeerConnection = useCallback(
    (socketId: string, options?: { remoteE2eeCapable?: boolean }) => {
      const existing = peersRef.current.get(socketId);
      if (existing) return existing;
      if (typeof options?.remoteE2eeCapable === "boolean") {
        peerE2eeCapableRef.current.set(socketId, options.remoteE2eeCapable);
      }
      // Enable insertable streams at the PeerConnection level whenever supported so we can
      // safely turn per-peer E2EE on/off later without recreating the connection.
      const useInsertableStreams = e2eeSupported;
      const baseConfig = rtcConfigRef.current || RTC_CONFIG;
      const rtcConfig = useInsertableStreams
        ? ({ ...baseConfig, encodedInsertableStreams: true } as RTCConfiguration)
        : baseConfig;
      const pc = new RTCPeerConnection(rtcConfig);
      peersRef.current.set(socketId, pc);
      const negotiationState = getPeerNegotiationState(socketId);
      pc.onnegotiationneeded = async () => {
        if (!socketRef.current) return;
        try {
          negotiationState.makingOffer = true;
          const shouldRestart = Boolean(negotiationState.needsIceRestart);
          const offer = await pc.createOffer(shouldRestart ? { iceRestart: true } : undefined);
          await pc.setLocalDescription(offer);
          negotiationState.needsIceRestart = false;
          socketRef.current.emit("call:offer", {
            to: socketId,
            sdp: pc.localDescription,
            iceRestart: shouldRestart,
          });
        } catch {
          setError("Failed to renegotiate call.");
        } finally {
          negotiationState.makingOffer = false;
        }
      };
      attachLocalTracks(pc, socketId);
      attachScreenShareTrack(pc, socketId);
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit("call:ice", {
            to: socketId,
            candidate: event.candidate,
          });
        }
      };
      pc.ontrack = (event) => {
        try {
          setupReceiverE2ee(socketId, event.receiver);
        } catch {
          // Never break ontrack handling due to E2EE wiring failures.
        }
        const [stream] = event.streams;
        const existingCamera = remoteStreamsRef.current[socketId];
        const existingScreen = remoteScreenStreamsRef.current[socketId];
        const trackLabel = event.track.label?.toLowerCase() || "";
        const looksLikeScreen = ["screen", "window", "display", "monitor"].some((token) =>
          trackLabel.includes(token)
        );
        const streamId = stream?.id || "";
        const shareOwner = streamId
          ? screenShareOwnersRef.current.get(streamId)
          : undefined;
        const isVideoTrack = event.track.kind === "video";
        const shouldTreatAsScreen =
          isVideoTrack &&
          (shareOwner === socketId ||
            looksLikeScreen ||
            (existingScreen && streamId && existingScreen.id === streamId));
        const nextStream =
          stream ||
          (shouldTreatAsScreen ? existingScreen : existingCamera) ||
          new MediaStream([event.track]);
        const resolvedStreamId = streamId || nextStream.id;

        if (shouldTreatAsScreen) {
          screenShareOwnersRef.current.set(resolvedStreamId, socketId);
          screenShareByOwnerRef.current.set(socketId, resolvedStreamId);
          setRemoteScreenStreams((prev) => {
            const existing = prev[socketId];
            if (existing) {
              if (isVideoTrack) {
                existing.getVideoTracks().forEach((track) => {
                  if (track.id !== event.track.id) {
                    existing.removeTrack(track);
                  }
                });
              }
              if (!existing.getTracks().some((track) => track.id === event.track.id)) {
                existing.addTrack(event.track);
              }
              return { ...prev, [socketId]: existing };
            }
            return { ...prev, [socketId]: nextStream };
          });
          event.track.onended = () => {
            screenShareOwnersRef.current.delete(resolvedStreamId);
            screenShareByOwnerRef.current.delete(socketId);
            setRemoteScreenStreams((prev) => {
              const next = { ...prev };
              delete next[socketId];
              return next;
            });
            if (screenControlTargetRef.current === socketId) {
              setScreenControlTarget(null);
            }
            setPendingScreenControlTargets((prev) =>
              prev.filter((entry) => entry !== socketId)
            );
          };
          return;
        }

        setRemoteStreams((prev) => {
          const existing = prev[socketId];
          if (existing) {
            if (isVideoTrack) {
              existing.getVideoTracks().forEach((track) => {
                if (track.id !== event.track.id) {
                  existing.removeTrack(track);
                }
              });
            }
            if (!existing.getTracks().some((track) => track.id === event.track.id)) {
              existing.addTrack(event.track);
            }
            return { ...prev, [socketId]: existing };
          }
          return { ...prev, [socketId]: nextStream };
        });
      };
      pc.onsignalingstatechange = () => {
        if (pc.signalingState !== "stable") return;
        const state = getPeerNegotiationState(socketId);
        if (!state.needsIceRestart) return;
        void requestIceRestart(socketId, "deferred", { force: true });
      };
      pc.onconnectionstatechange = () => {
        const timers = disconnectTimersRef.current;
        if (pc.connectionState === "connected") {
          iceRestartAttemptsRef.current.delete(socketId);
        }
        if (pc.connectionState === "disconnected") {
          void requestIceRestart(socketId, "disconnected");
          if (!timers.has(socketId)) {
            const timer = window.setTimeout(() => {
              timers.delete(socketId);
              if (pc.connectionState === "disconnected") {
                closePeer(socketId);
              }
            }, 25000);
            timers.set(socketId, timer);
          }
          return;
        }
        if (pc.connectionState === "failed") {
          void requestIceRestart(socketId, "failed", { force: true });
          if (!timers.has(socketId)) {
            const timer = window.setTimeout(() => {
              timers.delete(socketId);
              if (pc.connectionState === "failed") {
                closePeer(socketId);
              }
            }, 15000);
            timers.set(socketId, timer);
          }
          return;
        }
        const existingTimer = timers.get(socketId);
        if (existingTimer) {
          window.clearTimeout(existingTimer);
          timers.delete(socketId);
        }
        if (pc.connectionState === "closed") {
          closePeer(socketId);
        }
      };
      return pc;
    },
    [
      attachLocalTracks,
      attachScreenShareTrack,
      closePeer,
      getPeerNegotiationState,
      requestIceRestart,
      setupReceiverE2ee,
      shouldUsePeerE2ee,
    ]
  );

  useEffect(() => {
    localStreamRef.current = localStream;
    peersRef.current.forEach((pc, socketId) => attachLocalTracks(pc, socketId));
  }, [attachLocalTracks, localStream]);

  useEffect(() => {
    peersRef.current.forEach((pc, socketId) => attachScreenShareTrack(pc, socketId));
  }, [attachScreenShareTrack, localScreenStream]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => {
      if (statusRef.current !== "in-call" && statusRef.current !== "connecting") {
        return;
      }
      void refreshIceServers("online");
      peersRef.current.forEach((_, socketId) => {
        void requestIceRestart(socketId, "online", { force: true });
      });
    };
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
    };
  }, [refreshIceServers, requestIceRestart]);

  useEffect(() => {
    errorRef.current = error;
  }, [error]);

  useEffect(() => {
    return () => {
      if (transientErrorTimerRef.current) {
        window.clearTimeout(transientErrorTimerRef.current);
        transientErrorTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    videoEffectsRef.current = videoEffects;
  }, [videoEffects]);

  useEffect(() => {
    activeRoomRef.current = activeRoomId;
  }, [activeRoomId]);

  useEffect(() => {
    localScreenStreamRef.current = localScreenStream;
  }, [localScreenStream]);

  useEffect(() => {
    remoteStreamsRef.current = remoteStreams;
  }, [remoteStreams]);

  useEffect(() => {
    remoteHoldStatesRef.current = remoteHoldStates;
  }, [remoteHoldStates]);

  useEffect(() => {
    remoteScreenStreamsRef.current = remoteScreenStreams;
  }, [remoteScreenStreams]);

  useEffect(() => {
    remoteParticipantsRef.current = remoteParticipants;
  }, [remoteParticipants]);

  useEffect(() => {
    selectedInviteesRef.current = selectedInvitees;
  }, [selectedInvitees]);

  useEffect(() => {
    activeScreenControllerRef.current = activeScreenController;
  }, [activeScreenController]);

  useEffect(() => {
    screenControlTargetRef.current = screenControlTarget;
  }, [screenControlTarget]);

  useEffect(() => {
    screenControlAgentRef.current = screenControlAgentId;
  }, [screenControlAgentId]);

  useEffect(() => {
    if (!user?.id) {
      profileRef.current = null;
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const res = await api.get(`/profiles?filters[user][id][$eq]=${user.id}&populate=avatar`);
        const entry = res.data?.data?.[0];
        const attrs = entry ? normalize(entry) : {};
        let payload = null;
        if (attrs.encryptedProfile) {
          try {
            payload = await decryptOwnProfilePayload(user.id, attrs.encryptedProfile);
          } catch {
            payload = null;
          }
        }
        if (!payload) {
          payload = buildProfilePayloadFromAttrs(attrs);
        }
        const nameFromPayload = `${payload.firstName || ""} ${
          payload.lastName || ""
        }`.trim();
        const displayName = nameFromPayload || attrs.handle || user.email;
        const handle = attrs.handle || "";
        const avatarUrl = pickMediaUrl(attrs.avatar, { kind: "avatar" });
        if (active) {
          profileRef.current = {
            userId: user.id,
            displayName,
            handle,
            avatarUrl,
          };
          if (socketRef.current) {
            void refreshSocketAuth(socketRef.current);
          }
        }
      } catch {
        if (active) {
          profileRef.current = {
            userId: user.id,
            displayName: user.email,
          };
          if (socketRef.current) {
            void refreshSocketAuth(socketRef.current);
          }
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [refreshSocketAuth, user?.email, user?.id]);

  const forceMuteLocalAudio = useCallback(() => {
    const rawStream = rawStreamRef.current;
    const tracks = rawStream?.getAudioTracks() ?? [];
    if (holdEnabledRef.current) {
      holdRestoreRef.current = { ...holdRestoreRef.current, audio: false };
      setIsAudioEnabled(false);
      return;
    }
    if (tracks.length === 0) {
      setIsAudioEnabled(false);
      return;
    }
    tracks.forEach((track) => {
      track.enabled = false;
    });
    const processedTrack = audioProcessingRef.current.track;
    if (processedTrack) {
      processedTrack.enabled = false;
    }
    setIsAudioEnabled(false);
  }, []);

  useEffect(() => {
    if (user?.id) return;
    setOnlineUserIds(new Set());
    setRealtimeStatus("disconnected");
    setRealtimeError(null);
    presenceTargetsRef.current = [];
    reconnectingRef.current = false;
    lastHeartbeatRef.current = 0;
    stopHeartbeat();
    stopAuthRefresh();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
    if (rawStreamRef.current) {
      rawStreamRef.current.getTracks().forEach((track) => track.stop());
      rawStreamRef.current = null;
    }
    if (localScreenStreamRef.current) {
      localScreenStreamRef.current.getTracks().forEach((track) => track.stop());
      localScreenStreamRef.current = null;
      setLocalScreenStream(null);
    }
    setRemoteScreenStreams({});
    setScreenControlRequests([]);
    setPendingScreenControlTargets([]);
    setActiveScreenController(null);
    setScreenControlTarget(null);
    setScreenControlCursor(null);
    stopVideoProcessing();
    resetE2eeState();
  }, [resetE2eeState, stopAuthRefresh, stopHeartbeat, stopVideoProcessing, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setRealtimeStatus("disconnected");
      setRealtimeError(null);
      return;
    }
    if (socketRef.current) return;
    const socketUrl = buildSocketUrl();
    if (!socketUrl) {
      setRealtimeStatus("disconnected");
      setRealtimeError("Realtime server not configured.");
      return;
    }
    setRealtimeStatus("connecting");
    setRealtimeError(null);
    const auth = resolveSocketAuth();
    const socket = io(socketUrl, {
      autoConnect: true,
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 8000,
      timeout: 20000,
      auth,
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      localSocketIdRef.current = socket.id ?? null;
      setRealtimeStatus("connected");
      setRealtimeError(null);
      reconnectingRef.current = false;
      startHeartbeat(socket);
      startAuthRefresh(socket);
      void refreshSocketAuth(socket);
      const reconnectPresenceTargets = presenceTargetsRef.current;
      if (reconnectPresenceTargets.length) {
        socket.emit("presence:subscribe", { userIds: reconnectPresenceTargets });
      }
      if (
        activeRoomRef.current &&
        (statusRef.current === "in-call" || statusRef.current === "connecting")
      ) {
        socket.emit("call:join", {
          roomId: activeRoomRef.current,
          e2eeCapable: e2eeSupported,
        });
        void refreshIceServers("socket-connect");
      }
    });
    socket.on("disconnect", (reason) => {
      localSocketIdRef.current = null;
      setRealtimeStatus("disconnected");
      stopHeartbeat();
      stopAuthRefresh();
      if (reason === "io client disconnect") {
        setRealtimeError(null);
      } else {
        setRealtimeError("Realtime connection lost.");
        reconnectingRef.current = true;
        if (statusRef.current === "in-call" || statusRef.current === "connecting") {
          setStatus("connecting");
        }
      }
    });
    socket.on("connect_error", () => {
      setRealtimeStatus("disconnected");
      setRealtimeError("Unable to reach realtime server.");
      reconnectingRef.current = true;
    });
    const presenceTargets = presenceTargetsRef.current;
    if (presenceTargets.length) {
      socket.emit("presence:subscribe", { userIds: presenceTargets });
    }

    socket.on("presence:state", (payload: { onlineIds?: number[] }) => {
      const onlineIds = Array.isArray(payload?.onlineIds)
        ? payload.onlineIds.filter((id) => Number.isFinite(id))
        : [];
      setOnlineUserIds(new Set(onlineIds));
    });

    socket.on("presence:update", (payload: { userId?: number; online?: boolean }) => {
      const nextId = Number(payload?.userId);
      if (!Number.isFinite(nextId)) return;
      const online = Boolean(payload?.online);
      setOnlineUserIds((prev) => {
        const next = new Set(prev);
        if (online) {
          next.add(nextId);
        } else {
          next.delete(nextId);
        }
        return next;
      });
    });

    socket.on("call:invite", (invite: IncomingCall) => {
      const callStatus = statusRef.current;
      const activeRoom = activeRoomRef.current;
      const isActiveCall = isCallActiveStatus(callStatus);
      if (isActiveCall && activeRoom && invite.roomId === activeRoom) {
        return;
      }
      setIncomingCall(invite);
      if (!isActiveCall) {
        setStatus("incoming");
      }
      setIsOpen(true);
      setError(null);
    });

    socket.on(
      "call:participants",
      (payload: {
        roomId: string;
        participants: VideoCallParticipant[];
        e2eeEnabled?: boolean;
      }) => {
        if (!CALL_E2EE_ENABLED) {
          setCallEncryptionMode(false, "disabled in settings", { suppressBanner: true });
        } else if (payload.e2eeEnabled === false) {
          setCallEncryptionMode(false, "disabled by host");
        } else if (!callEncryptionEnabledRef.current) {
          setCallEncryptionMode(true);
        }
        peerE2eeCapableRef.current.clear();
        payload.participants.forEach((participant) => {
          peerE2eeCapableRef.current.set(
            participant.socketId,
            participant.e2eeCapable === true
          );
        });
        setRemoteParticipants(() =>
          Object.fromEntries(payload.participants.map((p) => [p.socketId, p]))
        );
        setStatus("in-call");
        payload.participants.forEach((participant) => {
          if (peersRef.current.has(participant.socketId)) return;
          createPeerConnection(participant.socketId, {
            remoteE2eeCapable: participant.e2eeCapable === true,
          });
        });
        shareCallKeyWithParticipants(payload.roomId, payload.participants);
        requestAllVideoKeyFrames();
        if (!isCallHostRef.current && !callKeyRef.current) {
          void maybeRequestCallKey(payload.roomId);
        }
      }
    );

    socket.on(
      "call:user-joined",
      (payload: { roomId: string; participant: VideoCallParticipant }) => {
        peerE2eeCapableRef.current.set(
          payload.participant.socketId,
          payload.participant.e2eeCapable === true
        );
        setRemoteParticipants((prev) => ({
          ...prev,
          [payload.participant.socketId]: payload.participant,
        }));
        const screenStream = localScreenStreamRef.current;
        if (screenStream && activeRoomRef.current) {
          socket.emit("call:screen:start", {
            roomId: activeRoomRef.current,
            streamId: screenStream.id,
            to: payload.participant.socketId,
          });
        }
        if (payload?.roomId) {
          void shareCallKeyWithParticipants(payload.roomId, [payload.participant]);
        }
        requestAllVideoKeyFrames();
      }
    );

    socket.on(
      "call:e2ee:key",
      async (payload: {
        roomId: string;
        fromUserId: number;
        encryptedKey: string;
        keyVersion?: number;
        senderPublicKey?: string;
      }) => {
        if (!payload?.roomId || !payload?.encryptedKey || !payload?.fromUserId) return;
        if (payload.roomId !== activeRoomRef.current) return;
        if (!e2eeCryptoSupported || !callEncryptionEnabledRef.current) return;
        try {
          const { privateKey } = await getOrCreateIdentityKeyPair();
          let senderPublicKey: CryptoKey | null = null;
          if (payload.senderPublicKey) {
            senderPublicKey = await importPublicKey(payload.senderPublicKey);
          } else {
            const cache = await fetchUserKeys([payload.fromUserId]);
            const entry = cache.get(payload.fromUserId);
            if (entry?.publicKey) {
              senderPublicKey = await importPublicKey(entry.publicKey);
            }
          }
          if (!senderPublicKey) {
            throw new Error("Missing sender key");
          }
          const sharedKey = await deriveSharedKey(privateKey, senderPublicKey);
          const callKey = await decryptWrappedKey(sharedKey, payload.encryptedKey);
           callKeyRef.current = callKey;
           callKeyRoomRef.current = payload.roomId;
           missingCallKeySinceRef.current = null;
           setError(null);
           setE2eeDebug(null);
           requestAllVideoKeyFrames();
           void flushPendingEncryptedChatInbox(payload.roomId, callKey);
           void flushPendingEncryptedChatOutbox(payload.roomId, callKey);
         } catch (err) {
           const detail = err instanceof Error ? err.message : "Key decrypt failed";
           setE2eeDebug(`E2EE: ${detail}`);
           setError(null);
          void maybeRequestCallKey(payload.roomId);
        }
      }
    );

    socket.on(
      "call:e2ee:request",
      async (payload: { roomId: string; fromUserId: number; publicKey: string }) => {
        if (!payload?.roomId || !payload?.fromUserId || !payload?.publicKey) return;
        if (payload.roomId !== activeRoomRef.current) return;
        if (!isCallHostRef.current) return;
        if (!callEncryptionEnabledRef.current) return;
        await shareCallKeyWithPublicKey(
          payload.roomId,
          payload.fromUserId,
          payload.publicKey
        );
      }
    );

    socket.on(
      "call:e2ee:mode",
      (payload: { roomId: string; enabled: boolean }) => {
        if (!payload?.roomId || payload.roomId !== activeRoomRef.current) return;
        if (!CALL_E2EE_ENABLED) {
          setCallEncryptionMode(false, "disabled in settings", { suppressBanner: true });
          return;
        }
        if (!payload.enabled) {
          if (!callEncryptionEnabledRef.current) return;
          setCallEncryptionMode(false, "disabled by host");
          return;
        }
        if (callEncryptionEnabledRef.current) return;
        setCallEncryptionMode(true);
      }
    );

    socket.on("call:user-left", (payload: { socketId: string }) => {
      peerE2eeCapableRef.current.delete(payload.socketId);
      closePeer(payload.socketId);
    });

    socket.on(
      "call:offer",
      async (payload: {
        from: string;
        sdp: RTCSessionDescriptionInit;
        userId?: number;
        displayName?: string;
        handle?: string;
        avatarUrl?: string;
        e2eeCapable?: boolean;
      }) => {
        try {
          if (typeof payload.e2eeCapable === "boolean") {
            peerE2eeCapableRef.current.set(payload.from, payload.e2eeCapable);
          }
          setRemoteParticipants((prev) => {
            if (prev[payload.from]) return prev;
            return {
              ...prev,
              [payload.from]: {
                socketId: payload.from,
                userId: Number(payload.userId) || 0,
                displayName: payload.displayName || payload.handle || "Friend",
                handle: payload.handle,
                avatarUrl: payload.avatarUrl,
                e2eeCapable: payload.e2eeCapable,
              },
            };
          });
          const pc = createPeerConnection(
            payload.from,
            typeof payload.e2eeCapable === "boolean"
              ? { remoteE2eeCapable: payload.e2eeCapable }
              : undefined
          );
          const negotiationState = getPeerNegotiationState(payload.from);
          const offerCollision =
            payload.sdp?.type === "offer" &&
            (negotiationState.makingOffer || pc.signalingState !== "stable");
          const ignoreOffer = !negotiationState.isPolite && offerCollision;
          if (ignoreOffer) return;
          if (offerCollision && negotiationState.isPolite) {
            await pc.setLocalDescription({ type: "rollback" });
          }
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          await flushQueuedIceCandidates(payload.from, pc);
          if (payload.sdp?.type === "offer") {
            await pc.setLocalDescription();
            socket.emit("call:answer", { to: payload.from, sdp: pc.localDescription });
          }
        } catch {
          setError("Failed to respond to call offer.");
        }
      }
    );

    socket.on("call:answer", async (payload: { from: string; sdp: RTCSessionDescriptionInit }) => {
      const pc = peersRef.current.get(payload.from);
      if (!pc) return;
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
        await flushQueuedIceCandidates(payload.from, pc);
      } catch {
        setError("Failed to finalize call connection.");
      }
    });

    socket.on("call:ice", async (payload: { from: string; candidate: RTCIceCandidateInit }) => {
      if (!payload?.from || !payload?.candidate) return;
      const pc = peersRef.current.get(payload.from);
      if (!pc) {
        queueIceCandidate(payload.from, payload.candidate);
        return;
      }
      if (!pc.remoteDescription) {
        queueIceCandidate(payload.from, payload.candidate);
        return;
      }
      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch {
        // If SDP isn't fully applied yet, keep the candidate around for a later flush.
        queueIceCandidate(payload.from, payload.candidate);
      }
    });

    socket.on("call:chat", (payload: VideoCallChatWirePayload) => {
      if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
      const localUserId = Number(user?.id) || 0;
      const appendMessage = (
        next: Omit<VideoCallMessage, "id">,
        options?: { id?: string }
      ): string | null => {
        const now = Date.now();
        localChatEchoRef.current.forEach((value, key) => {
          if (now - value > LOCAL_CHAT_DEDUPE_WINDOW_MS) {
            localChatEchoRef.current.delete(key);
          }
        });
        if (localUserId > 0 && Number(next.from.userId) === localUserId) {
          const signature = buildChatMessageSignature({
            userId: localUserId,
            kind: next.kind,
            body: String(next.body || ""),
            gifUrl: String(next.gifUrl || ""),
          });
          const echoedAt = localChatEchoRef.current.get(signature);
          if (echoedAt && now - echoedAt <= LOCAL_CHAT_DEDUPE_WINDOW_MS) {
            localChatEchoRef.current.delete(signature);
            return null;
          }
        }
        const resolvedId = options?.id || createMessageId();
        setMessages((prev) => [...prev, { ...next, id: resolvedId }]);
        return resolvedId;
      };
      const baseFrom = {
        userId: Number(payload?.from?.userId) || 0,
        displayName: String(payload?.from?.displayName || payload?.from?.handle || "Friend"),
        handle: payload?.from?.handle,
        avatarUrl: payload?.from?.avatarUrl,
      };
      const at = payload?.at || new Date().toISOString();

      if (typeof payload?.encryptedMessage === "string" && payload.encryptedMessage.trim()) {
        const activeKey = callKeyRef.current;
        const roomId = String(payload?.roomId || activeRoomRef.current || "").trim();
        if (!activeKey) {
          if (callEncryptionEnabledRef.current) {
            // If this is our own message echo (server broadcasts to everyone), rely on local echo.
            if (localUserId > 0 && Number(baseFrom.userId) === localUserId) return;
            void maybeRequestCallKey(roomId || undefined);
            const pendingId = createMessageId();
            pendingEncryptedChatInboxRef.current.set(pendingId, {
              roomId,
              encryptedMessage: payload.encryptedMessage.trim(),
            });
            appendMessage(
              {
                body: "[Decrypting message...]",
                kind: "text",
                gifUrl: "",
                from: baseFrom,
                at,
              },
              { id: pendingId }
            );
            return;
          }
          appendMessage({
            body: "[Encrypted message]",
            kind: "text",
            gifUrl: "",
            from: baseFrom,
            at,
          });
          return;
        }
        void decryptJson<VideoCallChatEnvelope>(activeKey, payload.encryptedMessage.trim())
          .then((decrypted) => {
            const nextKind =
            decrypted?.kind === "emoji" ||
            decrypted?.kind === "gif" ||
            decrypted?.kind === "image"
              ? decrypted.kind
              : "text";
            appendMessage({
              body: String(decrypted?.body || ""),
              kind: nextKind,
              gifUrl: String(decrypted?.gifUrl || ""),
              from: baseFrom,
              at,
            });
          })
          .catch(() => {
            appendMessage({
              body: "[Unable to decrypt message]",
              kind: "text",
              gifUrl: "",
              from: baseFrom,
              at,
            });
          });
        return;
      }

      const nextKind =
        payload?.kind === "emoji" ||
        payload?.kind === "gif" ||
        payload?.kind === "image"
          ? payload.kind
          : "text";
      appendMessage({
        body: String(payload?.body || ""),
        kind: nextKind,
        gifUrl: String(payload?.gifUrl || ""),
        from: baseFrom,
        at,
      });
    });

    socket.on(
      "call:hold",
      (payload: { roomId: string; from: string; hold: boolean }) => {
        if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
        if (!payload?.from) return;
        const localId = localSocketIdRef.current || socket.id;
        if (payload.from === localId) return;
        setRemoteHoldStates((prev) => {
          if (!payload.hold) {
            if (!prev[payload.from]) return prev;
            const next = { ...prev };
            delete next[payload.from];
            return next;
          }
          if (prev[payload.from]) return prev;
          return { ...prev, [payload.from]: true };
        });
      }
    );

    socket.on(
      "call:screen:start",
      (payload: { roomId: string; streamId: string; from: string }) => {
        if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
        if (!payload?.streamId || !payload?.from) return;
        screenShareOwnersRef.current.set(payload.streamId, payload.from);
        screenShareByOwnerRef.current.set(payload.from, payload.streamId);
        const existingCamera = remoteStreamsRef.current[payload.from];
        if (existingCamera && existingCamera.id === payload.streamId) {
          setRemoteStreams((prev) => {
            const next = { ...prev };
            delete next[payload.from];
            return next;
          });
          setRemoteScreenStreams((prev) => ({
            ...prev,
            [payload.from]: existingCamera,
          }));
        }
      }
    );

    socket.on(
      "call:screen:stop",
      (payload: { roomId: string; streamId: string; from?: string }) => {
        if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
        if (!payload?.streamId) return;
        const owner =
          payload.from || screenShareOwnersRef.current.get(payload.streamId) || "";
        if (owner) {
          screenShareByOwnerRef.current.delete(owner);
        }
        screenShareOwnersRef.current.delete(payload.streamId);
        if (owner) {
          setRemoteScreenStreams((prev) => {
            const next = { ...prev };
            delete next[owner];
            return next;
          });
          if (screenControlTargetRef.current === owner) {
            setScreenControlTarget(null);
            setScreenControlAgentId(null);
          }
          setPendingScreenControlTargets((prev) => prev.filter((entry) => entry !== owner));
        }
      }
    );

    socket.on(
      "call:mute-all",
      (payload: { roomId: string; from?: string }) => {
        if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
        forceMuteLocalAudio();
      }
    );

    socket.on(
      "call:screen:stop-all",
      (payload: { roomId: string; from?: string }) => {
        if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
        if (!localScreenStreamRef.current) return;
        stopScreenShare();
      }
    );

    socket.on(
      "call:control:request",
      (payload: {
        roomId: string;
        from: string;
        userId?: number;
        displayName?: string;
        handle?: string;
        avatarUrl?: string;
      }) => {
        if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
        if (!payload?.from) return;
        if (!localScreenStreamRef.current) {
          if (socketRef.current && activeRoomRef.current) {
            socketRef.current.emit("call:control:deny", {
              roomId: activeRoomRef.current,
              to: payload.from,
            });
          }
          return;
        }
        setScreenControlRequests((prev) => {
          if (prev.some((entry) => entry.socketId === payload.from)) return prev;
          return [
            ...prev,
            {
              socketId: payload.from,
              userId: Number(payload.userId) || 0,
              displayName: payload.displayName || payload.handle || "Friend",
              handle: payload.handle,
              avatarUrl: payload.avatarUrl,
            },
          ];
        });
      }
    );

    socket.on(
      "call:control:grant",
      (payload: { roomId: string; from: string; controlAgentId?: string }) => {
        if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
        if (!payload?.from) return;
        setScreenControlTarget(payload.from);
        setScreenControlAgentId(payload.controlAgentId || null);
        setPendingScreenControlTargets((prev) =>
          prev.filter((entry) => entry !== payload.from)
        );
      }
    );

    socket.on(
      "call:control:deny",
      (payload: { roomId: string; from: string }) => {
        if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
        if (!payload?.from) return;
        setPendingScreenControlTargets((prev) =>
          prev.filter((entry) => entry !== payload.from)
        );
      }
    );

    socket.on(
      "call:control:stop",
      (payload: { roomId: string; from: string }) => {
        if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
        if (!payload?.from) return;
        if (screenControlTargetRef.current === payload.from) {
          setScreenControlTarget(null);
          setScreenControlAgentId(null);
        }
        if (activeScreenControllerRef.current?.socketId === payload.from) {
          setActiveScreenController(null);
          setScreenControlCursor(null);
        }
      }
    );

    socket.on(
      "call:control:event",
      (payload: { roomId: string; from: string; event: ScreenControlEvent }) => {
        if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
        if (!payload?.from || !payload?.event) return;
        if (activeScreenControllerRef.current?.socketId !== payload.from) return;
        if (payload.event.type === "key") {
          applyScreenControlEvent(payload.event);
          return;
        }
        const x = Math.min(1, Math.max(0, Number(payload.event.x)));
        const y = Math.min(1, Math.max(0, Number(payload.event.y)));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const normalizedEvent = { ...payload.event, x, y };
        const kind = normalizedEvent.type === "click" ? "click" : "move";
        const button =
          normalizedEvent.button === "right"
            ? "right"
            : kind === "click"
            ? "left"
            : undefined;
        setScreenControlCursor({
          x,
          y,
          from: payload.from,
          at: Date.now(),
          kind,
          button,
        });
        applyScreenControlEvent(normalizedEvent);
      }
    );

    socket.on("call:declined", (payload: { roomId: string; from: VideoCallInvitee }) => {
      if (payload?.roomId !== activeRoomRef.current) return;
      const from = payload.from;
      const fromId = from?.userId;
      const inviteeMatch = fromId
        ? selectedInviteesRef.current.find((entry) => entry.userId === fromId)
        : undefined;
      const participantMatch = fromId
        ? Object.values(remoteParticipantsRef.current).find(
            (entry) => entry.userId === fromId
          )
        : undefined;
      const candidate =
        inviteeMatch?.displayName ||
        participantMatch?.displayName ||
        from?.displayName ||
        from?.handle ||
        "Someone";
      const normalized =
        candidate && !candidate.includes("@") ? candidate : from?.handle || "Someone";
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          body: `${normalized} declined the call.`,
          kind: "text",
          from: {
            userId: from.userId,
            displayName: normalized,
            handle: from.handle,
            avatarUrl: from.avatarUrl,
          },
          at: new Date().toISOString(),
        },
      ]);
    });

    socket.on("call:error", (payload: { roomId: string; message: string }) => {
      if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
      setError(payload?.message || "Call error");
      setStatus("setup");
    });

    socket.on("call:ended", (payload: { roomId?: string }) => {
      if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
      cleanupCallRef.current();
    });

    socket.on(
      "call:removed",
      (payload: {
        roomId?: string;
        by?: { userId?: number; displayName?: string; handle?: string };
      }) => {
        if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
        const byName =
          payload?.by?.displayName ||
          payload?.by?.handle ||
          (Number.isFinite(payload?.by?.userId) ? `User ${payload?.by?.userId}` : "the host");
        cleanupCallRef.current();
        setStatus("setup");
        setIsOpen(true);
        setError(`You were removed from the call by ${byName}.`);
      }
    );

    return () => {
      stopHeartbeat();
      stopAuthRefresh();
      socket.disconnect();
      socketRef.current = null;
      setOnlineUserIds(new Set());
    };
  }, [
    applyScreenControlEvent,
    closePeer,
    createPeerConnection,
    e2eeSupported,
    getPeerNegotiationState,
    maybeRequestCallKey,
    requestAllVideoKeyFrames,
    setCallEncryptionMode,
    shareCallKeyWithParticipants,
    shareCallKeyWithPublicKey,
    forceMuteLocalAudio,
    stopScreenShare,
    resolveSocketAuth,
    refreshSocketAuth,
    refreshIceServers,
    startAuthRefresh,
    startHeartbeat,
    stopAuthRefresh,
    stopHeartbeat,
    user?.email,
    user?.id,
  ]);

  useEffect(() => {
    clearCallTimeout();
    if (status === "incoming" && incomingCall) {
      callTimeoutRef.current = window.setTimeout(() => {
        if (statusRef.current !== "incoming") return;
        const invite = incomingCallRef.current;
        if (socketRef.current && invite) {
          socketRef.current.emit("call:decline", { roomId: invite.roomId });
        }
        setIncomingCall(null);
        setStatus("idle");
        setIsOpen(false);
      }, CALL_CONNECT_TIMEOUT_MS);
      return () => clearCallTimeout();
    }

    if (incomingCall && isCallActiveStatus(status)) {
      callTimeoutRef.current = window.setTimeout(() => {
        const invite = incomingCallRef.current;
        if (!invite || !isCallActiveStatus(statusRef.current)) return;
        if (socketRef.current) {
          socketRef.current.emit("call:decline", { roomId: invite.roomId });
        }
        setIncomingCall(null);
      }, CALL_CONNECT_TIMEOUT_MS);
      return () => clearCallTimeout();
    }

    if (status === "connecting" && isCallHostRef.current) {
      callTimeoutRef.current = window.setTimeout(() => {
        if (statusRef.current !== "connecting" || !isCallHostRef.current) return;
        if (socketRef.current && activeRoomRef.current) {
          socketRef.current.emit("call:end", { roomId: activeRoomRef.current });
        }
        cleanupCallRef.current();
      }, CALL_CONNECT_TIMEOUT_MS);
      return () => clearCallTimeout();
    }

    return () => clearCallTimeout();
  }, [clearCallTimeout, incomingCall, status]);

  const ensureMedia = useCallback(
    async ({ audio, video }: { audio?: boolean; video?: boolean }) => {
      const existingRaw = rawStreamRef.current ?? new MediaStream();
      const needsAudio = Boolean(audio && existingRaw.getAudioTracks().length === 0);
      const needsVideo = Boolean(video && existingRaw.getVideoTracks().length === 0);

      if (!needsAudio && !needsVideo) {
        const videoTrack = applyVideoEffects();
        syncLocalStream(videoTrack);
        return localStreamRef.current;
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setError("Media devices are not supported in this browser.");
        throw new Error("media not supported");
      }

      const audioDeviceId = audioInputDeviceRef.current;
      const audioConstraint = needsAudio
        ? buildAudioConstraints(audioDeviceId, noiseSuppressionRef.current)
        : false;

      const videoDeviceId = videoInputDeviceRef.current;
      const videoConstraint = needsVideo
        ? buildVideoConstraints(videoDeviceId, lowLatencyModeRef.current)
        : false;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraint,
        video: videoConstraint,
      });
      stream.getTracks().forEach((track) => {
        applyTrackHints(track);
        if (!existingRaw.getTracks().some((t) => t.id === track.id)) {
          existingRaw.addTrack(track);
        }
      });
      rawStreamRef.current = existingRaw;

      const audioTracks = existingRaw.getAudioTracks();
      if (audioTracks[0]) {
        setIsAudioEnabled(audioTracks[0].enabled);
      } else {
        setIsAudioEnabled(false);
      }

      const videoTrack = applyVideoEffects();
      if (videoTrack) {
        setIsVideoEnabled(videoTrack.enabled);
      } else {
        setIsVideoEnabled(false);
      }
      syncLocalStream(videoTrack);

      return localStreamRef.current;
    },
    [
      applyTrackHints,
      applyVideoEffects,
      buildAudioConstraints,
      buildVideoConstraints,
      syncLocalStream,
    ]
  );

  const ensureCallMedia = useCallback(async () => {
    try {
      return await ensureMedia({ audio: true, video: true });
    } catch {
      try {
        return await ensureMedia({ audio: false, video: true });
      } catch {
        try {
          return await ensureMedia({ audio: true, video: false });
        } catch (err) {
          setError(
            "Please allow microphone or camera access to join the call. If this is your first time, check browser permissions and use HTTPS (or localhost)."
          );
          throw err;
        }
      }
    }
  }, [ensureMedia]);

  useEffect(() => {
    if (!rawStreamRef.current) return;
    const videoTrack = applyVideoEffects();
    if (videoTrack) {
      setIsVideoEnabled(videoTrack.enabled);
    } else {
      setIsVideoEnabled(false);
    }
    syncLocalStream(videoTrack);
  }, [applyVideoEffects, syncLocalStream, videoEffects]);

  const setPresenceTargets = useCallback((userIds: number[]) => {
    const normalized = Array.from(
      new Set(userIds.filter((id) => Number.isFinite(id) && id > 0))
    ).sort((a, b) => a - b);
    const current = presenceTargetsRef.current;
    if (
      current.length === normalized.length &&
      current.every((id, index) => id === normalized[index])
    ) {
      return;
    }
    presenceTargetsRef.current = normalized;
    setOnlineUserIds((prev) => {
      if (!normalized.length) return new Set();
      const next = new Set<number>();
      normalized.forEach((id) => {
        if (prev.has(id)) next.add(id);
      });
      return next;
    });
    if (socketRef.current) {
      socketRef.current.emit("presence:subscribe", { userIds: normalized });
    }
  }, []);

  const resetCallState = useCallback(() => {
    setActiveRoomId(null);
    setMessages([]);
    localChatEchoRef.current.clear();
    setRemoteParticipants({});
    setRemoteStreams({});
    setRemoteScreenStreams({});
    setIncomingCall(null);
    setLocalScreenStream(null);
    setStatus("idle");
    setIsOpen(false);
    setError(null);
    setIsCallHost(false);
    setE2eeDebug(null);
    setIsHolding(false);
    setRemoteHoldStates({});
    holdEnabledRef.current = false;
    holdRestoreRef.current = { audio: true, video: true };
    setScreenControlRequests([]);
    setPendingScreenControlTargets([]);
    setActiveScreenController(null);
    setScreenControlTarget(null);
    setScreenControlAgentId(null);
    setScreenControlCursor(null);
  }, []);

  const cleanupCall = useCallback(() => {
    peersRef.current.forEach((_, socketId) => closePeer(socketId));
    peersRef.current.clear();
    iceRestartAttemptsRef.current.clear();
    clearIceRefreshTimer();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (rawStreamRef.current) {
      rawStreamRef.current.getTracks().forEach((track) => track.stop());
      rawStreamRef.current = null;
    }
    stopScreenShare({ notify: false });
    screenShareOwnersRef.current.clear();
    screenShareByOwnerRef.current.clear();
    screenShareSendersRef.current.clear();
    peerNegotiationRef.current.clear();
    stopAudioProcessing();
    stopVideoProcessing();
    setLocalStream(null);
    localStreamRef.current = null;
    resetE2eeState();
    resetCallState();
  }, [
    closePeer,
    clearIceRefreshTimer,
    resetCallState,
    resetE2eeState,
    stopAudioProcessing,
    stopScreenShare,
    stopVideoProcessing,
  ]);

  cleanupCallRef.current = cleanupCall;

  useEffect(() => {
    if (status === "idle") {
      hadRemoteParticipantsRef.current = false;
      return;
    }
    const remoteCount = Object.keys(remoteParticipants).length;
    if (remoteCount > 0) {
      hadRemoteParticipantsRef.current = true;
      return;
    }
    if (!hadRemoteParticipantsRef.current) return;
    if (status !== "in-call" && status !== "connecting") return;
    hadRemoteParticipantsRef.current = false;
    cleanupCall();
  }, [cleanupCall, remoteParticipants, status]);

  const closeCallComposer = useCallback(() => {
    if (status === "in-call" || status === "connecting") return;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setLocalStream(null);
    }
    if (rawStreamRef.current) {
      rawStreamRef.current.getTracks().forEach((track) => track.stop());
      rawStreamRef.current = null;
    }
    stopScreenShare({ notify: false });
    stopVideoProcessing();
    resetE2eeState();
    resetCallState();
  }, [resetCallState, resetE2eeState, status, stopScreenShare, stopVideoProcessing]);

  const setSelectedInvitees = useCallback((invitees: VideoCallInvitee[]) => {
    setSelectedInviteesState(invitees);
  }, []);

  const startCall = useCallback(async (invitees?: VideoCallInvitee[]) => {
    if (!socketRef.current || !user?.id) return;
    const targetInvitees = invitees ?? selectedInvitees;
    if (targetInvitees.length > MAX_VIDEO_PARTICIPANTS - 1) {
      setError(`Max ${MAX_VIDEO_PARTICIPANTS} participants per call.`);
      return;
    }
    setError(null);
    setStatus("connecting");
    setIsOpen(true);
    const roomId = createRoomId();
    resetE2eeState();
    isCallHostRef.current = true;
    setIsCallHost(true);
    if (!CALL_E2EE_ENABLED) {
      setCallEncryptionMode(false, "disabled in settings", { suppressBanner: true });
    } else {
      setCallEncryptionMode(true);
    }
    if (callEncryptionEnabledRef.current) {
      callKeyRoomRef.current = roomId;
      try {
        callKeyRef.current = await generateCallKey();
      } catch (err) {
        const detail = err instanceof Error ? err.message : "Failed to generate call key";
        setCallEncryptionMode(false, detail);
      }
    } else {
      callKeyRoomRef.current = null;
    }
    setActiveRoomId(roomId);
    try {
      await ensureCallMedia();
    } catch {
      resetE2eeState();
      setStatus("setup");
      return;
    }
    await ensureIceServers({ force: true });
    warnIfNoTurn();
    socketRef.current.emit("call:join", { roomId, e2eeCapable: e2eeSupported });
    const hostIdentity = resolveLocalIdentity();
    socketRef.current.emit("call:invite", {
      roomId,
      invitees: targetInvitees.map((invitee) => invitee.userId),
      e2eeEnabled: callEncryptionEnabledRef.current,
      hostName: hostIdentity.displayName,
      hostHandle: hostIdentity.handle,
      hostAvatar: hostIdentity.avatarUrl,
    });
  }, [
    e2eeSupported,
    ensureCallMedia,
    ensureIceServers,
    resetE2eeState,
    resolveLocalIdentity,
    selectedInvitees,
    setCallEncryptionMode,
    user?.id,
    warnIfNoTurn,
  ]);

  const openCallComposer = useCallback(
    (invitees?: VideoCallInvitee[]) => {
      if (status === "in-call" || status === "connecting") return;
      const nextInvitees = invitees || [];
      setSelectedInviteesState(nextInvitees);
      setError(null);
      if (nextInvitees.length > 0) {
        void startCall(nextInvitees);
        return;
      }
      setStatus("setup");
      setIsOpen(true);
      void ensureMedia({ video: true }).catch(() => undefined);
    },
    [ensureMedia, startCall, status]
  );

  const acceptCall = useCallback(async () => {
    if (!socketRef.current || !incomingCall) return;
    const targetRoomId = incomingCall.roomId;
    const currentRoomId = activeRoomRef.current;
    const isActiveCall = isCallActiveStatus(statusRef.current);
    const switchingRooms =
      isActiveCall &&
      Boolean(currentRoomId) &&
      Boolean(targetRoomId) &&
      currentRoomId !== targetRoomId;

    if (isActiveCall && currentRoomId && targetRoomId && currentRoomId === targetRoomId) {
      socketRef.current.emit("call:join", { roomId: targetRoomId, e2eeCapable: e2eeSupported });
      setIncomingCall(null);
      return;
    }

    if (switchingRooms && currentRoomId) {
      const remoteCount = Object.keys(remoteParticipantsRef.current).length;
      if (remoteCount <= 1) {
        socketRef.current.emit("call:end", { roomId: currentRoomId });
      } else {
        socketRef.current.emit("call:leave", { roomId: currentRoomId });
      }
      cleanupCall();
    }

    resetE2eeState();
    setIsCallHost(false);
    if (!CALL_E2EE_ENABLED) {
      setCallEncryptionMode(false, "disabled in settings", { suppressBanner: true });
    } else if (incomingCall.e2eeEnabled === false) {
      setCallEncryptionMode(false, "disabled by host");
    } else {
      setCallEncryptionMode(true);
    }
    callKeyRoomRef.current = callEncryptionEnabledRef.current ? targetRoomId : null;
    setStatus("connecting");
    setActiveRoomId(targetRoomId);
    setError(null);
    try {
      await ensureCallMedia();
    } catch {
      resetE2eeState();
      if (!isCallActiveStatus(statusRef.current)) {
        setStatus("idle");
        setIsOpen(false);
      }
      return;
    }
    await ensureIceServers({ force: true });
    warnIfNoTurn();
    socketRef.current.emit("call:join", { roomId: targetRoomId, e2eeCapable: e2eeSupported });
    setIncomingCall(null);
  }, [
    cleanupCall,
    e2eeSupported,
    ensureCallMedia,
    ensureIceServers,
    incomingCall,
    resetE2eeState,
    setCallEncryptionMode,
    warnIfNoTurn,
  ]);

  const declineCall = useCallback(() => {
    if (!socketRef.current || !incomingCall) return;
    socketRef.current.emit("call:decline", { roomId: incomingCall.roomId });
    setIncomingCall(null);
    if (statusRef.current === "incoming") {
      setStatus("idle");
      setIsOpen(false);
    }
  }, [incomingCall]);

  const leaveCall = useCallback(() => {
    const roomId = activeRoomId;
    if (socketRef.current && roomId) {
      const remoteCount = Object.keys(remoteParticipantsRef.current).length;
      if (remoteCount <= 1) {
        socketRef.current.emit("call:end", { roomId });
      } else {
        socketRef.current.emit("call:leave", { roomId });
      }
    }
    cleanupCall();
  }, [activeRoomId, cleanupCall]);

  const endCall = useCallback(() => {
    if (socketRef.current && activeRoomId) {
      socketRef.current.emit("call:end", { roomId: activeRoomId });
    }
    cleanupCall();
  }, [activeRoomId, cleanupCall]);

  const toggleVideo = useCallback(() => {
    const rawStream = rawStreamRef.current;
    const rawTrack = rawStream?.getVideoTracks()[0];
    if (!rawTrack) {
      void ensureMedia({ video: true }).catch(() => undefined);
      return;
    }
    if (holdEnabledRef.current) {
      const nextDesired = !holdRestoreRef.current.video;
      holdRestoreRef.current = { ...holdRestoreRef.current, video: nextDesired };
      setIsVideoEnabled(false);
      return;
    }
    const nextEnabled = !rawTrack.enabled;
    rawTrack.enabled = nextEnabled;
    if (videoProcessingRef.current.track) {
      videoProcessingRef.current.track.enabled = nextEnabled;
    }
    setIsVideoEnabled(nextEnabled);
  }, [ensureMedia]);

  const toggleAudio = useCallback(() => {
    const rawStream = rawStreamRef.current;
    const tracks = rawStream?.getAudioTracks() ?? [];
    if (tracks.length === 0) {
      void ensureMedia({ audio: true }).catch(() => undefined);
      return;
    }
    if (holdEnabledRef.current) {
      const nextDesired = !holdRestoreRef.current.audio;
      holdRestoreRef.current = { ...holdRestoreRef.current, audio: nextDesired };
      setIsAudioEnabled(false);
      return;
    }
    const nextEnabled = !tracks[0].enabled;
    tracks.forEach((track) => {
      track.enabled = nextEnabled;
    });
    const processedTrack = audioProcessingRef.current.track;
    if (processedTrack) {
      processedTrack.enabled = nextEnabled;
    }
    setIsAudioEnabled(nextEnabled);
  }, [ensureMedia]);

  const toggleHold = useCallback(() => {
    const next = !holdEnabledRef.current;
    setIsHolding(next);
    applyHoldState(next);
    if (socketRef.current && activeRoomRef.current) {
      socketRef.current.emit("call:hold", {
        roomId: activeRoomRef.current,
        hold: next,
      });
    }
  }, [applyHoldState]);

  const muteAllParticipants = useCallback(() => {
    if (!socketRef.current || !activeRoomRef.current) return;
    socketRef.current.emit("call:mute-all", { roomId: activeRoomRef.current });
  }, []);

  const stopAllScreenShares = useCallback(() => {
    if (!socketRef.current || !activeRoomRef.current) return;
    socketRef.current.emit("call:screen:stop-all", { roomId: activeRoomRef.current });
  }, []);

  const removeParticipantFromCall = useCallback((socketId: string) => {
    if (!socketRef.current || !activeRoomRef.current) return;
    const targetSocketId = String(socketId || "").trim();
    if (!targetSocketId) return;
    const localSocketId = localSocketIdRef.current;
    if (localSocketId && targetSocketId === localSocketId) return;
    socketRef.current.emit("call:remove-participant", {
      roomId: activeRoomRef.current,
      socketId: targetSocketId,
    });
  }, []);

  const requestScreenControl = useCallback((targetSocketId: string) => {
    if (!socketRef.current || !activeRoomRef.current) return;
    if (screenControlTargetRef.current === targetSocketId) return;
    setPendingScreenControlTargets((prev) =>
      prev.includes(targetSocketId) ? prev : [...prev, targetSocketId]
    );
    socketRef.current.emit("call:control:request", {
      roomId: activeRoomRef.current,
      to: targetSocketId,
    });
  }, []);

  const grantScreenControl = useCallback(
    (requesterSocketId: string) => {
      if (!socketRef.current || !activeRoomRef.current) return;
      if (!localScreenStreamRef.current) return;
      const request = screenControlRequests.find(
        (entry) => entry.socketId === requesterSocketId
      );
      if (!request) return;
      const activeController = activeScreenControllerRef.current;
      if (activeController && activeController.socketId !== requesterSocketId) {
        socketRef.current.emit("call:control:stop", {
          roomId: activeRoomRef.current,
          to: activeController.socketId,
        });
      }
      setActiveScreenController(request);
      setScreenControlRequests((prev) =>
        prev.filter((entry) => entry.socketId !== requesterSocketId)
      );
      socketRef.current.emit("call:control:grant", {
        roomId: activeRoomRef.current,
        to: requesterSocketId,
      });
    },
    [screenControlRequests]
  );

  const denyScreenControl = useCallback((requesterSocketId: string) => {
    if (!socketRef.current || !activeRoomRef.current) return;
    setScreenControlRequests((prev) =>
      prev.filter((entry) => entry.socketId !== requesterSocketId)
    );
    socketRef.current.emit("call:control:deny", {
      roomId: activeRoomRef.current,
      to: requesterSocketId,
    });
  }, []);

  const stopScreenControl = useCallback((targetSocketId?: string) => {
    if (!socketRef.current || !activeRoomRef.current) return;
    const controllerId = targetSocketId || activeScreenControllerRef.current?.socketId;
    const ownerId = targetSocketId || screenControlTargetRef.current;
    const agentId = screenControlAgentRef.current;

    if (screenControlTargetRef.current && ownerId === screenControlTargetRef.current) {
      socketRef.current.emit("call:control:stop", {
        roomId: activeRoomRef.current,
        to: ownerId,
      });
      if (agentId && agentId !== ownerId) {
        socketRef.current.emit("call:control:stop", {
          roomId: activeRoomRef.current,
          to: agentId,
        });
      }
      setScreenControlTarget(null);
      setScreenControlAgentId(null);
      return;
    }

    if (controllerId) {
      socketRef.current.emit("call:control:stop", {
        roomId: activeRoomRef.current,
        to: controllerId,
      });
      setActiveScreenController(null);
      setScreenControlCursor(null);
    }
  }, []);

  const sendScreenControlEvent = useCallback((targetSocketId: string, event: ScreenControlEvent) => {
    if (!socketRef.current || !activeRoomRef.current) return;
    if (screenControlTargetRef.current !== targetSocketId) return;
    const resolvedTarget = screenControlAgentRef.current || targetSocketId;
    socketRef.current.emit("call:control:event", {
      roomId: activeRoomRef.current,
      to: resolvedTarget,
      event,
    });
  }, []);

  const sendMessage = useCallback(
    (body: string, kind: VideoCallMessage["kind"] = "text", gifUrl?: string) => {
      const roomId = activeRoomRef.current || activeRoomId;
      if (!socketRef.current || !roomId) return;
      if (!String(body || "").trim() && kind !== "gif") return;
      const socket = socketRef.current;
      const payload: VideoCallChatEnvelope = {
        body: String(body || ""),
        kind,
        gifUrl: String(gifUrl || ""),
      };
      const appendLocalEcho = () => {
        const identity = resolveLocalIdentity();
        const localUserId = Number(user?.id) || 0;
        const safeKind =
          payload.kind === "emoji" || payload.kind === "gif" || payload.kind === "image"
            ? payload.kind
            : "text";
        const safeBody = String(payload.body || "");
        const safeGifUrl = String(payload.gifUrl || "");
        if (localUserId > 0) {
          const now = Date.now();
          localChatEchoRef.current.forEach((value, key) => {
            if (now - value > LOCAL_CHAT_DEDUPE_WINDOW_MS) {
              localChatEchoRef.current.delete(key);
            }
          });
          const signature = buildChatMessageSignature({
            userId: localUserId,
            kind: safeKind,
            body: safeBody,
            gifUrl: safeGifUrl,
          });
          localChatEchoRef.current.set(signature, now);
        }
        setMessages((prev) => [
          ...prev,
          {
            id: createMessageId(),
            body: safeBody,
            kind: safeKind,
            gifUrl: safeGifUrl,
            from: {
              userId: localUserId,
              displayName: identity.displayName || identity.handle || "You",
              handle: identity.handle || undefined,
              avatarUrl: identity.avatarUrl || undefined,
            },
            at: new Date().toISOString(),
          },
        ]);
      };

      if (!CALL_E2EE_ENABLED || !callEncryptionEnabledRef.current) {
        appendLocalEcho();
        socket.emit("call:chat", {
          roomId,
          body: payload.body,
          kind: payload.kind,
          gifUrl: payload.gifUrl,
        });
        return;
      }

      if (!e2eeCryptoSupported) {
        setError("Chat encryption is not supported in this runtime.");
        return;
      }

      const key = callKeyRef.current;
      if (!key) {
        appendLocalEcho();
        const outbox = pendingEncryptedChatOutboxRef.current;
        outbox.push({ roomId, payload });
        // Prevent unbounded growth if the key never arrives.
        if (outbox.length > 25) {
          outbox.splice(0, outbox.length - 25);
        }
        void maybeRequestCallKey(roomId);
        showTransientError(
          "Encryption key is syncing. Your message will send automatically.",
          6000
        );
        return;
      }

      void encryptJson(key, payload)
        .then((encryptedMessage) => {
          appendLocalEcho();
          socket.emit("call:chat", {
            roomId,
            encryptedMessage,
          });
        })
        .catch(() => {
          setError("Unable to encrypt chat message.");
        });
    },
    [activeRoomId, e2eeCryptoSupported, maybeRequestCallKey, resolveLocalIdentity, user?.id]
  );

  const value = useMemo(
    () => ({
      isOpen,
      status,
      realtimeStatus,
      realtimeError,
      realtimeUrl: REALTIME_URL,
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
      maxParticipants: MAX_VIDEO_PARTICIPANTS,
      isVideoEnabled,
      isAudioEnabled,
      noiseSuppressionEnabled,
      voiceFocusEnabled,
      lowLatencyMode,
      lowLatencySuggested,
      lowLatencySuggestionReason,
      isHolding,
      isOnHold,
      selectedAudioInputId,
      selectedVideoInputId,
      isScreenSharing: Boolean(localScreenStream),
      videoEffects,
      setVideoEffects,
      toggleNoiseSuppression,
      toggleVoiceFocus,
      toggleLowLatencyMode,
      onlineUserIds,
      openCallComposer,
      closeCallComposer,
      setSelectedInvitees,
      setPresenceTargets,
      startCall,
      acceptCall,
      declineCall,
      leaveCall,
      endCall,
      toggleVideo,
      toggleAudio,
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
    }),
    [
      acceptCall,
      closeCallComposer,
      declineCall,
      error,
      e2eeDebug,
      endCall,
      incomingCall,
      activeRoomId,
      isCallHost,
      isAudioEnabled,
      noiseSuppressionEnabled,
      voiceFocusEnabled,
      lowLatencyMode,
      lowLatencySuggested,
      lowLatencySuggestionReason,
      isHolding,
      isOnHold,
      selectedAudioInputId,
      selectedVideoInputId,
      isOpen,
      isVideoEnabled,
      localScreenStream,
      realtimeStatus,
      realtimeError,
      REALTIME_URL,
      setAudioInputDevice,
      setVideoInputDevice,
      setVideoEffects,
      toggleNoiseSuppression,
      toggleVoiceFocus,
      toggleLowLatencyMode,
      onlineUserIds,
      leaveCall,
      localStream,
      messages,
      openCallComposer,
      remoteParticipants,
      remoteScreenStreams,
      remoteStreams,
      selectedInvitees,
      videoEffects,
      setPresenceTargets,
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
      startCall,
      status,
      toggleAudio,
      toggleHold,
      toggleVideo,
      muteAllParticipants,
      stopAllScreenShares,
      removeParticipantFromCall,
    ]
  );

  return <VideoCallContext.Provider value={value}>{children}</VideoCallContext.Provider>;
};

export const useVideoCall = () => {
  const context = useContext(VideoCallContext);
  if (!context) throw new Error("useVideoCall must be used within VideoCallProvider");
  return context;
};

export type { VideoCallInvitee, VideoCallParticipant, VideoCallMessage };
