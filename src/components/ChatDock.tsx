import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../api/strapi";
import { useChat } from "../context/ChatContext";
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
  const { preferences, setChatPrefs } = useUserPreferences();
  const {
    activeFriend,
    popoutMinimized,
    chatLogs,
    drafts,
    gifDrafts,
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
  const chatPrefs = preferences.chat;

  useEffect(() => {
    linkMetaRef.current = linkMeta;
  }, [linkMeta]);

  useEffect(() => {
    sizeRef.current = { width: chatPrefs.width, height: chatPrefs.height };
  }, [chatPrefs.height, chatPrefs.width]);

  useEffect(() => {
    if (!activeFriend) return;
    if (location.pathname !== "/friends") {
      setPopoutMinimized(true);
    }
  }, [activeFriend, location.pathname, setPopoutMinimized]);

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

  if (!activeFriend || !activeFriend.userId) return null;

  const friendId = activeFriend.userId;
  const key = String(friendId);
  const messages = chatLogs[key] || [];
  const messageDraft = drafts[key] || "";
  const gifDraft = gifDrafts[key] || "";
  const displayName = getDisplayName(
    activeFriend.handle,
    activeFriend.firstName,
    activeFriend.lastName
  );
  const handleLabel = activeFriend.handle ? `@${activeFriend.handle}` : displayName;

  const handleSend = async () => {
    const body = `${messageDraft}${gifDraft ? `\n${gifDraft}` : ""}`.trim();
    if (!body) return;
    const sendError = await sendMessage(friendId, body);
    setError(sendError);
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
        <div>
          <p className="eyebrow">Chat</p>
          <strong>{handleLabel}</strong>
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
      {!popoutMinimized && (
        <>
          <div className="message-popout__body">
            {messages.length === 0 ? (
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
                setDraft(friendId, `${messageDraft}${emoji}`);
              }}
            />
          </div>
          <div className="message-popout__footer">
            <input
              className="auth-input"
              placeholder="Paste a GIF / image / video URL (optional)"
              value={gifDraft}
              onChange={(e) => setGifDraft(friendId, e.target.value)}
            />
            <input
              className="auth-input"
              placeholder={`Message ${handleLabel}...`}
              value={messageDraft}
              onChange={(e) => setDraft(friendId, e.target.value)}
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
