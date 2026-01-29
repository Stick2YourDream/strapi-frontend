import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useVideoCall } from "../context/VideoCallContext";
import { useVideoInvitees } from "../hooks/useVideoInvitees";
import { useFriendGroups } from "../hooks/useFriendGroups";
import VideoCallModal from "../components/VideoCallModal";

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
  const { openCallComposer, setSelectedInvitees, status, onlineUserIds } = useVideoCall();
  const { friends, loading, error } = useVideoInvitees();
  const brandName = String(import.meta.env.VITE_APP_NAME || "").trim() || "Your Social Place";
  const {
    groups,
    createGroup,
    renameGroup,
    toggleMember,
    setMembers,
    removeGroup,
  } = useFriendGroups();
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

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

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const handleCreateGroup = () => {
    const group = createGroup("New group");
    setActiveGroupId(group.id);
  };

  const handleCallGroup = (groupId: string) => {
    const group = groups.find((entry) => entry.id === groupId);
    if (!group) return;
    const invitees = friends.filter((friend) => group.memberIds.includes(friend.userId));
    if (!invitees.length) return;
    setSelectedInvitees(invitees);
    openCallComposer();
  };

  useEffect(() => {
    if (typeof document === "undefined") return;
    if (user) {
      document.title = `${displayName} | ${brandName}`;
    } else {
      document.title = `${brandName} | Video Call`;
    }
  }, [brandName, displayName, user]);

  return (
    <div className="video-app">
      <header className="video-app__header">
        <div className="video-app__brand">
          <span className="video-app__mark" aria-hidden="true">
            <img src="/logo.png" alt="" />
          </span>
          <div>
            <p className="video-app__eyebrow">{brandName}</p>
            <strong className="video-app__title">Video Call</strong>
          </div>
        </div>
        <div className="video-app__user">
          <div
            className="video-app__avatar"
            aria-hidden="true"
            style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
          >
            {!avatarUrl && initials}
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

      <main className="video-app__main">
        <section className="video-app__hero">
          <p className="video-app__kicker">Standalone calls</p>
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
            <h2>Groups</h2>
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
                const canCall =
                  friends.some((friend) => group.memberIds.includes(friend.userId));
                const isOpen = activeGroupId === group.id;
                return (
                  <div key={group.id} className={`video-app__group-card${isOpen ? " is-open" : ""}`}>
                    <div className="video-app__group-header">
                      <input
                        className="video-app__group-name"
                        value={group.name}
                        onChange={(event) => renameGroup(group.id, event.target.value)}
                        aria-label="Group name"
                      />
                      <div className="video-app__group-actions">
                        <button
                          className="video-app__primary"
                          type="button"
                          onClick={() => handleCallGroup(group.id)}
                          disabled={!canCall}
                        >
                          Call group
                        </button>
                        <button
                          className="video-app__ghost"
                          type="button"
                          onClick={() => setActiveGroupId(isOpen ? null : group.id)}
                        >
                          {isOpen ? "Close" : "Edit"}
                        </button>
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
                    {isOpen && (
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
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleMember(group.id, friend.userId)}
                                />
                                <span className="video-app__group-option-name">
                                  {friend.displayName}
                                </span>
                                <span className="video-app__group-option-handle">
                                  {friend.handle ? `@${friend.handle}` : "Friend"}
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
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="video-app__friends">
          <div className="video-app__section-header">
            <h2>Invite friends</h2>
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
                  <div key={friend.userId} className="video-app__friend">
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
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <VideoCallModal friends={friends} />
    </div>
  );
}
