// src/pages/Friends.tsx
import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import "../css/dashboard.css";
import { useAuth } from "../context/AuthContext";
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

type ChatMessage = {
  id: string | number;
  body: string;
  from: "me" | "them";
  at: string;
};

const CHAT_STORE_KEY = "chatLogs_v1";
const CHAT_TTL_MS = 4 * 365 * 24 * 60 * 60 * 1000; // ~4 years
const CHAT_REFRESH_MS = 10000;

const extractFirstUrl = (text: string) => {
  const match = String(text || "").match(/(https?:\/\/[^\s]+|www\.[^\s]+)/i);
  if (!match) return "";
  let url = match[0].replace(/[),.!?]+$/, "");
  if (url.startsWith("www.")) url = `https://${url}`;
  return url;
};

const normalizeMatch = (value?: string) => String(value || "").trim().toLowerCase();
const parseHobbyList = (value?: string) =>
  String(value || "")
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

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
  usePageMeta({
    title: "Friends | Stick2YourDreams Connect",
    description:
      "Find supportive friends, send messages, and discover new connections based on shared location, hobbies, and faith.",
    type: "website",
  });

  const [query, setQuery] = useState("");
  const [profiles, setProfiles] = useState<FriendProfile[]>([]);
  const [friends, setFriends] = useState<FriendRelation[]>([]);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [postsByOwner, setPostsByOwner] = useState<Record<number, FriendPost[]>>({});
  const [activeFriend, setActiveFriend] = useState<FriendProfile | null>(null);
  const [popoutMinimized, setPopoutMinimized] = useState(false);
  const [gifInput, setGifInput] = useState("");
  const [chatLogs, setChatLogs] = useState<Record<string, ChatMessage[]>>({});
  const [linkMeta, setLinkMeta] = useState<Record<string, { title?: string; thumb?: string }>>({});
  const linkMetaRef = useRef(linkMeta);
  const [linkPreviews, setLinkPreviews] = useState<Record<string, LinkPreview | null>>({});
  const linkPreviewsRef = useRef(linkPreviews);

  useEffect(() => {
    linkMetaRef.current = linkMeta;
  }, [linkMeta]);

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

  const loadConversation = useCallback(
    async (friendId: number) => {
      if (!user || !Number.isFinite(friendId)) return;
      const query = [
        `filters[$or][0][sender][id][$eq]=${user.id}`,
        `filters[$or][0][recipient][id][$eq]=${friendId}`,
        `filters[$or][1][sender][id][$eq]=${friendId}`,
        `filters[$or][1][recipient][id][$eq]=${user.id}`,
        "sort=createdAt:asc",
        "pagination[pageSize]=200",
        "populate=sender",
        "populate=recipient",
      ].join("&");
      try {
        const res = await api.get(`/messages?${query}`);
        const mapped: ChatMessage[] = (res.data?.data ?? []).map((m: any) => {
          const attrs = normalize(m);
          const senderId = getEntityId(attrs.sender);
          return {
            id: m.id ?? attrs.documentId ?? `${senderId}-${attrs.createdAt ?? ""}`,
            body: attrs.body || "",
            from: senderId === user.id ? "me" : "them",
            at: attrs.createdAt || new Date().toISOString(),
          };
        });
        setChatLogs((prev) => ({ ...prev, [String(friendId)]: mapped }));
      } catch {
        // ignore chat load errors
      }
    },
    [user]
  );

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
        const profilesRes = await api.get(
          "/profiles?populate[0]=user&populate[1]=avatar"
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
            religion: attrs.religion || "",
            hobbies: attrs.hobbies || "",
            country: attrs.country || "",
            state: attrs.state || "",
            city: attrs.city || "",
            avatarUrl: pickMediaUrl(attrs.avatar),
          };
        });

        const ownerIds = mappedProfiles
          .map((p) => (typeof p.userId === "number" ? p.userId : undefined))
          .filter((id): id is number => typeof id === "number" && Number.isFinite(id));
        if (ownerIds.length) {
          const ownerFilter = ownerIds
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
        } else {
          setPostsByOwner({});
        }

        // Load friendship relations for current user
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

        setProfiles(mappedProfiles);
        setFriends(mappedFriends);
      } catch (err) {
        setError("Failed to load friends/profiles");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fetchLinkPreview, user]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = profiles.filter((p) => p.userId !== user?.id);
    if (!q) return list;
    return list.filter(
      (f) =>
        f.handle.toLowerCase().includes(q) ||
        (f.username ?? "").toLowerCase().includes(q) ||
        (f.firstName ?? "").toLowerCase().includes(q) ||
        (f.lastName ?? "").toLowerCase().includes(q) ||
        `${(f.firstName ?? "").toLowerCase()} ${(f.lastName ?? "").toLowerCase()}`.trim().includes(q)
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
        return {
          id: f.id ?? attrs.documentId,
          idNumber: f.id ?? undefined,
          docId: attrs.documentId,
          requesterId: getEntityId(attrs.requester),
          targetId: getEntityId(attrs.target),
          status: attrs.status || "pending",
        };
      });
      setFriends(mapped);
      setError(null);
    } catch (err) {
      setError("Failed to add friend");
    }
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
          return {
            id: f.id ?? attrs.documentId,
            idNumber: f.id ?? undefined,
            docId: attrs.documentId,
            requesterId: getEntityId(attrs.requester),
            targetId: getEntityId(attrs.target),
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

  const sendMessage = async (recipientId?: string, overrideBody?: string) => {
    if (!recipientId) return;
    const body = overrideBody ?? messages[recipientId] ?? "";
    if (!body.trim()) return;
    try {
      await api.post("/messages", {
        data: {
          body,
          recipient: Number(recipientId),
        },
      });
      setMessages((prev) => ({ ...prev, [recipientId]: "" }));
      setGifInput("");
      const friendId = Number(recipientId);
      if (Number.isFinite(friendId)) {
        await loadConversation(friendId);
      }
    } catch (err) {
      if (err && typeof err === "object" && "response" in err) {
        const anyErr = err as any;
        const msg =
          anyErr.response?.data?.error?.message ||
          anyErr.response?.data?.message ||
          "Failed to send message";
        setError(String(msg));
      } else {
        setError("Failed to send message");
      }
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

  const myProfile = useMemo(
    () => profiles.find((p) => p.userId === user?.id) || null,
    [profiles, user?.id]
  );

  const suggestions = useMemo(() => {
    if (!user || !myProfile) return [];
    const relatedIds = new Set<number>();
    friends.forEach((f) => {
      if (f.requesterId === user.id && f.targetId) relatedIds.add(f.targetId);
      if (f.targetId === user.id && f.requesterId) relatedIds.add(f.requesterId);
    });

    const myReligion = normalizeMatch(myProfile.religion);
    const myCountry = normalizeMatch(myProfile.country);
    const myState = normalizeMatch(myProfile.state);
    const myCity = normalizeMatch(myProfile.city);
    const myHobbies = new Set(parseHobbyList(myProfile.hobbies).map(normalizeMatch));

    const scored = profiles
      .filter((p) => p.userId && p.userId !== user.id && !relatedIds.has(p.userId))
      .map((p) => {
        const reasons: string[] = [];
        let score = 0;
        const religion = normalizeMatch(p.religion);
        const country = normalizeMatch(p.country);
        const state = normalizeMatch(p.state);
        const city = normalizeMatch(p.city);
        const hobbies = parseHobbyList(p.hobbies).map(normalizeMatch);

        if (myReligion && religion && myReligion === religion) {
          score += 3;
          reasons.push("Same religion");
        }
        if (myCountry && country && myCountry === country) {
          score += 3;
          reasons.push("Same country");
        }
        if (myState && state && myState === state) {
          score += 2;
          reasons.push("Same region");
        }
        if (myCity && city && myCity === city) {
          score += 2;
          reasons.push("Same city");
        }

        let overlap = 0;
        hobbies.forEach((hobby) => {
          if (hobby && myHobbies.has(hobby)) overlap += 1;
        });
        if (overlap > 0) {
          score += Math.min(overlap, 5);
          reasons.push(`${overlap} shared ${overlap === 1 ? "hobby" : "hobbies"}`);
        }

        return { profile: p, score, reasons };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);

    return scored;
  }, [friends, myProfile, profiles, user]);

  const suggestionsReady = Boolean(
    myProfile?.religion ||
      myProfile?.hobbies ||
      myProfile?.country ||
      myProfile?.state ||
      myProfile?.city
  );

  const friendKey = (f: FriendProfile) => {
    if (f.userId) return String(f.userId);
    if (typeof f.id === "number") return String(f.id);
    return undefined;
  };

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

  const fetchPreviewMeta = useCallback(
    async (url: string, thumb?: string) => {
      if (linkMetaRef.current[url]?.title) return;
      let title: string | undefined = undefined;
      try {
        const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
        if (res.ok) {
          const data = await res.json();
          title = data?.title || title;
        }
      } catch {
        // ignore; fallback below
      }
      if (!title) {
        try {
          const u = new URL(url);
          title = u.hostname.replace(/^www\./, "");
        } catch {
          title = "Link";
        }
      }
      setLinkMeta((prev) => ({ ...prev, [url]: { title, thumb } }));
    },
    []
  );

  const extractLinks = (text: string) => {
    const regex = /(https?:\/\/[^\s]+)/g;
    return text.match(regex) || [];
  };

  const parseYouTubeId = (url: string) => {
    try {
      const u = new URL(url);
      if (u.hostname.includes("youtube.com")) {
        return u.searchParams.get("v");
      }
      if (u.hostname === "youtu.be") {
        return u.pathname.replace("/", "") || null;
      }
    } catch {
      return null;
    }
    return null;
  };

  const pruneLogs = useCallback((logs: typeof chatLogs) => {
    const cutoff = Date.now() - CHAT_TTL_MS;
    const pruned: typeof chatLogs = {};
    Object.entries(logs).forEach(([key, msgs]) => {
      const filtered = msgs.filter((m) => {
        const t = new Date(m.at).getTime();
        return Number.isFinite(t) ? t >= cutoff : true;
      });
      if (filtered.length) pruned[String(key)] = filtered;
    });
    return pruned;
  }, []);

  // Load chat history from localStorage (persist ~4 years)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CHAT_STORE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const data = parsed?.data ?? parsed;
      if (data && typeof data === "object") {
        const pruned = pruneLogs(data);
        setChatLogs(pruned);
      }
    } catch {
      // ignore malformed storage
    }
  }, [pruneLogs]);

  // Persist chat history
  useEffect(() => {
    const pruned = pruneLogs(chatLogs);
    localStorage.setItem(CHAT_STORE_KEY, JSON.stringify({ savedAt: Date.now(), data: pruned }));
  }, [chatLogs, pruneLogs]);

  const openChat = (f: FriendProfile) => {
    const key = friendKey(f);
    if (!key) return;
    setActiveFriend(f);
    setPopoutMinimized(false);
    const friendId = Number(key);
    if (Number.isFinite(friendId)) {
      void loadConversation(friendId);
    }
  };

  useEffect(() => {
    if (!activeFriend) return;
    const key = friendKey(activeFriend);
    const friendId = key ? Number(key) : NaN;
    if (!Number.isFinite(friendId)) return;
    void loadConversation(friendId);
    const interval = window.setInterval(() => loadConversation(friendId), CHAT_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [activeFriend, loadConversation]);

  useEffect(() => {
    if (!activeFriend) return;
    const key = friendKey(activeFriend);
    if (!key) return;
    const urls = (chatLogs[key] || []).flatMap((m) => extractLinks(m.body));
    urls.forEach((url) => {
      const ytId = parseYouTubeId(url);
      const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : undefined;
      if (!linkMetaRef.current[url]) {
        fetchPreviewMeta(url, thumb);
      } else if (thumb && !linkMetaRef.current[url].thumb) {
        setLinkMeta((prev) => ({ ...prev, [url]: { ...prev[url], thumb } }));
      }
    });
  }, [activeFriend, chatLogs, fetchPreviewMeta]);

  return (
    <div className="dashboard-shell">
      <Sidebar active="friends" />

      <div className="main-content">
        <TopbarSearch value={query} onChange={setQuery} />
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
                <p className="eyebrow">Suggestions</p>
                <h3>Friend suggestions</h3>
              </div>
            </div>
            {suggestions.length === 0 ? (
              <p className="status">
                {suggestionsReady
                  ? "No suggestions yet. Check back as more friends join."
                  : "Complete your profile (location, hobbies, religion) to unlock suggestions."}
              </p>
            ) : (
              <ul className="suggestion-list">
                {suggestions.map(({ profile: suggestion, reasons }) => {
                  const displayName = `${suggestion.firstName || ""} ${suggestion.lastName || ""}`.trim();
                  const handle = suggestion.handle || suggestion.username || "friend";
                  const location = [suggestion.city, suggestion.state, suggestion.country]
                    .filter(Boolean)
                    .join(", ");
                  return (
                    <li key={suggestion.id} className="suggestion-item">
                      {renderAvatar(suggestion, 40)}
                      <div className="suggestion-body">
                        <strong>{displayName || `@${handle}`}</strong>
                        <span>@{handle}</span>
                        {location && <span className="suggestion-location">{location}</span>}
                        {reasons.length > 0 && (
                          <div className="suggestion-tags">
                            {reasons.map((reason) => (
                              <span key={reason} className="suggestion-tag">
                                {reason}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => addFriend(suggestion)}
                      >
                        Add
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

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
                {acceptedFriends.map(({ relation, profile }) => {
                  const displayName = `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim();
                  return (
                    <li key={relation.id} className="comment-item friend-item">
                      <div className="friend-header">
                        {renderAvatar(profile, 40)}
                        <div className="friend-header-meta">
                          <strong>@{profile?.handle || profile?.username || "friend"}</strong>
                          {displayName && <span className="friend-name">{displayName}</span>}
                        </div>
                      </div>
                      <p className="comment-body">{profile?.bio || "Friend"}</p>
                    </li>
                  );
                })}
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
                  <li key={relation.id} className="comment-item pending-approval">
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

        <div className="posts-grid">
          {filtered.map((f) => {
            const status = relationStatusFor(f);
            const ownerPosts = f.userId ? postsByOwner[f.userId] : undefined;
            const latestPost = ownerPosts && ownerPosts.length ? ownerPosts[0] : undefined;
            const latestPreview =
              latestPost?.linkUrl ? linkPreviews[latestPost.linkUrl] : undefined;
            const key = friendKey(f);
            const displayName = `${f.firstName || ""} ${f.lastName || ""}`.trim();
            return (
              <article
                key={f.id}
                className="post-card"
                onClick={() => key && openChat(f)}
                style={{ cursor: key ? "pointer" : "default" }}
              >
                <div className="post-body">
                  <div className="post-meta">
                    <span className="pill subtle">Friend</span>
                    {status && <span className="pill subtle">{status}</span>}
                  </div>
                  <div className="friend-header">
                    {renderAvatar(f, 48)}
                    <div className="friend-header-meta">
                      <h3>@{f.handle}</h3>
                      {displayName && <span className="friend-name">{displayName}</span>}
                    </div>
                  </div>
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
                    onClick={(e) => {
                      e.stopPropagation();
                      addFriend(f);
                    }}
                  >
                    {status === "accepted" ? "Friends" : status === "pending" ? "Requested" : "Add / Request"}
                  </button>
                  <div className="friend-current-post">
                    <p className="eyebrow">Current post</p>
                    {latestPost ? (
                      <div className={`friend-current-card ${latestPost.imageUrl ? "" : "no-media"}`}>
                        {latestPost.imageUrl && (
                          <img src={latestPost.imageUrl} alt={latestPost.title} loading="lazy" />
                        )}
                        <div>
                          <strong>{latestPost.title}</strong>
                          <p>{latestPost.content}</p>
                          {latestPost.linkUrl && (
                            <div className="friend-link-preview">
                              <LinkPreviewCard
                                preview={latestPreview}
                                url={latestPost.linkUrl}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <p className="status">No posts yet.</p>
                    )}
                  </div>
                  <div className="comments">
                    <p className="eyebrow">All posts</p>
                    {ownerPosts && ownerPosts.length ? (
                      <ul className="comment-list friend-posts-list">
                        {ownerPosts.map((p) => (
                          <li key={p.id} className="comment-item">
                            {p.imageUrl && <img src={p.imageUrl} alt={p.title} className="avatar" />}
                            <div className="comment-body">
                              <strong>{p.title}</strong>
                              <p>{p.content}</p>
                              {p.linkUrl && (
                                <div className="friend-link-preview">
                                  <LinkPreviewCard
                                    preview={linkPreviews[p.linkUrl]}
                                    url={p.linkUrl}
                                    compact
                                  />
                                </div>
                              )}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="status">No posts yet.</p>
                    )}
                  </div>
                  <div className="auth-actions" style={{ marginTop: "8px", gap: "8px", flexWrap: "wrap" }}>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={!key}
                      onClick={(e) => {
                        e.stopPropagation();
                        openChat(f);
                      }}
                    >
                      Message
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>

      {activeFriend && (
        <div className={`message-popout ${popoutMinimized ? "minimized" : ""}`}>
          <div className="message-popout__header">
            <div>
              <p className="eyebrow">Chat</p>
              <strong>@{activeFriend.handle}</strong>
            </div>
            <div className="message-popout__actions">
              <button className="btn ghost" type="button" onClick={() => setPopoutMinimized((v) => !v)}>
                {popoutMinimized ? "Expand" : "Minimize"}
              </button>
              <button className="btn ghost" type="button" onClick={() => setActiveFriend(null)}>
                Close
              </button>
            </div>
          </div>
          {!popoutMinimized && (
            <>
              <div className="message-popout__body">
                {(friendKey(activeFriend) && chatLogs[friendKey(activeFriend)!] || []).length === 0 ? (
                  <div className="status">No messages yet.</div>
                ) : (
                  (friendKey(activeFriend) && chatLogs[friendKey(activeFriend)!] || []).map((m) => (
                    <div
                      key={m.id}
                      className={`message-bubble ${m.from === "me" ? "outgoing" : "incoming"}`}
                    >
                      <div className="message-meta">
                        <span>{m.from === "me" ? "You" : `@${activeFriend.handle}`}</span>
                        <span>{new Date(m.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <div className="comment-body" style={{ whiteSpace: "pre-wrap" }}>
                        {m.body}
                      </div>
                      {extractLinks(m.body).map((url) => {
                        const ytId = parseYouTubeId(url);
                        const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : null;
                        const title = ytId ? "YouTube video" : url.replace(/^https?:\/\//, "");
                        return (
                          <div
                      key={`${m.id}-${url}`}
                      style={{
                        marginTop: "8px",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "10px",
                              overflow: "hidden",
                              background: "rgba(255,255,255,0.03)",
                            }}
                          >
                          {thumb && (
                            <a href={url} target="_blank" rel="noreferrer" style={{ display: "block" }}>
                              <img
                                src={thumb}
                                alt={title}
                                  style={{ width: "100%", height: "auto", display: "block" }}
                                  loading="lazy"
                                />
                              </a>
                            )}
                            <div style={{ padding: "8px 10px" }}>
                              <a href={url} target="_blank" rel="noreferrer" style={{ color: "#8fb5ff" }}>
                                {linkMeta[url]?.title || title}
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))
                )}
              </div>
              <div className="message-popout__friends">
                <p className="eyebrow">Quick reactions</p>
                <EmojiBar
                  onPick={(emoji) => {
                    const k = friendKey(activeFriend);
                    if (!k) return;
                    setMessages((prev) => ({
                      ...prev,
                      [k]: `${prev[k] || ""}${emoji}`,
                    }));
                  }}
                />
              </div>
              <div className="message-popout__footer">
                <input
                  className="auth-input"
                  placeholder="Paste a GIF / image / video URL (optional)"
                  value={gifInput}
                  onChange={(e) => setGifInput(e.target.value)}
                />
                <input
                  className="auth-input"
                  placeholder={`Message @${activeFriend.handle}...`}
                  value={(friendKey(activeFriend) ? messages[friendKey(activeFriend)!] : "") || ""}
                  onChange={(e) => {
                    const k = friendKey(activeFriend);
                    if (!k) return;
                    setMessages((prev) => ({ ...prev, [k]: e.target.value }));
                  }}
                />
                <div className="auth-actions" style={{ justifyContent: "space-between" }}>
                  <button className="btn ghost" type="button" onClick={() => setActiveFriend(null)}>
                    Close
                  </button>
                  <button
                      className="btn primary"
                      type="button"
                      disabled={!friendKey(activeFriend)}
                      onClick={() => {
                        const k = friendKey(activeFriend);
                        if (!k) return;
                        const body = `${messages[k] || ""}${gifInput ? `\n${gifInput}` : ""}`;
                        sendMessage(k, body);
                      }}
                    >
                      Send
                    </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// Chat popout (emoji-friendly) rendered at the root of this page
function EmojiBar({ onPick }: { onPick: (emoji: string) => void }) {
  const emojis = ["😊", "😂", "🔥", "🎉", "🤝", "❤️", "👍", "🥳", "🚀", "✨"];
  return (
    <div className="message-popout__chips">
      {emojis.map((e) => (
        <button
          key={e}
          className="btn ghost"
          type="button"
          onClick={() => onPick(e)}
          style={{ padding: "6px 10px" }}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
