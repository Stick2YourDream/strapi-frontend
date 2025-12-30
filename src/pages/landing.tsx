import "../css/landing.css";
import { Infinity } from "lucide-react";
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
    title: "Stick2YourDreams Connect | Build momentum with friends",
    description:
      "Stick2YourDreams Connect is a motivational support network where friends keep you accountable, celebrate progress, and build momentum together.",
    type: "website",
    canonical: "https://s2ydconnection.com/",
    keywords:
      "accountability, motivational support, community, goals, progress, friends, social network, productivity",
    image: "https://s2ydconnection.com/logo.png",
    imageAlt: "Stick2YourDreams Connect logo",
  });
  const [profileSummary, setProfileSummary] = useState<ProfileSummary | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [featuredPosts, setFeaturedPosts] = useState<FocusPost[]>([]);
  const [adminPosts, setAdminPosts] = useState<FocusPost[]>([]);
  const [focusLoading, setFocusLoading] = useState(true);
  const [focusPreviews, setFocusPreviews] = useState<Record<string, LinkPreview | null>>({});
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
        : "S2YD";

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

  const renderNotificationList = () => (
    <div className="landing-notification-list">
      <div className="landing-notification-group">
        <div className="landing-notification-item">
          <span>New messages</span>
          <span className="landing-notification-count">{counts.messages}</span>
        </div>
        {counts.messages > 0 && messagePreviewText && (
          <div className="landing-notification-preview">
            <span className="landing-notification-preview-text">{messagePreviewText}</span>
          </div>
        )}
      </div>
      <div className="landing-notification-group">
        <div className="landing-notification-item">
          <span>Friend requests</span>
          <span className="landing-notification-count">{counts.requests}</span>
        </div>
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
        <div className="landing-notification-item">
          <span>Friend posts</span>
          <span className="landing-notification-count">{counts.friendPosts}</span>
        </div>
        {counts.friendPosts > 0 && friendPostPreviewText && (
          <div className="landing-notification-preview">
            <span className="landing-notification-preview-text">{friendPostPreviewText}</span>
          </div>
        )}
      </div>
      <div className="landing-notification-group">
        <div className="landing-notification-item">
          <span>Group updates</span>
          <span className="landing-notification-count">{counts.groupUpdates}</span>
        </div>
        {counts.groupUpdates > 0 && groupUpdatePreviewText && (
          <div className="landing-notification-preview">
            <span className="landing-notification-preview-text">
              {groupUpdatePreviewText}
            </span>
          </div>
        )}
      </div>
      <div className="landing-notification-group">
        <div className="landing-notification-item">
          <span>Comments on your posts</span>
          <span className="landing-notification-count">{counts.comments}</span>
        </div>
        {counts.comments > 0 && commentPreviewText && (
          <div className="landing-notification-preview">
            <span className="landing-notification-preview-text">{commentPreviewText}</span>
          </div>
        )}
      </div>
      <div className="landing-notification-group">
        <div className="landing-notification-item">
          <span>Likes on your posts</span>
          <span className="landing-notification-count">{counts.likes}</span>
        </div>
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
  const profileInitial = nameForDisplay.charAt(0).toUpperCase();

  const handleProfileAction = (path: string) => {
    navigate(path);
    setProfileMenuOpen(false);
    setShowNotifications(false);
  };

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
        <header className="landing-nav">
          <div className="brand-mark">
            <span>S2YD</span>
            <span>Stick2YourDreams</span>
          </div>
          <div className="landing-beta">BETA</div>
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
        </header>

        <section className="hero">
          <div className="hero-copy">
            <div className="hero-badges">
              <span className="pill">Creators & Builders</span>
              <span className="pill">Private messages</span>
              <span className="pill">Daily momentum</span>
            </div>
            <h1>
              Let's Build a Community that Supports Each Other.
            </h1>
            <p>
              Stick2YourDreams is built on mutual support—because you don’t have to do this alone. 
              Share what you’re working on, and get real feedback when you’re stuck, encouragement 
              when you’re tired, and accountability when you need that extra push. And as you grow, 
              you’ll pass it forward—helping someone else stay in motion, too. No fluff—just people 
              lifting each other up and keeping their word.
            </p>
            <div className="hero-cta">
              <button className="btn-primary" onClick={() => navigate("/register")}>
                Join the Community!
              </button>
              <button className="btn-ghost" onClick={() => navigate("/login")}>
                Already with us?
              </button>
            </div>
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
                    <span className="focus-sub">Signals from the S2YD team.</span>
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
              <>
                {focusLoading && (
                  <span className="focus-status">Loading the latest posts...</span>
                )}
                <div className="hero-grid">
                  <div className="mini-card">
                    <strong>Friend Signals</strong>
                    <p>See who&apos;s active, who needs a nudge, and who just shipped.</p>
                  </div>
                  <div className="mini-card">
                    <strong>Share Posts</strong>
                    <p>Drop a quick win, a screenshot, or a link for feedback.</p>
                  </div>
                  <div className="mini-card">
                    <strong>Private Threads</strong>
                    <p>Keep real conversations going without getting buried in noise.</p>
                  </div>
                  <div className="mini-card">
                    <strong>Micro Goals</strong>
                    <p>Log tiny goals daily so you and your circle stay in sync.</p>
                  </div>
                </div>
              </>
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
          <div className="metrics">
            <div className="metric">
              <strong>Always</strong>
              <span>A Driven Community</span>
            </div>
            <div className="metric">
              <strong><Infinity size={30} /></strong>
              <span>People Who Care</span>
            </div>
            <div className="metric">
              <strong>0</strong>
              <span>No Nonsense Distractions</span>
            </div>
            <div className="metric">
              <strong>+</strong>
              <span>A Cleaner and Safer Community</span>
            </div>
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
            <div className="brand-mark">
              <span>S2YD</span>
              <span>Stick2YourDreams</span>
            </div>
            <p>
              A motivational support network built for real progress. Beta access
              is live and evolving.
            </p>
          </div>
          <div className="footer-row footer-column">
            <span className="footer-title">Explore</span>
            <a href="/login">Login</a>
            <a href="/register">Create account</a>
            <a href="/terms">Terms</a>
          </div>
          <div className="footer-row footer-column">
            <span className="footer-title">Connect</span>
            <a href="mailto:jasonadams@stick2yourdream.com">Contact</a>
            <span className="footer-muted">support@stick2yourdreams.com</span>
          </div>
          <div className="footer-row footer-meta">
            <span>Stick2YourDreams Connect</span>
            <span>(c) 2025 Stick2YourDreams</span>
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
                  placeholder="Tell us what would make Stick2YourDreams better."
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
