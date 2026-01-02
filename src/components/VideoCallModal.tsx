import { useEffect, useMemo, useRef, useState } from "react";
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
}: {
  stream: MediaStream | null;
  label: string;
  avatarUrl?: string;
  muted?: boolean;
  status?: string;
  className?: string;
}) => {
  const ref = useRef<HTMLVideoElement | null>(null);
  const hasVideo = Boolean(stream && stream.getVideoTracks().some((track) => track.enabled));

  useEffect(() => {
    if (!ref.current || !stream || !hasVideo) return;
    ref.current.srcObject = stream;
  }, [hasVideo, stream]);

  return (
    <div className={`video-tile${className ? ` ${className}` : ""}`}>
      {stream && hasVideo ? (
        <video ref={ref} autoPlay playsInline muted={muted} />
      ) : (
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
      <div className="video-tile__meta">
        <span>{label}</span>
      </div>
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
    remoteStreams,
    remoteParticipants,
    messages,
    error,
    maxParticipants,
    isVideoEnabled,
    isAudioEnabled,
    onlineUserIds,
    videoEffects,
    setVideoEffects,
    closeCallComposer,
    setSelectedInvitees,
    startCall,
    acceptCall,
    declineCall,
    leaveCall,
    toggleVideo,
    toggleAudio,
    sendMessage,
  } = useVideoCall();

  const [chatInput, setChatInput] = useState("");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const ringtoneRef = useRef<{ ctx: AudioContext | null; timer: number | null }>({
    ctx: null,
    timer: null,
  });

  const showModal = isOpen || status === "incoming";
  const showCallUi = status === "in-call" || status === "connecting";

  const remoteList = useMemo(
    () => Object.values(remoteParticipants),
    [remoteParticipants]
  );

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

  return (
    <div className="video-call-overlay">
      <div className={`video-call-modal${showCallUi ? "" : " is-setup"}`}>
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
                      <span className="video-preview-label">Background</span>
                      <div className="video-preview-backgrounds">
                        {[
                          { id: "none", label: "None" },
                          { id: "studio", label: "Studio" },
                          { id: "sunset", label: "Sunset" },
                          { id: "mint", label: "Mint" },
                        ].map((option) => (
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
              <div className="video-call-grid">
                <VideoTile
                  stream={localStream}
                  label="You"
                  muted
                  status={!localStream ? "Camera off" : isVideoEnabled ? "" : "Camera off"}
                  className={`is-local ${localEffectClass}`.trim()}
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
                  />
                ))}
                {status === "connecting" && remoteList.length === 0 && (
                  <div className="video-tile is-skeleton">
                    <div className="video-tile__placeholder">
                      <span className="video-tile__status">Connecting to friends...</span>
                    </div>
                  </div>
                )}
              </div>
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
                  className="video-control end"
                  onClick={() => {
                    void playEndCallTone();
                    leaveCall();
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
}
