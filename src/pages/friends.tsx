// src/pages/Friends.tsx
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import "../css/dashboard.css";
import { useAuth } from "../context/AuthContext";
import api from "../api/strapi";

type FriendPost = {
  id: number | string;
  title: string;
  content: string;
  imageUrl?: string;
};

type FriendProfile = {
  id: number | string;
  handle: string;
  bio?: string;
  userId?: number;
  username?: string;
};

type FriendRelation = {
  id: number | string;
  idNumber?: number;
  docId?: string;
  requesterId?: number;
  targetId?: number;
  status: "pending" | "accepted" | "blocked" | string;
};

export default function Friends() {
  const navigate = useNavigate();
  const { user } = useAuth();

  const [query, setQuery] = useState("");
  const [addHandle, setAddHandle] = useState("");
  const [profiles, setProfiles] = useState<FriendProfile[]>([]);
  const [friends, setFriends] = useState<FriendRelation[]>([]);
  const [messages, setMessages] = useState<Record<string | number, string>>({});
  const [postsByOwner, setPostsByOwner] = useState<Record<number, FriendPost[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  // Load profiles, friends, and posts
  useEffect(() => {
    const load = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const profilesRes = await api.get("/profiles?populate=user");
        const mappedProfiles: FriendProfile[] = (profilesRes.data?.data ?? []).map((p: any) => {
          const attrs = normalize(p);
          const userData = normalize(attrs.user?.data ?? attrs.user);
          return {
            id: p.id ?? attrs.documentId,
            userId: userData?.id,
            username: userData?.username,
            handle: attrs.handle || userData?.username || `user-${p.id ?? attrs.documentId}`,
            bio: attrs.bio || "",
          };
        });

        const ownerIds = mappedProfiles.map((p) => p.userId).filter(Boolean) as number[];
        if (ownerIds.length) {
          const postsRes = await api.get(
            `/users-posts?filters[owner][id][$in]=${ownerIds.join(
              ","
            )}&populate=Users_Pictures&populate=owner`
          );
          const grouped: Record<number, FriendPost[]> = {};
          (postsRes.data?.data ?? []).forEach((p: any) => {
            const attrs = normalize(p);
            const ownerId = normalize(attrs.owner?.data ?? attrs.owner)?.id;
            if (!ownerId) return;
            const imageUrl = pickMediaUrl(attrs.Users_Pictures);
            (grouped[ownerId] = grouped[ownerId] || []).push({
              id: p.id ?? attrs.documentId,
              title: attrs.Title || "Untitled",
              content: attrs.Users_Content || "",
              imageUrl,
            });
          });
          setPostsByOwner(grouped);
        } else {
          setPostsByOwner({});
        }

        // Load friendship relations for current user
      const friendsRes = await api.get(
        `/friends?filters[$or][0][requester][id][$eq]=${user.id}&filters[$or][1][target][id][$eq]=${user.id}&populate=requester&populate=target`
      );
      const mappedFriends: FriendRelation[] = (friendsRes.data?.data ?? []).map((f: any) => {
        const attrs = normalize(f);
        const requester = normalize(attrs.requester?.data ?? attrs.requester);
        const target = normalize(attrs.target?.data ?? attrs.target);
        return {
          id: f.id ?? attrs.documentId,
          idNumber: f.id ?? undefined,
          docId: attrs.documentId,
          requesterId: requester?.id,
          targetId: target?.id,
          status: attrs.status || "pending",
        };
      });

        setProfiles(mappedProfiles);
        setFriends(mappedFriends);
      } catch (err) {
        setError("Failed to load friends/profiles");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [user]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = profiles.filter((p) => p.userId !== user?.id);
    if (!q) return list;
    return list.filter(
      (f) =>
        f.handle.toLowerCase().includes(q) ||
        (f.username ?? "").toLowerCase().includes(q)
    );
  }, [profiles, query, user]);

  const relationStatusFor = (profile: FriendProfile) => {
    if (!profile.userId || !friends.length) return null;
    const match = friends.find(
      (f) =>
        (f.requesterId === user?.id && f.targetId === profile.userId) ||
        (f.targetId === user?.id && f.requesterId === profile.userId)
    );
    return match?.status ?? null;
  };

  const addFriend = async (profile: FriendProfile) => {
    if (!user || !profile.userId || profile.userId === user.id) return;
    const status = relationStatusFor(profile);
    if (status === "pending" || status === "accepted") return;
    try {
      await api.post("/friends", {
        data: {
          target: profile.userId,
          status: "pending",
          locale: "en",
        },
      });
      const res = await api.get(
        `/friends?filters[$or][0][requester][id][$eq]=${user.id}&filters[$or][1][target][id][$eq]=${user.id}&populate=requester&populate=target`
      );
      const mapped: FriendRelation[] = (res.data?.data ?? []).map((f: any) => {
        const attrs = normalize(f);
        const requester = normalize(attrs.requester?.data ?? attrs.requester);
        const target = normalize(attrs.target?.data ?? attrs.target);
        return {
          id: f.id ?? attrs.documentId,
          idNumber: f.id ?? undefined,
          docId: attrs.documentId,
          requesterId: requester?.id,
          targetId: target?.id,
          status: attrs.status || "pending",
        };
      });
      setFriends(mapped);
      setError(null);
    } catch (err) {
      setError("Failed to add friend");
    }
  };

  const addFriendByHandle = async () => {
    const targetHandle = addHandle.trim().replace(/^@+/, "").toLowerCase();
    if (!targetHandle) return;
    const target = profiles.find(
      (p) =>
        p.handle.toLowerCase() === targetHandle ||
        (p.username ?? "").toLowerCase() === targetHandle
    );
    if (!target?.userId) {
      setError("Handle not found");
      return;
    }
    await addFriend(target);
    setAddHandle("");
  };

  const acceptFriend = async (relation: FriendRelation) => {
    if (!relation?.id) return;
    try {
      const targetDoc = relation.docId ?? (typeof relation.id === "string" ? relation.id : null);
      const targetNum = relation.idNumber ?? (typeof relation.id === "number" ? relation.id : null);

      let updated = false;
      const payload = { data: { status: "accepted", locale: "en" } };

      // Try numeric first (Strapi default), then documentId with locale
      if (targetNum) {
        try {
          await api.put(`/friends/${targetNum}`, payload);
          updated = true;
        } catch (err: any) {
          if (!(err?.response?.status === 404)) throw err;
        }
      }
      if (!updated && targetDoc) {
        await api.put(`/friends/${targetDoc}?locale=en`, payload);
        updated = true;
      }
      if (!updated) throw new Error("Update failed");

      // refresh full friend list to keep state consistent
      if (user?.id) {
        const res = await api.get(
          `/friends?filters[$or][0][requester][id][$eq]=${user.id}&filters[$or][1][target][id][$eq]=${user.id}&populate=requester&populate=target`
        );
        const mapped: FriendRelation[] = (res.data?.data ?? []).map((f: any) => {
          const attrs = normalize(f);
          const requester = normalize(attrs.requester?.data ?? attrs.requester);
          const target = normalize(attrs.target?.data ?? attrs.target);
          return {
            id: f.id ?? attrs.documentId,
            idNumber: f.id ?? undefined,
            docId: attrs.documentId,
            requesterId: requester?.id,
            targetId: target?.id,
            status: attrs.status || "pending",
          };
        });
        setFriends(mapped);
      }
      setError(null);
    } catch (err) {
      setError("Failed to accept friend");
    }
  };

  const sendMessage = async (recipientId?: number) => {
    if (!recipientId) return;
    const body = messages[recipientId] || "";
    if (!body.trim()) return;
    try {
      await api.post("/messages", {
        data: {
          body,
          recipient: recipientId,
        },
      });
      setMessages((prev) => ({ ...prev, [recipientId]: "" }));
    } catch (err) {
      setError("Failed to send message");
    }
  };

  const acceptedFriends = useMemo(
    () =>
      friends.filter((f) => f.status === "accepted").map((f) => {
        const otherId = f.requesterId === user?.id ? f.targetId : f.requesterId;
        const profile = profiles.find((p) => p.userId === otherId);
        return { relation: f, profile };
      }),
    [friends, profiles, user?.id]
  );

  const incomingPending = useMemo(
    () =>
      friends.filter((f) => f.status === "pending" && f.targetId === user?.id).map((f) => {
        const otherId = f.requesterId === user?.id ? f.targetId : f.requesterId;
        const profile = profiles.find((p) => p.userId === otherId);
        return { relation: f, profile };
      }),
    [friends, profiles, user?.id]
  );

  return (
    <div className="dashboard-shell">
      <aside className="dash-nav">
        <div className="brand">
          <span className="brand-mark">S2YD</span>
          <span className="brand-text">Stick2YourDreams</span>
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
            <p className="eyebrow">Friends</p>
            <h1>Find friends by handle</h1>
            <p className="subhead">
              Add friends, view their bio and posts, and start a private message.
            </p>
          </div>
        </div>

        {loading && <p className="status">Loading friends…</p>}
        {error && <p className="status status-error">{error}</p>}

        <div className="panel-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Friends</p>
                <h3>Current friends</h3>
              </div>
            </div>
            {acceptedFriends.length === 0 ? (
              <p className="status">0</p>
            ) : (
              <ul className="comment-list">
                {acceptedFriends.map(({ relation, profile }) => (
                  <li key={relation.id} className="comment-item">
                    <div className="comment-body">
                      <strong>@{profile?.handle || profile?.username || "friend"}</strong>
                      <p>{profile?.bio || "Friend"}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {incomingPending.length > 0 && (
          <div className="panel-grid">
            <section className="panel">
              <div className="panel-header">
                <div>
                  <p className="eyebrow">Requests</p>
                  <h3>Pending approvals</h3>
                </div>
              </div>
              <ul className="comment-list">
                {incomingPending.map(({ relation, profile }) => (
                  <li key={relation.id} className="comment-item">
                    <div className="comment-body">
                      <strong>@{profile?.handle || profile?.username || "friend"}</strong>
                      <p>{profile?.bio || "Pending request"}</p>
                    </div>
                    <div className="auth-actions" style={{ marginLeft: "auto" }}>
                      <button
                        className="btn primary"
                        type="button"
                        onClick={() => acceptFriend(relation)}
                      >
                        Accept
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        )}

        <div className="panel-grid">
          <section className="panel">
            <div className="form-grid">
              <label className="field">
                <span>Search handle</span>
                <input
                  className="auth-input"
                  placeholder="@handle"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label className="field">
                <span>Add by handle</span>
                <div className="comment-form">
                  <input
                    className="auth-input"
                    placeholder="@friend_handle"
                    value={addHandle}
                    onChange={(e) => setAddHandle(e.target.value)}
                  />
                  <button className="btn primary" type="button" onClick={addFriendByHandle}>
                    Add Friend
                  </button>
                </div>
              </label>
            </div>
          </section>
        </div>

        <div className="posts-grid">
          {filtered.map((f) => {
            const status = relationStatusFor(f);
            const ownerPosts = f.userId ? postsByOwner[f.userId] : undefined;
            return (
              <article key={f.id} className="post-card">
                <div className="post-body">
                  <div className="post-meta">
                    <span className="pill subtle">Friend</span>
                    {status && <span className="pill subtle">{status}</span>}
                  </div>
                  <h3>@{f.handle}</h3>
                  <p className="comment-body">{f.bio || "No bio yet."}</p>
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={
                      !f.userId ||
                      f.userId === user?.id ||
                      status === "pending" ||
                      status === "accepted"
                    }
                    onClick={() => addFriend(f)}
                  >
                    {status === "accepted" ? "Friends" : status === "pending" ? "Requested" : "Add / Request"}
                  </button>
                  <div className="comments">
                    <p className="eyebrow">Posts</p>
                    {ownerPosts && ownerPosts.length ? (
                      <ul className="comment-list">
                        {ownerPosts.map((p) => (
                          <li key={p.id} className="comment-item">
                            {p.imageUrl && <img src={p.imageUrl} alt={p.title} className="avatar" />}
                            <div className="comment-body">
                              <strong>{p.title}</strong>
                              <p>{p.content}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="status">No posts yet.</p>
                    )}
                  </div>
                  <div className="auth-actions" style={{ marginTop: "8px" }}>
                    <input
                      className="auth-input"
                      placeholder="Message..."
                      value={messages[f.id] || ""}
                      onChange={(e) =>
                        setMessages((prev) => ({
                          ...prev,
                          [f.id]: e.target.value,
                        }))
                      }
                    />
                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => sendMessage(f.userId || (typeof f.id === "number" ? f.id : undefined))}
                    >
                      Send
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
