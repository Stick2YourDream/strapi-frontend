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
  decryptWrappedKey,
  deriveSharedKey,
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
  kind: "text" | "emoji" | "gif";
  gifUrl?: string;
  from: {
    userId: number;
    displayName: string;
    handle?: string;
    avatarUrl?: string;
  };
  at: string;
};

type VideoCallStatus = "idle" | "setup" | "incoming" | "connecting" | "in-call";
type RealtimeStatus = "disconnected" | "connecting" | "connected";

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
};

const MAX_VIDEO_PARTICIPANTS = 8;
const CALL_CONNECT_TIMEOUT_MS = 20000;
const E2EE_VERSION = 1;
const E2EE_IV_BYTES = 12;
const E2EE_HEADER_BYTES = 1 + E2EE_IV_BYTES;
const CALL_KEY_GRACE_MS = 2000;
const CALL_E2EE_ENABLED = ["1", "true", "on", "yes"].includes(
  String(import.meta.env.VITE_CALL_E2EE || "").toLowerCase()
);
const REALTIME_URL =
  String(import.meta.env.VITE_SOCKET_URL || "").trim() ||
  String(import.meta.env.VITE_API_URL || "").replace(/\/api$/, "") ||
  (typeof window !== "undefined" ? window.location.origin : "");
const AUDIO_SYNC_DELAY_SEC = 0.14;
const NOISE_SUPPRESSION_STORAGE_KEY = "call:noise-suppression";
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

const isChromeOrEdge = () => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const uaData = (navigator as any).userAgentData as { brands?: { brand: string }[] } | undefined;
  if (uaData?.brands?.length) {
    const brands = uaData.brands
      .map((brand) => brand.brand.toLowerCase())
      .join(" ");
    return brands.includes("edge") || brands.includes("chrome");
  }
  if (/\bEdg\//.test(ua)) return true;
  if (/\bChrome\//.test(ua) && !/\bOPR\//.test(ua) && !/\bOpera\//.test(ua)) {
    return true;
  }
  return false;
};

const supportsCallE2ee = () => {
  if (typeof window === "undefined") return false;
  if (!CALL_E2EE_ENABLED) return false;
  const sender = (window as any).RTCRtpSender?.prototype;
  const receiver = (window as any).RTCRtpReceiver?.prototype;
  const hasInsertable =
    typeof sender?.createEncodedStreams === "function" &&
    typeof receiver?.createEncodedStreams === "function" &&
    typeof (window as any).TransformStream === "function";
  return isChromeOrEdge() && hasInsertable && Boolean(window.crypto?.subtle);
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

const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");
const mediapipeBase =
  String(import.meta.env.VITE_MEDIAPIPE_ASSETS_URL || "").trim() ||
  "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation";
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
  img.src = src;
  backdropImageCache.set(src, img);
  return img;
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
    filter: "none",
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
  const hadRemoteParticipantsRef = useRef(false);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const screenShareSendersRef = useRef<
    Map<string, { video?: RTCRtpSender; audio?: RTCRtpSender }>
  >(new Map());
  const screenShareOwnersRef = useRef<Map<string, string>>(new Map());
  const screenShareByOwnerRef = useRef<Map<string, string>>(new Map());
  const disconnectTimersRef = useRef<Map<string, number>>(new Map());
  const rtcConfigRef = useRef<RTCConfiguration>(RTC_CONFIG);
  const iceServersLoadingRef = useRef<Promise<void> | null>(null);
  const audioInputDeviceRef = useRef<string | null>(null);
  const videoInputDeviceRef = useRef<string | null>(null);
  const selectedInviteesRef = useRef<VideoCallInvitee[]>([]);
  const peerNegotiationRef = useRef<Map<string, { makingOffer: boolean; isPolite: boolean }>>(
    new Map()
  );
  const localSocketIdRef = useRef<string | null>(null);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const videoEffectsRef = useRef(videoEffects);
  const noiseSuppressionRef = useRef(noiseSuppressionEnabled);
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
  }>({ track: null, cleanup: null, sourceId: null, delaySec: 0 });
  const cleanupCallRef = useRef<() => void>(() => {});
  const profileRef = useRef<VideoCallInvitee | null>(null);
  const statusRef = useRef<VideoCallStatus>(status);
  const activeRoomRef = useRef<string | null>(activeRoomId);
  const activeScreenControllerRef = useRef<ScreenControlRequest | null>(null);
  const presenceTargetsRef = useRef<number[]>([]);
  const e2eeSupported = useMemo(() => supportsCallE2ee(), []);
  const callEncryptionEnabledRef = useRef<boolean>(e2eeSupported);
  const callKeyRef = useRef<CryptoKey | null>(null);
  const callKeyRoomRef = useRef<string | null>(null);
  const callKeyRecipientsRef = useRef<Set<number>>(new Set());
  const isCallHostRef = useRef(false);
  const missingCallKeySinceRef = useRef<number | null>(null);
  const senderE2eeRef = useRef<WeakSet<RTCRtpSender>>(new WeakSet());
  const receiverE2eeRef = useRef<WeakSet<RTCRtpReceiver>>(new WeakSet());
  const lastCallKeyRequestRef = useRef(0);

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

  const resolveSocketAuth = useCallback(() => {
    const token = localStorage.getItem("token") || "";
    const profile = profileRef.current;
    return {
      token,
      userId: user?.id,
      displayName: profile?.displayName || user?.email || "",
      handle: profile?.handle || "",
      avatarUrl: profile?.avatarUrl || "",
    };
  }, [user?.email, user?.id]);

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
      const next = { ...prev, ...effects };
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
      const constraints: MediaTrackConstraints = {
        noiseSuppression,
        echoCancellation: true,
        autoGainControl: true,
      };
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

  const getPeerNegotiationState = useCallback((socketId: string) => {
    const existing = peerNegotiationRef.current.get(socketId);
    if (existing) return existing;
    const localSocketId = socketRef.current?.id || localSocketIdRef.current || "";
    const isPolite = localSocketId ? localSocketId.localeCompare(socketId) < 0 : true;
    const created = { makingOffer: false, isPolite };
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
    isCallHostRef.current = false;
    setIsCallHost(false);
    senderE2eeRef.current = new WeakSet();
    receiverE2eeRef.current = new WeakSet();
    callEncryptionEnabledRef.current = e2eeSupported;
    missingCallKeySinceRef.current = null;
  }, [e2eeSupported]);

  const setCallEncryptionMode = useCallback(
    (
      enabled: boolean,
      reason?: string,
      options?: { broadcast?: boolean; suppressBanner?: boolean }
    ) => {
      const nextEnabled = Boolean(enabled && e2eeSupported);
      callEncryptionEnabledRef.current = nextEnabled;
      if (!nextEnabled) {
        callKeyRef.current = null;
        callKeyRoomRef.current = null;
        callKeyRecipientsRef.current = new Set();
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
    [e2eeSupported, setE2eeDebug]
  );

  const maybeRequestCallKey = useCallback(async (roomIdOverride?: string) => {
    if (!e2eeSupported || !callEncryptionEnabledRef.current) return;
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
  }, [e2eeSupported, user?.id, setE2eeDebug]);

  const setupSenderE2ee = useCallback(
    (sender?: RTCRtpSender | null) => {
      if (!sender || !e2eeSupported) return;
      if (!callEncryptionEnabledRef.current) return;
      if (senderE2eeRef.current.has(sender)) return;
      const streams = (sender as any).createEncodedStreams?.();
      if (!streams?.readable || !streams?.writable) return;
      const transform = new TransformStream({
        async transform(encodedFrame, controller) {
          if (!encodedFrame) return;
          if (!callEncryptionEnabledRef.current) {
            controller.enqueue(encodedFrame);
            return;
          }
          if (!encodedFrame?.data) return;
          const key = callKeyRef.current;
          if (!key) {
            const now = Date.now();
            if (!missingCallKeySinceRef.current) {
              missingCallKeySinceRef.current = now;
            }
            void maybeRequestCallKey();
            if (now - (missingCallKeySinceRef.current ?? now) >= CALL_KEY_GRACE_MS) {
              setCallEncryptionMode(false, "missing call key", { broadcast: true });
              controller.enqueue(encodedFrame);
            }
            return;
          }
          missingCallKeySinceRef.current = null;
          try {
            const encrypted = await encryptFrame(key, encodedFrame.data);
            encodedFrame.data = encrypted;
            controller.enqueue(encodedFrame);
          } catch (err) {
            if (callEncryptionEnabledRef.current) {
              const detail = err instanceof Error ? err.message : "Encryption failed";
              setCallEncryptionMode(false, detail, { broadcast: true });
            }
            controller.enqueue(encodedFrame);
          }
        },
      });
      streams.readable
        .pipeThrough(transform)
        .pipeTo(streams.writable)
        .catch(() => undefined);
      senderE2eeRef.current.add(sender);
    },
    [e2eeSupported, encryptFrame, maybeRequestCallKey, setCallEncryptionMode]
  );

  const setupReceiverE2ee = useCallback(
    (receiver?: RTCRtpReceiver | null) => {
      if (!receiver || !e2eeSupported) return;
      if (!callEncryptionEnabledRef.current) return;
      if (receiverE2eeRef.current.has(receiver)) return;
      const streams = (receiver as any).createEncodedStreams?.();
      if (!streams?.readable || !streams?.writable) return;
      const transform = new TransformStream({
        async transform(encodedFrame, controller) {
          if (!encodedFrame) return;
          if (!callEncryptionEnabledRef.current) {
            controller.enqueue(encodedFrame);
            return;
          }
          const key = callKeyRef.current;
          if (!encodedFrame?.data) return;
          if (!key) {
            const now = Date.now();
            if (!missingCallKeySinceRef.current) {
              missingCallKeySinceRef.current = now;
            }
            void maybeRequestCallKey();
            if (now - (missingCallKeySinceRef.current ?? now) >= CALL_KEY_GRACE_MS) {
              setCallEncryptionMode(false, "missing call key", { broadcast: true });
              controller.enqueue(encodedFrame);
            }
            return;
          }
          missingCallKeySinceRef.current = null;
          const dataBuffer = toArrayBuffer(encodedFrame.data);
          const bytes = new Uint8Array(dataBuffer);
          const isEncryptedFrame =
            bytes.length > E2EE_HEADER_BYTES && bytes[0] === E2EE_VERSION;
          if (!isEncryptedFrame) {
            setCallEncryptionMode(false, "unencrypted media detected", { broadcast: true });
            controller.enqueue(encodedFrame);
            return;
          }
          try {
            const decrypted = await decryptFrame(key, dataBuffer);
            encodedFrame.data = decrypted;
            controller.enqueue(encodedFrame);
          } catch (err) {
            if (callEncryptionEnabledRef.current) {
              const detail = err instanceof Error ? err.message : "Decryption failed";
              setCallEncryptionMode(false, detail, { broadcast: true });
            }
          }
        },
      });
      streams.readable
        .pipeThrough(transform)
        .pipeTo(streams.writable)
        .catch(() => undefined);
      receiverE2eeRef.current.add(receiver);
    },
    [decryptFrame, e2eeSupported, maybeRequestCallKey, setCallEncryptionMode, toArrayBuffer]
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
      if (callKeyRecipientsRef.current.has(targetUserId)) return;
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
          setupSenderE2ee(existing.video);
          requestVideoKeyFrame(existing.video);
        } else {
          try {
            existing.video = pc.addTrack(videoTrack, screenStream);
            setupSenderE2ee(existing.video);
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
          setupSenderE2ee(existing.audio);
        } else {
          try {
            existing.audio = pc.addTrack(audioTrack, screenStream);
            setupSenderE2ee(existing.audio);
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
        audio: true,
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
        (await attemptGetDisplayMedia({ video: true, audio: true })) ||
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
      mode: VideoCallEffects["background"]
    ) => {
      if (mode === "none") return false;

      const src = BACKDROP_ASSETS[mode as keyof typeof BACKDROP_ASSETS];
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
      let rafId = 0;
      let maskSource: CanvasImageSource | null = null;
      let lastSegmentationTs = 0;
      let segmenting = false;
      let segmentationFailed = false;
      let segmentationLoading = false;
      const segmentationIntervalMs = 1000 / 30;
      const maskBlurPx = 3;
      const maskShrinkPx = 0;
      let segmenter: SelfieSegmentationInstance | null = null;
      let closed = false;

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

        const effects = effectsRef.current;
        const needsSegmentation = effects.blur || effects.background !== "none";
        if (needsSegmentation) {
          ensureSegmentation();
        } else {
          maskSource = null;
        }
        const cameraFilter = getCameraFilter(effects.filter);
        const mirror = effects.mirror;
        const shouldBlurBackground = effects.blur && effects.background === "none";
        const blurFilter = shouldBlurBackground ? "blur(10px)" : "none";
        const baseFilter = cameraFilter !== "none" ? cameraFilter : "none";

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
          maskCtx.clearRect(0, 0, width, height);
          maskCtx.filter = `blur(${maskBlurPx}px)`;
          maskCtx.drawImage(maskSource, 0, 0, width, height);
          maskCtx.filter = "none";
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
        }

        foregroundCtx.clearRect(0, 0, width, height);
        foregroundCtx.filter = cameraFilter;
        drawCover(foregroundCtx, width, height, false);
        foregroundCtx.filter = "none";
        foregroundCtx.globalCompositeOperation = "destination-in";
        if (maskCtx) {
          foregroundCtx.drawImage(maskCanvas, 0, 0, width, height);
        } else {
          foregroundCtx.filter = `blur(${maskBlurPx}px)`;
          foregroundCtx.drawImage(maskSource, 0, 0, width, height);
          foregroundCtx.filter = "none";
        }
        foregroundCtx.globalCompositeOperation = "source-over";

        const drawBackdropFrame = (mode: VideoCallEffects["background"]) => {
          let drew = false;
          withMirror(ctx, width, mirror, () => {
            drew = drawBackdrop(ctx, width, height, mode);
          });
          return drew;
        };

        if (effects.background !== "none") {
          const drewBackdrop = drawBackdropFrame(effects.background);
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
    const needsProcessing =
      effects.blur ||
      effects.background !== "none" ||
      effects.filter !== "none" ||
      effects.mirror;
    if (!needsProcessing) {
      stopVideoProcessing();
      return rawTrack;
    }

    const current = videoProcessingRef.current;
    if (current.track && current.sourceId === rawTrack.id) {
      current.track.enabled = rawTrack.enabled;
      current.effectsKey = `${effects.blur ? "1" : "0"}-${effects.background}-${
        effects.filter
      }-${effects.mirror ? "1" : "0"}`;
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
        effectsKey: `${effects.blur ? "1" : "0"}-${effects.background}-${
          effects.filter
        }-${effects.mirror ? "1" : "0"}`,
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
    const needsProcessing =
      effects.blur || effects.background !== "none" || effects.filter !== "none";
    if (!needsProcessing || AUDIO_SYNC_DELAY_SEC <= 0) {
      stopAudioProcessing();
      return rawTrack;
    }
    const current = audioProcessingRef.current;
    if (current.track && current.sourceId === rawTrack.id && current.delaySec === AUDIO_SYNC_DELAY_SEC) {
      current.track.enabled = rawTrack.enabled;
      return current.track;
    }
    stopAudioProcessing();
    try {
      const { track, cleanup } = createDelayedAudioTrack(rawTrack, AUDIO_SYNC_DELAY_SEC);
      if (!track) return rawTrack;
      audioProcessingRef.current = {
        track,
        cleanup,
        sourceId: rawTrack.id,
        delaySec: AUDIO_SYNC_DELAY_SEC,
      };
      return track;
    } catch {
      stopAudioProcessing();
      return rawTrack;
    }
  }, [createDelayedAudioTrack, stopAudioProcessing]);

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
            setupSenderE2ee(sender);
            tuneSenderForLowLatency(sender);
          } else {
            const newSender = pc.addTrack(track, stream);
            setupSenderE2ee(newSender);
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
            setupSenderE2ee(videoSender);
            tuneSenderForLowLatency(videoSender);
            requestVideoKeyFrame(videoSender);
          } else {
            const newSender = pc.addTrack(videoTrack, stream);
            setupSenderE2ee(newSender);
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
    (pc: RTCPeerConnection) => {
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
          setupSenderE2ee(senderByTrack);
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
          setupSenderE2ee(senderByKind);
          if (track.kind === "video") {
            requestVideoKeyFrame(senderByKind);
          }
          return;
        }
        if (pc.getSenders().some((candidate) => candidate.track?.id === track.id)) {
          return;
        }
        const newSender = pc.addTrack(track, stream);
        setupSenderE2ee(newSender);
        if (track.kind === "video") {
          requestVideoKeyFrame(newSender);
        }
      });
    },
    [requestVideoKeyFrame, setupSenderE2ee]
  );

  const closePeer = useCallback((socketId: string) => {
    const disconnectTimer = disconnectTimersRef.current.get(socketId);
    if (disconnectTimer) {
      window.clearTimeout(disconnectTimer);
      disconnectTimersRef.current.delete(socketId);
    }
    const pc = peersRef.current.get(socketId);
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
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

  const ensureIceServers = useCallback(async () => {
    if (iceServersLoadingRef.current) {
      return iceServersLoadingRef.current;
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
      try {
        const res = await api.get("/webrtc/ice");
        const servers = res.data?.iceServers ?? res.data?.ice_servers ?? [];
        if (Array.isArray(servers) && servers.length > 0) {
          rtcConfigRef.current = { ...RTC_CONFIG, iceServers: servers };
          turnAvailableRef.current = hasTurn(servers);
        } else {
          rtcConfigRef.current = RTC_CONFIG;
          turnAvailableRef.current = hasTurn(RTC_CONFIG.iceServers || []);
        }
      } catch {
        rtcConfigRef.current = RTC_CONFIG;
        turnAvailableRef.current = hasTurn(RTC_CONFIG.iceServers || []);
      } finally {
        iceServersLoadingRef.current = null;
      }
    })();
    iceServersLoadingRef.current = load;
    return load;
  }, []);

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
        await rawTrack.applyConstraints({ noiseSuppression: next });
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
    (socketId: string) => {
      const existing = peersRef.current.get(socketId);
      if (existing) return existing;
      const useInsertableStreams = e2eeSupported && callEncryptionEnabledRef.current;
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
          await pc.setLocalDescription();
          socketRef.current.emit("call:offer", {
            to: socketId,
            sdp: pc.localDescription,
          });
        } catch {
          setError("Failed to renegotiate call.");
        } finally {
          negotiationState.makingOffer = false;
        }
      };
      attachLocalTracks(pc);
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
        setupReceiverE2ee(event.receiver);
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
      pc.onconnectionstatechange = () => {
        const timers = disconnectTimersRef.current;
        if (pc.connectionState === "disconnected") {
          if (!timers.has(socketId)) {
            const timer = window.setTimeout(() => {
              timers.delete(socketId);
              if (pc.connectionState === "disconnected") {
                closePeer(socketId);
              }
            }, 12000);
            timers.set(socketId, timer);
          }
          return;
        }
        const existingTimer = timers.get(socketId);
        if (existingTimer) {
          window.clearTimeout(existingTimer);
          timers.delete(socketId);
        }
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          closePeer(socketId);
        }
      };
      return pc;
    },
    [
      attachLocalTracks,
      attachScreenShareTrack,
      closePeer,
      e2eeSupported,
      getPeerNegotiationState,
      setupReceiverE2ee,
    ]
  );

  useEffect(() => {
    localStreamRef.current = localStream;
    peersRef.current.forEach((pc) => attachLocalTracks(pc));
  }, [attachLocalTracks, localStream]);

  useEffect(() => {
    peersRef.current.forEach((pc, socketId) => attachScreenShareTrack(pc, socketId));
  }, [attachScreenShareTrack, localScreenStream]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

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
        }
      } catch {
        if (active) {
          profileRef.current = {
            userId: user.id,
            displayName: user.email,
          };
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [user?.email, user?.id]);

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
        socket.emit("call:join", { roomId: activeRoomRef.current });
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
      if (statusRef.current === "in-call" || statusRef.current === "connecting") return;
      setIncomingCall(invite);
      setStatus("incoming");
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
          if (callEncryptionEnabledRef.current) {
            setCallEncryptionMode(false, "disabled by host");
          }
        } else if (!e2eeSupported) {
          setCallEncryptionMode(false, "unsupported browser", { broadcast: true });
        } else if (!callEncryptionEnabledRef.current) {
          setCallEncryptionMode(true);
        }
        setRemoteParticipants(() =>
          Object.fromEntries(payload.participants.map((p) => [p.socketId, p]))
        );
        setStatus("in-call");
        payload.participants.forEach((participant) => {
          if (peersRef.current.has(participant.socketId)) return;
          createPeerConnection(participant.socketId);
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
        if (!e2eeSupported || !callEncryptionEnabledRef.current) return;
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
        } catch (err) {
          const detail = err instanceof Error ? err.message : "Key decrypt failed";
          setCallEncryptionMode(false, detail, { broadcast: true });
          setError(null);
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
        if (!e2eeSupported) {
          setCallEncryptionMode(false, "unsupported browser", { broadcast: true });
          return;
        }
        setCallEncryptionMode(true);
      }
    );

    socket.on("call:user-left", (payload: { socketId: string }) => {
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
      }) => {
        try {
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
              },
            };
          });
          const pc = createPeerConnection(payload.from);
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
      } catch {
        setError("Failed to finalize call connection.");
      }
    });

    socket.on("call:ice", async (payload: { from: string; candidate: RTCIceCandidateInit }) => {
      const pc = peersRef.current.get(payload.from);
      if (!pc) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(payload.candidate));
      } catch {
        // ignore ICE errors
      }
    });

    socket.on("call:chat", (payload: VideoCallMessage) => {
      setMessages((prev) => [...prev, { ...payload, id: createMessageId() }]);
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
    } else if (!e2eeSupported) {
      setCallEncryptionMode(false, "unsupported browser or missing insertable streams");
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
    await ensureIceServers();
    warnIfNoTurn();
    socketRef.current.emit("call:join", { roomId });
    socketRef.current.emit("call:invite", {
      roomId,
      invitees: targetInvitees.map((invitee) => invitee.userId),
      e2eeEnabled: callEncryptionEnabledRef.current,
    });
  }, [
    e2eeSupported,
    ensureCallMedia,
    ensureIceServers,
    resetE2eeState,
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
    resetE2eeState();
    setIsCallHost(false);
    if (!CALL_E2EE_ENABLED) {
      setCallEncryptionMode(false, "disabled in settings", { suppressBanner: true });
    } else if (incomingCall.e2eeEnabled === false) {
      setCallEncryptionMode(false, "disabled by host");
    } else if (!e2eeSupported) {
      setCallEncryptionMode(false, "unsupported browser", { broadcast: true });
    } else {
      setCallEncryptionMode(true);
    }
    callKeyRoomRef.current = callEncryptionEnabledRef.current ? incomingCall.roomId : null;
    setStatus("connecting");
    setActiveRoomId(incomingCall.roomId);
    setError(null);
    try {
      await ensureCallMedia();
    } catch {
      resetE2eeState();
      setStatus("idle");
      setIsOpen(false);
      return;
    }
    await ensureIceServers();
    warnIfNoTurn();
    socketRef.current.emit("call:join", { roomId: incomingCall.roomId });
    setIncomingCall(null);
  }, [
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
    setStatus("idle");
    setIsOpen(false);
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
    if (!isCallHostRef.current) return;
    socketRef.current.emit("call:mute-all", { roomId: activeRoomRef.current });
  }, []);

  const stopAllScreenShares = useCallback(() => {
    if (!socketRef.current || !activeRoomRef.current) return;
    if (!isCallHostRef.current) return;
    socketRef.current.emit("call:screen:stop-all", { roomId: activeRoomRef.current });
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
      if (!socketRef.current || !activeRoomId) return;
      if (!String(body || "").trim() && kind !== "gif") return;
      socketRef.current.emit("call:chat", {
        roomId: activeRoomId,
        body,
        kind,
        gifUrl,
      });
    },
    [activeRoomId]
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
