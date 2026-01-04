import "../css/landing.css";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import { useNotifications, type FriendRequestPreview } from "../hooks/useNotifications";
import { usePageMeta } from "../hooks/usePageMeta";

type ProfileSummary = {
  displayName: string;
  avatarUrl?: string;
  handle?: string;
};

type FocusPost = {
  id: string | number;
  title: string;
  excerpt: string;
  imageUrl?: string;
  author?: string;
  linkUrl?: string;
};

type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
};

const INTENT_OPTIONS = [
  { id: "build-habit", label: "Build A Habit", detail: "Daily accountability" },
  { id: "stay-connected", label: "Stay Connected", detail: "Weekly momentum" },
  { id: "find-accountability", label: "Find Accountability", detail: "Supportive check-ins" },
];

const FOCUS_PREVIEW_POSTS: FocusPost[] = [
  {
    id: "demo-1",
    title: "Shipping day 7",
    excerpt: "Shared my weekly progress and kept the streak alive.",
    author: "Member",
  },
  {
    id: "demo-2",
    title: "Habit check-in",
    excerpt: "30 minutes of deep work before breakfast. Anyone else doing this?",
    author: "Member",
  },
  {
    id: "demo-3",
    title: "Feedback loop",
    excerpt: "Posted my landing page and got two actionable tweaks.",
    author: "Member",
  },
];

const FOCUS_PREVIEW_STATS = [
  { label: "Wins shipped today", value: "12" },
  { label: "People asking for feedback", value: "5" },
  { label: "Active accountability streaks", value: "28" },
];

const trimText = (value: string, max: number) => {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= max) return cleaned;
  if (max <= 3) return cleaned.slice(0, max);
  return `${cleaned.slice(0, max - 3)}...`;
};

const trimPreviewText = (value?: string, max = 72) => {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= max) return cleaned;
  if (max <= 3) return cleaned.slice(0, max);
  return `${cleaned.slice(0, max - 3)}...`;
};

const extractFirstUrl = (text: string) => {
  const match = String(text || "").match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (!match) return "";
  let url = match[0].replace(/[),.!?]+$/, "");
  if (url.startsWith("www.")) url = `https://${url}`;
  return url;
};

export default function Landing() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  usePageMeta({
    title: "Your Social Place | Motivational social network without all the fluff",
    description:
      "Your Social Place is a community driven motivational social network where real people share dreams, goals, progress, and help uplift each other.",
    type: "website",
    canonical: "https://yoursocialplace.com/",
    keywords:
      "Your Social Place, motivational social network, community driven, accountability, goals, progress, friends, social network",
    image: "https://yoursocialplace.com/logo.png",
    imageAlt: "Your Social Place logo",
  });
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [featuredPosts, setFeaturedPosts] = useState<FocusPost[]>([]);
  const [adminPosts, setAdminPosts] = useState<FocusPost[]>([]);
  const [focusLoading, setFocusLoading] = useState(true);
  const [focusPreviews, setFocusPreviews] = useState<Record<string, LinkPreview | null>>({});
  const [selectedIntent, setSelectedIntent] = useState("");
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [suggestionName, setSuggestionName] = useState("");
  const [suggestionEmail, setSuggestionEmail] = useState("");
  const [suggestionMessage, setSuggestionMessage] = useState("");
  const [suggestionSending, setSuggestionSending] = useState(false);
  const [suggestionStatus, setSuggestionStatus] = useState<string | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
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

  const buildFocusPost = (entry: any, source: "featured" | "admin"): FocusPost => {
    const attrs = normalize(entry);
    const titleRaw = attrs.Title || "";
    const contentRaw = source === "admin" ? attrs.Posts_Content || "" : attrs.Users_Content || "";
    const linkUrl = extractFirstUrl(contentRaw);
    const mediaField = source === "admin" ? attrs.Pictures : attrs.Users_Pictures;
    const ownerData = source === "featured" ? normalize(attrs.owner?.data ?? attrs.owner) : null;
    const author =
      source === "featured"
        ? ownerData?.username || ownerData?.email || "Community"
        : "Your Social Place";

    const title =
      trimText(titleRaw, 56) ||
      trimText(contentRaw, 56) ||
      (source === "admin" ? "Admin update" : "Featured update");

    return {
      id: entry.id ?? attrs.documentId ?? title,
      title,
      excerpt: trimText(contentRaw, 90) || "Fresh momentum from the crew.",
      imageUrl: pickMediaUrl(mediaField),
      author,
      linkUrl: linkUrl || undefined,
    };
  };

  useEffect(() => {
    let active = true;

    const loadFocus = async () => {
      setFocusLoading(true);
      try {
        const [adminRes, featuredRes] = await Promise.all([
          api.get("/posts?populate=Pictures&sort=createdAt:desc&pagination[pageSize]=2"),
          api.get(
            "/users-posts?populate=Users_Pictures&populate=owner&sort=createdAt:desc&pagination[pageSize]=2"
          ),
        ]);

        if (!active) return;
        const admin = (adminRes.data?.data ?? []).map((p: any) =>
          buildFocusPost(p, "admin")
        );
        const featured = (featuredRes.data?.data ?? []).map((p: any) =>
          buildFocusPost(p, "featured")
        );
        setAdminPosts(admin);
        setFeaturedPosts(featured);
      } catch {
        if (!active) return;
        setAdminPosts([]);
        setFeaturedPosts([]);
      } finally {
        if (active) setFocusLoading(false);
      }
    };

    loadFocus();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const urls = [
      ...new Set(
        [...featuredPosts, ...adminPosts]
          .map((post) => post.linkUrl)
          .filter((url): url is string => Boolean(url))
      ),
    ];
    if (!urls.length) return;

    urls.forEach((url) => {
      if (focusPreviews[url] !== undefined) return;
      api
        .get("/link-preview", { params: { url } })
        .then((res) => {
          if (!active) return;
          const data = res.data?.data;
          const preview = data?.url
            ? {
                url: data.url,
                title: data.title,
                description: data.description,
                image: data.image,
                siteName: data.siteName,
                type: data.type,
              }
            : null;
          setFocusPreviews((prev) =>
            prev[url] !== undefined ? prev : { ...prev, [url]: preview }
          );
        })
        .catch(() => {
          if (!active) return;
          setFocusPreviews((prev) =>
            prev[url] !== undefined ? prev : { ...prev, [url]: null }
          );
        });
    });

    return () => {
      active = false;
    };
  }, [adminPosts, featuredPosts, focusPreviews]);

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
        const displayName =
          attrs.firstName || attrs.lastName
            ? `${attrs.firstName || ""} ${attrs.lastName || ""}`.trim()
            : attrs.handle || attrs.username || user.username;
        setProfileSummary({
          displayName,
          handle: attrs.handle || user.username,
          avatarUrl: pickMediaUrl(attrs.avatar),
        });
      } catch {
        setProfileSummary({
          displayName: user.username,
          handle: user.username,
        });
      }
    };

    loadProfile();
  }, [user]);

  useEffect(() => {
    if (!user) return;
    if (!suggestionName) {
      setSuggestionName(profileSummary?.displayName || user.username || "");
    }
    if (!suggestionEmail && user.email) {
      setSuggestionEmail(user.email);
    }
  }, [profileSummary?.displayName, suggestionEmail, suggestionName, user]);

  useEffect(() => {
    setProfileMenuOpen(false);
    setShowNotifications(false);
  }, [user]);

  const nameForDisplay = useMemo(
    () => profileSummary?.displayName || user?.username || "Account",
    [profileSummary?.displayName, user?.username]
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

  const focusHasPosts = featuredPosts.length > 0 || adminPosts.length > 0;
  const selectedIntentOption = INTENT_OPTIONS.find(
    (option) => option.id === selectedIntent
  );
  const profileInitial = nameForDisplay.charAt(0).toUpperCase();

  const handleSuggestionSubmit = async () => {
    const message = suggestionMessage.trim();
    if (!message) {
      setSuggestionError("Please share a suggestion before sending.");
      return;
    }

    setSuggestionSending(true);
    setSuggestionError(null);
    setSuggestionStatus(null);
    try {
      await api.post("/suggestions", {
        message,
        name: suggestionName.trim(),
        email: suggestionEmail.trim(),
        pageUrl: window.location.href,
        userId: user?.id,
        handle: profileSummary?.handle || user?.username,
      });
      setSuggestionStatus("Thank you! Your suggestion was sent.");
      setSuggestionMessage("");
    } catch {
      setSuggestionError("Unable to send suggestion right now.");
    } finally {
      setSuggestionSending(false);
    }
  };

  const renderFocusItem = (post: FocusPost, fallbackLabel: string, keyPrefix: string) => {
    const preview = post.linkUrl ? focusPreviews[post.linkUrl] : null;
    const thumbUrl = preview?.image || post.imageUrl;
    const title = preview?.title || post.title;
    const excerpt = trimText(preview?.description || post.excerpt, 90);
    const label = post.linkUrl ? "LINK" : fallbackLabel;
    const content = (
      <>
        <div className="focus-thumb">
          {thumbUrl ? (
            <img src={thumbUrl} alt={title} loading="lazy" />
          ) : (
            <span>{label}</span>
          )}
        </div>
        <div className="focus-body">
          <span className="focus-title">{title}</span>
          <span className="focus-excerpt">{excerpt}</span>
          {post.author && <span className="focus-author">by {post.author}</span>}
        </div>
      </>
    );

    if (post.linkUrl) {
      return (
        <a
          key={`${keyPrefix}-${post.id}`}
          className="focus-item"
          href={post.linkUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open link for ${title}`}
        >
          {content}
        </a>
      );
    }

    return (
      <div key={`${keyPrefix}-${post.id}`} className="focus-item">
        {content}
      </div>
    );
  };

  return (
    <div className="landing-page">
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
            <a href="/guidelines">Guidelines</a>
            <a href="#safety">Safety</a>
            <a href="#reporting">Report</a>
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
                <button className="btn-ghost" onClick={() => navigate("/login")}>
                  Log in
                </button>
                {/* <button className="btn-primary" onClick={() => navigate("/register")}>
                  Get started
                </button> */}
              </>
            )}
          </div>
        </nav>

        <section className="hero">
          <div className="hero-copy">
            <div className="hero-badges">
              <span className="pill2">Creators & Builders</span>
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
            <div className="hero-intent">
              <p className="hero-intent-label">Choose your intention</p>
              <div className="hero-intent-options">
                {INTENT_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={`hero-intent-button${
                      selectedIntent === option.id ? " is-active" : ""
                    }`}
                    onClick={() => setSelectedIntent(option.id)}
                  >
                    <span className="hero-intent-title">{option.label}</span>
                    <span className="hero-intent-sub">{option.detail}</span>
                  </button>
                ))}
              </div>
              <p className="hero-intent-note">
                {selectedIntentOption
                  ? `Great. We'll tailor your onboarding for ${selectedIntentOption.label.toLowerCase()}.`
                  : "Pick an intention to personalize your start."}
              </p>
            </div>
            <div className="hero-cta">
              <button
                className="btn-primary"
                onClick={() =>
                  navigate(
                    selectedIntent
                      ? `/register?intent=${encodeURIComponent(selectedIntent)}`
                      : "/register"
                  )
                }
                disabled={!selectedIntent}
              >
                {selectedIntent ? "Continue to signup" : "Choose an intention"}
              </button>
              <button className="btn-ghost" onClick={() => navigate("/login")}>
                Already with us?
              </button>
            </div>
            {!selectedIntent && (
              <button
                type="button"
                className="hero-cta-skip"
                onClick={() => navigate("/register")}
              >
                Skip for now
              </button>
            )}
          </div>

          <div className="hero-card">
            <h3>Today&apos;s Focus</h3>
            <p>What our community is doing.</p>
            {focusHasPosts ? (
              <div className="hero-focus">
                <div className="focus-column">
                  <div className="focus-heading">
                    <span className="focus-label">Featured posts</span>
                    <span className="focus-sub">Latest community updates.</span>
                  </div>
                  <div className="focus-list">
                    {featuredPosts.length ? (
                      featuredPosts.map((post) => renderFocusItem(post, "NEW", "featured"))
                    ) : (
                      <div className="focus-empty">No featured posts yet.</div>
                    )}
                  </div>
                </div>
                <div className="focus-column">
                  <div className="focus-heading">
                    <span className="focus-label">Admin posts</span>
                    <span className="focus-sub">Signals from the Your Social Place team.</span>
                  </div>
                  <div className="focus-list">
                    {adminPosts.length ? (
                      adminPosts.map((post) => renderFocusItem(post, "TEAM", "admin"))
                    ) : (
                      <div className="focus-empty">No admin posts yet.</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="focus-preview">
                <div className="focus-heading">
                  <span className="focus-label">Member preview</span>
                  <span className="focus-sub">A peek at what momentum looks like.</span>
                </div>
                {focusLoading && user && (
                  <span className="focus-status">Loading live updates...</span>
                )}
                <div className="focus-preview-grid">
                  <div className="focus-list">
                    {FOCUS_PREVIEW_POSTS.map((post) =>
                      renderFocusItem(post, "DEMO", "preview")
                    )}
                  </div>
                  <div className="focus-stats">
                    {FOCUS_PREVIEW_STATS.map((stat) => (
                      <div key={stat.label} className="focus-stat">
                        <span className="focus-stat-value">{stat.value}</span>
                        <span className="focus-stat-label">{stat.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="focus-preview-note">
                  Create an account to see live posts and join the conversation.
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-header">
            <h2>Built for people who make things</h2>
            <span className="muted">Creators, founders, designers, builders.</span>
          </div>
          <div className="feature-grid">
            <div className="feature">
              <h3>Frictionless invites</h3>
              <p>Find friends by handle and get instant context with bios and posts.</p>
            </div>
            <div className="feature">
              <h3>Signals not noise</h3>
              <p>Activity cues highlight who&apos;s moving so you can support fast.</p>
            </div>
            <div className="feature">
              <h3>Media-forward</h3>
              <p>Drop images, videos, and quick updates—no formatting battles.</p>
            </div>
            <div className="feature">
              <h3>Private threads</h3>
              <p>DMs that stay lightweight, focused, and discoverable with your crew.</p>
            </div>
            <div className="feature">
              <h3>Momentum metrics</h3>
              <p>Track streaks and tiny wins to keep the habit alive week over week.</p>
            </div>
            <div className="feature">
              <h3>Secure & trusted</h3>
              <p>Built on Strapi with modern auth—your circle stays private.</p>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-header">
            <h2>What you Get!</h2>
            <span className="muted">Define Trust Within Our Community!</span>
          </div>
          <ul className="trust-list">
            <li>
              <CheckCircle2 size={20} aria-hidden="true" />
              <span>No doomscrolling features</span>
            </li>
            <li>
              <CheckCircle2 size={20} aria-hidden="true" />
              <span>Encouragement and accountability first</span>
            </li>
            <li>
              <CheckCircle2 size={20} aria-hidden="true" />
              <span>Clear rules with fast reporting</span>
            </li>
            <li>
              <CheckCircle2 size={20} aria-hidden="true" />
              <span>Safer defaults, private-by-default profiles</span>
            </li>
          </ul>
        </section>

        <section className="section safety-section" id="safety">
          <div className="section-header">
            <h2>Safety &amp; Moderation</h2>
            <span className="muted">Clear expectations, quick action, respectful space.</span>
          </div>
          <div className="safety-grid">
            <div className="safety-card">
              <h3>Report in a few taps</h3>
              <p>
                Flag a post or user from any profile. Reports go straight into our
                review queue.
              </p>
            </div>
            <div className="safety-card">
              <h3>Mute or block instantly</h3>
              <p>
                Mute stops inbound messages. Block removes all communication between
                two users.
              </p>
            </div>
            <div className="safety-card">
              <h3>Private-by-default</h3>
              <p>
                Share at your pace. Keep your updates in a smaller circle until you
                decide otherwise.
              </p>
            </div>
          </div>
          <div className="safety-steps" id="reporting">
            <div className="safety-step">
              <span className="safety-step-number">1</span>
              <div>
                <strong>Report</strong>
                <p>Tell us what happened and why it feels unsafe or off-topic.</p>
              </div>
            </div>
            <div className="safety-step">
              <span className="safety-step-number">2</span>
              <div>
                <strong>Review</strong>
                <p>Our team reviews context, history, and impact.</p>
              </div>
            </div>
            <div className="safety-step">
              <span className="safety-step-number">3</span>
              <div>
                <strong>Action</strong>
                <p>We remove content, warn, or restrict accounts based on severity.</p>
              </div>
            </div>
          </div>
          <div className="safety-actions">
            <a className="btn-ghost" href="/guidelines#reporting">
              Read Community Guidelines
            </a>
            <a className="btn-primary" href="/guidelines#reporting">
              How reporting works
            </a>
          </div>
        </section>

        {/* <section className="cta">
          <div>
            <h3>Ready to stick to your dream?</h3>
            <p>Join the crew that celebrates your output, not your busywork.</p>
          </div>
          <div className="cta-actions">
            <button className="btn-primary" onClick={() => navigate("/register")}>
              Claim your spot
            </button>
            <button className="btn-ghost" onClick={() => navigate("/login")}>
              I already have an account
            </button>
          </div>
        </section> */}

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
            <a href="/guidelines">Community Guidelines</a>
          </div>
          <div className="footer-row footer-column">
            <span className="footer-title">Safety</span>
            <a href="#safety">Safety &amp; Moderation</a>
            <a href="/guidelines#reporting">Report a user</a>
          </div>
          <div className="footer-row footer-column">
            <span className="footer-title">Legal</span>
            <a href="/terms">Terms</a>
            <a href="/privacy">Privacy</a>
            <a href="/privacy#cookies">Cookie Policy</a>
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

      <button
        type="button"
        className="suggestion-fab"
        onClick={() => {
          setSuggestionOpen(true);
          setSuggestionStatus(null);
          setSuggestionError(null);
        }}
      >
        Make A Suggestion!
      </button>

      {suggestionOpen && (
        <div className="suggestion-overlay" role="dialog" aria-modal="true">
          <div className="suggestion-modal">
            <div className="suggestion-header">
              <div>
                <h3>Suggestion Box</h3>
                <p>Help us shape the beta. Share what you want to see next.</p>
              </div>
              <button
                type="button"
                className="suggestion-close"
                onClick={() => setSuggestionOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="suggestion-body">
              <div className="field">
                <label>Your name (optional)</label>
                <input
                  className="auth-input"
                  value={suggestionName}
                  onChange={(e) => setSuggestionName(e.target.value)}
                  placeholder="Your name"
                />
              </div>
              <div className="field">
                <label>Email (optional)</label>
                <input
                  className="auth-input"
                  type="email"
                  value={suggestionEmail}
                  onChange={(e) => setSuggestionEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
              <div className="field">
                <label>Your suggestion</label>
                <textarea
                  className="auth-input"
                  rows={4}
                  value={suggestionMessage}
                  onChange={(e) => setSuggestionMessage(e.target.value)}
                  placeholder="Tell us what would make Your Social Place better."
                />
              </div>
              {suggestionError && (
                <p className="auth-message error">{suggestionError}</p>
              )}
              {suggestionStatus && (
                <p className="auth-message info">{suggestionStatus}</p>
              )}
            </div>
            <div className="suggestion-footer">
              <button
                className="btn-ghost"
                type="button"
                onClick={() => setSuggestionOpen(false)}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                type="button"
                onClick={handleSuggestionSubmit}
                disabled={suggestionSending}
              >
                {suggestionSending ? "Sending..." : "Send suggestion"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
