import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import api from "../api/strapi";
import {
  useNotifications,
  type BirthdayPreview,
  type FriendRequestPreview,
} from "../hooks/useNotifications";
import {
  buildProfilePayloadFromAttrs,
  decryptOwnProfilePayload,
  type ProfilePayload,
} from "../utils/profile-e2ee";
import { pickMediaUrl } from "../utils/media";
import "../css/sidebar.css";
import AvatarImage from "./AvatarImage";

type ProfileSummary = {
  displayName: string;
  avatarUrl?: string;
  handle?: string;
  age?: string;
  hobbies?: string;
  bio?: string;
};

type SettingsSection =
  | "appearance"
  | "security"
  | "privacy"
  | "notifications"
  | "changes";

const SETTINGS_SECTIONS: { id: SettingsSection; label: string }[] = [
  { id: "appearance", label: "Background & Chat" },
  { id: "security", label: "Account & Security" },
  { id: "privacy", label: "Visibility & Discoverability" },
  { id: "notifications", label: "Sound, Vibration & Quiet Hours" },
  { id: "changes", label: "Changes & Deactivation" },
];

const BIRTHDAY_MESSAGES = [
  "Happy birthday!",
  "Have an awesome birthday!",
  "Hope you have a great day!",
];

type SidebarProps = {
  active: "dashboard" | "friends" | "me" | "groups" | "moderation" | "news" | "forums";
  settingsView?: "profile" | "settings";
  onSettingsViewChange?: (view: "profile" | "settings") => void;
  settingsSection?: SettingsSection;
  onSettingsSectionChange?: (section: SettingsSection) => void;
  groupView?: "feed" | "settings";
  onGroupViewChange?: (view: "feed" | "settings") => void;
};

const trimPreviewText = (value?: string, max = 72) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= max) return text;
  if (max <= 3) return text.slice(0, max);
  return `${text.slice(0, max - 3)}...`;
};

export default function Sidebar({
  active,
  settingsView = "profile",
  onSettingsViewChange,
  settingsSection = "appearance",
  onSettingsSectionChange,
  groupView = "feed",
  onGroupViewChange,
}: SidebarProps) {
  const navigate = useNavigate();
  const { user, profile, logout, appSettings } = useAuth();
  const [showMoreProfile, setShowMoreProfile] = useState(false);
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const {
    counts,
    total,
    loading,
    refresh,
    markAllRead,
    previews,
    acceptFriendRequest,
    sendBirthdayMessage,
  } = useNotifications(user?.id, profile?.notificationSettings, profile?.notificationReadState);
  const [acceptingRequests, setAcceptingRequests] = useState<Record<string, boolean>>({});
  const [birthdaySending, setBirthdaySending] = useState<Record<string, boolean>>({});

  const normalize = (entry: any) => entry?.attributes ?? entry ?? {};

  useEffect(() => {
    const load = async () => {
      if (!user) {
        setProfileSummary(null);
        return;
      }

      if (profile) {
        const displayName =
          profile.firstName || profile.lastName
            ? `${profile.firstName || ""} ${profile.lastName || ""}`.trim()
            : profile.handle || user.email;
        setProfileSummary({
          displayName,
          handle: profile.handle || user.email,
          avatarUrl: profile.avatarUrl,
          age: profile.age || "",
          hobbies: profile.hobbies || "",
          bio: profile.bio || "",
        });
        return;
      }

      try {
        const res = await api.get("/profiles/me?populate=avatar");
        const entry = res.data?.data;
        if (!entry) return;
        const attrs = normalize(entry);
        let payload: ProfilePayload | null = null;
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
            : attrs.handle || user.email;
        setProfileSummary({
          displayName,
          handle: attrs.handle || user.email,
          avatarUrl: pickMediaUrl(attrs.avatar, { kind: "avatar" }),
          age: payload.age || "",
          hobbies: payload.hobbies || "",
          bio: payload.bio || "",
        });
      } catch {
        // ignore sidebar profile errors
      }
    };
    void load();
  }, [profile, user]);

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

  useEffect(() => {
    if (!showNotifications) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeNotifications();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showNotifications]);

  const profileCard = useMemo(() => {
    if (!user) return null;
    return {
      displayName: profileSummary?.displayName || user.email || "Me",
      handle: profileSummary?.handle || user.email || "Profile",
      avatarUrl: profileSummary?.avatarUrl,
    };
  }, [profileSummary, user]);

  const nameForDisplay = profileCard?.displayName || "Me";
  const handleLogoClick = () => {
    navigate("/dashboard");
    setMenuOpen(false);
  };

  const handleProfileAction = (path: string) => {
    navigate(path);
    setShowProfileMenu(false);
    setShowNotifications(false);
    setMenuOpen(false);
  };

  const closeNotifications = () => {
    setShowNotifications(false);
  };

  const toggleNotifications = () => {
    setShowNotifications((prev) => {
      const next = !prev;
      if (next) refresh();
      return next;
    });
    setShowProfileMenu(false);
    setMenuOpen(false);
  };

  const handleNotificationAction = (path: string) => {
    if (total > 0) {
      markAllRead();
    }
    navigate(path);
    setShowProfileMenu(false);
    setShowNotifications(false);
    setMenuOpen(false);
  };

  const toggleMobileMenu = () => {
    setMenuOpen((prev) => !prev);
    setShowNotifications(false);
  };

  // prefer handle if loaded, else email
  const secondaryLine = profileCard?.handle || "Profile";
  const fallbackInitial = nameForDisplay.charAt(0).toUpperCase();
  const canToggleSettings = false;
  const isSettingsView = settingsView === "settings";
  const canSelectSettingsSection =
    canToggleSettings &&
    isSettingsView &&
    typeof onSettingsSectionChange === "function";
  const canToggleGroupSettings =
    active === "groups" && typeof onGroupViewChange === "function";
  const isGroupSettingsView = groupView === "settings";
  const isStaff = user?.appRole === "admin" || user?.appRole === "moderator";
  const newsroomEnabled = appSettings?.newsroomEnabled !== false;

  const handleSettingsToggle = () => {
    if (!onSettingsViewChange) return;
    setShowProfileMenu(false);
    setShowNotifications(false);
    onSettingsViewChange(isSettingsView ? "profile" : "settings");
  };

  const handleSettingsSectionChange = (section: SettingsSection) => {
    if (!onSettingsSectionChange) return;
    setShowProfileMenu(false);
    setShowNotifications(false);
    setMenuOpen(false);
    onSettingsSectionChange(section);
  };

  const handleGroupSettingsToggle = () => {
    if (!onGroupViewChange) return;
    setShowProfileMenu(false);
    setShowNotifications(false);
    setMenuOpen(false);
    onGroupViewChange(isGroupSettingsView ? "feed" : "settings");
  };

  const messagePreviewText = useMemo(() => {
    if (counts.messages <= 0) return "";
    if (!previews.messages) return "You have new messages.";
    const snippet = trimPreviewText(previews.messages.body, 64);
    return snippet
      ? `${previews.messages.senderName} sent you a new message: "${snippet}"`
      : `${previews.messages.senderName} sent you a new message.`;
  }, [counts.messages, previews.messages]);

  const birthdayPreviewText = useMemo(() => {
    if (counts.birthdays <= 0) return "";
    if (!previews.birthdays.length) return "A friend has a birthday today.";
    const [first] = previews.birthdays;
    const remaining = Math.max(0, counts.birthdays - 1);
    if (remaining > 0) {
      return `${first.displayName} and ${remaining} other friends have birthdays today.`;
    }
    return `It is ${first.displayName}'s birthday today.`;
  }, [counts.birthdays, previews.birthdays]);

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

  const feedbackPreviewText = useMemo(() => {
    if (counts.feedbackRequests <= 0) return "";
    if (!previews.feedbackRequests.length) return "New feedback requests are waiting.";
    const first = previews.feedbackRequests[0];
    const snippet = trimPreviewText(first.title || first.content, 64);
    const owner = first.ownerName || "Someone";
    const audience =
      first.feedbackAudience === "public"
        ? "public feedback"
        : first.feedbackAudience === "friends"
        ? "friends feedback"
        : "feedback";
    return snippet
      ? `${owner} asked for ${audience}: "${snippet}"`
      : `${owner} asked for ${audience}.`;
  }, [counts.feedbackRequests, previews.feedbackRequests]);

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

  const handleBirthdayMessage = async (preview: BirthdayPreview, message: string) => {
    const key = `${preview.userId}:${message}`;
    if (birthdaySending[key]) return;
    setBirthdaySending((prev) => ({ ...prev, [key]: true }));
    const ok = await sendBirthdayMessage(preview, message);
    if (!ok) {
      console.error("Failed to send birthday message");
    }
    setBirthdaySending((prev) => {
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
          <span>Birthdays</span>
          <span className="sidebar-notification-count">{counts.birthdays}</span>
        </button>
        {counts.birthdays > 0 && (
          <div className="sidebar-notification-preview-list">
            {previews.birthdays.length > 0 ? (
              previews.birthdays.map((birthday) => (
                <div key={birthday.id} className="sidebar-notification-preview">
                  <div className="sidebar-notification-preview-row">
                    <span className="sidebar-notification-preview-text">
                      {birthday.displayName} has a birthday today.
                    </span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                    {BIRTHDAY_MESSAGES.map((message) => {
                      const key = `${birthday.userId}:${message}`;
                      return (
                        <button
                          key={key}
                          type="button"
                          className="sidebar-notification-action"
                          disabled={birthdaySending[key]}
                          onClick={() => void handleBirthdayMessage(birthday, message)}
                        >
                          {birthdaySending[key] ? "Sending..." : message}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="sidebar-notification-preview">
                <span className="sidebar-notification-preview-text">
                  {birthdayPreviewText || "A friend has a birthday today."}
                </span>
              </div>
            )}
            {previews.birthdays.length > 0 && counts.birthdays > previews.birthdays.length && (
              <div className="sidebar-notification-preview-more">
                +{counts.birthdays - previews.birthdays.length} more birthdays
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
          onClick={() => handleNotificationAction("/dashboard")}
        >
          <span>Feedback requests</span>
          <span className="sidebar-notification-count">{counts.feedbackRequests}</span>
        </button>
        {counts.feedbackRequests > 0 && (
          <div className="sidebar-notification-preview-list">
            {previews.feedbackRequests.length > 0 ? (
              previews.feedbackRequests.map((request) => {
                const audience =
                  request.feedbackAudience === "public"
                    ? "Public feedback"
                    : request.feedbackAudience === "friends"
                    ? "Friends feedback"
                    : "Feedback request";
                const snippet = trimPreviewText(
                  request.title || request.content,
                  56
                );
                return (
                  <button
                    key={request.id}
                    type="button"
                    className="sidebar-notification-preview-row is-action"
                    onClick={() =>
                      handleNotificationAction(`/dashboard#post-${request.postKey}`)
                    }
                  >
                    <span className="sidebar-notification-preview-text">
                      {request.ownerName} · {audience}
                      {snippet ? `: "${snippet}"` : ""}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="sidebar-notification-preview">
                <span className="sidebar-notification-preview-text">
                  {feedbackPreviewText || "New feedback requests are waiting."}
                </span>
              </div>
            )}
            {previews.feedbackRequests.length > 0 &&
              counts.feedbackRequests > previews.feedbackRequests.length && (
                <div className="sidebar-notification-preview-more">
                  +{counts.feedbackRequests - previews.feedbackRequests.length} more requests
                </div>
              )}
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
          <span className="brand-mark" aria-hidden="true">
            <img src="/logo2.png" alt="Your Social Place Logo" />
          </span>
          <span className="brand-text">Your Social Place</span>
        </button>
        <div className="mobile-topbar-actions">
          <button
            type="button"
            className={`mobile-avatar-button ${menuOpen ? "is-open" : ""}`}
            onClick={toggleMobileMenu}
            aria-label={`Open profile menu for ${nameForDisplay}`}
          >
            {profileCard?.avatarUrl ? (
              <AvatarImage
                src={profileCard.avatarUrl}
                alt={nameForDisplay}
                className="mobile-avatar-image"
                loading="lazy"
                decoding="async"
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
            onClick={toggleNotifications}
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
              {canToggleSettings && (
                <button
                  className="mobile-profile-item"
                  type="button"
                  onClick={handleSettingsToggle}
                >
                  {isSettingsView ? "Back to Profile" : "Settings"}
                </button>
              )}
              {canSelectSettingsSection && (
                <div className="mobile-settings-links">
                  {SETTINGS_SECTIONS.map((section) => (
                    <button
                      key={section.id}
                      className={`mobile-profile-item${
                        settingsSection === section.id ? " is-active" : ""
                      }`}
                      type="button"
                      onClick={() => handleSettingsSectionChange(section.id)}
                    >
                      {section.label}
                    </button>
                  ))}
                </div>
              )}
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
                onClick={() => handleProfileAction("/forums")}
              >
                Forums
              </button>
              <button
                className={`mobile-profile-item${
                  newsroomEnabled ? "" : " mobile-profile-item--disabled"
                }`}
                type="button"
                disabled={!newsroomEnabled}
                aria-disabled={!newsroomEnabled}
                onClick={() => {
                  if (!newsroomEnabled) return;
                  handleProfileAction("/news");
                }}
              >
                {newsroomEnabled ? "Newsroom" : "Newsroom (Coming soon)"}
              </button>
              {isStaff && (
                <button
                  className="mobile-profile-item"
                  type="button"
                  onClick={() => handleProfileAction("/moderation")}
                >
                  Moderation
                </button>
              )}
              {canToggleGroupSettings && (
                <button
                  className="mobile-profile-item"
                  type="button"
                  onClick={handleGroupSettingsToggle}
                >
                  {isGroupSettingsView
                    ? "Return to group feed"
                    : "Group look and feel"}
                </button>
              )}
              <button
                className="mobile-profile-item"
                type="button"
                onClick={() => handleProfileAction("/landing")}
              >
                Return Home
              </button>
              <button
                className="mobile-profile-item"
                type="button"
                onClick={() => {
                  logout("user-action");
                  navigate("/login");
                  setMenuOpen(false);
                }}
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {showNotifications && (
        <div
          className="sidebar-notification-tray"
          role="dialog"
          aria-modal="true"
          aria-label="Notifications"
        >
          <button
            type="button"
            className="sidebar-notification-tray-backdrop"
            aria-label="Close notifications"
            onClick={closeNotifications}
          />
          <div className="sidebar-notification-tray-panel">
            <div className="sidebar-notification-header sidebar-notification-tray-header">
              <div className="sidebar-notification-tray-title">
                <strong>Notifications</strong>
                <span className="sidebar-notification-tray-subtitle">
                  {total > 0 ? `${total} new updates` : "All caught up"}
                </span>
              </div>
              <div className="sidebar-notification-tray-actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={markAllRead}
                  disabled={total === 0}
                >
                  Mark read
                </button>
                <button
                  type="button"
                  className="sidebar-notification-close"
                  onClick={closeNotifications}
                  aria-label="Close notifications"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path
                      d="M6 6 18 18M18 6 6 18"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              </div>
            </div>
            {renderNotificationList()}
          </div>
        </div>
      )}

      <aside className="dash-nav">
        <button className="brand" type="button" onClick={handleLogoClick} style={{ cursor: "pointer" }}>
          <span className="brand-mark" aria-hidden="true">
            <img src="/logo2.png" alt="" />
          </span>
          <span className="brand-text">Your Social Place</span>
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
                  aria-expanded={showProfileMenu}
                  aria-controls="sidebar-profile-menu"
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
                    <AvatarImage
                      src={profileCard.avatarUrl}
                      alt={nameForDisplay}
                      className="avatar-octagon"
                      style={{ width: 48, height: 48, borderRadius: "50%" }}
                      loading="lazy"
                      decoding="async"
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
                  onClick={toggleNotifications}
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
              {showProfileMenu && (
                <div
                  id="sidebar-profile-menu"
                  className="sidebar-profile-menu"
                >
                  <button
                    className="btn ghost nav-btn sidebar-profile-menu-button"
                    type="button"
                    onClick={() => handleProfileAction("/landing")}
                  >
                    Return Home
                  </button>
                  <button
                    className="btn ghost nav-btn sidebar-profile-menu-button"
                    type="button"
                    onClick={() => handleProfileAction("/downloads")}
                  >
                    Downloads
                  </button>
                  <button
                    className="btn ghost nav-btn sidebar-profile-menu-button"
                    type="button"
                    onClick={() => {
                      logout("user-action");
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
          {profileCard && (
            <div className="sidebar-nav-links">
              <button
                type="button"
                className={`btn ghost sidebar-nav-link${
                  active === "dashboard" ? " is-active" : ""
                }`}
                onClick={() => handleProfileAction("/dashboard")}
              >
                My Dashboard
              </button>
              <button
                type="button"
                className={`btn ghost sidebar-nav-link${
                  active === "me" ? " is-active" : ""
                }`}
                onClick={() => handleProfileAction("/me")}
              >
                My Profile
              </button>
              <button
                type="button"
                className={`btn ghost sidebar-nav-link${
                  active === "friends" ? " is-active" : ""
                }`}
                onClick={() => handleProfileAction("/friends")}
              >
                My Friends
              </button>
              <button
                type="button"
                className={`btn ghost sidebar-nav-link${
                  active === "groups" ? " is-active" : ""
                }`}
                onClick={() => handleProfileAction("/groups")}
              >
                My Groups
              </button>
              <button
                type="button"
                className={`btn ghost sidebar-nav-link${
                  active === "forums" ? " is-active" : ""
                }`}
                onClick={() => handleProfileAction("/forums")}
              >
                Forums
              </button>
              <button
                type="button"
                className={`btn ghost sidebar-nav-link${
                  !newsroomEnabled ? " sidebar-nav-link--disabled" : ""
                }${active === "news" ? " is-active" : ""}`}
                disabled={!newsroomEnabled}
                aria-disabled={!newsroomEnabled}
                onClick={() => {
                  if (!newsroomEnabled) return;
                  handleProfileAction("/news");
                }}
              >
                {newsroomEnabled ? "Newsroom" : "Newsroom (Coming soon)"}
              </button>
              {isStaff && (
                <button
                  type="button"
                  className={`btn ghost sidebar-nav-link${
                    active === "moderation" ? " is-active" : ""
                  }`}
                  onClick={() => handleProfileAction("/moderation")}
                >
                  Moderation
                </button>
              )}
            </div>
          )}
          {canToggleSettings && (
            <button
              type="button"
              className={`btn ghost sidebar-settings-button${
                isSettingsView ? " is-active" : ""
              }`}
              onClick={handleSettingsToggle}
              aria-pressed={isSettingsView}
            >
              <span className="sidebar-settings-icon" aria-hidden="true">
                {isSettingsView ? (
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M15 6l-6 6 6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M19.4 13a7.6 7.6 0 0 0 .05-2l2.1-1.64-2-3.46-2.46 1a7.56 7.56 0 0 0-1.72-1l-.38-2.6h-4l-.38 2.6a7.56 7.56 0 0 0-1.72 1l-2.46-1-2 3.46L4.55 11a7.6 7.6 0 0 0 0 2l-2.1 1.64 2 3.46 2.46-1c.54.42 1.12.76 1.72 1l.38 2.6h4l.38-2.6c.6-.24 1.18-.58 1.72-1l2.46 1 2-3.46L19.4 13zM12 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span>{isSettingsView ? "Back to Profile" : "Settings"}</span>
            </button>
          )}
          {canToggleGroupSettings && (
            <button
              type="button"
              className={`btn ghost sidebar-settings-button${
                isGroupSettingsView ? " is-active" : ""
              }`}
              onClick={handleGroupSettingsToggle}
              aria-pressed={isGroupSettingsView}
            >
              <span className="sidebar-settings-icon" aria-hidden="true">
                {isGroupSettingsView ? (
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M15 6l-6 6 6 6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24">
                    <path
                      d="M19.4 13a7.6 7.6 0 0 0 .05-2l2.1-1.64-2-3.46-2.46 1a7.56 7.56 0 0 0-1.72-1l-.38-2.6h-4l-.38 2.6a7.56 7.56 0 0 0-1.72 1l-2.46-1-2 3.46L4.55 11a7.6 7.6 0 0 0 0 2l-2.1 1.64 2 3.46 2.46-1c.54.42 1.12.76 1.72 1l.38 2.6h4l.38-2.6c.6-.24 1.18-.58 1.72-1l2.46 1 2-3.46L19.4 13zM12 15.2a3.2 3.2 0 1 1 0-6.4 3.2 3.2 0 0 1 0 6.4z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </span>
              <span>
                {isGroupSettingsView
                  ? "Return to group feed"
                  : "Group look and feel"}
              </span>
            </button>
          )}
          {canSelectSettingsSection && (
            <div className="sidebar-settings-nav" role="navigation" aria-label="Settings sections">
              {SETTINGS_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  className={`sidebar-settings-link${
                    settingsSection === section.id ? " is-active" : ""
                  }`}
                  onClick={() => handleSettingsSectionChange(section.id)}
                >
                  {section.label}
                </button>
              ))}
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
