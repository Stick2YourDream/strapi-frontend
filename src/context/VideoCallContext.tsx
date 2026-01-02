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

type VideoCallEffects = {
  blur: boolean;
  background: "none" | "studio" | "sunset" | "mint";
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
  remoteStreams: Record<string, MediaStream>;
  remoteParticipants: Record<string, VideoCallParticipant>;
  messages: VideoCallMessage[];
  error: string | null;
  maxParticipants: number;
  isVideoEnabled: boolean;
  isAudioEnabled: boolean;
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
  toggleVideo: () => void;
  toggleAudio: () => void;
  sendMessage: (body: string, kind?: VideoCallMessage["kind"], gifUrl?: string) => void;
};

const MAX_VIDEO_PARTICIPANTS = 8;
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
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [remoteParticipants, setRemoteParticipants] = useState<
    Record<string, VideoCallParticipant>
  >({});
  const [messages, setMessages] = useState<VideoCallMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isVideoEnabled, setIsVideoEnabled] = useState(true);
  const [isAudioEnabled, setIsAudioEnabled] = useState(true);
  const [videoEffects, setVideoEffectsState] = useState<VideoCallEffects>({
    blur: false,
    background: "none",
  });
  const [onlineUserIds, setOnlineUserIds] = useState<Set<number>>(new Set());
  const socketRef = useRef<Socket | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const rawStreamRef = useRef<MediaStream | null>(null);
  const videoEffectsRef = useRef(videoEffects);
  const videoProcessingRef = useRef<{
    track: MediaStreamTrack | null;
    cleanup: (() => void) | null;
    sourceId: string | null;
    effectsKey: string;
  }>({ track: null, cleanup: null, sourceId: null, effectsKey: "" });
  const profileRef = useRef<VideoCallInvitee | null>(null);
  const statusRef = useRef<VideoCallStatus>(status);
  const activeRoomRef = useRef<string | null>(activeRoomId);
  const presenceTargetsRef = useRef<number[]>([]);

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
        default:
          gradient.addColorStop(0, "#0b0d14");
          gradient.addColorStop(1, "#0b0d14");
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);
    },
    []
  );

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
        if (!segmenter || segmentationFailed || segmenting) return;
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

        maybeSegment();

        if (!maskSource || !foregroundCtx) {
          ctx.clearRect(0, 0, width, height);
          drawCover(ctx, width, height);
          rafId = window.requestAnimationFrame(drawFrame);
          return;
        }

        const shouldBlur = effects.blur && effects.background === "none";

        foregroundCtx.clearRect(0, 0, width, height);
        drawCover(foregroundCtx, width, height);
        foregroundCtx.globalCompositeOperation = "destination-in";
        foregroundCtx.drawImage(maskSource, 0, 0, width, height);
        foregroundCtx.globalCompositeOperation = "source-over";

        if (effects.background !== "none") {
          drawBackdrop(ctx, width, height, effects.background);
        } else {
          ctx.clearRect(0, 0, width, height);
          ctx.filter = shouldBlur ? "blur(10px)" : "none";
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
    [drawBackdrop]
  );

  const applyVideoEffects = useCallback(() => {
    const rawStream = rawStreamRef.current;
    const rawTrack = rawStream?.getVideoTracks()[0] || null;
    if (!rawTrack) {
      stopVideoProcessing();
      return null;
    }

    const effects = videoEffectsRef.current;
    const needsProcessing = effects.blur || effects.background !== "none";
    if (!needsProcessing) {
      stopVideoProcessing();
      return rawTrack;
    }

    const effectsKey = `${effects.blur ? "1" : "0"}-${effects.background}`;
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
      const stream = localStreamRef.current ?? new MediaStream();

      const existingAudio = stream.getAudioTracks();
      existingAudio.forEach((track) => {
        if (!audioTracks.some((t) => t.id === track.id)) {
          stream.removeTrack(track);
        }
      });
      audioTracks.forEach((track) => {
        if (!stream.getAudioTracks().some((t) => t.id === track.id)) {
          stream.addTrack(track);
        }
      });

      const existingVideo = stream.getVideoTracks();
      existingVideo.forEach((track) => {
        if (!videoTrack || track.id !== videoTrack.id) {
          stream.removeTrack(track);
        }
      });
      if (videoTrack && !stream.getVideoTracks().some((t) => t.id === videoTrack.id)) {
        stream.addTrack(videoTrack);
      }

      setLocalStream(stream);
      localStreamRef.current = stream;

      peersRef.current.forEach((pc) => {
        audioTracks.forEach((track) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === "audio");
          if (sender) {
            if (sender.track?.id !== track.id) {
              sender.replaceTrack(track);
            }
          } else {
            pc.addTrack(track, stream);
          }
        });
        const videoSender = pc.getSenders().find((s) => s.track?.kind === "video");
        if (videoTrack) {
          if (videoSender) {
            if (videoSender.track?.id !== videoTrack.id) {
              videoSender.replaceTrack(videoTrack);
            }
          } else {
            pc.addTrack(videoTrack, stream);
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
    []
  );

  const attachLocalTracks = useCallback((pc: RTCPeerConnection) => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const existing = pc.getSenders().map((sender) => sender.track?.id).filter(Boolean);
    stream.getTracks().forEach((track) => {
      if (existing.includes(track.id)) return;
      pc.addTrack(track, stream);
    });
  }, []);

  const closePeer = useCallback((socketId: string) => {
    const pc = peersRef.current.get(socketId);
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
      peersRef.current.delete(socketId);
    }
    setRemoteStreams((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
    setRemoteParticipants((prev) => {
      const next = { ...prev };
      delete next[socketId];
      return next;
    });
  }, []);

  const createPeerConnection = useCallback(
    (socketId: string) => {
      const existing = peersRef.current.get(socketId);
      if (existing) return existing;
      const pc = new RTCPeerConnection(RTC_CONFIG);
      peersRef.current.set(socketId, pc);
      attachLocalTracks(pc);
      pc.onicecandidate = (event) => {
        if (event.candidate && socketRef.current) {
          socketRef.current.emit("call:ice", {
            to: socketId,
            candidate: event.candidate,
          });
        }
      };
      pc.ontrack = (event) => {
        const [stream] = event.streams;
        if (!stream) return;
        setRemoteStreams((prev) => ({ ...prev, [socketId]: stream }));
      };
      pc.onconnectionstatechange = () => {
        if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
          closePeer(socketId);
        }
      };
      return pc;
    },
    [attachLocalTracks, closePeer]
  );

  useEffect(() => {
    localStreamRef.current = localStream;
    peersRef.current.forEach((pc) => attachLocalTracks(pc));
  }, [attachLocalTracks, localStream]);

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
        const displayName =
          attrs.firstName || attrs.lastName
            ? `${attrs.firstName || ""} ${attrs.lastName || ""}`.trim()
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
    stopVideoProcessing();
  }, [stopVideoProcessing, user?.id]);

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
      }
    );

    socket.on(
      "call:user-joined",
      async (payload: { roomId: string; participant: VideoCallParticipant }) => {
        setRemoteParticipants((prev) => ({
          ...prev,
          [payload.participant.socketId]: payload.participant,
        }));
        try {
          const pc = createPeerConnection(payload.participant.socketId);
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit("call:offer", { to: payload.participant.socketId, sdp: offer });
        } catch (err) {
          setError("Failed to connect to new participant.");
        }
      }
    );

    socket.on("call:user-left", (payload: { socketId: string }) => {
      closePeer(payload.socketId);
    });

    socket.on(
      "call:offer",
      async (payload: { from: string; sdp: RTCSessionDescriptionInit }) => {
        try {
          const pc = createPeerConnection(payload.from);
          await pc.setRemoteDescription(new RTCSessionDescription(payload.sdp));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("call:answer", { to: payload.from, sdp: answer });
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

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setOnlineUserIds(new Set());
    };
  }, [closePeer, createPeerConnection, user?.email, user?.id, user?.username]);

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
        return await ensureMedia({ audio: true, video: false });
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
    setIncomingCall(null);
    setStatus("idle");
    setIsOpen(false);
    setError(null);
  }, []);

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
    stopVideoProcessing();
    resetCallState();
  }, [resetCallState, status, stopVideoProcessing]);

  const setSelectedInvitees = useCallback((invitees: VideoCallInvitee[]) => {
    setSelectedInviteesState(invitees);
  }, []);

  const startCall = useCallback(async () => {
    if (!socketRef.current || !user?.id) return;
    if (selectedInvitees.length > MAX_VIDEO_PARTICIPANTS - 1) {
      setError(`Max ${MAX_VIDEO_PARTICIPANTS} participants per call.`);
      return;
    }
    setError(null);
    setStatus("connecting");
    setIsOpen(true);
    const roomId = createRoomId();
    setActiveRoomId(roomId);
    try {
      await ensureCallMedia();
    } catch {
      setStatus("setup");
      return;
    }
    socketRef.current.emit("call:join", { roomId });
    socketRef.current.emit("call:invite", {
      roomId,
      invitees: selectedInvitees.map((invitee) => invitee.userId),
    });
  }, [ensureCallMedia, selectedInvitees, user?.id]);

  const acceptCall = useCallback(async () => {
    if (!socketRef.current || !incomingCall) return;
    setStatus("connecting");
    setActiveRoomId(incomingCall.roomId);
    setError(null);
    try {
      await ensureCallMedia();
    } catch {
      setStatus("idle");
      setIsOpen(false);
      return;
    }
    socketRef.current.emit("call:join", { roomId: incomingCall.roomId });
    setIncomingCall(null);
  }, [ensureCallMedia, incomingCall]);

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
    peersRef.current.forEach((_, socketId) => closePeer(socketId));
    peersRef.current.clear();
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (rawStreamRef.current) {
      rawStreamRef.current.getTracks().forEach((track) => track.stop());
      rawStreamRef.current = null;
    }
    stopVideoProcessing();
    setLocalStream(null);
    localStreamRef.current = null;
    resetCallState();
  }, [activeRoomId, closePeer, resetCallState, stopVideoProcessing]);

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
      remoteStreams,
      remoteParticipants,
      messages,
      error,
      maxParticipants: MAX_VIDEO_PARTICIPANTS,
      isVideoEnabled,
      isAudioEnabled,
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
      toggleVideo,
      toggleAudio,
      sendMessage,
    }),
    [
      acceptCall,
      closeCallComposer,
      declineCall,
      error,
      incomingCall,
      isAudioEnabled,
      isOpen,
      isVideoEnabled,
      setVideoEffects,
      onlineUserIds,
      leaveCall,
      localStream,
      messages,
      openCallComposer,
      remoteParticipants,
      remoteStreams,
      selectedInvitees,
      videoEffects,
      setPresenceTargets,
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
