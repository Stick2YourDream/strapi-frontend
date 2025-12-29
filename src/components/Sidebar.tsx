import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../api/strapi";
import { useNotifications } from "../hooks/useNotifications";

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

export default function Sidebar({ active }: SidebarProps) {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [showMoreProfile, setShowMoreProfile] = useState(false);
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const { counts, total, loading, refresh, markAllRead } = useNotifications(user?.id);

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
              <div className="sidebar-notification-list">
                <button
                  type="button"
                  className="sidebar-notification-item is-action"
                  onClick={() => handleNotificationAction("/friends")}
                >
                  <span>New messages</span>
                  <span className="sidebar-notification-count">{counts.messages}</span>
                </button>
                <button
                  type="button"
                  className="sidebar-notification-item is-action"
                  onClick={() => handleNotificationAction("/friends")}
                >
                  <span>Friend requests</span>
                  <span className="sidebar-notification-count">{counts.requests}</span>
                </button>
                <button
                  type="button"
                  className="sidebar-notification-item is-action"
                  onClick={() => handleNotificationAction("/friends")}
                >
                  <span>Friend posts</span>
                  <span className="sidebar-notification-count">{counts.friendPosts}</span>
                </button>
                <button
                  type="button"
                  className="sidebar-notification-item is-action"
                  onClick={() => handleNotificationAction("/groups")}
                >
                  <span>Group updates</span>
                  <span className="sidebar-notification-count">{counts.groupUpdates}</span>
                </button>
                <button
                  type="button"
                  className="sidebar-notification-item is-action"
                  onClick={() => handleNotificationAction("/dashboard")}
                >
                  <span>Comments on your posts</span>
                  <span className="sidebar-notification-count">{counts.comments}</span>
                </button>
                <button
                  type="button"
                  className="sidebar-notification-item is-action"
                  onClick={() => handleNotificationAction("/dashboard")}
                >
                  <span>Likes on your posts</span>
                  <span className="sidebar-notification-count">{counts.likes}</span>
                </button>
                {loading && (
                  <div className="sidebar-notification-status">Refreshing...</div>
                )}
                {!loading && total === 0 && (
                  <div className="sidebar-notification-status">All caught up.</div>
                )}
              </div>
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
                  <div className="sidebar-notification-list">
                    <button
                      type="button"
                      className="sidebar-notification-item is-action"
                      onClick={() => handleNotificationAction("/friends")}
                    >
                      <span>New messages</span>
                      <span className="sidebar-notification-count">{counts.messages}</span>
                    </button>
                    <button
                      type="button"
                      className="sidebar-notification-item is-action"
                      onClick={() => handleNotificationAction("/friends")}
                    >
                      <span>Friend requests</span>
                      <span className="sidebar-notification-count">{counts.requests}</span>
                    </button>
                    <button
                      type="button"
                      className="sidebar-notification-item is-action"
                      onClick={() => handleNotificationAction("/friends")}
                    >
                      <span>Friend posts</span>
                      <span className="sidebar-notification-count">{counts.friendPosts}</span>
                    </button>
                    <button
                      type="button"
                      className="sidebar-notification-item is-action"
                      onClick={() => handleNotificationAction("/groups")}
                    >
                      <span>Group updates</span>
                      <span className="sidebar-notification-count">{counts.groupUpdates}</span>
                    </button>
                    <button
                      type="button"
                      className="sidebar-notification-item is-action"
                      onClick={() => handleNotificationAction("/dashboard")}
                    >
                      <span>Comments on your posts</span>
                      <span className="sidebar-notification-count">{counts.comments}</span>
                    </button>
                    <button
                      type="button"
                      className="sidebar-notification-item is-action"
                      onClick={() => handleNotificationAction("/dashboard")}
                    >
                      <span>Likes on your posts</span>
                      <span className="sidebar-notification-count">{counts.likes}</span>
                    </button>
                    {loading && (
                      <div className="sidebar-notification-status">Refreshing...</div>
                    )}
                    {!loading && total === 0 && (
                      <div className="sidebar-notification-status">All caught up.</div>
                    )}
                  </div>
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
