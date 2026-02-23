import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useVideoCall } from "../context/VideoCallContext";
import { useVideoInvitees } from "../hooks/useVideoInvitees";
import { MAX_GROUP_NAME_LENGTH, useFriendGroups } from "../hooks/useFriendGroups";
import VideoCallModal from "../components/VideoCallModal";

const SETTINGS_STORAGE_PREFIX = "video-call-settings";
const SETTINGS_GLOBAL_KEY = `${SETTINGS_STORAGE_PREFIX}:global`;
const DEFAULT_BACKGROUND_COLOR = "rgba(5, 7, 15, 1)";

type VideoAppSettings = {
  theme: "dark" | "light";
  backgroundColor: string;
  backgroundImage: string;
  backgroundImageName: string;
  boxColor: string;
};

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
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "YS";
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
};

const formatName = (displayName?: string, email?: string) => {
  if (displayName) return displayName;
  if (email) return email.split("@")[0];
  return "Member";
};

export default function VideoCallHome() {
  const navigate = useNavigate();
  const { user, profile, logout } = useAuth();
  const {
    openCallComposer,
    status,
    onlineUserIds,
    realtimeStatus,
    realtimeError,
    realtimeUrl,
  } = useVideoCall();
  const { friends, loading, error } = useVideoInvitees();
  const brandName = String(import.meta.env.VITE_APP_NAME || "").trim() || "Your Social Place";
  const {
    groups,
    createGroup,
    renameGroup,
    saveGroup,
    toggleMember,
    setMembers,
    removeGroup,
  } = useFriendGroups();
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const settingsStorageKey = useMemo(
    () => `${SETTINGS_STORAGE_PREFIX}:${user?.id ?? "anon"}`,
    [user?.id]
  );
  const [settings, setSettings] = useState<VideoAppSettings>(() => {
    if (typeof window === "undefined") return { ...DEFAULT_SETTINGS };
    return loadSettings(localStorage.getItem(settingsStorageKey));
  });
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
  const isDesktopShell =
    typeof window !== "undefined" &&
    import.meta.env.MODE === "video" &&
    Boolean(window.yspDesktop?.isAvailable) &&
    !isLikelyMobileDevice;

  const displayName = useMemo(
    () =>
      formatName(
        `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim() ||
          profile?.handle,
        user?.email
      ),
    [profile?.firstName, profile?.handle, profile?.lastName, user?.email]
  );

  const initials = useMemo(() => getInitials(displayName), [displayName]);
  const avatarUrl = profile?.avatarUrl || "";
  const onlineCount = useMemo(
    () => friends.filter((friend) => onlineUserIds.has(friend.userId)).length,
    [friends, onlineUserIds]
  );
  const friendIds = useMemo(
    () => friends.map((friend) => friend.userId).filter((id) => Number.isFinite(id)),
    [friends]
  );
  const appStyle = useMemo(() => {
    const style: CSSProperties = {};
    const vars = style as Record<string, string>;
    const backgroundColor = settings.backgroundColor.trim();
    const backgroundImage = settings.backgroundImage.trim();
    const boxColor = settings.boxColor.trim();
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
    } else if (hasCustomBackground) {
      vars["--video-app-bg-image"] = "none";
    }
    if (boxColor) {
      vars["--video-box-bg"] = boxColor;
    }
    return style;
  }, [settings.backgroundColor, settings.backgroundImage, settings.boxColor]);

  const handleLogout = () => {
    logout("user-action");
    navigate("/login");
  };

  const handleCreateGroup = () => {
    const group = createGroup();
    setActiveGroupId(group.id);
  };

  const handleCallGroup = (groupId: string) => {
    const group = groups.find((entry) => entry.id === groupId);
    if (!group) return;
    if (group.isDraft || !group.name.trim()) return;
    const invitees = friends.filter((friend) => group.memberIds.includes(friend.userId));
    if (!invitees.length) return;
    openCallComposer(invitees);
  };

  const handleCallFriend = (friend: (typeof friends)[number]) => {
    if (!friend?.userId) return;
    openCallComposer([friend]);
  };

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (user) {
      document.title = `${displayName} | ${brandName}`;
    } else {
      document.title = `${brandName} | Video Call`;
    }
  }, [brandName, displayName, user]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setSettings(loadSettings(localStorage.getItem(settingsStorageKey)));
  }, [settingsStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(settingsStorageKey, JSON.stringify(settings));
    localStorage.setItem(SETTINGS_GLOBAL_KEY, JSON.stringify(settings));
  }, [settings, settingsStorageKey]);

  const showRealtimeBanner = Boolean(user) && realtimeStatus !== "connected";

  return (
    <div
      className={`video-app${isDesktopShell ? " is-desktop-shell" : ""}${
        status !== "idle" ? " is-call-active" : ""
      }`}
      data-theme={settings.theme}
      style={appStyle}
    >
      {isDesktopShell && (
        <div className="video-app__titlebar-actions">
          <button
            className="video-app__titlebar-logout"
            type="button"
            onClick={handleLogout}
            title="Log out"
          >
            Log out
          </button>
        </div>
      )}
      {!isDesktopShell && (
        <header className="video-app__header">
          <div className="video-app__brand">
            <span className="video-app__mark" aria-hidden="true">
              <img src="/logo2.png" alt="" />
            </span>
            <div>
              <p className="video-app__eyebrow">{brandName}</p>
              <strong className="video-app__title">Video Call</strong>
            </div>
          </div>
          <div className="video-app__user">
            <div className="video-app__user-menu">
              <div
                className="video-app__avatar"
                aria-hidden="true"
                style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
              >
                {!avatarUrl && initials}
              </div>
            </div>
            <div className="video-app__user-meta">
              <span className="video-app__user-name">{displayName}</span>
              <span className="video-app__user-email">{user?.email}</span>
            </div>
            <button className="video-app__ghost" type="button" onClick={handleLogout}>
              Log out
            </button>
          </div>
        </header>
      )}

      <main className="video-app__main">
        {showRealtimeBanner && (
          <div className="video-app__banner" role="status" data-state={realtimeStatus}>
            <div>
              <strong>
                {realtimeStatus === "connecting"
                  ? "Connecting to realtime…"
                  : "Realtime disconnected"}
              </strong>
              <span>
                {realtimeStatus === "connecting"
                  ? "Online status and calls will appear once connected."
                  : "Online status and calls will not update until connection is restored."}
              </span>
            </div>
            {realtimeStatus === "disconnected" && realtimeError && (
              <span className="video-app__banner-reason">{realtimeError}</span>
            )}
            {realtimeUrl && (
              <span className="video-app__banner-debug">Socket: {realtimeUrl}</span>
            )}
          </div>
        )}
        <section className="video-app__hero">
          {/* <p className="video-app__kicker">Standalone calls</p> */}
          <h1>Jump straight into a call with your people.</h1>
          <p className="video-app__subhead">
            This desktop app keeps the focus on face-to-face accountability and screen sharing
            without the rest of the social feed.
          </p>
          <div className="video-app__actions">
            <button
              className="video-app__primary"
              type="button"
              onClick={() => openCallComposer()}
            >
              Start a video call
            </button>
            <div className="video-app__status">
              <span className={`status-dot status-dot--${status}`} aria-hidden="true" />
              <span>{status === "idle" ? "Ready to call" : status.replace("-", " ")}</span>
            </div>
          </div>
          <div className="video-app__stats">
            <div>
              <span className="video-app__stat-label">Friends</span>
              <strong className="video-app__stat-value">{friends.length}</strong>
            </div>
            <div>
              <span className="video-app__stat-label">Online now</span>
              <strong className="video-app__stat-value">{onlineCount}</strong>
            </div>
          </div>
        </section>

        <section className="video-app__groups">
          <div className="video-app__section-header">
            <h2>Your Groups</h2>
            <button className="video-app__ghost" type="button" onClick={handleCreateGroup}>
              New group
            </button>
          </div>
          {groups.length === 0 && (
            <p className="video-app__empty">
              Create custom groups to call multiple friends at once.
            </p>
          )}
          {groups.length > 0 && (
            <div className="video-app__group-list">
              {groups.map((group) => {
                const memberCount = group.memberIds.length;
                const trimmedName = group.name.trim();
                const isDraft = Boolean(group.isDraft);
                const isNameValid =
                  trimmedName.length > 0 && trimmedName.length <= MAX_GROUP_NAME_LENGTH;
                const hasMembers = friends.some((friend) =>
                  group.memberIds.includes(friend.userId)
                );
                const canCall = !isDraft && isNameValid && hasMembers;
                const callLabel =
                  !isDraft && isNameValid ? `Call ${trimmedName}` : "Call group";
                const isOpen = activeGroupId === group.id;
                const isEditing = isOpen || isDraft;
                return (
                  <div
                    key={group.id}
                    className={`video-app__group-card${isEditing ? " is-open" : ""}`}
                  >
                    {isEditing ? (
                      <>
                        <div className="video-app__group-header">
                          <input
                            className="video-app__group-name"
                            value={group.name}
                            onChange={(event) => renameGroup(group.id, event.target.value)}
                            onBlur={(event) => {
                              const next = event.currentTarget.value.trim();
                              if (next !== event.currentTarget.value) {
                                renameGroup(group.id, next);
                              }
                            }}
                            maxLength={MAX_GROUP_NAME_LENGTH}
                            aria-label="Group name"
                          />
                          <div className="video-app__group-actions">
                            {isDraft && (
                              <button
                                className="video-app__primary"
                                type="button"
                                onClick={() => {
                                  saveGroup(group.id);
                                  if (activeGroupId === group.id) {
                                    setActiveGroupId(null);
                                  }
                                }}
                                disabled={!isNameValid}
                              >
                                Save
                              </button>
                            )}
                            <button
                              className="video-app__primary"
                              type="button"
                              onClick={() => handleCallGroup(group.id)}
                              disabled={!canCall}
                            >
                              {callLabel}
                            </button>
                            {!isDraft && (
                              <button
                                className="video-app__ghost"
                                type="button"
                                onClick={() => setActiveGroupId(isOpen ? null : group.id)}
                              >
                                {isOpen ? "Close" : "Edit Group"}
                              </button>
                            )}
                            <button
                              className="video-app__ghost is-danger"
                              type="button"
                              onClick={() => {
                                if (activeGroupId === group.id) setActiveGroupId(null);
                                removeGroup(group.id);
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                        <div className="video-app__group-meta">
                          {memberCount} {memberCount === 1 ? "member" : "members"}
                        </div>
                        {isEditing && (
                          <div className="video-app__group-body">
                            <div className="video-app__group-toolbar">
                              <button
                                className="video-app__ghost"
                                type="button"
                                onClick={() => setMembers(group.id, friendIds)}
                                disabled={friendIds.length === 0}
                              >
                                Select all
                              </button>
                              <button
                                className="video-app__ghost"
                                type="button"
                                onClick={() => setMembers(group.id, [])}
                              >
                                Clear
                              </button>
                            </div>
                            <div className="video-app__group-members">
                              {friends.map((friend) => {
                                const checked = group.memberIds.includes(friend.userId);
                                return (
                                  <label key={friend.userId} className="video-app__group-option">
                                    <div className="video-app__group-option-text">
                                      <span className="video-app__group-option-name">
                                        {friend.displayName}
                                      </span>
                                      <span className="video-app__group-option-handle">
                                        {friend.handle ? `@${friend.handle}` : "Friend"}
                                      </span>
                                    </div>
                                    <span className="video-app__group-toggle">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggleMember(group.id, friend.userId)}
                                        aria-label={`Select ${friend.displayName}`}
                                      />
                                      <span className="video-app__group-toggle-track">
                                        <span className="video-app__group-toggle-thumb" />
                                      </span>
                                    </span>
                                  </label>
                                );
                              })}
                              {friends.length === 0 && (
                                <p className="video-app__empty">
                                  No friends available. Add friends on the web app first.
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="video-app__group-header">
                        <div className="video-app__group-actions">
                          <button
                            className="video-app__primary"
                            type="button"
                            onClick={() => handleCallGroup(group.id)}
                            disabled={!canCall}
                          >
                            {callLabel}
                          </button>
                          <button
                            className="video-app__ghost"
                            type="button"
                            onClick={() => setActiveGroupId(group.id)}
                          >
                            Edit Group
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="video-app__friends">
          <div className="video-app__section-header">
            <h2>Your Friends</h2>
            {loading && <span className="video-app__hint">Syncing friends...</span>}
          </div>

          {error && <p className="video-app__error">{error}</p>}

          {!loading && !error && friends.length === 0 && (
            <p className="video-app__empty">
              No friends to invite yet. Add friends on the web app to start calling.
            </p>
          )}

          {friends.length > 0 && (
            <div className="video-app__friend-grid">
              {friends.map((friend) => {
                const isOnline = onlineUserIds.has(friend.userId);
                return (
                  <button
                    key={friend.userId}
                    type="button"
                    className="video-app__friend"
                    onClick={() => handleCallFriend(friend)}
                    aria-label={`Start a video call with ${friend.displayName}`}
                  >
                    <div
                      className="video-app__friend-avatar"
                      style={
                        friend.avatarUrl
                          ? { backgroundImage: `url(${friend.avatarUrl})` }
                          : undefined
                      }
                    >
                      {!friend.avatarUrl && getInitials(friend.displayName)}
                    </div>
                    <div className="video-app__friend-meta">
                      <span className="video-app__friend-name">{friend.displayName}</span>
                      <span className="video-app__friend-handle">
                        {friend.handle ? `@${friend.handle}` : "Friend"}
                      </span>
                    </div>
                    <span className={`video-app__presence ${isOnline ? "is-online" : "is-offline"}`}>
                      {isOnline ? "Online" : "Offline"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <VideoCallModal friends={friends} appSettings={settings} onSettingsChange={setSettings} />
    </div>
  );
}
