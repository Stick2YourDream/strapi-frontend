import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../api/strapi";
import { useNotifications, type FriendRequestPreview } from "../hooks/useNotifications";
import "../css/sidebar.css";

type ProfileSummary = {
  displayName: string;
  avatarUrl?: string;
  handle?: string;
  age?: string;
  hobbies?: string;
  bio?: string;
};

type SidebarProps = {
  active: "dashboard" | "friends" | "me" | "groups";
};

const trimPreviewText = (value?: string, max = 72) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return `${text.slice(0, max - 3)}...`;
};

export default function Sidebar({ active }: SidebarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showMoreProfile, setShowMoreProfile] = useState(false);
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const { counts, total, loading, refresh, markAllRead, previews, acceptFriendRequest } =
    useNotifications(user?.id);
  const [acceptingRequests, setAcceptingRequests] = useState<Record<string, boolean>>({});

  const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
  const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");
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

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      try {
        const res = await api.get(`/profiles?filters[user][id][$eq]=${user.id}&populate=avatar`);
        const entry = res.data?.data?.[0];
        if (!entry) return;
        const attrs = normalize(entry);
        const displayName =
          attrs.firstName || attrs.lastName
            ? `${attrs.firstName || ""} ${attrs.lastName || ""}`.trim()
            : attrs.handle || attrs.username || user.username;
        setProfileSummary({
          displayName,
          handle: attrs.handle || user.username,
          avatarUrl: pickMediaUrl(attrs.avatar),
          age: attrs.age || "",
          hobbies: attrs.hobbies || "",
          bio: attrs.bio || "",
        });
      } catch {
        // ignore sidebar profile errors
      }
    };
    load();
  }, [user]);

  useEffect(() => {
    setShowProfileMenu(false);
    setShowNotifications(false);
  }, [user]);

  // Close mobile menu when the active page changes
  useEffect(() => {
    setMenuOpen(false);
    setShowProfileMenu(false);
    setShowNotifications(false);
  }, [active]);

  const profileCard = useMemo(() => {
    if (!user) return null;
    return {
      displayName:
        profileSummary?.displayName || user.username || user.email || "Me",
      handle: profileSummary?.handle || user.username || user.email || "Profile",
      avatarUrl: profileSummary?.avatarUrl,
    };
  }, [profileSummary, user]);

  const nameForDisplay = profileCard?.displayName || "Me";
  const handleLogoClick = () => {
    navigate("/");
    setMenuOpen(false);
  };

  const handleProfileAction = (path: string) => {
    navigate(path);
    setShowProfileMenu(false);
    setShowNotifications(false);
    setMenuOpen(false);
  };

  const handleNotificationAction = (path: string) => {
    navigate(path);
    setShowProfileMenu(false);
    setShowNotifications(false);
    setMenuOpen(false);
  };

  const toggleMobileMenu = () => {
    setMenuOpen((prev) => !prev);
    setShowNotifications(false);
  };

  // prefer handle if loaded, else username/email
  const secondaryLine = profileCard?.handle || "Profile";
  const fallbackInitial = nameForDisplay.charAt(0).toUpperCase();

  const messagePreviewText = useMemo(() => {
    if (counts.messages <= 0) return "";
    if (!previews.messages) return "You have new messages.";
    const snippet = trimPreviewText(previews.messages.body, 64);
    return snippet
      ? `${previews.messages.senderName} sent you a new message: "${snippet}"`
      : `${previews.messages.senderName} sent you a new message.`;
  }, [counts.messages, previews.messages]);

  const friendPostPreviewText = useMemo(() => {
    if (counts.friendPosts <= 0) return "";
    if (!previews.friendPosts) return "New friend posts are waiting.";
    const snippet = trimPreviewText(
      previews.friendPosts.title || previews.friendPosts.content,
      64
    );
    const owner = previews.friendPosts.ownerName || "A friend";
    return snippet ? `${owner} posted "${snippet}"` : `${owner} shared a new post.`;
  }, [counts.friendPosts, previews.friendPosts]);

  const commentPreviewText = useMemo(() => {
    if (counts.comments <= 0) return "";
    if (!previews.comments) return "New comments are waiting.";
    const snippet = trimPreviewText(previews.comments.body, 64);
    const owner = previews.comments.ownerName || "Someone";
    return snippet ? `${owner} commented: "${snippet}"` : `${owner} commented on your post.`;
  }, [counts.comments, previews.comments]);

  const groupUpdatePreviewText = useMemo(() => {
    if (counts.groupUpdates <= 0) return "";
    if (!previews.groupUpdates) return "New group updates are waiting.";
    const snippet = trimPreviewText(previews.groupUpdates.message, 72);
    if (snippet) return snippet;
    const actor = previews.groupUpdates.actorName;
    return actor ? `${actor} posted a group update.` : "New group update received.";
  }, [counts.groupUpdates, previews.groupUpdates]);

  const likesPreviewText = useMemo(() => {
    if (counts.likes <= 0) return "";
    return counts.likes === 1
      ? "1 new like on your posts."
      : `${counts.likes} new likes on your posts.`;
  }, [counts.likes]);

  const handleAcceptRequest = async (request: FriendRequestPreview) => {
    const key = String(request.id);
    if (acceptingRequests[key]) return;
    setAcceptingRequests((prev) => ({ ...prev, [key]: true }));
    const ok = await acceptFriendRequest(request);
    if (!ok) {
      console.error("Failed to accept friend request");
    }
    setAcceptingRequests((prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  const renderNotificationList = () => (
    <div className="sidebar-notification-list">
      <div className="sidebar-notification-group">
        <button
          type="button"
          className="sidebar-notification-item is-action"
          onClick={() => handleNotificationAction("/friends")}
        >
          <span>New messages</span>
          <span className="sidebar-notification-count">{counts.messages}</span>
        </button>
        {counts.messages > 0 && messagePreviewText && (
          <div className="sidebar-notification-preview">
            <span className="sidebar-notification-preview-text">{messagePreviewText}</span>
          </div>
        )}
      </div>
      <div className="sidebar-notification-group">
        <button
          type="button"
          className="sidebar-notification-item is-action"
          onClick={() => handleNotificationAction("/friends")}
        >
          <span>Friend requests</span>
          <span className="sidebar-notification-count">{counts.requests}</span>
        </button>
        {counts.requests > 0 && (
          <div className="sidebar-notification-preview-list">
            {previews.requests.length > 0 ? (
              previews.requests.map((request) => {
                const key = String(request.id);
                return (
                  <div key={key} className="sidebar-notification-preview-row">
                    <span className="sidebar-notification-preview-text">
                      {request.requesterName} sent you a friend request.
                    </span>
                    <button
                      type="button"
                      className="btn ghost tiny"
                      disabled={acceptingRequests[key]}
                      onClick={() => void handleAcceptRequest(request)}
                    >
                      {acceptingRequests[key] ? "Accepting..." : "Accept"}
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="sidebar-notification-preview">
                <span className="sidebar-notification-preview-text">
                  You have a new friend request.
                </span>
              </div>
            )}
            {previews.requests.length > 0 && counts.requests > previews.requests.length && (
              <div className="sidebar-notification-preview-more">
                +{counts.requests - previews.requests.length} more requests
              </div>
            )}
          </div>
        )}
      </div>
      <div className="sidebar-notification-group">
        <button
          type="button"
          className="sidebar-notification-item is-action"
          onClick={() => handleNotificationAction("/friends")}
        >
          <span>Friend posts</span>
          <span className="sidebar-notification-count">{counts.friendPosts}</span>
        </button>
        {counts.friendPosts > 0 && friendPostPreviewText && (
          <div className="sidebar-notification-preview">
            <span className="sidebar-notification-preview-text">{friendPostPreviewText}</span>
          </div>
        )}
      </div>
      <div className="sidebar-notification-group">
        <button
          type="button"
          className="sidebar-notification-item is-action"
          onClick={() => handleNotificationAction("/groups")}
        >
          <span>Group updates</span>
          <span className="sidebar-notification-count">{counts.groupUpdates}</span>
        </button>
        {counts.groupUpdates > 0 && groupUpdatePreviewText && (
          <div className="sidebar-notification-preview">
            <span className="sidebar-notification-preview-text">
              {groupUpdatePreviewText}
            </span>
          </div>
        )}
      </div>
      <div className="sidebar-notification-group">
        <button
          type="button"
          className="sidebar-notification-item is-action"
          onClick={() => handleNotificationAction("/dashboard")}
        >
          <span>Comments on your posts</span>
          <span className="sidebar-notification-count">{counts.comments}</span>
        </button>
        {counts.comments > 0 && commentPreviewText && (
          <div className="sidebar-notification-preview">
            <span className="sidebar-notification-preview-text">{commentPreviewText}</span>
          </div>
        )}
      </div>
      <div className="sidebar-notification-group">
        <button
          type="button"
          className="sidebar-notification-item is-action"
          onClick={() => handleNotificationAction("/dashboard")}
        >
          <span>Likes on your posts</span>
          <span className="sidebar-notification-count">{counts.likes}</span>
        </button>
        {counts.likes > 0 && likesPreviewText && (
          <div className="sidebar-notification-preview">
            <span className="sidebar-notification-preview-text">{likesPreviewText}</span>
          </div>
        )}
      </div>
      {loading && <div className="sidebar-notification-status">Refreshing...</div>}
      {!loading && total === 0 && (
        <div className="sidebar-notification-status">All caught up.</div>
      )}
    </div>
  );

  return (
    <div className={`sidebar-shell ${menuOpen ? "open" : ""}`}>
      <div className="sidebar-topbar">
        <button className="brand" type="button" onClick={handleLogoClick} style={{ cursor: "pointer" }}>
          <span className="brand-mark">S2YD</span>
          <span className="brand-text">Stick2YourDreams</span>
        </button>
        <div className="mobile-topbar-actions">
          <button
            type="button"
            className={`mobile-avatar-button ${menuOpen ? "is-open" : ""}`}
            onClick={toggleMobileMenu}
            aria-label={`Open profile menu for ${nameForDisplay}`}
          >
            {profileCard?.avatarUrl ? (
              <img
                src={profileCard.avatarUrl}
                alt={nameForDisplay}
                className="mobile-avatar-image"
              />
            ) : (
              <span className="mobile-avatar-fallback" aria-hidden="true">
                {fallbackInitial}
              </span>
            )}
          </button>
          <button
            type="button"
            className="sidebar-bell mobile-topbar-bell"
            aria-label={`Notifications (${total})`}
            onClick={() => {
              setShowNotifications((v) => !v);
              setShowProfileMenu(false);
              setMenuOpen(false);
              refresh();
            }}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 22a2.5 2.5 0 0 0 2.45-2H9.55A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2z"
                fill="currentColor"
              />
            </svg>
            {total > 0 && (
              <span className="sidebar-bell-badge">
                {total > 99 ? "99+" : total}
              </span>
            )}
          </button>
          {menuOpen && (
            <div className="mobile-profile-menu">
              <button
                className="mobile-profile-item"
                type="button"
                onClick={() => handleProfileAction("/dashboard")}
              >
                My Dashboard
              </button>
              <button
                className="mobile-profile-item"
                type="button"
                onClick={() => handleProfileAction("/me")}
              >
                My Profile
              </button>
              <button
                className="mobile-profile-item"
                type="button"
                onClick={() => handleProfileAction("/friends")}
              >
                My Friends
              </button>
              <button
                className="mobile-profile-item"
                type="button"
                onClick={() => handleProfileAction("/groups")}
              >
                My Groups
              </button>
              <button
                className="mobile-profile-item"
                type="button"
                onClick={() => {
                  logout();
                  navigate("/login");
                  setMenuOpen(false);
                }}
              >
                Logout
              </button>
            </div>
          )}
          {showNotifications && (
            <div className="mobile-notification-panel">
              <div className="sidebar-notification-header">
                <strong>Notifications</strong>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={markAllRead}
                  disabled={total === 0}
                >
                  Mark read
                </button>
              </div>
              {renderNotificationList()}
            </div>
          )}
        </div>
      </div>

      <aside className="dash-nav">
        <button className="brand" type="button" onClick={handleLogoClick} style={{ cursor: "pointer" }}>
          <span className="brand-mark">S2YD</span>
          <span className="brand-text">Stick2YourDreams</span>
        </button>
        <div className="nav-actions" style={{ flexDirection: "column", alignItems: "flex-start", gap: "8px", width: "100%" }}>
          {profileCard && (
            <div className="sidebar-profile-slot">
              <div className="sidebar-profile-row">
                <button
                  type="button"
                  className="sidebar-profile-button"
                  onClick={() => {
                    setShowProfileMenu((v) => !v);
                    setShowNotifications(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    background: "transparent",
                    border: "1px solid rgba(255,255,255,0.08)",
                    padding: "10px 12px",
                    borderRadius: "12px",
                    color: "#c7cede",
                    cursor: "pointer",
                  }}
                >
                  {profileCard.avatarUrl ? (
                    <img
                      src={profileCard.avatarUrl}
                      alt={nameForDisplay}
                      className="avatar-octagon"
                      style={{ width: 48, height: 48, borderRadius: "50%" }}
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      style={{
                        width: 48,
                        height: 48,
                        borderRadius: "50%",
                        display: "grid",
                        placeItems: "center",
                        background: "linear-gradient(135deg, #60a5fa, #7c3aed)",
                        color: "#0b0d14",
                        fontWeight: 700,
                      }}
                    >
                      {fallbackInitial}
                    </div>
                  )}
                  <div style={{ textAlign: "left", minWidth: 0 }}>
                    <strong style={{ display: "block" }}>{nameForDisplay}</strong>
                    <span
                      style={{
                        fontSize: "12px",
                        color: "#9ca3af",
                        display: "block",
                        maxWidth: "100%",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={secondaryLine}
                    >
                      {secondaryLine}
                    </span>
                  </div>
                </button>
                <button
                  type="button"
                  className="sidebar-bell"
                  aria-label={`Notifications (${total})`}
                  onClick={() => {
                    setShowNotifications((v) => !v);
                    setShowProfileMenu(false);
                    refresh();
                  }}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M12 22a2.5 2.5 0 0 0 2.45-2H9.55A2.5 2.5 0 0 0 12 22zm7-6V11a7 7 0 1 0-14 0v5l-2 2v1h18v-1l-2-2z"
                      fill="currentColor"
                    />
                  </svg>
                  {total > 0 && (
                    <span className="sidebar-bell-badge">
                      {total > 99 ? "99+" : total}
                    </span>
                  )}
                </button>
              </div>

              {showNotifications && (
                <div className="sidebar-notification-panel">
                  <div className="sidebar-notification-header">
                    <strong>Notifications</strong>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={markAllRead}
                      disabled={total === 0}
                    >
                      Mark read
                    </button>
                  </div>
                  {renderNotificationList()}
                </div>
              )}

              {showProfileMenu && (
                <div
                  style={{
                    position: "absolute",
                    top: "110%",
                    left: 0,
                    right: 0,
                    background: "#0f172a",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: "10px",
                    boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
                    overflow: "hidden",
                    zIndex: 15,
                  }}
                >
                  <button
                    className="btn ghost nav-btn"
                    type="button"
                    style={{ width: "100%", border: "none", borderRadius: 0, justifyContent: "flex-start" }}
                    onClick={() => handleProfileAction("/dashboard")}
                  >
                    My Dashboard
                  </button>
                  <button
                    className="btn ghost nav-btn"
                    type="button"
                    style={{ width: "100%", border: "none", borderRadius: 0, justifyContent: "flex-start" }}
                    onClick={() => handleProfileAction("/me")}
                >
                  My Profile
                </button>
                  <button
                    className="btn ghost nav-btn"
                    type="button"
                    style={{ width: "100%", border: "none", borderRadius: 0, justifyContent: "flex-start" }}
                    onClick={() => handleProfileAction("/friends")}
                  >
                    My Friends
                  </button>
                  <button
                    className="btn ghost nav-btn"
                    type="button"
                    style={{ width: "100%", border: "none", borderRadius: 0, justifyContent: "flex-start" }}
                    onClick={() => handleProfileAction("/groups")}
                  >
                    My Groups
                  </button>
                  <button
                    className="btn ghost nav-btn"
                    type="button"
                    style={{ width: "100%", border: "none", borderRadius: 0, justifyContent: "flex-start" }}
                    onClick={() => {
                      logout();
                      navigate("/login");
                      setShowProfileMenu(false);
                    }}
                  >
                    Logout
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
        {user && (
          <div style={{ marginTop: "12px", width: "100%" }}>
            <button
              className="btn ghost biobutton"
              type="button"
              onClick={() => setShowMoreProfile((v) => !v)}
              style={{ width: "100%", marginBottom: showMoreProfile ? "8px" : 0 }}
            >
              {showMoreProfile ? "Hide details" : "Bio"}
            </button>
            {showMoreProfile && (
              <div className="bio-panel">
                <div className="bio-line"><strong>Name:</strong> {nameForDisplay}</div>
                <div className="bio-line"><strong>Age:</strong> {profileSummary?.age || "-"}</div>
                <div className="bio-line"><strong>Hobbies:</strong> {profileSummary?.hobbies || "-"}</div>
                <div className="bio-line"><strong>Bio:</strong> {profileSummary?.bio || "-"}</div>
              </div>
            )}
          </div>
        )}
      </aside>

      {menuOpen && <button className="sidebar-overlay" type="button" onClick={() => setMenuOpen(false)} aria-label="Close menu overlay" />}
    </div>
  );
}
