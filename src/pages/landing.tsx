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
  const { user, profile, logout } = useAuth();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const intentRef = useRef<HTMLDivElement | null>(null);
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
      tl.from(".landing-nav", { y: -12, opacity: 0, duration: 0.6 })
        .from(".hero-badges .pill2", { y: 16, opacity: 0, stagger: 0.08 }, "-=0.2")
        .from(".hero-copy h1", { y: 20, opacity: 0 }, "-=0.1")
        .from(".hero-copy p", { y: 18, opacity: 0 }, "-=0.2")
        .from(".hero-intent-button", { y: 16, opacity: 0, stagger: 0.07 }, "-=0.2")
        .from(
          ".hero-cta .btn-primary, .hero-cta .btn-ghost, .hero-cta-skip",
          { y: 12, opacity: 0, stagger: 0.06 },
          "-=0.2"
        )
        .from(".hero-card", { y: 26, opacity: 0 }, "-=0.4");
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

  const getOwnerId = (entry: any): number | null => {
    const attrs = normalize(entry);
    const owner = attrs.owner?.data ?? attrs.owner;
    const rawId = owner?.id ?? owner?.data?.id;
    const numeric = Number(rawId);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const buildFocusPost = (
    entry: any,
    source: "featured" | "admin",
    authorMap?: Record<number, string>
  ): FocusPost => {
    const attrs = normalize(entry);
    const titleRaw = attrs.Title || "";
    const contentRaw = source === "admin" ? attrs.Posts_Content || "" : attrs.Users_Content || "";
    const linkUrl = extractFirstUrl(contentRaw);
    const mediaField = source === "admin" ? attrs.Pictures : attrs.Users_Pictures;
    const ownerData = source === "featured" ? normalize(attrs.owner?.data ?? attrs.owner) : null;
    const ownerId = source === "featured" ? getOwnerId(entry) : null;
    const mappedAuthor = ownerId ? authorMap?.[ownerId] : undefined;
    const author =
      source === "featured"
        ? mappedAuthor ||
          ownerData?.handle ||
          ownerData?.username ||
          ownerData?.email ||
          "Community"
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

  const fetchFocusAuthorMap = async (userIds: number[]) => {
    if (!userIds.length) return {};
    const filter = userIds
      .map((id, index) => `filters[user][id][$in][${index}]=${id}`)
      .join("&");
    const res = await api.get(
      `/profiles?${filter}&populate=user&pagination[pageSize]=${userIds.length}`
    );
    const map: Record<number, string> = {};
    (res.data?.data ?? []).forEach((entry: any) => {
      const attrs = normalize(entry);
      const userData = attrs.user?.data ?? attrs.user;
      const rawId = userData?.id ?? userData?.data?.id;
      const numeric = Number(rawId);
      if (!Number.isFinite(numeric)) return;
      const first = String(attrs.firstName || "").trim();
      const last = String(attrs.lastName || "").trim();
      const full = `${first} ${last}`.trim();
      const handle = String(attrs.handle || "").trim();
      const label = full || handle;
      if (label) {
        map[numeric] = label;
      }
    });
    return map;
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
        const adminEntries = adminRes.data?.data ?? [];
        const featuredEntries = featuredRes.data?.data ?? [];
        const ownerIds = Array.from(
          new Set(
            featuredEntries
              .map((entry: any) => getOwnerId(entry))
              .filter((id): id is number => Number.isFinite(id))
          )
        );
        let authorMap: Record<number, string> = {};
        try {
          authorMap = await fetchFocusAuthorMap(ownerIds);
        } catch {
          authorMap = {};
        }
        if (!active) return;

        const admin = adminEntries.map((p: any) => buildFocusPost(p, "admin"));
        const featured = featuredEntries.map((p: any) =>
          buildFocusPost(p, "featured", authorMap)
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

  const openIntentPicker = () => {
    setIntentOpen(true);
  };

  const handleIntentSelect = (intentId: string) => {
    setSelectedIntent(intentId);
    navigate(`/register?intent=${encodeURIComponent(intentId)}`);
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
