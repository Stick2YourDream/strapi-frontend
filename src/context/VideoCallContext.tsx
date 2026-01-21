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
};

type ScreenControlEvent = {
  type: "move" | "click";
  x: number;
  y: number;
};

type VideoCallEffects = {
  blur: boolean;
  background: "none" | "studio" | "sunset" | "mint" | "aurora" | "ember";
  filter: "none" | "vivid" | "noir" | "warm" | "cool";
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
  selectedInvitees: VideoCallInvitee[];
  incomingCall: IncomingCall | null;
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
  isScreenSharing: boolean;
  videoEffects: VideoCallEffects;
  setVideoEffects: (effects: Partial<VideoCallEffects>) => void;
  onlineUserIds: Set<number>;
  openCallComposer: (invitees?: VideoCallInvitee[]) => void;
  closeCallComposer: () => void;
  setSelectedInvitees: (invitees: VideoCallInvitee[]) => void;
  setPresenceTargets: (userIds: number[]) => void;
  startCall: () => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  leaveCall: () => void;
  endCall: () => void;
  toggleVideo: () => void;
  toggleAudio: () => void;
  startScreenShare: () => Promise<void>;
  stopScreenShare: () => void;
  screenControlRequests: ScreenControlRequest[];
  pendingScreenControlTargets: string[];
  activeScreenController: ScreenControlRequest | null;
  screenControlTarget: string | null;
  screenControlCursor: ScreenControlCursor | null;
  requestScreenControl: (targetSocketId: string) => void;
  grantScreenControl: (requesterSocketId: string) => void;
  denyScreenControl: (requesterSocketId: string) => void;
  stopScreenControl: (targetSocketId?: string) => void;
  sendScreenControlEvent: (targetSocketId: string, event: ScreenControlEvent) => void;
  sendMessage: (body: string, kind?: VideoCallMessage["kind"], gifUrl?: string) => void;
};

const MAX_VIDEO_PARTICIPANTS = 8;
const E2EE_VERSION = 1;
const E2EE_IV_BYTES = 12;
const E2EE_HEADER_BYTES = 1 + E2EE_IV_BYTES;

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
  const sender = (window as any).RTCRtpSender?.prototype;
  const receiver = (window as any).RTCRtpReceiver?.prototype;
  const hasInsertable =
    typeof sender?.createEncodedStreams === "function" &&
    typeof receiver?.createEncodedStreams === "function" &&
    typeof (window as any).TransformStream === "function";
  return isChromeOrEdge() && hasInsertable && Boolean(window.crypto?.subtle);
};

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:global.stun.twilio.com:3478" },
  ],
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
const pickMediaUrl = (mediaField: any): string | undefined => {
  if (!mediaField) return undefined;
  const candidate =
    (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ??
    (Array.isArray(mediaField) ? mediaField[0] : mediaField);
  if (!candidate) return undefined;
  const attrs = normalize(candidate);
  let url =
    attrs.url ||
    attrs.formats?.large?.url ||
    attrs.formats?.medium?.url ||
    attrs.formats?.small?.url ||
    attrs.formats?.thumbnail?.url;
  if (!url) return undefined;
  return url.startsWith("/") ? `${apiBase}${url}` : url;
};

const VideoCallContext = createContext<VideoCallContextValue | undefined>(undefined);

export const VideoCallProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [status, setStatus] = useState<VideoCallStatus>("idle");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedInvitees, setSelectedInviteesState] = useState<VideoCallInvitee[]>([]);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
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
  const [screenControlRequests, setScreenControlRequests] = useState<ScreenControlRequest[]>([]);
  const [pendingScreenControlTargets, setPendingScreenControlTargets] = useState<string[]>([]);
  const [activeScreenController, setActiveScreenController] =
    useState<ScreenControlRequest | null>(null);
  const [screenControlTarget, setScreenControlTarget] = useState<string | null>(null);
  const [screenControlCursor, setScreenControlCursor] = useState<ScreenControlCursor | null>(null);
  const [videoEffects, setVideoEffectsState] = useState<VideoCallEffects>({
    blur: false,
    background: "none",
    filter: "none",
  });
  const [onlineUserIds, setOnlineUserIds] = useState<Set<number>>(new Set());
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const localScreenStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamsRef = useRef<Record<string, MediaStream>>({});
  const remoteScreenStreamsRef = useRef<Record<string, MediaStream>>({});
  const rawStreamRef = useRef<MediaStream | null>(null);
  const screenShareSendersRef = useRef<
    Map<string, { video?: RTCRtpSender; audio?: RTCRtpSender }>
  >(new Map());
  const screenShareOwnersRef = useRef<Map<string, string>>(new Map());
  const screenShareByOwnerRef = useRef<Map<string, string>>(new Map());
  const peerNegotiationRef = useRef<Map<string, { makingOffer: boolean; isPolite: boolean }>>(
    new Map()
  );
  const localSocketIdRef = useRef<string | null>(null);
  const videoEffectsRef = useRef(videoEffects);
  const videoProcessingRef = useRef<{
    track: MediaStreamTrack | null;
    cleanup: (() => void) | null;
    sourceId: string | null;
    effectsKey: string;
  }>({ track: null, cleanup: null, sourceId: null, effectsKey: "" });
  const cleanupCallRef = useRef<() => void>(() => {});
  const profileRef = useRef<VideoCallInvitee | null>(null);
  const statusRef = useRef<VideoCallStatus>(status);
  const activeRoomRef = useRef<string | null>(activeRoomId);
  const activeScreenControllerRef = useRef<ScreenControlRequest | null>(null);
  const screenControlTargetRef = useRef<string | null>(null);
  const presenceTargetsRef = useRef<number[]>([]);
  const e2eeSupported = useMemo(() => supportsCallE2ee(), []);
  const callKeyRef = useRef<CryptoKey | null>(null);
  const callKeyRoomRef = useRef<string | null>(null);
  const callKeyRecipientsRef = useRef<Set<number>>(new Set());
  const isCallHostRef = useRef(false);
  const senderE2eeRef = useRef<WeakSet<RTCRtpSender>>(new WeakSet());
  const receiverE2eeRef = useRef<WeakSet<RTCRtpReceiver>>(new WeakSet());
  const lastCallKeyRequestRef = useRef(0);

  const buildSocketUrl = () => {
    const envUrl = String(import.meta.env.VITE_SOCKET_URL || "").trim();
    if (envUrl) return envUrl;
    if (apiBase) return apiBase;
    if (typeof window !== "undefined") return window.location.origin;
    return "";
  };

  const setVideoEffects = useCallback((effects: Partial<VideoCallEffects>) => {
    setVideoEffectsState((prev) => ({ ...prev, ...effects }));
  }, []);

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
    senderE2eeRef.current = new WeakSet();
    receiverE2eeRef.current = new WeakSet();
  }, []);

  const maybeRequestCallKey = useCallback(async (roomIdOverride?: string) => {
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
  }, [user?.id, setE2eeDebug]);

  const setupSenderE2ee = useCallback(
    (sender?: RTCRtpSender | null) => {
      if (!sender || !e2eeSupported) return;
      if (senderE2eeRef.current.has(sender)) return;
      const streams = (sender as any).createEncodedStreams?.();
      if (!streams?.readable || !streams?.writable) return;
      const transform = new TransformStream({
        async transform(encodedFrame, controller) {
          const key = callKeyRef.current;
          if (!key || !encodedFrame?.data) return;
          try {
            const encrypted = await encryptFrame(key, encodedFrame.data);
            encodedFrame.data = encrypted;
            controller.enqueue(encodedFrame);
          } catch {
            // drop encrypted frame failures
          }
        },
      });
      streams.readable
        .pipeThrough(transform)
        .pipeTo(streams.writable)
        .catch(() => undefined);
      senderE2eeRef.current.add(sender);
    },
    [e2eeSupported, encryptFrame]
  );

  const setupReceiverE2ee = useCallback(
    (receiver?: RTCRtpReceiver | null) => {
      if (!receiver || !e2eeSupported) return;
      if (receiverE2eeRef.current.has(receiver)) return;
      const streams = (receiver as any).createEncodedStreams?.();
      if (!streams?.readable || !streams?.writable) return;
      const transform = new TransformStream({
        async transform(encodedFrame, controller) {
          const key = callKeyRef.current;
          if (!key || !encodedFrame?.data) {
            if (!key) {
              void maybeRequestCallKey();
            }
            return;
          }
          try {
            const decrypted = await decryptFrame(key, encodedFrame.data);
            encodedFrame.data = decrypted;
            controller.enqueue(encodedFrame);
          } catch {
            // drop frames that fail to decrypt
            void maybeRequestCallKey();
          }
        },
      });
      streams.readable
        .pipeThrough(transform)
        .pipeTo(streams.writable)
        .catch(() => undefined);
      receiverE2eeRef.current.add(receiver);
    },
    [decryptFrame, e2eeSupported, maybeRequestCallKey]
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

  const startScreenShare = useCallback(async () => {
    if (!navigator.mediaDevices?.getDisplayMedia) {
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
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getDisplayMedia(displayOptions);
      } catch {
        try {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });
        } catch {
          stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
          });
        }
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
    } catch {
      setError("Unable to start screen sharing.");
    }
  }, [attachScreenShareTrack, stopScreenShare]);

  const drawBackdrop = useCallback(
    (ctx: CanvasRenderingContext2D, width: number, height: number, mode: VideoCallEffects["background"]) => {
      const gradient = ctx.createLinearGradient(0, 0, width, height);
      switch (mode) {
        case "studio":
          gradient.addColorStop(0, "#0f172a");
          gradient.addColorStop(1, "#1f2937");
          break;
        case "sunset":
          gradient.addColorStop(0, "#f97316");
          gradient.addColorStop(1, "#ec4899");
          break;
        case "mint":
          gradient.addColorStop(0, "#22c55e");
          gradient.addColorStop(1, "#38bdf8");
          break;
        case "aurora":
          gradient.addColorStop(0, "#0f172a");
          gradient.addColorStop(1, "#22d3ee");
          break;
        case "ember":
          gradient.addColorStop(0, "#ef4444");
          gradient.addColorStop(1, "#f59e0b");
          break;
        default:
          gradient.addColorStop(0, "#0b0d14");
          gradient.addColorStop(1, "#0b0d14");
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    },
    []
  );

  const getCameraFilter = useCallback((filter: VideoCallEffects["filter"]) => {
    switch (filter) {
      case "vivid":
        return "contrast(1.12) saturate(1.25)";
      case "noir":
        return "grayscale(1) contrast(1.2)";
      case "warm":
        return "saturate(1.1) sepia(0.25)";
      case "cool":
        return "saturate(1.05) hue-rotate(190deg)";
      default:
        return "none";
    }
  }, []);

  const createProcessedVideoTrack = useCallback(
    (rawTrack: MediaStreamTrack, effects: VideoCallEffects) => {
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
      let rafId = 0;
      let maskSource: CanvasImageSource | null = null;
      let lastSegmentationTs = 0;
      let segmenting = false;
      let segmentationFailed = false;
      const segmentationIntervalMs = 1000 / 12;
      let segmenter: SelfieSegmentationInstance | null = null;
      let closed = false;
      const needsSegmentation = effects.blur || effects.background !== "none";
      const cameraFilter = getCameraFilter(effects.filter);

      if (needsSegmentation) {
        loadSelfieSegmentation()
          .then((SelfieSegmentationCtor) => {
            if (!SelfieSegmentationCtor || closed) return;
            try {
              segmenter = new SelfieSegmentationCtor({
                locateFile: (file) => `${mediapipeBase}/${file}`,
              });
              segmenter.setOptions({ modelSelection: 1, selfieMode: true });
              segmenter.onResults((results) => {
                maskSource = results?.segmentationMask || null;
              });
            } catch {
              segmentationFailed = true;
            }
          })
          .catch(() => {
            segmentationFailed = true;
          });
      }

      const drawCover = (context: CanvasRenderingContext2D, width: number, height: number) => {
        const vw = video.videoWidth || width;
        const vh = video.videoHeight || height;
        const scale = Math.max(width / vw, height / vh);
        const sw = width / scale;
        const sh = height / scale;
        const sx = Math.max(0, (vw - sw) / 2);
        const sy = Math.max(0, (vh - sh) / 2);
        context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);
      };

      const maybeSegment = () => {
        if (!needsSegmentation || !segmenter || segmentationFailed || segmenting) return;
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

        const shouldBlur = effects.blur && effects.background === "none";
        const filterParts = [];
        if (cameraFilter !== "none") {
          filterParts.push(cameraFilter);
        }
        if (shouldBlur) {
          filterParts.push("blur(10px)");
        }
        const baseFilter = filterParts.length ? filterParts.join(" ") : "none";

        if (!needsSegmentation) {
          ctx.clearRect(0, 0, width, height);
          ctx.filter = cameraFilter;
          drawCover(ctx, width, height);
          ctx.filter = "none";
          rafId = window.requestAnimationFrame(drawFrame);
          return;
        }

        maybeSegment();

        if (!maskSource || !foregroundCtx) {
          ctx.clearRect(0, 0, width, height);
          ctx.filter = baseFilter;
          drawCover(ctx, width, height);
          ctx.filter = "none";
          rafId = window.requestAnimationFrame(drawFrame);
          return;
        }

        foregroundCtx.clearRect(0, 0, width, height);
        foregroundCtx.filter = cameraFilter;
        drawCover(foregroundCtx, width, height);
        foregroundCtx.filter = "none";
        foregroundCtx.globalCompositeOperation = "destination-in";
        foregroundCtx.drawImage(maskSource, 0, 0, width, height);
        foregroundCtx.globalCompositeOperation = "source-over";

        if (effects.background !== "none") {
          drawBackdrop(ctx, width, height, effects.background);
        } else {
          ctx.clearRect(0, 0, width, height);
          ctx.filter = baseFilter;
          drawCover(ctx, width, height);
          ctx.filter = "none";
        }

        ctx.drawImage(foregroundCanvas, 0, 0, width, height);

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

  const applyVideoEffects = useCallback(() => {
    const rawStream = rawStreamRef.current;
    const rawTrack = rawStream?.getVideoTracks()[0] || null;
    if (!rawTrack) {
      stopVideoProcessing();
      return null;
    }

    const effects = videoEffectsRef.current;
    const needsProcessing =
      effects.blur || effects.background !== "none" || effects.filter !== "none";
    if (!needsProcessing) {
      stopVideoProcessing();
      return rawTrack;
    }

    const effectsKey = `${effects.blur ? "1" : "0"}-${effects.background}-${effects.filter}`;
    const current = videoProcessingRef.current;
    if (current.track && current.sourceId === rawTrack.id && current.effectsKey === effectsKey) {
      current.track.enabled = rawTrack.enabled;
      return current.track;
    }

    stopVideoProcessing();
    try {
      const { track, cleanup } = createProcessedVideoTrack(rawTrack, effects);
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
  }, [createProcessedVideoTrack, stopVideoProcessing]);

  const syncLocalStream = useCallback(
    (videoTrack: MediaStreamTrack | null) => {
      const rawStream = rawStreamRef.current;
      const audioTracks = rawStream ? rawStream.getAudioTracks() : [];
      const tracks = [...audioTracks, ...(videoTrack ? [videoTrack] : [])];
      const stream = new MediaStream(tracks);

      setLocalStream(stream);
      localStreamRef.current = stream;

      peersRef.current.forEach((pc, socketId) => {
        audioTracks.forEach((track) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
          if (sender) {
            if (sender.track?.id !== track.id) {
              sender.replaceTrack(track);
            }
            setupSenderE2ee(sender);
          } else {
            const newSender = pc.addTrack(track, stream);
            setupSenderE2ee(newSender);
          }
        });
        const screenSender = screenShareSendersRef.current.get(socketId)?.video;
        const videoSender = pc
          .getSenders()
          .find((s) => s.track?.kind === "video" && s !== screenSender);
        if (videoTrack) {
          if (videoSender) {
            if (videoSender.track?.id !== videoTrack.id) {
              videoSender.replaceTrack(videoTrack);
            }
            setupSenderE2ee(videoSender);
          } else {
            const newSender = pc.addTrack(videoTrack, stream);
            setupSenderE2ee(newSender);
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
    [setupSenderE2ee]
  );

  const attachLocalTracks = useCallback((pc: RTCPeerConnection) => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getTracks().forEach((track) => {
      const sender = pc.getSenders().find((candidate) => candidate.track?.id === track.id);
      if (sender) {
        setupSenderE2ee(sender);
        return;
      }
      const newSender = pc.addTrack(track, stream);
      setupSenderE2ee(newSender);
    });
  }, [setupSenderE2ee]);

  const closePeer = useCallback((socketId: string) => {
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

  const createPeerConnection = useCallback(
    (socketId: string) => {
      const existing = peersRef.current.get(socketId);
      if (existing) return existing;
      const rtcConfig = e2eeSupported
        ? ({ ...RTC_CONFIG, encodedInsertableStreams: true } as RTCConfiguration)
        : RTC_CONFIG;
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
        const nextStream = stream ?? new MediaStream([event.track]);
        const streamId = nextStream.id;
        const shareOwner = screenShareOwnersRef.current.get(streamId);
        const existingCamera = remoteStreamsRef.current[socketId];
        const trackLabel = event.track.label?.toLowerCase() || "";
        const looksLikeScreen = ["screen", "window", "display", "monitor"].some((token) =>
          trackLabel.includes(token)
        );
        const shouldTreatAsScreen =
          shareOwner === socketId ||
          (event.track.kind === "video" &&
            existingCamera &&
            existingCamera.id !== streamId &&
            !remoteScreenStreamsRef.current[socketId]) ||
          (event.track.kind === "video" &&
            looksLikeScreen &&
            !remoteScreenStreamsRef.current[socketId]);

        if (shouldTreatAsScreen) {
          screenShareOwnersRef.current.set(streamId, socketId);
          screenShareByOwnerRef.current.set(socketId, streamId);
          setRemoteScreenStreams((prev) => {
            const existing = prev[socketId];
            if (existing) {
              if (!existing.getTracks().some((track) => track.id === event.track.id)) {
                existing.addTrack(event.track);
              }
              return { ...prev, [socketId]: existing };
            }
            return { ...prev, [socketId]: nextStream };
          });
          event.track.onended = () => {
            screenShareOwnersRef.current.delete(streamId);
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
            if (!existing.getTracks().some((track) => track.id === event.track.id)) {
              existing.addTrack(event.track);
            }
            return { ...prev, [socketId]: existing };
          }
          return { ...prev, [socketId]: nextStream };
        });
      };
      pc.onconnectionstatechange = () => {
        if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
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
    remoteScreenStreamsRef.current = remoteScreenStreams;
  }, [remoteScreenStreams]);

  useEffect(() => {
    activeScreenControllerRef.current = activeScreenController;
  }, [activeScreenController]);

  useEffect(() => {
    screenControlTargetRef.current = screenControlTarget;
  }, [screenControlTarget]);

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
        const displayName =
          payload.firstName || payload.lastName
            ? `${payload.firstName || ""} ${payload.lastName || ""}`.trim()
            : user.username || user.email;
        const handle = attrs.handle || user.username || "";
        const avatarUrl = pickMediaUrl(attrs.avatar);
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
            displayName: user.username || user.email,
          };
        }
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [user?.email, user?.id, user?.username]);

  useEffect(() => {
    if (user?.id) return;
    setOnlineUserIds(new Set());
    presenceTargetsRef.current = [];
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
  }, [resetE2eeState, stopVideoProcessing, user?.id]);

  useEffect(() => {
    if (!user?.id) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      return;
    }
    if (socketRef.current) return;
    const socketUrl = buildSocketUrl();
    if (!socketUrl) return;
    const token = localStorage.getItem("token") || "";
    const profile = profileRef.current;
    const socket = io(socketUrl, {
      autoConnect: true,
      transports: ["websocket", "polling"],
      auth: {
        token,
        userId: user.id,
        displayName: profile?.displayName || user.username || user.email,
        handle: profile?.handle || "",
        avatarUrl: profile?.avatarUrl || "",
      },
    });
    socketRef.current = socket;
    socket.on("connect", () => {
      localSocketIdRef.current = socket.id ?? null;
    });
    socket.on("disconnect", () => {
      localSocketIdRef.current = null;
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
      (payload: { roomId: string; participants: VideoCallParticipant[] }) => {
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
        if (!e2eeSupported) return;
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
          setError(null);
          setE2eeDebug(null);
          requestAllVideoKeyFrames();
        } catch (err) {
          const detail = err instanceof Error ? err.message : "Key decrypt failed";
          setE2eeDebug(`E2EE: ${detail}`);
          setError("Unable to enable call encryption.");
        }
      }
    );

    socket.on(
      "call:e2ee:request",
      async (payload: { roomId: string; fromUserId: number; publicKey: string }) => {
        if (!payload?.roomId || !payload?.fromUserId || !payload?.publicKey) return;
        if (payload.roomId !== activeRoomRef.current) return;
        if (!isCallHostRef.current) return;
        await shareCallKeyWithPublicKey(
          payload.roomId,
          payload.fromUserId,
          payload.publicKey
        );
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
          }
          setPendingScreenControlTargets((prev) => prev.filter((entry) => entry !== owner));
        }
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
      (payload: { roomId: string; from: string }) => {
        if (payload?.roomId && payload.roomId !== activeRoomRef.current) return;
        if (!payload?.from) return;
        setScreenControlTarget(payload.from);
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
        const x = Math.min(1, Math.max(0, Number(payload.event.x)));
        const y = Math.min(1, Math.max(0, Number(payload.event.y)));
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const kind = payload.event.type === "click" ? "click" : "move";
        setScreenControlCursor({
          x,
          y,
          from: payload.from,
          at: Date.now(),
          kind,
        });
      }
    );

    socket.on("call:declined", (payload: { roomId: string; from: VideoCallInvitee }) => {
      if (payload?.roomId !== activeRoomRef.current) return;
      setMessages((prev) => [
        ...prev,
        {
          id: createMessageId(),
          body: `${payload.from.displayName || "Someone"} declined the call.`,
          kind: "text",
          from: {
            userId: payload.from.userId,
            displayName: payload.from.displayName || "Guest",
            handle: payload.from.handle,
            avatarUrl: payload.from.avatarUrl,
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
      socket.disconnect();
      socketRef.current = null;
      setOnlineUserIds(new Set());
    };
  }, [
    closePeer,
    createPeerConnection,
    e2eeSupported,
    getPeerNegotiationState,
    maybeRequestCallKey,
    requestAllVideoKeyFrames,
    shareCallKeyWithParticipants,
    shareCallKeyWithPublicKey,
    user?.email,
    user?.id,
    user?.username,
  ]);

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

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: needsAudio,
        video: needsVideo,
      });
      stream.getTracks().forEach((track) => {
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
    [applyVideoEffects, syncLocalStream]
  );

  const ensureCallMedia = useCallback(async () => {
    try {
      return await ensureMedia({ audio: true, video: true });
    } catch {
      try {
        return await ensureMedia({ audio: false, video: false });
      } catch (err) {
        setError(
          "Please allow microphone access to join the call. Camera is optional. If this is your first time, check browser permissions and use HTTPS (or localhost)."
        );
        throw err;
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
    setE2eeDebug(null);
    setScreenControlRequests([]);
    setPendingScreenControlTargets([]);
    setActiveScreenController(null);
    setScreenControlTarget(null);
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
    stopVideoProcessing();
    setLocalStream(null);
    localStreamRef.current = null;
    resetE2eeState();
    resetCallState();
  }, [closePeer, resetCallState, resetE2eeState, stopScreenShare, stopVideoProcessing]);

  cleanupCallRef.current = cleanupCall;

  const openCallComposer = useCallback((invitees?: VideoCallInvitee[]) => {
    setSelectedInviteesState(invitees || []);
    setStatus("setup");
    setIsOpen(true);
    setError(null);
    void ensureMedia({ video: true }).catch(() => undefined);
  }, [ensureMedia]);

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

  const startCall = useCallback(async () => {
    if (!socketRef.current || !user?.id) return;
    if (!e2eeSupported) {
      setError("End-to-end encrypted calls require Chrome or Edge.");
      setE2eeDebug("E2EE: unsupported browser or missing insertable streams.");
      setStatus("setup");
      setIsOpen(true);
      return;
    }
    if (selectedInvitees.length > MAX_VIDEO_PARTICIPANTS - 1) {
      setError(`Max ${MAX_VIDEO_PARTICIPANTS} participants per call.`);
      return;
    }
    setError(null);
    setE2eeDebug(null);
    setStatus("connecting");
    setIsOpen(true);
    const roomId = createRoomId();
    resetE2eeState();
    isCallHostRef.current = true;
    callKeyRoomRef.current = roomId;
    try {
      callKeyRef.current = await generateCallKey();
    } catch {
      setError("Unable to enable call encryption.");
      setE2eeDebug("E2EE: failed to generate call key.");
      setStatus("setup");
      return;
    }
    setActiveRoomId(roomId);
    try {
      await ensureCallMedia();
    } catch {
      resetE2eeState();
      setStatus("setup");
      return;
    }
    socketRef.current.emit("call:join", { roomId });
    socketRef.current.emit("call:invite", {
      roomId,
      invitees: selectedInvitees.map((invitee) => invitee.userId),
    });
  }, [e2eeSupported, ensureCallMedia, resetE2eeState, selectedInvitees, user?.id]);

  const acceptCall = useCallback(async () => {
    if (!socketRef.current || !incomingCall) return;
    if (!e2eeSupported) {
      setError("End-to-end encrypted calls require Chrome or Edge.");
      setE2eeDebug("E2EE: unsupported browser or missing insertable streams.");
      return;
    }
    resetE2eeState();
    callKeyRoomRef.current = incomingCall.roomId;
    setStatus("connecting");
    setActiveRoomId(incomingCall.roomId);
    setError(null);
    setE2eeDebug(null);
    try {
      await ensureCallMedia();
    } catch {
      resetE2eeState();
      setStatus("idle");
      setIsOpen(false);
      return;
    }
    socketRef.current.emit("call:join", { roomId: incomingCall.roomId });
    setIncomingCall(null);
  }, [e2eeSupported, ensureCallMedia, incomingCall, resetE2eeState]);

  const declineCall = useCallback(() => {
    if (!socketRef.current || !incomingCall) return;
    socketRef.current.emit("call:decline", { roomId: incomingCall.roomId });
    setIncomingCall(null);
    setStatus("idle");
    setIsOpen(false);
  }, [incomingCall]);

  const leaveCall = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.emit("call:leave", { roomId: activeRoomId });
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
    const nextEnabled = !tracks[0].enabled;
    tracks.forEach((track) => {
      track.enabled = nextEnabled;
    });
    setIsAudioEnabled(nextEnabled);
  }, [ensureMedia]);

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

    if (screenControlTargetRef.current && ownerId === screenControlTargetRef.current) {
      socketRef.current.emit("call:control:stop", {
        roomId: activeRoomRef.current,
        to: ownerId,
      });
      setScreenControlTarget(null);
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
    socketRef.current.emit("call:control:event", {
      roomId: activeRoomRef.current,
      to: targetSocketId,
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
      selectedInvitees,
      incomingCall,
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
      isScreenSharing: Boolean(localScreenStream),
      videoEffects,
      setVideoEffects,
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
      startScreenShare,
      stopScreenShare,
      screenControlRequests,
      pendingScreenControlTargets,
      activeScreenController,
      screenControlTarget,
      screenControlCursor,
      requestScreenControl,
      grantScreenControl,
      denyScreenControl,
      stopScreenControl,
      sendScreenControlEvent,
      sendMessage,
    }),
    [
      acceptCall,
      closeCallComposer,
      declineCall,
      error,
      e2eeDebug,
      endCall,
      incomingCall,
      isAudioEnabled,
      isOpen,
      isVideoEnabled,
      localScreenStream,
      setVideoEffects,
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
      toggleVideo,
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
