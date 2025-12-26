// src/pages/Me.tsx
import { useEffect, useMemo, useState } from "react";
import "../css/dashboard.css";
import "../css/profile.css";
import { useAuth } from "../context/AuthContext";
import api from "../api/strapi";
import axios from "axios";
import Sidebar from "../components/Sidebar";

type Profile = {
  firstName: string;
  lastName: string;
  age: string;
  gender: string;
  religion: string;
  hobbies: string;
  occupation: string;
  bio: string;
  phone?: string;
  handle?: string;
  avatarUrl?: string;
};

type MediaPost = {
  id: number | string;
  text: string;
  media?: string;
};

const slug = (s: string) =>
  (s || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

export default function Me() {
  const { user } = useAuth();

  const [profileDocumentId, setProfileDocumentId] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<number | string | null>(null);

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

  const apiBase = (import.meta.env.VITE_API_URL || "").replace(/\/api$/, "");
  const normalize = (entry: any) => entry?.attributes ?? entry ?? {};

  // ✅ stable unique handle: username/email + numeric user id
  const lockedUniqueHandle = useMemo(() => {
    if (!user) return "";
    const base = slug(user.username || user.email || "user");
    return `${base || "user"}-${user.id}`;
  }, [user]);

  const pickMediaUrl = (mediaField: any): string | undefined => {
    if (!mediaField) return undefined;

    const candidate =
      (Array.isArray(mediaField?.data) ? mediaField.data[0] : mediaField?.data) ??
      (Array.isArray(mediaField) ? mediaField[0] : mediaField);

    if (!candidate) return undefined;

    const attrs = normalize(candidate);
    const url =
      attrs.url ||
      attrs.formats?.large?.url ||
      attrs.formats?.medium?.url ||
      attrs.formats?.small?.url ||
      attrs.formats?.thumbnail?.url;

    if (!url) return undefined;
    return url.startsWith("/") ? `${apiBase}${url}` : url;
  };

  const setProfileFromEntry = (entry: any) => {
    if (!entry) return;
    const attrs = normalize(entry);

    setProfileDocumentId(entry.documentId ?? null);
    setProfileId(entry.id ?? null);

    setProfile({
      firstName: attrs.firstName || "",
      lastName: attrs.lastName || "",
      age: attrs.age || "",
      gender: attrs.gender || "",
      religion: attrs.religion || "",
      hobbies: attrs.hobbies || "",
      occupation: attrs.occupation || "",
      bio: attrs.bio || "",
      phone: attrs.phone || "",
      handle: attrs.handle || "",
      avatarUrl: pickMediaUrl(attrs.avatar),
    });
  };

  const fetchMyProfileByUser = async () => {
    if (!user) return null;
    const res = await api.get(
      `/profiles?filters[user][id][$eq]=${user.id}&populate=avatar&sort=updatedAt:desc&pagination[pageSize]=1`
    );
    return res.data?.data?.[0] ?? null;
  };

  // ✅ fallback: if the old profile wasn’t linked to user, we still find it by unique handle
  const fetchMyProfileByHandle = async (handle?: string) => {
    const target = (handle || "").trim() || lockedUniqueHandle;
    if (!target) return null;
    const res = await api.get(
      `/profiles?filters[handle][$eq]=${encodeURIComponent(target)}&populate=avatar&sort=updatedAt:desc&pagination[pageSize]=1`
    );
    return res.data?.data?.[0] ?? null;
  };

  const fetchMyProfileByHandlePrefix = async (prefix?: string) => {
    const target = (prefix || "").trim() || lockedUniqueHandle;
    if (!target) return null;
    const res = await api.get(
      `/profiles?filters[handle][$startsWith]=${encodeURIComponent(target)}&populate=avatar&sort=updatedAt:desc&pagination[pageSize]=1`
    );
    return res.data?.data?.[0] ?? null;
  };

  const fetchMyProfile = async () => {
    const byUser = await fetchMyProfileByUser();
    if (byUser) return byUser;
    const candidates = [profile.handle, lockedUniqueHandle].filter(Boolean) as string[];
    for (const handle of candidates) {
      const byHandle = await fetchMyProfileByHandle(handle);
      if (byHandle) return byHandle;
    }
    for (const prefix of candidates) {
      const byPrefix = await fetchMyProfileByHandlePrefix(prefix);
      if (byPrefix) return byPrefix;
    }
    return null;
  };

  const fetchProfileByDocumentId = async (documentId: string | number) => {
    const res = await api.get(`/profiles/${documentId}?populate=avatar`);
    return res.data?.data ?? null;
  };

  const fetchMyPosts = async () => {
    if (!user) return;

    const postsRes = await api.get(
      `/users-posts?filters[owner][id][$eq]=${user.id}&populate=Users_Pictures&sort=createdAt:desc`
    );

    const mappedPosts: MediaPost[] = (postsRes.data?.data ?? []).map((p: any) => {
      const attrs = normalize(p);
      const pic = pickMediaUrl(attrs.Users_Pictures);
      return {
        id: p.documentId ?? p.id ?? attrs.documentId,
        text: attrs.Users_Content || "",
        media: pic,
      };
    });

    setPosts(mappedPosts);
  };

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      setLoading(true);
      setError(null);
      setSuccess(null);

      try {
        const mine = await fetchMyProfile();

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
            phone: "",
            handle: lockedUniqueHandle, // show the locked handle even if empty profile
          });
          setProfileDocumentId(null);
          setProfileId(null);
          setEditing(true);
          await fetchMyPosts();
          return;
        }

        setProfileFromEntry(mine);
        setEditing(false);
        await fetchMyPosts();
      } catch {
        setError("Failed to load profile");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [user?.id, lockedUniqueHandle]);

  const saveProfile = async () => {
  if (!user) return;

  setError(null);
  setErrorModal(null);
  setSuccess(null);
  setSuccessModal(null);

  try {
    const safeFirst = profile.firstName || user.username || user.email || "user";
    const baseHandle = (profile.handle || lockedUniqueHandle || "").trim() || lockedUniqueHandle;
    const buildUniqueHandle = () => `${baseHandle}-${user.id}-${Math.floor(1000 + Math.random() * 9000)}`;

    const sanitizePhone = (value?: string) => (value || "").replace(/[^\d+]/g, "").slice(0, 15);
    const phoneClean = sanitizePhone(profile.phone);

    let avatarId: number | undefined;
    let uploadedAvatarUrl: string | undefined;

    if (avatarFile) {
      const fd = new FormData();
      fd.append("files", avatarFile);

      const uploadRes = await api.post("/upload", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      avatarId = uploadRes.data?.[0]?.id;
      uploadedAvatarUrl = pickMediaUrl(uploadRes.data?.[0]);
    }

    const buildPayload = (handleValue: string) => {
      const data: any = {
        firstName: safeFirst,
        lastName: profile.lastName,
        age: profile.age,
        gender: profile.gender,
        religion: profile.religion,
        hobbies: profile.hobbies,
        occupation: profile.occupation,
        bio: profile.bio,
        handle: handleValue,
        locale: "en",
        user: user.id,
      };
      data.phone = phoneClean ? phoneClean : null;
      if (avatarId) data.avatar = avatarId;
      return data;
    };

    const existing = await fetchMyProfile();
    let docId: string | null = existing?.documentId ?? profileDocumentId ?? null;
    let numericId: number | string | null = existing?.id ?? profileId ?? null;
    let handleToUse = baseHandle;
    let payload = buildPayload(handleToUse);

    const tryUpdate = async (resourceId: string | number, allowPhoneRetry = true) => {
      try {
        const res = await api.put(`/profiles/${resourceId}`, { data: payload });
        return res.data?.data ?? null;
      } catch (e) {
        if (axios.isAxiosError(e)) {
          const status = e.response?.status;
          const msg = String(e.response?.data?.error?.message || "").toLowerCase();

          if (status === 400 && msg.includes("phone")) {
            if (!allowPhoneRetry) throw e;
            const clone = { ...payload };
            delete clone.phone;
            const res = await api.put(`/profiles/${resourceId}`, { data: clone });
            return res.data?.data ?? null;
          }

          if (status === 404) return null;
        }
        throw e;
      }
    };

    const tryCreate = async () => {
      const res = await api.post("/profiles", { data: payload });
      return res.data?.data ?? null;
    };

    const isHandleUniqueError = (err: any) => {
      if (!axios.isAxiosError(err)) return false;
      const msg = String(err.response?.data?.error?.message || err.response?.data?.message || "").toLowerCase();
      const errors = (err.response?.data?.error?.details?.errors ?? []) as any[];
      const handleErr = errors?.find((e: any) => (e?.path ?? []).includes("handle"));
      return msg.includes("unique") && (msg.includes("handle") || handleErr);
    };

    const saveOnce = async () => {
      const updateTarget = docId ?? numericId;
      if (updateTarget) {
        const updated = await tryUpdate(updateTarget);
        if (updated) {
          docId = updated.documentId ?? docId ?? null;
          numericId = updated.id ?? numericId ?? null;
          return updated;
        }
        docId = null;
        numericId = null;
      }
      const created = await tryCreate();
      if (created) {
        docId = created.documentId ?? null;
        numericId = created.id ?? null;
      }
      return created;
    };

    try {
      const saved = await saveOnce();
      docId = saved?.documentId ?? docId ?? null;
      numericId = saved?.id ?? numericId ?? null;
    } catch (e) {
      if (isHandleUniqueError(e)) {
        handleToUse = buildUniqueHandle();
        payload = buildPayload(handleToUse);
        const saved = await saveOnce();
        docId = saved?.documentId ?? docId ?? null;
        numericId = saved?.id ?? numericId ?? null;
        setProfile((prev) => ({ ...prev, handle: handleToUse }));
      } else {
        throw e;
      }
    }

    if (uploadedAvatarUrl) {
      setProfile((prev) => ({ ...prev, avatarUrl: uploadedAvatarUrl }));
    }

    const profileKey = docId ?? numericId;
    if (profileKey) {
      const fresh = await fetchProfileByDocumentId(profileKey);
      if (!fresh) throw new Error("Save succeeded but refresh failed");
      setProfileFromEntry(fresh);
    } else {
      const mine = await fetchMyProfile();
      if (!mine) throw new Error("Save succeeded but no profile found");
      setProfileFromEntry(mine);
    }

    setSuccess("Profile saved successfully.");
    setSuccessModal("Profile saved successfully.");
    setEditing(false);
  } catch (e) {
    if (axios.isAxiosError(e)) {
      const msg =
        e.response?.data?.error?.message ||
        e.response?.data?.message ||
        "Failed to save profile";
      setError(String(msg));
      setErrorModal(String(msg));
    } else {
      setError("Failed to save profile");
      setErrorModal("Failed to save profile. Please try again.");
    }
  }
};const addPost = async () => {
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

      await fetchMyPosts();
      setMediaInput("");
      setMediaFile(null);
      setTextInput("");
    } catch {
      setError("Failed to create post");
    }
  };

  if (!user) return null;

  const displayName =
    (profile.firstName || profile.lastName
      ? `${profile.firstName || ""} ${profile.lastName || ""}`.trim()
      : user.username) || user.email;
  const displayHandle = profile.handle || lockedUniqueHandle;
  const avatarImg = profile.avatarUrl;
  const initials =
    displayName
      ?.split(" ")
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "ME";

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

      <Sidebar active="me" />

      <div className="main-content">
        <div className="dash-hero">
          <div className="dash-hero__text">
            <p className="eyebrow">Profile</p>
            <p className="subhead">A clean snapshot of you, with quick actions and easy editing.</p>
          </div>
        </div>

        {loading && <p className="status">Loading profile…</p>}
        {error && <p className="status status-error">{error}</p>}
        {success && <p className="status status-success">{success}</p>}

        <div className="panel-grid" style={{ marginBottom: "16px" }}>
          <section
            className="panel"
            style={{
              background: "linear-gradient(135deg, rgba(92,128,255,0.12), rgba(16,185,129,0.08))",
              border: "1px solid rgba(255,255,255,0.06)",
              display: "grid",
              gridTemplateColumns: "auto 1fr",
              gap: "18px",
              alignItems: "center",
              padding: "20px 22px",
            }}
          >
            <div
              style={{
                width: 96,
                height: 96,
                borderRadius: "22px",
                background: "rgba(255,255,255,0.06)",
                display: "grid",
                placeItems: "center",
                overflow: "hidden",
                boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
              }}
            >
              {avatarImg ? (
                <img
                  src={avatarImg}
                  alt={displayName}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span style={{ fontWeight: 700, color: "#cdd5e8", fontSize: 22 }}>{initials}</span>
              )}
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0 }}>{displayName}</h2>
                <span
                  style={{
                    background: "rgba(255,255,255,0.07)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    padding: "6px 12px",
                    borderRadius: 999,
                    fontSize: 12,
                    letterSpacing: 0.2,
                  }}
                >
                  @{displayHandle}
                </span>
              </div>
              <p style={{ margin: 0, color: "#cdd5e8", maxWidth: 720 }}>
                {profile.bio || "Share a quick bio to help friends recognize you."}
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn primary" type="button" onClick={() => setEditing(true)}>
                  Edit Profile
                </button>
                <button className="btn ghost" type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
                  Jump to top
                </button>
              </div>
            </div>
          </section>
        </div>

        <div className="panel-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">About</p>
                <h3>Your Info</h3>
              </div>
            </div>

            {editing ? (
              <div className="profile-edit-grid">
                <label className="profile-field">
                  <span className="profile-field-label">Handle</span>
                  <input
                    className="auth-input"
                    value={lockedUniqueHandle}
                    readOnly
                    disabled
                    tabIndex={-1}
                    onFocus={(e) => e.target.blur()}
                    style={{ pointerEvents: "none", userSelect: "none", opacity: 0.7 }}
                  />
                  <small style={{ color: "#9ca3af" }}>Locked + unique (username/email + user id).</small>
                </label>

                {(
                  [
                    ["First Name", "firstName"],
                    ["Last Name", "lastName"],
                    ["Age", "age"],
                    ["Phone", "phone"],
                    ["Gender", "gender"],
                    ["Religion", "religion"],
                    ["Hobbies", "hobbies"],
                    ["Occupation", "occupation"],
                  ] as const
                ).map(([label, key]) => (
                  <label className="profile-field" key={key}>
                    <span className="profile-field-label">{label}</span>
                    <input
                      className="auth-input"
                      maxLength={64}
                      value={(profile as any)[key] || ""}
                      onChange={(e) => setProfile({ ...profile, [key]: e.target.value })}
                    />
                  </label>
                ))}

                <label className="profile-field profile-span-2">
                  <span className="profile-field-label">Bio</span>
                  <textarea
                    className="auth-input"
                    value={profile.bio}
                    onChange={(e) => setProfile({ ...profile, bio: e.target.value })}
                    rows={3}
                  />
                </label>

                <label className="profile-field profile-span-2">
                  <span className="profile-field-label">Avatar</span>
                  <input
                    type="file"
                    className="auth-input"
                    accept="image/*"
                    onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
                  />
                </label>

                <div className="profile-actions profile-span-2">
                  <button className="btn primary" type="button" onClick={saveProfile}>
                    Save Profile
                  </button>
                </div>
              </div>
            ) : (
              <div className="profile-info-grid">
                {(
                  [
                    ["Handle", profile.handle || lockedUniqueHandle],
                    ["First Name", profile.firstName],
                    ["Last Name", profile.lastName],
                    ["Age", profile.age],
                    ["Phone", profile.phone],
                    ["Gender", profile.gender],
                    ["Religion", profile.religion],
                    ["Hobbies", profile.hobbies],
                    ["Occupation", profile.occupation],
                    ["Bio", profile.bio],
                  ] as const
                ).map(([label, value]) => (
                  <div className="profile-card" key={label}>
                    <p className="profile-card-label">{label}</p>
                    <p className="profile-card-value">{value || "-"}</p>
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
            <article key={String(p.id)} className="post-card">
              {p.media ? (
                <div className="post-media">
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
