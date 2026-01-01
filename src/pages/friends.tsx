// src/pages/Friends.tsx
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import "../css/dashboard.css";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import api from "../api/strapi";
import Sidebar from "../components/Sidebar";
import TopbarSearch from "../components/TopbarSearch";
import { usePageMeta } from "../hooks/usePageMeta";

type FriendPost = {
  id: number | string;
  title: string;
  content: string;
  imageUrl?: string;
  createdAt?: string;
  linkUrl?: string;
};

type FriendProfile = {
  id: number | string;
  handle: string;
  bio?: string;
  userId?: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  religion?: string;
  hobbies?: string;
  country?: string;
  state?: string;
  city?: string;
  avatarUrl?: string;
};

type FriendRelation = {
  id: number | string;
  idNumber?: number;
  docId?: string;
  requesterId?: number;
  targetId?: number;
  status: "pending" | "accepted" | "blocked" | string;
};

type LinkPreview = {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
  type?: string;
};

const extractFirstUrl = (text: string) => {
  const match = String(text || "").match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
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

const LinkPreviewCard = ({
  preview,
  url,
  compact = false,
}: {
  preview?: LinkPreview | null;
  url: string;
  compact?: boolean;
}) => {
  const safePreview: LinkPreview =
    preview ?? { url, title: hostnameFor(url), siteName: hostnameFor(url) };
  const title =
    safePreview.title || safePreview.siteName || hostnameFor(url);
  const meta = safePreview.siteName || hostnameFor(url);
  const showBadge = safePreview.type === "video" || isYoutubeUrl(url);
  return (
    <a
      className={`link-preview-card${compact ? " is-compact" : ""}`}
      href={url}
      target="_blank"
      rel="noreferrer"
    >
      <div className="link-preview-media">
        {safePreview.image ? (
          <img src={safePreview.image} alt={title} loading="lazy" />
        ) : (
          <div className="link-preview-placeholder">LINK</div>
        )}
        {showBadge && <span className="link-preview-badge">Video</span>}
      </div>
      <div className="link-preview-body">
        <p className="link-preview-title">{title}</p>
        {safePreview.description && (
          <p className="link-preview-desc">{safePreview.description}</p>
        )}
        <span className="link-preview-url">{meta}</span>
      </div>
    </a>
  );
};

export default function Friends() {
  const { user } = useAuth();
  const { openChat } = useChat();
  const { getBackgroundStyle } = useUserPreferences();
  usePageMeta({
    title: "Friends | Stick2YourDreams Connect",
    description:
      "Find supportive friends, send messages, and discover new connections based on shared location, hobbies, and faith.",
    type: "website",
    robots: "noindex, nofollow",
  });

  const [query, setQuery] = useState("");
  const [profiles, setProfiles] = useState<FriendProfile[]>([]);
  const [postsByOwner, setPostsByOwner] = useState<Record<number, FriendPost[]>>({});
  const [selectedFriendId, setSelectedFriendId] = useState<number | null>(null);
  const [showAllPosts, setShowAllPosts] = useState(false);
  const allPostsRef = useRef<HTMLDivElement | null>(null);
  const [linkPreviews, setLinkPreviews] = useState<Record<string, LinkPreview | null>>({});
  const linkPreviewsRef = useRef(linkPreviews);

  useEffect(() => {
    linkPreviewsRef.current = linkPreviews;
  }, [linkPreviews]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const normalize = (entry: any) => entry?.attributes ?? entry ?? {};
  const getEntity = (entry: any) => entry?.data ?? entry ?? null;
  const getEntityAttrs = (entry: any) => {
    const data = getEntity(entry);
    return data?.attributes ?? data ?? {};
  };
  const getEntityId = (entry: any) => {
    const data = getEntity(entry);
    const rawId = data?.id ?? (typeof data === "number" ? data : data?.attributes?.id);
    const num = Number(rawId);
    return Number.isFinite(num) ? num : undefined;
  };
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

  const fetchLinkPreview = useCallback(async (url: string) => {
    if (!url) return;
    if (linkPreviewsRef.current[url] !== undefined) return;
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
      setLinkPreviews((prev) =>
        prev[url] !== undefined ? prev : { ...prev, [url]: preview }
      );
    } catch {
      setLinkPreviews((prev) =>
        prev[url] !== undefined ? prev : { ...prev, [url]: null }
      );
    }
  }, []);

  // Load current friends and their posts
  useEffect(() => {
    const load = async () => {
      if (!user) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const friendsRes = await api.get(
          `/friends?filters[$or][0][requester][id][$eq]=${user.id}&filters[$or][1][target][id][$eq]=${user.id}&populate=requester&populate=target`
        );
        const mappedFriends: FriendRelation[] = (friendsRes.data?.data ?? []).map((f: any) => {
          const attrs = normalize(f);
          return {
            id: f.id ?? attrs.documentId,
            idNumber: f.id ?? undefined,
            docId: attrs.documentId,
            requesterId: getEntityId(attrs.requester),
            targetId: getEntityId(attrs.target),
            status: attrs.status || "pending",
          };
        });

        const acceptedIds = new Set<number>();
        mappedFriends.forEach((relation) => {
          if (relation.status !== "accepted") return;
          const otherId =
            relation.requesterId === user.id ? relation.targetId : relation.requesterId;
          if (otherId) acceptedIds.add(otherId);
        });

        const friendIds = Array.from(acceptedIds);
        if (!friendIds.length) {
          setProfiles([]);
          setPostsByOwner({});
          return;
        }

        const friendFilter = friendIds
          .map((id, index) => `filters[user][id][$in][${index}]=${id}`)
          .join("&");
        const profilesRes = await api.get(
          `/profiles?${friendFilter}&populate[0]=user&populate[1]=avatar&pagination[pageSize]=200`
        );
        const mappedProfiles: FriendProfile[] = (profilesRes.data?.data ?? []).map((p: any) => {
          const attrs = normalize(p);
          const userAttrs = getEntityAttrs(attrs.user);
          const userId = getEntityId(attrs.user);
          return {
            id: p.id ?? attrs.documentId,
            userId,
            username: userAttrs?.username,
            firstName: attrs.firstName || "",
            lastName: attrs.lastName || "",
            handle: attrs.handle || userAttrs?.username || `user-${p.id ?? attrs.documentId}`,
            bio: attrs.bio || "",
            avatarUrl: pickMediaUrl(attrs.avatar),
          };
        });
        setProfiles(mappedProfiles);

        const ownerFilter = friendIds
          .map((id, index) => `filters[owner][id][$in][${index}]=${id}`)
          .join("&");
        const postsRes = await api.get(
          `/users-posts?${ownerFilter}&populate=Users_Pictures&populate=owner&sort=createdAt:desc&pagination[pageSize]=200&publicationState=preview`
        );
        const grouped: Record<number, FriendPost[]> = {};
        const linkUrls = new Set<string>();
        (postsRes.data?.data ?? []).forEach((p: any) => {
          const attrs = normalize(p);
          const ownerId = getEntityId(attrs.owner);
          if (!ownerId) return;
          const imageUrl = pickMediaUrl(attrs.Users_Pictures);
          const content = attrs.Users_Content || "";
          const linkUrl = extractFirstUrl(content);
          if (linkUrl) linkUrls.add(linkUrl);
          (grouped[ownerId] = grouped[ownerId] || []).push({
            id: p.id ?? attrs.documentId,
            title: attrs.Title || "Untitled",
            content,
            imageUrl,
            createdAt: attrs.createdAt,
            linkUrl: linkUrl || undefined,
          });
        });
        Object.values(grouped).forEach((list) => {
          list.sort((a, b) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bTime - aTime;
          });
        });
        setPostsByOwner(grouped);
        linkUrls.forEach((url) => {
          void fetchLinkPreview(url);
        });
      } catch {
        setError("Failed to load friends.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fetchLinkPreview, user]);

  const filteredFriends = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter((friend) => {
      const handle = (friend.handle || friend.username || "").toLowerCase();
      const first = (friend.firstName || "").toLowerCase();
      const last = (friend.lastName || "").toLowerCase();
      const full = `${first} ${last}`.trim();
      return (
        handle.includes(q) ||
        first.includes(q) ||
        last.includes(q) ||
        full.includes(q)
      );
    });
  }, [profiles, query]);

  useEffect(() => {
    if (!filteredFriends.length) {
      setSelectedFriendId(null);
      return;
    }
    const hasSelected = filteredFriends.some((friend) => friend.userId === selectedFriendId);
    if (!hasSelected) {
      setSelectedFriendId(filteredFriends[0].userId ?? null);
    }
  }, [filteredFriends, selectedFriendId]);

  useEffect(() => {
    setShowAllPosts(false);
  }, [selectedFriendId]);

  const selectedFriend = useMemo(() => {
    if (!selectedFriendId) return null;
    return profiles.find((profile) => profile.userId === selectedFriendId) || null;
  }, [profiles, selectedFriendId]);

  const selectedPosts =
    selectedFriend?.userId && postsByOwner[selectedFriend.userId]
      ? postsByOwner[selectedFriend.userId]
      : [];
  const recentPosts = selectedPosts.slice(0, 3);

  const renderAvatar = (profile?: FriendProfile, size = 44) => {
    const handle = profile?.handle || profile?.username || "User";
    if (profile?.avatarUrl) {
      return (
        <img
          src={profile.avatarUrl}
          alt={handle}
          className="friend-avatar"
          style={{ width: size, height: size }}
          loading="lazy"
        />
      );
    }
    return (
      <div
        className="friend-avatar fallback"
        aria-hidden="true"
        style={{ width: size, height: size }}
      >
        {handle.charAt(0).toUpperCase()}
      </div>
    );
  };

  const handleOpenChat = (profile: FriendProfile) => {
    if (!profile.userId) return;
    openChat({
      userId: profile.userId,
      handle: profile.handle,
      firstName: profile.firstName,
      lastName: profile.lastName,
      avatarUrl: profile.avatarUrl,
    });
  };

  const handleSelectFriend = (profile: FriendProfile) => {
    if (!profile.userId) return;
    setSelectedFriendId(profile.userId);
  };

  const handleShowAllPosts = () => {
    if (!selectedFriend?.userId) return;
    setShowAllPosts(true);
    if (allPostsRef.current) {
      allPostsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const renderPostList = (posts: FriendPost[], expanded = false) => (
    <ul className={`comment-list friend-posts-list${expanded ? " is-expanded" : ""}`}>
      {posts.map((post) => (
        <li key={post.id} className="comment-item">
          {post.imageUrl && <img src={post.imageUrl} alt={post.title} className="avatar" />}
          <div className="comment-body">
            <strong>{post.title}</strong>
            <p>{post.content}</p>
            {post.linkUrl && (
              <div className="friend-link-preview">
                <LinkPreviewCard preview={linkPreviews[post.linkUrl]} url={post.linkUrl} compact />
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="dashboard-shell" style={getBackgroundStyle("friends")}>
      <Sidebar active="friends" />

      <div className="main-content">
        <TopbarSearch value={query} onChange={setQuery} />
        <div className="dash-hero">
          <div className="dash-hero__text">
            <p className="eyebrow">Friends</p>
            <h1>Your friends</h1>
            <p className="subhead">
              Pick a friend to preview their latest posts and send a message.
            </p>
          </div>
        </div>

        {error && <p className="status status-error">{error}</p>}

        <div className="panel-grid">
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Friends</p>
                <h3>Current friends</h3>
              </div>
            </div>
            {loading ? (
              <p className="status">Loading friends...</p>
            ) : filteredFriends.length === 0 ? (
              <p className="status">No friends yet.</p>
            ) : (
              <ul className="friend-mini-list">
                {filteredFriends.map((friend) => {
                  const name = `${friend.firstName || ""} ${friend.lastName || ""}`.trim();
                  const handle = friend.handle || friend.username || "friend";
                  const displayName = name || handle;
                  const isActive = friend.userId === selectedFriendId;
                  return (
                    <li key={friend.id} className="friend-mini-item">
                      <button
                        className={`friend-mini-button${isActive ? " is-active" : ""}`}
                        type="button"
                        onClick={() => handleSelectFriend(friend)}
                      >
                        {renderAvatar(friend, 32)}
                        <span className="friend-mini-meta">
                          <span className="friend-mini-name">{displayName}</span>
                          <span className="friend-mini-tag">@{handle}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
          <section className="panel">
            <div className="panel-header">
              <div>
                <p className="eyebrow">Spotlight</p>
                <h3>Friend activity</h3>
              </div>
            </div>
            {!selectedFriend ? (
              <p className="status">Select a friend to see their recent posts.</p>
            ) : (
              <div className="friend-detail">
                <div className="friend-header">
                  {renderAvatar(selectedFriend, 48)}
                  <div className="friend-header-meta">
                    <strong>
                      {`${selectedFriend.firstName || ""} ${selectedFriend.lastName || ""}`.trim() ||
                        `@${selectedFriend.handle || selectedFriend.username || "friend"}`}
                    </strong>
                    <span className="friend-name">
                      @{selectedFriend.handle || selectedFriend.username || "friend"}
                    </span>
                  </div>
                </div>
                <p className="comment-body">{selectedFriend.bio || "No bio yet."}</p>
                <div className="friend-detail-actions">
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => handleOpenChat(selectedFriend)}
                  >
                    Message
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={handleShowAllPosts}
                    disabled={!selectedPosts.length}
                  >
                    See All
                  </button>
                </div>
                <div className="comments">
                  <p className="eyebrow">Most recent posts</p>
                  {recentPosts.length ? renderPostList(recentPosts) : (
                    <p className="status">No posts yet.</p>
                  )}
                </div>
                {showAllPosts && (
                  <div className="comments" ref={allPostsRef}>
                    <p className="eyebrow">All posts</p>
                    {selectedPosts.length ? renderPostList(selectedPosts, true) : (
                      <p className="status">No posts yet.</p>
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>

    </div>
  );
}
