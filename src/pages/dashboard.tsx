// src/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/strapi";
import axios from "axios";
import "../css/dashboard.css";
import { useAuth } from "../context/AuthContext";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import { usePageMeta } from "../hooks/usePageMeta";
import { useUserPreferences } from "../context/UserPreferencesContext";

type CommentItem = {
  id: string | number;
  body: string;
  owner?: string;
  ownerId?: string | number;
};

type NormalizedPost = {
  id: string | number;
  title: string;
  content: string;
  imageUrl?: string;
  createdAt?: string;
  source: "admin" | "user";
  ownerName?: string;
  ownerId?: number;
  comments: CommentItem[];
};

type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
};

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

const PREVIEW_DEBOUNCE_MS = 450;
const extractFirstUrl = (text: string) => {
  const match = text.match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (!match) return "";
  let url = match[0].replace(/[),.!?]+$/, "");
  if (url.startsWith("www.")) url = `https://${url}`;
  return url;
};
const hostnameFor = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
};
const isYoutubeUrl = (value: string) => {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes("youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
};
const isVideoUrl = (value?: string) => !!value && /\.(mp4|webm|mov)$/i.test(value);
const mediaDescriptor = (mediaUrl?: string, hasLink?: boolean) => {
  if (mediaUrl) return isVideoUrl(mediaUrl) ? "with a video" : "with a picture";
  if (hasLink) return "with a link";
  return "";
};
const sortByCreatedAtDesc = (items: NormalizedPost[]) =>
  [...items].sort((a, b) => {
    const aParsed = a.createdAt ? Date.parse(a.createdAt) : 0;
    const bParsed = b.createdAt ? Date.parse(b.createdAt) : 0;
    const aTime = Number.isNaN(aParsed) ? 0 : aParsed;
    const bTime = Number.isNaN(bParsed) ? 0 : bParsed;
    return bTime - aTime;
  });

const MOTIVATIONAL_PHRASES = [
  "Small steps today build the momentum you want tomorrow.",
  "Show up for yourself and the win will follow.",
  "Progress over perfection, always.",
  "Keep going. Your future self is already grateful.",
  "Consistency beats intensity. You have this.",
  "One focused action can change your whole day.",
  "You do not need to be perfect, just present.",
  "Start where you are and make the next right move.",
  "A calm mind creates strong progress.",
  "Choose progress, even if it is tiny.",
  "Your effort today is the seed of tomorrow.",
  "Keep the promise you made to yourself.",
  "You are closer than you think.",
  "One step forward is still forward.",
  "Little wins stack into big wins.",
  "You are building something that matters.",
  "Your pace is valid. Keep moving.",
  "Focus on what you can do in the next 10 minutes.",
  "Consistency turns dreams into plans.",
  "Take the next small action and breathe.",
  "Momentum loves a simple start.",
  "Be proud of showing up today.",
  "Quiet effort makes loud results.",
  "You can do hard things, one step at a time.",
  "Your future is shaped by what you do today.",
  "Choose progress over pressure.",
  "The habit is the win.",
  "Stay curious, stay kind, keep going.",
  "You are not behind. You are building.",
  "Your small action is still brave.",
  "Today counts, even if it feels ordinary.",
  "Make it simple. Then make it happen.",
  "Keep your focus narrow and your hope wide.",
  "You have what you need to begin.",
  "Your effort is already a success.",
  "Strong days start with one clear choice.",
  "Your goals want your attention, not your stress.",
  "One honest step beats ten perfect plans.",
  "You are doing better than you think.",
  "Keep your energy for what matters most.",
  "Be steady, be kind, be consistent.",
  "Your progress is real. Keep showing up.",
  "Let today be the day you move forward.",
  "Do the next doable thing.",
  "You are allowed to grow at your speed.",
  "Small moves, big direction.",
  "Every rep makes you stronger.",
  "Your momentum is building right now.",
  "Focus on the process and the results will follow.",
  "You are a builder. Keep building.",
  "You are stronger than your last excuse.",
  "Start small. Finish proud.",
  "Choose action over doubt.",
  "Your future self says thank you.",
  "Keep your eyes on the next step.",
  "Discipline is a gift you give yourself.",
  "You can reset and restart any time.",
  "Consistency is your superpower.",
  "Your effort is the plan.",
  "Do it imperfectly, do it today.",
  "Keep going, your growth is showing.",
  "One brave step changes everything.",
  "You are not alone in the work.",
  "Focus, breathe, move forward.",
  "You are creating your own momentum.",
  "The smallest step still moves you ahead.",
  "Your courage is in the try.",
  "Be the friend you need today.",
  "Progress loves patience.",
  "Let your actions speak louder than your doubts.",
  "Simple and steady beats rushed and messy.",
  "You are building trust with yourself.",
  "Your best effort today is enough.",
  "You have the power to choose a better next step.",
  "Keep your goals close and your worries far.",
  "You can do one more small thing.",
  "Your growth is worth the time.",
  "Show up. Breathe. Begin.",
  "You are building a life you believe in.",
  "Do the work, keep the faith.",
  "One good choice can set the tone for the day.",
  "You are capable of steady progress.",
  "Take the next step, then the next.",
  "You do not have to rush. Just continue.",
  "Your progress is proof of your strength.",
  "Keep your eyes on what you can control.",
  "Today is a fresh chance to try.",
  "Make it simple, make it consistent.",
  "You are doing the right kind of hard work.",
  "Your effort is building real change.",
  "Trust the process and keep your focus.",
  "You are allowed to be a work in progress.",
  "One focused hour beats a scattered day.",
  "You are capable of more than you feel today.",
  "Keep the routine, keep the dream.",
  "Progress is built in the quiet moments.",
  "Your dedication is paying off.",
  "Choose a small win right now.",
  "You are making steady forward motion.",
  "Do not quit. Adjust and continue.",
  "Your consistency is your edge.",
  "You are doing something meaningful today.",
  "Keep going. Your momentum is real.",
];

const LinkPreviewCard = ({
  preview,
  url,
  compact = false,
}: {
  preview: LinkPreview;
  url: string;
  compact?: boolean;
}) => {
  const title = preview.title || preview.siteName || hostnameFor(url);
  const meta = preview.siteName || hostnameFor(url);
  const showBadge = preview.type === "video" || isYoutubeUrl(url);
  return (
    <a
      className={`link-preview-card${compact ? " is-compact" : ""}`}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <div className="link-preview-media">
        {preview.image ? (
          <img src={preview.image} alt={title} loading="lazy" />
        ) : (
          <div className="link-preview-placeholder">LINK</div>
        )}
        {showBadge && <span className="link-preview-badge">Video</span>}
      </div>
      <div className="link-preview-body">
        <p className="link-preview-title">{title}</p>
        {preview.description && (
          <p className="link-preview-desc">{preview.description}</p>
        )}
        <span className="link-preview-url">{meta}</span>
      </div>
    </a>
  );
};

export default function Dashboard() {
  const [posts, setPosts] = useState<any>({ admin: [], user: [], comments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formContent, setFormContent] = useState("");
  const [formFile, setFormFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [commentInputs, setCommentInputs] = useState<Record<string | number, string>>({});
  const [linkPreview, setLinkPreview] = useState<LinkPreview | null>(null);
  const [linkPreviewLoading, setLinkPreviewLoading] = useState(false);
  const [linkPreviewError, setLinkPreviewError] = useState<string | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, LinkPreview | null>>({});
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);

  const navigate = useNavigate();
  const { user } = useAuth();
  const { getBackgroundStyle } = useUserPreferences();
  usePageMeta({
    title: "Dashboard | Stick2YourDreams Connect",
    description:
      "Share updates, celebrate wins, and stay accountable with your Stick2YourDreams community.",
    type: "website",
    robots: "noindex, nofollow",
  });
  const userLabel = user?.username || user?.email || "Guest";
  const userInitial = userLabel.charAt(0).toUpperCase();

  useEffect(() => {
    let active = true;

    const loadAvatar = async () => {
      if (!user) {
        setProfileAvatarUrl(null);
        return;
      }
      try {
        const res = await api.get(`/profiles?filters[user][id][$eq]=${user.id}&populate=avatar`);
        const entry = res.data?.data?.[0];
        const avatarUrl = entry ? pickMediaUrl(normalize(entry).avatar) : undefined;
        if (active) setProfileAvatarUrl(avatarUrl || null);
      } catch {
        if (active) setProfileAvatarUrl(null);
      }
    };

    loadAvatar();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    let cancelled = false;

    const loadPosts = async () => {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem("token");
      if (!token) {
        setLoading(false);
        navigate("/login");
        return;
      }

      try {
        // Fetch admin posts, user posts, and all comments
        const [adminRes, userRes, commentsRes] = await Promise.all([
          api.get("/posts?populate=Pictures"),
          api.get("/users-posts?populate=Users_Pictures&populate=owner"),
          api.get("/comments?populate=owner"),
        ]);

        const allComments = commentsRes.data?.data ?? [];

        if (cancelled) return;
        setPosts({
          admin: adminRes.data?.data ?? [],
          user: userRes.data?.data ?? [],
          comments: allComments,
        });
      } catch (err: unknown) {
        if (cancelled) return;

        if (axios.isAxiosError(err)) {
          const status = err.response?.status;
          const data: any = err.response?.data;
          const msg =
            data?.error?.message || data?.message || "Failed to load posts";

          if (status === 401) {
            setError(
              `401 Unauthorized. Token still in storage: ${
                !!localStorage.getItem("token")
              }. Message: ${msg}`
            );
            return;
          }

          if (status === 403) {
            setError(
              "403 Forbidden: Enable Authenticated role permissions for Posts (find/findOne) in Strapi."
            );
            return;
          }

          setError(msg);
        } else {
          setError("Failed to load posts");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadPosts();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const fetchLinkPreview = async (
    url: string,
    options?: { silent?: boolean }
  ): Promise<LinkPreview | null> => {
    if (!url) return null;
    if (previewCache[url] !== undefined) return previewCache[url];

    if (!options?.silent) {
      setLinkPreviewLoading(true);
      setLinkPreviewError(null);
    }

    try {
      const res = await api.get("/link-preview", { params: { url } });
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
      setPreviewCache((prev) => ({ ...prev, [url]: preview }));
      return preview;
    } catch {
      setPreviewCache((prev) => ({ ...prev, [url]: null }));
      if (!options?.silent) {
        setLinkPreviewError("Unable to load link preview.");
      }
      return null;
    } finally {
      if (!options?.silent) {
        setLinkPreviewLoading(false);
      }
    }
  };

  const normalizedPosts: NormalizedPost[] = useMemo(() => {
    const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");
    const allComments = (posts as any).comments ?? [];

    const normalize = (p: any, source: "admin" | "user"): NormalizedPost => {
      const attributes = p?.attributes ?? p ?? {};
      const title = attributes.Title || attributes.title || "Untitled";
      const content =
        attributes.Posts_Content || attributes.Users_Content || attributes.content || "";

      const picturesRaw =
        attributes.Pictures?.data ??
        attributes.Pictures ??
        attributes.Users_Pictures?.data ??
        attributes.Users_Pictures ??
        attributes.pictures?.data ??
        attributes.pictures;

      const mediaItem = Array.isArray(picturesRaw) ? picturesRaw[0] : picturesRaw;
      const mediaAttr = mediaItem?.attributes ?? mediaItem;
      const formats = mediaAttr?.formats;
      let imageUrl =
        mediaAttr?.url ||
        formats?.large?.url ||
        formats?.medium?.url ||
        formats?.small?.url ||
        formats?.thumbnail?.url;
      if (imageUrl && imageUrl.startsWith("/")) {
        imageUrl = `${apiBase}${imageUrl}`;
      }

      const targetIdStr = String(p.id ?? "");
      const matchedComments = allComments
        .filter((c: any) => {
          const targetType = String(c?.target_type ?? "").toLowerCase();
          const targetId = String(c?.target_id ?? "");
          return targetType === source && targetId === targetIdStr;
        })
        .map((c: any) => ({
          id: c.id,
          body: c.body,
          owner:
            c.attributes?.owner?.data?.attributes?.username ||
            c.owner?.username ||
            c.owner ||
            "User",
          ownerId:
            c.attributes?.owner?.data?.id ||
            c.owner?.id,
        }));

      const ownerData = attributes.owner?.data ?? attributes.owner;
      const ownerAttrs = ownerData?.attributes ?? ownerData;
      const ownerId =
        ownerData?.id ?? (typeof ownerData === "number" ? ownerData : ownerAttrs?.id);
      const ownerName =
        source === "user"
          ? ownerAttrs?.username || ownerAttrs?.email || "User"
          : "S2YD";

      return {
        id: p.id ?? p.documentId ?? title,
        title,
        content,
        imageUrl,
        createdAt: attributes.createdAt,
        source,
        ownerName,
        ownerId,
        comments: matchedComments,
      };
    };

    const adminPosts = Array.isArray((posts as any)?.admin)
      ? (posts as any).admin.map((p: any) => normalize(p, "admin"))
      : [];
    const userPosts = Array.isArray((posts as any)?.user)
      ? (posts as any).user.map((p: any) => normalize(p, "user"))
      : [];

    const sortedAdmin = sortByCreatedAtDesc(adminPosts);
    const sortedUser = sortByCreatedAtDesc(userPosts);

    return [...sortedAdmin, ...sortedUser];
  }, [posts]);

  useEffect(() => {
    const url = extractFirstUrl(formContent);
    if (!url) {
      setLinkPreview(null);
      setLinkPreviewError(null);
      setLinkPreviewLoading(false);
      return;
    }

    setLinkPreviewError(null);
    if (linkPreview?.url === url) return;
    const cached = previewCache[url];
    if (cached !== undefined) {
      setLinkPreview(cached);
      return;
    }

    let active = true;
    const handle = setTimeout(() => {
      fetchLinkPreview(url).then((preview) => {
        if (!active) return;
        setLinkPreview(preview);
      });
    }, PREVIEW_DEBOUNCE_MS);

    return () => {
      active = false;
      clearTimeout(handle);
    };
  }, [formContent, linkPreview?.url, previewCache]);

  useEffect(() => {
    const urls = Array.from(
      new Set(
        normalizedPosts
          .map((post) => extractFirstUrl(post.content))
          .filter((url) => url)
      )
    );

    if (!urls.length) return;
    urls.forEach((url) => {
      if (previewCache[url] !== undefined) return;
      void fetchLinkPreview(url, { silent: true });
    });
  }, [normalizedPosts, previewCache]);

  const formatDate = (date?: string) => {
    if (!date) return "";
    try {
      return new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(new Date(date));
    } catch {
      return date;
    }
  };

  const greeting = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  }, []);

  const motivation = useMemo(() => {
    const index = Math.floor(Math.random() * MOTIVATIONAL_PHRASES.length);
    return MOTIVATIONAL_PHRASES[index] || "Keep showing up for yourself.";
  }, []);

  const createPost = async () => {
    const content = formContent.trim();
    if (!content && !formFile) {
      setFormError("Add a message or a photo to post.");
      return;
    }

    const url = extractFirstUrl(content);
    const previewTitle = linkPreview?.url === url ? linkPreview.title : undefined;
    const derivedTitle =
      previewTitle || (url ? hostnameFor(url) : "") || content || "Post";

    setFormError(null);
    setSubmitting(true);
    try {
      let uploadedId: number | undefined;

      if (formFile) {
        const fd = new FormData();
        fd.append("files", formFile);
        const uploadRes = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        const uploaded = uploadRes.data?.[0];
        uploadedId = uploaded?.id;
      }

      await api.post("/users-posts", {
        data: {
          Title: String(derivedTitle).slice(0, 80) || "Post",
          Users_Content: content,
          owner: user?.id,
          Users_Pictures: uploadedId ? [uploadedId] : undefined,
        },
      });

      setFormContent("");
      setFormFile(null);
      setLinkPreview(null);
      setLinkPreviewError(null);
      const [adminRes, userRes] = await Promise.all([
        api.get("/posts?populate=Pictures"),
        api.get("/users-posts?populate=Users_Pictures&populate=owner"),
      ]);
      const commentsRes = await api.get("/comments?populate=owner");
      setPosts({
        admin: adminRes.data?.data ?? [],
        user: userRes.data?.data ?? [],
        comments: commentsRes.data?.data ?? [],
      });
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const msg =
          err.response?.data?.error?.message ||
          err.response?.data?.message ||
          "Failed to create post";
        setFormError(msg);
      } else {
        setFormError("Failed to create post");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const deletePost = async (postId: number) => {
    if (!window.confirm("Delete this post?")) return;
    try {
      await api.delete(`/users-posts/${postId}`);
      setPosts((prev: any) => ({
        ...prev,
        user: (prev.user || []).filter((p: any) => Number(p.id ?? p.documentId) !== postId),
      }));
    } catch (err) {
      console.error("Delete post failed", err);
      setError("Failed to delete post");
    }
  };

  return (
    <div className="dashboard-shell" style={getBackgroundStyle("dashboard")}>
      <Sidebar active="dashboard" />

      <div className="main-content">
        {user && (
          <div className="topbar-greeting">
            <span className="topbar-greeting-title">
              {greeting} {userLabel}
            </span>
            <span className="topbar-greeting-sub">{motivation}</span>
          </div>
        )}
        <TopbarSearch />
        <div className="dash-hero">
        <div className="dash-hero__text">
          <p className="eyebrow">S2YD</p>
          <h1>Posts</h1>
          <p className="subhead">
            See What Our Community Is Doing!
          </p>
        </div>
        <div className="hero-badge" style={{ display: 
          "flex", alignItems: "center",
           gap: "10px" }}>
          <span className="pill" title="Live">Live</span>
          <div style={{ display: "flex",
             alignItems: "center", 
             gap: "10px" }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: "50%",
                background: "linear-gradient(135deg, #60a5fa, #7c3aed)",
                display: "grid",
                placeItems: "center",
                color: "#fff",
                fontWeight: 700,
              }}
            >
              {userInitial}
            </div>
            <div style={{ lineHeight: 1.2 }}>
              <div style={{ fontSize: "12px", color: "#9ca3af" }}>Signed in as</div>
              <div style={{ fontWeight: 600 }}>{userLabel}</div>
            </div>
          </div>
        </div>
      </div>

      {loading && <p className="status">Loading posts…</p>}
      {error && <p className="status status-error">{error}</p>}

      {!loading && !error && (
        <>
          <div className="panel-grid">
            <section className="panel post-composer">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Create</p>
                  <h3>New Post</h3>
                  <p className="panel-sub">
                    Let Your Friends Know What You're Up To! 
                  </p>
                </div>
              </div>
              <div className="post-composer__top">
                <div className="post-composer__avatar">
                  {profileAvatarUrl ? (
                    <img
                      src={profileAvatarUrl}
                      alt={`${userLabel} avatar`}
                      onError={() => setProfileAvatarUrl(null)}
                    />
                  ) : (
                    <span>{userInitial}</span>
                  )}
                </div>
                <div className="post-composer__input">
                  <textarea
                    className="auth-input"
                    value={formContent}
                    onChange={(e) => {
                      setFormContent(e.target.value);
                      setFormError(null);
                    }}
                    placeholder="What's on your mind?"
                    rows={4}
                  />
                  {linkPreviewLoading && (
                    <span className="post-composer__hint">Loading preview...</span>
                  )}
                </div>
              </div>

              {linkPreview && (
                <LinkPreviewCard
                  preview={linkPreview}
                  url={linkPreview.url || extractFirstUrl(formContent)}
                />
              )}
              {linkPreviewError && <p className="status status-error">{linkPreviewError}</p>}

              <div className="post-composer__actions">
                <div className="post-composer__tools">
                  <label className="post-composer__tool">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setFormFile(file);
                        setFormError(null);
                      }}
                    />
                    <span>{formFile ? "Change media" : "Add photo/video"}</span>
                  </label>
                  <span className="post-composer__file">
                    {formFile ? formFile.name : "No media selected"}
                  </span>
                  {formFile && (
                    <button
                      className="btn ghost"
                      type="button"
                      onClick={() => setFormFile(null)}
                    >
                      Remove
                    </button>
                  )}
                </div>
                <button
                  className="btn primary"
                  type="button"
                  disabled={submitting}
                  onClick={createPost}
                >
                  {submitting ? "Posting..." : "Post"}
                </button>
              </div>

              {formError && <p className="auth-message error">{formError}</p>}
            </section>
          </div>

          <div className="posts-grid posts-grid--two">
            {normalizedPosts.length === 0 && (
              <div className="empty-state">
                <p>No posts yet. Add one in Strapi to see it here.</p>
              </div>
            )}

            {normalizedPosts.map((post) => {
              const postUrl = extractFirstUrl(post.content);
              const preview = postUrl ? previewCache[postUrl] : undefined;
              const hasLink = Boolean(postUrl);
              const descriptor = mediaDescriptor(post.imageUrl, hasLink);
              const previewImage = preview?.image;
              const showPreviewMedia = !post.imageUrl && !!previewImage;
              const showPlaceholder = !post.imageUrl && !previewImage;
              const authorLabel = post.ownerName || "User";
              const postId = Number(post.id);
              const canDelete =
                post.source === "user" &&
                Number.isFinite(postId) &&
                user?.id === post.ownerId;

              return (
                <article key={post.id} className="post-card">
                  <div className="post-meta-bar">
                    <span className="post-meta-name">{authorLabel}</span>
                    <span className="post-meta-text">just posted an update</span>
                    {descriptor && <span className="post-meta-tag">{descriptor}</span>}
                  </div>

                  {post.imageUrl ? (
                    <div className="post-media">
                      {isVideoUrl(post.imageUrl) ? (
                        <video controls style={{ width: "100%", height: "100%", objectFit: "cover" }}>
                          <source src={post.imageUrl} />
                        </video>
                      ) : (
                        <img src={post.imageUrl} alt={post.title} loading="lazy" />
                      )}
                    </div>
                  ) : showPreviewMedia ? (
                    <div className="post-media link-preview-media">
                      <img
                        src={previewImage}
                        alt={preview?.title || post.title}
                        loading="lazy"
                      />
                    </div>
                  ) : showPlaceholder ? (
                    <div
                      className={`post-media placeholder${hasLink ? " link-preview-placeholder" : ""}`}
                    >
                      <div className="dots" />
                      <span>No image</span>
                    </div>
                  ) : null}

                  <div className="post-body">
                    <div className="post-meta">
                      <span className="pill subtle">Feature</span>
                      <div className="post-meta-right">
                        {post.createdAt && (
                          <span className="date">{formatDate(post.createdAt)}</span>
                        )}
                        {canDelete && (
                          <button
                            className="btn ghost post-delete"
                            type="button"
                            onClick={() => deletePost(postId)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                    <h3>{post.title}</h3>
                    <p>{post.content}</p>
                    {preview && !post.imageUrl && (
                      <LinkPreviewCard
                        preview={preview}
                        url={preview.url || postUrl}
                        compact
                      />
                    )}

                    <div className="comments">
                      <p className="eyebrow">Comments</p>
                      {post.comments && post.comments.length > 0 ? (
                        <ul className="comment-list">
                          {post.comments.map((c) => (
                            <li key={c.id} className="comment-item">
                              <div className="comment-author">{c.owner || "User"}</div>
                              <div className="comment-body">{c.body}</div>
                              {user?.id === c.ownerId && (
                                <button
                                  className="btn ghost comment-delete"
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await api.delete(`/comments/${c.id}`);
                                      setPosts((prev: any) => ({
                                        ...prev,
                                        comments: (prev.comments || []).filter(
                                          (cc: any) => cc.id !== c.id
                                        ),
                                      }));
                                    } catch (err: unknown) {
                                      console.error("Delete comment failed", err);
                                      setError("Failed to delete comment");
                                    }
                                  }}
                                >
                                  Delete
                                </button>
                              )}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="status">No comments yet.</p>
                      )}
                      <div className="comment-form">
                        <input
                          className="auth-input"
                          placeholder="Add a comment..."
                          value={commentInputs[post.id] || ""}
                          onChange={(e) =>
                            setCommentInputs((prev) => ({ ...prev, [post.id]: e.target.value }))
                          }
                        />
                        <button
                          className="btn primary"
                          type="button"
                          disabled={!commentInputs[post.id]?.trim()}
                          onClick={async () => {
                            const body = (commentInputs[post.id] || "").trim();
                            if (!body) return;
                            try {
                              await api.post("/comments", {
                                data: {
                                  body,
                                  target_type: post.source === "admin" ? "admin" : "user",
                                  target_id: post.id,
                                },
                              });
                              const res = await api.get("/comments?populate=owner");
                              setPosts((prev: any) => ({
                                ...prev,
                                comments: res.data?.data ?? [],
                              }));
                              setCommentInputs((prev) => ({ ...prev, [post.id]: "" }));
                          } catch (err: unknown) {
                            console.error("Add comment failed", err);
                            if (axios.isAxiosError(err)) {
                              const msg =
                                err.response?.data?.error?.message ||
                                err.response?.data?.message ||
                                "Failed to add comment";
                              setError(String(msg));
                            } else {
                              setError("Failed to add comment");
                            }
                          }
                        }}
                      >
                          Comment
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
      </>
    )}
      </div>
      </div>
  );
}
