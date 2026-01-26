import "../css/landing.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { gsap } from "gsap";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import { useNotifications, type FriendRequestPreview } from "../hooks/useNotifications";
import { usePageMeta } from "../hooks/usePageMeta";
import {
  buildProfilePayloadFromAttrs,
  decryptOwnProfilePayload,
  type ProfilePayload,
} from "../utils/profile-e2ee";

type ProfileSummary = {
  displayName: string;
  avatarUrl?: string;
  handle?: string;
};

const INTENT_OPTIONS = [
  { id: "build-habit", label: "Build A Habit", detail: "Daily accountability" },
  { id: "stay-connected", label: "Stay Connected", detail: "Weekly momentum" },
  { id: "find-accountability", label: "Find Accountability", detail: "Supportive check-ins" },
];

const trimPreviewText = (value?: string, max = 72) => {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= max) return cleaned;
  if (max <= 3) return cleaned.slice(0, max);
  return `${cleaned.slice(0, max - 3)}...`;
};

export default function Landing() {
  const navigate = useNavigate();
  const { user, profile, logout } = useAuth();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const intentRef = useRef<HTMLDivElement | null>(null);
  usePageMeta({
    title: "Your Social Place | Motivational social network without all the fluff",
    description:
      "Your Social Place is a motivational social network for accountability with live video calls, screen sharing, real-time chat, groups, and Newsroom updates.",
    type: "website",
    canonical: "https://yoursocialplace.com/",
    keywords:
      "Your Social Place, motivational social network, accountability, goals, progress, friends, groups, live video calls, screen sharing, real-time chat, Newsroom, moderation, privacy controls, PWA",
    image: "https://yoursocialplace.com/logo.png",
    imageAlt: "Your Social Place logo",
  });
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [selectedIntent, setSelectedIntent] = useState("");
  const [intentOpen, setIntentOpen] = useState(false);
  const { counts, total, loading, refresh, markAllRead, previews, acceptFriendRequest } =
    useNotifications(user?.id, profile?.notificationSettings);
  const [acceptingRequests, setAcceptingRequests] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    if (typeof window === "undefined") return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.9 } });
      const fromIf = (selector: string, vars: gsap.TweenVars, position?: string | number) => {
        const targets = root.querySelectorAll(selector);
        if (!targets.length) return tl;
        tl.from(targets, vars, position);
        return tl;
      };

      fromIf(".landing-nav", { y: -12, opacity: 0, duration: 0.6 });
      fromIf(".hero-badges .pill2", { y: 16, opacity: 0, stagger: 0.08 }, "-=0.2");
      fromIf(".hero-copy h1", { y: 20, opacity: 0 }, "-=0.1");
      fromIf(".hero-copy p", { y: 18, opacity: 0 }, "-=0.2");
      fromIf(".hero-intent-button", { y: 16, opacity: 0, stagger: 0.07 }, "-=0.2");
      fromIf(
        ".hero-cta .btn-primary, .hero-cta .btn-ghost, .hero-cta-skip",
        { y: 12, opacity: 0, stagger: 0.06 },
        "-=0.2"
      );
      fromIf(".hero-card", { y: 26, opacity: 0 }, "-=0.4");
    }, root);

    return () => {
      ctx.revert();
    };
  }, []);

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
    if (!user) {
      setProfileSummary(null);
      return;
    }

    const loadProfile = async () => {
      try {
        const res = await api.get("/profiles/me?populate=avatar");
        const data = res.data?.data;
        const entry = Array.isArray(data) ? data[0] : data;
        const attrs = normalize(entry);
        if (!attrs || Array.isArray(attrs)) return;
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
          avatarUrl: pickMediaUrl(attrs.avatar),
        });
      } catch {
        setProfileSummary({
          displayName: user.email || "Account",
          handle: user.email || "account",
        });
      }
    };

    loadProfile();
  }, [user]);

  useEffect(() => {
    setProfileMenuOpen(false);
    setShowNotifications(false);
  }, [user]);

  useEffect(() => {
    if (!intentOpen) return;
    intentRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [intentOpen]);

  const nameForDisplay = useMemo(
    () => profileSummary?.displayName || user?.email || "Account",
    [profileSummary?.displayName, user?.email]
  );

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

  const handleProfileAction = (path: string) => {
    navigate(path);
    setProfileMenuOpen(false);
    setShowNotifications(false);
  };

  const handleNotificationAction = (path: string) => {
    navigate(path);
    setProfileMenuOpen(false);
    setShowNotifications(false);
  };

  const renderNotificationList = () => (
    <div className="landing-notification-list">
      <div className="landing-notification-group">
        <button
          type="button"
          className="landing-notification-item is-action"
          onClick={() => handleNotificationAction("/friends")}
        >
          <span>New messages</span>
          <span className="landing-notification-count">{counts.messages}</span>
        </button>
        {counts.messages > 0 && messagePreviewText && (
          <div className="landing-notification-preview">
            <span className="landing-notification-preview-text">{messagePreviewText}</span>
          </div>
        )}
      </div>
      <div className="landing-notification-group">
        <button
          type="button"
          className="landing-notification-item is-action"
          onClick={() => handleNotificationAction("/friends")}
        >
          <span>Friend requests</span>
          <span className="landing-notification-count">{counts.requests}</span>
        </button>
        {counts.requests > 0 && (
          <div className="landing-notification-preview-list">
            {previews.requests.length > 0 ? (
              previews.requests.map((request) => {
                const key = String(request.id);
                return (
                  <div key={key} className="landing-notification-preview-row">
                    <span className="landing-notification-preview-text">
                      {request.requesterName} sent you a friend request.
                    </span>
                    <button
                      type="button"
                      className="landing-notification-action"
                      disabled={acceptingRequests[key]}
                      onClick={() => void handleAcceptRequest(request)}
                    >
                      {acceptingRequests[key] ? "Accepting..." : "Accept"}
                    </button>
                  </div>
                );
              })
            ) : (
              <div className="landing-notification-preview">
                <span className="landing-notification-preview-text">
                  You have a new friend request.
                </span>
              </div>
            )}
            {previews.requests.length > 0 && counts.requests > previews.requests.length && (
              <div className="landing-notification-preview-more">
                +{counts.requests - previews.requests.length} more requests
              </div>
            )}
          </div>
        )}
      </div>
      <div className="landing-notification-group">
        <button
          type="button"
          className="landing-notification-item is-action"
          onClick={() => handleNotificationAction("/friends")}
        >
          <span>Friend posts</span>
          <span className="landing-notification-count">{counts.friendPosts}</span>
        </button>
        {counts.friendPosts > 0 && friendPostPreviewText && (
          <div className="landing-notification-preview">
            <span className="landing-notification-preview-text">{friendPostPreviewText}</span>
          </div>
        )}
      </div>
      <div className="landing-notification-group">
        <button
          type="button"
          className="landing-notification-item is-action"
          onClick={() => handleNotificationAction("/dashboard")}
        >
          <span>Feedback requests</span>
          <span className="landing-notification-count">{counts.feedbackRequests}</span>
        </button>
        {counts.feedbackRequests > 0 && (
          <div className="landing-notification-preview-list">
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
                    className="landing-notification-preview-row is-action"
                    onClick={() =>
                      handleNotificationAction(`/dashboard#post-${request.postKey}`)
                    }
                  >
                    <span className="landing-notification-preview-text">
                      {request.ownerName} · {audience}
                      {snippet ? `: "${snippet}"` : ""}
                    </span>
                  </button>
                );
              })
            ) : (
              <div className="landing-notification-preview">
                <span className="landing-notification-preview-text">
                  {feedbackPreviewText || "New feedback requests are waiting."}
                </span>
              </div>
            )}
            {previews.feedbackRequests.length > 0 &&
              counts.feedbackRequests > previews.feedbackRequests.length && (
                <div className="landing-notification-preview-more">
                  +{counts.feedbackRequests - previews.feedbackRequests.length} more requests
                </div>
              )}
          </div>
        )}
      </div>
      <div className="landing-notification-group">
        <button
          type="button"
          className="landing-notification-item is-action"
          onClick={() => handleNotificationAction("/groups")}
        >
          <span>Group updates</span>
          <span className="landing-notification-count">{counts.groupUpdates}</span>
        </button>
        {counts.groupUpdates > 0 && groupUpdatePreviewText && (
          <div className="landing-notification-preview">
            <span className="landing-notification-preview-text">
              {groupUpdatePreviewText}
            </span>
          </div>
        )}
      </div>
      <div className="landing-notification-group">
        <button
          type="button"
          className="landing-notification-item is-action"
          onClick={() => handleNotificationAction("/dashboard")}
        >
          <span>Comments on your posts</span>
          <span className="landing-notification-count">{counts.comments}</span>
        </button>
        {counts.comments > 0 && commentPreviewText && (
          <div className="landing-notification-preview">
            <span className="landing-notification-preview-text">{commentPreviewText}</span>
          </div>
        )}
      </div>
      <div className="landing-notification-group">
        <button
          type="button"
          className="landing-notification-item is-action"
          onClick={() => handleNotificationAction("/dashboard")}
        >
          <span>Likes on your posts</span>
          <span className="landing-notification-count">{counts.likes}</span>
        </button>
        {counts.likes > 0 && likesPreviewText && (
          <div className="landing-notification-preview">
            <span className="landing-notification-preview-text">{likesPreviewText}</span>
          </div>
        )}
      </div>
      {loading && <div className="landing-notification-status">Refreshing...</div>}
      {!loading && total === 0 && (
        <div className="landing-notification-status">All caught up.</div>
      )}
    </div>
  );

  const selectedIntentOption = INTENT_OPTIONS.find(
    (option) => option.id === selectedIntent
  );
  const profileInitial = nameForDisplay.charAt(0).toUpperCase();

  const openIntentPicker = () => {
    setIntentOpen(true);
  };

  const handleIntentSelect = (intentId: string) => {
    setSelectedIntent(intentId);
    navigate(`/register?intent=${encodeURIComponent(intentId)}`);
  };

  return (
    <div className="landing-page" ref={rootRef}>
      <div className="landing-shell">
        <nav className="landing-nav" aria-label="Primary">
          <button
            type="button"
            className="landing-brand"
            onClick={() => navigate("/")}
            aria-label="Go to Your Social Place home"
          >
            <span className="landing-brand-mark" aria-hidden="true">
              <img src="/logo.png" alt="Your Social Place logo" />
            </span>
            <span className="landing-brand-text">Your Social Place</span>
          </button>
          <div className="landing-beta">BETA</div>
          <div className="landing-links">
            <a href="/what-makes-us-different">What makes us different</a>
            <a href="/guidelines">Guidelines</a>
            <a href="/safety">Safety</a>
            <a href="/report">Report</a>
          </div>
          <div className="nav-actions">
            {user ? (
              <div className="landing-profile">
                <button
                  type="button"
                  className="landing-profile-button"
                  onClick={() => {
                    setProfileMenuOpen((v) => !v);
                    setShowNotifications(false);
                  }}
                  aria-expanded={profileMenuOpen}
                  aria-label={`Open profile menu for ${nameForDisplay}`}
                >
                  {profileSummary?.avatarUrl ? (
                    <img
                      src={profileSummary.avatarUrl}
                      alt={nameForDisplay}
                      className="landing-profile-avatar"
                    />
                  ) : (
                    <div className="landing-profile-fallback" aria-hidden="true">
                      {profileInitial}
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  className="landing-bell"
                  aria-label={`Notifications (${total})`}
                  onClick={() => {
                    setShowNotifications((v) => !v);
                    setProfileMenuOpen(false);
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
                    <span className="landing-bell-badge">
                      {total > 99 ? "99+" : total}
                    </span>
                  )}
                </button>
                {showNotifications && (
                  <div className="landing-notification-panel">
                    <div className="landing-notification-header">
                      <strong>Notifications</strong>
                      <button
                        type="button"
                        className="landing-notification-clear"
                        onClick={markAllRead}
                        disabled={total === 0}
                      >
                        Mark read
                      </button>
                    </div>
                    {renderNotificationList()}
                  </div>
                )}
                {profileMenuOpen && (
                  <div className="landing-profile-menu">
                    <button
                      type="button"
                      className="landing-profile-item"
                      onClick={() => handleProfileAction("/dashboard")}
                    >
                      My Dashboard
                    </button>
                    <button
                      type="button"
                      className="landing-profile-item"
                      onClick={() => handleProfileAction("/me")}
                    >
                      My Profile
                    </button>
                    <button
                      type="button"
                      className="landing-profile-item"
                      onClick={() => handleProfileAction("/friends")}
                    >
                      My Friends
                    </button>
                    <button
                      type="button"
                      className="landing-profile-item"
                      onClick={() => handleProfileAction("/groups")}
                    >
                      My Groups
                    </button>
                    <button
                      type="button"
                      className="landing-profile-item"
                      onClick={() => {
                        logout();
                        setProfileMenuOpen(false);
                        navigate("/login");
                      }}
                    >
                      Logout
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <button className="btn-primary" onClick={openIntentPicker}>
                  Signup Now
                </button>
                <button className="btn-ghost" onClick={() => navigate("/login")}>
                  Log in
                </button>
              </>
            )}
          </div>
        </nav>

        <section className="hero">
          <div className="hero-copy">
            <div className="hero-badges">
              <span className="pill2">Only Positivity</span>
              <span className="pill2">Private messages</span>
              <span className="pill2">Daily momentum</span>
            </div>
            <h1>
              Let's Build a Community that Supports Each Other.
            </h1>
            <p>
              Your Social Place is built on mutual support-because you don't have to do this alone. 
              Share what you're working on, and get real feedback when you're stuck, encouragement 
              when you're tired, and accountability when you need that extra push. And as you grow, 
              you'll pass it forward-helping someone else stay in motion, too. No fluff-just people 
              lifting each other up and keeping their word.
            </p>
            <div className="hero-cta">
              <button
                className="btn-primary"
                onClick={openIntentPicker}
              >
                Signup Now
              </button>
              <button className="btn-ghost" onClick={() => navigate("/login")}>
                Already with us?
              </button>
            </div>
            {intentOpen && (
              <div className="hero-intent" ref={intentRef}>
                <p className="hero-intent-label">Choose your intention</p>
                <div className="hero-intent-options">
                  {INTENT_OPTIONS.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      className={`hero-intent-button${
                        selectedIntent === option.id ? " is-active" : ""
                      }`}
                      onClick={() => handleIntentSelect(option.id)}
                    >
                      <span className="hero-intent-title">{option.label}</span>
                      <span className="hero-intent-sub">{option.detail}</span>
                    </button>
                  ))}
                </div>
                <p className="hero-intent-note">
                  {selectedIntentOption
                    ? `Great. We'll tailor your onboarding for ${selectedIntentOption.label.toLowerCase()}.`
                    : "Pick an intention to continue to signup."}
                </p>
              </div>
            )}
          </div>

        </section>

        <footer className="landing-footer">
          <div className="footer-row footer-brand">
            <div className="footer-logo">
              <img src="/logo.png" alt="Your Social Place logo" />
            </div>
            <p>
              A motivational support network built for real progress. Beta access
              is live and evolving.
            </p>
          </div>
          <div className="footer-row footer-column">
            <span className="footer-title">Explore</span>
            {!user && (
              <>
                <a href="/login">Login</a>
                <a href="/register">Create account</a>
              </>
            )}
            <a href="/what-makes-us-different">What makes us different</a>
            <a href="/guidelines">Community Guidelines</a>
          </div>
          <div className="footer-row footer-column">
            <span className="footer-title">Safety</span>
            <a href="/safety">Safety &amp; Moderation</a>
            <a href="/report">Report a user</a>
          </div>
          <div className="footer-row footer-column">
            <span className="footer-title">Legal</span>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            <a href="/delete-account">Delete account</a>
            <a href="/delete-data">Delete data</a>
            <a href="/cookies">Cookie Policy</a>
          </div>
          <div className="footer-row footer-column">
            <span className="footer-title">Connect</span>
            <a href="mailto:support@yoursocialplace.com">Contact</a>
            <span className="footer-muted">support@yoursocialplace.com</span>
          </div>
          <div className="footer-row footer-meta">
            <span>Your Social Place</span>
            <span>by Stick2YourDreams</span>
          </div>
        </footer>
      </div>
    </div>
  );
}
