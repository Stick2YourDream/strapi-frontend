import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import type { ChatFriend } from "../context/ChatContext";
import { useUserPreferences } from "../context/UserPreferencesContext";

type LinkMeta = {
  title?: string;
  thumb?: string;
};

const extractLinks = (text: string) => {
  const regex = /(https?:\/\/[^\s]+)/g;
  return text.match(regex) || [];
};

const parseYouTubeId = (url: string) => {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtube.com")) {
      return parsed.searchParams.get("v");
    }
    if (parsed.hostname === "youtu.be") {
      return parsed.pathname.replace("/", "") || null;
    }
  } catch {
    return null;
  }
  return null;
};

const getDisplayName = (handle?: string, firstName?: string, lastName?: string) => {
  const name = `${firstName || ""} ${lastName || ""}`.trim();
  return name || (handle ? `@${handle}` : "Friend");
};

export default function ChatDock() {
  const location = useLocation();
  const { user } = useAuth();
  const { preferences, setChatPrefs } = useUserPreferences();
  const {
    activeFriend,
    popoutMinimized,
    chatLogs,
    drafts,
    gifDrafts,
    openChat,
    setPopoutMinimized,
    setDraft,
    setGifDraft,
    sendMessage,
  } = useChat();
  const [error, setError] = useState<string | null>(null);
  const [linkMeta, setLinkMeta] = useState<Record<string, LinkMeta>>({});
  const linkMetaRef = useRef(linkMeta);
  const popoutRef = useRef<HTMLDivElement | null>(null);
  const sizeRef = useRef({ width: preferences.chat.width, height: preferences.chat.height });
  const lastPathRef = useRef(location.pathname);
  const [friendOptions, setFriendOptions] = useState<ChatFriend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState<string | null>(null);
  const [friendMenuOpen, setFriendMenuOpen] = useState(false);
  const friendMenuRef = useRef<HTMLDivElement | null>(null);
  const chatPrefs = preferences.chat;

  const hideForRoute = ["/", "/home", "/landing", "/login", "/register"].includes(
    location.pathname
  );

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

  useEffect(() => {
    linkMetaRef.current = linkMeta;
  }, [linkMeta]);

  useEffect(() => {
    if (popoutMinimized) {
      setFriendMenuOpen(false);
    }
  }, [popoutMinimized]);

  useEffect(() => {
    if (!friendMenuOpen) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!friendMenuRef.current || !target) return;
      if (!friendMenuRef.current.contains(target)) {
        setFriendMenuOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFriendMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [friendMenuOpen]);

  useEffect(() => {
    sizeRef.current = { width: chatPrefs.width, height: chatPrefs.height };
  }, [chatPrefs.height, chatPrefs.width]);

  useEffect(() => {
    const lastPath = lastPathRef.current;
    if (lastPath === "/friends" && location.pathname !== "/friends") {
      setPopoutMinimized(true);
    }
    lastPathRef.current = location.pathname;
  }, [location.pathname, setPopoutMinimized]);

  useEffect(() => {
    if (!user?.id) {
      setFriendOptions([]);
      setFriendsError(null);
      setFriendsLoading(false);
      return;
    }

    let active = true;
    const loadFriends = async () => {
      setFriendsLoading(true);
      setFriendsError(null);
      try {
        const friendsRes = await api.get(
          `/friends?filters[$or][0][requester][id][$eq]=${user.id}&filters[$or][1][target][id][$eq]=${user.id}&populate=requester&populate=target&pagination[pageSize]=200`
        );
        const acceptedIds = new Set<number>();
        (friendsRes.data?.data ?? []).forEach((relation: any) => {
          const attrs = normalize(relation);
          if (attrs.status !== "accepted") return;
          const requesterId = getEntityId(attrs.requester);
          const targetId = getEntityId(attrs.target);
          const friendId = requesterId === user.id ? targetId : requesterId;
          if (friendId) acceptedIds.add(friendId);
        });

        const friendIds = Array.from(acceptedIds);
        if (!friendIds.length) {
          if (active) setFriendOptions([]);
          return;
        }

        const filter = friendIds
          .map((id, index) => `filters[user][id][$in][${index}]=${id}`)
          .join("&");
        const profilesRes = await api.get(
          `/profiles?${filter}&populate=avatar&populate=user&pagination[pageSize]=200`
        );

        const mapped: ChatFriend[] = (profilesRes.data?.data ?? [])
          .map((p: any) => {
            const attrs = normalize(p);
            const userAttrs = getEntityAttrs(attrs.user);
            const userId = getEntityId(attrs.user);
            if (!userId) return null;
            return {
              userId,
              handle: attrs.handle || userAttrs?.username || "",
              firstName: attrs.firstName || "",
              lastName: attrs.lastName || "",
              avatarUrl: pickMediaUrl(attrs.avatar),
            } as ChatFriend;
          })
          .filter(Boolean) as ChatFriend[];

        mapped.sort((a, b) =>
          getDisplayName(a.handle, a.firstName, a.lastName).localeCompare(
            getDisplayName(b.handle, b.firstName, b.lastName)
          )
        );
        if (active) setFriendOptions(mapped);
      } catch {
        if (active) setFriendsError("Unable to load friends.");
      } finally {
        if (active) setFriendsLoading(false);
      }
    };

    loadFriends();
    return () => {
      active = false;
    };
  }, [user?.id]);

  useEffect(() => {
    const el = popoutRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      if (!entries.length || popoutMinimized) return;
      const target = entries[0].target as HTMLElement;
      const rect = target.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      const current = sizeRef.current;
      if (Math.abs(width - current.width) < 2 && Math.abs(height - current.height) < 2) {
        return;
      }
      sizeRef.current = { width, height };
      setChatPrefs({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [popoutMinimized, setChatPrefs]);

  const fetchPreviewMeta = useCallback(async (url: string, fallbackThumb?: string) => {
    if (!url || linkMetaRef.current[url]) return;
    try {
      const res = await api.get("/link-preview", { params: { url } });
      const data = res.data?.data;
      setLinkMeta((prev) => ({
        ...prev,
        [url]: {
          title: data?.title || data?.siteName || url.replace(/^https?:\/\//, ""),
          thumb: data?.image || fallbackThumb,
        },
      }));
    } catch {
      setLinkMeta((prev) => ({
        ...prev,
        [url]: {
          title: url.replace(/^https?:\/\//, ""),
          thumb: fallbackThumb,
        },
      }));
    }
  }, []);

  useEffect(() => {
    if (!activeFriend?.userId) return;
    const key = String(activeFriend.userId);
    const messages = chatLogs[key] || [];
    if (!messages.length) return;
    messages.forEach((m) => {
      const urls = extractLinks(m.body || "");
      urls.forEach((url) => {
        const ytId = parseYouTubeId(url);
        const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/hqdefault.jpg` : undefined;
        if (!linkMetaRef.current[url]) {
          fetchPreviewMeta(url, thumb);
        } else if (thumb && !linkMetaRef.current[url]?.thumb) {
          setLinkMeta((prev) => ({ ...prev, [url]: { ...prev[url], thumb } }));
        }
      });
    });
  }, [activeFriend?.userId, chatLogs, fetchPreviewMeta]);

  if (!user || hideForRoute) return null;

  const friendList = activeFriend?.userId && !friendOptions.some((f) => f.userId === activeFriend.userId)
    ? [activeFriend, ...friendOptions]
    : friendOptions;

  const friendId = activeFriend?.userId;
  const key = friendId ? String(friendId) : "";
  const messages = friendId ? chatLogs[key] || [] : [];
  const messageDraft = friendId ? drafts[key] || "" : "";
  const gifDraft = friendId ? gifDrafts[key] || "" : "";
  const displayName = activeFriend
    ? getDisplayName(activeFriend.handle, activeFriend.firstName, activeFriend.lastName)
    : "Select a friend";
  const handleLabel = activeFriend?.handle ? `@${activeFriend.handle}` : displayName;

  const handleSend = async () => {
    if (!friendId) return;
    const body = `${messageDraft}${gifDraft ? `\n${gifDraft}` : ""}`.trim();
    if (!body) return;
    const sendError = await sendMessage(friendId, body);
    setError(sendError);
  };

  const handleSelectFriend = (value: string) => {
    const selectedId = Number(value);
    if (!selectedId || !Number.isFinite(selectedId)) return;
    const next = friendList.find((f) => f.userId === selectedId);
    if (next) {
      openChat(next);
      setFriendMenuOpen(false);
    }
  };

  const getInitials = (friend: ChatFriend) => {
    const source =
      `${friend.firstName || ""} ${friend.lastName || ""}`.trim() ||
      friend.handle ||
      "Friend";
    const parts = source.split(" ").filter(Boolean);
    const letters = parts.slice(0, 2).map((part) => part[0]).join("");
    return letters.toUpperCase();
  };

  const popoutStyle = {
    width: chatPrefs.width,
    height: popoutMinimized ? undefined : chatPrefs.height,
    ["--chat-font-size" as any]: `${chatPrefs.fontSize}px`,
  };

  return (
    <div
      ref={popoutRef}
      className={`message-popout ${popoutMinimized ? "minimized" : ""}`}
      style={popoutStyle}
    >
      <div className="message-popout__header">
        <div className="message-popout__title">
          <p className="eyebrow">Chat</p>
          {!popoutMinimized && (
            <div className="chat-friend-picker" ref={friendMenuRef}>
              <button
                className="chat-friend-trigger"
                type="button"
                onClick={() => setFriendMenuOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={friendMenuOpen}
              >
                <span className="chat-friend-trigger__label">
                  {friendsLoading
                    ? "Loading friends..."
                    : activeFriend
                    ? displayName
                    : "Select a friend"}
                </span>
                <span className="chat-friend-trigger__meta">
                  {activeFriend?.handle ? `@${activeFriend.handle}` : "Pick someone to chat"}
                </span>
                <span className="chat-friend-trigger__chevron" aria-hidden="true" />
              </button>
              {friendMenuOpen && (
                <div className="chat-friend-menu" role="listbox">
                  {friendsLoading ? (
                    <div className="chat-friend-option is-disabled">Loading friends...</div>
                  ) : friendList.length === 0 ? (
                    <div className="chat-friend-option is-disabled">No friends yet.</div>
                  ) : (
                    friendList.map((friend) => {
                      const label = getDisplayName(
                        friend.handle,
                        friend.firstName,
                        friend.lastName
                      );
                      const isActive = friend.userId === friendId;
                      return (
                        <button
                          key={friend.userId}
                          type="button"
                          className={`chat-friend-option${isActive ? " is-active" : ""}`}
                          role="option"
                          aria-selected={isActive}
                          onClick={() => handleSelectFriend(String(friend.userId))}
                        >
                          <span
                            className="chat-friend-option__avatar"
                            style={
                              friend.avatarUrl
                                ? { backgroundImage: `url(${friend.avatarUrl})` }
                                : undefined
                            }
                          >
                            {!friend.avatarUrl && getInitials(friend)}
                          </span>
                          <span className="chat-friend-option__meta">
                            <span className="chat-friend-option__name">{label}</span>
                            {friend.handle && (
                              <span className="chat-friend-option__handle">
                                @{friend.handle}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div className="message-popout__actions">
          {!popoutMinimized && (
            <div className="chat-font-control">
              <span className="chat-font-label">A</span>
              <input
                aria-label="Chat text size"
                type="range"
                min={12}
                max={20}
                step={1}
                value={chatPrefs.fontSize}
                onChange={(e) => setChatPrefs({ fontSize: Number(e.target.value) })}
              />
              <span className="chat-font-label large">A</span>
            </div>
          )}
          <button
            className="btn ghost"
            type="button"
            onClick={() => setPopoutMinimized(!popoutMinimized)}
          >
            {popoutMinimized ? "Expand" : "Minimize"}
          </button>
        </div>
      </div>
      {!popoutMinimized && friendsError && (
        <p className="status status-error" style={{ padding: "0 14px" }}>
          {friendsError}
        </p>
      )}
      {!popoutMinimized && (
        <>
          <div className="message-popout__body">
            {!friendId ? (
              <div className="status">Select a friend to start chatting.</div>
            ) : messages.length === 0 ? (
              <div className="status">No messages yet.</div>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`message-bubble ${m.from === "me" ? "outgoing" : "incoming"}`}
                >
                  <div className="message-meta">
                    <span>{m.from === "me" ? "You" : displayName}</span>
                    <span>
                      {new Date(m.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="comment-body" style={{ whiteSpace: "pre-wrap" }}>
                    {m.body}
                  </div>
                  {extractLinks(m.body).map((url) => {
                    const meta = linkMeta[url];
                    const thumb = meta?.thumb;
                    const title = meta?.title || url.replace(/^https?:\/\//, "");
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
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "#8fb5ff" }}
                          >
                            {title}
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
                if (friendId) {
                  setDraft(friendId, `${messageDraft}${emoji}`);
                }
              }}
            />
          </div>
          <div className="message-popout__footer">
            <input
              className="auth-input"
              placeholder="Paste a GIF / image / video URL (optional)"
              value={gifDraft}
              onChange={(e) => {
                if (friendId) {
                  setGifDraft(friendId, e.target.value);
                }
              }}
              disabled={!friendId}
            />
            <input
              className="auth-input"
              placeholder={`Message ${handleLabel}...`}
              value={messageDraft}
              onChange={(e) => {
                if (friendId) {
                  setDraft(friendId, e.target.value);
                }
              }}
              disabled={!friendId}
            />
            {error && <p className="status status-error">{error}</p>}
            <div className="auth-actions" style={{ justifyContent: "flex-end" }}>
              <button className="btn primary" type="button" onClick={handleSend}>
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function EmojiBar({ onPick }: { onPick: (emoji: string) => void }) {
  const emojis = [
    "\u{1F600}",
    "\u{1F604}",
    "\u{1F44F}",
    "\u{1F64C}",
    "\u{1F4AA}",
    "\u{1F525}",
    "\u{2728}",
    "\u{2764}\u{FE0F}",
    "\u{1F64F}",
    "\u{1F389}",
  ];
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
