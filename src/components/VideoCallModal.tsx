import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type PointerEventHandler,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import {
  useVideoCall,
  type VideoCallInvitee,
  type VideoCallMessage,
} from "../context/VideoCallContext";

type VideoCallModalProps = {
  friends: VideoCallInvitee[];
};

const EMOJIS = [
  "\u{1F44D}",
  "\u{1F44F}",
  "\u{1F525}",
  "\u{1F389}",
  "\u{1F64C}",
  "\u{1F60E}",
  "\u{1F602}",
  "\u{1F60A}",
  "\u{1F62E}",
  "\u{1F622}",
  "\u{1F970}",
  "\u{1F680}",
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
];

const BACKGROUND_OPTIONS = [
  { id: "none", label: "None" },
  { id: "studio", label: "Studio" },
  { id: "sunset", label: "Sunset" },
  { id: "mint", label: "Mint" },
  { id: "aurora", label: "Aurora" },
  { id: "ember", label: "Ember" },
];

const FILTER_OPTIONS = [
  { id: "none", label: "Clean" },
  { id: "vivid", label: "Vivid" },
  { id: "noir", label: "Noir" },
  { id: "warm", label: "Warm" },
  { id: "cool", label: "Cool" },
];

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
  tabIndex,
  rootRef,
  dataScreenId,
  style,
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
  tabIndex?: number;
  rootRef?: Ref<HTMLDivElement>;
  dataScreenId?: string;
  style?: CSSProperties;
}) => {
  const ref = useRef<HTMLVideoElement | null>(null);
  const hasVideo = Boolean(stream?.getVideoTracks().some((track) => track.enabled));

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
      tabIndex={tabIndex}
    >
      {stream && (
        <video
          ref={ref}
          autoPlay
          playsInline
          muted={muted}
          className={`video-tile__media${hasVideo ? "" : " is-hidden"}`}
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
  const [popoutContainer, setPopoutContainer] = useState<HTMLDivElement | null>(null);
  const ringtoneRef = useRef<{ ctx: AudioContext | null; timer: number | null }>({
    ctx: null,
    timer: null,
  });
  const controlThrottleRef = useRef(0);
  const screenTileRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const gridRef = useRef<HTMLDivElement | null>(null);
  const popoutWindowRef = useRef<Window | null>(null);
  const prevHasScreenSharesRef = useRef(false);
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
      const name = participant?.displayName || participant?.handle || "Friend";
      entries.push({
        id: socketId,
        stream,
        label: `${name}'s screen`,
        isLocal: false,
        socketId,
      });
    });
    return entries;
  }, [localScreenStream, remoteParticipants, remoteScreenStreams]);

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
    if (!chatInput.trim()) return;
    sendMessage(chatInput.trim(), "text");
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

  const sendControlPointer = (
    event: PointerEvent<HTMLDivElement>,
    targetSocketId: string,
    type: "move" | "click"
  ) => {
    if (screenControlTarget !== targetSocketId) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const now = performance.now();
    if (type === "move" && now - controlThrottleRef.current < 50) return;
    controlThrottleRef.current = now;
    sendScreenControlEvent(targetSocketId, { type, x, y });
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
      if (ringtoneRef.current.timer) {
        window.clearInterval(ringtoneRef.current.timer);
        ringtoneRef.current.timer = null;
      }
      if (ringtoneRef.current.ctx) {
        ringtoneRef.current.ctx.close().catch(() => undefined);
        ringtoneRef.current.ctx = null;
      }
    };

    if (status !== "connecting") {
      stopRingtone();
      return;
    }

    const startRingtone = async () => {
      try {
        const AudioCtor =
          window.AudioContext ||
          (window as typeof window & { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtor) return;
        const ctx = new AudioCtor();
        ringtoneRef.current.ctx = ctx;
        if (ctx.state === "suspended") {
          await ctx.resume();
        }

        const playRingBurst = (offset: number) => {
          if (!ringtoneRef.current.ctx) return;
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
        ringtoneRef.current.timer = window.setInterval(playCadence, 3200);
      } catch {
        // ignore audio errors
      }
    };

    void startRingtone();

    return () => stopRingtone();
  }, [status]);

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
                  ? incomingCall?.hostName || "Friend"
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
                  </div>
                  <div className="video-preview-row">
                    <div className="video-preview-group is-wide">
                      <span className="video-preview-label">Camera</span>
                      <div className="video-preview-backgrounds">
                        {FILTER_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={`video-preview-bg${
                              videoEffects.filter === option.id ? " is-active" : ""
                            }`}
                            onClick={() =>
                              setVideoEffects({
                                filter: option.id as typeof videoEffects.filter,
                              })
                            }
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="video-preview-row">
                    <div className="video-preview-group is-wide">
                      <span className="video-preview-label">Background</span>
                      <div className="video-preview-backgrounds">
                        {BACKGROUND_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={`video-preview-bg${
                              videoEffects.background === option.id ? " is-active" : ""
                            }`}
                            onClick={() =>
                              setVideoEffects({
                                background: option.id as typeof videoEffects.background,
                              })
                            }
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
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
                <h3>{incomingCall?.hostName || "Friend"}</h3>
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
                        {request.displayName || request.handle || "Friend"} wants control.
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
                    if (entry.isLocal) {
                      return (
                        <VideoTile
                          key={entry.id}
                          stream={entry.stream}
                          label={entry.label}
                          muted
                          badge="Screen"
                          className={`is-screen is-local${isPrimary ? " is-primary" : ""}`}
                          rootRef={registerScreenTile(tileId)}
                          dataScreenId={tileId}
                        >
                          <div className="screen-share-actions">
                            {activeScreenController && (
                              <span className="screen-share-status">
                                Controlled by{" "}
                                {activeScreenController.displayName ||
                                  activeScreenController.handle ||
                                  "Friend"}
                              </span>
                            )}
                            <button
                              type="button"
                              className="screen-share-control"
                              onClick={() => toggleFullscreen(tileId)}
                            >
                              {isFullscreen ? "Exit full screen" : "Full screen"}
                            </button>
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

                    return (
                      <VideoTile
                        key={entry.id}
                        stream={entry.stream}
                        label={entry.label}
                        badge="Screen"
                        className={`is-screen${isControlling ? " is-controlling" : ""}${
                          isPrimary ? " is-primary" : ""
                        }`}
                        onPointerMove={
                          isControlling
                            ? (event) => sendControlPointer(event, targetId, "move")
                            : undefined
                        }
                        onPointerUp={
                          isControlling
                            ? (event) => sendControlPointer(event, targetId, "click")
                            : undefined
                        }
                        onPointerLeave={
                          isControlling
                            ? (event) => sendControlPointer(event, targetId, "move")
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
                        label={participant.displayName || participant.handle || "Friend"}
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
                    endCall();
                  }}
                >
                  End call
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
                  </div>
                  <div className="video-preview-row">
                    <div className="video-preview-group is-wide">
                      <span className="video-preview-label">Camera</span>
                      <div className="video-preview-backgrounds">
                        {FILTER_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={`video-preview-bg${
                              videoEffects.filter === option.id ? " is-active" : ""
                            }`}
                            onClick={() =>
                              setVideoEffects({
                                filter: option.id as typeof videoEffects.filter,
                              })
                            }
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="video-preview-row">
                    <div className="video-preview-group is-wide">
                      <span className="video-preview-label">Background</span>
                      <div className="video-preview-backgrounds">
                        {BACKGROUND_OPTIONS.map((option) => (
                          <button
                            key={option.id}
                            type="button"
                            className={`video-preview-bg${
                              videoEffects.background === option.id ? " is-active" : ""
                            }`}
                            onClick={() =>
                              setVideoEffects({
                                background: option.id as typeof videoEffects.background,
                              })
                            }
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
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
                <button
                  type="button"
                  className={`video-control${isVideoEnabled ? "" : " is-off"}`}
                  onClick={toggleVideo}
                >
                  {isVideoEnabled ? "Cam on" : "Cam off"}
                </button>
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
              </div>
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
                <div key={message.id} className="video-chat-message">
                  <div className="video-chat-meta">
                    <span>{message.from.displayName || "Friend"}</span>
                    <span>
                      {new Date(message.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="video-chat-body">
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
                onChange={(event) => setChatInput(event.target.value)}
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
