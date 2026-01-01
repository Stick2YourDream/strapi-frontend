import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import type { ChatFriend } from "../context/ChatContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import "../css/chatbox.css";

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

type ChatSizePreset = {
  id: "small" | "medium" | "large" | "xlarge" | "fullscreen";
  label: string;
  width?: number;
  height?: number;
};

const CHAT_SIZE_PRESETS: ChatSizePreset[] = [
  { id: "small", label: "Small", width: 400, height: 520 },
  { id: "medium", label: "Medium", width: 500, height: 680 },
  { id: "large", label: "Large", width: 570, height: 720 },
  { id: "xlarge", label: "Extra Large", width: 650, height: 800 },
  { id: "fullscreen", label: "Full" },
];

export default function ChatDock() {
  const location = useLocation();
  const { user } = useAuth();
  const { preferences, setChatPrefs } = useUserPreferences();
  const {
    activeFriend,
    popoutMinimized,
    chatLogs,
    drafts,
    openChat,
    setPopoutMinimized,
    setDraft,
    sendMessage,
  } = useChat();
  const [error, setError] = useState<string | null>(null);
  const [linkMeta, setLinkMeta] = useState<Record<string, LinkMeta>>({});
  const linkMetaRef = useRef(linkMeta);
  const popoutRef = useRef<HTMLDivElement | null>(null);
  const lastPathRef = useRef(location.pathname);
  const resizeTimeoutRef = useRef<number | null>(null);
  const resizeSnapshotRef = useRef({ width: 0, height: 0 });
  const [friendOptions, setFriendOptions] = useState<ChatFriend[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [friendsError, setFriendsError] = useState<string | null>(null);
  const [friendMenuOpen, setFriendMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [messageReactions, setMessageReactions] = useState<Record<string, string[]>>({});
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
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 720px)");
    const handleChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };
    setIsMobile(media.matches);
    if (media.addEventListener) {
      media.addEventListener("change", handleChange);
      return () => media.removeEventListener("change", handleChange);
    }
    media.addListener(handleChange);
    return () => media.removeListener(handleChange);
  }, []);

  useEffect(() => {
    if (popoutMinimized) {
      setFriendMenuOpen(false);
    }
  }, [popoutMinimized]);

  useEffect(() => {
    if (isMobile || !popoutMinimized) return;
    const element = popoutRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextWidth = Math.round(entry.contentRect.width);
      const nextHeight = Math.round(entry.contentRect.height);
      resizeSnapshotRef.current = { width: nextWidth, height: nextHeight };
      if (resizeTimeoutRef.current) {
        window.clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = window.setTimeout(() => {
        const { width, height } = resizeSnapshotRef.current;
        if (
          Math.abs(width - chatPrefs.minimizedWidth) > 1 ||
          Math.abs(height - chatPrefs.minimizedHeight) > 1
        ) {
          setChatPrefs({ minimizedWidth: width, minimizedHeight: height });
        }
      }, 160);
    });

    observer.observe(element);
    return () => {
      observer.disconnect();
      if (resizeTimeoutRef.current) {
        window.clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
    };
  }, [
    chatPrefs.minimizedHeight,
    chatPrefs.minimizedWidth,
    isMobile,
    popoutMinimized,
    setChatPrefs,
  ]);

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

  const activeSizeId = useMemo(() => {
    const match = CHAT_SIZE_PRESETS.find(
      (preset) => preset.width === chatPrefs.width && preset.height === chatPrefs.height
    );
    if (match) return match.id;
    if (isMobile || typeof window === "undefined") return null;
    const fullWidth = Math.max(320, window.innerWidth - 36);
    const fullHeight = Math.max(320, window.innerHeight - 36);
    if (Math.abs(chatPrefs.width - fullWidth) < 8 && Math.abs(chatPrefs.height - fullHeight) < 8) {
      return "fullscreen";
    }
    return null;
  }, [chatPrefs.height, chatPrefs.width, isMobile]);

  if (!user || hideForRoute) return null;

  const friendList = activeFriend?.userId && !friendOptions.some((f) => f.userId === activeFriend.userId)
    ? [activeFriend, ...friendOptions]
    : friendOptions;

  const friendId = activeFriend?.userId;
  const key = friendId ? String(friendId) : "";
  const messages = friendId ? chatLogs[key] || [] : [];
  const messageDraft = friendId ? drafts[key] || "" : "";
  const displayName = activeFriend
    ? getDisplayName(activeFriend.handle, activeFriend.firstName, activeFriend.lastName)
    : "Select a friend";
  const handleLabel = activeFriend?.handle ? `@${activeFriend.handle}` : displayName;

  const handleSend = async () => {
    if (!friendId) return;
    const body = messageDraft.trim();
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

  const handleSizePreset = (preset: ChatSizePreset) => {
    if (preset.id === "fullscreen") {
      if (typeof window === "undefined") return;
      const width = Math.max(320, window.innerWidth - 36);
      const height = Math.max(320, window.innerHeight - 36);
      setChatPrefs({ width, height });
      return;
    }
    if (!preset.width || !preset.height) return;
    setChatPrefs({ width: preset.width, height: preset.height });
  };

  const handleSizeChange = (value: string) => {
    const preset = CHAT_SIZE_PRESETS.find((entry) => entry.id === value);
    if (preset) handleSizePreset(preset);
  };

  const toggleReactionPicker = (messageId: string) => {
    setReactionPickerFor((prev) => (prev === messageId ? null : messageId));
  };

  const handleReactionPick = (messageId: string, emoji: string) => {
    setMessageReactions((prev) => {
      const current = prev[messageId] ?? [];
      const next = current.includes(emoji)
        ? current.filter((item) => item !== emoji)
        : [...current, emoji];
      return { ...prev, [messageId]: next };
    });
    setReactionPickerFor(null);
  };

  const toggleLabel = popoutMinimized ? "Expand chat" : "Minimize chat";
  const isFullscreen = activeSizeId === "fullscreen" && !isMobile && !popoutMinimized;

  const popoutStyle = {
    ...(isMobile
      ? {}
      : popoutMinimized
      ? { width: chatPrefs.minimizedWidth, height: chatPrefs.minimizedHeight }
      : { width: chatPrefs.width, height: chatPrefs.height }),
    ["--chat-font-size" as any]: `${chatPrefs.fontSize}px`,
  };

  return (
    <div
      ref={popoutRef}
      className={`message-popout ${popoutMinimized ? "minimized" : ""}${
        isFullscreen ? " is-fullscreen" : ""
      }`}
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
            <>
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
              {!isMobile && (
                <label className="chat-size-select">
                  <span className="chat-size-label">ChatBox Size</span>
                  <select
                    className="chat-size-dropdown"
                    value={activeSizeId || "medium"}
                    onChange={(e) => handleSizeChange(e.target.value)}
                  >
                    {CHAT_SIZE_PRESETS.map((preset) => (
                      <option key={preset.id} value={preset.id}>
                        {preset.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
        </div>
        <button
          className="chat-toggle-icon"
          type="button"
          onClick={() => setPopoutMinimized(!popoutMinimized)}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          {popoutMinimized ? (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M12 5v14M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M5 12h14"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
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
              messages.map((m) => {
                const messageId = String(m.id);
                const reactions = messageReactions[messageId] ?? [];
                const showPicker = reactionPickerFor === messageId;
                return (
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
                    <div className="message-bubble__actions">
                      <button
                        type="button"
                        className="message-reaction-button"
                        aria-label="React to message"
                        onClick={() => toggleReactionPicker(messageId)}
                      >
                        <span aria-hidden="true">{"\u{1F44D}"}</span>
                      </button>
                      {reactions.length > 0 && (
                        <div className="message-reaction-list">
                          {reactions.map((emoji) => (
                            <button
                              key={`${messageId}-${emoji}`}
                              type="button"
                              className="message-reaction-chip"
                              aria-label={`Remove reaction ${emoji}`}
                              onClick={() => handleReactionPick(messageId, emoji)}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {showPicker && (
                      <div className="message-reaction-picker">
                        <ReactionPicker onPick={(emoji) => handleReactionPick(messageId, emoji)} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          <div className="message-popout__footer">
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

function ReactionPicker({ onPick }: { onPick: (emoji: string) => void }) {
  const emojis = [
    "\u{1F44D}",
    "\u{1F602}",
    "\u{1F970}",
    "\u{1F929}",
    "\u{1F60E}",
    "\u{1F64C}",
    "\u{1F44F}",
    "\u{1F525}",
    "\u{1F389}",
    "\u{1F4AA}",
    "\u{1F91D}",
    "\u{1F31F}",
    "\u{2764}\u{FE0F}",
    "\u{1F62E}",
    "\u{1F622}",
    "\u{1F92F}",
  ];
  return (
    <div className="message-reaction-picker-grid">
      {emojis.map((e) => (
        <button
          key={e}
          className="message-reaction-emoji"
          type="button"
          onClick={() => onPick(e)}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
