import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type MouseEventHandler,
  type PointerEvent,
  type PointerEventHandler,
  type Ref,
  type WheelEvent,
  type WheelEventHandler,
} from "react";
import { createPortal } from "react-dom";
import {
  useVideoCall,
  type VideoCallInvitee,
  type VideoCallMessage,
} from "../context/VideoCallContext";
import { sanitizePostText } from "../utils/emoji";
import callRingtoneUrl from "../assets/call.mp3";

type VideoCallModalProps = {
  friends: VideoCallInvitee[];
};

type PanOffset = {
  x: number;
  y: number;
};

const EMOJIS = [
  "\u{1F44D}",
  "\u{1F44E}",
  "\u{1F44F}",
  "\u{1F44A}",
  "\u{1F91D}",
  "\u{1F64F}",
  "\u{1F64C}",
  "\u{1F4AA}",
  "\u{1F525}",
  "\u{1F4AF}",
  "\u{2728}",
  "\u{1F389}",
  "\u{1F38A}",
  "\u{1F381}",
  "\u{1F3C6}",
  "\u{1F680}",
  "\u{1F4A1}",
  "\u{1F31F}",
  "\u{1F60E}",
  "\u{1F60A}",
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
  "\u{1F984}",
  "\u{1F33F}",
  "\u{1F339}",
  "\u{1F30A}",
  "\u{1F387}",
  "\u{2764}",
  "\u{1F49A}",
  "\u{1F499}",
];

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

const BACKGROUND_OPTIONS = [
  { id: "none", label: "None" },
  { id: "backdrop1", label: "Valley" },
  { id: "backdrop2", label: "Autumn Forest" },
  { id: "backdrop3", label: "River Valley" },
  { id: "backdrop4", label: "Mountain Lake" },
  { id: "backdrop5", label: "Grass Meadow" },
  { id: "backdrop6", label: "Lavender Lake" },
  { id: "backdrop7", label: "Misty River" },
  { id: "backdrop8", label: "Stormy Sea" },
  { id: "backdrop9", label: "Floral Essence" },
  { id: "backdrop10", label: "Overlooking Valley" },
];

const FILTER_OPTIONS = [
  { id: "none", label: "Clean" },
  { id: "vivid", label: "Vivid" },
  { id: "crisp", label: "Crisp" },
  { id: "cinema", label: "Cinema" },
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

const getInitials = (value: string) => {
  const parts = String(value || "").trim().split(/\s+/);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return `${parts[0].charAt(0)}${parts[parts.length - 1].charAt(0)}`.toUpperCase();
};

const clampValue = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

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

const formatMessage = (message: VideoCallMessage) => {
  if (message.kind === "emoji") return message.body;
  if (message.kind === "gif") return "GIF";
  return message.body;
};

export default function VideoCallModal({ friends }: VideoCallModalProps) {
  const {
    isOpen,
    status,
    selectedInvitees,
    incomingCall,
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
    setAudioInputDevice,
    setVideoInputDevice,
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
  } = useVideoCall();

  const [chatInput, setChatInput] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [showEffectsPanel, setShowEffectsPanel] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [screenViewMode, setScreenViewMode] = useState<"split" | "screen" | "video">("split");
  const [isChatVisible, setIsChatVisible] = useState(true);
  const [isScreenBorderless, setIsScreenBorderless] = useState(false);
  const [fullscreenTargetId, setFullscreenTargetId] = useState<string | null>(null);
  const [isPopout, setIsPopout] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"video" | "chat">("video");
  const [pipPosition, setPipPosition] = useState<{ x: number; y: number } | null>(null);
  const [isPipDragging, setIsPipDragging] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [screenZoomLevels, setScreenZoomLevels] = useState<Record<string, number>>({});
  const [screenPanOffsets, setScreenPanOffsets] = useState<Record<string, PanOffset>>({});
  const [activePanTarget, setActivePanTarget] = useState<string | null>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioInputError, setAudioInputError] = useState<string | null>(null);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceInfo[]>([]);
  const [videoInputError, setVideoInputError] = useState<string | null>(null);
  const [popoutContainer, setPopoutContainer] = useState<HTMLDivElement | null>(null);
  const ringtoneRef = useRef<{ audio: HTMLAudioElement | null }>({
    audio: null,
  });
  const ringbackRef = useRef<{ ctx: AudioContext | null; timer: number | null }>({
    ctx: null,
    timer: null,
  });
  const controlThrottleRef = useRef(0);
  const screenTileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const gridRef = useRef<HTMLDivElement | null>(null);
  const popoutWindowRef = useRef<Window | null>(null);
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

  const showModal = isOpen || status === "incoming";
  const showCallUi = status === "in-call" || status === "connecting";
  const showChat = showCallUi && (isChatVisible || mobilePanel === "chat");
  const isChatHidden = showCallUi && !isChatVisible && mobilePanel !== "chat";
  const isRenderingInPopout = Boolean(isPopout && popoutContainer);
  const overlayClassName = `video-call-overlay${isRenderingInPopout ? " is-popout" : ""}`;
  const modalClassName = `video-call-modal${showCallUi ? "" : " is-setup"}${
    isChatHidden ? " is-chat-hidden" : ""
  }${isRenderingInPopout ? " is-popout" : ""}${
    mobilePanel === "chat" ? " is-mobile-chat" : " is-mobile-video"
  }`;

  useEffect(() => {
    screenPanOffsetsRef.current = screenPanOffsets;
  }, [screenPanOffsets]);

  useEffect(() => {
    if (!showCallUi) {
      setIsPopout(false);
      setMobilePanel("video");
      setShowEffectsPanel(false);
    }
  }, [showCallUi]);

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

  const remoteList = useMemo(
    () => Object.values(remoteParticipants),
    [remoteParticipants]
  );
  const participantNameById = useMemo(() => {
    const map = new Map<number, string>();
    Object.values(remoteParticipants).forEach((participant) => {
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
  }, [friends, remoteParticipants, selectedInvitees]);
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
  const resolveMessageName = useCallback(
    (message: VideoCallMessage) => {
      return resolveParticipantLabel({
        userId: message.from.userId,
        displayName: message.from.displayName,
        handle: message.from.handle,
      });
    },
    [resolveParticipantLabel]
  );
  const incomingHostName = useMemo(() => {
    if (!incomingCall) return "Caller";
    return resolveParticipantLabel({
      userId: incomingCall.hostId,
      displayName: incomingCall.hostName,
      handle: incomingCall.hostHandle,
    });
  }, [incomingCall, resolveParticipantLabel]);
  const hasRemoteMedia = useMemo(() => {
    if (remoteList.length > 0) return true;
    if (Object.keys(remoteStreams).length > 0) return true;
    return Object.keys(remoteScreenStreams).length > 0;
  }, [remoteList.length, remoteScreenStreams, remoteStreams]);

  const screenShareEntries = useMemo(() => {
    const entries: Array<{
      id: string;
      stream: MediaStream;
      label: string;
      isLocal: boolean;
      socketId?: string;
    }> = [];
    if (localScreenStream) {
      entries.push({
        id: "local",
        stream: localScreenStream,
        label: "Your screen",
        isLocal: true,
      });
    }
    Object.entries(remoteScreenStreams).forEach(([socketId, stream]) => {
      const participant = remoteParticipants[socketId];
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
  }, [localScreenStream, remoteParticipants, remoteScreenStreams, resolveParticipantLabel]);

  const hasScreenShares = screenShareEntries.length > 0;
  const effectiveViewMode = hasScreenShares ? screenViewMode : "video";
  const showScreenTiles = effectiveViewMode !== "video";
  const showVideoTiles = effectiveViewMode !== "screen";
  const primaryVideoSocketId = remoteList[0]?.socketId || "local";
  const isLocalPrimary = primaryVideoSocketId === "local";
  const primaryScreenTileId = useMemo(() => {
    if (!showScreenTiles || screenShareEntries.length === 0) return null;
    const remoteEntry = screenShareEntries.find((entry) => !entry.isLocal);
    const entry = remoteEntry || screenShareEntries[0];
    if (!entry) return null;
    return entry.isLocal ? "screen-local" : `screen-${entry.socketId || entry.id}`;
  }, [screenShareEntries, showScreenTiles]);
  const gridClassName = `video-call-grid${
    effectiveViewMode === "screen"
      ? " is-screen-only"
      : effectiveViewMode === "video"
      ? " is-video-only"
      : " is-split"
  }${isScreenBorderless ? " is-borderless" : ""}`;

  useEffect(() => {
    if (hasScreenShares && !prevHasScreenSharesRef.current && screenViewMode === "video") {
      setScreenViewMode("split");
    }
    prevHasScreenSharesRef.current = hasScreenShares;
  }, [hasScreenShares, screenViewMode]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia("(max-width: 720px)");
    const handleChange = () => setIsMobileLayout(media.matches);
    handleChange();
    if (media.addEventListener) {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

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
      if (!isMobileLayout || isLocalPrimary) return;
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
    [isLocalPrimary, isMobileLayout]
  );

  const handlePipPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!pipDragRef.current.active || !isMobileLayout || isLocalPrimary) return;
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
    [isLocalPrimary, isMobileLayout]
  );

  const handlePipPointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!pipDragRef.current.active) return;
    pipDragRef.current.active = false;
    setIsPipDragging(false);
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
    node.requestFullscreen?.().catch(() => undefined);
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const element = document.fullscreenElement as HTMLElement | null;
      const id = element?.dataset?.screenId || null;
      setFullscreenTargetId(id);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const localEffectClass = useMemo(() => {
    const classes = [];
    if (videoEffects.background !== "none") {
      classes.push(`has-backdrop-${videoEffects.background}`);
    }
    return classes.join(" ");
  }, [videoEffects.background]);

  const previewStatus = !localStream ? "Camera off" : isVideoEnabled ? "" : "Camera off";
  const micSelectionValue = selectedAudioInputId || "default";
  const showMicSelector = audioInputs.length > 1;
  const cameraSelectionValue = selectedVideoInputId || "default";
  const showCameraSelector = videoInputs.length > 1;

  const totalParticipants = 1 + remoteList.length;
  const maxInvitees = maxParticipants - 1;

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
    if (!chatInput) {
      sendMessage(emoji, "emoji");
    } else {
      setChatInput((prev) => `${prev}${emoji}`);
    }
    setShowEmojiPicker(false);
  };

  const handleGifPick = (gifUrl: string) => {
    sendMessage(gifUrl, "gif", gifUrl);
    setShowGifPicker(false);
  };

  const handleReaction = (emoji: string) => {
    sendMessage(emoji, "emoji");
  };

  const getScreenZoom = useCallback(
    (targetId: string) => screenZoomLevels[targetId] ?? 1,
    [screenZoomLevels]
  );

  const updateScreenZoom = useCallback((targetId: string, nextZoom: number) => {
    const clamped = Math.min(3, Math.max(1, nextZoom));
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
      if (target?.closest(".screen-share-actions")) return;
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
    if (target?.closest(".screen-share-actions")) return;
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

  const handleControlPointerDown = (
    event: PointerEvent<HTMLDivElement>,
    targetSocketId: string
  ) => {
    if (screenControlTarget !== targetSocketId) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
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

  if (!showModal) return null;

  const modalContent = (
    <div className={overlayClassName}>
      <div className={modalClassName}>
        <div className="video-call-main">
          <div className="video-call-header">
            <div>
              <p className="video-call-eyebrow">
                {status === "incoming" ? "Incoming video call" : "Video room"}
              </p>
              <h3 className="video-call-title">
                {status === "incoming"
                  ? incomingHostName
                  : status === "setup"
                  ? "Start a video call"
                  : "Live video call"}
              </h3>
            </div>
            <div className="video-call-meta">
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

          {showCallUi && (
            <div className="video-call-toolbar">
              <div className="video-call-toolbar-group">
                <span className="video-call-toolbar-label">View</span>
                <button
                  type="button"
                  className={`video-view-button${
                    effectiveViewMode === "split" ? " is-active" : ""
                  }`}
                  onClick={() => setScreenViewMode("split")}
                >
                  Split
                </button>
                <button
                  type="button"
                  className={`video-view-button${
                    effectiveViewMode === "screen" ? " is-active" : ""
                  }`}
                  onClick={() => setScreenViewMode("screen")}
                  disabled={!hasScreenShares}
                >
                  Screen
                </button>
                <button
                  type="button"
                  className={`video-view-button${
                    effectiveViewMode === "video" ? " is-active" : ""
                  }`}
                  onClick={() => setScreenViewMode("video")}
                >
                  Video
                </button>
              </div>
              <div className="video-call-toolbar-group">
                <button
                  type="button"
                  className={`video-view-button${isScreenBorderless ? " is-active" : ""}`}
                  onClick={() => setIsScreenBorderless((prev) => !prev)}
                  disabled={!hasScreenShares}
                >
                  {isScreenBorderless ? "Windowed" : "Borderless"}
                </button>
                <button
                  type="button"
                  className={`video-view-button is-chat-toggle${showChat ? " is-active" : ""}`}
                  onClick={() => setIsChatVisible((prev) => !prev)}
                  disabled={!showCallUi}
                >
                  {showChat ? "Hide chat" : "Show chat"}
                </button>
              </div>
              <div className="video-call-toolbar-group is-mobile-only">
                <span className="video-call-toolbar-label">Panel</span>
                <button
                  type="button"
                  className={`video-view-button${mobilePanel === "video" ? " is-active" : ""}`}
                  onClick={() => setMobilePanel("video")}
                >
                  Video
                </button>
                <button
                  type="button"
                  className={`video-view-button${mobilePanel === "chat" ? " is-active" : ""}`}
                  onClick={() => setMobilePanel("chat")}
                >
                  Chat
                </button>
              </div>
              <div className="video-call-toolbar-group">
                <button
                  type="button"
                  className={`video-view-button${isPopout ? " is-active" : ""}`}
                  onClick={() => setIsPopout((prev) => !prev)}
                  aria-pressed={isPopout}
                >
                  {isPopout ? "Dock" : "Pop out"}
                </button>
              </div>
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
                      <span className="video-preview-label">Mic</span>
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
                <h3>{incomingHostName}</h3>
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
                {showScreenTiles &&
                  screenShareEntries.map((entry) => {
                    const tileId = entry.isLocal
                      ? "screen-local"
                      : `screen-${entry.socketId || entry.id}`;
                    const isFullscreen = fullscreenTargetId === tileId;
                    const isPrimary = tileId === primaryScreenTileId;
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
                    const zoomLabel = `${Math.round(screenZoom * 100)}%`;
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
                          <div className="screen-share-actions">
                            {activeScreenController && (
                              <span className="screen-share-status">
                                Controlled by{" "}
                                {resolveParticipantLabel({
                                  userId: activeScreenController.userId,
                                  displayName: activeScreenController.displayName,
                                  handle: activeScreenController.handle,
                                })}
                              </span>
                            )}
                            <button
                              type="button"
                              className="screen-share-control"
                              onClick={() => toggleFullscreen(tileId)}
                            >
                              {isFullscreen ? "Exit full screen" : "Full screen"}
                            </button>
                            <div className="screen-share-zoom">
                              <button
                                type="button"
                                className="screen-share-control"
                                onClick={() => updateScreenZoom(zoomKey, screenZoom - 0.25)}
                                disabled={screenZoom <= 1}
                                aria-label="Zoom out"
                              >
                                -
                              </button>
                              <span className="screen-share-zoom-label">{zoomLabel}</span>
                              <button
                                type="button"
                                className="screen-share-control"
                                onClick={() => updateScreenZoom(zoomKey, screenZoom + 0.25)}
                                disabled={screenZoom >= 3}
                                aria-label="Zoom in"
                              >
                                +
                              </button>
                            </div>
                            <button
                              type="button"
                              className="screen-share-control"
                              onClick={() => setIsScreenBorderless((prev) => !prev)}
                            >
                              {isScreenBorderless ? "Windowed" : "Borderless"}
                            </button>
                            <button
                              type="button"
                              className="screen-share-control is-chat-toggle"
                              onClick={() => setIsChatVisible((prev) => !prev)}
                            >
                              {showChat ? "Hide chat" : "Show chat"}
                            </button>
                            {activeScreenController && (
                              <button
                                type="button"
                                className="screen-share-control"
                                onClick={() =>
                                  stopScreenControl(activeScreenController.socketId)
                                }
                              >
                                Stop control
                              </button>
                            )}
                          </div>
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
                    const targetZoomLabel = `${Math.round(targetZoom * 100)}%`;

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
                        tabIndex={isControlling ? 0 : undefined}
                        rootRef={registerScreenTile(tileId)}
                        dataScreenId={tileId}
                      >
                        <div className="screen-share-actions">
                          <button
                            type="button"
                            className="screen-share-control"
                            onClick={() => toggleFullscreen(tileId)}
                          >
                            {isFullscreen ? "Exit full screen" : "Full screen"}
                          </button>
                          <div className="screen-share-zoom">
                            <button
                              type="button"
                              className="screen-share-control"
                              onClick={() => updateScreenZoom(targetZoomKey, targetZoom - 0.25)}
                              disabled={targetZoom <= 1}
                              aria-label="Zoom out"
                            >
                              -
                            </button>
                            <span className="screen-share-zoom-label">{targetZoomLabel}</span>
                            <button
                              type="button"
                              className="screen-share-control"
                              onClick={() => updateScreenZoom(targetZoomKey, targetZoom + 0.25)}
                              disabled={targetZoom >= 3}
                              aria-label="Zoom in"
                            >
                              +
                            </button>
                          </div>
                          <button
                            type="button"
                            className="screen-share-control"
                            onClick={() => setIsScreenBorderless((prev) => !prev)}
                          >
                            {isScreenBorderless ? "Windowed" : "Borderless"}
                          </button>
                          <button
                            type="button"
                            className="screen-share-control is-chat-toggle"
                            onClick={() => setIsChatVisible((prev) => !prev)}
                          >
                            {showChat ? "Hide chat" : "Show chat"}
                          </button>
                          {isControlling ? (
                            <button
                              type="button"
                              className="screen-share-control"
                              onClick={() => stopScreenControl(targetId)}
                            >
                              Stop control
                            </button>
                          ) : isPending ? (
                            <span className="screen-share-status">Control requested</span>
                          ) : (
                            <button
                              type="button"
                              className="screen-share-control"
                              onClick={() => requestScreenControl(targetId)}
                            >
                              Take control
                            </button>
                          )}
                        </div>
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
                {showVideoTiles && (
                  <>
                    <VideoTile
                      stream={localStream}
                      label="You"
                      muted
                      status={!localStream ? "Camera off" : isVideoEnabled ? "" : "Camera off"}
                      className={`is-local is-self-video${
                        isLocalPrimary ? " is-primary" : ""
                      }${!isLocalPrimary && isMobileLayout ? " is-draggable" : ""}${
                        isPipDragging ? " is-dragging" : ""
                      }${localEffectClass ? ` ${localEffectClass}` : ""}`}
                      style={pipStyle}
                      onPointerDown={handlePipPointerDown}
                      onPointerMove={handlePipPointerMove}
                      onPointerUp={handlePipPointerUp}
                      onPointerLeave={handlePipPointerUp}
                    />
                    {remoteList.map((participant) => (
                      <VideoTile
                        key={participant.socketId}
                        stream={remoteStreams[participant.socketId] || null}
                        label={resolveParticipantLabel({
                          userId: participant.userId,
                          displayName: participant.displayName,
                          handle: participant.handle,
                        })}
                        avatarUrl={participant.avatarUrl}
                        status={
                          remoteStreams[participant.socketId] ? "" : "Waiting for video"
                        }
                        className={
                          participant.socketId === primaryVideoSocketId ? "is-primary" : undefined
                        }
                      />
                    ))}
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
                <button
                  type="button"
                  className="video-call-end-mobile"
                  onClick={() => {
                    void playEndCallTone();
                    if (isCallHost) {
                      endCall();
                    } else {
                      leaveCall();
                    }
                  }}
                >
                  {isCallHost ? "End call" : "Leave call"}
                </button>
              </div>
              {showEffectsPanel && (
                <div className="video-call-effects">
                  <div className="video-preview-row">
                    <div className="video-preview-group">
                      <span className="video-preview-label">Blur</span>
                      <button
                        type="button"
                        className={`video-preview-toggle${videoEffects.blur ? " is-active" : ""}`}
                        onClick={() => setVideoEffects({ blur: !videoEffects.blur })}
                      >
                        {videoEffects.blur ? "On" : "Off"}
                      </button>
                    </div>
                    <div className="video-preview-group">
                      <span className="video-preview-label">Mirror</span>
                      <button
                        type="button"
                        className={`video-preview-toggle${
                          videoEffects.mirror ? " is-active" : ""
                        }`}
                        onClick={() => setVideoEffects({ mirror: !videoEffects.mirror })}
                      >
                        {videoEffects.mirror ? "On" : "Off"}
                      </button>
                    </div>
                  </div>
                  <div className="video-preview-row">
                    <div className="video-preview-group is-wide">
                      <span className="video-preview-label">Camera filter</span>
                      <label className="video-preview-select">
                        <span className="sr-only">Camera filter</span>
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
                  </div>
                  <div className="video-preview-row">
                    <div className="video-preview-group is-wide">
                      <span className="video-preview-label">Background</span>
                      <label className="video-preview-select">
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
                  </div>
                </div>
              )}
              <div className="video-call-controls">
                <button
                  type="button"
                  className={`video-control${isAudioEnabled ? "" : " is-off"}`}
                  onClick={toggleAudio}
                >
                  {isAudioEnabled ? "Mic on" : "Mic off"}
                </button>
                {showMicSelector && (
                  <label className="video-control-select">
                    <span className="sr-only">Microphone</span>
                    <select
                      value={micSelectionValue}
                      onChange={(e) => void setAudioInputDevice(e.target.value)}
                    >
                      <option value="default">Default mic</option>
                      {audioInputs.map((device, index) => (
                        <option key={device.deviceId || String(index)} value={device.deviceId}>
                          {device.label || `Microphone ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className={`video-control${isVideoEnabled ? "" : " is-off"}`}
                  onClick={toggleVideo}
                >
                  {isVideoEnabled ? "Cam on" : "Cam off"}
                </button>
                {showCameraSelector && (
                  <label className="video-control-select">
                    <span className="sr-only">Camera</span>
                    <select
                      value={cameraSelectionValue}
                      onChange={(e) => void setVideoInputDevice(e.target.value)}
                    >
                      <option value="default">Default camera</option>
                      {videoInputs.map((device, index) => (
                        <option key={device.deviceId || String(index)} value={device.deviceId}>
                          {device.label || `Camera ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <button
                  type="button"
                  className={`video-control${isScreenSharing ? " is-active" : ""}`}
                  onClick={() =>
                    isScreenSharing ? stopScreenShare() : void startScreenShare()
                  }
                >
                  {isScreenSharing ? "Stop share" : "Share screen"}
                </button>
                <button
                  type="button"
                  className={`video-control ghost${showEffectsPanel ? " is-active" : ""}`}
                  onClick={() => setShowEffectsPanel((prev) => !prev)}
                  aria-pressed={showEffectsPanel}
                >
                  Effects
                </button>
                <button type="button" className="video-control ghost" onClick={leaveCall}>
                  Leave call
                </button>
                {isCallHost && (
                  <button
                    type="button"
                    className="video-control end"
                    onClick={() => {
                      void playEndCallTone();
                      endCall();
                    }}
                  >
                    End call
                  </button>
                )}
              </div>
              {(audioInputError || videoInputError) && (
                <div className="video-control-status">
                  {audioInputError || videoInputError}
                </div>
              )}
            </>
          )}
        </div>

        <div className="video-call-sidebar">
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
                Video
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
              messages.map((message) => (
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
                    {message.kind === "gif" && message.gifUrl ? (
                      <img src={message.gifUrl} alt="GIF" loading="lazy" />
                    ) : (
                      <span>{formatMessage(message)}</span>
                    )}
                  </div>
                </div>
              ))
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
                {"\u{1F603}"}
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
            </div>
            <div className="video-chat-reactions">
              {REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  className="video-chat-reaction"
                  onClick={() => handleReaction(emoji)}
                  aria-label={`React with ${emoji}`}
                  disabled={!showCallUi}
                >
                  {emoji}
                </button>
              ))}
            </div>
            {showEmojiPicker && (
              <div className="video-chat-picker">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="video-chat-emoji"
                    onClick={() => handleEmojiPick(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
            {showGifPicker && (
              <div className="video-chat-picker is-gif">
                {GIFS.map((gif) => (
                  <button
                    key={gif.url}
                    type="button"
                    className="video-chat-gif"
                    onClick={() => handleGifPick(gif.url)}
                  >
                    <img src={gif.url} alt={gif.label} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
            <div className="video-chat-compose">
              <textarea
                className="video-chat-textarea"
                value={chatInput}
                onChange={(event) => setChatInput(sanitizePostText(event.target.value))}
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
      </div>
    </div>
  );

  if (isRenderingInPopout && popoutContainer) {
    return createPortal(modalContent, popoutContainer);
  }

  return modalContent;
}
