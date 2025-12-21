// src/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/strapi";
import axios from "axios";
import "../css/dashboard.css";
import { useAuth } from "../context/AuthContext";

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
  comments: CommentItem[];
};

export default function Dashboard() {
  const [posts, setPosts] = useState<any>({ admin: [], user: [], comments: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formFile, setFormFile] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [scrollActive, setScrollActive] = useState(false);
  const [commentInputs, setCommentInputs] = useState<Record<string | number, string>>({});

  const navigate = useNavigate();
  const { user, logout } = useAuth();

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
          api.get("/users-posts?populate=Users_Pictures"),
          api.get("/comments?populate=owner"),
        ]);

        const allComments = commentsRes.data?.data ?? [];

        if (cancelled) return;
        setPosts({
          admin: adminRes.data?.data ?? [],
          user: userRes.data?.data ?? [],
          comments: allComments,
        });
      } catch (err) {
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

    const onScroll = () => {
      setScrollActive(window.scrollY > 10);
    };
    window.addEventListener("scroll", onScroll);

    return () => {
      cancelled = true;
      window.removeEventListener("scroll", onScroll);
    };
  }, [navigate]);

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

      return {
        id: p.id ?? p.documentId ?? title,
        title,
        content,
        imageUrl,
        createdAt: attributes.createdAt,
        source,
        comments: matchedComments,
      };
    };

    const adminPosts = Array.isArray((posts as any)?.admin)
      ? (posts as any).admin.map((p: any) => normalize(p, "admin"))
      : [];
    const userPosts = Array.isArray((posts as any)?.user)
      ? (posts as any).user.map((p: any) => normalize(p, "user"))
      : [];

    return [...adminPosts, ...userPosts];
  }, [posts]);

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

  // Speak greeting aloud on login
  useEffect(() => {
    if (!user) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;

    const speak = () => {
      const utter = new SpeechSynthesisUtterance(`${greeting}, ${user.username}`);
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find((v) =>
        ["Google UK English Female", "Google US English", "en-US"].includes(v.name)
      );
      utter.voice = preferred || voices.find((v) => v.lang?.startsWith("en")) || null;
      utter.lang = utter.voice?.lang || "en-US";
      utter.rate = 1;
      utter.pitch = 1;

      window.speechSynthesis.cancel(); // stop any pending speech
      window.speechSynthesis.speak(utter);
    };

    // Some browsers populate voices asynchronously
    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = speak;
    } else {
      speak();
    }
  }, [greeting, user]);

  return (
    <div className="dashboard-shell">
      <header className={`dash-nav ${scrollActive ? "scrolled" : ""}`}>
        <div className="brand">
          <span className="brand-mark">S2YD</span>
          <span className="brand-text">Stick2YourDreams</span>
        </div>
        <div className="nav-actions">
          {user && (
            <span className="nav-user">
              {greeting}, {user.username}
            </span>
          )}
          <button
            className="btn ghost nav-btn"
            type="button"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <div className="dash-hero">
        <div className="dash-hero__text">
          <p className="eyebrow">Stick2YourDreams</p>
          <h1>Posts</h1>
          <p className="subhead">
            Fresh drops from the community. Rich cards, crisp typography, and
            cover art when available.
          </p>
        </div>
        <div className="hero-badge">
          <span className="pill">Live</span>
          <span>Authenticated</span>
        </div>
      </div>

      {loading && <p className="status">Loading posts…</p>}
      {error && <p className="status status-error">{error}</p>}

      {!loading && !error && (
        <>
          <div className="panel-grid">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Create</p>
                  <h3>New Post</h3>
                  <p className="panel-sub">
                    Craft a quick update. Cover image is optional via Strapi.
                  </p>
                </div>
              </div>
              <div className="form-grid">
                <label className="field">
                  <span>Title</span>
                  <input
                    className="auth-input"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="Post title"
                    required
                  />
                </label>
              <label className="field">
                <span>Content</span>
                <textarea
                  className="auth-input"
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                  placeholder="Write something..."
                  rows={4}
                  required
                />
              </label>
              <label className="field">
                <span>Picture (optional)</span>
                <div className="file-pill">
                  <label className="file-btn">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0] || null;
                        setFormFile(file);
                      }}
                    />
                    <span>Choose file</span>
                  </label>
                  <span className="file-name">
                    {formFile ? formFile.name : "No file selected"}
                  </span>
                </div>
              </label>
              {formError && <p className="auth-message error">{formError}</p>}
              <div className="auth-actions">
                <button
                  className="btn primary"
                  type="button"
                    disabled={submitting}
                    onClick={async () => {
                      setFormError(null);
                      if (!formTitle.trim() || !formContent.trim()) {
                        setFormError("Title and content are required.");
                        return;
                      }
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
                            Title: formTitle.trim(),
                            Users_Content: formContent.trim(),
                            owner: user?.id,
                            Users_Pictures: uploadedId ? [uploadedId] : undefined,
                          },
                        });

                        setFormTitle("");
                        setFormContent("");
                        setFormFile(null);
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
                      } catch (err) {
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
                    }}
                  >
                    {submitting ? "Creating..." : "Create Post"}
                  </button>
                </div>
              </div>
            </section>
          </div>

          <div className="posts-grid">
            {normalizedPosts.length === 0 && (
              <div className="empty-state">
                <p>No posts yet. Add one in Strapi to see it here.</p>
              </div>
            )}

            {normalizedPosts.map((post) => (
              <article key={post.id} className="post-card">
                {post.imageUrl ? (
                  <div className="post-media">
                    <img src={post.imageUrl} alt={post.title} loading="lazy" />
                  </div>
                ) : (
                  <div className="post-media placeholder">
                    <div className="dots" />
                    <span>No image</span>
                  </div>
                )}

                <div className="post-body">
                  <div className="post-meta">
                    <span className="pill subtle">Feature</span>
                    {post.createdAt && (
                      <span className="date">{formatDate(post.createdAt)}</span>
                    )}
                  </div>
                  <h3>{post.title}</h3>
                  <p>{post.content}</p>

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
                                  } catch (err) {
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
                          } catch (err) {
                            console.error("Add comment failed", err);
                            setError("Failed to add comment");
                          }
                        }}
                      >
                        Comment
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
      </>
    )}
  </div>
  );
}
