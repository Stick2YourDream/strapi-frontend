import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Camera,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Home,
  LogOut,
  MessageSquare,
  Settings,
  ShieldCheck,
  User,
  Users,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import "./UserMenuDrawer.css";

export type FriendMessagePreview = {
  id: string;
  friendName: string;
  preview: string;
  href?: string;
  unreadCount?: number;
};

export type MenuProps = {
  open: boolean;
  onClose: () => void;
  onLogout: () => void;
  onNotificationsClick?: () => void;
  onEditProfilePicture?: () => void;
  user: { name: string; avatarUrl?: string };
  currentPath: string;
  notificationsCount?: number;
  messagesCount?: number;
  friendMessages?: FriendMessagePreview[];
  showBilling?: boolean;
};

type MenuRowLink = {
  label: string;
  href: string;
  accent:
    | "dashboard"
    | "community"
    | "notifications"
    | "messages"
    | "profile"
    | "privacy"
    | "support"
    | "logout";
  icon: LucideIcon;
  badgeCount?: number;
};

const normalizePath = (value: string) => {
  const plain = String(value || "").split("?")[0].split("#")[0].trim();
  if (!plain) return "/";
  if (plain === "/") return "/";
  return plain.replace(/\/+$/, "");
};

const isActivePath = (currentPath: string, href: string) => {
  const current = normalizePath(currentPath);
  const target = normalizePath(href);
  return current === target || current.startsWith(`${target}/`);
};

const getInitials = (name: string) => {
  const tokens = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return "U";
  if (tokens.length === 1) return tokens[0].slice(0, 1).toUpperCase();
  return `${tokens[0].slice(0, 1)}${tokens[tokens.length - 1].slice(0, 1)}`.toUpperCase();
};

const formatBadge = (count?: number) => {
  if (!count || count <= 0) return null;
  if (count > 99) return "99+";
  return String(count);
};

const trimPreview = (value: string, max = 64) => {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}...`;
};

export default function UserMenuDrawer({
  open,
  onClose,
  onLogout,
  onNotificationsClick,
  onEditProfilePicture,
  user,
  currentPath,
  notificationsCount = 0,
  messagesCount = 0,
  friendMessages = [],
}: MenuProps) {
  const titleId = useId();
  const avatarModalTitleId = useId();
  const [communityOpen, setCommunityOpen] = useState(false);
  const [messagesOpen, setMessagesOpen] = useState(false);
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setCommunityOpen(false);
      setMessagesOpen(false);
      setAvatarModalOpen(false);
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (avatarModalOpen) {
          setAvatarModalOpen(false);
          return;
        }
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [avatarModalOpen, open, onClose]);

  if (!open) return null;

  const navigationRows: MenuRowLink[] = [
    {
      label: "Dashboard",
      href: "/dashboard",
      icon: Home,
      accent: "dashboard",
    },
  ];

  const settingsRows: MenuRowLink[] = [
    {
      label: "Profile",
      href: "/me",
      icon: User,
      accent: "profile",
    },
    {
      label: "Privacy & Security",
      href: "/me?view=settings&section=security",
      icon: ShieldCheck,
      accent: "privacy",
    },
  ];

  const communityRows = useMemo(
    () => [
      { label: "Friends", href: "/friends", icon: Users },
      { label: "Groups", href: "/groups", icon: UsersRound },
      { label: "Forums", href: "/forums", icon: MessageSquare },
    ],
    []
  );

  const normalizedCurrentPath = normalizePath(currentPath);
  const communityActive =
    normalizedCurrentPath === "/community" ||
    normalizedCurrentPath.startsWith("/friends") ||
    normalizedCurrentPath.startsWith("/groups") ||
    normalizedCurrentPath.startsWith("/forums");
  const messagesActive = normalizedCurrentPath.startsWith("/messages");

  const renderLinkRow = (item: MenuRowLink) => {
    const Icon = item.icon;
    const active = isActivePath(currentPath, item.href);
    const badge = formatBadge(item.badgeCount);

    return (
      <Link
        key={`${item.label}-${item.href}`}
        to={item.href}
        className={`user-menu-drawer__row${active ? " is-active" : ""}`}
        data-accent={item.accent}
        onClick={onClose}
      >
        <span className="user-menu-drawer__row-icon" aria-hidden="true">
          <Icon size={20} />
        </span>
        <span className="user-menu-drawer__row-label">{item.label}</span>
        {badge && <span className="user-menu-drawer__badge">{badge}</span>}
      </Link>
    );
  };

  return (
    <div className="user-menu-drawer__overlay" role="presentation">
      <button
        type="button"
        className="user-menu-drawer__backdrop"
        aria-label="Close navigation menu"
        onClick={onClose}
      />

      <div className="user-menu-drawer__viewport">
        <section
          className="user-menu-drawer"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        >
          <button
            type="button"
            className="user-menu-drawer__close"
            aria-label="Close menu"
            onClick={onClose}
          >
            <X size={18} />
          </button>

          <header className="user-menu-drawer__header">
            <div className="user-menu-drawer__user">
              <button
                type="button"
                className="user-menu-drawer__avatar user-menu-drawer__avatar-trigger"
                aria-haspopup="dialog"
                aria-label="Edit profile picture"
                onClick={() => setAvatarModalOpen(true)}
              >
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt={`${user.name} avatar`} />
                ) : (
                  <span className="user-menu-drawer__avatar-fallback">{getInitials(user.name)}</span>
                )}
              </button>
              <div className="user-menu-drawer__user-text">
                <h2 id={titleId}>{user.name}</h2>
                <Link to="/me" onClick={onClose}>
                  View Profile
                </Link>
              </div>
            </div>

            <Link
              to="/me?view=settings"
              className="user-menu-drawer__settings-shortcut"
              onClick={onClose}
            >
              <Settings size={14} aria-hidden="true" />
              <span>Settings</span>
            </Link>
          </header>

          <section className="user-menu-drawer__section">
            <p className="user-menu-drawer__section-label">Navigation</p>
            <div className="user-menu-drawer__rows">
              {renderLinkRow(navigationRows[0])}

              <button
                type="button"
                className={`user-menu-drawer__row user-menu-drawer__row--toggle${
                  communityActive ? " is-active" : ""
                }`}
                data-accent="community"
                onClick={() => setCommunityOpen((value) => !value)}
                aria-expanded={communityOpen}
                aria-controls="user-menu-community-submenu"
              >
                <span className="user-menu-drawer__row-icon" aria-hidden="true">
                  <Users size={20} />
                </span>
                <span className="user-menu-drawer__row-label">Community</span>
                <span
                  className={`user-menu-drawer__toggle-chevron${
                    communityOpen ? " is-open" : ""
                  }`}
                  aria-hidden="true"
                >
                  <ChevronDown size={16} />
                </span>
              </button>

              {communityOpen && (
                <div id="user-menu-community-submenu" className="user-menu-drawer__submenu">
                  {communityRows.map((item) => {
                    const SubIcon = item.icon;
                    const active = isActivePath(currentPath, item.href);
                    return (
                      <Link
                        key={item.href}
                        to={item.href}
                        className={`user-menu-drawer__submenu-row${active ? " is-active" : ""}`}
                        onClick={onClose}
                      >
                        <span className="user-menu-drawer__submenu-icon" aria-hidden="true">
                          <SubIcon size={16} />
                        </span>
                        <span>{item.label}</span>
                        <ChevronRight size={14} aria-hidden="true" />
                      </Link>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                className="user-menu-drawer__row"
                data-accent="notifications"
                onClick={() => {
                  onNotificationsClick?.();
                  onClose();
                }}
              >
                <span className="user-menu-drawer__row-icon" aria-hidden="true">
                  <Bell size={20} />
                </span>
                <span className="user-menu-drawer__row-label">Notifications</span>
                {notificationsCount > 0 && (
                  <span className="user-menu-drawer__badge">{formatBadge(notificationsCount)}</span>
                )}
              </button>

              <button
                type="button"
                className={`user-menu-drawer__row user-menu-drawer__row--toggle${
                  messagesActive ? " is-active" : ""
                }`}
                data-accent="messages"
                onClick={() => setMessagesOpen((value) => !value)}
                aria-expanded={messagesOpen}
                aria-controls="user-menu-messages-submenu"
              >
                <span className="user-menu-drawer__row-icon" aria-hidden="true">
                  <MessageSquare size={20} />
                </span>
                <span className="user-menu-drawer__row-label">Messages</span>
                {messagesCount > 0 && (
                  <span className="user-menu-drawer__badge">{formatBadge(messagesCount)}</span>
                )}
                <span
                  className={`user-menu-drawer__toggle-chevron${
                    messagesOpen ? " is-open" : ""
                  }`}
                  aria-hidden="true"
                >
                  <ChevronDown size={16} />
                </span>
              </button>

              {messagesOpen && (
                <div id="user-menu-messages-submenu" className="user-menu-drawer__submenu">
                  {friendMessages.length > 0 ? (
                    friendMessages.map((item) => (
                      <Link
                        key={item.id}
                        to={item.href || "/friends"}
                        className="user-menu-drawer__message-row"
                        onClick={onClose}
                      >
                        <span className="user-menu-drawer__message-copy">
                          <strong>{item.friendName}</strong>
                          <span>{trimPreview(item.preview)}</span>
                        </span>
                        {item.unreadCount && item.unreadCount > 0 ? (
                          <span className="user-menu-drawer__message-count">
                            {formatBadge(item.unreadCount)}
                          </span>
                        ) : null}
                      </Link>
                    ))
                  ) : (
                    <Link
                      to="/friends"
                      className="user-menu-drawer__message-row user-menu-drawer__message-row--empty"
                      onClick={onClose}
                    >
                      <span className="user-menu-drawer__message-copy">
                        <strong>No new friend messages</strong>
                        <span>Open friends inbox</span>
                      </span>
                    </Link>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="user-menu-drawer__section">
            <p className="user-menu-drawer__section-label">Settings</p>
            <div className="user-menu-drawer__rows">
              {settingsRows.map((item) => renderLinkRow(item))}
            </div>
          </section>

          <section className="user-menu-drawer__section">
            <p className="user-menu-drawer__section-label">Support</p>
            <div className="user-menu-drawer__rows">
              <Link
                to="/support"
                className="user-menu-drawer__row"
                data-accent="support"
                onClick={onClose}
              >
                <span className="user-menu-drawer__row-icon" aria-hidden="true">
                  <CircleHelp size={20} />
                </span>
                <span className="user-menu-drawer__row-label">Help & Support</span>
              </Link>
            </div>

            <div className="user-menu-drawer__rows user-menu-drawer__rows--logout">
              <button
                type="button"
                className="user-menu-drawer__row user-menu-drawer__row--danger"
                data-accent="logout"
                onClick={() => {
                  onLogout();
                  onClose();
                }}
              >
                <span className="user-menu-drawer__row-icon" aria-hidden="true">
                  <LogOut size={20} />
                </span>
                <span className="user-menu-drawer__row-label">Log out</span>
              </button>
            </div>
          </section>
        </section>

        {avatarModalOpen && (
          <div className="user-menu-drawer__avatar-modal-layer" role="presentation">
            <button
              type="button"
              className="user-menu-drawer__avatar-modal-backdrop"
              aria-label="Close edit profile picture dialog"
              onClick={() => setAvatarModalOpen(false)}
            />
            <section
              className="user-menu-drawer__avatar-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby={avatarModalTitleId}
            >
              <button
                type="button"
                className="user-menu-drawer__avatar-modal-close"
                aria-label="Close edit profile picture dialog"
                onClick={() => setAvatarModalOpen(false)}
              >
                <X size={16} />
              </button>
              <span className="user-menu-drawer__avatar-modal-icon" aria-hidden="true">
                <Camera size={20} />
              </span>
              <div className="user-menu-drawer__avatar-modal-copy">
                <h3 id={avatarModalTitleId}>Edit Profile Picture</h3>
                <p>Choose a new photo or update your current avatar.</p>
              </div>
              <div className="user-menu-drawer__avatar-modal-actions">
                <button
                  type="button"
                  className="user-menu-drawer__avatar-modal-btn is-primary"
                  onClick={() => {
                    onEditProfilePicture?.();
                    setAvatarModalOpen(false);
                    onClose();
                  }}
                >
                  Edit Profile Picture
                </button>
                <button
                  type="button"
                  className="user-menu-drawer__avatar-modal-btn"
                  onClick={() => setAvatarModalOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
