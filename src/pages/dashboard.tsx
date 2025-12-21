// src/pages/Dashboard.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import api from "../api/strapi";
import axios from "axios";
import "../css/dashboard.css";
import { useAuth } from "../context/AuthContext";

type NormalizedPost = {
  id: string | number;
  title: string;
  content: string;
  imageUrl?: string;
  createdAt?: string;
};

export default function Dashboard() {
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        // Populate media so Pictures/pictures is returned with URLs
        const res = await api.get("/posts?populate=Pictures");
        if (cancelled) return;
        setPosts(res.data?.data ?? []);
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
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const normalizedPosts: NormalizedPost[] = useMemo(() => {
    const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");

    return posts.map((p: any) => {
      // Support both Strapi default shape (data/attributes) and flattened custom responses
      const attributes = p?.attributes ?? p ?? {};
      const title = attributes.Title || attributes.title || "Untitled";
      const content = attributes.Posts_Content || attributes.content || "";

      // Handle Pictures: may be { data: [...] } or a direct array of media objects
      const picturesRaw =
        attributes.Pictures?.data ??
        attributes.Pictures ??
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

      return {
        id: p.id ?? p.documentId ?? title,
        title,
        content,
        imageUrl,
        createdAt: attributes.createdAt,
      };
    });
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

  return (
    <div className="dashboard-shell">
      <header className="dash-nav">
        <div className="brand">
          <span className="brand-mark">S2YD</span>
          <span className="brand-text">Stick2YourDreams</span>
        </div>
        <div className="nav-actions">
          {user && <span className="nav-user">Hello, {user.username}</span>}
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
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
