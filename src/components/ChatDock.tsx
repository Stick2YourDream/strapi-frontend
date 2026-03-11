import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faComments, faMagnifyingGlass } from "@fortawesome/free-solid-svg-icons";
import api from "../api/strapi";
import { useAuth } from "../context/AuthContext";
import { useChat } from "../context/ChatContext";
import type { ChatFriend } from "../context/ChatContext";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { useVideoCall, type VideoCallInvitee } from "../context/VideoCallContext";
import "../css/chatbox.css";
import {
  buildProfilePayloadFromAttrs,
  decryptFriendProfilePayload,
  ensureProfileKeyShares,
  type ProfilePayload,
} from "../utils/profile-e2ee";
import { sanitizePostText } from "../utils/emoji";
import { pickMediaUrl } from "../utils/media";
import VideoCallModal from "./VideoCallModal";

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

const faviconFor = (value: string) => {
  try {
    const host = new URL(value).hostname.replace(/^www\./, "");
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch {
    return "";
  }
};

const getDisplayName = (handle?: string, firstName?: string, lastName?: string) => {
  const name = `${firstName || ""} ${lastName || ""}`.trim();
  return name || (handle ? `@${handle}` : "Friend");
};

const FRIEND_MENU_PAGE_SIZE = 5;
const CHAT_MOTIVATION_LINES = [
  "Small steps today build the momentum you want tomorrow.",
  "Show up for yourself and the win will follow.",
  "Progress over perfection, always.",
  "Keep going. Your future self is already grateful.",
  "Consistency beats intensity. You have this.",
  "One focused action can change your whole day.",
  "You do not need to be perfect, just present.",
  "Start where you are and make the next right move.",
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
];

const pickChatMotivation = (previous?: string) => {
  if (!CHAT_MOTIVATION_LINES.length) {
    return "Keep showing up for yourself.";
  }
  if (CHAT_MOTIVATION_LINES.length === 1) {
    return CHAT_MOTIVATION_LINES[0];
  }
  let next = CHAT_MOTIVATION_LINES[Math.floor(Math.random() * CHAT_MOTIVATION_LINES.length)];
  if (previous && CHAT_MOTIVATION_LINES.includes(previous)) {
    let safety = 0;
    while (next === previous && safety < 12) {
      next = CHAT_MOTIVATION_LINES[Math.floor(Math.random() * CHAT_MOTIVATION_LINES.length)];
      safety += 1;
    }
  }
  return next;
};

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return target.isContentEditable;
};

export default function ChatDock() {
  const location = useLocation();
  const { user, profile } = useAuth();
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
  const { openCallComposer, onlineUserIds, setPresenceTargets } = useVideoCall();
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
  const [friendSearch, setFriendSearch] = useState("");
  const [friendPage, setFriendPage] = useState(1);
  const [isMobile, setIsMobile] = useState(false);
  const [reactionPickerFor, setReactionPickerFor] = useState<string | null>(null);
  const [messageReactions, setMessageReactions] = useState<Record<string, string[]>>({});
  const [motivationalQuote, setMotivationalQuote] = useState(() => pickChatMotivation());
  const friendMenuRef = useRef<HTMLDivElement | null>(null);
  const friendSearchInputRef = useRef<HTMLInputElement | null>(null);
  const chatPrefs = preferences.chat;

  const hideForRoute =
    [
      "/",
      "/home",
      "/landing",
      "/login",
      "/register",
      "/terms",
      "/privacy",
      "/guidelines",
    ].includes(location.pathname) || location.pathname.startsWith("/age-verify");

  const friendList = useMemo(() => {
    if (!activeFriend?.userId) return friendOptions;
    return friendOptions.some((f) => f.userId === activeFriend.userId)
      ? friendOptions
      : [activeFriend, ...friendOptions];
  }, [activeFriend, friendOptions]);

  const normalizedFriendSearch = friendSearch.trim().toLowerCase();

  const filteredFriendList = useMemo(() => {
    if (!normalizedFriendSearch) return friendList;
    return friendList.filter((friend) => {
      const display = getDisplayName(friend.handle, friend.firstName, friend.lastName).toLowerCase();
      const handle = String(friend.handle || "").toLowerCase();
      return display.includes(normalizedFriendSearch) || handle.includes(normalizedFriendSearch);
    });
  }, [friendList, normalizedFriendSearch]);

  const totalFriendPages = Math.max(
    1,
    Math.ceil(filteredFriendList.length / FRIEND_MENU_PAGE_SIZE)
  );

  const pagedFriendList = useMemo(() => {
    const start = (friendPage - 1) * FRIEND_MENU_PAGE_SIZE;
    return filteredFriendList.slice(start, start + FRIEND_MENU_PAGE_SIZE);
  }, [filteredFriendList, friendPage]);

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

  useEffect(() => {
    linkMetaRef.current = linkMeta;
  }, [linkMeta]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(max-width: 720px), (max-width: 1024px) and (pointer: coarse)");
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
    if (popoutMinimized) return;
    if (activeFriend?.userId) return;
    setMotivationalQuote((prev) => pickChatMotivation(prev));
  }, [activeFriend?.userId, popoutMinimized]);

  useEffect(() => {
    if (!friendMenuOpen) {
      setFriendSearch("");
      setFriendPage(1);
      return;
    }
    if (isMobile || typeof window === "undefined") return;
    const rafId = window.requestAnimationFrame(() => {
      friendSearchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [friendMenuOpen, isMobile]);

  useEffect(() => {
    setFriendPage(1);
  }, [normalizedFriendSearch]);

  useEffect(() => {
    setFriendPage((prev) => Math.min(Math.max(prev, 1), totalFriendPages));
  }, [totalFriendPages]);

  useEffect(() => {
    if (isMobile || !popoutMinimized) return;
    const element = popoutRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextWidth = Math.round(entry.contentRect.width);
      const nextHeight = Math.round(entry.contentRect.height);
      if (nextWidth < 160 || nextHeight < 52) {
        return;
      }
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
    if (!friendMenuOpen || isMobile) return;
    const handleTypeAhead = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "Escape" || event.key === "Enter" || event.key === "Tab") return;
      if (isTypingTarget(event.target)) return;

      if (event.key === "Backspace") {
        event.preventDefault();
        setFriendSearch((prev) => prev.slice(0, -1));
        friendSearchInputRef.current?.focus();
        return;
      }

      if (event.key.length !== 1) return;
      event.preventDefault();
      setFriendSearch((prev) => `${prev}${event.key}`);
      friendSearchInputRef.current?.focus();
    };

    document.addEventListener("keydown", handleTypeAhead);
    return () => document.removeEventListener("keydown", handleTypeAhead);
  }, [friendMenuOpen, isMobile]);

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
        await ensureProfileKeyShares(user.id, friendIds);

        const profilesRes = await api.get(
          `/profiles?${filter}&populate=avatar&populate=user&pagination[pageSize]=200`
        );

        const mapped = await Promise.all(
          (profilesRes.data?.data ?? []).map(async (p: any) => {
            const attrs = normalize(p);
            const userAttrs = getEntityAttrs(attrs.user);
            const friendUserId = getEntityId(attrs.user);
            if (!friendUserId) return null;
            let payload: ProfilePayload | null = null;
            if (attrs.encryptedProfile) {
              try {
                payload = await decryptFriendProfilePayload(
                  friendUserId,
                  user.id,
                  attrs.encryptedProfile
                );
              } catch {
                payload = null;
              }
            }
            if (!payload) {
              payload = buildProfilePayloadFromAttrs(attrs);
            }
            return {
              userId: friendUserId,
              handle: attrs.handle || userAttrs?.email || "",
              firstName: payload.firstName || "",
              lastName: payload.lastName || "",
              avatarUrl: pickMediaUrl(attrs.avatar, { kind: "avatar" }),
            } as ChatFriend;
          })
        );

        const filtered = mapped.filter(Boolean) as ChatFriend[];

        filtered.sort((a, b) =>
          getDisplayName(a.handle, a.firstName, a.lastName).localeCompare(
            getDisplayName(b.handle, b.firstName, b.lastName)
          )
        );
        if (active) setFriendOptions(filtered);
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
    if (!user?.id) {
      setPresenceTargets([]);
      return;
    }
    const ids = friendList
      .map((friend) => friend.userId)
      .filter((id): id is number => Number.isFinite(id));
    setPresenceTargets(ids);
  }, [friendList, setPresenceTargets, user?.id]);

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

  const friendId = activeFriend?.userId;
  const key = friendId ? String(friendId) : "";
  const messages = friendId ? chatLogs[key] || [] : [];
  const messageDraft = friendId ? drafts[key] || "" : "";
  const displayName = activeFriend
    ? getDisplayName(activeFriend.handle, activeFriend.firstName, activeFriend.lastName)
    : "Select a friend";
  const handleLabel = activeFriend?.handle ? `@${activeFriend.handle}` : displayName;
  const videoCallTooltip = activeFriend
    ? `Start video call with ${displayName}`
    : "Start video call";
  const motivationalName =
    `${profile?.firstName || ""} ${profile?.lastName || ""}`.trim() ||
    user.username ||
    user.email.split("@")[0];
  const greetingHour = new Date().getHours();
  const motivationalGreeting =
    greetingHour < 12 ? "Good Morning" : greetingHour < 18 ? "Good Afternoon" : "Good Evening";

  const handleSend = async () => {
    if (!friendId) return;
    const body = sanitizePostText(messageDraft).trim();
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

  const toInvitee = (friend: ChatFriend): VideoCallInvitee => ({
    userId: friend.userId,
    displayName: getDisplayName(friend.handle, friend.firstName, friend.lastName),
    handle: friend.handle,
    avatarUrl: friend.avatarUrl,
  });

  const videoInvitees = friendList
    .filter((friend) => Number.isFinite(friend.userId))
    .map((friend) => toInvitee(friend));

  const getInitials = (friend: ChatFriend) => {
    const source =
      `${friend.firstName || ""} ${friend.lastName || ""}`.trim() ||
      friend.handle ||
      "Friend";
    const parts = source.split(" ").filter(Boolean);
    const letters = parts.slice(0, 2).map((part) => part[0]).join("");
    return letters.toUpperCase();
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
  const isFullscreen =
    !isMobile &&
    !popoutMinimized &&
    typeof window !== "undefined" &&
    (() => {
      const fullWidth = Math.max(320, window.innerWidth - 36);
      const fullHeight = Math.max(320, window.innerHeight - 36);
      return (
        Math.abs(chatPrefs.width - fullWidth) < 8 &&
        Math.abs(chatPrefs.height - fullHeight) < 8
      );
    })();

  const popoutStyle = {
    ...(isMobile
      ? popoutMinimized
        ? {}
        : {
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            width: "100vw",
            maxWidth: "100vw",
            height: "100vh",
            maxHeight: "100dvh",
            borderRadius: 0,
          }
      : popoutMinimized
      ? {
          width: 52,
          height: 52,
        }
      : {
          width: Math.max(260, chatPrefs.width || 0),
          height: Math.max(220, chatPrefs.height || 0),
        }),
    ["--chat-font-size" as any]: `${chatPrefs.fontSize}px`,
  };

  return (
    <>
      <div
        ref={popoutRef}
        className={`message-popout ${popoutMinimized ? "minimized" : ""}${
          isFullscreen ? " is-fullscreen" : ""
        }`}
        style={popoutStyle}
      >
        <div className="message-popout__header">
        {!popoutMinimized && (
        <div className="message-popout__title">
          <p className="eyebrow">Chat</p>
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
                <div className="chat-friend-menu">
                  {!isMobile && (
                    <div className="chat-friend-menu__toolbar">
                      <button
                        type="button"
                        className="chat-friend-search-btn"
                        aria-label="Focus friend search"
                        title="Search friends"
                        onClick={() => friendSearchInputRef.current?.focus()}
                      >
                        <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
                      </button>
                      <input
                        ref={friendSearchInputRef}
                        type="search"
                        className="chat-friend-search-input"
                        placeholder="Search by name or @handle"
                        value={friendSearch}
                        onChange={(event) => setFriendSearch(event.target.value)}
                        autoComplete="off"
                      />
                    </div>
                  )}

                  <div className="chat-friend-menu__list" role="listbox">
                    {friendsLoading ? (
                      <div className="chat-friend-option is-disabled">Loading friends...</div>
                    ) : filteredFriendList.length === 0 ? (
                      <div className="chat-friend-option is-disabled">
                        {normalizedFriendSearch ? "No friends match that search." : "No friends yet."}
                      </div>
                    ) : (
                      pagedFriendList.map((friend) => {
                        const label = getDisplayName(
                          friend.handle,
                          friend.firstName,
                          friend.lastName
                        );
                        const isActive = friend.userId === friendId;
                        const isOnline = onlineUserIds.has(friend.userId);
                        const statusLabel = isOnline ? "Online" : "Offline";
                        return (
                          <button
                            key={friend.userId}
                            type="button"
                            className={`chat-friend-option${isActive ? " is-active" : ""}`}
                            role="option"
                            aria-selected={isActive}
                            onClick={() => handleSelectFriend(String(friend.userId))}
                          >
                            <span className="chat-friend-option__avatar-wrap">
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
                              <span
                                className={`presence-dot ${isOnline ? "is-online" : "is-offline"}`}
                                title={statusLabel}
                                aria-label={statusLabel}
                              />
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

                  {!friendsLoading && filteredFriendList.length > FRIEND_MENU_PAGE_SIZE && (
                    <div className="chat-friend-menu__pagination">
                      <button
                        type="button"
                        className="chat-friend-page-btn"
                        onClick={() => setFriendPage((prev) => Math.max(1, prev - 1))}
                        disabled={friendPage <= 1}
                      >
                        Prev
                      </button>
                      <span className="chat-friend-page-label">
                        Page {friendPage} of {totalFriendPages}
                      </span>
                      <button
                        type="button"
                        className="chat-friend-page-btn"
                        onClick={() => setFriendPage((prev) => Math.min(totalFriendPages, prev + 1))}
                        disabled={friendPage >= totalFriendPages}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          
        </div>
        )}
        <div className="message-popout__actions">
          {!popoutMinimized && (
            <>
              <button
                className="chat-video-launch chat-action chat-action--video chat-action--video-icon-only"
                type="button"
                onClick={() =>
                  openCallComposer(activeFriend ? [toInvitee(activeFriend)] : [])
                }
                data-chat-tooltip={videoCallTooltip}
                aria-label={videoCallTooltip}
              >
                <span className="chat-action-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <path
                      d="M4.5 7.25A2.75 2.75 0 0 1 7.25 4.5h6.5a2.75 2.75 0 0 1 2.75 2.75v9.5a2.75 2.75 0 0 1-2.75 2.75h-6.5A2.75 2.75 0 0 1 4.5 16.75v-9.5Z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                    />
                    <path
                      d="m16.5 10.25 3.25-2v7.5l-3.25-2.1"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              </button>
            </>
          )}
        </div>
        <button
          className={`chat-toggle-icon${popoutMinimized ? " is-minimized" : ""}`}
          type="button"
          onClick={() => setPopoutMinimized(!popoutMinimized)}
          aria-label={toggleLabel}
          title={toggleLabel}
        >
          {popoutMinimized ? (
            <FontAwesomeIcon
              icon={faComments}
              className="chat-toggle-icon-svg is-minimized"
              aria-hidden="true"
            />
          ) : (
            <svg className="chat-toggle-icon-svg" viewBox="0 0 24 24" aria-hidden="true">
              <path
                d="M7 7l10 10"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M17 7 7 17"
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
              <div className="chat-motivation-card" role="status" aria-live="polite">
                <p className="chat-motivation-title">{`${motivationalGreeting}, ${motivationalName}`}</p>
                <p className="chat-motivation-subtitle">{motivationalQuote}</p>
              </div>
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
                      const fallbackIcon = faviconFor(url);
                      const image = meta?.thumb || fallbackIcon;
                      const isFavicon = !meta?.thumb && Boolean(image);
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
                          {image ? (
                            <a
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ display: "block" }}
                            >
                              <img
                                src={image}
                                alt={title}
                                style={{
                                  width: "100%",
                                  height: isFavicon ? "120px" : "auto",
                                  objectFit: isFavicon ? "contain" : "cover",
                                  display: "block",
                                  padding: isFavicon ? "16px" : undefined,
                                  background: isFavicon ? "rgba(8,12,20,0.45)" : undefined,
                                }}
                                loading="lazy"
                                decoding="async"
                              />
                            </a>
                          ) : (
                            <div
                              style={{
                                height: "120px",
                                display: "grid",
                                placeItems: "center",
                                color: "#94a3b8",
                                fontWeight: 700,
                                letterSpacing: "0.2em",
                              }}
                            >
                              LINK
                            </div>
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
                  setDraft(friendId, sanitizePostText(e.target.value));
                }
              }}
              disabled={!friendId}
            />
            {error && <p className="status status-error">{error}</p>}
            <div className="message-popout__footer-controls">
              <div className="auth-actions">
                <button className="btn primary" type="button" onClick={handleSend}>
                  Send
                </button>
              </div>
              <div className="chat-font-control chat-font-control--footer">
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
            </div>
          </div>
        </>
        )}
      </div>
      <VideoCallModal friends={videoInvitees} />
    </>
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
