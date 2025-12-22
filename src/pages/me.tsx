// src/pages/Me.tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/dashboard.css";
import { useAuth } from "../context/AuthContext";
import api from "../api/strapi";
import axios from "axios";

type Profile = {
  firstName: string;
  lastName: string;
  age: string;
  gender: string;
  religion: string;
  hobbies: string;
  occupation: string;
  bio: string;
  handle?: string;
};

type MediaPost = {
  id: number;
  text: string;
  media?: string;
};

export default function Me() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const [profileId, setProfileId] = useState<number | null>(null);
  const [profileDocId, setProfileDocId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>({
    firstName: "",
    lastName: "",
    age: "",
    gender: "",
    religion: "",
    hobbies: "",
    occupation: "",
    bio: "",
    handle: "",
  });
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [mediaInput, setMediaInput] = useState("");
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [textInput, setTextInput] = useState("");
  const [posts, setPosts] = useState<MediaPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorModal, setErrorModal] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [successModal, setSuccessModal] = useState<string | null>(null);
  const [editing, setEditing] = useState(true);

  // Strapi v4/v5 compatibility helpers (v5 flattens attributes)
  const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");
  const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
  const slugifyHandle = (value: string) =>
    value
      .toString()
      .trim()
      .toLowerCase()
      .replace(/^@+/, "")
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "");
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
      setLoading(true);
      setError(null);
      setSuccess(null);
      try {
        // Try by user relation
        const byUser = await api.get(
          `/profiles?filters[user][id][$eq]=${user.id}&populate=avatar`
        );
        let mine = byUser.data?.data?.[0];
        // Fallback: by handle (username/email) if not linked to user
        if (!mine && user.username) {
          const byHandle = await api.get(
            `/profiles?filters[handle][$eq]=${encodeURIComponent(user.username)}&populate=avatar`
          );
          mine = byHandle.data?.data?.[0];
        }
        // If still nothing, show empty form for this user (avoid showing someone else's profile)
        if (!mine) {
          setProfile({
            firstName: "",
            lastName: "",
            age: "",
            gender: "",
            religion: "",
            hobbies: "",
            occupation: "",
            bio: "",
            handle: "",
          });
          setProfileId(null);
          setProfileDocId(null);
          setEditing(true);
          setLoading(false);
          return;
        }
        if (mine?.attributes) {
          const attrs = normalize(mine);
          setProfileId(mine.id ?? null);
          setProfileDocId(mine.documentId ?? attrs.documentId ?? null);
          setProfile({
            firstName: attrs.firstName || "",
            lastName: attrs.lastName || "",
            age: attrs.age || "",
            gender: attrs.gender || "",
            religion: attrs.religion || "",
            hobbies: attrs.hobbies || "",
            occupation: attrs.occupation || "",
            bio: attrs.bio || "",
            handle: attrs.handle || "",
          });
          setEditing(false);
        } else if (mine) {
          const attrs = normalize(mine);
          setProfile({
            firstName: attrs.firstName || "",
            lastName: attrs.lastName || "",
            age: attrs.age || "",
            gender: attrs.gender || "",
            religion: attrs.religion || "",
            hobbies: attrs.hobbies || "",
            occupation: attrs.occupation || "",
            bio: attrs.bio || "",
            handle: attrs.handle || "",
          });
          setProfileId(mine.id ?? null);
          setProfileDocId(mine.documentId ?? attrs.documentId ?? null);
          setEditing(false);
        }

        // Load my posts
        const postsRes = await api.get(
          `/users-posts?filters[owner][id][$eq]=${user.id}&populate=Users_Pictures`
        );
        const mappedPosts: MediaPost[] = (postsRes.data?.data ?? []).map((p: any) => {
          const attrs = normalize(p);
          const pic = pickMediaUrl(attrs.Users_Pictures);
          return {
            id: p.id ?? attrs.documentId,
            text: attrs.Users_Content || "",
            media: pic,
          };
        });
        setPosts(mappedPosts);
      } catch (err) {
        setError("Failed to load profile");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const saveProfile = async () => {
    if (!user) return;
    setError(null);
    setErrorModal(null);
    setSuccess(null);
    setSuccessModal(null);
    try {
      // refresh latest ids before saving to avoid stale docId/id mismatches
      try {
        const latest = await api.get(
          `/profiles?filters[user][id][$eq]=${user.id}&populate=avatar`
        );
        const current = latest.data?.data?.[0];
        if (current) {
          const attrs = normalize(current);
          setProfileId(current.id ?? null);
          setProfileDocId(current.documentId ?? attrs.documentId ?? null);
        }
      } catch {
        // best-effort refresh; continue
      }

      const safeFirst = profile.firstName || user.username || user.email || "user";
      const baseHandle = user.username || user.email || `user-${user.id}`;
      const desiredHandle = slugifyHandle(profile.handle || baseHandle) || `user-${user.id}`;

      // Upsert safety: check if profile already exists for this user to avoid duplicate handle errors
      let idToUse = profileId;
      let docIdToUse = profileDocId;
      if (!idToUse) {
        const check = await api.get(
          `/profiles?filters[user][id][$eq]=${user.id}&populate=avatar`
        );
        const existing = check.data?.data?.[0];
        if (existing) {
          const attrs = normalize(existing);
          idToUse = existing.id ?? idToUse ?? null;
          docIdToUse = existing.documentId ?? attrs.documentId ?? docIdToUse ?? null;
          setProfileId(existing.id ?? null);
          setProfileDocId(docIdToUse ?? null);
          setProfile({
            firstName: attrs.firstName || "",
            lastName: attrs.lastName || "",
            age: attrs.age || "",
            gender: attrs.gender || "",
            religion: attrs.religion || "",
            hobbies: attrs.hobbies || "",
            occupation: attrs.occupation || "",
            bio: attrs.bio || "",
            handle: attrs.handle || "",
          });
        }
      }

      // Ensure handle uniqueness (avoid 400 from Strapi uid)
      let handleValue = desiredHandle;
      const dupRes = await api.get(
        `/profiles?filters[handle][$eq]=${handleValue}&pagination[pageSize]=1`
      );
      const dup = dupRes.data?.data?.[0];
      const dupId = dup?.id ?? null;
      const dupDocId = dup?.documentId ?? dup?.attributes?.documentId;
      if (dup && (dupId !== idToUse || dupDocId !== docIdToUse)) {
        handleValue = `${handleValue}-${user.id}`;
      }

      let avatarId: number | undefined;
      if (avatarFile) {
        const fd = new FormData();
        fd.append("files", avatarFile);
        const uploadRes = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        avatarId = uploadRes.data?.[0]?.id;
      }

      const data = { ...profile, firstName: safeFirst, handle: handleValue };
      if (avatarId) (data as any).avatar = avatarId;
      (data as any).user = user.id;
      (data as any).locale = "en";

      let updated = false;

      const tryUpdate = async (target: string | number | null, useLocale = false) => {
        if (!target) return false;
        try {
          const suffix = useLocale ? `?locale=en` : "";
          await api.put(`/profiles/${target}${suffix}`, { data });
          return true;
        } catch (e) {
          if (axios.isAxiosError(e) && e.response?.status === 404) return false;
          throw e;
        }
      };

      // Try docId with locale first, then numeric id
      if (await tryUpdate(docIdToUse, true)) {
        updated = true;
      } else if (await tryUpdate(idToUse)) {
        updated = true;
      }

      if (!updated) {
        const createRes = await api.post("/profiles", {
          data: { ...data },
        });
        setProfileId(createRes.data?.data?.id || null);
        setProfileDocId(createRes.data?.data?.documentId || null);
      }
      setSuccess("Profile saved successfully.");
      setSuccessModal("Profile saved successfully.");
      setEditing(false);
    } catch (err) {
      setError("Failed to save profile");
      setErrorModal("Failed to save profile. Please try again.");
    }
  };

  const addPost = async () => {
    if (!textInput.trim() && !mediaInput.trim()) return;
    try {
      let mediaId: number | undefined;
      if (mediaFile) {
        const fd = new FormData();
        fd.append("files", mediaFile);
        const uploadRes = await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        mediaId = uploadRes.data?.[0]?.id;
      }

      await api.post("/users-posts", {
        data: {
          Title: textInput.slice(0, 50) || "Untitled",
          Users_Content: textInput,
          owner: user?.id,
          Users_Pictures: mediaId ? [mediaId] : undefined,
        },
      });

      // refresh posts
      const postsRes = await api.get(
        `/users-posts?filters[owner][id][$eq]=${user?.id}&populate=Users_Pictures`
      );
      const mappedPosts: MediaPost[] = (postsRes.data?.data ?? []).map((p: any) => {
        const attrs = normalize(p);
        const pic = pickMediaUrl(attrs.Users_Pictures);
        return {
          id: p.id ?? attrs.documentId,
          text: attrs.Users_Content || "",
          media: pic,
        };
      });
      setPosts(mappedPosts);
      setMediaInput("");
      setMediaFile(null);
      setTextInput("");
    } catch (err) {
      setError("Failed to create post");
    }
  };

  if (!user) return null;

  return (
    <div className="dashboard-shell">
      {errorModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#101018",
              padding: "24px",
              borderRadius: "12px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.4)",
              maxWidth: "420px",
              width: "90%",
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "#fff" }}>Something went wrong</h3>
            <p style={{ margin: "0 0 16px", color: "#d1d1d6" }}>{errorModal}</p>
            <div style={{ textAlign: "right" }}>
              <button className="btn primary" type="button" onClick={() => setErrorModal(null)}>
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      {successModal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "#0f172a",
              padding: "24px",
              borderRadius: "12px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.35)",
              maxWidth: "420px",
              width: "90%",
              border: "1px solid rgba(16, 185, 129, 0.4)",
            }}
          >
            <h3 style={{ margin: "0 0 12px", color: "#34d399" }}>Success</h3>
            <p style={{ margin: "0 0 16px", color: "#d1fae5" }}>{successModal}</p>
            <div style={{ textAlign: "right" }}>
              <button
                className="btn primary"
                type="button"
                onClick={() => {
                  setSuccessModal(null);
                  setSuccess(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
      <aside className="dash-nav">
        <div className="brand">
          <span className="brand-mark">S2YD</span>
          <span className="brand-text">Stick2YourDreams</span>
        </div>
        <div className="nav-actions" style={{ flexDirection: "column", alignItems: "flex-start" }}>
          <span className="nav-user">Me (@{user.username})</span>
          <button
            className="btn ghost nav-btn"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Logout
          </button>
        </div>
        <div className="nav-links">
          <button className="btn ghost nav-btn" onClick={() => navigate("/")}>
            Dashboard
          </button>
          <button className="btn ghost nav-btn" onClick={() => navigate("/friends")}>
            Friends
          </button>
          <button className="btn ghost nav-btn" onClick={() => navigate("/me")}>
            Me
          </button>
        </div>
      </aside>

      <div className="main-content">
        <div className="dash-hero">
          <div className="dash-hero__text">
            <p className="eyebrow">Profile</p>
            <h1>{profile.firstName || profile.lastName ? `${profile.firstName} ${profile.lastName}` : user.username}</h1>
            <p className="subhead">Edit your details and share media or text updates.</p>
          </div>
        </div>

        {loading && <p className="status">Loading profile…</p>}
        {error && <p className="status status-error">{error}</p>}
        {success && <p className="status status-success">{success}</p>}
        <div className="panel-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">About</p>
                <h3>Your Info</h3>
              </div>
              {!editing && (
                <button className="btn ghost" type="button" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
            </div>
            {editing ? (
              <div className="form-grid">
                <label className="field">
                  <span>Handle</span>
                  <input
                    className="auth-input"
                    placeholder="your-handle"
                    value={profile.handle || ""}
                    onChange={(e) => setProfile({ ...profile, handle: e.target.value })}
                  />
                </label>
                {([
                  ["First Name", "firstName"],
                  ["Last Name", "lastName"],
                  ["Age", "age"],
                  ["Gender", "gender"],
                  ["Religion", "religion"],
                  ["Hobbies", "hobbies"],
                  ["Occupation", "occupation"],
                ] as const).map(([label, key]) => (
                  <label className="field" key={key}>
                    <span>{label}</span>
                    <input
                      className="auth-input"
                      value={(profile as any)[key]}
                      onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
                    />
                  </label>
                ))}
                <label className="field">
                  <span>Bio</span>
                  <textarea
                    className="auth-input"
                    value={profile.bio}
                    onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                    rows={3}
                  />
                </label>
                <label className="field">
                  <span>Avatar</span>
                  <input
                    type="file"
                    className="auth-input"
                    accept="image/*"
                    onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
                  />
                </label>
                <div className="auth-actions">
                  <button className="btn primary" type="button" onClick={saveProfile}>
                    Save Profile
                  </button>
                </div>
              </div>
            ) : (
              <div className="form-grid">
                {([
                  ["Handle", profile.handle || `@${user.username}`],
                  ["First Name", profile.firstName],
                  ["Last Name", profile.lastName],
                  ["Age", profile.age],
                  ["Gender", profile.gender],
                  ["Religion", profile.religion],
                  ["Hobbies", profile.hobbies],
                  ["Occupation", profile.occupation],
                  ["Bio", profile.bio],
                ] as const).map(([label, value]) => (
                  <div className="field" key={label}>
                    <span>{label}</span>
                    <div className="auth-input" style={{ opacity: 0.8 }}>{value || "—"}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="panel-grid" style={{ marginTop: "16px" }}>
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Share</p>
                <h3>Media + Text</h3>
              </div>
            </div>
            <div className="form-grid">
              <label className="field">
                <span>Media URL (image/video)</span>
                <input
                  className="auth-input"
                  placeholder="https://example.com/media.png"
                  value={mediaInput}
                  onChange={(e) => setMediaInput(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Upload media (image/video)</span>
                <input
                  type="file"
                  className="auth-input"
                  accept="image/*,video/*"
                  onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
                />
              </label>
              <label className="field">
                <span>Caption / Text</span>
                <textarea
                  className="auth-input"
                  placeholder="Say something..."
                  value={textInput}
                  rows={3}
                  onChange={(e) => setTextInput(e.target.value)}
                />
              </label>
              <div className="auth-actions">
                <button className="btn primary" type="button" onClick={addPost}>
                  Post
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="posts-grid">
          {posts.map((p) => (
            <article key={p.id} className="post-card">
              {p.media ? (
                <div className="post-media">
                  {/* naive check for video */}
                  {p.media.match(/\.(mp4|webm|mov)$/i) ? (
                    <video controls style={{ width: "100%", height: "100%", objectFit: "cover" }}>
                      <source src={p.media} />
                    </video>
                  ) : (
                    <img src={p.media} alt={p.text} loading="lazy" />
                  )}
                </div>
              ) : null}
              <div className="post-body">
                <h3>{user.username}</h3>
                <p>{p.text}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
